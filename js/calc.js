// Ядро расчёта. Чистые функции без зависимостей от DOM — используются и в браузере, и в тестах.
import { DEFAULT_PARAMS, REGIMES, COUNTRIES } from './params.js';

const round2 = (x) => Math.round((x + Number.EPSILON) * 100) / 100;
const clamp = (x, lo, hi) => Math.min(Math.max(x, lo), hi);

/** Прогрессивный налог по годовым брекетам. */
export function progressiveTax(annualIncome, brackets) {
  let tax = 0;
  let prev = 0;
  for (const b of brackets) {
    if (annualIncome <= prev) break;
    const slice = Math.min(annualIncome, b.upTo) - prev;
    tax += slice * b.rate;
    prev = b.upTo;
  }
  return tax;
}

/**
 * Расчёт от начисленной суммы (gross) за месяц.
 * Предполагается равномерный доход в течение года: годовые пороги
 * (прогрессивная шкала, предельные базы) применяются как 1/12 в месяц.
 * Возвращает список удержаний с сотрудника и отчислений работодателя.
 */
export function computeFromGross(regimeId, gross, params = DEFAULT_PARAMS, options = {}) {
  const regime = REGIMES[regimeId];
  if (!regime) throw new Error(`Неизвестный режим: ${regimeId}`);
  switch (regime.country) {
    case 'RU':
      return computeRU(regimeId, gross, params.RU, options);
    case 'KZ':
      return computeKZ(regimeId, gross, params.KZ, options);
    case 'UZ':
      return computeUZ(regimeId, gross, params.UZ, options);
    default:
      throw new Error(`Неизвестная страна: ${regime.country}`);
  }
}

function finish(gross, employee, employer, info = []) {
  const employeeTotal = employee.reduce((s, x) => s + x.amount, 0);
  const employerTotal = employer.reduce((s, x) => s + x.amount, 0);
  return {
    gross,
    net: gross - employeeTotal,
    employee,
    employeeTotal,
    employer,
    employerTotal,
    info,
  };
}

function computeRU(regimeId, gross, p, options) {
  const annual = gross * 12;
  const ndfl = progressiveTax(annual, p.ndflBrackets) / 12;
  const effective = annual > 0 ? progressiveTax(annual, p.ndflBrackets) / annual : p.ndflBrackets[0].rate;

  const isIt = regimeId === 'ru_td_it';
  const below = isIt ? p.itBelow : p.generalBelow;
  const above = isIt ? p.itAbove : p.generalAbove;
  const baseMonthly = p.contribBaseLimit / 12;
  const withinBase = Math.min(gross, baseMonthly);
  const overBase = Math.max(0, gross - baseMonthly);
  const contrib = withinBase * below + overBase * above;

  const employee = [
    {
      key: 'ndfl',
      label: 'НДФЛ',
      rate: effective,
      amount: ndfl,
      hint: 'Прогрессивная шкала по годовому доходу',
    },
  ];
  const employer = [
    {
      key: 'contrib',
      label: isIt ? 'Страховые взносы (ИТ-тариф)' : 'Страховые взносы (единый тариф)',
      rate: gross > 0 ? contrib / gross : below,
      amount: contrib,
      hint: overBase > 0 ? `Сверх предельной базы: ${fmtPct(above)}` : `В пределах базы: ${fmtPct(below)}`,
    },
  ];
  const isTd = regimeId !== 'ru_gph';
  const injuryRate = options.injuryRate ?? p.injuryRate;
  if (isTd) {
    employer.push({ key: 'injury', label: 'Взносы на травматизм', rate: injuryRate, amount: gross * injuryRate });
  }
  const info = [];
  if (overBase > 0) info.push('Доход превышает 1/12 предельной базы по взносам — применён тариф сверх базы.');
  return finish(gross, employee, employer, info);
}

