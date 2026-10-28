(function () {
  'use strict';

  /* ============================================================
     0. Утилиты
     ============================================================ */
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const nf = new Intl.NumberFormat('ru-RU');
  const nf1 = new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (_) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (_) {} },
    del(k) { try { localStorage.removeItem(k); } catch (_) {} }
  };
  const round = (v, d) => { const p = Math.pow(10, d || 0); return Math.round(v * p) / p; };

  /* ============================================================
     1. Telegram + Haptic Feedback
     ============================================================ */
  const tg = (window.Telegram && window.Telegram.WebApp) || null;
  try { tg && tg.ready(); tg && tg.expand(); } catch (_) {}
  try {
    tg && tg.setHeaderColor && tg.setHeaderColor('#080b12');
    tg && tg.setBackgroundColor && tg.setBackgroundColor('#080b12');
  } catch (_) {}

  function haptic(type) {
    try {
      if (!tg || !tg.HapticFeedback) return;
      if (type === 'ok' || type === 'err') {
        tg.HapticFeedback.notificationOccurred(type === 'ok' ? 'success' : 'error');
      } else if (type === 'select') {
        tg.HapticFeedback.selectionChanged();
      } else {
        tg.HapticFeedback.impactOccurred(type || 'light');
      }
    } catch (_) {}
  }

  const initData = (tg && tg.initData) || '';
  const isTelegram = !!initData;
  const tgUser = (tg && tg.initDataUnsafe && tg.initDataUnsafe.user) || null;
  let syncCode = store.get('trek_sync_code');

  /* ============================================================
     2. Supabase + api() с таймаутом и повтором
     ============================================================ */
  const SUPABASE_URL = 'https://xxauwkymufehmoprmhay.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_ABzZaqdreTP8pe6L3fMFRA_kYo6J81W';
  let sb = null;
  try { sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY); }
  catch (e) { console.error('Supabase SDK не загрузился', e); }

  function withTimeout(promise, ms, label) {
    return Promise.race([
      promise,
      new Promise((_, reject) => setTimeout(() => reject(new Error(label || 'Сервер не ответил за 15 секунд')), ms))
    ]);
  }

  async function api(action, payload) {
    if (!sb) throw new Error('Нет связи с сервером');
    const body = { initData: initData, syncCode: syncCode, action: action, payload: payload || {} };
    const call = sb.functions.invoke('telegram-api', { body: body });
    const res = await withTimeout(call, 15000);
    const data = res && res.data;
    const error = res && res.error;
    if (error) {
      // Supabase отдаёт причину в теле ответа — показываем её, а не «non-2xx»
      let msg = error.message || 'Ошибка запроса';
      try {
        if (error.context && typeof error.context.json === 'function') {
          const parsed = await error.context.json();
          if (parsed && parsed.error) msg = parsed.error;
        }
      } catch (_) {}
      throw new Error(msg);
    }
    if (data && data.error) throw new Error(data.error);
    return data || {};
  }

  async function apiRetry(action, payload) {
    try { return await api(action, payload); }
    catch (e) {
      if (!/за 15 секунд|Failed to fetch|NetworkError/i.test(String(e.message))) throw e;
      return api(action, payload);
    }
  }

  /* ============================================================
     3. Каталог упражнений
     ============================================================ */
  const GROUPS = {
    chest: 'Грудь', back: 'Спина', shoulders: 'Плечи', biceps: 'Бицепс',
    triceps: 'Трицепс', legs: 'Ноги', abs: 'Пресс', cardio: 'Кардио'
  };

  const EXERCISES = {
    chest: ['Жим лёжа', 'Жим гантелей лёжа', 'Жим на наклонной скамье', 'Разводка гантелей', 'Сведение рук в тренажёре', 'Отжимания', 'Отжимания на брусьях'],
    back: ['Подтягивания', 'Тяга верхнего блока', 'Тяга горизонтального блока', 'Тяга штанги в наклоне', 'Тяга гантели одной рукой', 'Гиперэкстензия', 'Становая тяга'],
    shoulders: ['Жим штанги стоя', 'Жим гантелей сидя', 'Махи гантелями в стороны', 'Махи гантелями перед собой', 'Разведение в наклоне', 'Шраги'],
    biceps: ['Подъём штанги на бицепс', 'Подъём гантелей на бицепс', 'Молотки', 'Сгибание рук на скамье Скотта', 'Сгибание рук в блоке'],
    triceps: ['Французский жим', 'Разгибание на блоке', 'Отжимания узким хватом', 'Разгибание гантели из-за головы'],
    legs: ['Приседания со штангой', 'Жим ногами', 'Разгибание ног', 'Сгибание ног', 'Румынская тяга', 'Выпады', 'Подъём на носки'],
    abs: ['Скручивания', 'Подъём ног', 'Планка', 'Велосипед', 'Скручивания на блоке'],
    cardio: ['Бег', 'Ходьба', 'Велотренажёр', 'Эллипсоид', 'Гребля', 'Скакалка']
  };

  const EX_GROUP = {};
  Object.keys(EXERCISES).forEach(g => EXERCISES[g].forEach(n => { EX_GROUP[n] = g; }));

  const OTHER = '__other__';

  /* ============================================================
     4. Даты (локальное время, без сюрпризов UTC)
     ============================================================ */
  function parseDate(v) {
    if (v instanceof Date) return v;
    if (typeof v === 'number') return new Date(v);
    if (!v) return new Date(NaN);
    const s = String(v).trim();
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?$/);
    if (m) return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0));
    return new Date(s);
  }

  const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
  const dayKey = (d) => {
    const x = startOfDay(d);
    return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0');
  };
  const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  const sameDay = (a, b) => dayKey(a) === dayKey(b);

  function fmtDay(d) {
    const now = new Date();
    if (sameDay(d, now)) return 'Сегодня';
    if (sameDay(d, addDays(now, -1))) return 'Вчера';
    return parseDate(d).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
  }
  function fmtShort(d) {
    return parseDate(d).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }).replace('.', '');
  }

  /* ============================================================
     5. Расчёты
     ============================================================ */
  const num = (v) => (v === '' || v === null || v === undefined || isNaN(Number(v))) ? null : Number(v);
  const e1rm = (w, r) => (w > 0 && r > 0) ? (r === 1 ? w : w * (1 + r / 30)) : 0;
  const setCount = (w) => (num(w.sets) || 1);

  function setWeights(entries) {
    state.weights = (entries || []).slice().sort((a, b) => parseDate(b.logged_at) - parseDate(a.logged_at));
  }

  function currentWeight() {
    if (state.weights.length) return num(state.weights[0].weight_kg);
    return state.profile ? num(state.profile.weight_kg) : null;
  }

  // Норма белка: 1,6–2,2 г/кг, для прогресс-бара берём 1,8 г/кг
  function proteinTarget(w) {
    const weight = w || currentWeight();
    if (!weight) return null;
    return { min: Math.round(weight * 1.6), max: Math.round(weight * 2.2), goal: Math.round(weight * 1.8) };
  }

  // Вода: 30–35 мл/кг, для бара — 33 мл/кг
  function waterTarget(w) {
    const weight = w || currentWeight();
    if (!weight) return null;
    return { min: Math.round(weight * 30), max: Math.round(weight * 35), goal: Math.round(weight * 33) };
  }

  function streak() {
    const days = new Set(state.workouts.map(w => dayKey(parseDate(w.logged_at))));
    let d = new Date();
    if (!days.has(dayKey(d))) d = addDays(d, -1);
    let n = 0;
    while (days.has(dayKey(d))) { n++; d = addDays(d, -1); }
    return n;
  }

  function weekCount() {
    const since = startOfDay(addDays(new Date(), -6));
    return new Set(
      state.workouts
        .filter(w => parseDate(w.logged_at) >= since)
        .map(w => dayKey(parseDate(w.logged_at)))
    ).size;
  }

  function sessions(list) {
    const map = new Map();
    (list || state.workouts).forEach(w => {
      const dt = parseDate(w.logged_at);
      const k = dayKey(dt);
      if (!map.has(k)) map.set(k, { key: k, date: startOfDay(dt), rows: [], sets: 0, groups: new Set() });
      const s = map.get(k);
      s.rows.push(w);
      s.sets += setCount(w);
      if (w.muscle_group) s.groups.add(w.muscle_group);
    });
    return Array.from(map.values()).sort((a, b) => b.date - a.date);
  }

  function muscleBalance(days) {
    const since = startOfDay(addDays(new Date(), -((days || 30) - 1)));
    const acc = {};
    Object.keys(GROUPS).forEach(g => { acc[g] = 0; });
    state.workouts.forEach(w => {
      if (parseDate(w.logged_at) < since) return;
      const g = w.muscle_group || 'other';
      acc[g] = (acc[g] || 0) + setCount(w);
    });
    const total = Object.values(acc).reduce((a, b) => a + b, 0);
    return { total: total, rows: Object.keys(acc).map(g => ({ group: g, name: GROUPS[g] || g, sets: acc[g] })).sort((a, b) => b.sets - a.sets) };
  }

  function weeklySets(weeks) {
    const n = weeks || 8;
    const out = [];
    const today = startOfDay(new Date());
    for (let i = n - 1; i >= 0; i--) {
      const anchor = addDays(today, -7 * i);
      const dow = (anchor.getDay() + 6) % 7;
      const start = addDays(anchor, -dow);
      const end = addDays(start, 6);
      out.push({ start: start, end: end, sets: 0 });
    }
    state.workouts.forEach(w => {
      const dt = parseDate(w.logged_at);
      const bucket = out.find(b => dt >= b.start && dt < addDays(b.end, 1));
      if (!bucket) return;
      bucket.sets += setCount(w);
    });
    return out;
  }

  function markPRs() {
    const asc = state.workouts.slice().sort((a, b) => parseDate(a.logged_at) - parseDate(b.logged_at));
    const best = new Map();
    asc.forEach(w => {
      const key = String(w.exercise || '').trim().toLowerCase();
      if (!key) return;
      const v = e1rm(num(w.weight_kg) || 0, num(w.reps) || 0);
      if (!v) return;
      const prev = best.get(key) || 0;
      w._pr = prev > 0 && v > prev + 0.05;
      if (v > prev) best.set(key, v);
      w._e1rm = v;
    });
  }

  function findLastForExercise(name) {
    if (!name) return null;
    const key = String(name).trim().toLowerCase();
    const sorted = state.workouts.slice().sort((a, b) => parseDate(b.logged_at) - parseDate(a.logged_at));
    return sorted.find(w => String(w.exercise || '').trim().toLowerCase() === key) || null;
  }

  function weightSeries(range) {
    let arr = state.weights.slice().sort((a, b) => parseDate(a.logged_at) - parseDate(b.logged_at));
    if (range && range !== 'all') {
      const since = startOfDay(addDays(new Date(), -(Number(range) - 1)));
      arr = arr.filter(e => parseDate(e.logged_at) >= since);
    }
    return arr;
  }

  function movingAverage(arr, size) {
    return arr.map((_, i) => {
      const from = Math.max(0, i - size + 1);
      const slice = arr.slice(from, i + 1);
      return slice.reduce((s, e) => s + (num(e.weight_kg) || 0), 0) / slice.length;
    });
  }

  function weekRate() {
    const arr = state.weights.slice()
      .sort((a, b) => parseDate(a.logged_at) - parseDate(b.logged_at))
      .filter(e => parseDate(e.logged_at) >= startOfDay(addDays(new Date(), -13)));
    if (arr.length < 2) return null;
    const first = arr[0], last = arr[arr.length - 1];
    const days = Math.max(1, (parseDate(last.logged_at) - parseDate(first.logged_at)) / 864e5);
    return { perWeek: ((num(last.weight_kg) - num(first.weight_kg)) / days) * 7, days: Math.round(days) };
  }

  /* ============================================================
     6. Состояние и таймер отдыха
     ============================================================ */
  const state = {
    profile: null,
    workouts: [],
    weights: [],
    tab: 'home',
    filter: '',
    query: '',
    range: { home: '30', weight: '30' }
  };
  const charts = { home: null, weight: null, volume: null };

  let restInterval = null;
  let restEndsAt = 0;
  let restDuration = Number(store.get('trek_rest_sec')) || 90;
  let restLongPress = null;
  let restLongFired = false;
  let audioCtx = null;

  function restLabel(sec) {
    const s = Math.max(0, Math.round(sec));
    return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
  }

  // Короткий двойной «бип» на Web Audio — без внешних файлов
  function beep() {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      audioCtx = audioCtx || new Ctx();
      if (audioCtx.state === 'suspended' && audioCtx.resume) audioCtx.resume();
      const t0 = audioCtx.currentTime;
      [880, 1174].forEach((freq, i) => {
        const start = t0 + i * 0.19;
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.exponentialRampToValueAtTime(0.22, start + 0.012);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.17);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start(start);
        osc.stop(start + 0.19);
      });
    } catch (_) {}
  }

  function buzz(pattern) {
    try { if (navigator.vibrate) navigator.vibrate(pattern || [180, 90, 180]); } catch (_) {}
  }

  function startRestTimer(seconds) {
    const btn = $('#rest-timer');
    const valEl = $('#rest-timer-val');
    if (!btn || !valEl) return;
    restDuration = Number(seconds) || restDuration || 90;
    store.set('trek_rest_sec', String(restDuration));
    restEndsAt = Date.now() + restDuration * 1000;
    btn.classList.remove('hidden');
    hideRestPresets();

    function tick() {
      const rem = Math.max(0, Math.ceil((restEndsAt - Date.now()) / 1000));
      valEl.textContent = restLabel(rem);
      if (rem <= 0) {
        stopRestTimer();
        haptic('ok');
        buzz([200, 100, 200]);
        beep();
        toast('Отдых окончен — пора в подход!', 'ok');
      }
    }
    clearInterval(restInterval);
    tick();
    restInterval = setInterval(tick, 500);
  }

  function stopRestTimer() {
    clearInterval(restInterval);
    restInterval = null;
    const btn = $('#rest-timer');
    if (btn) btn.classList.add('hidden');
    hideRestPresets();
  }

  function showRestPresets() {
    const box = $('#timer-presets');
    if (!box) return;
    box.classList.remove('hidden');
    $$('#timer-presets button').forEach(b => {
      b.classList.toggle('active', Number(b.dataset.rest) === restDuration);
      b.style.color = Number(b.dataset.rest) === restDuration ? 'var(--accent)' : '';
    });
  }
  function hideRestPresets() {
    const box = $('#timer-presets');
    if (box) box.classList.add('hidden');
  }

  if ($('#rest-timer')) {
    const btn = $('#rest-timer');
    btn.addEventListener('pointerdown', () => {
      restLongFired = false;
      clearTimeout(restLongPress);
      restLongPress = setTimeout(() => {
        restLongFired = true;
        haptic('select');
        showRestPresets();
      }, 520);
    });
    ['pointerup', 'pointerleave', 'pointercancel'].forEach(ev => {
      btn.addEventListener(ev, () => clearTimeout(restLongPress));
    });
    btn.addEventListener('click', (e) => {
      clearTimeout(restLongPress);
      if (restLongFired) { restLongFired = false; return; }
      if (e.target.closest('#rest-timer-close')) {
        e.stopPropagation();
        haptic('light');
        stopRestTimer();
        return;
      }
      restEndsAt += 30000;
      haptic('select');
      toast('+30 секунд отдыха');
    });
  }

  const restPresets = $('#timer-presets');
  if (restPresets) {
    restPresets.addEventListener('click', (e) => {
      const b = e.target.closest('[data-rest]');
      if (!b) return;
      haptic('select');
      startRestTimer(Number(b.dataset.rest));
      toast('Отдых ' + restLabel(Number(b.dataset.rest)));
    });
  }

  /* ============================================================
     7. Уведомления, спиннеры
     ============================================================ */
  let toastTimer;
  function toast(msg, type) {
    const el = $('#toast');
    el.textContent = msg;
    el.className = 'toast show ' + (type || '');
    if (type === 'ok' || type === 'err') haptic(type);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
  }

  async function withBusy(btn, fn) {
    if (!btn) return fn();
    const html = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner" style="width:16px;height:16px;border:2px solid rgba(0,0,0,.25);border-top-color:#04201c;border-radius:50%;display:inline-block;animation:spin .7s linear infinite"></span>';
    try { return await fn(); }
    finally { btn.disabled = false; btn.innerHTML = html; }
  }

  /* ============================================================
     8. Графики (Chart.js)
     ============================================================ */
  const PALETTE = { accent: '#2dd4bf', accent2: '#6366f1', muted: '#64748b', line: 'rgba(148,163,184,.12)' };

  function initChartDefaults() {
    if (!window.Chart) return;
    Chart.defaults.color = '#8a97ab';
    Chart.defaults.font.family = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
    Chart.defaults.font.size = 11;
    Chart.defaults.font.weight = '600';
    Chart.defaults.borderColor = PALETTE.line;
    Chart.defaults.animation.duration = 420;
    Chart.defaults.plugins.legend.display = false;
    Chart.defaults.plugins.tooltip.backgroundColor = 'rgba(20,27,41,.96)';
    Chart.defaults.plugins.tooltip.borderColor = 'rgba(148,163,184,.24)';
    Chart.defaults.plugins.tooltip.borderWidth = 1;
    Chart.defaults.plugins.tooltip.padding = 10;
    Chart.defaults.plugins.tooltip.cornerRadius = 8;
    Chart.defaults.plugins.tooltip.titleFont = { size: 11, weight: '700' };
    Chart.defaults.plugins.tooltip.bodyFont = { size: 12, weight: '600' };
  }

  function canvasCtx(el) {
    try {
      if (!el || typeof el.getContext !== 'function') return null;
      return el.getContext('2d') || null;
    } catch (_) { return null; }
  }

  function destroyChart(key) {
    if (charts[key]) { try { charts[key].destroy(); } catch (_) {} charts[key] = null; }
  }

  function mountChart(key, ctx, cfg) {
    let chart;
    try { chart = new Chart(ctx, cfg); } catch (e) { console.error('chart', e); return; }
    charts[key] = chart;
    requestAnimationFrame(() => {
      if (charts[key] !== chart) return;
      try { chart.resize(); chart.update('none'); } catch (_) {}
    });
  }

  function drawWeightChart(canvasId, key, range) {
    if (!window.Chart) return;
    const el = document.getElementById(canvasId);
    if (!el) return;
    const ctx0 = canvasCtx(el);
    destroyChart(key);
    if (!ctx0) return;
    const arr = weightSeries(range);
    if (arr.length < 2) {
      try { ctx0.clearRect(0, 0, el.width, el.height); } catch (_) {}
      return;
    }
    const labels = arr.map(e => fmtShort(e.logged_at));
    const values = arr.map(e => num(e.weight_kg));
    const ma = movingAverage(arr, 7);

    mountChart(key, ctx0, {
      type: 'line',
      data: {
        labels: labels,
        datasets: [
          {
            label: 'Вес',
            data: values,
            borderColor: PALETTE.accent,
            borderWidth: 2,
            pointRadius: arr.length > 40 ? 0 : 2.5,
            pointBackgroundColor: '#0b1018',
            pointBorderColor: PALETTE.accent,
            pointBorderWidth: 1.5,
            pointHoverRadius: 5,
            tension: .35,
            fill: true,
            backgroundColor: (context) => {
              const chart = context.chart;
              const { ctx, chartArea } = chart;
              if (!chartArea) return 'rgba(45,212,191,.10)';
              const g = ctx.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
              g.addColorStop(0, 'rgba(45,212,191,.28)');
              g.addColorStop(1, 'rgba(45,212,191,0)');
              return g;
            }
          },
          {
            label: 'Среднее',
            data: ma,
            borderColor: 'rgba(100,116,139,.85)',
            borderWidth: 1.5,
            borderDash: [5, 4],
            pointRadius: 0,
            tension: .35,
            fill: false
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        layout: { padding: { top: 6, right: 4, left: 0, bottom: 0 } },
        scales: {
          x: {
            grid: { display: false },
            border: { display: false },
            ticks: { maxTicksLimit: 6, maxRotation: 0, autoSkip: true, color: '#5f6d82' }
          },
          y: {
            grid: { color: PALETTE.line, drawTicks: false },
            border: { display: false },
            ticks: {
              padding: 8,
              color: '#5f6d82',
              callback: (v) => nf1.format(v)
            }
          }
        },
        plugins: {
          tooltip: {
            callbacks: {
              title: (items) => {
                const i = items[0].dataIndex;
                const d = parseDate(arr[i].logged_at);
                return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
              },
              label: (item) => ' ' + nf1.format(item.parsed.y) + ' кг' + (item.datasetIndex === 1 ? ' · среднее' : '')
            }
          }
        }
      }
    });
  }

  function drawSetsChart() {
    if (!window.Chart) return;
    const el = document.getElementById('volume-chart');
    if (!el) return;
    const ctx0 = canvasCtx(el);
    destroyChart('volume');
    if (!ctx0) return;
    const weeks = weeklySets(8);
    mountChart('volume', ctx0, {
      type: 'bar',
      data: {
        labels: weeks.map(w => fmtShort(w.start)),
        datasets: [{
          data: weeks.map(w => w.sets),
          backgroundColor: (ctx) => {
            const chart = ctx.chart;
            const { ctx: c, chartArea } = chart;
            if (!chartArea) return 'rgba(99,102,241,.55)';
            const g = c.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
            g.addColorStop(0, 'rgba(99,102,241,.95)');
            g.addColorStop(1, 'rgba(99,102,241,.35)');
            return g;
          },
          borderRadius: 6,
          borderSkipped: false,
          maxBarThickness: 34
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        layout: { padding: { top: 8 } },
        scales: {
          x: { grid: { display: false }, border: { display: false }, ticks: { color: '#5f6d82', maxRotation: 0 } },
          y: {
            grid: { color: PALETTE.line, drawTicks: false },
            border: { display: false },
            ticks: {
              padding: 8,
              color: '#5f6d82',
              maxTicksLimit: 4,
              precision: 0
            }
          }
        },
        plugins: {
          tooltip: {
            callbacks: {
              title: (items) => {
                const w = weeks[items[0].dataIndex];
                return fmtShort(w.start) + ' — ' + fmtShort(w.end);
              },
              label: (item) => ' ' + nf.format(item.parsed.y) + ' подходов'
            }
          }
        }
      }
    });
  }

  /* ============================================================
     9. Рендер: обзор
     ============================================================ */
  function goalGood(diff) {
    const goal = (state.profile && state.profile.goal) || 'maintain';
    if (Math.abs(diff) < 0.05) return null;
    if (goal === 'mass') return diff > 0;
    if (goal === 'cut') return diff < 0;
    return Math.abs(diff) < 0.4;
  }

  function renderHome() {
    const p = state.profile || {};
    const w = currentWeight();
    const balance = muscleBalance(30);
    const sessionsAll = sessions();
    const today = sessionsAll.find(s => sameDay(s.date, new Date()));
    const name = (tgUser && tgUser.first_name) || 'Атлет';

    // KPI
    $('#st-weight').innerHTML = w ? nf1.format(w) + ' <small>кг</small>' : '—';
    const arr = state.weights;
    if (arr.length >= 2) {
      const diff = num(arr[0].weight_kg) - num(arr[1].weight_kg);
      const sign = diff > 0 ? '+' : diff < 0 ? '−' : '';
      const g = goalGood(diff);
      const cls = g === true ? 'good' : g === false ? 'bad' : 'flat';
      const arrow = diff > 0 ? '▲' : diff < 0 ? '▼' : '•';
      $('#st-weight-delta').innerHTML = '<span class="delta ' + cls + '">' + arrow + ' ' + sign + nf1.format(Math.abs(diff)) + ' кг</span> к прошлому замеру';
    } else {
      $('#st-weight-delta').textContent = 'нужен второй замер';
    }

    $('#st-week').innerHTML = weekCount() + ' <small>/ 7</small>';
    $('#st-streak').innerHTML = streak() + ' <small>дн</small>';

    // Белки за сегодня
    const protein = proteinToday();
    const pt = proteinTarget(w);
    $('#st-protein').innerHTML = Math.round(protein) + ' <small>г</small>';
    $('#st-protein-note').textContent = pt ? 'цель ' + pt.goal + ' г' : 'укажи вес в профиле';

    // Сегодня
    const sets = today ? today.sets : 0;
    $('#today-sets').textContent = sets;
    $('#today-title').textContent = sets ? 'Тренировка идёт' : 'Тренировок пока нет';
    $('#today-sub').textContent = sets
      ? nf.format(sets) + ' подходов за сегодня'
      : 'Запиши первый подход — здесь появятся итоги дня';
    $('#today-date').textContent = new Date().toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' });

    // Чеклист спортпита (общий для «Обзора» и «Питания»)
    renderSupps();

    // Баланс мышц
    const maxSets = balance.rows.reduce((m, r) => Math.max(m, r.sets), 0);
    $('#muscle-balance').innerHTML = balance.rows.map(r => {
      const pct = balance.total ? Math.round(r.sets / balance.total * 100) : 0;
      const low = balance.total > 0 && r.sets === 0;
      return '<div class="balance-row">' +
        '<div class="balance-top"><span class="balance-name">' + esc(r.name) + '</span>' +
        '<span class="balance-val">' + r.sets + ' подх · ' + pct + '%</span></div>' +
        '<div class="bar ' + (low ? 'empty' : (r.sets < maxSets * 0.35 ? 'low' : '')) + '"><span style="width:' + (balance.total ? Math.max(2, pct) : 0) + '%"></span></div>' +
        '</div>';
    }).join('');

    // Heatmap
    renderHeatmap();

    // Графики
    const wrap = $('#home-chart-wrap');
    const hasWeight = weightSeries(state.range.home).length >= 2;
    destroyChart('home');
    if (wrap) {
      wrap.innerHTML = hasWeight
        ? '<canvas id="home-chart" role="img" aria-label="График веса"></canvas>'
        : '<div class="empty"><svg><use href="#i-trend-up"/></svg><b>Мало данных</b>Добавь два замера веса — появится динамика</div>';
    }
    if (hasWeight) drawWeightChart('home-chart', 'home', state.range.home);
    drawSetsChart();

    // Последние тренировки
    const recent = sessionsAll.slice(0, 3);
    $('#home-sessions').innerHTML = recent.length
      ? recent.map(sessionHtml).join('')
      : '<div class="empty"><svg><use href="#i-dumbbell"/></svg><b>Пока пусто</b>Первая тренировка появится здесь</div>';

    // Имя
    const initials = name.trim().slice(0, 1).toUpperCase();
    $('#side-avatar').textContent = initials;
    $('#top-avatar').textContent = initials;
    $('#sidebar-user').textContent = name;
    $('#side-streak').textContent = streak() + ' дн серия · ' + (p.goal === 'cut' ? 'похудение' : p.goal === 'mass' ? 'набор' : 'поддержание');
    const ts = $('#top-streak');
    if (ts) ts.querySelector('span').textContent = streak();

    renderGoalMini();
    updateNotifBadge();
  }

  function renderHeatmap() {
    const el = $('#heatmap');
    if (!el) return;
    const weeks = 12;
    const today = startOfDay(new Date());
    const dow = (today.getDay() + 6) % 7;
    const start = addDays(today, -(weeks * 7 - 1) - (6 - dow));
    const counts = new Map();
    state.workouts.forEach(w => {
      const k = dayKey(parseDate(w.logged_at));
      counts.set(k, (counts.get(k) || 0) + setCount(w));
    });
    const cells = [];
    for (let i = 0; i < weeks * 7; i++) {
      const d = addDays(start, i);
      const c = counts.get(dayKey(d)) || 0;
      const lvl = c === 0 ? '' : c < 4 ? 'l1' : c < 8 ? 'l2' : c < 13 ? 'l3' : 'l4';
      const inFuture = d > today;
      cells.push('<div class="heat ' + (inFuture ? '' : lvl) + '" title="' + d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }) + ': ' + c + ' подходов" style="' + (inFuture ? 'opacity:.25' : '') + '"></div>');
    }
    el.innerHTML = cells.join('');
  }

  /* ============================================================
     10. Рендер: тренировки
     ============================================================ */
  function sessionHtml(s) {
    const isToday = sameDay(s.date, new Date());
    const del = isToday
      ? '<button class="day-del" type="button" data-del-day="' + esc(s.key) + '" title="Удалить все подходы за сегодня">' +
          '<svg><use href="#i-trash"/></svg>Удалить</button>'
      : '';
    return '<div class="session">' +
      '<div class="session-head">' +
        '<div>' +
          '<div class="session-date">' + esc(fmtDay(s.date)) + '</div>' +
          '<div class="session-meta">' + s.rows.length + ' упражн. · ' + s.sets + ' подх</div>' +
        '</div>' +
        '<div class="session-tools">' + del + '<span class="row-badge">' + (s.groups.size || 1) + '</span></div>' +
      '</div>' +
      s.rows.map(rowHtml).join('') +
    '</div>';
  }

  function rowHtml(w) {
    const g = w.muscle_group;
    const weight = num(w.weight_kg);
    const reps = num(w.reps);
    const sets = num(w.sets);
    const parts = [];
    if (weight) parts.push(nf1.format(weight) + ' кг');
    if (reps) parts.push(reps + ' повт');
    if (sets) parts.push(sets + ' подх');
    const pr = w._pr ? '<span class="tag pr">PR</span>' : '';
    const canDel = w.id && sameDay(parseDate(w.logged_at), new Date());
    const del = canDel
      ? '<button class="row-del" type="button" data-del-row="' + esc(String(w.id)) + '" title="Удалить запись"><svg><use href="#i-trash"/></svg></button>'
      : '';
    return '<div class="set-row" data-group="' + esc(g || 'other') + '" data-repeat-ex="' + esc(w.exercise || '') + '" data-repeat-group="' + esc(g || 'chest') + '" data-repeat-w="' + (weight || '') + '" data-repeat-r="' + (reps || '') + '" data-repeat-s="' + (sets || 3) + '" style="cursor:pointer" title="Нажми, чтобы скопировать в форму">' +
      '<div>' +
        '<div class="set-name">' + esc(w.exercise || 'Без названия') + '</div>' +
        '<div class="set-sub">' +
          (g ? '<span class="tag neutral">' + esc(GROUPS[g] || g) + '</span>' : '') +
          (parts.length ? '<span>' + parts.join(' · ') + '</span>' : '<span>без веса</span>') +
          pr +
        '</div>' +
      '</div>' +
      del +
    '</div>';
  }

  function renderWorkouts() {
    const since = startOfDay(addDays(new Date(), -29));
    const recent = state.workouts.filter(w => parseDate(w.logged_at) >= since);
    if ($('#ws-count')) $('#ws-count').textContent = recent.length;
    if ($('#ws-sets')) $('#ws-sets').textContent = recent.reduce((s, w) => s + setCount(w), 0);

    const todayRows = state.workouts.filter(w => sameDay(parseDate(w.logged_at), new Date()));
    if ($('#ws-today-sets')) $('#ws-today-sets').textContent = todayRows.reduce((s, w) => s + setCount(w), 0);
    const clearBtn = $('#wo-clear-today');
    if (clearBtn) clearBtn.classList.toggle('hidden', !todayRows.length);

    let list = state.workouts.filter(w => !state.filter || w.muscle_group === state.filter);
    if (state.query) {
      const q = state.query.toLowerCase();
      list = list.filter(w => String(w.exercise || '').toLowerCase().indexOf(q) >= 0);
    }

    const container = $('#workout-list');
    if (!container) return;
    if (!list.length) {
      container.innerHTML = '<div class="empty"><svg><use href="#i-dumbbell"/></svg><b>Ничего не найдено</b>' +
        (state.query || state.filter ? 'Попробуй сбросить фильтр' : 'Запиши первый подход в форме слева') + '</div>';
      return;
    }
    container.innerHTML = sessions(list).slice(0, 40).map(sessionHtml).join('');
  }

  /* ============================================================
     11. Рендер: вес
     ============================================================ */
  function renderWeight() {
    const arr = state.weights;
    const w = currentWeight();
    $('#w-sub').textContent = w
      ? 'Сейчас ' + nf1.format(w) + ' кг' + (arr.length > 1 ? ' · ' + arr.length + ' замеров' : '')
      : 'Добавь первый замер';

    const bwInput = $('#b-weight');
    if (bwInput && w && document.activeElement !== bwInput) {
      bwInput.placeholder = String(w);
    }

    const rate = weekRate();
    if (rate) {
      const good = goalGood(rate.perWeek);
      const cls = good === true ? 'good' : good === false ? 'bad' : 'flat';
      const sign = rate.perWeek > 0 ? '+' : rate.perWeek < 0 ? '−' : '';
      $('#w-rate').innerHTML = '<span class="delta ' + cls + '">' + sign + nf1.format(Math.abs(rate.perWeek)) + ' кг</span> <small style="font-size:13px;color:#8a97ab">/ нед</small>';
      $('#w-rate-note').textContent = 'по ' + rate.days + ' дням замеров · ' +
        (state.profile && state.profile.goal === 'cut' ? 'для похудения норм. −0,25…−0,75' :
         state.profile && state.profile.goal === 'mass' ? 'для набора норм. +0,2…+0,5' : 'для поддержания ±0,2');
    } else {
      $('#w-rate').textContent = '—';
      $('#w-rate-note').textContent = 'нужно минимум две записи за 14 дней';
    }

    const wWrap = $('#weight-chart-wrap');
    const hasW = weightSeries(state.range.weight).length >= 2;
    destroyChart('weight');
    if (wWrap) {
      wWrap.innerHTML = hasW
        ? '<canvas id="weight-chart" role="img" aria-label="График веса"></canvas>'
        : '<div class="empty"><svg><use href="#i-trend-up"/></svg><b>Мало данных</b>Добавь два замера — появится динамика и темп</div>';
    }
    if (hasW) drawWeightChart('weight-chart', 'weight', state.range.weight);

    const sorted = arr.slice().sort((a, b) => parseDate(b.logged_at) - parseDate(a.logged_at));
    if (!sorted.length) {
      $('#weight-list').innerHTML = '<div class="empty"><svg><use href="#i-scale"/></svg><b>Пока нет замеров</b>Первый замер — стартовая точка</div>';
      return;
    }
    $('#weight-list').innerHTML = sorted.slice(0, 40).map((e, i) => {
      const prev = sorted[i + 1];
      let delta = '';
      if (prev) {
        const d = num(e.weight_kg) - num(prev.weight_kg);
        const g = goalGood(d);
        const cls = g === true ? 'good' : g === false ? 'bad' : 'flat';
        delta = '<span class="delta ' + cls + '" style="font-size:11px">' + (d > 0 ? '+' : d < 0 ? '−' : '') + nf1.format(Math.abs(d)) + '</span>';
      }
      const bits = [];
      if (num(e.body_fat_percent) != null) bits.push('жир ' + nf1.format(num(e.body_fat_percent)) + '%');
      if (num(e.muscle_mass_kg) != null) bits.push('мышцы ' + nf1.format(num(e.muscle_mass_kg)) + ' кг');
      return '<div class="session"><div class="set-row">' +
        '<div>' +
          '<div class="set-name num">' + nf1.format(num(e.weight_kg)) + ' кг ' + delta + '</div>' +
          '<div class="set-sub">' + (bits.length ? bits.join(' · ') : 'без состава тела') + '</div>' +
        '</div>' +
        '<div class="set-load" style="font-size:12px;color:#8a97ab;font-weight:600">' + esc(fmtDay(parseDate(e.logged_at))) + '</div>' +
      '</div></div>';
    }).join('');
  }

  /* ============================================================
     12. Рендер: калькуляторы
     ============================================================ */
  function renderCalc() {
    const w = currentWeight();
    const p = state.profile || {};

    // Норма белка
    $('#c-protein').innerHTML = w ? Math.round(w * 1.6) + '–' + Math.round(w * 2.2) + ' <small>г</small>' : '—';
    $('#c-protein-note').textContent = w ? 'при весе ' + nf1.format(w) + ' кг' : 'укажи вес в профиле';

    // Спортпит утром: креатин и разовая порция белка
    if (w) {
      const creatineGrams = w > 90 ? 7 : (w < 65 ? 3 : 5);
      const morningProtein = Math.round(w * 0.35);
      $('#c-supps').innerHTML = creatineGrams + ' г <small>креатин</small> · ' + morningProtein + ' г <small>белка</small>';
      $('#c-supps-note').textContent = 'Утром: ' + creatineGrams + ' г креатина + 1 скуп протеина (~' + morningProtein + ' г чистого белка)';
    } else {
      $('#c-supps').innerHTML = '5 г <small>креатин</small> · 30 г <small>белка</small>';
      $('#c-supps-note').textContent = 'Стандартная порция (укажи вес для точного расчёта)';
    }

    // Вода
    $('#c-water').innerHTML = w ? nf1.format(w * 0.03) + '–' + nf1.format(w * 0.035) + ' <small>л</small>' : '—';

    // Вода считается в блоке выше, здесь только нормы и силовые показатели

    // ИМТ
    if (w && num(p.height_cm)) {
      const h = num(p.height_cm) / 100;
      const bmi = w / (h * h);
      $('#c-bmi').innerHTML = nf1.format(bmi);
      const low = 18.5 * h * h, high = 24.9 * h * h;
      const verdict = bmi < 18.5 ? 'дефицит массы' : bmi < 25 ? 'норма' : bmi < 30 ? 'избыточная масса' : 'ожирение';
      $('#c-bmi-note').textContent = verdict + ' · здоровый вес ' + nf1.format(low) + '–' + nf1.format(high) + ' кг';
    } else {
      $('#c-bmi').textContent = '—';
      $('#c-bmi-note').textContent = 'нужны вес и рост';
    }

    // 1ПМ
    const lastSet = state.workouts.find(x => num(x.weight_kg) && num(x.reps));
    const rmW = $('#rm-weight'), rmR = $('#rm-reps');
    if (rmW && !rmW.value && lastSet && document.activeElement !== rmW && document.activeElement !== rmR) {
      rmW.value = num(lastSet.weight_kg);
      rmR.value = num(lastSet.reps);
    }
    const rw = num(rmW && rmW.value), rr = num(rmR && rmR.value);
    const rm = e1rm(rw, rr);
    $('#c-rm').innerHTML = rm ? Math.round(rm) + ' <small>кг</small>' : '—';
  }

  /* ============================================================
     13. Рендер: профиль
     ============================================================ */
  function renderProfile() {
    const p = state.profile || {};
    const f = $('#profile-form');
    const isEditing = f && f.contains(document.activeElement);
    if (f && !isEditing) {
      const setVal = (sel, val) => { const el = $(sel); if (el) el.value = val; };
      setVal('#p-weight', p.weight_kg != null ? p.weight_kg : (currentWeight() || ''));
      setVal('#p-height', p.height_cm != null ? p.height_cm : '');
      setVal('#p-age', p.age != null ? p.age : '');
      setVal('#p-gender', p.gender || 'male');
      setVal('#p-goal', p.goal || 'maintain');
    }
    if (p.sync_code) {
      $('#sync-code-display').textContent = p.sync_code;
      $('#copy-code-btn').classList.remove('hidden');
    }
    const targetEl = $('#p-target');
    if (targetEl && !isEditing) targetEl.value = store.get(LS.target) || '';
    const th = store.get(LS.theme) || 'teal';
    const a = $('#theme-teal'), b = $('#theme-energy');
    if (a) a.classList.toggle('ghost', th === 'energy');
    if (b) b.classList.toggle('ghost', th !== 'energy');
  }

  const TITLES = {
    home: ['Обзор', 'Прогресс, тренировки и питание'],
    workouts: ['Тренировки', 'Записывай подходы и удаляй ошибочные'],
    nutrition: ['Питание', 'Белок, спортпит и вода'],
    weight: ['Вес и состав', 'Динамика веса, жира и мышц'],
    records: ['Рекорды', 'Личные максимумы и динамика силы'],
    calc: ['Расчёты', 'Нормы белка, воды и силовые показатели'],
    profile: ['Профиль', 'Данные, доступ и экспорт']
  };

  /* ============================================================
     14. Навигация и глобальные клики
     ============================================================ */
  function showTab(name, withHaptic) {
    if (!TITLES[name]) name = 'home';
    if (withHaptic && state.tab !== name) haptic('select');
    state.tab = name;
    $$('[data-nav]').forEach(b => b.classList.toggle('active', b.dataset.nav === name));
    $$('.panel').forEach(p => p.classList.toggle('active', p.id === 'panel-' + name));
    const t = TITLES[name];
    if ($('#page-title')) { $('#page-title').textContent = t[0]; $('#page-sub').textContent = t[1]; }
    window.scrollTo(0, 0);
    try { sessionStorage.setItem('trek_tab', name); } catch (_) {}
    renderTab(name);
  }

  function renderTab(name) {
    try {
      if (name === 'home') renderHome();
      else if (name === 'workouts') renderWorkouts();
      else if (name === 'nutrition') renderNutrition();
      else if (name === 'weight') renderWeight();
      else if (name === 'records') renderRecords();
      else if (name === 'calc') renderCalc();
      else if (name === 'profile') { renderProfile(); renderNotifications(); }
      updateNotifBadge();
    } catch (e) { console.error('render ' + name, e); }
  }

  document.addEventListener('click', (e) => {
    const nav = e.target.closest('[data-nav]');
    if (nav) { e.preventDefault(); showTab(nav.dataset.nav, true); return; }

    const go = e.target.closest('[data-goto]');
    if (go) { e.preventDefault(); showTab(go.dataset.goto, true); return; }

    const step = e.target.closest('[data-step]');
    if (step) {
      const input = document.getElementById(step.dataset.for);
      if (!input) return;
      haptic('light');
      const delta = Number(step.dataset.step);
      const cur = Number(input.value) || Number(input.placeholder) || 0;
      const next = Math.max(Number(input.min || 0) || 0, Math.min(Number(input.max || 999) || 999, cur + delta));
      input.value = round(next, 2);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return;
    }

    // Повтор упражнения по клику на строку истории
    if (e.target.closest('[data-del-row], [data-del-day], #wo-clear-today')) return;
    const rep = e.target.closest('[data-repeat-ex]');
    if (rep) {
      const exName = rep.dataset.repeatEx;
      if (!exName) return;
      haptic('select');
      if (state.tab !== 'workouts') showTab('workouts', false);
      const sel = $('#exercise-select');
      if (sel) {
        const hasOption = Array.from(sel.options).some(o => o.value === exName);
        if (hasOption) {
          sel.value = exName;
        } else {
          sel.value = OTHER;
          $('#custom-exercise').value = exName;
          $('#group-select').value = rep.dataset.repeatGroup || 'chest';
        }
        if (rep.dataset.repeatW !== '') $('#w-weight').value = rep.dataset.repeatW;
        if (rep.dataset.repeatR !== '') $('#w-reps').value = rep.dataset.repeatR;
        if (rep.dataset.repeatS !== '') $('#w-sets').value = rep.dataset.repeatS;
        syncExerciseUI(false);
        window.scrollTo({ top: 0, behavior: 'smooth' });
        toast('Подставлено: ' + exName);
      }
    }
  });

  document.addEventListener('keydown', (e) => {
    const go = e.target.closest && e.target.closest('[data-goto]');
    if (go && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); showTab(go.dataset.goto, true); }
  });

  /* ============================================================
     15. Формы и контролы
     ============================================================ */
  function buildExerciseSelect() {
    const sel = $('#exercise-select');
    if (!sel) return;
    let html = '';
    Object.keys(EXERCISES).forEach(g => {
      html += '<optgroup label="' + esc(GROUPS[g]) + '">';
      html += EXERCISES[g].map(n => '<option value="' + esc(n) + '">' + esc(n) + '</option>').join('');
      html += '</optgroup>';
    });
    html += '<option value="' + OTHER + '">Другое упражнение…</option>';
    sel.innerHTML = html;
    sel.value = EXERCISES.chest[0];
    syncExerciseUI(true);
  }

  function syncExerciseUI(autofill) {
    const sel = $('#exercise-select');
    if (!sel) return;
    const custom = sel.value === OTHER;
    $('#custom-wrap').classList.toggle('hidden', !custom);
    $('#group-wrap').classList.toggle('hidden', !custom);
    $('#custom-exercise').required = custom;

    const exName = custom ? $('#custom-exercise').value.trim() : sel.value;
    const last = findLastForExercise(exName);

    if (autofill && last && !custom) {
      if (num(last.weight_kg) != null) $('#w-weight').value = num(last.weight_kg);
      if (num(last.reps) != null) $('#w-reps').value = num(last.reps);
      if (num(last.sets) != null) $('#w-sets').value = num(last.sets);
    }

    const hint = $('#form-hint');
    if (hint) {
      const w = num($('#w-weight').value), r = num($('#w-reps').value);
      const rm = e1rm(w, r);
      const lastStr = last && (num(last.weight_kg) || num(last.reps))
        ? 'Прошлый раз: ' + (num(last.weight_kg) ? nf1.format(num(last.weight_kg)) + ' кг × ' : '') + (num(last.reps) || 0) + ' повт'
        : '';
      if (rm && lastStr) {
        hint.textContent = '≈ 1ПМ ' + Math.round(rm) + ' кг · ' + lastStr;
      } else if (rm) {
        hint.textContent = '≈ 1ПМ ' + Math.round(rm) + ' кг по этому подходу';
      } else if (lastStr) {
        hint.textContent = lastStr;
      } else {
        hint.textContent = 'Вес и повторы можно оставить пустыми для упражнений со своим весом';
      }
    }
  }

  if ($('#exercise-select')) {
    $('#exercise-select').addEventListener('change', () => {
      haptic('select');
      syncExerciseUI(true);
    });
    ['w-weight', 'w-reps', 'custom-exercise'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('input', () => syncExerciseUI(false));
    });
  }

  // Спортпит: чеклист на «Обзоре» и «Питании»
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-supp]');
    if (!btn) return;
    toggleSupp(btn.dataset.supp);
  });

  // Добавить подход
  const wf = $('#workout-form');
  if (wf) {
    wf.addEventListener('submit', (e) => {
      e.preventDefault();
      const sel = $('#exercise-select');
      const isOther = sel.value === OTHER;
      const exercise = (isOther ? $('#custom-exercise').value : sel.value).trim();
      const group = isOther ? $('#group-select').value : (EX_GROUP[sel.value] || 'chest');
      if (!exercise) { toast('Укажи название упражнения', 'err'); return; }

      const payload = {
        exercise: exercise,
        muscle_group: group,
        weight_kg: num($('#w-weight').value),
        reps: num($('#w-reps').value),
        sets: num($('#w-sets').value) || 1
      };

      withBusy(wf.querySelector('button[type=submit]'), async () => {
        try {
          const res = await sendWrite('add_workout', payload);
          const keepGroup = $('#group-select').value;
          if (res && res.queued) {
            state.workouts.unshift(Object.assign({ logged_at: localISO(new Date()) }, payload));
          } else {
            const data = await api('get_workouts', {});
            state.workouts = data.workouts || [];
          }
          markPRs();
          saveCache();
          if (isOther) { $('#group-select').value = keepGroup; }
          syncExerciseUI(false);
          renderWorkouts();
          startRestTimer(restDuration);
          toast('Подход записан · отдых ' + restLabel(restDuration), 'ok');
        } catch (err) { toast(err.message, 'err'); }
      });
    });
  }

  // Вес
  const wgtf = $('#weight-form');
  if (wgtf) {
    wgtf.addEventListener('submit', (e) => {
      e.preventDefault();
      const value = num($('#b-weight').value);
      if (!value || value < 20 || value > 400) { toast('Вес должен быть от 20 до 400 кг', 'err'); return; }
      const payload = {
        weight_kg: value,
        body_fat_percent: num($('#b-fat').value),
        muscle_mass_kg: num($('#b-muscle').value)
      };
      withBusy(wgtf.querySelector('button[type=submit]'), async () => {
        try {
          const res = await sendWrite('add_weight', payload);
          if (res && res.queued) {
            setWeights([Object.assign({}, payload, { logged_at: localISO(new Date()) })].concat(state.weights));
          } else {
            const data = await api('get_weight_log');
            setWeights(data.entries);
          }
          saveCache();
          $('#b-fat').value = '';
          $('#b-muscle').value = '';
          $('#b-weight').value = '';
          renderWeight();
          renderGoalMini();
          toast('Вес сохранён', 'ok');
        } catch (err) { toast(err.message, 'err'); }
      });
    });
  }

  // Профиль
  const pf = $('#profile-form');
  if (pf) {
    pf.addEventListener('submit', (e) => {
      e.preventDefault();
      const payload = {
        weight_kg: num($('#p-weight').value),
        height_cm: num($('#p-height').value),
        age: num($('#p-age').value),
        gender: $('#p-gender').value,
        goal: $('#p-goal').value
      };
      const target = num($('#p-target').value);
      if (target) store.set(LS.target, String(target));
      else store.del(LS.target);
      withBusy(pf.querySelector('button[type=submit]'), async () => {
        try {
          await sendWrite('upsert_profile', payload);
          const data = await api('get_profile');
          state.profile = data.profile || state.profile;
          saveCache();
          renderProfile();
          renderCalc();
          renderGoalMini();
          toast('Профиль сохранён', 'ok');
        } catch (err) { toast(err.message, 'err'); }
      });
    });
  }

  // Фильтры
  const chips = $('#workout-chips');
  if (chips) {
    chips.addEventListener('click', (e) => {
      const c = e.target.closest('.chip');
      if (!c) return;
      haptic('select');
      state.filter = c.dataset.filter;
      $$('#workout-chips .chip').forEach(x => x.classList.toggle('active', x === c));
      renderWorkouts();
    });
  }

  // Поиск
  let searchTimer;
  const search = $('#workout-search');
  if (search) {
    search.addEventListener('input', () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => { state.query = search.value.trim(); renderWorkouts(); }, 140);
    });
  }

  // Диапазоны
  [['#home-range', 'home'], ['#weight-range', 'weight']].forEach(([sel, key]) => {
    const box = $(sel);
    if (!box) return;
    box.addEventListener('click', (e) => {
      const b = e.target.closest('[data-range]');
      if (!b) return;
      haptic('select');
      state.range[key] = b.dataset.range;
      $$('[data-range]', box).forEach(x => x.classList.toggle('active', x === b));
      if (key === 'home') {
        renderHome();
      } else {
        renderWeight();
      }
    });
  });

  // Код синхронизации
  const genBtn = $('#gen-code-btn');
  if (genBtn) {
    genBtn.addEventListener('click', () => withBusy(genBtn, async () => {
      try {
        const res = await api('generate_sync_code');
        const code = res.sync_code;
        if (state.profile) state.profile.sync_code = code;
        $('#sync-code-display').textContent = code;
        $('#copy-code-btn').classList.remove('hidden');
        toast('Код создан — запиши его', 'ok');
      } catch (err) { toast(err.message, 'err'); }
    }));
  }

  const copyBtn = $('#copy-code-btn');
  if (copyBtn) {
    copyBtn.addEventListener('click', async () => {
      const code = $('#sync-code-display').textContent.trim();
      try { await navigator.clipboard.writeText(code); toast('Код скопирован', 'ok'); }
      catch (_) {
        const r = document.createRange();
        r.selectNodeContents($('#sync-code-display'));
        const s = getSelection();
        s.removeAllRanges();
        s.addRange(r);
        toast('Код выделен — скопируй вручную');
      }
    });
  }

  // Экспорт
  const exportBtn = $('#export-btn');
  if (exportBtn) {
    exportBtn.addEventListener('click', () => {
      try {
        const blob = new Blob([JSON.stringify({
          exported_at: new Date().toISOString(),
          profile: state.profile,
          workouts: state.workouts,
          weights: state.weights
        }, null, 2)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'trekfit-' + dayKey(new Date()) + '.json';
        document.body.appendChild(a);
        a.click();
        setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
        toast('Файл сформирован', 'ok');
      } catch (e) { toast('Не удалось выгрузить данные', 'err'); }
    });
  }

  const logoutBtn = $('#logout-btn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', () => { store.del('trek_sync_code'); location.reload(); });
  }

  // Калькуляторы: 1ПМ
  ['rm-weight', 'rm-reps'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', () => { renderCalc(); });
  });

  /* ============================================================
     16. Вход по коду
     ============================================================ */
  async function doLogin() {
    const input = $('#sync-input');
    const code = input.value.trim().toUpperCase();
    if (!code) { toast('Введи код синхронизации', 'err'); return; }
    await withBusy($('#sync-btn'), async () => {
      const prev = syncCode;
      syncCode = code;
      try {
        await api('get_profile');
        store.set('trek_sync_code', code);
        location.reload();
      } catch (err) {
        syncCode = prev;
        toast('Код не подошёл', 'err');
      }
    });
  }
  if ($('#sync-btn')) $('#sync-btn').addEventListener('click', doLogin);
  if ($('#sync-input')) {
    $('#sync-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') doLogin(); });
    $('#sync-input').addEventListener('input', (e) => {
      const v = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
      e.target.value = v.length > 4 ? v.slice(0, 4) + '-' + v.slice(4) : v;
    });
  }

  /* ============================================================
     17. Локальный слой: кэш, оффлайн-очередь, настройки
     ============================================================ */
  const LS = {
    cache: 'trek_cache_v1',
    queue: 'trek_queue_v1',
    nutrition: 'trek_nutrition_v1',
    water: 'trek_water_v1',
    notifRead: 'trek_notif_read_v1',
    target: 'trek_target_weight',
    theme: 'trek_theme'
  };

  function readJSON(key, fallback) {
    try {
      const raw = store.get(key);
      if (!raw) return fallback;
      const val = JSON.parse(raw);
      return val == null ? fallback : val;
    } catch (_) { return fallback; }
  }
  function writeJSON(key, val) {
    try { store.set(key, JSON.stringify(val)); } catch (_) {}
  }

  function localISO(d) {
    const p = (n) => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + 'T' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
  }

  // ---- Кэш последних данных (stale-while-revalidate) ----
  function saveCache() {
    writeJSON(LS.cache, { at: Date.now(), profile: state.profile, workouts: state.workouts, weights: state.weights });
  }
  function loadCache() {
    const c = readJSON(LS.cache, null);
    if (!c || !Array.isArray(c.workouts)) return false;
    state.profile = c.profile || state.profile;
    state.workouts = c.workouts || [];
    setWeights(c.weights || []);
    markPRs();
    return true;
  }

  // ---- Оффлайн-очередь записей ----
  function pendingWrites() { const q = readJSON(LS.queue, []); return Array.isArray(q) ? q : []; }
  function queueWrite(action, payload) {
    const q = pendingWrites();
    q.push({ action: action, payload: payload, at: Date.now() });
    writeJSON(LS.queue, q);
  }
  async function flushQueue() {
    const q = pendingWrites();
    if (!q.length || !navigator.onLine) return 0;
    const left = [];
    for (const item of q) {
      try { await apiRetry(item.action, item.payload); }
      catch (e) {
        if (/Failed to fetch|NetworkError|за 15 секунд|Нет связи/i.test(String(e.message))) left.push(item);
      }
    }
    writeJSON(LS.queue, left);
    const done = q.length - left.length;
    if (done) toast('Синхронизировано записей: ' + done, 'ok');
    return done;
  }
  async function sendWrite(action, payload) {
    try { return await apiRetry(action, payload); }
    catch (e) {
      if (/Failed to fetch|NetworkError|за 15 секунд|Нет связи/i.test(String(e.message))) {
        queueWrite(action, payload);
        return { queued: true };
      }
      throw e;
    }
  }
  window.addEventListener('online', () => { flushQueue().then(n => { if (n) loadAll().then(() => renderTab(state.tab)); }); });

  /* ============================================================
     18. Тема оформления
     ============================================================ */
  function applyTheme(name) {
    const root = document.documentElement;
    if (name === 'energy') root.setAttribute('data-theme', 'energy');
    else root.removeAttribute('data-theme');
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', name === 'energy' ? '#160a06' : '#080b12');
  }
  function setTheme(name) {
    applyTheme(name);
    store.set(LS.theme, name);
    const a = $('#theme-teal'), b = $('#theme-energy');
    if (a) a.classList.toggle('ghost', name === 'energy');
    if (b) b.classList.toggle('ghost', name !== 'energy');
    toast(name === 'energy' ? 'Тема «Энергия»' : 'Спокойная тема', 'ok');
  }

  /* ============================================================
     19. Питание: белок, спортпит и вода
     ============================================================ */
  const FOOD_LIB = [
    { e: '🍗', n: 'Куриная грудка', m: '150 г', p: 46 },
    { e: '🥚', n: 'Яйца', m: '3 шт', p: 19 },
    { e: '🍚', n: 'Рис отварной', m: '200 г', p: 5 },
    { e: '🍝', n: 'Макароны', m: '200 г', p: 10 },
    { e: '🥣', n: 'Овсянка', m: '60 г сухих', p: 8 },
    { e: '🍌', n: 'Банан', m: '1 шт', p: 1 },
    { e: '🧀', n: 'Творог 5%', m: '200 г', p: 34 },
    { e: '🥛', n: 'Молоко 2,5%', m: '250 мл', p: 8 },
    { e: '🥩', n: 'Говядина', m: '150 г', p: 40 },
    { e: '🐟', n: 'Лосось', m: '150 г', p: 32 },
    { e: '🥑', n: 'Авокадо', m: '½ шт', p: 2 },
    { e: '🥜', n: 'Орехи', m: '30 г', p: 6 },
    { e: '🍫', n: 'Протеин-батончик', m: '60 г', p: 20 },
    { e: '🥤', n: 'Протеин', m: '30 г', p: 24 }
  ];

  function nutritionAll() {
    const v = readJSON(LS.nutrition, {});
    return v && typeof v === 'object' ? v : {};
  }
  function nutritionDay(key) {
    const all = nutritionAll();
    return Array.isArray(all[key]) ? all[key] : [];
  }
  function nutritionTotals(items) {
    return (items || []).reduce((a, i) => {
      a.p += Number(i.p) || 0;
      return a;
    }, { p: 0 });
  }

  function proteinToday() {
    return nutritionTotals(nutritionDay(dayKey(new Date()))).p;
  }

  // ---- Вода ----
  function waterAll() {
    const v = readJSON(LS.water, {});
    return v && typeof v === 'object' ? v : {};
  }
  function waterToday() {
    return Number(waterAll()[dayKey(new Date())]) || 0;
  }
  function waterAdd(ml) {
    const all = waterAll();
    const k = dayKey(new Date());
    all[k] = Math.max(0, Math.min(15000, (Number(all[k]) || 0) + ml));
    writeJSON(LS.water, all);
    renderNutrition();
  }
  function waterReset() {
    const all = waterAll();
    all[dayKey(new Date())] = 0;
    writeJSON(LS.water, all);
    renderNutrition();
  }

  // ---- Спортпит ----
  function suppTaken(code) {
    return store.get('supp_' + code + '_' + dayKey(new Date())) === '1';
  }
  function formatSupps() {
    const w = currentWeight();
    if (!w) return 'Укажи вес в профиле — посчитаем порции.';
    const crG = w > 90 ? 7 : (w < 65 ? 3 : 5);
    const prG = Math.round(w * 0.35);
    return 'Твоя норма: ' + crG + ' г креатина + ' + prG + ' г белка из протеина.';
  }
  function renderSupps() {
    const cr = suppTaken('cr');
    const pr = suppTaken('pr');
    $$('[data-supp]').forEach(btn => btn.classList.toggle('active', btn.dataset.supp === 'cr' ? cr : pr));
    const kpi = $('#nut-supps');
    if (kpi) kpi.innerHTML = (cr ? 1 : 0) + (pr ? 1 : 0) + '<small> / 2</small>';
    const hint = $('#supp-hint');
    if (hint) hint.textContent = formatSupps();
  }
  function toggleSupp(code) {
    const key = 'supp_' + code + '_' + dayKey(new Date());
    if (store.get(key) === '1') {
      store.del(key);
      haptic('light');
      toast(code === 'cr' ? 'Креатин: отметка снята' : 'Протеин: отметка снята');
    } else {
      store.set(key, '1');
      haptic('ok');
      toast(code === 'cr' ? 'Креатин принят ✓' : 'Протеин принят ✓', 'ok');
    }
    renderSupps();
  }
  function nutritionAdd(item) {
    const all = nutritionAll();
    const key = dayKey(new Date());
    const list = Array.isArray(all[key]) ? all[key] : [];
    list.push({
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      e: item.e || '🍽️',
      n: item.n || 'Продукт',
      p: round(Number(item.p) || 0, 1)
    });
    all[key] = list;
    writeJSON(LS.nutrition, all);
  }

  function renderNutrition() {
    const key = dayKey(new Date());
    const items = nutritionDay(key);
    const t = nutritionTotals(items);
    const w = currentWeight();
    const pt = proteinTarget(w);
    const wt = waterTarget(w);
    const water = waterToday();

    const dateEl = $('#nut-date');
    if (dateEl) dateEl.textContent = new Date().toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' });

    // Белок
    if ($('#nut-protein')) $('#nut-protein').innerHTML = Math.round(t.p) + ' <small>г</small>';
    if ($('#nut-protein-note')) $('#nut-protein-note').textContent = pt ? 'цель ' + pt.goal + ' г' : 'укажи вес в профиле';
    const pPct = pt ? Math.min(100, Math.round(t.p / pt.goal * 100)) : 0;
    if ($('#nut-protein-bar')) $('#nut-protein-bar').style.width = pPct + '%';
    if ($('#nut-protein-pct')) $('#nut-protein-pct').textContent = pPct + '%';
    if ($('#nut-goal-note')) {
      $('#nut-goal-note').textContent = pt
        ? 'Цель ' + pt.goal + ' г · норма ' + pt.min + '–' + pt.max + ' г'
        : 'Заполни вес в профиле';
    }
    if ($('#nut-protein-left')) {
      $('#nut-protein-left').textContent = !pt ? '—'
        : (t.p >= pt.goal ? 'Норма белка набрана' : 'Осталось ' + Math.max(0, Math.round(pt.goal - t.p)) + ' г');
    }

    // Вода
    if ($('#nut-water')) $('#nut-water').innerHTML = nf.format(Math.round(water)) + ' <small>мл</small>';
    if ($('#nut-water-note')) $('#nut-water-note').textContent = wt ? 'из ' + nf.format(wt.goal) + ' мл' : 'мл';
    const wPct = wt ? Math.min(100, Math.round(water / wt.goal * 100)) : 0;
    if ($('#nut-water-bar')) $('#nut-water-bar').style.width = wPct + '%';
    if ($('#water-goal-note')) {
      $('#water-goal-note').textContent = wt
        ? 'Норма ' + nf.format(wt.min) + '–' + nf.format(wt.max) + ' мл · выпито ' + nf.format(Math.round(water))
        : 'Заполни вес в профиле';
    }

    // Спортпит
    renderSupps();

    const grid = $('#food-grid');
    if (grid) {
      grid.innerHTML = FOOD_LIB.map((f, i) =>
        '<button class="food-card" type="button" data-food="' + i + '">' +
          '<span class="food-emoji">' + f.e + '</span>' +
          '<span class="food-info"><span class="food-name">' + esc(f.n) + '</span>' +
          '<span class="food-meta">' + esc(f.m) + ' · ' + f.p + ' г белка</span></span>' +
        '</button>'
      ).join('');
    }

    const log = $('#nutrition-log');
    if (log) {
      if (!items.length) {
        log.innerHTML = '<div class="empty"><svg><use href="#i-apple"/></svg><b>Пока пусто</b>Добавь первый продукт за сегодня</div>';
      } else {
        const parts = items.map(it =>
          '<div class="nutrition-log-item">' +
            '<span class="food-emoji">' + esc(it.e) + '</span>' +
            '<span class="log-name">' + esc(it.n) + '</span>' +
            '<span class="log-macro">' + round(Number(it.p) || 0, 1) + ' г белка</span>' +
            '<button class="row-action" type="button" data-nut-del="' + esc(it.id) + '" aria-label="Удалить"><svg style="width:14px;height:14px"><use href="#i-close"/></svg></button>' +
          '</div>'
        );
        log.innerHTML = parts.join('') +
          '<div class="nutrition-summary" style="margin-top:8px">' +
            '<div class="ns-item"><span class="ns-label">Белки за день</span><span class="ns-value">' + Math.round(t.p) + '<small> г</small></span></div>' +
            (pt ? '<div class="ns-item"><span class="ns-label">Цель</span><span class="ns-value">' + pt.goal + '<small> г</small></span></div>' : '') +
          '</div>';
      }
    }
  }
  /* ============================================================
     20. Рекорды
     ============================================================ */
  let recordsCache = [];
  let recordsSelected = null;

  function computeRecords() {
    const map = new Map();
    state.workouts.forEach(w => {
      const name = String(w.exercise || '').trim();
      if (!name) return;
      const key = name.toLowerCase();
      const weight = num(w.weight_kg) || 0;
      const reps = num(w.reps) || 0;
      const rm = e1rm(weight, reps);
      if (!rm) return;
      const rec = map.get(key) || { key: key, name: name, group: w.muscle_group || '', best: 0, weight: 0, reps: 0, date: null, points: [] };
      if (rm > rec.best) { rec.best = rm; rec.weight = weight; rec.reps = reps; rec.date = w.logged_at; }
      if (!rec.group && w.muscle_group) rec.group = w.muscle_group;
      rec.points.push({ t: parseDate(w.logged_at), v: rm });
      map.set(key, rec);
    });

    const since = startOfDay(addDays(new Date(), -29)).getTime();
    return Array.from(map.values()).map(r => {
      let prevBest = 0;
      r.points.forEach(p => { if (p.t.getTime() < since && p.v > prevBest) prevBest = p.v; });
      r.delta = prevBest > 0 ? r.best - prevBest : 0;
      r.recent = r.date && parseDate(r.date).getTime() >= since;
      r.points.sort((a, b) => a.t - b.t);
      return r;
    }).sort((a, b) => b.best - a.best);
  }

  function drawRecordsChart() {
    const el = document.getElementById('records-chart');
    if (!el) return;
    destroyChart('records');
    const ctx = canvasCtx(el);
    if (!ctx || !window.Chart) return;
    const rec = recordsCache.find(r => r.key === recordsSelected);
    const note = $('#rec-chart-note');
    if (note) note.textContent = rec ? rec.name : '—';
    if (!rec || rec.points.length < 2) {
      try { ctx.clearRect(0, 0, el.width, el.height); } catch (_) {}
      return;
    }
    const pts = rec.points;
    mountChart('records', ctx, {
      type: 'line',
      data: {
        labels: pts.map(p => fmtShort(p.t)),
        datasets: [{
          data: pts.map(p => round(p.v, 1)),
          borderColor: PALETTE.accent,
          borderWidth: 2,
          pointRadius: pts.length > 30 ? 0 : 2.5,
          pointBackgroundColor: '#0b1018',
          pointBorderColor: PALETTE.accent,
          pointBorderWidth: 1.5,
          tension: .3,
          fill: true,
          backgroundColor: (context) => {
            const chart = context.chart;
            const area = chart.chartArea;
            if (!area) return 'rgba(45,212,191,.10)';
            const g = chart.ctx.createLinearGradient(0, area.top, 0, area.bottom);
            g.addColorStop(0, 'rgba(45,212,191,.26)');
            g.addColorStop(1, 'rgba(45,212,191,0)');
            return g;
          }
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        scales: {
          x: { grid: { display: false }, border: { display: false }, ticks: { maxTicksLimit: 6, color: '#5f6d82' } },
          y: {
            grid: { color: PALETTE.line, drawTicks: false },
            border: { display: false },
            ticks: { padding: 8, color: '#5f6d82', callback: (v) => nf1.format(v) }
          }
        },
        plugins: {
          tooltip: {
            callbacks: {
              title: (items) => parseDate(pts[items[0].dataIndex].t).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' }),
              label: (item) => ' 1ПМ ≈ ' + nf1.format(item.parsed.y) + ' кг'
            }
          }
        }
      }
    });
  }

  function renderRecords() {
    recordsCache = computeRecords();
    const total = recordsCache.length;
    const recent = recordsCache.filter(r => r.recent).length;
    const top = recordsCache[0];

    if ($('#rec-count')) $('#rec-count').textContent = total;
    if ($('#rec-recent')) $('#rec-recent').textContent = recent;
    if ($('#rec-top')) $('#rec-top').innerHTML = top ? Math.round(top.best) + ' <small>кг</small>' : '—';
    if ($('#rec-top-note')) $('#rec-top-note').textContent = top ? top.name : 'нет данных';

    const q = ($('#records-search') && $('#records-search').value || '').trim().toLowerCase();
    const list = q ? recordsCache.filter(r => r.name.toLowerCase().indexOf(q) >= 0) : recordsCache;

    const box = $('#records-list');
    if (box) {
      if (!list.length) {
        box.innerHTML = '<div class="empty"><svg><use href="#i-trophy"/></svg><b>' + (q ? 'Ничего не найдено' : 'Рекордов пока нет') + '</b>' +
          (q ? 'Попробуй другое название' : 'Запиши подход с весом и повторами') + '</div>';
      } else {
        box.innerHTML = list.map((r, i) => {
          const medal = i === 0 ? '🏆' : i === 1 ? '🥈' : i === 2 ? '🥉' : (i + 1);
          const delta = r.delta > 0.5 ? '<span class="tag pr">+' + nf1.format(r.delta) + ' кг</span>' : (r.recent ? '<span class="tag pr">PR</span>' : '');
          const dateStr = r.date ? parseDate(r.date).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }) : '';
          return '<div class="pr-row" data-record="' + esc(r.key) + '" style="cursor:pointer" title="Показать динамику">' +
            '<div class="pr-rank">' + medal + '</div>' +
            '<div>' +
              '<div class="set-name">' + esc(r.name) + '</div>' +
              '<div class="set-sub">' + esc(GROUPS[r.group] || r.group || '') + ' · ' + nf1.format(r.weight) + ' кг × ' + r.reps + ' · ' + esc(dateStr) + ' ' + delta + '</div>' +
            '</div>' +
            '<div class="pr-val">' + Math.round(r.best) + '<small>1ПМ, кг</small></div>' +
          '</div>';
        }).join('');
      }
    }

    if (!recordsSelected || !recordsCache.some(r => r.key === recordsSelected)) {
      recordsSelected = recordsCache.length ? recordsCache[0].key : null;
    }
    drawRecordsChart();
  }

  /* ============================================================
     21. Программы тренировок
     ============================================================ */
  /* ============================================================
     21. Программы тренировок
     Удалены: остались только записи подходов и история.
     ============================================================ */

  /* ============================================================
     22. Шторка и режим активной тренировки
     ============================================================ */
  let activeWorkout = null;

  function openSheet(html) {
    const overlay = $('#sheet-overlay');
    const sheet = $('#sheet');
    if (!overlay || !sheet) return;
    sheet.innerHTML = html;
    overlay.classList.add('open');
    document.body.classList.add('sheet-open');
  }
  function closeSheet() {
    const overlay = $('#sheet-overlay');
    if (overlay) overlay.classList.remove('open');
    document.body.classList.remove('sheet-open');
  }

  function activeProgress() {
    const items = activeWorkout ? activeWorkout.items : [];
    const total = items.reduce((s, i) => s + (Number(i.sets) || 0), 0);
    const done = items.reduce((s, i) => s + (Number(i.done) || 0), 0);
    return { total: total, done: done, pct: total ? Math.round(done / total * 100) : 0 };
  }

  function activeSheetHtml(summary) {
    const items = activeWorkout.items;
    const pr = activeProgress();
    const elapsed = Math.max(0, Math.floor((Date.now() - activeWorkout.startedAt) / 1000));
    const head = '<div class="sheet-head">' +
      '<div><div class="sheet-title">' + (summary ? 'Тренировка завершена' : esc(activeWorkout.title || 'Активная тренировка')) + '</div>' +
      '<div class="sub">' + (summary ? 'Итоги занятия' : 'Время <span class="wo-timer">' + restLabel(elapsed) + '</span> · ' + pr.done + ' из ' + pr.total + ' подходов') + '</div></div>' +
      '<button class="sheet-close" type="button" data-sheet-close aria-label="Закрыть"><svg><use href="#i-close"/></svg></button>' +
    '</div>';

    if (summary) {
      return head +
        '<div class="kpis" style="grid-template-columns:repeat(2,1fr);margin-bottom:12px">' +
          '<div class="kpi"><div class="kpi-label">Подходы</div><div class="kpi-value num">' + pr.done + '</div></div>' +
          '<div class="kpi"><div class="kpi-label">Время</div><div class="kpi-value num">' + restLabel(Math.floor((Date.now() - activeWorkout.startedAt) / 1000)) + '</div></div>' +
        '</div>' +
        items.map(i => '<div class="wo-item ' + (i.done >= i.sets ? 'done' : '') + '">' +
          '<div class="wo-body"><div class="wo-name">' + esc(i.exercise) + '</div>' +
          '<div class="wo-meta">' + i.done + ' / ' + i.sets + ' подходов · ' + (Number(i.weight_kg) || 0) + ' кг × ' + (Number(i.reps) || 0) + '</div></div>' +
          '<div class="wo-count">' + (i.done >= i.sets ? '✓' : i.done + '/' + i.sets) + '</div></div>').join('') +
        '<button class="btn" type="button" data-wo-finish-close style="margin-top:10px"><svg><use href="#i-check"/></svg>Готово</button>';
    }

    return head +
      '<div class="progress" style="height:8px;border-radius:999px;background:rgba(148,163,184,.16);overflow:hidden;margin-bottom:12px">' +
        '<span style="display:block;height:100%;width:' + pr.pct + '%;background:linear-gradient(90deg,var(--accent),#7dd3fc);transition:width .3s"></span>' +
      '</div>' +
      items.map((i, idx) =>
        '<div class="wo-item ' + (i.done >= i.sets ? 'done' : '') + '">' +
          '<div class="wo-body"><div class="wo-name">' + esc(i.exercise) + '</div>' +
          '<div class="wo-meta">' + (Number(i.weight_kg) || 0) + ' кг × ' + (Number(i.reps) || 0) + ' · ' + i.done + ' / ' + i.sets + '</div></div>' +
          '<div class="wo-count">' + i.done + '/' + i.sets + '</div>' +
          '<button class="btn sm ' + (i.done >= i.sets ? 'ghost' : 'primary') + '" type="button" data-wo-set="' + idx + '"' + (i.done >= i.sets ? ' disabled' : '') + '>' +
            (i.done >= i.sets ? '✓' : 'Подход') + '</button>' +
        '</div>'
      ).join('') +
      '<div class="row" style="margin-top:10px;gap:8px">' +
        '<button class="btn ghost" type="button" data-wo-finish><svg><use href="#i-check"/></svg>Завершить</button>' +
        '<button class="btn ghost" type="button" data-sheet-close>Свернуть</button>' +
      '</div>';
  }

  function startWorkout(items, title) {
    if (!items || !items.length) { toast('Нет упражнений для тренировки', 'err'); return; }
    activeWorkout = {
      title: title || 'Свободная тренировка',
      startedAt: Date.now(),
      items: items.map(i => ({
        exercise: i.exercise, muscle_group: i.muscle_group || EX_GROUP[i.exercise] || 'chest',
        weight_kg: Number(i.weight_kg) || 0, reps: Number(i.reps) || 0, sets: Number(i.sets) || 1, done: 0
      }))
    };
    haptic('select');
    openSheet(activeSheetHtml(false));
  }

  function startFreeWorkout() {
    const all = sessions();
    let items = [];
    if (all.length) {
      items = all[0].rows.map(r => ({
        exercise: r.exercise, muscle_group: r.muscle_group,
        weight_kg: num(r.weight_kg) || 0, reps: num(r.reps) || 0, sets: num(r.sets) || 3
      }));
    } else {
      const sel = $('#exercise-select');
      const name = sel && sel.value !== OTHER ? sel.value : 'Жим лёжа';
      items = [{ exercise: name, muscle_group: EX_GROUP[name] || 'chest', weight_kg: 40, reps: 10, sets: 3 }];
    }
    startWorkout(items, 'Свободная тренировка');
  }

  function logActiveSet(idx) {
    if (!activeWorkout) return;
    const it = activeWorkout.items[idx];
    if (!it || it.done >= it.sets) return;
    it.done += 1;
    const payload = { exercise: it.exercise, muscle_group: it.muscle_group, weight_kg: it.weight_kg, reps: it.reps, sets: 1 };
    state.workouts.unshift({
      exercise: it.exercise, muscle_group: it.muscle_group, weight_kg: it.weight_kg, reps: it.reps, sets: 1,
      logged_at: localISO(new Date()), id: 'local-' + Date.now() + Math.random().toString(36).slice(2, 5)
    });
    markPRs();
    saveCache();
    sendWrite('add_workout', payload).catch(err => toast(err.message, 'err'));
    startRestTimer(restDuration);
    haptic('ok');
    const sheetBox = $('#sheet');
    const keepScroll = sheetBox ? sheetBox.scrollTop : 0;
    openSheet(activeSheetHtml(false));
    if (sheetBox) sheetBox.scrollTop = keepScroll;
  }

  function finishWorkout() {
    if (!activeWorkout) return;
    const pr = activeProgress();
    if (!pr.done) { closeSheet(); activeWorkout = null; return; }
    openSheet(activeSheetHtml(true));
    haptic('ok');
    toast('Тренировка: ' + pr.done + ' подходов', 'ok');
    saveCache();
    renderHome();
  }

  /* ============================================================
     23. Уведомления
     ============================================================ */
  function notifReadIds() {
    const v = readJSON(LS.notifRead, []);
    return Array.isArray(v) ? v : [];
  }
  function markNotifRead(ids) {
    const read = new Set(notifReadIds());
    (ids || []).forEach(id => read.add(id));
    writeJSON(LS.notifRead, Array.from(read).slice(-200));
    updateNotifBadge();
  }

  function computeNotifications() {
    const out = [];
    const now = Date.now();
    if (!state.workouts.length) {
      out.push({ id: 'first-workout', icon: 'i-bolt', title: 'Запиши первую тренировку', sub: 'Появится серия, объём и рекорды' });
    } else {
      const last = Math.max.apply(null, state.workouts.map(w => parseDate(w.logged_at).getTime()));
      const days = Math.floor((now - last) / 864e5);
      if (days >= 3) {
        out.push({ id: 'gap-' + dayKey(new Date()), icon: 'i-dumbbell', title: 'Ты не тренировался ' + days + ' дн.', sub: 'Самое время вернуться в зал' });
      }
      const s = streak();
      if (s >= 7) out.push({ id: 'streak-' + s, icon: 'i-flame', title: 'Серия ' + s + ' дней!', sub: 'Отличная регулярность — так держать' });
      recordsCache = recordsCache.length ? recordsCache : computeRecords();
      recordsCache.filter(r => r.recent).slice(0, 3).forEach(r => {
        out.push({
          id: 'pr-' + r.key + '-' + dayKey(parseDate(r.date)),
          icon: 'i-trophy',
          title: 'Новый рекорд: ' + r.name,
          sub: '1ПМ ≈ ' + Math.round(r.best) + ' кг' + (r.delta > 0.5 ? ' · +' + nf1.format(r.delta) + ' кг за месяц' : '')
        });
      });
    }
    const target = num(store.get(LS.target));
    const cur = currentWeight();
    if (target && cur) {
      const diff = round(cur - target, 1);
      if (Math.abs(diff) <= 1) out.push({ id: 'goal-' + target + '-' + dayKey(new Date()), icon: 'i-target', title: 'Цель по весу достигнута', sub: 'Сейчас ' + nf1.format(cur) + ' кг при цели ' + nf1.format(target) + ' кг' });
    }
    return out;
  }

  function renderNotifications() {
    const box = $('#notif-list');
    if (!box) return;
    const items = computeNotifications();
    const read = new Set(notifReadIds());
    if (!items.length) {
      box.innerHTML = '<div class="empty"><svg><use href="#i-bell"/></svg><b>Всё спокойно</b>Здесь появятся напоминания и рекорды</div>';
      return;
    }
    box.innerHTML = items.map(n =>
      '<div class="notif-item ' + (read.has(n.id) ? '' : 'unread') + '">' +
        '<span class="notif-ic"><svg><use href="#' + n.icon + '"/></svg></span>' +
        '<span class="notif-body"><span class="notif-title">' + esc(n.title) + '</span>' +
        '<span class="notif-sub">' + esc(n.sub) + '</span></span>' +
      '</div>'
    ).join('');
  }

  function updateNotifBadge() {
    const items = computeNotifications();
    const read = new Set(notifReadIds());
    const unread = items.filter(n => !read.has(n.id)).length;
    ['#side-profile-dot', '#nav-profile-dot', '#top-bell-dot'].forEach(sel => {
      const el = $(sel);
      if (!el) return;
      if (sel === '#top-bell-dot') el.style.display = unread ? 'block' : 'none';
      else el.classList.toggle('show', unread > 0);
    });
  }

  /* ============================================================
     24. Цель по весу в сайдбаре
     ============================================================ */
  function renderGoalMini() {
    const el = $('#side-goal');
    if (!el) return;
    const target = num(store.get(LS.target));
    const cur = currentWeight();
    const oldest = state.weights.length ? num(state.weights[state.weights.length - 1].weight_kg) : null;

    if (!target) {
      el.innerHTML = '<div class="goal-mini-top"><span>Цель по весу</span><b>не задана</b></div>' +
        '<div class="sub" style="font-size:11px">Задай её в профиле</div>';
      return;
    }
    if (!cur) {
      el.innerHTML = '<div class="goal-mini-top"><span>Цель</span><b>' + nf1.format(target) + ' кг</b></div>';
      return;
    }
    const start = oldest || cur;
    const total = Math.abs(start - target);
    const passed = Math.abs(start - cur);
    const pct = total > 0.05 ? Math.min(100, Math.max(0, Math.round(passed / total * 100))) : 100;
    const left = round(cur - target, 1);
    el.innerHTML =
      '<div class="goal-mini-top"><span>До цели</span><b>' + (Math.abs(left) < 0.05 ? 'готово' : nf1.format(Math.abs(left)) + ' кг') + '</b></div>' +
      '<div class="goal-mini-bar"><span style="width:' + pct + '%"></span></div>' +
      '<div class="goal-mini-top"><span>' + nf1.format(cur) + ' кг</span><span>цель ' + nf1.format(target) + '</span></div>';
  }

  /* ============================================================
     25. Экспорт CSV
     ============================================================ */
  function csvCell(v) {
    const s = String(v == null ? '' : v);
    return /[",;\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  function exportCSV() {
    try {
      const rows = [['Дата', 'Упражнение', 'Группа мышц', 'Вес (кг)', 'Повторы', 'Подходы']];
      state.workouts.slice().sort((a, b) => parseDate(a.logged_at) - parseDate(b.logged_at)).forEach(w => {
        rows.push([
          String(w.logged_at || '').slice(0, 10),
          w.exercise || '',
          GROUPS[w.muscle_group] || w.muscle_group || '',
          num(w.weight_kg) || 0,
          num(w.reps) || 0,
          num(w.sets) || 1
        ]);
      });
      const csv = '\uFEFF' + rows.map(r => r.map(csvCell).join(';')).join('\r\n');
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'trekfit-' + dayKey(new Date()) + '.csv';
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
      toast('CSV готов — открывается в Excel и Sheets', 'ok');
    } catch (e) { toast('Не удалось выгрузить CSV', 'err'); }
  }

  /* ============================================================
     26. PWA
     ============================================================ */
  function initPWA() {
    if ('serviceWorker' in navigator && location.protocol === 'https:') {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    }
  }

  /* ============================================================
     27. Привязка событий новых разделов
     ============================================================ */
  const foodGridEl = $('#food-grid');
  if (foodGridEl) {
    foodGridEl.addEventListener('click', (e) => {
      const card = e.target.closest('[data-food]');
      if (!card) return;
      const f = FOOD_LIB[Number(card.dataset.food)];
      if (!f) return;
      nutritionAdd(f);
      haptic('ok');
      renderNutrition();
      toast('Добавлено: ' + f.n, 'ok');
    });
  }

  const nutritionLogEl = $('#nutrition-log');
  if (nutritionLogEl) {
    nutritionLogEl.addEventListener('click', (e) => {
      const del = e.target.closest('[data-nut-del]');
      if (!del) return;
      const all = nutritionAll();
      const key = dayKey(new Date());
      all[key] = (all[key] || []).filter(i => i.id !== del.dataset.nutDel);
      writeJSON(LS.nutrition, all);
      haptic('light');
      renderNutrition();
    });
  }

  const nutClear = $('#nut-clear');
  if (nutClear) {
    nutClear.addEventListener('click', () => {
      const all = nutritionAll();
      all[dayKey(new Date())] = [];
      writeJSON(LS.nutrition, all);
      renderNutrition();
      toast('Дневник за сегодня очищен');
    });
  }

  const nutForm = $('#nutrition-form');
  if (nutForm) {
    nutForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const name = $('#n-name').value.trim();
      const protein = num($('#n-p').value) || 0;
      if (!name) { toast('Укажи название продукта', 'err'); return; }
      if (!protein) { toast('Укажи белок в граммах', 'err'); return; }
      nutritionAdd({ e: '🍽️', n: name, p: protein });
      ['#n-name', '#n-p'].forEach(s => { const el = $(s); if (el) el.value = ''; });
      renderNutrition();
      toast('Добавлено: ' + name, 'ok');
    });
  }

  const recordsSearch = $('#records-search');
  if (recordsSearch) {
    recordsSearch.addEventListener('input', () => {
      clearTimeout(recordsSearch._t);
      recordsSearch._t = setTimeout(renderRecords, 140);
    });
  }

  const recordsListEl = $('#records-list');
  if (recordsListEl) {
    recordsListEl.addEventListener('click', (e) => {
      const row = e.target.closest('[data-record]');
      if (!row) return;
      recordsSelected = row.dataset.record;
      haptic('select');
      drawRecordsChart();
    });
  }

  const startWorkoutBtn = $('#start-workout-btn');
  if (startWorkoutBtn) startWorkoutBtn.addEventListener('click', () => startFreeWorkout());

  // Удаление записей за сегодня
  function askConfirm(text) {
    return new Promise(resolve => {
      const canUseTg = tg && typeof tg.showConfirm === 'function' &&
        (typeof tg.isVersionAtLeast !== 'function' || tg.isVersionAtLeast('6.2'));
      if (canUseTg) {
        try { tg.showConfirm(text, ok => resolve(!!ok)); return; } catch (_) {}
      }
      try { resolve(window.confirm(text)); } catch (_) { resolve(true); }
    });
  }

  function plural(n, forms) {
    const a = Math.abs(n) % 100;
    const b = a % 10;
    if (a > 10 && a < 20) return forms[2];
    if (b > 1 && b < 5) return forms[1];
    if (b === 1) return forms[0];
    return forms[2];
  }

  async function deleteWorkoutRows(rows, label, mode) {
    const list = (rows || []).filter(Boolean);
    if (!list.length) return;
    const ok = await askConfirm('Удалить ' + label + '? Это действие нельзя отменить.');
    if (!ok) return;

    const ids = list.map(r => r.id).filter(id => id && !String(id).startsWith('local-'));
    const localIds = list.map(r => r.id).filter(id => id && String(id).startsWith('local-'));
    const byDay = mode === 'day';

    if (byDay || ids.length) {
      const dayStart = startOfDay(new Date());
      const dayEnd = addDays(dayStart, 1);
      try {
        await api('delete_workout', byDay
          ? { from: dayStart.toISOString(), to: dayEnd.toISOString(), day: dayKey(new Date()) }
          : { ids: ids });
      } catch (err) {
        const msg = String((err && err.message) || '');
        toast(/non-2xx|unknown|invalid|not found|does not exist/i.test(msg)
          ? 'Сервер не умеет удалять: проверь действие delete_workout в Edge Function'
          : 'Не удалось удалить: ' + msg, 'err');
        return;
      }
    }

    if (byDay) {
      const today = dayKey(new Date());
      state.workouts = state.workouts.filter(w => dayKey(parseDate(w.logged_at)) !== today);
    } else {
      const drop = new Set(ids.concat(localIds).map(String));
      state.workouts = state.workouts.filter(w => !drop.has(String(w.id)));
    }

    markPRs();
    saveCache();
    renderWorkouts();
    renderHome();
    haptic('ok');
    toast('Удалено: ' + label, 'ok');
  }

  document.addEventListener('click', (e) => {
    const rowBtn = e.target.closest('[data-del-row]');
    if (rowBtn) {
      e.preventDefault();
      const row = state.workouts.find(w => String(w.id) === String(rowBtn.dataset.delRow));
      if (row) deleteWorkoutRows([row], 'запись «' + (row.exercise || 'без названия') + '»');
      return;
    }
    const dayBtn = e.target.closest('[data-del-day]');
    if (dayBtn) {
      e.preventDefault();
      const key = dayBtn.dataset.delDay;
      const rows = state.workouts.filter(w => dayKey(parseDate(w.logged_at)) === key);
      if (rows.length) deleteWorkoutRows(rows, 'все подходы за сегодня (' + rows.length + ' ' + plural(rows.length, ['запись', 'записи', 'записей']) + ')', 'day');
      return;
    }
    const clearBtn = e.target.closest('#wo-clear-today');
    if (clearBtn) {
      e.preventDefault();
      const rows = state.workouts.filter(w => sameDay(parseDate(w.logged_at), new Date()));
      if (rows.length) deleteWorkoutRows(rows, 'все подходы за сегодня (' + rows.length + ' ' + plural(rows.length, ['запись', 'записи', 'записей']) + ')', 'day');
    }
  });

  // Вода
  document.addEventListener('click', (e) => {
    const add = e.target.closest('[data-water]');
    if (add) { waterAdd(Number(add.dataset.water) || 0); haptic('light'); return; }
    if (e.target.closest('#water-reset')) { waterReset(); haptic('light'); toast('Вода за сегодня сброшена'); }
  });

  const sheetEl = $('#sheet');
  if (sheetEl) {
    sheetEl.addEventListener('click', (e) => {
      if (e.target.closest('[data-sheet-close]') || e.target.closest('[data-sheet-close-btn]')) { closeSheet(); return; }
      if (e.target.closest('[data-wo-finish-close]')) { closeSheet(); activeWorkout = null; renderHome(); return; }
      if (e.target.closest('[data-wo-finish]')) { finishWorkout(); return; }
      const setBtn = e.target.closest('[data-wo-set]');
      if (setBtn) { logActiveSet(Number(setBtn.dataset.woSet)); }
    });
  }
  const sheetOverlayEl = $('#sheet-overlay');
  if (sheetOverlayEl) {
    sheetOverlayEl.addEventListener('click', (e) => {
      if (e.target === sheetOverlayEl) closeSheet();
    });
  }
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeSheet();
  });

  const bell = $('#top-bell');
  if (bell) {
    bell.addEventListener('click', () => {
      haptic('select');
      if (state.tab !== 'profile') showTab('profile', true);
      setTimeout(() => { const el = $('#notif-list'); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' }); }, 120);
    });
  }

  const readAll = $('#notif-read-all');
  if (readAll) {
    readAll.addEventListener('click', () => {
      markNotifRead(computeNotifications().map(n => n.id));
      renderNotifications();
      toast('Уведомления прочитаны', 'ok');
    });
  }

  const themeTeal = $('#theme-teal');
  const themeEnergy = $('#theme-energy');
  if (themeTeal) themeTeal.addEventListener('click', () => setTheme('teal'));
  if (themeEnergy) themeEnergy.addEventListener('click', () => setTheme('energy'));

  const csvBtn = $('#export-csv-btn');
  if (csvBtn) csvBtn.addEventListener('click', exportCSV);

  /* ============================================================
     28. Загрузка и старт
     ============================================================ */
  async function loadAll() {
    const results = await Promise.all([
      apiRetry('get_profile'),
      apiRetry('get_workouts', {}),
      apiRetry('get_weight_log')
    ]);
    state.profile = (results[0] && results[0].profile) || null;
    state.workouts = (results[1] && results[1].workouts) || [];
    setWeights(results[2] && results[2].entries);
    markPRs();
    saveCache();
  }

  initChartDefaults();
  applyTheme(store.get(LS.theme) || 'teal');
  initPWA();

  if (!isTelegram && !syncCode) {
    $('#auth').classList.remove('hidden');
    const authInput = $('#sync-input');
    if (authInput) setTimeout(() => { try { authInput.focus(); } catch (_) {} }, 220);
    return;
  }

  $('#shell').classList.remove('hidden');
  buildExerciseSelect();
  if (!isTelegram) $('#logout-btn').classList.remove('hidden');

  // Мгновенный рендер из кэша, затем тихое обновление с сервера
  const hadCache = loadCache();

  let startTab = 'home';
  try { startTab = sessionStorage.getItem('trek_tab') || 'home'; } catch (_) {}
  showTab(startTab, false);
  flushQueue().catch(() => {});

  loadAll().then(() => {
    syncExerciseUI(true);
    renderTab(state.tab);
  }).catch((err) => {
    console.error(err);
    if (!hadCache) toast('Не удалось загрузить данные: ' + err.message, 'err');
    else toast('Показаны сохранённые данные — нет связи', 'err');
  });
})();
