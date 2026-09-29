/* CarLog — 汽車持有成本工具(純靜態 + localStorage) */
'use strict';

const VERSION = 'v0.2.0';
const STORAGE_KEY = 'carlog.v1';

const CATEGORIES = [
  { id: 'price',       name: '車價',        group: 'once',     icon: '🚗' },
  { id: 'reg',         name: '領牌/規費',   group: 'once',     icon: '📋' },
  { id: 'charger',     name: '充電樁',      group: 'once',     icon: '🔌' },
  { id: 'accessory',   name: '配件',        group: 'once',     icon: '🧰' },
  { id: 'insurance',   name: '保險',        group: 'fixed',    icon: '🛡️' },
  { id: 'tax',         name: '牌照稅/燃料費', group: 'fixed',  icon: '🏛️' },
  { id: 'charging',    name: '充電',        group: 'variable', icon: '⚡' },
  { id: 'maintenance', name: '保養/維修',   group: 'variable', icon: '🔧' },
  { id: 'parking',     name: '停車',        group: 'variable', icon: '🅿️' },
  { id: 'toll',        name: '過路費',      group: 'variable', icon: '🛣️' },
  { id: 'wash',        name: '洗車',        group: 'variable', icon: '🫧' },
  { id: 'fine',        name: '罰單',        group: 'variable', icon: '🎫' },
  { id: 'other',       name: '其他',        group: 'variable', icon: '📦' },
];
const CAT = Object.fromEntries(CATEGORIES.map(c => [c.id, c]));
const GROUPS = { once: '一次性', fixed: '固定週期', variable: '變動' };
const PALETTE = ['#34d399', '#60a5fa', '#f472b6', '#fbbf24', '#a78bfa', '#fb923c', '#22d3ee', '#f87171', '#a3e635', '#e879f9', '#38bdf8', '#facc15', '#94a3b8'];
const CAT_COLOR = Object.fromEntries(CATEGORIES.map((c, i) => [c.id, PALETTE[i % PALETTE.length]]));

/* ---------- state ---------- */
function defaultState() {
  return {
    version: 1,
    car: { name: 'Tesla Model Y', deliveryDate: '', deliveryOdo: 0 },
    settings: { includePrice: true, chartWindow: 'all', statsPeriod: 'all', fuelKmPerL: 12, fuelPricePerL: 30, fuelCarTaxYear: 17410, evTaxYear: 0 },
    expenses: [],   // {id, date, category, amount, note, kwh?, updatedAt}
    odometer: [],   // {id, date, km, updatedAt}
    deleted: {},    // 已刪除 id → 刪除時間(同步用墓碑)
    meta: { updatedAt: 0 },
  };
}
let state = load();

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState();
    const parsed = JSON.parse(raw);
    return normalize(parsed);
  } catch (e) {
    console.warn('load failed', e);
    return defaultState();
  }
}
function normalize(obj) {
  const d = defaultState();
  const s = Object.assign(d, obj || {});
  s.car = Object.assign(d.car, obj?.car || {});
  s.settings = Object.assign(d.settings, obj?.settings || {});
  s.expenses = Array.isArray(obj?.expenses) ? obj.expenses.filter(e => e && e.date && CAT[e.category] && isFinite(+e.amount)) : [];
  s.odometer = Array.isArray(obj?.odometer) ? obj.odometer.filter(o => o && o.date && isFinite(+o.km)) : [];
  s.expenses.forEach(e => { e.amount = +e.amount; if (e.kwh != null) e.kwh = +e.kwh || null; });
  s.odometer.forEach(o => { o.km = +o.km; });
  s.deleted = (obj?.deleted && typeof obj.deleted === 'object') ? obj.deleted : {};
  s.meta = Object.assign(d.meta, obj?.meta || {});
  return s;
}
function save() {
  state.meta.updatedAt = Date.now();
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
  catch (e) { toast('儲存失敗:' + e.message); }
  Sync.schedulePush();
}

/* ---------- utils ---------- */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const pad2 = n => String(n).padStart(2, '0');
function todayStr() { const d = new Date(); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; }
function parseDate(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }
function dayDiff(a, b) { return Math.round((b - a) / 86400000); }
function addDays(dateStr, n) { const d = parseDate(dateStr); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; }
function monthKey(s) { return s.slice(0, 7); }
function fmt(n, digits = 0) { if (!isFinite(n)) return '—'; return n.toLocaleString('zh-TW', { maximumFractionDigits: digits, minimumFractionDigits: 0 }); }
function fmtWan(n) { if (!isFinite(n)) return '—'; const a = Math.abs(n); if (a >= 1e4) return (n / 1e4).toFixed(a >= 1e6 ? 0 : 1).replace(/\.0$/, '') + ' 萬'; return fmt(n); }
function fmtMD(s) { const [, m, d] = s.split('-'); return `${+m}/${+d}`; }
function fmtYMD(s) { const [y, m, d] = s.split('-'); return `${y}/${+m}/${+d}`; }
function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
let toastTimer;
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 1800); }

/* ---------- computations ---------- */
function daysOwned() {
  if (!state.car.deliveryDate) return 0;
  return Math.max(1, dayDiff(parseDate(state.car.deliveryDate), parseDate(todayStr())) + 1);
}
function expensesInScope(includePrice, upToToday = true) {
  const today = todayStr();
  return state.expenses.filter(e => (includePrice || e.category !== 'price') && (!upToToday || e.date <= today));
}
function sum(arr) { return arr.reduce((a, e) => a + e.amount, 0); }