function computeKZ(regimeId, gross, p, options) {
  const isGph = regimeId === 'kz_gph';
  const isTd = !isGph;
  const opvrApplies = options.kzOpvrApplies ?? true;

  const opv = Math.min(gross, p.opvCapMzp * p.mzp) * p.opvRate;
  const vosms = Math.min(gross, p.vosmsCapMzp * p.mzp) * p.vosmsRate;

  const useDeduction = isTd || p.stdDeductionForGph;
  const deduction = useDeduction ? p.stdDeductionMrp * p.mrp : 0;
  const taxable = Math.max(0, gross - opv - vosms - deduction);
  const annualTaxable = taxable * 12;
  const threshold = p.ipnHighThresholdMrp * p.mrp;
  const annualIpn =
    Math.min(annualTaxable, threshold) * p.ipnRate + Math.max(0, annualTaxable - threshold) * p.ipnHighRate;
  const ipn = annualIpn / 12;

  const employee = [
    { key: 'opv', label: 'ОПВ', rate: p.opvRate, amount: opv, hint: `База не более ${p.opvCapMzp} МЗП` },
    { key: 'vosms', label: 'ВОСМС', rate: p.vosmsRate, amount: vosms, hint: `База не более ${p.vosmsCapMzp} МЗП` },
    {
      key: 'ipn',
      label: 'ИПН',
      rate: taxable > 0 ? ipn / taxable : p.ipnRate,
      amount: ipn,
      hint: useDeduction
        ? `База: доход − ОПВ − ВОСМС − вычет ${p.stdDeductionMrp} МРП`
        : 'База: доход − ОПВ − ВОСМС (без стандартного вычета)',
    },
  ];

  const employer = [];
  if (opvrApplies) {
    employer.push({
      key: 'opvr',
      label: 'ОПВР',
      rate: p.opvrRate,
      amount: Math.min(gross, p.opvrCapMzp * p.mzp) * p.opvrRate,
      hint: 'За сотрудников 1975 г. р. и младше',
    });
  }
  let so = 0;
  if (isTd) {
    employer.push({
      key: 'oosms',
      label: 'ООСМС',
      rate: p.oosmsRate,
      amount: Math.min(gross, p.oosmsCapMzp * p.mzp) * p.oosmsRate,
      hint: `База не более ${p.oosmsCapMzp} МЗП`,
    });
    const soBase = gross > 0 ? clamp(gross - opv, p.soMinMzp * p.mzp, p.soCapMzp * p.mzp) : 0;
    so = soBase * p.soRate;
    employer.push({
      key: 'so',
      label: 'Социальные отчисления (СО)',
      rate: p.soRate,
      amount: so,
      hint: `База: доход − ОПВ, от ${p.soMinMzp} до ${p.soCapMzp} МЗП`,
    });
  }
  if (regimeId === 'kz_td_our') {
    const snBase = Math.max(0, gross - opv - vosms);
    const sn = Math.max(0, snBase * p.snRate - so);
    employer.push({
      key: 'sn',
      label: 'Социальный налог (СН)',
      rate: p.snRate,
      amount: sn,
      hint: 'База: доход − ОПВ − ВОСМС; к уплате за минусом СО',
    });
  }
  const info = [];
  if (annualTaxable > threshold) info.push(`Годовой облагаемый доход превышает ${p.ipnHighThresholdMrp} МРП — к превышению применена ставка ИПН ${fmtPct(p.ipnHighRate)}.`);
  if (regimeId === 'kz_td_simplified') info.push('Работодатель на упрощённой декларации: СН за работников не уплачивается.');
  return finish(gross, employee, employer, info);
}

function computeUZ(regimeId, gross, p) {
  const isItPark = regimeId === 'uz_td_itpark';
  const ndflRate = isItPark ? p.ndflItPark : p.ndflStandard;
  const socialRate = isItPark ? p.socialItPark : p.socialStandard;
  const employee = [
    {
      key: 'ndfl',
      label: 'НДФЛ',
      rate: ndflRate,
      amount: gross * ndflRate,
      hint: `в т. ч. ИНПС ${fmtPct(p.inpsRate)}: ${round2(gross * p.inpsRate).toLocaleString('ru-RU')}`,
    },
  ];
  const employer = [
    { key: 'social', label: 'Социальный налог', rate: socialRate, amount: gross * socialRate },
  ];
  const info = isItPark ? ['Резидент IT Park: НДФЛ 7,5 %, соцналог не уплачивается.'] : [];
  return finish(gross, employee, employer, info);
}

/**
 * Обратный расчёт: подбор gross по заданной сумме «на руки».
 * Функция net(gross) монотонно возрастает, поэтому используется бисекция.
 */
export function grossUp(regimeId, targetNet, params = DEFAULT_PARAMS, options = {}) {
  if (!(targetNet > 0)) return 0;
  let lo = targetNet;
  let hi = targetNet * 2;
  for (let i = 0; i < 60 && computeFromGross(regimeId, hi, params, options).net < targetNet; i++) hi *= 2;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    const net = computeFromGross(regimeId, mid, params, options).net;
    if (Math.abs(net - targetNet) < 1e-7) return mid;
    if (net < targetNet) lo = mid;
    else hi = mid;
    if (hi - lo < 1e-9) break;
  }
  return (lo + hi) / 2;
}

