import { calculate } from './calc.js';
import { REGIMES, PARAM_FIELDS, cloneDefaultParams, regimesForCountry } from './params.js';
import { LANGS, LOCALES, translate } from './i18n.js';

const STORAGE_KEY = 'hr-calc:state:v1';
const $ = (id) => document.getElementById(id);

/* ---------- Состояние ---------- */
const detectLang = () => {
  const l = (navigator.language || 'ru').toLowerCase();
  return l.startsWith('ru') || l.startsWith('kk') || l.startsWith('uz') ? 'ru' : 'en';
};

const defaultState = () => ({
  lang: detectLang(),
  country: 'RU',
  regime: 'ru_td_general',
  regimeByCountry: { RU: 'ru_td_general', KZ: 'kz_td_our', UZ: 'uz_td_standard' },
  netSalary: 0,
  premiumPct: 30,
  workDays: 21,
  projectDays: 21,
  annualBonusPct: 8,
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
    if (!LANGS.includes(st.lang)) st.lang = detectLang();
    // миграция со старой модели премии (фиксированная сумма × % загрузки)
    if (saved.premiumPct === undefined) { st.premiumPct = 30; st.workDays = 21; st.projectDays = 21; }
    if (saved.annualBonusPct === undefined) st.annualBonusPct = 8;
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

/* ---------- Язык, форматирование и парсинг чисел ---------- */
const t = (key, vars) => translate(state.lang, key, vars);
let nf, nf0, pf;
function setFormatters() {
  const loc = LOCALES[state.lang];
  nf = new Intl.NumberFormat(loc, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  nf0 = new Intl.NumberFormat(loc, { maximumFractionDigits: 0 });
  pf = new Intl.NumberFormat(loc, { maximumFractionDigits: 2 });
}
setFormatters();

// RU: пробелы — разделитель разрядов, запятая или точка — дробная часть.
// EN: запятая — разделитель разрядов, точка — дробная часть.
function parseNum(str) {
  if (typeof str === 'number') return str;
  let s = String(str ?? '').replace(/[\s  ]/g, '');
  s = state.lang === 'en' ? s.replace(/,/g, '') : s.replace(',', '.');
  const n = parseFloat(s.replace(/[^\d.\-]/g, ''));
  return Number.isFinite(n) ? n : 0;
}
const sym = (country) => t(`cur.${country}`);
const money = (x, s) => `${nf.format(x)} ${s}`;
const money0 = (x, s) => `${nf0.format(x)} ${s}`;
const pctNum = (n) => (state.lang === 'en' ? `${pf.format(n)}%` : `${pf.format(n)}\u00a0%`);
const pct = (x) => pctNum(x * 100);
const num = (n) => pf.format(n);

// Подстановки из ядра расчёта: rate — доля (в %), amount — сумма, прочие числа — как есть.
function fmtVars(vars) {
  if (!vars) return vars;
  const out = {};
  for (const [k, v] of Object.entries(vars)) {
    if (k === 'rate') out[k] = pct(v);
    else if (k === 'amount') out[k] = nf.format(v);
    else out[k] = typeof v === 'number' ? nf.format(v) : v;
  }
  return out;
}
const tr = (obj) => (obj ? t(obj.key, fmtVars(obj.vars)) : '');

function applyStaticTexts() {
  document.documentElement.lang = state.lang;
  document.title = t('app.docTitle');
  document.querySelectorAll('[data-i18n]').forEach((el) => (el.textContent = t(el.dataset.i18n)));
  document.querySelectorAll('[data-i18n-ph]').forEach((el) => (el.placeholder = t(el.dataset.i18nPh)));
  document.querySelectorAll('[data-i18n-aria]').forEach((el) => el.setAttribute('aria-label', t(el.dataset.i18nAria)));
  document.querySelectorAll('[data-i18n-title]').forEach((el) => (el.title = t(el.dataset.i18nTitle)));
  document.querySelectorAll('[data-i18n-label]').forEach((el) => (el.dataset.label = t(el.dataset.i18nLabel)));
  document.querySelectorAll('.lang__btn').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.lang === state.lang)));
  setNetStatus();
}

