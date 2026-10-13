import { calculate } from './calc.js';
import { COUNTRIES, REGIMES, PARAM_FIELDS, DEFAULT_PARAMS, cloneDefaultParams, regimesForCountry } from './params.js';

const STORAGE_KEY = 'hr-calc:state:v1';
const $ = (id) => document.getElementById(id);

/* ---------- Форматирование и парсинг чисел ---------- */
const nf = new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const nf0 = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 });
const pf = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 });

function parseNum(str) {
  if (typeof str === 'number') return str;
  const s = String(str ?? '').replace(/[\s  ]/g, '').replace(',', '.').replace(/[^\d.\-]/g, '');
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
}
const money = (x, sym) => `${nf.format(x)} ${sym}`;
const money0 = (x, sym) => `${nf0.format(x)} ${sym}`;
const pct = (x) => `${pf.format(x * 100)} %`;

/* ---------- Состояние ---------- */
const defaultState = () => ({
  country: 'RU',
  regime: 'ru_td_general',
  regimeByCountry: { RU: 'ru_td_general', KZ: 'kz_td_our', UZ: 'uz_td_standard' },
  netSalary: 0,
  premiumPct: 30,
  workDays: 21,
  projectDays: 21,
  kzOpvrApplies: true,
  extras: {
    telecom: { amount: 0, period: 'month' },
    dms: { amount: 0, period: 'year' },
    training: { amount: 0, period: 'year' },
    equipment: { amount: 0, months: 24 },
  },
  params: cloneDefaultParams(),
});

function serializeParams(params) {
  return JSON.parse(JSON.stringify(params, (k, v) => (v === Infinity ? 'Infinity' : v)));
}
function reviveParams(stored) {
  const base = cloneDefaultParams();
  if (!stored) return base;
  for (const c of Object.keys(base)) {
    if (!stored[c]) continue;
    for (const key of Object.keys(base[c])) {
      if (stored[c][key] === undefined) continue;
      if (key === 'ndflBrackets' && Array.isArray(stored[c][key])) {
        base[c][key] = stored[c][key].map((b) => ({ upTo: b.upTo === 'Infinity' || b.upTo === null ? Infinity : Number(b.upTo), rate: Number(b.rate) }));
      } else {
        base[c][key] = stored[c][key];
      }
    }
  }
  return base;
}

function loadState() {
  const st = defaultState();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return st;
    const saved = JSON.parse(raw);
    Object.assign(st, saved, { params: reviveParams(saved.params) });
    st.extras = { ...defaultState().extras, ...(saved.extras || {}) };
    st.regimeByCountry = { ...defaultState().regimeByCountry, ...(saved.regimeByCountry || {}) };
    if (!REGIMES[st.regime]) st.regime = st.regimeByCountry[st.country];
    // миграция со старой модели премии (фиксированная сумма × % загрузки)
    if (saved.premiumPct === undefined) { st.premiumPct = 30; st.workDays = 21; st.projectDays = 21; }
    delete st.premiumFull; delete st.utilization;
  } catch { /* повреждённое хранилище — начинаем заново */ }
  return st;
}
function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...state, params: serializeParams(state.params) }));
  } catch { /* приватный режим и т. п. — просто не сохраняем */ }
}

let state = loadState();

/* ---------- Построение формы ---------- */
function renderCountry() {
  document.querySelectorAll('#countrySeg .seg__btn').forEach((b) => {
    b.setAttribute('aria-selected', String(b.dataset.country === state.country));
  });
  const sel = $('regime');
  sel.innerHTML = '';
  for (const r of regimesForCountry(state.country)) {
    const o = document.createElement('option');
    o.value = r.id;
    o.textContent = r.label;
    sel.appendChild(o);
  }
  if (REGIMES[state.regime]?.country !== state.country) state.regime = state.regimeByCountry[state.country];
  sel.value = state.regime;
  document.querySelectorAll('[data-cur]').forEach((el) => (el.textContent = `(${COUNTRIES[state.country].symbol})`));
  $('paramsCountryLabel').textContent = `· ${COUNTRIES[state.country].name}`;
  renderRegimeNotes();
  renderCountryOptions();
  renderParamsForm();
}

