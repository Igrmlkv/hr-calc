import { calculate } from './calc.js';
import { REGIMES, PARAM_FIELDS, cloneDefaultParams, regimesForCountry } from './params.js';
import { LANGS, LOCALES, translate } from './i18n.js';

const STORAGE_KEY = 'hr-calc:state:v1'; // последние введённые значения
const PROFILE_KEY = 'hr-calc:defaults:v1'; // «мои значения по умолчанию»
const $ = (id) => document.getElementById(id);

/* ---------- Состояние ---------- */
// Казахский и узбекский интерфейс не переведён — для них ближе русский.
const LANG_ALIASES = { kk: 'ru', uz: 'ru' };
const detectLang = () => {
  const prefs = navigator.languages?.length ? navigator.languages : [navigator.language || 'ru'];
  for (const l of prefs) {
    const base = l.toLowerCase().split('-')[0];
    const lang = LANG_ALIASES[base] || base;
    if (LANGS.includes(lang)) return lang;
  }
  return 'en';
};

const defaultState = () => ({
  lang: detectLang(),
  country: 'RU',
  regime: 'ru_td_general',
  regimeByCountry: { RU: 'ru_td_general', KZ: 'kz_td_our', UZ: 'uz_td_standard' },
  salaryBasis: 'net', // от какой суммы идёт расчёт: 'net' или 'gross'
  // Числовые поля при первом запуске пустые (null); в полях показываются подсказки-примеры.
  salary: null, // оклад в базе salaryBasis
  premiumPct: null,
  workDays: null,
  projectDays: null,
  annualBonusPct: null,
  kzOpvrApplies: true,
  extras: {
    telecom: { amount: null, period: 'month' },
    dms: { amount: null, period: 'year' },
    training: { amount: null, period: 'year' },
    equipment: { amount: null, months: null },
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

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// Собирает состояние из сохранённого снимка. Берутся только ключи текущей схемы: поля прошлых
// версий отбрасываются, недостающие остаются по умолчанию, вложенные объекты сливаются на один уровень.
function stateFrom(saved) {
  if (!saved) return defaultState();
  try {
    const src = { ...saved };
    // Версии до 1.6 хранили оклад в двух полях (netSalary / grossSalary).
    if (src.salary === undefined) src.salary = (src.salaryBasis === 'gross' ? src.grossSalary : src.netSalary) || null;
    const st = defaultState();
    for (const k of Object.keys(st)) {
      if (k === 'params' || src[k] === undefined) continue;
      st[k] = isPlainObject(st[k]) ? { ...st[k], ...src[k] } : src[k];
    }
    st.params = reviveParams(src.params);
    if (!PARAM_FIELDS[st.country]) st.country = defaultState().country;
    if (REGIMES[st.regime]?.country !== st.country) st.regime = regimesForCountry(st.country)[0].id;
    if (!LANGS.includes(st.lang)) st.lang = detectLang();
    if (st.salaryBasis !== 'gross') st.salaryBasis = 'net';
    return st;
  } catch { return defaultState(); } // повреждённый снимок — начинаем с пустых полей
}
function readStored(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; } // приватный режим или повреждённые данные
}
function writeStored(key, value) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch { return false; }
}
const snapshot = () => ({ ...state, params: serializeParams(state.params) });

const loadState = () => stateFrom(readStored(STORAGE_KEY));
const saveState = () => writeStored(STORAGE_KEY, snapshot());

let state = loadState();
let last = null; // последний результат расчёта

/* ---------- Язык, форматирование и парсинг чисел ---------- */
const t = (key, vars) => translate(state.lang, key, vars);
let nf, nf0, pf, pctFmt, dateFmt, groupSep, decimalSep;
function setFormatters() {
  const loc = LOCALES[state.lang];
  nf = new Intl.NumberFormat(loc, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  nf0 = new Intl.NumberFormat(loc, { maximumFractionDigits: 0 });
  pf = new Intl.NumberFormat(loc, { maximumFractionDigits: 2 });
  pctFmt = new Intl.NumberFormat(loc, { style: 'percent', maximumFractionDigits: 2 });
  dateFmt = new Intl.DateTimeFormat(loc, { dateStyle: 'medium', timeStyle: 'short' });
  const parts = nf.formatToParts(12345.6);
  groupSep = parts.find((x) => x.type === 'group').value;
  decimalSep = parts.find((x) => x.type === 'decimal').value;
}
setFormatters();

// Разделители разрядов и дробной части берутся из локали языка интерфейса;
// точка как дробный разделитель принимается всегда.
function parseNum(str) {
  if (typeof str === 'number') return str;
  let s = String(str ?? '').replace(/\s/g, '');
  if (groupSep.trim()) s = s.split(groupSep).join('');
  s = s.replace(decimalSep, '.');
  const n = parseFloat(s.replace(/[^\d.\-]/g, ''));
  return Number.isFinite(n) ? n : 0;
}
const sym = (country) => t(`cur.${country}`);
const countryName = (country) => t(`country.${country}`);
const regimeText = (id, field) => t(`regime.${id}.${field}`);
const money = (x, s) => `${nf.format(x)}\u00a0${s}`;
const money0 = (x, s) => `${nf0.format(x)}\u00a0${s}`;
const pct = (fraction) => pctFmt.format(fraction);
const num = (n) => pf.format(n);

// Подстановки из ядра расчёта: rate — доля (выводится в %), прочие числа — по локали.
const fmtVars = (vars) =>
  vars && Object.fromEntries(Object.entries(vars).map(([k, v]) => [k, k === 'rate' ? pct(v) : typeof v === 'number' ? nf.format(v) : v]));
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
  renderDefaultsUi();
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
    o.textContent = regimeText(r.id, 'label');
    sel.appendChild(o);
  }
  if (REGIMES[state.regime]?.country !== state.country) state.regime = state.regimeByCountry[state.country];
  sel.value = state.regime;
  document.querySelectorAll('[data-cur]').forEach((el) => (el.textContent = `(${sym(state.country)})`));
  $('paramsCountryLabel').textContent = `· ${countryName(state.country)}`;
  renderRegimeNotes();
  renderCountryOptions();
  renderParamsForm();
}

