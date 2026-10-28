/* ==========================================================================
   Trek Fit — shell.js
   Оболочка-переходник:
   1) мобильная левая панель (drawer);
   2) сборка вкладок из pages/*.html в #view;
   3) запуск app.js после того, как разметка вкладок уже в DOM;
   4) hash-роутинг (#/workouts) и хлебные крошки.
   ========================================================================== */
(function () {
  'use strict';

  var TABS = ['home', 'workouts', 'weight', 'calc', 'nutrition', 'records', 'profile'];

  var view = document.getElementById('view');
  var shell = document.getElementById('shell');
  var side = document.getElementById('app-side');
  var scrim = document.getElementById('app-scrim');
  var burger = document.getElementById('app-burger');
  var crumb = document.getElementById('app-crumb');
  var titleEl = document.getElementById('page-title');

  /* ---------- 1. Левая панель на телефоне ---------- */
  function openSide() {
    if (!side) return;
    side.classList.add('open');
    if (scrim) scrim.classList.add('show');
    if (burger) burger.setAttribute('aria-expanded', 'true');
  }

  function closeSide() {
    if (side && side.classList.contains('open')) {
      side.classList.remove('open');
      if (scrim) scrim.classList.remove('show');
      if (burger) burger.setAttribute('aria-expanded', 'false');
    }
  }

  if (burger) {
    burger.addEventListener('click', function () {
      if (side && side.classList.contains('open')) closeSide();
      else openSide();
    });
  }

  if (scrim) scrim.addEventListener('click', closeSide);

  document.addEventListener('click', function (e) {
    if (e.target.closest('[data-nav]') || e.target.closest('[data-goto]')) closeSide();
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') closeSide();
  });

  window.addEventListener('resize', function () {
    if (window.innerWidth > 980) closeSide();
  });

  /* ---------- 2. Хлебные крошки ---------- */
  function syncCrumb() {
    if (!crumb || !titleEl) return;
    var t = (titleEl.textContent || '').trim();
    crumb.textContent = t;
    document.title = t ? 'Trek Fit — ' + t : 'Trek Fit';
    var activeNav = document.querySelector('.nav-item.active');
    if (activeNav && activeNav.dataset.nav) document.body.dataset.tab = activeNav.dataset.nav;
  }

  if (crumb && titleEl) {
    if (window.MutationObserver) {
      new MutationObserver(syncCrumb).observe(titleEl, {
        childList: true,
        characterData: true,
        subtree: true
      });
    }
    syncCrumb();
  }

  /* ---------- 3. Hash-роутинг ---------- */
  var HASH_RE = /^#\/?([a-z]+)$/;

  document.addEventListener('click', function (e) {
    var nav = e.target.closest('[data-nav]');
    var go = e.target.closest('[data-goto]');
    var name = nav ? nav.dataset.nav : (go ? go.dataset.goto : null);
    if (!name) return;
    try {
      history.replaceState(null, '', '#/' + name);
    } catch (_) { /* file:// — просто игнорируем */ }
  });

  function goHash() {
    var m = HASH_RE.exec(location.hash || '');
    if (!m || TABS.indexOf(m[1]) < 0) return;
    var btn = document.querySelector('[data-nav="' + m[1] + '"]');
    if (btn) btn.click();
  }

  /* ---------- 4. Сборка вкладок и запуск приложения ---------- */
  function fail(msg) {
    if (!view) return;
    view.innerHTML =
      '<div class="card" style="max-width:600px;margin:24px auto">' +
        '<div class="eyebrow">Вкладки не загрузились</div>' +
        '<p class="sub" style="margin-top:8px">' + msg + '</p>' +
        '<p class="sub" style="margin-top:12px">Оболочка собирает вкладки из <code>pages/*.html</code> через ' +
        '<code>fetch</code>, поэтому страницу нужно открывать по http(s), а не двойным щелчком по файлу. ' +
        'Запусти в папке проекта <code>npx serve</code> или <code>python -m http.server 8080</code> ' +
        'и открой <code>http://localhost:8080/index2.html</code>.</p>' +
      '</div>';
    if (shell) shell.classList.remove('hidden');
    if (titleEl) {
      titleEl.textContent = 'Ошибка загрузки';
      var sub = document.getElementById('page-sub');
      if (sub) sub.textContent = 'Проверь локальный сервер';
    }
  }

  if (!view) return;

  Promise.all(TABS.map(function (tab) {
    return fetch('pages/' + tab + '.html', { cache: 'no-cache' }).then(function (res) {
      if (!res.ok) throw new Error('pages/' + tab + '.html → HTTP ' + res.status);
      return res.text();
    });
  })).then(function (parts) {
    view.innerHTML = parts.join('\n');
    view.classList.remove('view-loading');
    var s = document.createElement('script');
    s.src = 'app.js';
    s.onload = function () {
      goHash();
      window.addEventListener('hashchange', goHash);
    };
    s.onerror = function () {
      fail('Файл <code>app.js</code> не найден или не загрузился.');
    };
    document.body.appendChild(s);
  }).catch(function (err) {
    fail(err && err.message ? err.message : 'Неизвестная ошибка');
  });
})();
