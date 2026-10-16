// Ядро расчёта. Чистые функции без зависимостей от DOM — используются и в браузере, и в тестах.
// Тексты не формируются здесь: строки результата несут ключ перевода (labelKey, hint.key, info[].key)
// и параметры (vars), которые интерфейс переводит и форматирует на выбранном языке.
import { DEFAULT_PARAMS, REGIMES } from './params.js';

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
      labelKey: 'tax.ndfl',
      rate: effective,
      amount: ndfl,
      hint: { key: 'hint.ndflProgressive' },
    },
  ];
  const employer = [
    {
      key: 'contrib',
      labelKey: isIt ? 'tax.contribIt' : 'tax.contrib',
      rate: gross > 0 ? contrib / gross : below,
      amount: contrib,
      hint: overBase > 0 ? { key: 'hint.contribOver', vars: { rate: above } } : { key: 'hint.contribWithin', vars: { rate: below } },
    },
  ];
  const isTd = regimeId !== 'ru_gph';
  const injuryRate = options.injuryRate ?? p.injuryRate;
  if (isTd) {
    employer.push({ key: 'injury', labelKey: 'tax.injury', rate: injuryRate, amount: gross * injuryRate });
  }
  const info = [];
  if (overBase > 0) info.push({ key: 'info.ruOverBase' });
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
    { key: 'opv', labelKey: 'tax.opv', rate: p.opvRate, amount: opv, hint: { key: 'hint.capMzp', vars: { n: p.opvCapMzp } } },
    { key: 'vosms', labelKey: 'tax.vosms', rate: p.vosmsRate, amount: vosms, hint: { key: 'hint.capMzp', vars: { n: p.vosmsCapMzp } } },
    {
      key: 'ipn',
      labelKey: 'tax.ipn',
      rate: taxable > 0 ? ipn / taxable : p.ipnRate,
      amount: ipn,
      hint: useDeduction
        ? { key: 'hint.ipnDeduction', vars: { n: p.stdDeductionMrp } }
        : { key: 'hint.ipnNoDeduction' },
    },
  ];

  const employer = [];
  if (opvrApplies) {
    employer.push({
      key: 'opvr',
      labelKey: 'tax.opvr',
      rate: p.opvrRate,
      amount: Math.min(gross, p.opvrCapMzp * p.mzp) * p.opvrRate,
      hint: { key: 'hint.opvr' },
    });
  }
  let so = 0;
  if (isTd) {
    employer.push({
      key: 'oosms',
      labelKey: 'tax.oosms',
      rate: p.oosmsRate,
      amount: Math.min(gross, p.oosmsCapMzp * p.mzp) * p.oosmsRate,
      hint: { key: 'hint.capMzp', vars: { n: p.oosmsCapMzp } },
    });
    const soBase = gross > 0 ? clamp(gross - opv, p.soMinMzp * p.mzp, p.soCapMzp * p.mzp) : 0;
    so = soBase * p.soRate;
    employer.push({
      key: 'so',
      labelKey: 'tax.so',
      rate: p.soRate,
      amount: so,
      hint: { key: 'hint.so', vars: { min: p.soMinMzp, max: p.soCapMzp } },
    });
  }
  if (regimeId === 'kz_td_our') {
    const snBase = Math.max(0, gross - opv - vosms);
    const sn = Math.max(0, snBase * p.snRate - so);
    employer.push({
      key: 'sn',
      labelKey: 'tax.sn',
      rate: p.snRate,
      amount: sn,
      hint: { key: 'hint.sn' },
    });
  }
  const info = [];
  if (annualTaxable > threshold) info.push({ key: 'info.kzIpnHigh', vars: { n: p.ipnHighThresholdMrp, rate: p.ipnHighRate } });
  if (regimeId === 'kz_td_simplified') info.push({ key: 'info.kzSimplified' });
  return finish(gross, employee, employer, info);
}