// 每日持有成本序列:series[i] = 前 i+1 天累計支出 / (i+1)
function dailySeries(includePrice) {
  const n = daysOwned();
  if (!n) return [];
  const start = parseDate(state.car.deliveryDate);
  const per = new Float64Array(n);
  for (const e of expensesInScope(includePrice)) {
    const idx = Math.max(0, dayDiff(start, parseDate(e.date)));
    if (idx < n) per[idx] += e.amount;
  }
  const out = new Array(n);
  let cum = 0;
  for (let i = 0; i < n; i++) { cum += per[i]; out[i] = cum / (i + 1); }
  return out;
}

// 里程:交車里程當第一個快照,其後線性內插;超過最後一筆不外推
function odoPoints() {
  const pts = [{ date: state.car.deliveryDate, km: +state.car.deliveryOdo || 0 }, ...state.odometer]
    .filter(p => p.date)
    .sort((a, b) => a.date.localeCompare(b.date) || a.km - b.km);
  return pts;
}
function kmAt(dateStr) {
  const pts = odoPoints();
  if (!pts.length) return 0;
  if (dateStr <= pts[0].date) return pts[0].km;
  for (let i = 1; i < pts.length; i++) {
    if (dateStr <= pts[i].date) {
      const a = pts[i - 1], b = pts[i];
      const span = dayDiff(parseDate(a.date), parseDate(b.date));
      if (span <= 0) return b.km;
      const t = dayDiff(parseDate(a.date), parseDate(dateStr)) / span;
      return a.km + (b.km - a.km) * t;
    }
  }
  return pts[pts.length - 1].km;
}
function kmDrivenInfo() {
  const pts = odoPoints();
  const first = pts[0];
  const last = pts[pts.length - 1];
  if (!first || pts.length < 2) return { km: 0, asOf: null, days: 0 };
  const km = Math.max(0, last.km - first.km);
  const days = Math.max(1, dayDiff(parseDate(first.date), parseDate(last.date)) + 1);
  return { km, asOf: last.date, days, perDay: km / days };
}

function compareData() {
  const s = state.settings;
  const info = kmDrivenInfo();
  const days = daysOwned();
  const charging = expensesInScope(true).filter(e => e.category === 'charging');
  const chargingCost = sum(charging);
  const kwh = charging.reduce((a, e) => a + (e.kwh || 0), 0);
  const fuelCost = info.km / (s.fuelKmPerL || 1) * s.fuelPricePerL;
  const fuelTax = s.fuelCarTaxYear * days / 365;
  const evTax = s.evTaxYear * days / 365;
  const saved = fuelCost + fuelTax - chargingCost - evTax;
  return {
    ...info, days, chargingCost, kwh, fuelCost, fuelTax, evTax, saved,
    perKmEv: info.km > 0 ? chargingCost / info.km : NaN,
    perKmFuel: s.fuelPricePerL / (s.fuelKmPerL || 1),
    savedPerMonth: saved / Math.max(1, days / 30.4),
  };
}

function monthlyTotals(includePrice, months = 12) {
  const now = new Date();
  const keys = [];
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    keys.push(`${d.getFullYear()}-${pad2(d.getMonth() + 1)}`);
  }
  const map = Object.fromEntries(keys.map(k => [k, 0]));
  for (const e of expensesInScope(includePrice, false)) {
    const k = monthKey(e.date);
    if (k in map) map[k] += e.amount;
  }
  return keys.map(k => ({ key: k, total: map[k] }));
}
function periodFilter(period) {
  const t = todayStr();
  if (period === 'month') return e => monthKey(e.date) === monthKey(t);
  if (period === 'year') return e => e.date.slice(0, 4) === t.slice(0, 4);
  return () => true;
}
function categoryTotals(includePrice, period) {
  const f = periodFilter(period);
  const map = {};
  for (const e of expensesInScope(includePrice, false)) if (f(e)) map[e.category] = (map[e.category] || 0) + e.amount;
  return CATEGORIES.map(c => ({ id: c.id, name: c.name, group: c.group, total: map[c.id] || 0 })).filter(x => x.total > 0).sort((a, b) => b.total - a.total);
}