function renderRegimeNotes() {
  const ul = $('regimeNotes');
  ul.innerHTML = '';
  for (const n of regimeText(state.regime, 'notes')) {
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

const clampNum = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
// Числовое поле. Пустой ввод хранится как null (поле остаётся пустым), число ограничивается
// диапазоном [min, max] и при int округляется. Возвращает функцию перерисовки поля.
function bindNumber(id, get, set, { fmt = (v) => nf.format(v), min = 0, max = Infinity, int = false } = {}) {
  const el = $(id);
  const show = () => { const v = get(); el.value = v == null ? '' : fmt(v); };
  show();
  el.addEventListener('input', () => {
    const raw = el.value.trim() === '' ? null : parseNum(el.value);
    set(raw == null ? null : clampNum(int ? Math.round(raw) : raw, min, max));
    update();
  });
  el.addEventListener('blur', show);
  el.addEventListener('focus', () => el.select());
  refreshers.push(show);
  return show;
}

// Оклад: два связанных поля. Ввод в поле делает его исходным, второе показывает пересчёт.
const SALARY_FIELDS = Object.entries({ net: 'netSalary', gross: 'grossSalary' }).map(([basis, key]) => ({
  basis,
  el: $(key),
  badge: document.querySelector(`[data-src="${basis}"]`),
  show: bindNumber(
    key,
    () => (state.salaryBasis === basis ? state.salary : last?.income[key] || null),
    (v) => { state.salaryBasis = basis; state.salary = v; },
  ),
}));
function syncSalaryFields() {
  for (const f of SALARY_FIELDS) {
    const isSource = state.salaryBasis === f.basis;
    f.el.classList.toggle('input--src', isSource);
    f.el.classList.toggle('input--calc', !isSource);
    f.badge.hidden = !isSource;
    if (!isSource && document.activeElement !== f.el) f.show();
  }
}

bindNumber('premiumPct', () => state.premiumPct, (v) => (state.premiumPct = v), { fmt: num });
bindNumber('annualBonusPct', () => state.annualBonusPct, (v) => (state.annualBonusPct = v), { fmt: num });
for (const key of ['telecom', 'dms', 'training', 'equipment']) {
  bindNumber(`${key}Amount`, () => state.extras[key].amount, (v) => (state.extras[key].amount = v));
}
bindNumber('equipmentMonths', () => state.extras.equipment.months, (v) => (state.extras.equipment.months = v), { fmt: String, min: 1, int: true });

// Рабочие дни и дни на проекте (поле + ползунок).
const range = $('projectDaysRange');
const syncRange = () => { range.max = String(state.workDays ?? 0); range.value = String(state.projectDays ?? 0); };
const showProjectDays = bindNumber('projectDays', () => state.projectDays, (v) => {
  state.projectDays = v == null || state.workDays == null ? v : Math.min(state.workDays, v);
  syncRange();
}, { fmt: num });
bindNumber('workDays', () => state.workDays, (v) => {
  // Пока дни на проекте не заданы или равны полному месяцу, они следуют за рабочими днями.
  const follow = state.projectDays == null || (state.workDays != null && state.projectDays >= state.workDays);
  state.workDays = v;
  if (follow) state.projectDays = v;
  else if (v != null) state.projectDays = Math.min(state.projectDays, v);
  showProjectDays();
  syncRange();
}, { fmt: num, max: 31 });
range.addEventListener('input', () => { state.projectDays = Number(range.value); showProjectDays(); update(); });
syncRange();
refreshers.push(syncRange);

for (const key of ['telecom', 'dms', 'training']) {
  const sel = $(`${key}Period`);
  sel.value = state.extras[key].period;
  sel.addEventListener('change', () => { state.extras[key].period = sel.value; update(); });
  refreshers.push(() => (sel.value = state.extras[key].period));
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
/* ---------- Мои значения по умолчанию ---------- */
// Профиль — снимок всех полей, кроме языка интерфейса. «Очистить» возвращает к нему,
// а если профиль не сохранён — к пустым полям.
function applySnapshot(saved) {
  const next = stateFrom(saved);
  for (const k of Object.keys(next)) if (k !== 'lang') state[k] = next[k]; // язык профилем не меняется
  renderCountry();
  refreshers.forEach((fn) => fn());
  update();
}
function renderDefaultsUi() {
  const profile = readStored(PROFILE_KEY);
  $('defaultsStatus').textContent = profile
    ? t('defaults.statusSaved', { date: dateFmt.format(new Date(profile.savedAt)) })
    : t('defaults.statusNone');
  $('deleteDefaults').hidden = !profile;
  $('resetAll').textContent = t(profile ? 'btn.resetToMine' : 'btn.reset');
}
$('saveDefaults').addEventListener('click', () => {
  const ok = writeStored(PROFILE_KEY, { savedAt: Date.now(), state: snapshot() });
  renderDefaultsUi();
  toast(t(ok ? 'toast.defaultsSaved' : 'toast.storageError'));
});
$('deleteDefaults').addEventListener('click', () => {
  writeStored(PROFILE_KEY, null);
  renderDefaultsUi();
  toast(t('toast.defaultsDeleted'));
});
$('resetAll').addEventListener('click', () => applySnapshot(readStored(PROFILE_KEY)?.state));
$('printBtn').addEventListener('click', () => window.print());
$('copyBtn').addEventListener('click', copyResult);

/* ---------- Расчёт и вывод ---------- */

function update() {
  try {
    last = calculate({
      regime: state.regime,
      salaryBasis: state.salaryBasis,
      netSalary: state.salary,
      grossSalary: state.salary,
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

// Строка «на руки / начислено» таблицы начисления.
const incRow = (text, hint, net, gross, s, cls) =>
  row([{ text, hint }, { text: money(net, s), num: true, dl: t('th.net') }, { text: money(gross, s), num: true, dl: t('th.gross') }], cls);
// Строка налога или взноса: название с подсказкой, ставка, сумма.
const taxRow = (x, s) =>
  row([{ text: t(x.labelKey), hint: tr(x.hint) }, { text: pct(x.rate), num: true, dl: t('th.rate') }, { text: money(x.amount, s), num: true, dl: t('th.amount') }]);
const taxLine = (x, s) => `  ${t(x.labelKey)} ${pct(x.rate)}: ${money(x.amount, s)}`;

function renderResult(r) {
  const s = sym(r.country);
  const inc = r.income;

  syncSalaryFields();

  // Карточки премии и бонуса: сумма в базе введённого оклада, вторая база — в подписи.
  const isGross = inc.salaryBasis === 'gross';
  const pick = (net, gross) => (isGross ? gross : net);
  const showPair = (base, net, gross) => {
    $(`${base}Calc`).textContent = money(pick(net, gross), s);
    $(`${base}OtherCalc`).textContent = t(isGross ? 'kv.otherNet' : 'kv.otherGross', { other: money(pick(gross, net), s) });
  };
  showPair('premiumFull', inc.premiumFull, inc.grossPremiumFull);
  showPair('dailyRate', inc.dailyRate, inc.grossDailyRate);
  showPair('bonusYear', inc.netBonusYear, inc.grossBonusYear);
  showPair('bonusMonth', inc.netBonus, inc.grossBonus);
  $('utilizationCalc').textContent = pct(inc.utilization / 100);
  $('premiumCalc').textContent = t('premium.payoutValue', {
    amount: money(pick(inc.netPremium, inc.grossPremium), s),
    days: num(inc.projectDays),
    rate: money(pick(inc.dailyRate, inc.grossDailyRate), s),
    basis: t(`basis.${inc.salaryBasis}`),
  });

  // Ключевые показатели
  $('hNet').textContent = money0(inc.netPay, s);
  $('hNetSub').textContent = inc.netBonusYear > 0 ? t('hero.netBonus', { amount: money0(inc.netBonusYear, s) }) : t('hero.perMonth');
  $('hGross').textContent = money0(inc.gross, s);
  $('hGrossSub').textContent = inc.gross > 0 ? t('hero.grossSub', { amount: money0(r.employeeTotal, s) }) : '—';
  $('hCost').textContent = money0(r.totalCost, s);
  $('hCostSub').textContent = r.totalCost > 0 ? t('hero.costSub', { amount: money0(r.employerTotal, s) }) : t('hero.perMonth');
  $('hCostYear').textContent = money0(r.totalCostYear, s);
  $('hRatio').textContent = r.costToNetRatio ? t('hero.ratio', { x: num(r.costToNetRatio) }) : '—';

  $('resRegime').textContent = `· ${countryName(r.country)}, ${regimeText(r.regime, 'short')}`;

  // Начисление
  $('incomeBody').replaceChildren(...[
    incRow(t('row.salary'), '', inc.netSalary, inc.grossSalary, s),
    incRow(
      t('row.premium', { pct: pct(inc.premiumPct / 100) }),
      t('row.premiumHint', { days: num(inc.projectDays), work: num(inc.workDays), util: pct(inc.utilization / 100) }),
      inc.netPremium, inc.grossPremium, s,
    ),
    inc.annualBonusPct > 0 && incRow(
      t('row.bonus', { pct: pct(inc.annualBonusPct / 100) }),
      t('row.bonusHint', { net: money(inc.netBonusYear, s), gross: money(inc.grossBonusYear, s) }),
      inc.netBonus, inc.grossBonus, s,
    ),
    row([{ text: t('row.total'), th: true }, { text: money(inc.netTotal, s), num: true, dl: t('th.net') }, { text: money(inc.gross, s), num: true, dl: t('th.gross') }], 'total'),
    incRow(t('row.dailyRate'), t('row.dailyRateHint'), inc.dailyRate, inc.grossDailyRate, s, 'ref'),
  ].filter(Boolean));

  // Удержания и отчисления работодателя
  $('employeeBody').replaceChildren(...r.employee.map((x) => taxRow(x, s)));
  $('employeeTotal').textContent = money(r.employeeTotal, s);
  $('employerBody').replaceChildren(...(r.employer.length
    ? r.employer.map((x) => taxRow(x, s))
    : [row([{ text: t('employer.none') }, { text: '' }, { text: money(0, s), num: true }])]));
  $('employerTotal').textContent = money(r.employerTotal, s);

  // Полная стоимость
  $('costBody').replaceChildren(
    row([{ text: t('cost.gross') }, { text: money(inc.gross, s), num: true }]),
    row([{ text: t('cost.employer') }, { text: money(r.employerTotal, s), num: true }]),
    row([{ text: t('cost.payroll'), th: true }, { text: money(r.payrollCost, s), num: true }], 'total'),
    ...r.extras.items.filter((x) => x.amount > 0)
      .map((x) => row([{ text: t('cost.extraItem', { label: t(x.labelKey) }), hint: tr(x.hint) }, { text: money(x.amount, s), num: true }])),
    row([{ text: t('cost.extras') }, { text: money(r.extras.total, s), num: true }]),
    row([{ text: t('cost.month'), th: true }, { text: money(r.totalCost, s), num: true }], 'grand'),
    row([{ text: t('cost.year'), th: true }, { text: money(r.totalCostYear, s), num: true }], 'total'),
    row([{ text: t('cost.wedge'), hint: t('cost.wedgeHint') }, { text: pct(r.taxWedge), num: true }]),
  );

  $('infoNotes').replaceChildren(...r.info.map((n) => {
    const li = document.createElement('li');
    li.textContent = tr(n);
    return li;
  }));
}

/* ---------- Копирование ---------- */
function resultAsText(r) {
  const s = sym(r.country);
  const inc = r.income;
  const line = (l, v) => `${l}: ${v}`;
  const srcTag = (basis) => (inc.salaryBasis === basis ? ` ${t('copy.source')}` : '');
  const out = [
    t('copy.title', { country: countryName(r.country), regime: regimeText(r.regime, 'label') }),
    '',
    line(t('copy.salary'), money(inc.netSalary, s) + srcTag('net')),
    line(t('copy.salaryGross'), money(inc.grossSalary, s) + srcTag('gross')),
    t('copy.premium', { pct: pct(inc.premiumPct / 100), full: money(inc.premiumFull, s), rate: money(inc.dailyRate, s), grossRate: money(inc.grossDailyRate, s) }),
    line(t('copy.premiumDays', { days: num(inc.projectDays), work: num(inc.workDays), util: pct(inc.utilization / 100) }), money(inc.netPremium, s)),
  ];
  if (inc.annualBonusPct > 0) out.push(line(t('copy.bonus', { pct: pct(inc.annualBonusPct / 100), year: money(inc.netBonusYear, s) }), money(inc.netBonus, s)));
  out.push(
    line(t('copy.netTotal'), money(inc.netTotal, s)),
    line(t('copy.gross'), money(inc.gross, s)),
    '',
    t('copy.employee'),
    ...r.employee.map((x) => taxLine(x, s)),
    line(t('copy.total'), money(r.employeeTotal, s)),
    '',
    t('copy.employer'),
    ...r.employer.map((x) => taxLine(x, s)),
    line(t('copy.total'), money(r.employerTotal, s)),
    '',
    line(t('cost.payroll'), money(r.payrollCost, s)),
    ...r.extras.items.filter((x) => x.amount > 0).map((x) => line(`  ${t('cost.extraItem', { label: t(x.labelKey) })}`, money(x.amount, s))),
    line(t('cost.extras'), money(r.extras.total, s)),
    line(t('cost.month'), money(r.totalCost, s)),
    line(t('cost.year'), money(r.totalCostYear, s)),
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
