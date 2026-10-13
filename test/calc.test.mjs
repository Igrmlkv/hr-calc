import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculate, computeFromGross, grossUp, progressiveTax, monthlyExtras } from '../js/calc.js';
import { DEFAULT_PARAMS, REGIMES, cloneDefaultParams } from '../js/params.js';

const close = (a, b, eps = 0.01) => assert.ok(Math.abs(a - b) < eps, `${a} ≠ ${b}`);

test('прогрессивный НДФЛ РФ: граничные значения шкалы', () => {
  const b = DEFAULT_PARAMS.RU.ndflBrackets;
  close(progressiveTax(1_000_000, b), 130_000);
  close(progressiveTax(2_400_000, b), 312_000);
  close(progressiveTax(3_000_000, b), 312_000 + 600_000 * 0.15);
  close(progressiveTax(6_000_000, b), 312_000 + 2_600_000 * 0.15 + 1_000_000 * 0.18);
});

test('РФ ТД общий тариф: 100 000 gross в месяц', () => {
  const r = computeFromGross('ru_td_general', 100_000);
  close(r.employee[0].amount, 13_000);
  close(r.net, 87_000);
  close(r.employer.find((x) => x.key === 'contrib').amount, 30_000);
  close(r.employer.find((x) => x.key === 'injury').amount, 200);
});

test('РФ ТД: превышение предельной базы взносов', () => {
  const gross = 300_000; // 3,6 млн в год > 2 979 000
  const r = computeFromGross('ru_td_general', gross);
  const baseM = 2_979_000 / 12;
  close(r.employer[0].amount, baseM * 0.3 + (gross - baseM) * 0.151);
  // НДФЛ: 3,6 млн в год → 2,4 млн × 13 % + 1,2 млн × 15 %
  close(r.employee[0].amount, (2_400_000 * 0.13 + 1_200_000 * 0.15) / 12);
});

test('РФ ИТ-компания: пониженный тариф', () => {
  const r = computeFromGross('ru_td_it', 100_000);
  close(r.employer.find((x) => x.key === 'contrib').amount, 7_600);
});

test('РФ ГПХ: нет травматизма', () => {
  const r = computeFromGross('ru_gph', 100_000);
  assert.equal(r.employer.find((x) => x.key === 'injury'), undefined);
  close(r.employer[0].amount, 30_000);
});

test('КЗ ТД ОУР: 500 000 ₸ gross', () => {
  const p = DEFAULT_PARAMS.KZ;
  const r = computeFromGross('kz_td_our', 500_000);
  const opv = 50_000;
  const vosms = 10_000;
  const taxable = 500_000 - opv - vosms - 30 * p.mrp;
  close(r.employee.find((x) => x.key === 'opv').amount, opv);
  close(r.employee.find((x) => x.key === 'vosms').amount, vosms);
  close(r.employee.find((x) => x.key === 'ipn').amount, taxable * 0.1);
  close(r.employer.find((x) => x.key === 'opvr').amount, 17_500);
  close(r.employer.find((x) => x.key === 'oosms').amount, 15_000);
  const so = (500_000 - opv) * 0.05;
  close(r.employer.find((x) => x.key === 'so').amount, so);
  close(r.employer.find((x) => x.key === 'sn').amount, (500_000 - opv - vosms) * 0.11 - so);
});

test('КЗ: пределы баз ОПВ/ВОСМС/ООСМС/СО', () => {
  const p = DEFAULT_PARAMS.KZ;
  const r = computeFromGross('kz_td_our', 10_000_000);
  close(r.employee.find((x) => x.key === 'opv').amount, 50 * p.mzp * 0.1);
  close(r.employee.find((x) => x.key === 'vosms').amount, 10 * p.mzp * 0.02);
  close(r.employer.find((x) => x.key === 'oosms').amount, 10 * p.mzp * 0.03);
  close(r.employer.find((x) => x.key === 'so').amount, 7 * p.mzp * 0.05);
  close(r.employer.find((x) => x.key === 'opvr').amount, 50 * p.mzp * 0.035);
});

test('КЗ: ИПН 15 % с превышения 8 500 МРП в год', () => {
  const p = DEFAULT_PARAMS.KZ;
  const gross = 5_000_000;
  const r = computeFromGross('kz_td_our', gross);
  const opv = 50 * p.mzp * 0.1;
  const vosms = 10 * p.mzp * 0.02;
  const taxableYear = (gross - opv - vosms - 30 * p.mrp) * 12;
  const thr = 8_500 * p.mrp;
  const ipnYear = thr * 0.1 + (taxableYear - thr) * 0.15;
  close(r.employee.find((x) => x.key === 'ipn').amount, ipnYear / 12);
});