function renderRegimeNotes() {
  const ul = $('regimeNotes');
  ul.innerHTML = '';
  for (const n of REGIMES[state.regime].notes) {
    const li = document.createElement('li');
    li.textContent = n;
    ul.appendChild(li);
  }
}

function renderCountryOptions() {
  const box = $('countryOptions');
  box.innerHTML = '';
  if (state.country === 'KZ') {
    const label = document.createElement('label');
    label.className = 'check';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = state.kzOpvrApplies;
    cb.addEventListener('change', () => { state.kzOpvrApplies = cb.checked; update(); });
    label.append(cb, document.createTextNode('Уплачивать ОПВР (сотрудник 1975 г. р. и младше)'));
    box.appendChild(label);
  }
}

function renderParamsForm() {
  const form = $('paramsForm');
  form.innerHTML = '';
  const p = state.params[state.country];
  for (const f of PARAM_FIELDS[state.country]) {
    if (f.type === 'bool') {
      const label = document.createElement('label');
      label.className = 'check';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = Boolean(p[f.key]);
      cb.addEventListener('change', () => { p[f.key] = cb.checked; update(); });
      label.append(cb, document.createTextNode(f.label));
      form.appendChild(label);
      continue;
    }
    const label = document.createElement('label');
    label.className = 'field';
    const span = document.createElement('span');
    span.className = 'field__label';
    span.textContent = f.type === 'pct' ? `${f.label}, %` : f.label;
    const input = document.createElement('input');
    input.className = 'input input--num';
    input.type = 'text';
    input.inputMode = 'decimal';
    const show = () => (input.value = f.type === 'pct' ? pf.format(p[f.key] * 100) : nf.format(p[f.key]));
    show();
    input.addEventListener('input', () => {
      const v = parseNum(input.value);
      p[f.key] = f.type === 'pct' ? v / 100 : f.type === 'int' ? Math.round(v) : v;
      update();
    });
    input.addEventListener('blur', show);
    label.append(span, input);
    form.appendChild(label);
  }
  renderBrackets();
}

function renderBrackets() {
  const block = $('bracketsBlock');
  if (state.country !== 'RU') { block.hidden = true; return; }
  block.hidden = false;
  const body = $('bracketsBody');
  body.innerHTML = '';
  const brackets = state.params.RU.ndflBrackets;
  brackets.forEach((b, i) => {
    const tr = document.createElement('tr');
    const tdFrom = document.createElement('td');
    const prev = i === 0 ? 0 : brackets[i - 1].upTo;
    tdFrom.textContent = i === brackets.length - 1 ? `свыше ${nf0.format(prev)}` : `от ${nf0.format(prev)} до`;
    const tdTo = document.createElement('td');
    if (i < brackets.length - 1) {
      const inp = document.createElement('input');
      inp.className = 'input input--num';
      inp.type = 'text';
      inp.inputMode = 'decimal';
      inp.value = nf.format(b.upTo);
      inp.addEventListener('input', () => { b.upTo = parseNum(inp.value); update(); });
      inp.addEventListener('blur', () => { renderBrackets(); });
      tdTo.appendChild(inp);
    }
    const tdRate = document.createElement('td');
    const rate = document.createElement('input');
    rate.className = 'input input--num input--short';
    rate.type = 'text';
    rate.inputMode = 'decimal';
    rate.value = pf.format(b.rate * 100);
    rate.addEventListener('input', () => { b.rate = parseNum(rate.value) / 100; update(); });
    const tdPct = document.createElement('td');
    tdPct.textContent = '%';
    tr.append(tdFrom, tdTo, tdRate, tdPct);
    body.appendChild(tr);
  });
}

/* ---------- Привязка полей ввода ---------- */
function bindMoney(id, get, set) {
  const el = $(id);
  const show = () => { const v = get(); el.value = v ? nf.format(v) : ''; };
  show();
  el.addEventListener('input', () => { set(parseNum(el.value)); update(); });
  el.addEventListener('blur', show);
  el.addEventListener('focus', () => el.select());
  return show;
}