function setLang(lang) {
  if (!LANGS.includes(lang) || lang === state.lang) return;
  state.lang = lang;
  setFormatters();
  applyStaticTexts();
  renderCountry();
  refreshers.forEach((fn) => fn());
  update();
}
document.querySelectorAll('.lang__btn').forEach((b) => b.addEventListener('click', () => setLang(b.dataset.lang)));

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
    o.textContent = t(`regime.${r.id}.label`);
    sel.appendChild(o);
  }
  if (REGIMES[state.regime]?.country !== state.country) state.regime = state.regimeByCountry[state.country];
  sel.value = state.regime;
  document.querySelectorAll('[data-cur]').forEach((el) => (el.textContent = `(${sym(state.country)})`));
  $('paramsCountryLabel').textContent = `· ${t(`country.${state.country}`)}`;
  renderRegimeNotes();
  renderCountryOptions();
  renderParamsForm();
}

function renderRegimeNotes() {
  const ul = $('regimeNotes');
  ul.innerHTML = '';
  for (const n of t(`regime.${state.regime}.notes`)) {
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
    label.append(cb, document.createTextNode(t('kz.opvrOption')));
    box.appendChild(label);
  }
}

function renderParamsForm() {
  const form = $('paramsForm');
  form.innerHTML = '';
  const p = state.params[state.country];
  for (const f of PARAM_FIELDS[state.country]) {
    const text = t(`param.${f.key}`);
    if (f.type === 'bool') {
      const label = document.createElement('label');
      label.className = 'check';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = Boolean(p[f.key]);
      cb.addEventListener('change', () => { p[f.key] = cb.checked; update(); });
      label.append(cb, document.createTextNode(text));
      form.appendChild(label);
      continue;
    }
    const label = document.createElement('label');
    label.className = 'field';
    const span = document.createElement('span');
    span.className = 'field__label';
    span.textContent = f.type === 'pct' ? `${text}, %` : text;
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
    tdFrom.textContent = t(i === brackets.length - 1 ? 'brackets.over' : 'brackets.range', { from: nf0.format(prev) });
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
const refreshers = [];

function bindNumber(id, get, set, fmt = (v) => (v ? nf.format(v) : '')) {
  const el = $(id);
  const show = () => (el.value = fmt(get()));
  show();
  el.addEventListener('input', () => { set(parseNum(el.value)); update(); });
  el.addEventListener('blur', show);
  el.addEventListener('focus', () => el.select());
  refreshers.push(show);
}
const fmtPlain = (v) => pf.format(v);

bindNumber('netSalary', () => state.netSalary, (v) => (state.netSalary = Math.max(0, v)));
bindNumber('premiumPct', () => state.premiumPct, (v) => (state.premiumPct = Math.max(0, v)), fmtPlain);
bindNumber('annualBonusPct', () => state.annualBonusPct, (v) => (state.annualBonusPct = Math.max(0, v)), fmtPlain);
for (const key of ['telecom', 'dms', 'training', 'equipment']) {
  bindNumber(`${key}Amount`, () => state.extras[key].amount, (v) => (state.extras[key].amount = Math.max(0, v)));
}
bindNumber('equipmentMonths', () => state.extras.equipment.months, (v) => (state.extras.equipment.months = Math.max(1, Math.round(v) || 1)), (v) => String(v));
for (const key of ['telecom', 'dms', 'training']) {
  const sel = $(`${key}Period`);
  sel.value = state.extras[key].period;
  sel.addEventListener('change', () => { state.extras[key].period = sel.value; update(); });
  refreshers.push(() => (sel.value = state.extras[key].period));
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
  toast(t('toast.paramsReset'));
});
$('resetAll').addEventListener('click', () => {
  const d = defaultState();
  for (const k of ['netSalary', 'premiumPct', 'workDays', 'projectDays', 'annualBonusPct', 'extras']) state[k] = d[k];
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
      annualBonusPct: state.annualBonusPct,
      extras: state.extras,
      options: { kzOpvrApplies: state.kzOpvrApplies },
      params: state.params,
    });
    renderResult(last);
    saveState();
  } catch (err) {
    console.error(err);
    toast(t('toast.error', { msg: err.message }));
  }
}

