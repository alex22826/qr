/* Печать QR на Xprinter с телефона — без входа и без GitHub-ключа.
   Задание уходит в секретный канал ntfy.sh (бесплатный посредник без регистрации):
   xprinter-<ключ принтера>. Его слушает агент на компьютере с принтером
   (E:\codeAI\xprinter\start-agent.bat) и отвечает в канал xprinter-<ключ>-done.
   Ключ телефон получает один раз — сканируя этикетку «Подключить телефон»
   (print.html#k=<ключ>; часть после # браузер на сервер не отправляет). */
(function () {
  'use strict';

  var $ = function (sel, el) { return (el || document).querySelector(sel); };
  var view = $('#view');
  var NTFY = 'https://ntfy.sh/';
  var KEY_STORE = 'qr.printerKey';
  var MAX_BYTES = 400;               // больше агент не печатает: QR на этикетке станет слишком мелким
  var WAIT_MS = 90000, POLL_MS = 3000;

  var PRINT_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M17.63 5.84C17.27 5.33 16.67 5 16 5L5 5.01C3.9 5.01 3 5.9 3 7v10c0 1.1.9 1.99 2 1.99L16 19c.67 0 1.27-.33 1.63-.84L22 12l-4.37-6.16z"/></svg>';

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { /* приватный режим */ } }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  var toastTimer;
  function toast(msg, isErr) {
    var t = $('#toast');
    t.textContent = msg;
    t.className = 'toast show' + (isErr ? ' err' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.className = 'toast' + (isErr ? ' err' : ''); }, isErr ? 7000 : 3500);
  }

  // ---------- ключ принтера ----------
  var justConnected = false;
  var m = /^#k=([a-z0-9]{8,64})$/i.exec(location.hash);
  if (m) {
    lsSet(KEY_STORE, m[1].toLowerCase());
    history.replaceState(null, '', location.pathname + location.search); // ключ не остаётся в адресной строке
    justConnected = true;
  }
  function key() { return (lsGet(KEY_STORE) || '').trim(); }
  function topic() { return 'xprinter-' + key(); }

  // ---------- QR ----------
  // По умолчанию библиотека режет символы до 1 байта: «Тест» превращается в «"5AB»
  if (window.qrcode && qrcode.stringToBytesFuncs && qrcode.stringToBytesFuncs['UTF-8']) {
    qrcode.stringToBytes = qrcode.stringToBytesFuncs['UTF-8'];
  }
  function makeQr(text) { var qr = qrcode(0, 'M'); qr.addData(text); qr.make(); return qr; }
  function qrSvg(qr, margin) {
    var n = qr.getModuleCount(), size = n + margin * 2, d = '';
    for (var r = 0; r < n; r++) {
      for (var c = 0; c < n; c++) if (qr.isDark(r, c)) d += 'M' + (c + margin) + ' ' + (r + margin) + 'h1v1h-1z';
    }
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + size + ' ' + size + '" shape-rendering="crispEdges">' +
      '<rect width="' + size + '" height="' + size + '" fill="#fff"/><path d="' + d + '" fill="#000"/></svg>';
  }
  // Матрица QR → n×n бит построчно (старший бит первым) → base64. Агент печатает её картинкой
  // ровно как на экране: команда QRCODE принтера ломается на переносах строк и кириллице.
  function packBits(qr) {
    var n = qr.getModuleCount(), bytes = new Uint8Array(Math.ceil(n * n / 8));
    for (var r = 0; r < n; r++) {
      for (var c = 0; c < n; c++) {
        var i = r * n + c;
        if (qr.isDark(r, c)) bytes[i >> 3] |= 0x80 >> (i & 7);
      }
    }
    var s = '';
    for (var k = 0; k < bytes.length; k++) s += String.fromCharCode(bytes[k]);
    return { n: n, bits: btoa(s) };
  }

  // ---------- связь с агентом через ntfy.sh ----------
  // Связь бывает нестабильной — пробуем несколько раз
  async function sendJob(job) {
    var id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    var body = JSON.stringify(Object.assign({ id: id, created: new Date().toISOString() }, job));
    for (var attempt = 0; attempt < 3; attempt++) {
      try {
        var res = await fetch(NTFY + topic(), { method: 'POST', body: body });
        if (res.ok) return id;
      } catch (e) { /* обрыв — ещё раз */ }
      await sleep(800);
    }
    throw new Error('Нет связи с сервером печати. Проверьте интернет на телефоне.');
  }

  // 'done' | { error } | 'timeout'
  async function waitPrinted(id, sinceSec) {
    var until = Date.now() + WAIT_MS;
    while (Date.now() < until) {
      await sleep(POLL_MS);
      try {
        var res = await fetch(NTFY + topic() + '-done/json?poll=1&since=' + sinceSec, { cache: 'no-store' });
        var lines = (await res.text()).split('\n');
        for (var i = 0; i < lines.length; i++) {
          if (!lines[i].trim()) continue;
          var ev = JSON.parse(lines[i]);
          if (ev.event !== 'message') continue;
          var reply = JSON.parse(ev.message);
          if (reply.id === id) return reply.error ? { error: reply.error } : 'done';
        }
      } catch (e) { /* связь моргнула — спросим ещё раз */ }
    }
    return 'timeout';
  }

  // ---------- экраны ----------
  function renderNoKey() {
    view.innerHTML =
      '<div class="panel connect" style="margin-top:0">' +
        '<h2>Подключите телефон к принтеру</h2>' +
        '<p class="muted">Это нужно сделать один раз:</p>' +
        '<ol>' +
          '<li>На компьютере с принтером дважды нажмите <code>connect-phone.bat</code> (папка <code>E:\\codeAI\\xprinter</code>).</li>' +
          '<li>Принтер напечатает этикетку «Подключить телефон».</li>' +
          '<li>Наведите на неё камеру телефона и откройте ссылку.</li>' +
        '</ol>' +
        '<p class="muted small">Никаких паролей и регистрации не нужно.</p>' +
      '</div>';
  }

  var draft = { text: '', caption: '', copies: 1 };

  function renderMain() {
    view.innerHTML =
      '<div class="editor">' +
        '<div class="panel">' +
          '<label class="field"><span>Текст в QR</span>' +
            '<textarea class="textarea" id="pText" maxlength="1000" style="min-height:120px" placeholder="Например: Тестовый текст. Склад 2, полка 5"></textarea></label>' +
          '<p class="qr-url" id="pLen" style="margin-top:-8px"></p>' +
          '<label class="field"><span>Подпись под QR на этикетке (необязательно)</span>' +
            '<input class="input" id="pCaption" maxlength="40" placeholder="Например: Полка 5"></label>' +
          '<label class="field"><span>Копий</span>' +
            '<input class="input" id="pCopies" type="number" min="1" max="50" inputmode="numeric"></label>' +
        '</div>' +
        '<aside class="side panel">' +
          '<div class="qr-preview" id="pPreview"></div>' +
          '<p class="muted small center" style="margin:10px 0 12px">При сканировании телефон покажет этот текст</p>' +
          '<button class="btn btn-primary btn-block" id="pPrint" type="button">' + PRINT_ICON + 'Напечатать на Xprinter</button>' +
        '</aside>' +
      '</div>' +
      '<p class="center" style="margin-top:20px"><button class="btn btn-ghost small" id="unlink" type="button">Отключить телефон от принтера</button></p>';

    var fText = $('#pText'), fCaption = $('#pCaption'), fCopies = $('#pCopies'), btn = $('#pPrint');
    fText.value = draft.text; fCaption.value = draft.caption; fCopies.value = draft.copies;

    var printing = false;
    function current() { return fText.value.trim(); }
    function update() {
      draft.text = fText.value; draft.caption = fCaption.value;
      var text = current(), bytes = new TextEncoder().encode(text).length, ok = false;
      var preview = $('#pPreview'), len = $('#pLen');
      if (!text) {
        preview.innerHTML = '<div class="empty small" style="padding:40px 8px">Здесь появится QR</div>';
        len.textContent = 'Напишите текст — QR построится сразу.';
      } else {
        try { preview.innerHTML = qrSvg(makeQr(text), 2); ok = bytes <= MAX_BYTES; }
        catch (e) { preview.innerHTML = '<div class="empty small" style="padding:40px 8px">Слишком длинный текст для QR</div>'; }
        len.textContent = bytes > MAX_BYTES
          ? 'Слишком длинно для этикетки: ' + bytes + ' из ' + MAX_BYTES + '. Сократите текст.'
          : 'Длина: ' + bytes + ' из ' + MAX_BYTES + ' (русская буква считается за 2)';
      }
      len.style.color = bytes > MAX_BYTES ? 'var(--danger)' : '';
      if (!printing) btn.disabled = !ok;
    }
    fText.oninput = update;
    fCaption.oninput = update;
    fCopies.oninput = function () { draft.copies = this.value; };
    update();

    btn.onclick = async function () {
      var text = current();
      var copies = Math.max(1, Math.min(50, parseInt(fCopies.value, 10) || 1));
      fCopies.value = draft.copies = copies;
      var html = btn.innerHTML;
      printing = true;
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner"></span>Отправляю…';
      try {
        var since = Math.floor(Date.now() / 1000) - 5;
        var id = await sendJob(Object.assign({ content: text, caption: fCaption.value.trim(), copies: copies }, packBits(makeQr(text))));
        btn.innerHTML = '<span class="spinner"></span>Печатаю…';
        var res = await waitPrinted(id, since);
        if (res === 'done') {
          if (navigator.vibrate) navigator.vibrate([40, 60, 40]);
          toast('Напечатано ✓');
        } else if (res === 'timeout') {
          toast('Компьютер с принтером не ответил. Проверьте, что он включён и открыто окно «Агент печати», и отправьте ещё раз.', true);
        } else {
          toast('Принтер не смог напечатать: ' + res.error, true);
        }
      } catch (e) {
        toast(e.message || 'Не удалось отправить', true);
      } finally {
        printing = false;
        btn.innerHTML = html;
        if (btn.isConnected) update();
      }
    };

    $('#unlink').onclick = function () {
      if (!confirm('Отключить этот телефон от принтера? Чтобы снова печатать, нужно будет ещё раз отсканировать этикетку «Подключить телефон».')) return;
      lsSet(KEY_STORE, null);
      renderNoKey();
    };
  }

  if (!window.qrcode) {
    view.innerHTML = '<div class="empty"><b>Не загрузился генератор QR</b>Проверьте интернет и обновите страницу.</div>';
  } else if (!key()) {
    renderNoKey();
  } else {
    renderMain();
    if (justConnected) toast('Телефон подключён к принтеру ✓');
  }
})();