const refreshers = [];
refreshers.push(bindMoney('netSalary', () => state.netSalary, (v) => (state.netSalary = Math.max(0, v))));
{
  const el = $('premiumPct');
  const show = () => (el.value = pf.format(state.premiumPct));
  show();
  el.addEventListener('input', () => { state.premiumPct = Math.max(0, parseNum(el.value)); update(); });
  el.addEventListener('blur', show);
  el.addEventListener('focus', () => el.select());
  refreshers.push(show);
}
for (const key of ['telecom', 'dms', 'training', 'equipment']) {
  refreshers.push(bindMoney(`${key}Amount`, () => state.extras[key].amount, (v) => (state.extras[key].amount = Math.max(0, v))));
}
for (const key of ['telecom', 'dms', 'training']) {
  const sel = $(`${key}Period`);
  sel.value = state.extras[key].period;
  sel.addEventListener('change', () => { state.extras[key].period = sel.value; update(); });
  refreshers.push(() => (sel.value = state.extras[key].period));
}
{
  const el = $('equipmentMonths');
  const show = () => (el.value = String(state.extras.equipment.months));
  show();
  el.addEventListener('input', () => { state.extras.equipment.months = Math.max(1, Math.round(parseNum(el.value)) || 1); update(); });
  el.addEventListener('blur', show);
  refreshers.push(show);
}
{
  const workEl = $('workDays');
  const range = $('projectDaysRange');
  const daysEl = $('projectDays');
  const show = () => {
    workEl.value = pf.format(state.workDays);
    range.max = String(state.workDays);
    range.value = String(state.projectDays);
    daysEl.value = pf.format(state.projectDays);
  };
  show();
  workEl.addEventListener('input', () => {
    const wasFull = state.projectDays >= state.workDays;
    state.workDays = Math.min(31, Math.max(0, parseNum(workEl.value)));
    state.projectDays = wasFull ? state.workDays : Math.min(state.projectDays, state.workDays);
    range.max = String(state.workDays); range.value = String(state.projectDays); daysEl.value = pf.format(state.projectDays);
    update();
  });
  workEl.addEventListener('blur', show);
  workEl.addEventListener('focus', () => workEl.select());
  range.addEventListener('input', () => { state.projectDays = Number(range.value); daysEl.value = pf.format(state.projectDays); update(); });
  daysEl.addEventListener('input', () => { state.projectDays = Math.min(state.workDays, Math.max(0, parseNum(daysEl.value))); range.value = String(state.projectDays); update(); });
  daysEl.addEventListener('blur', show);
  daysEl.addEventListener('focus', () => daysEl.select());
  refreshers.push(show);
}

document.querySelectorAll('#countrySeg .seg__btn').forEach((b) => {
  b.addEventListener('click', () => {
    state.country = b.dataset.country;
    state.regime = state.regimeByCountry[state.country];
    renderCountry();
    update();
  });
});
$('regime').addEventListener('change', (e) => {
  state.regime = e.target.value;
  state.regimeByCountry[state.country] = state.regime;
  renderRegimeNotes();
  update();
});
$('resetParams').addEventListener('click', () => {
  state.params[state.country] = cloneDefaultParams()[state.country];
  renderParamsForm();
  update();
  toast('Параметры возвращены к значениям 2026 года');
});
$('resetAll').addEventListener('click', () => {
  const d = defaultState();
  state.netSalary = d.netSalary;
  state.premiumPct = d.premiumPct;
  state.workDays = d.workDays;
  state.projectDays = d.projectDays;
  state.extras = d.extras;
  refreshers.forEach((fn) => fn());
  update();
});
$('printBtn').addEventListener('click', () => window.print());
$('copyBtn').addEventListener('click', copyResult);

/* ---------- Расчёт и вывод ---------- */
let last = null;

function update() {
  try {
    last = calculate({
      regime: state.regime,
      netSalary: state.netSalary,
      premiumPct: state.premiumPct,
      workDays: state.workDays,
      projectDays: state.projectDays,
      extras: state.extras,
      options: { kzOpvrApplies: state.kzOpvrApplies },
      params: state.params,
    });
    renderResult(last);
    saveState();
  } catch (err) {
    console.error(err);
    toast(`Ошибка расчёта: ${err.message}`);
  }
}