function row(cells, cls) {
  const tr = document.createElement('tr');
  if (cls) tr.className = cls;
  for (const c of cells) {
    const td = document.createElement(c.th ? 'th' : 'td');
    if (c.num) td.className = 'num';
    if (c.dl) td.dataset.label = c.dl;
    td.textContent = c.text ?? '';
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
  const s = sym(r.country.code);
  const inc = r.income;
  const dlNet = t('th.net');
  const dlGross = t('th.gross');
  const dlRate = t('th.rate');
  const dlAmount = t('th.amount');

  // Карточка премии
  $('premiumFullCalc').textContent = money(inc.premiumFull, s);
  $('dailyRateCalc').textContent = money(inc.dailyRate, s);
  $('dailyRateGrossCalc').textContent = t('kv.dailyRateSub', { gross: money(inc.grossDailyRate, s) });
  $('utilizationCalc').textContent = pctNum(inc.utilization);
  $('premiumCalc').textContent = t('premium.payoutValue', { amount: money(inc.netPremium, s), days: num(inc.projectDays), rate: money(inc.dailyRate, s) });

  // Карточка годового бонуса
  $('bonusYearCalc').textContent = money(inc.netBonusYear, s);
  $('bonusYearGrossCalc').textContent = t('kv.netGross', { gross: money(inc.grossBonusYear, s) });
  $('bonusMonthCalc').textContent = money(inc.netBonus, s);
  $('bonusMonthGrossCalc').textContent = t('kv.netGross', { gross: money(inc.grossBonus, s) });

  // Ключевые показатели
  $('hNet').textContent = money0(inc.netPay, s);
  $('hNetSub').textContent = inc.netBonusYear > 0 ? t('hero.netBonus', { amount: money0(inc.netBonusYear, s) }) : t('hero.perMonth');
  $('hGross').textContent = money0(inc.gross, s);
  $('hGrossSub').textContent = inc.gross > 0 ? t('hero.grossSub', { amount: money0(r.employeeTotal, s) }) : '—';
  $('hCost').textContent = money0(r.totalCost, s);
  $('hCostSub').textContent = r.totalCost > 0 ? t('hero.costSub', { amount: money0(r.employerTotal, s) }) : t('hero.perMonth');
  $('hCostYear').textContent = money0(r.totalCostYear, s);
  $('hRatio').textContent = r.costToNetRatio ? t('hero.ratio', { x: num(r.costToNetRatio) }) : '—';

  $('resRegime').textContent = `· ${t(`country.${r.country.code}`)}, ${t(`regime.${r.regime.id}.short`)}`;

  // Начисление
  const ib = $('incomeBody');
  ib.innerHTML = '';
  ib.append(
    row([{ text: t('row.salary') }, { text: money(inc.netSalary, s), num: true, dl: dlNet }, { text: money(inc.grossSalary, s), num: true, dl: dlGross }]),
    row([
      { text: t('row.premium', { pct: num(inc.premiumPct) }), hint: t('row.premiumHint', { days: num(inc.projectDays), work: num(inc.workDays), util: num(inc.utilization) }) },
      { text: money(inc.netPremium, s), num: true, dl: dlNet },
      { text: money(inc.grossPremium, s), num: true, dl: dlGross },
    ]),
  );
  if (inc.annualBonusPct > 0) {
    ib.append(row([
      { text: t('row.bonus', { pct: num(inc.annualBonusPct) }), hint: t('row.bonusHint', { net: money(inc.netBonusYear, s), gross: money(inc.grossBonusYear, s) }) },
      { text: money(inc.netBonus, s), num: true, dl: dlNet },
      { text: money(inc.grossBonus, s), num: true, dl: dlGross },
    ]));
  }
  ib.append(
    row([{ text: t('row.total'), th: true }, { text: money(inc.netTotal, s), num: true, dl: dlNet }, { text: money(inc.gross, s), num: true, dl: dlGross }], 'total'),
    row([{ text: t('row.dailyRate'), hint: t('row.dailyRateHint') }, { text: money(inc.dailyRate, s), num: true, dl: dlNet }, { text: money(inc.grossDailyRate, s), num: true, dl: dlGross }], 'ref'),
  );

  // Удержания
  const eb = $('employeeBody');
  eb.innerHTML = '';
  for (const x of r.employee) eb.appendChild(row([{ text: t(x.labelKey), hint: tr(x.hint) }, { text: pct(x.rate), num: true, dl: dlRate }, { text: money(x.amount, s), num: true, dl: dlAmount }]));
  $('employeeTotal').textContent = money(r.employeeTotal, s);

  // Отчисления работодателя
  const rb = $('employerBody');
  rb.innerHTML = '';
  if (r.employer.length === 0) rb.appendChild(row([{ text: t('employer.none') }, { text: '' }, { text: money(0, s), num: true }]));
  for (const x of r.employer) rb.appendChild(row([{ text: t(x.labelKey), hint: tr(x.hint) }, { text: pct(x.rate), num: true, dl: dlRate }, { text: money(x.amount, s), num: true, dl: dlAmount }]));
  $('employerTotal').textContent = money(r.employerTotal, s);

  // Полная стоимость
  const cb = $('costBody');
  cb.innerHTML = '';
  cb.append(
    row([{ text: t('cost.gross') }, { text: money(inc.gross, s), num: true }]),
    row([{ text: t('cost.employer') }, { text: money(r.employerTotal, s), num: true }]),
    row([{ text: t('cost.payroll'), th: true }, { text: money(r.payrollCost, s), num: true }], 'total'),
  );
  for (const x of r.extras.items) {
    if (x.amount > 0) cb.appendChild(row([{ text: t('cost.extraItem', { label: t(x.labelKey) }), hint: tr(x.hint) }, { text: money(x.amount, s), num: true }]));
  }
  cb.append(
    row([{ text: t('cost.extras') }, { text: money(r.extras.total, s), num: true }]),
    row([{ text: t('cost.month'), th: true }, { text: money(r.totalCost, s), num: true }], 'grand'),
    row([{ text: t('cost.year'), th: true }, { text: money(r.totalCostYear, s), num: true }], 'total'),
    row([{ text: t('cost.wedge'), hint: t('cost.wedgeHint') }, { text: pct(r.taxWedge), num: true }]),
  );

  const notes = $('infoNotes');
  notes.innerHTML = '';
  for (const n of r.info) {
    const li = document.createElement('li');
    li.textContent = tr(n);
    notes.appendChild(li);
  }
}

/* ---------- Копирование ---------- */
function resultAsText(r) {
  const s = sym(r.country.code);
  const inc = r.income;
  const line = (l, v) => `${l}: ${v}`;
  const out = [
    t('copy.title', { country: t(`country.${r.country.code}`), regime: t(`regime.${r.regime.id}.label`) }),
    '',
    line(t('copy.salary'), money(inc.netSalary, s)),
    t('copy.premium', { pct: num(inc.premiumPct), full: money(inc.premiumFull, s), rate: money(inc.dailyRate, s), grossRate: money(inc.grossDailyRate, s) }),
    line(t('copy.premiumDays', { days: num(inc.projectDays), work: num(inc.workDays), util: num(inc.utilization) }), money(inc.netPremium, s)),
  ];
  if (inc.annualBonusPct > 0) out.push(line(t('copy.bonus', { pct: num(inc.annualBonusPct), year: money(inc.netBonusYear, s) }), money(inc.netBonus, s)));
  out.push(
    line(t('copy.netTotal'), money(inc.netTotal, s)),
    line(t('copy.gross'), money(inc.gross, s)),
    '',
    t('copy.employee'),
    ...r.employee.map((x) => `  ${t(x.labelKey)} ${pct(x.rate)}: ${money(x.amount, s)}`),
    line(t('copy.total'), money(r.employeeTotal, s)),
    '',
    t('copy.employer'),
    ...r.employer.map((x) => `  ${t(x.labelKey)} ${pct(x.rate)}: ${money(x.amount, s)}`),
    line(t('copy.total'), money(r.employerTotal, s)),
    '',
    line(t('copy.payroll'), money(r.payrollCost, s)),
    ...r.extras.items.filter((x) => x.amount > 0).map((x) => line(t('copy.extraItem', { label: t(x.labelKey) }), money(x.amount, s))),
    line(t('copy.extras'), money(r.extras.total, s)),
    line(t('copy.month'), money(r.totalCost, s)),
    line(t('copy.year'), money(r.totalCostYear, s)),
    line(t('copy.ratio'), `× ${num(r.costToNetRatio)}`),
  );
  if (r.info.length) out.push('', ...r.info.map((n) => `! ${tr(n)}`));
  return out.join('\n');
}

async function copyResult() {
  if (!last) return;
  const text = resultAsText(last);
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
  toast(t('toast.copied'));
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
  el.textContent = t(on ? 'net.online' : 'net.offline');
  el.classList.toggle('badge--off', !on);
}
window.addEventListener('online', setNetStatus);
window.addEventListener('offline', setNetStatus);

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
window.addEventListener('appinstalled', () => { $('installBtn').hidden = true; toast(t('toast.installed')); });

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch((err) => console.warn('SW:', err));
  });
}

/* ---------- Старт ---------- */
applyStaticTexts();
renderCountry();
update();