/* ---------- SVG charts ---------- */
function niceTicks(min, max, count = 4) {
  if (!(max > min)) return [min];
  const raw = (max - min) / count;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const step = (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag;
  const ticks = [];
  for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) ticks.push(v);
  return ticks;
}
function shortNum(n) {
  if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(n % 1e6 ? 1 : 0) + 'M';
  if (Math.abs(n) >= 1e4) return Math.round(n / 1e3) + 'k';
  if (Math.abs(n) >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'k';
  return fmt(n);
}

function renderLineChart(svg, data, opts) {
  // data: [{x: dateStr, y: number}]
  const W = 520, H = 220, L = 50, R = 14, T = 14, B = 28;
  svg.innerHTML = '';
  if (data.length < 1) { svg.innerHTML = `<text x="${W / 2}" y="${H / 2}" fill="#8a97b0" font-size="13" text-anchor="middle">還沒有資料</text>`; return; }
  const ys = data.map(d => d.y);
  let yMin = opts.yMin ?? 0, yMax = opts.yMax ?? Math.max(...ys);
  if (yMax <= yMin) yMax = yMin + 1;
  const iw = W - L - R, ih = H - T - B;
  const xOf = i => L + (data.length === 1 ? iw / 2 : i / (data.length - 1) * iw);
  const yOf = v => T + ih - (Math.min(v, yMax) - yMin) / (yMax - yMin) * ih;
  let g = '';
  // y grid
  for (const t of niceTicks(yMin, yMax, 4)) {
    const y = yOf(t);
    g += `<line x1="${L}" x2="${W - R}" y1="${y}" y2="${y}" stroke="#24304a" stroke-width="1"/>`;
    g += `<text x="${L - 6}" y="${y + 4}" fill="#8a97b0" font-size="11" text-anchor="end">${shortNum(t)}</text>`;
  }
  // x labels
  const xt = Math.min(data.length, 4);
  for (let k = 0; k < xt; k++) {
    const i = xt === 1 ? 0 : Math.round(k / (xt - 1) * (data.length - 1));
    g += `<text x="${xOf(i)}" y="${H - 8}" fill="#8a97b0" font-size="11" text-anchor="${k === 0 ? 'start' : k === xt - 1 ? 'end' : 'middle'}">${fmtMD(data[i].x)}</text>`;
  }
  const pts = data.map((d, i) => `${xOf(i).toFixed(1)},${yOf(d.y).toFixed(1)}`);
  const path = 'M' + pts.join(' L');
  const area = path + ` L${xOf(data.length - 1).toFixed(1)},${T + ih} L${xOf(0).toFixed(1)},${T + ih} Z`;
  g += `<defs><linearGradient id="lg-${svg.id}" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#34d399" stop-opacity="0.35"/><stop offset="1" stop-color="#34d399" stop-opacity="0"/></linearGradient>
        <clipPath id="cp-${svg.id}"><rect x="${L}" y="${T}" width="${iw}" height="${ih}"/></clipPath></defs>`;
  g += `<g clip-path="url(#cp-${svg.id})"><path d="${area}" fill="url(#lg-${svg.id})"/><path d="${path}" fill="none" stroke="#34d399" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/></g>`;
  const last = data[data.length - 1];
  const lx = xOf(data.length - 1), ly = yOf(last.y);
  g += `<circle cx="${lx}" cy="${ly}" r="4.5" fill="#34d399" stroke="#0b1220" stroke-width="2"/>`;
  const label = fmt(last.y) + ' 元/天';
  const lw = label.length * 7 + 12;
  const lxx = Math.min(lx + 8, W - R - lw);
  const lyy = Math.max(T + 2, ly - 26);
  g += `<rect x="${lxx}" y="${lyy}" width="${lw}" height="20" rx="6" fill="#34d399"/><text x="${lxx + lw / 2}" y="${lyy + 14}" fill="#062015" font-size="11.5" font-weight="700" text-anchor="middle">${label}</text>`;
  svg.innerHTML = g;
}

function renderBarChart(svg, bars) {
  // bars: [{label, value, hot}]
  const W = 520, H = 200, L = 46, R = 10, T = 16, B = 26;
  const iw = W - L - R, ih = H - T - B;
  const max = Math.max(1, ...bars.map(b => b.value));
  const ticks0 = niceTicks(0, max * 1.1, 3);
  const step = ticks0.length > 1 ? ticks0[1] - ticks0[0] : max;
  const yMax = Math.ceil(max * 1.1 / step) * step;
  let g = '';
  for (const t of niceTicks(0, yMax, 3)) {
    const y = T + ih - t / yMax * ih;
    g += `<line x1="${L}" x2="${W - R}" y1="${y}" y2="${y}" stroke="#24304a"/>`;
    g += `<text x="${L - 6}" y="${y + 4}" fill="#8a97b0" font-size="11" text-anchor="end">${shortNum(t)}</text>`;
  }
  const slot = iw / bars.length, bw = slot * 0.62;
  bars.forEach((b, i) => {
    const x = L + i * slot + (slot - bw) / 2;
    const h = b.value / yMax * ih;
    const y = T + ih - h;
    g += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" rx="4" fill="${b.hot ? '#34d399' : '#3b5580'}"/>`;
    if (b.value > 0 && h > 2) g += `<text x="${(x + bw / 2).toFixed(1)}" y="${(y - 4).toFixed(1)}" fill="${b.hot ? '#34d399' : '#8a97b0'}" font-size="10" text-anchor="middle">${shortNum(b.value)}</text>`;
    g += `<text x="${(x + bw / 2).toFixed(1)}" y="${H - 8}" fill="${b.hot ? '#e5eaf3' : '#8a97b0'}" font-size="11" text-anchor="middle">${b.label}</text>`;
  });
  svg.innerHTML = g;
}

function renderDonut(svg, slices, centerLabel, centerValue) {
  const W = 520, H = 240, cx = W / 2, cy = H / 2, r = 90, rin = 58;
  const total = slices.reduce((a, s) => a + s.value, 0);
  if (!total) { svg.innerHTML = `<text x="${cx}" y="${cy}" fill="#8a97b0" font-size="13" text-anchor="middle">這段期間沒有支出</text>`; return; }
  let g = '', a0 = -Math.PI / 2;
  const arc = (a1, a2) => {
    if (a2 - a1 >= Math.PI * 2 - 1e-6) a2 = a1 + Math.PI * 2 - 1e-4;
    const p = (rr, a) => `${(cx + rr * Math.cos(a)).toFixed(2)},${(cy + rr * Math.sin(a)).toFixed(2)}`;
    const big = a2 - a1 > Math.PI ? 1 : 0;
    return `M${p(r, a1)} A${r},${r} 0 ${big} 1 ${p(r, a2)} L${p(rin, a2)} A${rin},${rin} 0 ${big} 0 ${p(rin, a1)} Z`;
  };
  for (const s of slices) {
    const a1 = a0 + s.value / total * Math.PI * 2;
    g += `<path d="${arc(a0, a1)}" fill="${s.color}" stroke="#131c2e" stroke-width="2"/>`;
    a0 = a1;
  }
  g += `<text x="${cx}" y="${cy - 6}" fill="#8a97b0" font-size="12" text-anchor="middle">${centerLabel}</text>`;
  g += `<text x="${cx}" y="${cy + 16}" fill="#e5eaf3" font-size="18" font-weight="800" text-anchor="middle">${centerValue}</text>`;
  svg.innerHTML = g;
}

/* ---------- rendering ---------- */
function setSeg(id, value) { $$(`#${id} button`).forEach(b => b.classList.toggle('on', b.dataset.v === value)); }

function renderHome() {
  const inc = state.settings.includePrice;
  $('#home-car').textContent = state.car.name;
  $('#home-sync').textContent = Sync.enabled() ? Sync.icon() : '';
  $('#home-sync').title = Sync.statusText();
  setSeg('seg-scope', inc ? 'all' : 'ops');
  setSeg('seg-window', state.settings.chartWindow);
  const series = dailySeries(inc);
  const days = series.length;
  const total = sum(expensesInScope(inc));
  const daily = days ? series[days - 1] : 0;
  $('#home-daily').textContent = fmt(daily);
  $('#home-days').textContent = fmt(days);
  $('#home-total').textContent = fmt(total);

  // chart
  const start = state.car.deliveryDate;
  const win = state.settings.chartWindow;
  const n = win === 'all' ? days : Math.min(days, +win);
  const from = days - n;
  const data = [];
  for (let i = from; i < days; i++) data.push({ x: addDays(start, i), y: series[i] });
  let opts = {}, note = '';
  if (data.length) {
    const ys = data.map(d => d.y);
    if (win === 'all') {
      // 1/x 曲線前段會把 y 軸撐爆:把 y 上限設在「跳過前 10%(至少 7 天)後」的最大值
      const skip = Math.min(data.length - 1, Math.max(7, Math.floor(data.length * 0.1)));
      const yMax = Math.max(...ys.slice(skip)) * 1.08;
      const clipped = Math.max(...ys) > yMax;
      opts = { yMin: 0, yMax: yMax || undefined };
      if (clipped) note = '前段數值超出範圍已截斷';
    } else {
      const mn = Math.min(...ys), mx = Math.max(...ys);
      const pad = Math.max((mx - mn) * 0.6, mx * 0.05, 1);
      opts = { yMin: Math.max(0, mn - pad), yMax: mx + pad };
    }
  }
  renderLineChart($('#chart-daily'), data, opts);
  $('#chart-daily-note').textContent = note;

  // stats
  const t = todayStr();
  const scoped = expensesInScope(inc, false);
  const monthTotal = sum(scoped.filter(e => monthKey(e.date) === monthKey(t)));
  $('#home-month').textContent = fmtWan(monthTotal);
  $('#home-avg-month').textContent = fmtWan(total / Math.max(1, days / 30.4));
  const km = kmDrivenInfo();
  $('#home-perkm').textContent = km.km > 0 ? fmt(total / km.km, 1) : '—';
  $('#home-perkm').title = km.km > 0 ? `以里程快照 ${fmt(km.km)} km 計` : '需要至少一筆里程快照';

  // recent
  const recent = [...state.expenses].sort((a, b) => b.date.localeCompare(a.date) || (b.id > a.id ? 1 : -1)).slice(0, 5);
  $('#home-recent').innerHTML = recent.length ? recent.map(itemHTML).join('') : '<div class="empty">還沒有支出,按右下角 + 新增第一筆</div>';

  // odometer
  if (km.asOf) {
    $('#home-odo').innerHTML = `截至 <b>${fmtYMD(km.asOf)}</b>:里程表 <b>${fmt(kmAt(km.asOf))}</b> km,已跑 <b>${fmt(km.km)}</b> km,平均每天 <b>${fmt(km.perDay, 1)}</b> km`;
  } else {
    $('#home-odo').textContent = '還沒有里程快照。偶爾抄一次里程表,就能算每公里成本與油車比較。';
  }
}

function itemHTML(e) {
  const c = CAT[e.category];
  const extra = e.category === 'charging' && e.kwh ? ` · ${fmt(e.kwh, 1)} kWh(${fmt(e.amount / e.kwh, 1)} 元/度)` : '';
  return `<div class="item" data-id="${e.id}">
    <div class="ic">${c.icon}</div>
    <div class="mid"><div class="cat">${c.name}</div><div class="meta">${fmtYMD(e.date)}${e.note ? ' · ' + esc(e.note) : ''}${extra}</div></div>
    <div class="amt">${fmt(e.amount)}</div>
  </div>`;
}

let expFilter = 'all';
function renderExpenses() {
  const all = [...state.expenses].sort((a, b) => b.date.localeCompare(a.date) || (b.id > a.id ? 1 : -1));
  $('#exp-count').textContent = `${all.length} 筆 · 共 ${fmt(sum(all))} 元`;
  const filters = [['all', '全部'], ...Object.entries(GROUPS)];
  $('#exp-filter').innerHTML = filters.map(([k, v]) => `<span class="chip ${expFilter === k ? 'on' : ''}" data-f="${k}">${v}</span>`).join('');
  const list = expFilter === 'all' ? all : all.filter(e => CAT[e.category].group === expFilter);
  if (!list.length) { $('#exp-list').innerHTML = '<div class="empty">沒有符合的支出</div>'; return; }
  const groups = {};
  for (const e of list) (groups[monthKey(e.date)] ||= []).push(e);
  $('#exp-list').innerHTML = Object.entries(groups).map(([k, arr]) => {
    const [y, m] = k.split('-');
    return `<div class="month-head"><span>${y} 年 ${+m} 月</span><span>${fmt(sum(arr))} 元</span></div><div class="list">${arr.map(itemHTML).join('')}</div>`;
  }).join('');
}

function renderStats() {
  const inc = $('#stats-inc-price').checked;
  const period = state.settings.statsPeriod;
  setSeg('seg-period', period);
  const months = monthlyTotals(inc);
  const cur = monthKey(todayStr());
  renderBarChart($('#chart-month'), months.map(m => ({ label: `${+m.key.slice(5)}月`, value: m.total, hot: m.key === cur })));
  const nonzero = months.filter(m => m.total > 0);
  $('#chart-month-note').textContent = nonzero.length ? `有支出的月份平均 ${fmt(sum(nonzero.map(m => ({ amount: m.total }))) / nonzero.length)} 元/月${inc ? '' : '(不含車價)'}` : '';

  const cats = categoryTotals(inc, period);
  const total = cats.reduce((a, c) => a + c.total, 0);
  const label = { month: '本月', year: '今年', all: '全部' }[period];
  renderDonut($('#chart-cat'), cats.map(c => ({ value: c.total, color: CAT_COLOR[c.id] })), label + '合計', fmt(total) + ' 元');
  $('#legend-cat').innerHTML = cats.map(c => `<div><span class="l"><i style="background:${CAT_COLOR[c.id]}"></i>${CAT[c.id].icon} ${c.name}</span><span>${fmt(c.total)} <span class="tag">${(c.total / total * 100).toFixed(0)}%</span></span></div>`).join('');

  const g = { once: 0, fixed: 0, variable: 0 };
  for (const c of cats) g[c.group] += c.total;
  $('#stats-groups').innerHTML = Object.entries(GROUPS).map(([k, v]) => `<div class="stat"><div class="k">${v}</div><div class="v">${fmtWan(g[k])}</div></div>`).join('');
}

function renderCompare() {
  const s = state.settings;
  $('#cmp-kmpl').value = s.fuelKmPerL;
  $('#cmp-price').value = s.fuelPricePerL;
  $('#cmp-fueltax').value = s.fuelCarTaxYear;
  $('#cmp-evtax').value = s.evTaxYear;
  const d = compareData();
  const body = $('#compare-body');
  if (!d.asOf) {
    body.innerHTML = `<div class="card hero"><div class="label">開電車至今省下</div><div class="big">—</div>
      <div class="sub">需要至少一筆里程快照才能比較。</div>
      <div class="btn-row"><button class="ghost" id="cmp-add-odo">記一次里程</button></div></div>`;
    return;
  }
  const good = d.saved >= 0;
  body.innerHTML = `
    <div class="card hero">
      <div class="label">開電車至今${good ? '省下' : '多花'}</div>
      <div class="big" style="color:${good ? 'var(--accent)' : 'var(--danger)'}">${fmt(Math.abs(d.saved))}<small>元</small></div>
      <div class="sub">里程截至 <b>${fmtYMD(d.asOf)}</b> 共 <b>${fmt(d.km)}</b> km · 平均每月${good ? '省' : '多'} <b>${fmt(Math.abs(d.savedPerMonth))}</b> 元</div>
    </div>
    <div class="card">
      <div class="vs">
        <div class="side"><div class="t">⚡ 這台車 充電</div><div class="n">${fmt(d.chargingCost)}</div><div class="t">${isFinite(d.perKmEv) ? fmt(d.perKmEv, 2) + ' 元/km' : ''}</div></div>
        <div class="mid">vs</div>
        <div class="side"><div class="t">⛽ 對照油車 油錢</div><div class="n">${fmt(d.fuelCost)}</div><div class="t">${fmt(d.perKmFuel, 2)} 元/km</div></div>
      </div>
      <div class="breakdown">
        <div><span>油車油錢(${fmt(d.km)} km ÷ ${s.fuelKmPerL} km/L × ${s.fuelPricePerL} 元)</span><span>+${fmt(d.fuelCost)}</span></div>
        <div><span>油車稅費(${fmt(s.fuelCarTaxYear)} 元/年 × ${d.days} 天)</span><span>+${fmt(d.fuelTax)}</span></div>
        <div><span>電車充電(實際記錄)</span><span>−${fmt(d.chargingCost)}</span></div>
        <div><span>電車稅費(${fmt(s.evTaxYear)} 元/年 × ${d.days} 天)</span><span>−${fmt(d.evTax)}</span></div>
        <div><span>${good ? '省下' : '多花'}</span><span>${fmt(Math.abs(d.saved))} 元</span></div>
      </div>
      ${d.kwh > 0 ? `<div class="note">充電已記 ${fmt(d.kwh, 1)} kWh:平均 ${fmt(d.chargingCost / d.kwh, 2)} 元/度、每度約跑 ${fmt(d.km / d.kwh, 1)} km(以總里程估)</div>` : '<div class="note">記充電時順手填度數(kWh),就能看到每度電價與電耗。</div>'}
    </div>`;
}

function renderSettings() {
  $('#set-name').value = state.car.name;
  $('#set-date').value = state.car.deliveryDate;
  $('#set-odo').value = state.car.deliveryOdo;
  const list = [...state.odometer].sort((a, b) => b.date.localeCompare(a.date));
  $('#set-odo-list').innerHTML = list.length ? list.map(o => `<div class="item" data-odo="${o.id}"><div class="ic">🛞</div><div class="mid"><div class="cat">${fmt(o.km)} km</div><div class="meta">${fmtYMD(o.date)}</div></div></div>`).join('') : '<div class="empty">還沒有里程快照</div>';
  $('#ver').textContent = VERSION;
  renderSyncCard();
}
function renderSyncCard() {
  const on = Sync.enabled();
  $('#sync-form').style.display = on ? 'none' : '';
  $('#sync-on').style.display = on ? '' : 'none';
  if (!on) $('#sync-repo').value = Sync.cfg()?.repo || 'HSIN-PAI/carlog-data';
  else $('#sync-repo-label').textContent = Sync.cfg().repo;
  $('#sync-status').textContent = Sync.statusText();
}

/* ---------- navigation ---------- */
let currentView = 'home';
function show(view) {
  currentView = view;
  $$('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + view));
  $$('nav.bottom button').forEach(b => b.classList.toggle('on', b.dataset.nav === view));
  $('nav.bottom').style.display = view === 'onboard' ? 'none' : '';
  $('#fab').classList.toggle('show', view === 'home' || view === 'expenses');
  render();
  window.scrollTo(0, 0);
}
function render() {
  if (currentView === 'home') renderHome();
  else if (currentView === 'expenses') renderExpenses();
  else if (currentView === 'stats') renderStats();
  else if (currentView === 'compare') renderCompare();
  else if (currentView === 'settings') renderSettings();
}

/* ---------- sheets ---------- */
let editingExpense = null, editingOdo = null;
function openSheet(id) { $('#sheet-bg').classList.add('open'); $('#' + id).classList.add('open'); }
function closeSheets() { $('#sheet-bg').classList.remove('open'); $$('.sheet').forEach(s => s.classList.remove('open')); }

function openExpense(e) {
  editingExpense = e || null;
  $('#sheet-expense-title').textContent = e ? '編輯支出' : '新增支出';
  const cat = e ? e.category : (localStorage.getItem('carlog.lastCat') || 'charging');
  $('#exp-cats').innerHTML = CATEGORIES.map(c => `<span class="chip ${c.id === cat ? 'on' : ''}" data-cat="${c.id}">${c.icon} ${c.name}</span>`).join('');
  $('#exp-amount').value = e ? e.amount : '';
  $('#exp-date').value = e ? e.date : todayStr();
  $('#exp-note').value = e ? (e.note || '') : '';
  $('#exp-kwh').value = e && e.kwh ? e.kwh : '';
  $('#exp-kwh-field').style.display = cat === 'charging' ? '' : 'none';
  $('#exp-delete').style.display = e ? '' : 'none';
  openSheet('sheet-expense');
  if (!e) setTimeout(() => $('#exp-amount').focus(), 250);
}
function saveExpense() {
  const cat = $('#exp-cats .chip.on')?.dataset.cat;
  const amount = parseFloat($('#exp-amount').value);
  const date = $('#exp-date').value;
  if (!cat) return toast('請選分類');
  if (!(amount >= 0)) return toast('請輸入金額');
  if (!date) return toast('請選日期');
  const kwh = cat === 'charging' ? (parseFloat($('#exp-kwh').value) || null) : null;
  const note = $('#exp-note').value.trim();
  if (editingExpense) Object.assign(editingExpense, { category: cat, amount, date, note, kwh, updatedAt: Date.now() });
  else state.expenses.push({ id: uid(), category: cat, amount, date, note, kwh, updatedAt: Date.now() });
  localStorage.setItem('carlog.lastCat', cat);
  save(); closeSheets(); render(); toast(editingExpense ? '已更新' : '已新增');
}

function openOdo(o) {
  editingOdo = o || null;
  $('#odo-km').value = o ? o.km : '';
  $('#odo-date').value = o ? o.date : todayStr();
  $('#odo-delete').style.display = o ? '' : 'none';
  openSheet('sheet-odo');
  if (!o) setTimeout(() => $('#odo-km').focus(), 250);
}
function saveOdo() {
  const km = parseFloat($('#odo-km').value);
  const date = $('#odo-date').value;
  if (!(km >= 0)) return toast('請輸入里程');
  if (!date) return toast('請選日期');
  if (editingOdo) Object.assign(editingOdo, { km, date, updatedAt: Date.now() });
  else state.odometer.push({ id: uid(), km, date, updatedAt: Date.now() });
  save(); closeSheets(); render(); toast('已記錄里程');
}

/* ---------- backup ---------- */
function exportJSON() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `carlog-${todayStr().replace(/-/g, '')}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
function importJSON(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const obj = JSON.parse(reader.result);
      if (!obj || !Array.isArray(obj.expenses)) throw new Error('格式不符');
      const incoming = normalize(obj);
      if (!confirm(`匯入 ${incoming.expenses.length} 筆支出、${incoming.odometer.length} 筆里程,並覆蓋目前資料?`)) return;
      state = incoming; save(); show(state.car.deliveryDate ? 'home' : 'onboard'); toast('已匯入');
    } catch (e) { toast('匯入失敗:' + e.message); }
  };
  reader.readAsText(file);
}

/* ---------- 雲端同步(GitHub 私有 repo 的 carlog.json) ---------- */
const Sync = (() => {
  const KEY = 'carlog.sync';
  const UI_PREFS = ['includePrice', 'chartWindow', 'statsPeriod'];
  let cfg = null;
  try { cfg = JSON.parse(localStorage.getItem(KEY)) || null; } catch { cfg = null; }
  let timer = null, busy = false, dirty = false, queued = false;
  let status = { state: 'off', msg: '' };

  const enabled = () => !!(cfg && cfg.token && cfg.repo);
  function saveCfg() { if (cfg) localStorage.setItem(KEY, JSON.stringify(cfg)); else localStorage.removeItem(KEY); }
  function setStatus(st, msg) { status = { state: st, msg }; if (currentView === 'settings') $('#sync-status').textContent = statusText(); if (currentView === 'home') { const el = $('#home-sync'); if (el) { el.textContent = icon(); el.title = statusText(); } } }
  function statusText() {
    if (!enabled()) return '尚未連線。';
    const t = cfg.lastSync ? new Date(cfg.lastSync).toLocaleString('zh-TW', { hour12: false }) : '從未';
    if (status.state === 'syncing') return '同步中…';
    if (status.state === 'error') return `同步失敗:${status.msg}(上次成功:${t})`;
    if (dirty) return `有未同步的變更(上次成功:${t})`;
    return `已同步 · ${t}`;
  }
  function icon() { return status.state === 'error' ? '☁️⚠️' : status.state === 'syncing' || dirty ? '☁️…' : '☁️✓'; }

  function b64enc(str) { const bytes = new TextEncoder().encode(str); let bin = ''; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(bin); }
  function b64dec(b64) { const bin = atob(b64.replace(/\s/g, '')); const bytes = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i); return new TextDecoder().decode(bytes); }
  function api(path, opts = {}) {
    return fetch(`https://api.github.com/repos/${cfg.repo}/${path}`, {
      ...opts, cache: 'no-store',
      headers: { Authorization: `Bearer ${cfg.token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', ...(opts.headers || {}) },
    });
  }
  async function pull() {
    const r = await api(`contents/carlog.json?ref=main`);
    if (r.status === 404) return { sha: null, data: null };
    if (r.status === 401) throw new Error('token 無效或已過期');
    if (!r.ok) throw new Error(`GitHub ${r.status}`);
    const j = await r.json();
    let data = null;
    try { data = JSON.parse(b64dec(j.content)); } catch { data = null; }
    return { sha: j.sha, data };
  }
  async function push(sha) {
    const body = { message: `carlog ${new Date().toLocaleString('zh-TW', { hour12: false })}`, content: b64enc(JSON.stringify(state, null, 1)), branch: 'main' };
    if (sha) body.sha = sha;
    const r = await api('contents/carlog.json', { method: 'PUT', body: JSON.stringify(body) });
    if (r.status === 409 || r.status === 422) return false; // sha 衝突:別的裝置剛推過
    if (r.status === 401) throw new Error('token 無效或已過期');
    if (r.status === 403 || r.status === 404) throw new Error('token 沒有這個 repo 的寫入權限');
    if (!r.ok) throw new Error(`GitHub ${r.status}`);
    return true;
  }
  const canon = x => JSON.stringify(normalize(JSON.parse(JSON.stringify(x))));

  function mergeItems(a, b, deleted) {
    const map = new Map();
    for (const x of [...a, ...b]) { const cur = map.get(x.id); if (!cur || (x.updatedAt || 0) > (cur.updatedAt || 0)) map.set(x.id, x); }
    return [...map.values()].filter(x => !(deleted[x.id] && deleted[x.id] >= (x.updatedAt || 0)));
  }
  // 把 remote 合併進 state;回傳 state 是否被改到
  function mergeRemote(remote) {
    const before = canon(state);
    const deleted = { ...state.deleted };
    for (const [id, ts] of Object.entries(remote.deleted || {})) deleted[id] = Math.max(deleted[id] || 0, ts);
    const merged = normalize(JSON.parse(JSON.stringify(state)));
    merged.deleted = deleted;
    merged.expenses = mergeItems(state.expenses, remote.expenses, deleted);
    merged.odometer = mergeItems(state.odometer, remote.odometer, deleted);
    const remoteHasCar = !!remote.car?.deliveryDate;
    if (remoteHasCar && (remote.meta?.updatedAt || 0) > (state.meta?.updatedAt || 0) || (remoteHasCar && !state.car.deliveryDate)) {
      merged.car = { ...remote.car };
      const prefs = Object.fromEntries(UI_PREFS.map(k => [k, state.settings[k]]));
      merged.settings = { ...merged.settings, ...remote.settings, ...prefs };
      merged.meta = { updatedAt: remote.meta?.updatedAt || 0 };
    }
    const changed = canon(merged) !== before;
    if (changed) { state = merged; localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
    return changed;
  }

  async function syncNow(opts = {}) {
    if (!enabled()) return;
    if (busy) { queued = true; return; }
    busy = true; setStatus('syncing', '');
    try {
      let ok = false;
      for (let attempt = 0; attempt < 3 && !ok; attempt++) {
        const remote = await pull();
        let localChanged = false;
        if (remote.data) localChanged = mergeRemote(normalize(remote.data));
        if (localChanged) { render(); if (opts.announce) toast('已從雲端更新'); }
        const needPush = !remote.data || canon(remote.data) !== canon(state);
        if (!needPush) { ok = true; break; }
        ok = await push(remote.sha);
      }
      if (!ok) throw new Error('多次衝突,稍後再試');
      dirty = false; cfg.lastSync = Date.now(); saveCfg();
      setStatus('ok', '');
    } catch (e) {
      setStatus('error', e.message);
      if (opts.announce) toast('同步失敗:' + e.message);
    } finally {
      busy = false;
      if (queued) { queued = false; syncNow(); }
    }
  }
  function schedulePush() {
    if (!enabled()) return;
    dirty = true; setStatus(status.state === 'error' ? 'error' : 'ok', status.msg);
    clearTimeout(timer); timer = setTimeout(() => syncNow(), 1500);
  }
  async function connect(repo, token) {
    cfg = { repo: repo.trim().replace(/^https?:\/\/github\.com\//, '').replace(/\.git$/, ''), token: token.trim(), lastSync: 0 };
    saveCfg(); dirty = true;
    await syncNow({ announce: true });
    if (status.state === 'error') { cfg = null; saveCfg(); dirty = false; }
    return status.state !== 'error';
  }
  function disconnect() { cfg = null; saveCfg(); dirty = false; status = { state: 'off', msg: '' }; }

  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && enabled()) syncNow(); });
  window.addEventListener('online', () => { if (enabled() && dirty) syncNow(); });

  return { enabled, cfg: () => cfg, statusText, icon, syncNow, schedulePush, connect, disconnect };
})();

/* ---------- events ---------- */
function bind() {
  // nav
  document.addEventListener('click', ev => {
    const nav = ev.target.closest('[data-nav]');
    if (nav) show(nav.dataset.nav);
  });
  $('#fab').addEventListener('click', () => openExpense());
  $('#sheet-bg').addEventListener('click', closeSheets);

  // onboarding
  $('#ob-date').value = todayStr();
  $('#ob-go').addEventListener('click', () => {
    const date = $('#ob-date').value;
    if (!date) return toast('請選交車日');
    state.car.name = $('#ob-name').value.trim() || 'My Car';
    state.car.deliveryDate = date;
    state.car.deliveryOdo = parseFloat($('#ob-odo').value) || 0;
    const price = parseFloat($('#ob-price').value);
    if (price > 0 && !state.expenses.some(e => e.category === 'price')) state.expenses.push({ id: uid(), category: 'price', amount: price, date, note: '', kwh: null, updatedAt: Date.now() });
    save(); show('home'); toast('開始記錄吧!');
  });

  // home segs
  $('#seg-scope').addEventListener('click', ev => { const b = ev.target.closest('button'); if (!b) return; state.settings.includePrice = b.dataset.v === 'all'; save(); renderHome(); });
  $('#seg-window').addEventListener('click', ev => { const b = ev.target.closest('button'); if (!b) return; state.settings.chartWindow = b.dataset.v; save(); renderHome(); });
  $('#btn-add-odo').addEventListener('click', () => openOdo());
  $('#btn-add-odo-2').addEventListener('click', () => openOdo());
  document.addEventListener('click', ev => { if (ev.target.id === 'cmp-add-odo') openOdo(); });

  // expense items (home + list)
  document.addEventListener('click', ev => {
    const it = ev.target.closest('.item[data-id]');
    if (it) { const e = state.expenses.find(x => x.id === it.dataset.id); if (e) openExpense(e); }
    const od = ev.target.closest('.item[data-odo]');
    if (od) { const o = state.odometer.find(x => x.id === od.dataset.odo); if (o) openOdo(o); }
  });
  $('#exp-filter').addEventListener('click', ev => { const c = ev.target.closest('.chip'); if (!c) return; expFilter = c.dataset.f; renderExpenses(); });

  // expense sheet
  $('#exp-cats').addEventListener('click', ev => {
    const c = ev.target.closest('.chip'); if (!c) return;
    $$('#exp-cats .chip').forEach(x => x.classList.toggle('on', x === c));
    $('#exp-kwh-field').style.display = c.dataset.cat === 'charging' ? '' : 'none';
  });
  $('#exp-save').addEventListener('click', saveExpense);
  $('#exp-amount').addEventListener('keydown', ev => { if (ev.key === 'Enter') saveExpense(); });
  $('#exp-delete').addEventListener('click', () => {
    if (!editingExpense || !confirm('刪除這筆支出?')) return;
    state.deleted[editingExpense.id] = Date.now();
    state.expenses = state.expenses.filter(x => x !== editingExpense);
    save(); closeSheets(); render(); toast('已刪除');
  });

  // odo sheet
  $('#odo-save').addEventListener('click', saveOdo);
  $('#odo-delete').addEventListener('click', () => {
    if (!editingOdo || !confirm('刪除這筆里程?')) return;
    state.deleted[editingOdo.id] = Date.now();
    state.odometer = state.odometer.filter(x => x !== editingOdo);
    save(); closeSheets(); render(); toast('已刪除');
  });

  // stats
  $('#seg-period').addEventListener('click', ev => { const b = ev.target.closest('button'); if (!b) return; state.settings.statsPeriod = b.dataset.v; save(); renderStats(); });
  $('#stats-inc-price').addEventListener('change', renderStats);

  // compare
  $('#cmp-save').addEventListener('click', () => {
    const s = state.settings;
    s.fuelKmPerL = parseFloat($('#cmp-kmpl').value) || 12;
    s.fuelPricePerL = parseFloat($('#cmp-price').value) || 30;
    s.fuelCarTaxYear = parseFloat($('#cmp-fueltax').value) || 0;
    s.evTaxYear = parseFloat($('#cmp-evtax').value) || 0;
    save(); renderCompare(); toast('已儲存');
  });

  // settings
  $('#set-save').addEventListener('click', () => {
    const date = $('#set-date').value;
    if (!date) return toast('請選交車日');
    state.car.name = $('#set-name').value.trim() || 'My Car';
    state.car.deliveryDate = date;
    state.car.deliveryOdo = parseFloat($('#set-odo').value) || 0;
    save(); renderSettings(); toast('已儲存');
  });
  $('#sync-connect').addEventListener('click', async () => {
    const repo = $('#sync-repo').value, token = $('#sync-token').value;
    if (!repo.includes('/')) return toast('Repo 格式:帳號/repo 名');
    if (!token) return toast('請貼上 token');
    $('#sync-connect').disabled = true; $('#sync-connect').textContent = '連線中…';
    const ok = await Sync.connect(repo, token);
    $('#sync-connect').disabled = false; $('#sync-connect').textContent = '連線並同步';
    if (ok) { $('#sync-token').value = ''; toast('雲端同步已開啟'); }
    if (state.car.deliveryDate && currentView !== 'home') show('settings'); else renderSettings();
  });
  $('#sync-now').addEventListener('click', async () => { await Sync.syncNow({ announce: true }); renderSettings(); });
  $('#sync-rekey').addEventListener('click', () => {
    $('#sync-on').style.display = 'none'; $('#sync-form').style.display = '';
    $('#sync-repo').value = Sync.cfg().repo; $('#sync-token').value = ''; $('#sync-token').focus();
  });
  $('#sync-disconnect').addEventListener('click', () => {
    if (!confirm('中斷同步?這台裝置的資料會保留,只是不再上傳;token 會從這台裝置移除。')) return;
    Sync.disconnect(); renderSettings(); toast('已中斷同步');
  });
  $('#btn-export').addEventListener('click', exportJSON);
  $('#btn-import').addEventListener('click', () => $('#file-import').click());
  $('#file-import').addEventListener('change', ev => { const f = ev.target.files[0]; if (f) importJSON(f); ev.target.value = ''; });
  $('#btn-reset').addEventListener('click', () => {
    if (!confirm('確定清除所有資料?此動作無法復原,建議先匯出備份。')) return;
    if (!confirm('再確認一次:真的要清除?')) return;
    state = defaultState(); save(); show('onboard'); toast('已清除');
  });
}

/* ---------- init ---------- */
bind();
show(state.car.deliveryDate ? 'home' : 'onboard');
if (Sync.enabled()) Sync.syncNow().then(() => { if (state.car.deliveryDate && currentView === 'onboard') show('home'); });