function row(cells, cls) {
  const tr = document.createElement('tr');
  if (cls) tr.className = cls;
  for (const c of cells) {
    const td = document.createElement(c.th ? 'th' : 'td');
    if (c.num) td.className = 'num';
    if (c.dl) td.dataset.label = c.dl;
    if (c.html) td.innerHTML = c.html; else td.textContent = c.text ?? '';
    if (c.hint) {
      const s = document.createElement('span');
      s.className = 'hint';
      s.textContent = c.hint;
      td.appendChild(s);
    }
    tr.appendChild(td);
  }
  return tr;
}

function renderResult(r) {
  const sym = r.country.symbol;
  const inc = r.income;
  $('premiumFullCalc').textContent = money(inc.premiumFull, sym);
  $('dailyRateCalc').textContent = money(inc.dailyRate, sym);
  $('utilizationCalc').textContent = `${pf.format(inc.utilization)} %`;
  $('premiumCalc').textContent = `${money(inc.netPremium, sym)} (${pf.format(inc.projectDays)} дн. × ${money(inc.dailyRate, sym)})`;

  $('hNet').textContent = money0(inc.netTotal, sym);
  $('hGross').textContent = money0(inc.gross, sym);
  $('hGrossSub').textContent = inc.gross > 0 ? `удержано ${money0(r.employeeTotal, sym)}` : '—';
  $('hCost').textContent = money0(r.totalCost, sym);
  $('hCostSub').textContent = r.totalCost > 0 ? `в т. ч. отчисления ${money0(r.employerTotal, sym)}` : 'в месяц';
  $('hCostYear').textContent = money0(r.totalCostYear, sym);
  $('hRatio').textContent = r.costToNetRatio ? `× ${pf.format(r.costToNetRatio)} к сумме на руки` : '—';

  $('resRegime').textContent = `· ${r.country.name}, ${r.regime.short}`;

  const ib = $('incomeBody');
  ib.innerHTML = '';
  ib.append(
    row([{ text: 'Оклад' }, { text: money(inc.netSalary, sym), num: true, dl: 'На руки' }, { text: money(inc.grossSalary, sym), num: true, dl: 'Начислено' }]),
    row([{ text: `Премия за проект (${inc.premiumPct} % от оклада)`, hint: `${pf.format(inc.projectDays)} из ${pf.format(inc.workDays)} дн. × ${money(inc.dailyRate, sym)}/день · загрузка ${pf.format(inc.utilization)} %` }, { text: money(inc.netPremium, sym), num: true, dl: 'На руки' }, { text: money(inc.grossPremium, sym), num: true, dl: 'Начислено' }]),
    row([{ text: 'Итого', th: true }, { text: money(inc.netTotal, sym), num: true, dl: 'На руки' }, { text: money(inc.gross, sym), num: true, dl: 'Начислено' }], 'total'),
  );

  const eb = $('employeeBody');
  eb.innerHTML = '';
  for (const x of r.employee) eb.appendChild(row([{ text: x.label, hint: x.hint }, { text: pct(x.rate), num: true, dl: 'Ставка' }, { text: money(x.amount, sym), num: true, dl: 'Сумма' }]));
  $('employeeTotal').textContent = money(r.employeeTotal, sym);

  const rb = $('employerBody');
  rb.innerHTML = '';
  if (r.employer.length === 0) rb.appendChild(row([{ text: 'Отчисления не начисляются' }, { text: '' }, { text: money(0, sym), num: true }]));
  for (const x of r.employer) rb.appendChild(row([{ text: x.label, hint: x.hint }, { text: pct(x.rate), num: true, dl: 'Ставка' }, { text: money(x.amount, sym), num: true, dl: 'Сумма' }]));
  $('employerTotal').textContent = money(r.employerTotal, sym);

  const cb = $('costBody');
  cb.innerHTML = '';
  cb.append(
    row([{ text: 'Начислено сотруднику (gross)' }, { text: money(inc.gross, sym), num: true }]),
    row([{ text: 'Отчисления работодателя' }, { text: money(r.employerTotal, sym), num: true }]),
    row([{ text: 'ФОТ с отчислениями', th: true }, { text: money(r.payrollCost, sym), num: true }], 'total'),
  );
  for (const x of r.extras.items) {
    if (x.amount > 0) cb.appendChild(row([{ text: `${x.label} (в месяц)`, hint: x.hint }, { text: money(x.amount, sym), num: true }]));
  }
  cb.append(
    row([{ text: 'Дополнительные затраты' }, { text: money(r.extras.total, sym), num: true }]),
    row([{ text: 'Полная стоимость в месяц', th: true }, { text: money(r.totalCost, sym), num: true }], 'grand'),
    row([{ text: 'Полная стоимость в год', th: true }, { text: money(r.totalCostYear, sym), num: true }], 'total'),
    row([{ text: 'Налоги и взносы в ФОТ', hint: 'доля удержаний и отчислений в ФОТ с отчислениями' }, { text: pct(r.taxWedge), num: true }]),
  );

  const notes = $('infoNotes');
  notes.innerHTML = '';
  for (const n of r.info) {
    const li = document.createElement('li');
    li.textContent = n;
    notes.appendChild(li);
  }
}