/** Перевод дополнительных затрат к месячной сумме. */
export function monthlyExtras(extras = {}) {
  const toMonthly = (item) => {
    if (!item) return 0;
    const amount = Number(item.amount) || 0;
    if (item.period === 'year') return amount / 12;
    return amount;
  };
  const eq = extras.equipment || {};
  const eqMonths = Math.max(1, Number(eq.months) || 1);
  const items = [
    { key: 'telecom', label: 'Связь', amount: toMonthly(extras.telecom) },
    { key: 'dms', label: 'ДМС', amount: toMonthly(extras.dms) },
    { key: 'training', label: 'Обучение', amount: toMonthly(extras.training) },
    {
      key: 'equipment',
      label: 'Оборудование',
      amount: (Number(eq.amount) || 0) / eqMonths,
      hint: eq.amount ? `${Number(eq.amount).toLocaleString('ru-RU')} / ${eqMonths} мес.` : '',
    },
  ];
  return { items, total: items.reduce((s, x) => s + x.amount, 0) };
}

/**
 * Полный расчёт карточки.
 * input = {
 *   regime, netSalary,
 *   premiumPct   — премия в % от оклада (при 100 % загрузки),
 *   workDays     — рабочих дней в месяце по календарю,
 *   projectDays  — дней на проекте в этом месяце,
 *   extras: { telecom:{amount,period}, dms:{...}, training:{...}, equipment:{amount,months} },
 *   options: { kzOpvrApplies, injuryRate },
 *   params
 * }
 */
export function calculate(input) {
  const params = input.params || DEFAULT_PARAMS;
  const options = input.options || {};
  const regime = REGIMES[input.regime];
  if (!regime) throw new Error(`Неизвестный режим: ${input.regime}`);
  const country = COUNTRIES[regime.country];

  const netSalary = Math.max(0, Number(input.netSalary) || 0);
  const premiumPct = Math.max(0, Number(input.premiumPct) || 0);
  const workDays = Math.max(0, Number(input.workDays) || 0);
  const projectDays = clamp(Number(input.projectDays) || 0, 0, workDays);
  const premiumFull = netSalary * (premiumPct / 100); // премия за месяц при 100 % загрузки
  const dailyRate = workDays > 0 ? premiumFull / workDays : 0; // фиксированная ставка в день
  const utilization = workDays > 0 ? (projectDays / workDays) * 100 : 0;
  const netPremium = dailyRate * projectDays;
  const netTotal = netSalary + netPremium;

  const gross = grossUp(input.regime, netTotal, params, options);
  const breakdown = computeFromGross(input.regime, gross, params, options);
  const share = netTotal > 0 ? netSalary / netTotal : 1;
  const grossSalary = gross * share;
  const grossPremium = gross - grossSalary;

  const extras = monthlyExtras(input.extras);
  const payrollCost = gross + breakdown.employerTotal; // ФОТ с отчислениями
  const totalCost = payrollCost + extras.total;

  const r2list = (list) => list.map((x) => ({ ...x, amount: round2(x.amount) }));

  return {
    regime: { id: input.regime, ...regime },
    country: { code: regime.country, ...country },
    income: {
      netSalary: round2(netSalary),
      premiumPct,
      premiumFull: round2(premiumFull),
      dailyRate: round2(dailyRate),
      workDays,
      projectDays,
      utilization: round2(utilization),
      netPremium: round2(netPremium),
      netTotal: round2(netTotal),
      gross: round2(gross),
      grossSalary: round2(grossSalary),
      grossPremium: round2(grossPremium),
    },
    employee: r2list(breakdown.employee),
    employeeTotal: round2(breakdown.employeeTotal),
    employer: r2list(breakdown.employer),
    employerTotal: round2(breakdown.employerTotal),
    extras: { items: r2list(extras.items), total: round2(extras.total) },
    payrollCost: round2(payrollCost),
    totalCost: round2(totalCost),
    totalCostYear: round2(totalCost * 12),
    costToNetRatio: netTotal > 0 ? round2(totalCost / netTotal) : 0,
    taxWedge: gross + breakdown.employerTotal > 0 ? round2((breakdown.employeeTotal + breakdown.employerTotal) / payrollCost) : 0,
    info: breakdown.info,
  };
}

function fmtPct(x) {
  return `${(x * 100).toLocaleString('ru-RU', { maximumFractionDigits: 2 })} %`;
}
