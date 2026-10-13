/* Админка: список карточек, редактор (текст + фото), QR и печать.
   Маршруты: #/ — список, #/new, #/edit/<id>, #/print/<id,id,…>, #/settings */
(function () {
  'use strict';

  var $ = function (sel, el) { return (el || document).querySelector(sel); };
  var view = $('#view'), fab = $('#fab');

  var state = { cards: [], loaded: false, loading: null, selected: new Set(), query: '', edit: null };

  // ---------- мелкие утилиты ----------
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }
  function readJson(key) { try { return JSON.parse(localStorage.getItem(key)) || {}; } catch (e) { return {}; } }
  function writeJson(key, v) { try { localStorage.setItem(key, JSON.stringify(v)); } catch (e) { /* ничего */ } }
  function fmtDate(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    return d.toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  }
  function findCard(id) { return state.cards.find(function (c) { return c.id === id; }) || null; }

  var ICONS = {
    plus: 'M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6z',
    back: 'M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z',
    refresh: 'M17.65 6.35A7.96 7.96 0 0 0 12 4a8 8 0 1 0 7.73 10h-2.08A6 6 0 1 1 12 6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z',
    print: 'M19 8H5c-1.66 0-3 1.34-3 3v6h4v4h12v-4h4v-6c0-1.66-1.34-3-3-3zm-3 11H8v-5h8v5zm3-7c-.55 0-1-.45-1-1s.45-1 1-1 1 .45 1 1-.45 1-1 1zm-1-9H6v4h12V3z',
    download: 'M5 20h14v-2H5v2zM19 9h-4V3H9v6H5l7 7 7-7z',
    open: 'M19 19H5V5h7V3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14c1.1 0 2-.9 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z',
    copy: 'M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z',
    trash: 'M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z',
    image: 'M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z',
    phone: 'M17 1H7c-1.1 0-2 .9-2 2v18c0 1.1.9 2 2 2h10c1.1 0 2-.9 2-2V3c0-1.1-.9-2-2-2zm0 18H7V5h10v14z',
    more: 'M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z',
    qr: 'M5 5h6v6H5zm2 2v2h2V7zm6-2h6v6h-6zm2 2v2h2V7zM5 13h6v6H5zm2 2v2h2v-2zm6-2h2v2h-2zm4 0h2v2h-2zm-2 2h2v2h-2zm2 2h2v2h-2zm-4 0h2v2h-2z',
    scan: 'M3 3h6v2H5v4H3V3zm12 0h6v6h-2V5h-4V3zM3 15h2v4h4v2H3v-6zm16 0h2v6h-6v-2h4v-4zM7 7h4v4H7V7zm6 0h4v4h-4V7zm-6 6h4v4H7v-4zm8 0h2v2h-2v-2zm-2 2h2v2h-2v-2zm2 0h2v2h-2v-2z'
  };
  function icon(name) { return '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="' + ICONS[name] + '"/></svg>'; }

  var toastTimer;
  function toast(msg, isErr) {
    var t = $('#toast');
    t.textContent = msg;
    t.className = 'toast show' + (isErr ? ' err' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.className = 'toast' + (isErr ? ' err' : ''); }, isErr ? 6000 : 3500);
  }
  function busy(text) {
    $('#busy').hidden = !text;
    if (text) $('#busyText').textContent = text;
  }
  function handleError(e) {
    console.error(e);
    if (e && e.status === 401) {
      GH.setToken(null);
      toast(e.message, true);
      route();
      return;
    }
    toast((e && e.message) || 'Что-то пошло не так', true);
  }

  function setTop(opts) {
    $('#title').textContent = opts.title;
    $('#topLeft').innerHTML = opts.back
      ? '<a class="btn btn-ghost btn-icon" href="' + (opts.backHref || '#/') + '" aria-label="Назад">' + icon('back') + '</a>'
      : '<a class="logo" href="#/" aria-label="К списку">' + icon('qr') + '</a>';
    $('#topActions').innerHTML = opts.actions || '';
    fab.hidden = !opts.fab;
  }

  // ---------- QR ----------
  function makeQr(text) {
    var qr = qrcode(0, 'M'); // 0 — размер подбирается сам, M — ~15% восстановления
    qr.addData(text);
    qr.make();
    return qr;
  }
  // SVG масштабируется без потерь — в печати размер задаётся в миллиметрах.
  function qrSvg(text, margin) {
    var qr = makeQr(text), n = qr.getModuleCount(), size = n + margin * 2, d = '';
    for (var r = 0; r < n; r++) {
      for (var c = 0; c < n; c++) if (qr.isDark(r, c)) d += 'M' + (c + margin) + ' ' + (r + margin) + 'h1v1h-1z';
    }
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + size + ' ' + size + '" shape-rendering="crispEdges">' +
      '<rect width="' + size + '" height="' + size + '" fill="#fff"/><path d="' + d + '" fill="#000"/></svg>';
  }
  function qrPng(text, px) {
    var qr = makeQr(text), n = qr.getModuleCount(), margin = 4;
    var cell = Math.max(1, Math.floor(px / (n + margin * 2)));
    var size = cell * (n + margin * 2);
    var cv = document.createElement('canvas');
    cv.width = cv.height = size;
    var ctx = cv.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = '#000';
    for (var r = 0; r < n; r++) {
      for (var c = 0; c < n; c++) if (qr.isDark(r, c)) ctx.fillRect((c + margin) * cell, (r + margin) * cell, cell, cell);
    }
    return new Promise(function (res) { cv.toBlob(res, 'image/png'); });
  }

  // Короткий код карточки — он попадает в ссылку внутри QR.
  // Чем короче ссылка, тем крупнее «квадратики» QR и тем легче он сканируется мелким.
  var ID_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789'; // без похожих 0/o, 1/l/i
  function makeId() {
    for (;;) {
      var b = new Uint8Array(6), id = '';
      crypto.getRandomValues(b);
      for (var i = 0; i < b.length; i++) id += ID_ALPHABET[b[i] % ID_ALPHABET.length];
      if (!findCard(id)) return id;
    }
  }

  // ---------- фото ----------
  // Телефонные фото весят 3–12 МБ; уменьшаем до 1600 px по длинной стороне (~200–400 КБ).
  async function compressImage(file, maxSide, quality) {
    maxSide = maxSide || 1600; quality = quality || 0.82;
    var url = URL.createObjectURL(file);
    try {
      var img = new Image();
      img.src = url;
      await img.decode(); // Chrome сам учитывает поворот из EXIF
      var k = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
      var w = Math.round(img.naturalWidth * k), h = Math.round(img.naturalHeight * k);
      var cv = document.createElement('canvas');
      cv.width = w; cv.height = h;
      var ctx = cv.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h); // прозрачный PNG → белый фон
      ctx.drawImage(img, 0, 0, w, h);
      var blob = await new Promise(function (res) { cv.toBlob(res, 'image/jpeg', quality); });
      return { blob: blob, w: w, h: h };
    } finally {
      URL.revokeObjectURL(url);
    }
  }
  function blobToBase64(blob) {
    return new Promise(function (res, rej) {
      var r = new FileReader();
      r.onload = function () { res(String(r.result).split(',')[1]); };
      r.onerror = rej;
      r.readAsDataURL(blob);
    });
  }
  // Миниатюра/фото: сначала из репозитория (обновляется сразу), при ошибке — с Pages.
  function photoImg(card, cls) {
    return '<img class="' + cls + '" src="' + esc(GH.photoUrl(card)) + '" data-fallback="' + esc(GH.pagesPhotoUrl(card)) + '" alt="" loading="lazy">';
  }
  document.addEventListener('error', function (e) {
    var el = e.target;
    if (el.tagName === 'IMG' && el.dataset.fallback && el.src !== el.dataset.fallback) el.src = el.dataset.fallback;
  }, true);

  // ---------- загрузка ----------
  function loadCards(force) {
    if (state.loading) return state.loading;
    if (state.loaded && !force) return Promise.resolve(state.cards);
    state.loading = GH.listCards().then(function (cards) {
      state.cards = cards;
      state.loaded = true;
      state.selected.forEach(function (id) { if (!findCard(id)) state.selected.delete(id); });
      return cards;
    }).finally(function () { state.loading = null; });
    return state.loading;
  }
  function loadingHtml(text) {
    return '<div class="empty"><span class="spinner" style="display:inline-block"></span><p>' + esc(text) + '</p></div>';
  }

  // ---------- маршрутизация ----------
  var routeSeq = 0, lastHash = location.hash, ignoreHash = false;

  function route() {
    var seq = ++routeSeq;
    var parts = location.hash.replace(/^#\/?/, '').split('/');
    cleanupEdit();
    if (!window.qrcode) {
      setTop({ title: 'QR-карточки' });
      view.innerHTML = '<div class="empty"><b>Не загрузился генератор QR</b>Проверьте интернет и обновите страницу.</div>';
      return;
    }
    if (!GH.getToken()) return renderConnect();
    if (parts[0] === 'settings') return renderSettings();
    if (parts[0] === 'new') return renderEditor(null, seq);

    var after = { edit: function () { renderEditor(findCard(parts[1]) || 'missing', seq); },
                  print: function () { renderPrint((parts[1] || '').split(',').filter(Boolean)); } }[parts[0]] || renderList;
    if (state.loaded) return after();
    setTop({ title: 'QR-карточки' });
    view.innerHTML = loadingHtml('Загружаю карточки…');
    loadCards().then(function () { if (seq === routeSeq) after(); }, function (e) {
      if (seq !== routeSeq) return;
      if (e.status === 401) return handleError(e);
      view.innerHTML = '<div class="empty"><b>Не удалось загрузить карточки</b>' + esc(e.message) +
        '<p><button class="btn" id="retry">' + icon('refresh') + 'Повторить</button></p></div>';
      $('#retry').onclick = route;
    });
  }

  window.addEventListener('hashchange', function () {
    if (ignoreHash) { ignoreHash = false; return; }
    if (state.edit && state.edit.dirty && !confirm('Есть несохранённые изменения. Уйти без сохранения?')) {
      ignoreHash = true;
      location.hash = lastHash;
      return;
    }
    lastHash = location.hash;
    route();
  });
  window.addEventListener('beforeunload', function (e) {
    if (state.edit && state.edit.dirty) { e.preventDefault(); e.returnValue = ''; }
  });
  window.addEventListener('resize', function () { fitPaper(); });

  function go(hash, replace) {
    if (location.hash === hash) { route(); return; }
    if (state.edit) state.edit.dirty = false;
    if (replace) location.replace(hash); else location.hash = hash;
  }

  // ---------- подключение (токен) ----------
  function renderConnect(errText) {
    setTop({ title: 'QR-карточки' });
    var r = GH.REPO;
    // GitHub сам подставит из ссылки имя ключа, «без срока» и право записи — вручную остаётся выбрать репозиторий.
    var tokenUrl = 'https://github.com/settings/personal-access-tokens/new?name=qr-admin' +
      '&description=' + encodeURIComponent('Админка QR-карточек') + '&target_name=' + r.owner + '&expires_in=none&contents=write';
    view.innerHTML =
      '<div class="connect panel">' +
        '<h2>Первый вход</h2>' +
        '<p class="muted">Один раз свяжите сайт со своим GitHub — тогда добавлять карточки сможете только вы.</p>' +
        '<div class="step"><span class="num">1</span><div>' +
          '<a class="btn btn-primary btn-block" href="' + tokenUrl + '" target="_blank" rel="noopener">Открыть GitHub</a>' +
          '<p class="small" style="margin:10px 0 0">Там почти всё уже заполнено. Нужно только:</p>' +
          '<ul class="small">' +
            '<li>в блоке <b>Repository access</b> выбрать <b>Only select repositories</b> и в списке — <b>' + esc(r.repo) + '</b>;</li>' +
            '<li>внизу нажать зелёную <b>Generate token</b> (если переспросит — нажать ещё раз);</li>' +
            '<li>скопировать появившийся длинный код.</li>' +
          '</ul>' +
        '</div></div>' +
        '<div class="step"><span class="num">2</span><div>' +
          '<label class="field" style="margin-bottom:10px"><span>Вставьте код сюда</span>' +
            '<input class="input" id="token" type="text" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="github_pat_…"></label>' +
          '<button class="btn btn-primary btn-block" id="connect">Готово</button>' +
          '<p class="error" id="err"' + (errText ? '' : ' hidden') + '>' + esc(errText || '') + '</p>' +
        '</div></div>' +
        '<p class="note" style="margin:18px 0 0"><b>На телефоне ничего вводить не нужно.</b> Сначала подключите компьютер, ' +
          'потом на нём нажмите значок телефона вверху и наведите камеру телефона на QR.</p>' +
      '</div>';
    var input = $('#token'), btn = $('#connect');
    async function submit() {
      var t = input.value.trim();
      if (!t) { input.focus(); return; }
      btn.disabled = true;
      try {
        await GH.checkToken(t);
        GH.setToken(t);
        state.loaded = false;
        toast('Готово! Телефон подключите значком телефона вверху');
        go('#/', true);
      } catch (e) {
        $('#err').hidden = false;
        $('#err').textContent = e.message;
      } finally { btn.disabled = false; }
    }
    btn.onclick = submit;
    input.onkeydown = function (e) { if (e.key === 'Enter') submit(); };
  }

  function renderSettings() {
    setTop({ title: 'Настройки', back: true });
    var r = GH.REPO;
    view.innerHTML =
      '<div class="panel connect" style="margin-top:0">' +
        '<h2>Подключить телефон</h2>' +
        '<p class="muted">Откройте камеру на телефоне и наведите на код — телефон подключится сам, вводить ничего не нужно.</p>' +
        '<button class="btn btn-primary btn-block" id="showPhoneQr">Показать QR для телефона</button>' +
        '<div id="phoneQr" hidden>' +
          '<div class="qr-preview" style="max-width:280px;margin:16px auto 8px">' + qrSvg(GH.PAGES_BASE + 'admin.html#connect=' + encodeURIComponent(GH.getToken()), 3) + '</div>' +
          '<p class="error" style="text-align:center">Этот QR — ключ к вашим карточкам. Не показывайте его посторонним.</p>' +
        '</div>' +
      '</div>' +
      '<div class="panel connect" style="margin-top:16px">' +
        '<p>Хранилище: <a href="https://github.com/' + esc(r.owner + '/' + r.repo) + '" target="_blank" rel="noopener">' + esc(r.owner + '/' + r.repo) + '</a></p>' +
        '<p class="muted small">Ключ сохранён только в этом браузере.</p>' +
        '<button class="btn btn-danger btn-block" id="logout">Отключить это устройство</button>' +
      '</div>';
    $('#showPhoneQr').onclick = function () {
      var box = $('#phoneQr');
      box.hidden = !box.hidden;
      this.textContent = box.hidden ? 'Показать QR для телефона' : 'Скрыть QR';
    };
    $('#logout').onclick = function () {
      if (!confirm('Отключить это устройство? Чтобы снова добавлять карточки, его нужно будет подключить заново.')) return;
      GH.setToken(null);
      state.cards = []; state.loaded = false; state.selected.clear();
      go('#/', true);
    };
  }

  // ---------- список ----------
  function renderList() {
    setTop({
      title: 'QR-карточки', fab: true,
      actions: '<a class="btn btn-ghost btn-icon" href="scan.html" aria-label="Сканировать и напечатать на этикетке" title="Сканировать → этикетка">' + icon('scan') + '</a>' +
               '<button class="btn btn-ghost btn-icon" id="refresh" aria-label="Обновить">' + icon('refresh') + '</button>' +
               '<a class="btn btn-ghost btn-icon" href="#/settings" aria-label="Подключить телефон" title="Подключить телефон">' + icon('phone') + '</a>'
    });
    $('#refresh').onclick = function () {
      view.innerHTML = loadingHtml('Обновляю…');
      loadCards(true).then(renderList, handleError);
    };

    if (!state.cards.length) {
      view.innerHTML = '<div class="empty"><b>Пока нет карточек</b>Нажмите «Новая карточка», добавьте текст и фото — и распечатайте QR.</div>';
      return;
    }
    view.innerHTML =
      '<div class="list-tools">' +
        '<input class="input grow" id="q" type="search" placeholder="Поиск" value="' + esc(state.query) + '">' +
        '<button class="btn" id="selAll">Выбрать все</button>' +
        '<button class="btn btn-primary" id="printSel">' + icon('print') + '<span></span></button>' +
      '</div>' +
      '<div class="cards" id="rows"></div>' +
      '<div style="height:80px"></div>';
    $('#q').oninput = function () { state.query = this.value; renderRows(); };
    $('#selAll').onclick = function () {
      var vis = visibleCards();
      var all = vis.every(function (c) { return state.selected.has(c.id); });
      vis.forEach(function (c) { if (all) state.selected.delete(c.id); else state.selected.add(c.id); });
      renderRows();
    };
    $('#printSel').onclick = function () { go('#/print/' + Array.from(state.selected).join(',')); };
    $('#rows').onchange = function (e) {
      if (e.target.type !== 'checkbox') return;
      var id = e.target.closest('.card-row').dataset.id;
      if (e.target.checked) state.selected.add(id); else state.selected.delete(id);
      renderRows();
    };
    renderRows();
  }

  function visibleCards() {
    var q = state.query.trim().toLowerCase();
    if (!q) return state.cards;
    return state.cards.filter(function (c) { return ((c.title || '') + ' ' + (c.text || '')).toLowerCase().indexOf(q) >= 0; });
  }

  function renderRows() {
    var rows = $('#rows');
    if (!rows) return;
    var vis = visibleCards();
    rows.innerHTML = vis.length ? vis.map(function (c) {
      var sel = state.selected.has(c.id);
      var sub = (c.text || '').split('\n')[0];
      return '<div class="card-row' + (sel ? ' sel' : '') + '" data-id="' + esc(c.id) + '">' +
        '<input type="checkbox" aria-label="Выбрать для печати"' + (sel ? ' checked' : '') + '>' +
        '<a class="card-open" href="#/edit/' + esc(c.id) + '">' +
          (c.photo ? photoImg(c, 'thumb') : '<span class="thumb">' + icon('image') + '</span>') +
          '<span class="card-meta"><b>' + esc(c.title || 'Без названия') + '</b>' +
          '<span>' + esc(sub ? sub + ' · ' : '') + esc(fmtDate(c.updated)) + '</span></span>' +
        '</a></div>';
    }).join('') : '<div class="empty">Ничего не найдено</div>';
    var n = state.selected.size;
    var btn = $('#printSel');
    btn.disabled = !n;
    btn.querySelector('span').textContent = n ? 'Печать (' + n + ')' : 'Печать';
    var all = vis.length && vis.every(function (c) { return state.selected.has(c.id); });
    $('#selAll').textContent = all ? 'Снять выбор' : 'Выбрать все';
  }

  // ---------- редактор ----------
  function cleanupEdit() {
    if (state.edit && state.edit.photoUrl) URL.revokeObjectURL(state.edit.photoUrl);
    state.edit = null;
  }

  function renderEditor(card, seq) {
    if (card === 'missing') {
      setTop({ title: 'Карточка', back: true });
      view.innerHTML = '<div class="empty"><b>Карточка не найдена</b>Возможно, её удалили с другого устройства.</div>';
      return;
    }
    var isNew = !card;
    var c = card ? Object.assign({}, card) : { id: makeId(), title: '', text: '', photo: '' };
    var ed = state.edit = { card: c, isNew: isNew, photoBlob: null, photoUrl: '', removePhoto: false, dirty: false };
    var url = GH.cardUrl(c.id);

    setTop({ title: isNew ? 'Новая карточка' : (c.title || 'Карточка'), back: true });
    view.innerHTML =
      '<div class="editor">' +
        '<div class="panel">' +
          '<label class="field"><span>Заголовок</span><input class="input" id="fTitle" maxlength="120" placeholder="Например: Кофемашина DeLonghi, инв. № 154"></label>' +
          '<label class="field"><span>Информация</span><textarea class="textarea" id="fText" placeholder="Описание, характеристики, контакты, ссылки — всё, что увидит человек после сканирования"></textarea></label>' +
          '<div class="field"><span>Фото</span>' +
            '<label class="photo-box" id="photoBox"><input type="file" accept="image/*" id="fPhoto" aria-label="Выбрать фото"><div id="photoInner"></div></label>' +
            '<div class="photo-actions"><button class="btn btn-ghost btn-danger" id="photoRemove" type="button">' + icon('trash') + 'Убрать фото</button></div>' +
          '</div>' +
          '<div class="actions">' +
            '<button class="btn btn-primary" id="save" type="button">Сохранить</button>' +
            (isNew ? '' : '<button class="btn btn-danger" id="del" type="button">' + icon('trash') + 'Удалить</button>') +
          '</div>' +
        '</div>' +
        '<aside class="side panel">' +
          '<div class="qr-preview">' + qrSvg(url, 2) + '</div>' +
          '<div class="qr-url">' + esc(url) + '</div>' +
          (isNew ? '<p class="note">Сохраните карточку — после этого QR можно печатать.</p>' : '') +
          '<div class="side-actions">' +
            '<a class="btn btn-primary" id="toPrint" href="#/print/' + esc(c.id) + '">' + icon('print') + 'Печать</a>' +
            '<button class="btn" id="png" type="button">' + icon('download') + 'Скачать QR картинкой</button>' +
            '<a class="btn" id="openView" href="' + esc(url) + '" target="_blank" rel="noopener">' + icon('open') + 'Открыть как после скана</a>' +
            '<button class="btn" id="copy" type="button">' + icon('copy') + 'Копировать ссылку</button>' +
          '</div>' +
        '</aside>' +
      '</div>';

    var fTitle = $('#fTitle'), fText = $('#fText'), fPhoto = $('#fPhoto');
    fTitle.value = c.title || '';
    fText.value = c.text || '';
    if (isNew) fTitle.focus();

    function markDirty() { ed.dirty = true; }
    fTitle.oninput = markDirty;
    fText.oninput = markDirty;

    // Для несохранённой карточки QR вёл бы в пустоту — блокируем действия.
    ['#toPrint', '#png', '#openView', '#copy'].forEach(function (s) {
      var el = $(s);
      if (isNew) { el.setAttribute('aria-disabled', 'true'); el.style.opacity = .5; el.style.pointerEvents = 'none'; }
    });

    function drawPhoto() {
      var inner = $('#photoInner'), has = ed.photoUrl || (c.photo && !ed.removePhoto);
      if (ed.photoUrl) inner.innerHTML = '<img src="' + ed.photoUrl + '" alt="">';
      else if (has) inner.innerHTML = photoImg(c, '');
      else inner.innerHTML = '<div style="padding:24px">' + icon('image').replace('<svg', '<svg width="36" height="36"') +
        '<div><b>Нажмите, чтобы добавить фото</b></div><div class="small">с телефона можно сразу сфотографировать</div></div>';
      $('#photoRemove').hidden = !has;
    }
    drawPhoto();

    fPhoto.onchange = async function () {
      var f = fPhoto.files && fPhoto.files[0];
      if (!f) return;
      busy('Обрабатываю фото…');
      try {
        var shot = await compressImage(f);
        if (!shot.blob) throw new Error('empty');
        if (ed.photoUrl) URL.revokeObjectURL(ed.photoUrl);
        ed.photoBlob = shot.blob;
        ed.photoSize = { w: shot.w, h: shot.h };
        ed.photoUrl = URL.createObjectURL(shot.blob);
        ed.removePhoto = false;
        markDirty();
        drawPhoto();
      } catch (e) {
        toast('Не удалось открыть это фото. Попробуйте JPG или PNG.', true);
      } finally {
        busy(false);
        fPhoto.value = '';
      }
    };
    $('#photoRemove').onclick = function () {
      if (ed.photoUrl) URL.revokeObjectURL(ed.photoUrl);
      ed.photoBlob = null; ed.photoUrl = '';
      ed.removePhoto = !!c.photo;
      markDirty();
      drawPhoto();
    };

    $('#save').onclick = async function () {
      c.title = fTitle.value.trim();
      c.text = fText.value.replace(/\s+$/, '');
      var hasPhoto = ed.photoBlob || (c.photo && !ed.removePhoto);
      if (!c.title && !c.text && !hasPhoto) { toast('Добавьте заголовок, текст или фото', true); return; }
      busy(isNew ? 'Создаю карточку…' : 'Сохраняю…');
      try {
        var photo = ed.photoBlob ? { base64: await blobToBase64(ed.photoBlob), w: ed.photoSize.w, h: ed.photoSize.h } : null;
        var saved = await GH.saveCard(c, photo, ed.removePhoto, isNew);
        var i = state.cards.findIndex(function (x) { return x.id === saved.id; });
        if (i >= 0) state.cards.splice(i, 1);
        state.cards.unshift(saved);
        ed.dirty = false;
        toast(isNew ? 'Карточка создана — QR можно печатать' : 'Сохранено. На сайте обновится примерно через минуту');
        go('#/edit/' + saved.id, true);
      } catch (e) {
        handleError(e);
      } finally {
        busy(false);
      }
    };

    var del = $('#del');
    if (del) del.onclick = async function () {
      if (!confirm('Удалить карточку «' + (c.title || c.id) + '»?\nНапечатанный QR перестанет показывать информацию.')) return;
      busy('Удаляю…');
      try {
        await GH.deleteCard(card);
        state.cards = state.cards.filter(function (x) { return x.id !== c.id; });
        state.selected.delete(c.id);
        toast('Карточка удалена');
        go('#/', true);
      } catch (e) {
        handleError(e);
      } finally {
        busy(false);
      }
    };

    $('#png').onclick = async function () {
      var blob = await qrPng(url, 1200);
      var name = 'qr-' + ((c.title || c.id).replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').slice(0, 40) || c.id) + '.png';
      var file = new File([blob], name, { type: 'image/png' });
      // На телефоне удобнее «Поделиться» (сохранить в галерею / отправить в мессенджер).
      if (matchMedia('(pointer: coarse)').matches && navigator.canShare && navigator.canShare({ files: [file] })) {
        try { await navigator.share({ files: [file], title: c.title || 'QR' }); return; }
        catch (e) { if (e.name === 'AbortError') return; }
      }
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = name;
      document.body.appendChild(a);
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    };

    $('#copy').onclick = function () {
      if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(url).then(function () { toast('Ссылка скопирована'); }, function () { prompt('Ссылка:', url); });
      } else {
        prompt('Ссылка:', url);
      }
    };
  }

  // ---------- печать ----------
  var PRINT_KEY = 'qr.print.v1';
  var SIZES = [25, 30, 40, 50, 60, 80, 100, 150]; // мм

  function renderPrint(ids) {
    var cards = ids.map(findCard).filter(Boolean);
    var back = ids.length === 1 ? '#/edit/' + ids[0] : '#/';
    setTop({ title: 'Печать', back: true, backHref: back });
    if (!cards.length) {
      view.innerHTML = '<div class="empty"><b>Нечего печатать</b>Отметьте карточки галочками в списке.</div>';
      return;
    }
    var p = Object.assign({ size: 50, copies: 1, caption: true, hint: false, cut: true }, readJson(PRINT_KEY));

    view.innerHTML =
      '<div class="panel no-print">' +
        '<div class="print-settings">' +
          '<label class="field"><span>Размер QR</span><select class="select" id="pSize">' +
            SIZES.map(function (s) { return '<option value="' + s + '"' + (s === +p.size ? ' selected' : '') + '>' + (s / 10).toString().replace('.', ',') + ' см</option>'; }).join('') +
          '</select></label>' +
          '<label class="field"><span>Копий каждой</span><input class="input" id="pCopies" type="number" min="1" max="500" inputmode="numeric" value="' + (+p.copies || 1) + '"></label>' +
        '</div>' +
        '<label class="check"><input type="checkbox" id="pCaption"' + (p.caption ? ' checked' : '') + '>Подпись под QR (заголовок)</label>' +
        '<label class="check"><input type="checkbox" id="pHint"' + (p.hint ? ' checked' : '') + '>Надпись «Наведите камеру телефона»</label>' +
        '<label class="check"><input type="checkbox" id="pCut"' + (p.cut ? ' checked' : '') + '>Пунктир для вырезания</label>' +
        '<p class="muted small" id="pInfo"></p>' +
        '<button class="btn btn-primary btn-block" id="doPrint" type="button">' + icon('print') + 'Печать</button>' +
        '<p class="muted small" style="margin-bottom:0">В окне печати выберите принтер или «Сохранить как PDF». ' +
        'Масштаб оставьте <b>100%</b> (не «По размеру страницы») — тогда QR будет ровно выбранного размера.</p>' +
      '</div>' +
      '<div class="paper-scroller"><div class="paper"><div class="sheet" id="sheet"></div></div></div>';

    var svgCache = {};
    function draw() {
      p = {
        size: +$('#pSize').value,
        copies: Math.min(500, Math.max(1, parseInt($('#pCopies').value, 10) || 1)),
        caption: $('#pCaption').checked, hint: $('#pHint').checked, cut: $('#pCut').checked
      };
      writeJson(PRINT_KEY, p);
      var sheet = $('#sheet');
      sheet.style.setProperty('--qr', p.size + 'mm');
      sheet.classList.toggle('cut', p.cut);
      var html = '';
      cards.forEach(function (c) {
        var svg = svgCache[c.id] || (svgCache[c.id] = qrSvg(GH.cardUrl(c.id), 2));
        var label = '<div class="label">' + svg +
          (p.caption && c.title ? '<div class="cap">' + esc(c.title) + '</div>' : '') +
          (p.hint ? '<div class="hint">Наведите камеру телефона</div>' : '') + '</div>';
        for (var i = 0; i < p.copies; i++) html += label;
      });
      sheet.innerHTML = html;

      // Примерная оценка, сколько влезет на А4 (рабочая область 190×277 мм).
      var cell = p.size + 6;
      var capH = (p.caption ? Math.max(2.6, p.size * 0.085) * 1.2 + 1.5 : 0) + (p.hint ? Math.max(2.2, p.size * 0.06) * 1.2 + 0.6 : 0);
      var perRow = Math.max(1, Math.floor(190 / cell));
      var perPage = perRow * Math.max(1, Math.floor(277 / (cell + capH)));
      var total = cards.length * p.copies;
      $('#pInfo').textContent = 'Всего ' + total + ' шт. · до ' + perPage + ' на листе A4 · примерно ' + Math.ceil(total / perPage) + ' лист(ов)';
      fitPaper();
    }
    ['#pSize', '#pCopies', '#pCaption', '#pHint', '#pCut'].forEach(function (s) { $(s).oninput = draw; $(s).onchange = draw; });
    $('#doPrint').onclick = function () { window.print(); };
    draw();
  }

  // Превью листа A4 уменьшаем под ширину экрана (на телефоне лист шире экрана).
  function fitPaper() {
    var sc = $('.paper-scroller');
    if (!sc) return;
    var paper = $('.paper', sc);
    paper.style.transform = '';
    var k = Math.min(1, sc.clientWidth / paper.offsetWidth);
    paper.style.transform = k < 1 ? 'scale(' + k + ')' : '';
    sc.style.height = Math.ceil(paper.offsetHeight * k) + 'px';
  }

  // Телефон подключается по QR с компьютера: admin.html#connect=<ключ>.
  // Ключ сразу убираем из адресной строки и истории браузера.
  var connectMatch = /^#connect=([\w%-]+)$/.exec(location.hash);
  if (connectMatch) {
    GH.setToken(decodeURIComponent(connectMatch[1]));
    history.replaceState(null, '', location.pathname + location.search + '#/');
    lastHash = location.hash;
    toast('Телефон подключён');
  }

  route();
})();