/* ---------- Копирование ---------- */
function resultAsText(r) {
  const sym = r.country.symbol;
  const inc = r.income;
  const line = (l, v) => `${l}: ${v}`;
  const out = [
    `Расчёт стоимости сотрудника — ${r.country.name}, ${r.regime.label}`,
    '',
    line('Оклад на руки', money(inc.netSalary, sym)),
    line(`Премия за проект (${inc.premiumPct} % от оклада = ${money(inc.premiumFull, sym)} в месяц, ${money(inc.dailyRate, sym)} в день)`, ''),
    line(`  ${pf.format(inc.projectDays)} из ${pf.format(inc.workDays)} рабочих дней, загрузка ${pf.format(inc.utilization)} %`, money(inc.netPremium, sym)),
    line('Итого на руки', money(inc.netTotal, sym)),
    line('Начислено (gross)', money(inc.gross, sym)),
    '',
    'Удержания с сотрудника:',
    ...r.employee.map((x) => `  ${x.label} ${pct(x.rate)}: ${money(x.amount, sym)}`),
    line('  Итого', money(r.employeeTotal, sym)),
    '',
    'Отчисления работодателя:',
    ...r.employer.map((x) => `  ${x.label} ${pct(x.rate)}: ${money(x.amount, sym)}`),
    line('  Итого', money(r.employerTotal, sym)),
    '',
    line('ФОТ с отчислениями', money(r.payrollCost, sym)),
    ...r.extras.items.filter((x) => x.amount > 0).map((x) => `  ${x.label} (в месяц): ${money(x.amount, sym)}`),
    line('Дополнительные затраты', money(r.extras.total, sym)),
    line('Полная стоимость в месяц', money(r.totalCost, sym)),
    line('Полная стоимость в год', money(r.totalCostYear, sym)),
    line('Коэффициент к сумме на руки', `× ${pf.format(r.costToNetRatio)}`),
  ];
  if (r.info.length) out.push('', ...r.info.map((n) => `! ${n}`));
  return out.join('\n');
}

async function copyResult() {
  if (!last) return;
  const text = resultAsText(last);
  try {
    await navigator.clipboard.writeText(text);
    toast('Расчёт скопирован');
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
    toast('Расчёт скопирован');
  }
}

/* ---------- Toast ---------- */
let toastTimer;
function toast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), 2500);
}

/* ---------- PWA ---------- */
function setNetStatus() {
  const el = $('netStatus');
  const on = navigator.onLine;
  el.textContent = on ? 'онлайн' : 'офлайн';
  el.classList.toggle('badge--off', !on);
}
window.addEventListener('online', setNetStatus);
window.addEventListener('offline', setNetStatus);
setNetStatus();

let deferredPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  $('installBtn').hidden = false;
});
$('installBtn').addEventListener('click', async () => {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  await deferredPrompt.userChoice;
  deferredPrompt = null;
  $('installBtn').hidden = true;
});
window.addEventListener('appinstalled', () => { $('installBtn').hidden = true; toast('Приложение установлено'); });

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch((err) => console.warn('SW:', err));
  });
}

/* ---------- Старт ---------- */
renderCountry();
update();
