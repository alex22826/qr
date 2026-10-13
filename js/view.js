/* Страница, которую видит человек после сканирования QR: index.html?c=<id> */
(function () {
  'use strict';

  var app = document.getElementById('app');
  var id = (new URLSearchParams(location.search).get('c') || '').toLowerCase();

  // Без кода карточки здесь делать нечего — ведём в админку.
  if (!id) { location.replace('admin.html'); return; }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }

  // Превращает телефоны в кликабельные ссылки tel:.
  // html — уже экранированный текст; в нём могут быть <a>-теги от ссылок и почты.
  // Должна вернуть html, где номер обёрнут в <a href="tel:+998901234567">+998 90 123-45-67</a>.
  function linkPhones(html) {
    // TODO: распознавание номеров телефонов (см. объяснение в чате)
    return html;
  }

  // Ссылки, почта и телефоны в тексте становятся кликабельными.
  function linkify(text) {
    var html = esc(text);
    html = html.replace(/(^|[\s(:;,])((?:https?:\/\/|www\.)[^\s<]+[^\s<.,;:!?)'"])/gi, function (m, pre, url) {
      var href = /^www\./i.test(url) ? 'https://' + url : url;
      return pre + '<a href="' + href + '" target="_blank" rel="noopener">' + url + '</a>';
    });
    html = html.replace(/(^|[\s(:;,])([\w.+-]+@[\w-]+(?:\.[\w-]+)+)/g, '$1<a href="mailto:$2">$2</a>');
    return linkPhones(html);
  }

  function getJson(url) {
    return fetch(url, { cache: 'no-store' }).then(function (r) {
      if (!r.ok) throw new Error(r.status);
      return r.json();
    });
  }

  function showMessage(title, text) {
    app.innerHTML =
      '<div class="v-empty">' +
        '<div class="v-empty-icon" aria-hidden="true">' +
          '<svg viewBox="0 0 24 24" width="40" height="40"><path fill="currentColor" d="M3 3h8v8H3V3zm2 2v4h4V5H5zm8-2h8v8h-8V3zm2 2v4h4V5h-4zM3 13h8v8H3v-8zm2 2v4h4v-4H5zm13-2h3v3h-3v-3zm-5 0h3v3h-3v-3zm3 3h2v2h-2v-2zm-3 3h3v2h-3v-2zm5 0h3v2h-3v-2z"/></svg>' +
        '</div>' +
        '<h1>' + esc(title) + '</h1><p>' + esc(text) + '</p>' +
      '</div>';
  }

  function render(card) {
    document.title = card.title || 'Карточка';
    var html = '<article class="v-card">';
    if (card.photo) {
      html += '<a class="v-photo" href="' + esc(card.photo) + '" target="_blank" rel="noopener">' +
        '<img src="' + esc(card.photo) + '" alt="' + esc(card.title || '') + '" decoding="async"></a>';
    }
    html += '<div class="v-body">';
    if (card.title) html += '<h1 class="v-title">' + esc(card.title) + '</h1>';
    if (card.text) html += '<div class="v-text">' + linkify(card.text) + '</div>';
    html += '</div></article>';
    app.innerHTML = html;

    // Только что загруженного фото на Pages может ещё не быть — берём его из репозитория напрямую.
    var img = app.querySelector('.v-photo img');
    if (img) {
      img.addEventListener('error', function onErr() {
        img.removeEventListener('error', onErr);
        img.src = GH.RAW_BASE + card.photo;
        img.parentNode.href = img.src;
      });
    }
  }

  if (!/^[a-z0-9]{3,32}$/.test(id)) {
    showMessage('Код не распознан', 'Похоже, QR-код повреждён. Попробуйте отсканировать ещё раз.');
    return;
  }

  // Сначала Pages (быстро, CDN). Свежей карточки там может ещё не быть
  // (сайт пересобирается ~1 минуту) — тогда читаем прямо из репозитория.
  var bust = '?t=' + Date.now();
  getJson('cards/' + id + '.json' + bust)
    .catch(function () { return getJson(GH.RAW_BASE + 'cards/' + id + '.json' + bust); })
    .then(render)
    .catch(function () {
      showMessage('Карточка не найдена', 'Возможно, её удалили. Если QR-код только что создан — подождите минуту и обновите страницу.');
    });
})();