function computeUZ(regimeId, gross, p) {
  const isItPark = regimeId === 'uz_td_itpark';
  const ndflRate = isItPark ? p.ndflItPark : p.ndflStandard;
  const socialRate = isItPark ? p.socialItPark : p.socialStandard;
  const employee = [
    {
      key: 'ndfl',
      labelKey: 'tax.uzNdfl',
      rate: ndflRate,
      amount: gross * ndflRate,
      hint: { key: 'hint.inps', vars: { rate: p.inpsRate, amount: round2(gross * p.inpsRate) } },
    },
  ];
  const employer = [
    { key: 'social', labelKey: 'tax.social', rate: socialRate, amount: gross * socialRate },
  ];
  const info = isItPark ? [{ key: 'info.uzItPark', vars: { rate: ndflRate } }] : [];
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
    { key: 'telecom', labelKey: 'extras.telecom', amount: toMonthly(extras.telecom) },
    { key: 'dms', labelKey: 'extras.dms', amount: toMonthly(extras.dms) },
    { key: 'training', labelKey: 'extras.training', amount: toMonthly(extras.training) },
    {
      key: 'equipment',
      labelKey: 'extras.equipment',
      amount: (Number(eq.amount) || 0) / eqMonths,
      hint: eq.amount ? { key: 'hint.equipment', vars: { amount: Number(eq.amount), months: eqMonths } } : null,
    },
  ];
  return { items, total: items.reduce((s, x) => s + x.amount, 0) };
}

/**
 * Полный расчёт карточки.
 * input = {
 *   regime,
 *   salaryBasis  — 'net' (по умолчанию): оклад задан на руки, gross подбирается обратным расчётом;
 *                  'gross': оклад задан начислением, сумма на руки считается прямым расчётом,
 *   netSalary    — оклад на руки (при salaryBasis = 'net'),
 *   grossSalary  — оклад gross (при salaryBasis = 'gross'),
 *   premiumPct   — премия в % от оклада (при 100 % загрузки), в той же базе, что и оклад,
 *   workDays     — рабочих дней в месяце по календарю,
 *   projectDays  — дней на проекте в этом месяце,
 *   annualBonusPct — годовой бонус в % от годового оклада в той же базе (выплата раз в год,
 *                    в стоимости учитывается ежемесячным резервом 1/12),
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

  // Все составляющие сначала считаются в базе введённого оклада (на руки или gross).
  const salaryBasis = input.salaryBasis === 'gross' ? 'gross' : 'net';
  const salary = Math.max(0, Number(salaryBasis === 'gross' ? input.grossSalary : input.netSalary) || 0);
  const premiumPct = Math.max(0, Number(input.premiumPct) || 0);
  const workDays = Math.max(0, Number(input.workDays) || 0);
  const projectDays = clamp(Number(input.projectDays) || 0, 0, workDays);
  const premiumFull = salary * (premiumPct / 100); // премия за месяц при 100 % загрузки
  const dailyRate = workDays > 0 ? premiumFull / workDays : 0; // фиксированная ставка в день
  const utilization = workDays > 0 ? (projectDays / workDays) * 100 : 0;
  const premium = dailyRate * projectDays;
  const annualBonusPct = Math.max(0, Number(input.annualBonusPct) || 0);
  const bonus = salary * (annualBonusPct / 100); // ежемесячный резерв годового бонуса
  const total = salary + premium + bonus;

  const gross = salaryBasis === 'gross' ? total : grossUp(input.regime, total, params, options);
  const breakdown = computeFromGross(input.regime, gross, params, options);
  const netTotal = salaryBasis === 'gross' ? breakdown.net : total;
  // Перевод составляющих в обе базы — пропорционально их доле в итоге.
  const toNet = total > 0 ? netTotal / total : 1;
  const toGross = total > 0 ? gross / total : 1;
  const netSalary = salary * toNet;
  const netPremium = premium * toNet;
  const netBonus = bonus * toNet;
  const grossPremium = premium * toGross;
  const grossBonus = bonus * toGross;

  const extras = monthlyExtras(input.extras);
  const payrollCost = gross + breakdown.employerTotal; // ФОТ с отчислениями
  const totalCost = payrollCost + extras.total;

  const r2list = (list) => list.map((x) => ({ ...x, amount: round2(x.amount) }));

  return {
    regime: input.regime,
    country: regime.country,
    income: {
      salaryBasis,
      netSalary: round2(netSalary),
      grossSalary: round2(salary * toGross),
      premiumPct,
      premiumFull: round2(premiumFull * toNet),
      grossPremiumFull: round2(premiumFull * toGross),
      dailyRate: round2(dailyRate * toNet),
      grossDailyRate: round2(dailyRate * toGross),
      workDays,
      projectDays,
      utilization: round2(utilization),
      annualBonusPct,
      netBonus: round2(netBonus),
      grossBonus: round2(grossBonus),
      netBonusYear: round2(netBonus * 12),
      grossBonusYear: round2(grossBonus * 12),
      netPay: round2(netSalary + netPremium),
      netPremium: round2(netPremium),
      grossPremium: round2(grossPremium),
      netTotal: round2(netTotal),
      gross: round2(gross),
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
