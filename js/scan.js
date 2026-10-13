/* Скан → печать: телефон сканирует любой QR и отправляет его на этикеточный принтер.
   Задание уходит в ветку print-queue (GH.sendPrintJob), печатает его агент на компьютере
   с принтером (E:\codeAI\xprinter\print-agent.ps1) и удаляет файл — так телефон узнаёт, что готово. */
(function () {
  'use strict';

  var $ = function (sel, el) { return (el || document).querySelector(sel); };
  var view = $('#view');

  // jsQR нет на cdnjs — основной jsDelivr, запасной unpkg
  var JSQR_SRC = ['https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.min.js', 'https://unpkg.com/jsqr@1.4.0/dist/jsQR.min.js'];
  var COPIES_KEY = 'qr.scan.copies';
  var MAX_BYTES = 400;               // больше — QR на этикетке 58×40 станет слишком мелким
  var WAIT_MS = 90000, POLL_MS = 3000;

  var stream = null, scanning = false, decoder = null, pollTimer = null;

  var PRINT_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M19 8H5c-1.66 0-3 1.34-3 3v6h4v4h12v-4h4v-6c0-1.66-1.34-3-3-3zm-3 11H8v-5h8v5zm3-7c-.55 0-1-.45-1-1s.45-1 1-1 1 .45 1 1-.45 1-1 1zm-1-9H6v4h12V3z"/></svg>';

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* приватный режим */ } }

  var toastTimer;
  function toast(msg, isErr) {
    var t = $('#toast');
    t.textContent = msg;
    t.className = 'toast show' + (isErr ? ' err' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.className = 'toast' + (isErr ? ' err' : ''); }, isErr ? 6000 : 3500);
  }

  // ---------- распознавание ----------
  function loadScript(src) {
    return new Promise(function (ok, fail) {
      var s = document.createElement('script');
      s.src = src; s.onload = ok; s.onerror = fail;
      document.head.appendChild(s);
    });
  }

  // Функция (видео | картинка, макс. сторона) → Promise<текст | null>.
  // Android Chrome умеет сам (BarcodeDetector), для iPhone подгружаем jsQR.
  async function getDecoder() {
    if (decoder) return decoder;
    if ('BarcodeDetector' in window) {
      try {
        var formats = await window.BarcodeDetector.getSupportedFormats();
        if (formats.indexOf('qr_code') >= 0) {
          var bd = new window.BarcodeDetector({ formats: ['qr_code'] });
          decoder = function (src) {
            return bd.detect(src).then(function (r) { return r.length ? r[0].rawValue : null; });
          };
          return decoder;
        }
      } catch (e) { /* нет поддержки — ниже jsQR */ }
    }
    for (var i = 0; i < JSQR_SRC.length && !window.jsQR; i++) {
      try { await loadScript(JSQR_SRC[i]); } catch (e) { /* следующий CDN */ }
    }
    if (!window.jsQR) {
      var err = new Error('Не удалось загрузить распознавание QR. Проверьте интернет.');
      err.decoder = true;
      throw err;
    }
    var canvas = document.createElement('canvas');
    var ctx = canvas.getContext('2d', { willReadFrequently: true });
    decoder = function (src, maxSide) {
      var w = src.videoWidth || src.width, h = src.videoHeight || src.height;
      if (!w || !h) return Promise.resolve(null);
      // уменьшенный кадр распознаётся быстрее, а QR всё равно читается
      var k = Math.min(1, (maxSide || 800) / Math.max(w, h));
      canvas.width = Math.round(w * k); canvas.height = Math.round(h * k);
      ctx.drawImage(src, 0, 0, canvas.width, canvas.height);
      var img = ctx.getImageData(0, 0, canvas.width, canvas.height);
      var r = window.jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' });
      return Promise.resolve(r ? r.data : null);
    };
    return decoder;
  }

  // ---------- камера ----------
  async function startCamera() {
    var off = $('#camOff');
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error('nocam');
      var decReady = getDecoder(); // распознавание грузится параллельно с камерой
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
      var video = $('#video');
      if (!video) { stopCamera(); return; } // экран уже сменили
      video.srcObject = stream;
      await video.play();
      await decReady;
      off.hidden = true;
      scanning = true;
      tick(video);
    } catch (e) {
      stopCamera();
      if (!off || !off.isConnected) return;
      var msg = e && e.decoder ? e.message
        : e && e.name === 'NotAllowedError' ? 'Нет доступа к камере. Разрешите камеру для этого сайта в настройках браузера или сфотографируйте QR кнопкой ниже.'
        : 'Камера недоступна. Сфотографируйте QR кнопкой ниже или введите текст вручную.';
      off.innerHTML = '<div><p>' + esc(msg) + '</p><button class="btn" id="retryCam">Попробовать ещё раз</button></div>';
      $('#retryCam').onclick = function () { off.innerHTML = '<span class="spinner"></span>'; startCamera(); };
    }
  }

  function stopCamera() {
    scanning = false;
    if (stream) { stream.getTracks().forEach(function (t) { t.stop(); }); stream = null; }
  }

  async function tick(video) {
    if (!scanning) return;
    var text = null;
    try { text = await decoder(video); } catch (e) { /* кадр ещё не готов */ }
    if (!scanning) return;
    if (text) {
      if (navigator.vibrate) navigator.vibrate(60);
      stopCamera();
      renderResult(text);
      return;
    }
    setTimeout(function () { tick(video); }, 120);
  }

  async function onPhoto() {
    var input = this, file = input.files && input.files[0];
    if (!file) return;
    try {
      var dec = await getDecoder();
      var text = await dec(await createImageBitmap(file), 1600);
      if (text) { stopCamera(); renderResult(text); }
      else toast('QR на фото не найден. Снимите ближе и ровнее.', true);
    } catch (e) {
      toast((e && e.decoder && e.message) || 'Не удалось прочитать фото', true);
    }
    input.value = '';
  }

  // ---------- экраны ----------
  function renderNoToken() {
    view.innerHTML =
      '<div class="panel connect" style="margin-top:0">' +
        '<h2>Телефон не подключён</h2>' +
        '<p class="muted">Чтобы отправлять на печать, телефон нужно один раз подключить:</p>' +
        '<ol><li>На компьютере откройте админку QR-карточек.</li>' +
        '<li>Нажмите значок телефона вверху.</li>' +
        '<li>Наведите камеру телефона на появившийся QR.</li></ol>' +
        '<a class="btn btn-primary btn-block" href="admin.html">Открыть админку</a>' +
      '</div>';
  }

  function renderScanner() {
    stopPoll();
    view.innerHTML =
      '<div class="scan-box">' +
        '<video id="video" playsinline muted></video><div class="scan-frame"></div>' +
        '<div class="scan-off" id="camOff"><span class="spinner"></span></div>' +
      '</div>' +
      '<p class="muted center">Наведите камеру на QR-код</p>' +
      '<label class="btn btn-block">Сфотографировать QR' +
        '<input type="file" accept="image/*" capture="environment" id="photo" class="sr-only"></label>' +
      '<details class="manual"><summary>Ввести текст или ссылку вручную</summary>' +
        '<textarea class="textarea" id="manualText" style="min-height:90px" placeholder="https://…"></textarea>' +
        '<button class="btn btn-primary btn-block" id="manualGo">Дальше</button>' +
      '</details>';
    $('#photo').onchange = onPhoto;
    $('#manualGo').onclick = function () {
      var t = $('#manualText').value.trim();
      if (t) { stopCamera(); renderResult(t); }
    };
    startCamera();
  }

  // job — если вернулись после ошибки, чтобы не вводить подпись заново
  function renderResult(text, job) {
    stopPoll();
    var bytes = new TextEncoder().encode(text).length;
    var tooLong = bytes > MAX_BYTES;
    var copies = (job && job.copies) || +lsGet(COPIES_KEY) || 1;
    view.innerHTML =
      '<div class="panel">' +
        '<div class="field"><span>Содержимое QR</span><div class="scan-content">' + esc(text) + '</div></div>' +
        (tooLong ? '<p class="error" style="margin:-8px 0 16px">Слишком длинно для этикетки (' + bytes + ' из ' + MAX_BYTES + ' байт).</p>' : '') +
        '<label class="field"><span>Подпись под QR (необязательно)</span>' +
          '<input class="input" id="caption" maxlength="60" placeholder="Например: Склад, полка 3" value="' + esc(job && job.caption) + '"></label>' +
        '<label class="field"><span>Копий</span>' +
          '<input class="input" id="copies" type="number" min="1" max="100" inputmode="numeric" value="' + copies + '"></label>' +
        '<div class="actions">' +
          '<button class="btn btn-primary" id="print"' + (tooLong ? ' disabled' : '') + '>' + PRINT_ICON + 'Печатать</button>' +
          '<button class="btn" id="again">Сканировать другой</button>' +
        '</div>' +
      '</div>';
    $('#again').onclick = renderScanner;
    $('#print').onclick = function () {
      var n = Math.max(1, Math.min(100, parseInt($('#copies').value, 10) || 1));
      lsSet(COPIES_KEY, String(n));
      send({ content: text, caption: $('#caption').value.trim(), copies: n });
    };
  }

  function renderStatus(html, actions) {
    view.innerHTML = '<div class="panel"><div class="status">' + html + '</div>' +
      (actions ? '<div class="actions" style="margin-top:16px">' + actions + '</div>' : '') + '</div>';
  }

  function stopPoll() { clearTimeout(pollTimer); pollTimer = null; }

  async function send(job) {
    renderStatus('<span class="spinner"></span>Отправляю…');
    var id;
    try {
      id = await GH.sendPrintJob(job);
    } catch (e) {
      if (e && e.status === 401) { GH.setToken(null); toast(e.message, true); renderNoToken(); return; }
      toast((e && e.message) || 'Не удалось отправить', true);
      renderResult(job.content, job);
      return;
    }
    waitPrinted(id, job);
  }

  function waitPrinted(id, job) {
    var started = Date.now();
    renderStatus('<span class="spinner"></span>Ждём принтер…',
      '<button class="btn" id="cancel">Отменить</button>');
    $('#cancel').onclick = function () { cancel(id); };
    (function poll() {
      pollTimer = setTimeout(async function () {
        var st;
        try { st = await GH.getPrintJob(id); } catch (e) { st = undefined; /* связь моргнула — спросим ещё раз */ }
        if (!pollTimer) return; // пока ждали ответ, ушли с экрана
        if (st === null) return renderDone(job);
        if (st && st.status === 'error') return renderFail(st.error, id, job);
        if (Date.now() - started > WAIT_MS) return renderTimeout(id, job);
        poll();
      }, POLL_MS);
    })();
  }

  function renderDone(job) {
    stopPoll();
    if (navigator.vibrate) navigator.vibrate([40, 60, 40]);
    renderStatus('<span class="status-ok">✓ Напечатано</span>',
      '<button class="btn btn-primary" id="again">Сканировать ещё</button>' +
      '<button class="btn" id="repeat">' + PRINT_ICON + 'Ещё раз</button>');
    $('#again').onclick = renderScanner;
    $('#repeat').onclick = function () { send(job); };
  }

  function renderFail(error, id, job) {
    stopPoll();
    renderStatus('<span class="error" style="margin:0">Принтер не смог напечатать: ' + esc(error || 'неизвестная ошибка') + '</span>',
      '<button class="btn btn-primary" id="again">Сканировать ещё</button>');
    $('#again').onclick = renderScanner;
    // задание с ошибкой больше не нужно в очереди
    GH.cancelPrintJob(id).catch(function () { /* не страшно — агент его пропускает */ });
  }

  function renderTimeout(id, job) {
    stopPoll();
    renderStatus('<div><b>Компьютер с принтером не ответил</b>' +
      '<p class="muted small" style="margin:6px 0 0">Проверьте, что компьютер включён и открыто окно «Агент печати». ' +
      'Задание осталось в очереди и напечатается, как только агент запустится.</p></div>',
      '<button class="btn" id="wait">Подождать ещё</button>' +
      '<button class="btn btn-danger" id="cancel">Отменить задание</button>' +
      '<button class="btn" id="again">Сканировать ещё</button>');
    $('#wait').onclick = function () { waitPrinted(id, job); };
    $('#cancel').onclick = function () { cancel(id); };
    $('#again').onclick = renderScanner;
  }

  async function cancel(id) {
    stopPoll();
    renderStatus('<span class="spinner"></span>Отменяю…');
    try {
      var removed = await GH.cancelPrintJob(id);
      toast(removed ? 'Задание отменено' : 'Уже напечатано');
    } catch (e) {
      toast((e && e.message) || 'Не удалось отменить', true);
    }
    renderScanner();
  }

  // камеру выключаем, когда вкладка скрыта — бережём батарею
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) stopCamera();
    else if ($('#video') && !stream) startCamera();
  });

  if (!GH.getToken()) renderNoToken();
  else renderScanner();
})();