test('КЗ упрощёнка: нет СН, остальное есть', () => {
  const r = computeFromGross('kz_td_simplified', 500_000);
  assert.equal(r.employer.find((x) => x.key === 'sn'), undefined);
  assert.ok(r.employer.find((x) => x.key === 'so'));
  assert.ok(r.employer.find((x) => x.key === 'oosms'));
});

test('КЗ ГПХ: только ОПВР у заказчика, вычета нет', () => {
  const p = DEFAULT_PARAMS.KZ;
  const r = computeFromGross('kz_gph', 500_000);
  assert.deepEqual(r.employer.map((x) => x.key), ['opvr']);
  close(r.employee.find((x) => x.key === 'ipn').amount, (500_000 - 50_000 - 10_000) * 0.1);
  const p2 = cloneDefaultParams();
  p2.KZ.stdDeductionForGph = true;
  const r2 = computeFromGross('kz_gph', 500_000, p2);
  close(r2.employee.find((x) => x.key === 'ipn').amount, (500_000 - 50_000 - 10_000 - 30 * p.mrp) * 0.1);
});

test('КЗ: ОПВР можно отключить', () => {
  const r = computeFromGross('kz_td_our', 500_000, DEFAULT_PARAMS, { kzOpvrApplies: false });
  assert.equal(r.employer.find((x) => x.key === 'opvr'), undefined);
});

test('УЗ стандарт и IT Park', () => {
  const r = computeFromGross('uz_td_standard', 10_000_000);
  close(r.employee[0].amount, 1_200_000);
  close(r.employer[0].amount, 1_200_000);
  const it = computeFromGross('uz_td_itpark', 10_000_000);
  close(it.employee[0].amount, 750_000);
  close(it.employer[0].amount, 0);
});

test('gross-up: обратный расчёт сходится для всех режимов', () => {
  for (const id of Object.keys(REGIMES)) {
    for (const net of [50_000, 150_000, 1_000_000, 10_000_000]) {
      const gross = grossUp(id, net);
      const r = computeFromGross(id, gross);
      close(r.net, net, 0.001);
    }
  }
});

test('gross-up: РФ 87 000 на руки → 100 000 начислено', () => {
  close(grossUp('ru_td_general', 87_000), 100_000, 0.001);
});

test('премия: % от оклада → ставка в день → выплата по дням на проекте', () => {
  const r = calculate({ regime: 'uz_td_standard', netSalary: 100_000, premiumPct: 30, workDays: 20, projectDays: 10 });
  close(r.income.premiumFull, 30_000);
  close(r.income.dailyRate, 1_500);
  close(r.income.utilization, 50);
  close(r.income.netPremium, 15_000);
  close(r.income.netTotal, 115_000);
  close(r.income.gross, 115_000 / 0.88, 0.02);
  close(r.income.grossSalary + r.income.grossPremium, r.income.gross, 0.02);
});

test('премия: дней на проекте не больше рабочих, нулевые дни не ломают расчёт', () => {
  const r = calculate({ regime: 'ru_td_general', netSalary: 100_000, premiumPct: 30, workDays: 21, projectDays: 30 });
  close(r.income.projectDays, 21);
  close(r.income.netPremium, 30_000);
  const z = calculate({ regime: 'ru_td_general', netSalary: 100_000, premiumPct: 30, workDays: 0, projectDays: 0 });
  close(z.income.dailyRate, 0);
  close(z.income.netPremium, 0);
});

test('дополнительные затраты приводятся к месяцу', () => {
  const e = monthlyExtras({
    telecom: { amount: 1200, period: 'month' },
    dms: { amount: 120_000, period: 'year' },
    training: { amount: 60_000, period: 'year' },
    equipment: { amount: 240_000, months: 24 },
  });
  close(e.total, 1200 + 10_000 + 5_000 + 10_000);
});

test('полный расчёт: итоговая стоимость = gross + отчисления + доп. затраты', () => {
  const r = calculate({
    regime: 'ru_td_general',
    netSalary: 87_000,
    premiumPct: 0,
    workDays: 21,
    projectDays: 21,
    extras: { telecom: { amount: 1000, period: 'month' } },
  });
  close(r.income.gross, 100_000);
  close(r.employerTotal, 30_200);
  close(r.payrollCost, 130_200);
  close(r.totalCost, 131_200);
  close(r.totalCostYear, 131_200 * 12);
  close(r.costToNetRatio, 131_200 / 87_000);
});

test('нулевой нетто не ломает расчёт', () => {
  const r = calculate({ regime: 'kz_td_our', netSalary: 0, premiumPct: 30, workDays: 21, projectDays: 21 });
  assert.equal(r.income.gross, 0);
  assert.equal(r.totalCost, 0);
});
