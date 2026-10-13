/* Слой данных: репозиторий GitHub работает как база.
   Карточка — cards/<id>.json, фото — photos/<id>-<время>.jpg.
   Каждое сохранение — ОДИН коммит через Git Data API, чтобы карточка и фото
   появлялись на сайте одновременно (и Pages пересобирался один раз). */
(function (root) {
  'use strict';

  var API = 'https://api.github.com';
  var BRANCH = 'main';
  var TOKEN_KEY = 'qr.token';
  var CACHE_KEY = 'qr.cache.v1';

  // Владелец и репозиторий берутся из адреса <owner>.github.io/<repo>/,
  // локально (localhost) — значения по умолчанию.
  function detectRepo() {
    var m = /^([^.]+)\.github\.io$/i.exec(root.location.hostname);
    var seg = root.location.pathname.split('/').filter(Boolean)[0];
    if (m && seg && !/\.html?$/i.test(seg)) return { owner: m[1].toLowerCase(), repo: seg };
    return { owner: 'alex22826', repo: 'qr' };
  }

  var REPO = detectRepo();
  var PAGES_BASE = 'https://' + REPO.owner + '.github.io/' + REPO.repo + '/';
  var RAW_BASE = 'https://raw.githubusercontent.com/' + REPO.owner + '/' + REPO.repo + '/' + BRANCH + '/';
  var REPO_PATH = '/repos/' + REPO.owner + '/' + REPO.repo;

  function lsGet(key) { try { return root.localStorage.getItem(key); } catch (e) { return null; } }
  function lsSet(key, val) {
    try { if (val == null) root.localStorage.removeItem(key); else root.localStorage.setItem(key, val); } catch (e) { /* приватный режим */ }
  }

  function getToken() { return (lsGet(TOKEN_KEY) || '').trim(); }
  function setToken(t) { lsSet(TOKEN_KEY, t ? String(t).trim() : null); if (!t) lsSet(CACHE_KEY, null); }

  // ---------- base64 / UTF-8 ----------
  function bytesToBase64(bytes) {
    var s = '';
    for (var i = 0; i < bytes.length; i += 0x8000) {
      s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    }
    return btoa(s);
  }
  function textToBase64(str) { return bytesToBase64(new TextEncoder().encode(str)); }
  function base64ToText(b64) {
    var bin = atob(String(b64).replace(/\s/g, ''));
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }

  // ---------- запросы ----------
  function humanError(status, msg) {
    if (status === 401) return 'Токен не подходит или истёк. Создайте новый и вставьте заново.';
    if (status === 403 && /rate limit/i.test(msg)) return 'GitHub временно ограничил число запросов. Подождите пару минут.';
    if (status === 403) return 'У токена нет права записи. Нужно разрешение Contents: Read and write для репозитория ' + REPO.owner + '/' + REPO.repo + '.';
    if (status === 404) return 'Репозиторий ' + REPO.owner + '/' + REPO.repo + ' не найден, или токен не даёт к нему доступа.';
    if (status === 0) return 'Нет связи с GitHub. Проверьте интернет.';
    return 'Ошибка GitHub (' + status + '): ' + msg;
  }

  async function api(path, opts) {
    opts = opts || {};
    var headers = {
      'Accept': 'application/vnd.github+json',
      'Authorization': 'Bearer ' + (opts.token || getToken()),
      'X-GitHub-Api-Version': '2022-11-28'
    };
    if (opts.body) headers['Content-Type'] = 'application/json';
    var res;
    try {
      res = await fetch(API + path, {
        method: opts.method || 'GET',
        headers: headers,
        body: opts.body ? JSON.stringify(opts.body) : undefined,
        cache: 'no-store'
      });
    } catch (e) {
      var ne = new Error(humanError(0)); ne.status = 0; throw ne;
    }
    if (res.status === 404 && opts.allow404) return null;
    if (!res.ok) {
      var msg = '';
      try { msg = (await res.json()).message || ''; } catch (e) { /* не JSON */ }
      var err = new Error(humanError(res.status, msg));
      err.status = res.status;
      err.raw = msg;
      throw err;
    }
    return res.status === 204 ? null : res.json();
  }

  // Проверка токена: репозиторий должен открываться этим токеном.
  // Право записи по-настоящему проверится при первом сохранении.
  async function checkToken(token) {
    var repo = await api(REPO_PATH, { token: token });
    return repo.full_name;
  }

  // ---------- кэш карточек по sha блоба ----------
  function loadCache() {
    try { return JSON.parse(lsGet(CACHE_KEY) || '{}'); } catch (e) { return {}; }
  }
  function saveCache(c) { lsSet(CACHE_KEY, JSON.stringify(c)); }

  async function getBlobText(sha) {
    var blob = await api(REPO_PATH + '/git/blobs/' + sha);
    return base64ToText(blob.content);
  }

  // Параллельно, но не больше limit запросов одновременно.
  async function pool(items, limit, fn) {
    var out = new Array(items.length), i = 0;
    async function worker() {
      while (i < items.length) { var k = i++; out[k] = await fn(items[k], k); }
    }
    var workers = [];
    for (var w = 0; w < Math.min(limit, items.length); w++) workers.push(worker());
    await Promise.all(workers);
    return out;
  }

  // Все карточки. Неизменённые берутся из кэша (по sha), так что
  // повторная загрузка списка — это обычно один запрос к GitHub.
  async function listCards() {
    var files = await api(REPO_PATH + '/contents/cards?ref=' + BRANCH, { allow404: true }) || [];
    var cache = loadCache(), fresh = {};
    var jsonFiles = files.filter(function (f) { return f.type === 'file' && /\.json$/.test(f.name); });
    var cards = await pool(jsonFiles, 6, async function (f) {
      var card = cache[f.sha];
      if (!card) {
        try { card = JSON.parse(await getBlobText(f.sha)); } catch (e) { return null; }
      }
      fresh[f.sha] = card;
      return card;
    });
    saveCache(fresh);
    return cards.filter(Boolean).sort(function (a, b) {
      return String(b.updated || '').localeCompare(String(a.updated || ''));
    });
  }

  // files: [{ path, base64 }] — записать, [{ path, remove: true }] — удалить.
  async function commit(files, message) {
    // Блобы не зависят от состояния ветки — создаём их один раз.
    var entries = await pool(files, 3, async function (f) {
      if (f.remove) return { path: f.path, mode: '100644', type: 'blob', sha: null };
      var b = await api(REPO_PATH + '/git/blobs', { method: 'POST', body: { content: f.base64, encoding: 'base64' } });
      return { path: f.path, mode: '100644', type: 'blob', sha: b.sha };
    });
    // Если в это же время сохраняли с другого устройства, ветка «уедет» —
    // тогда пересобираем коммит поверх свежей версии.
    for (var attempt = 0; ; attempt++) {
      var ref = await api(REPO_PATH + '/git/ref/heads/' + BRANCH);
      var parent = await api(REPO_PATH + '/git/commits/' + ref.object.sha);
      var tree = await api(REPO_PATH + '/git/trees', { method: 'POST', body: { base_tree: parent.tree.sha, tree: entries } });
      var c = await api(REPO_PATH + '/git/commits', {
        method: 'POST', body: { message: message, tree: tree.sha, parents: [ref.object.sha] }
      });
      try {
        await api(REPO_PATH + '/git/refs/heads/' + BRANCH, { method: 'PATCH', body: { sha: c.sha } });
        return { commit: c.sha, entries: entries };
      } catch (e) {
        if (e.status === 422 && attempt < 3) continue;
        throw e;
      }
    }
  }

  function cardPath(id) { return 'cards/' + id + '.json'; }

  // card — объект карточки; photo — { base64 } нового фото или null;
  // removePhoto — убрать текущее фото.
  async function saveCard(card, photo, removePhoto, isNew) {
    var files = [];
    var oldPhoto = card.photo || '';
    var next = Object.assign({}, card, { updated: new Date().toISOString() });
    if (!next.created) next.created = next.updated;

    if (photo) {
      next.photo = 'photos/' + card.id + '-' + Date.now().toString(36) + '.jpg';
      files.push({ path: next.photo, base64: photo.base64 });
    } else if (removePhoto) {
      next.photo = '';
    }
    if (oldPhoto && oldPhoto !== next.photo) files.push({ path: oldPhoto, remove: true });

    files.unshift({ path: cardPath(card.id), base64: textToBase64(JSON.stringify(next, null, 2) + '\n') });
    var res = await commit(files, (isNew ? 'Новая карточка: ' : 'Изменена карточка: ') + (next.title || next.id));

    // Кладём сохранённую карточку в кэш под sha её блоба — список не будет её перекачивать.
    var cache = loadCache();
    cache[res.entries[0].sha] = next;
    saveCache(cache);
    return next;
  }

  async function deleteCard(card) {
    var files = [{ path: cardPath(card.id), remove: true }];
    if (card.photo) files.push({ path: card.photo, remove: true });
    await commit(files, 'Удалена карточка: ' + (card.title || card.id));
  }

  root.GH = {
    REPO: REPO,
    PAGES_BASE: PAGES_BASE,
    RAW_BASE: RAW_BASE,
    getToken: getToken,
    setToken: setToken,
    checkToken: checkToken,
    listCards: listCards,
    saveCard: saveCard,
    deleteCard: deleteCard,
    // Адрес, который зашивается в QR: всегда публичный сайт, даже если админка открыта локально.
    cardUrl: function (id) { return PAGES_BASE + '?c=' + id; },
    // raw.githubusercontent обновляется сразу после коммита, Pages — через ~1 минуту.
    photoUrl: function (card) { return card && card.photo ? RAW_BASE + card.photo : ''; },
    pagesPhotoUrl: function (card) { return card && card.photo ? PAGES_BASE + card.photo : ''; }
  };
})(typeof window !== 'undefined' ? window : globalThis);
