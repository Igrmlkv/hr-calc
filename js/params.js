// Параметры налогов и сборов по умолчанию (2026 год).
// Все ставки — доли (0.13 = 13 %). Все пороги — в национальной валюте.
// Значения можно переопределить в интерфейсе («Параметры расчёта»).

export const PARAMS_VERSION = '2026-01';

// Тексты режимов (название, краткое название, пояснения) — в js/i18n.js: regime.<id>.*
export const REGIMES = {
  ru_td_general: { country: 'RU' },
  ru_td_it: { country: 'RU' },
  ru_gph: { country: 'RU' },
  kz_td_our: { country: 'KZ' },
  kz_td_simplified: { country: 'KZ' },
  kz_gph: { country: 'KZ' },
  uz_td_standard: { country: 'UZ' },
  uz_td_itpark: { country: 'UZ' },
};

export function regimesForCountry(country) {
  return Object.entries(REGIMES)
    .filter(([, r]) => r.country === country)
    .map(([id, r]) => ({ id, ...r }));
}

// Структура параметров. Поле `fields` описывает редактируемые значения для UI.
export const DEFAULT_PARAMS = {
  RU: {
    ndflBrackets: [
      { upTo: 2_400_000, rate: 0.13 },
      { upTo: 5_000_000, rate: 0.15 },
      { upTo: 20_000_000, rate: 0.18 },
      { upTo: 50_000_000, rate: 0.20 },
      { upTo: Infinity, rate: 0.22 },
    ],
    contribBaseLimit: 2_979_000, // предельная база по взносам, год
    generalBelow: 0.30,
    generalAbove: 0.151,
    itBelow: 0.076,
    itAbove: 0.15,
    injuryRate: 0.002,
    mrot: 27_093,
  },
  KZ: {
    mrp: 4_325,
    mzp: 85_000,
    ipnRate: 0.10,
    ipnHighRate: 0.15,
    ipnHighThresholdMrp: 8_500, // годовой порог
    stdDeductionMrp: 30,
    stdDeductionForGph: false,
    opvRate: 0.10,
    opvCapMzp: 50,
    vosmsRate: 0.02,
    vosmsCapMzp: 10,
    opvrRate: 0.035,
    opvrCapMzp: 50,
    oosmsRate: 0.03,
    oosmsCapMzp: 10,
    soRate: 0.05,
    soMinMzp: 1,
    soCapMzp: 7,
    snRate: 0.11,
  },
  UZ: {
    ndflStandard: 0.12,
    socialStandard: 0.12,
    ndflItPark: 0.075,
    socialItPark: 0,
    inpsRate: 0.001,
  },
};

// Описание редактируемых полей для панели «Параметры расчёта». Подписи — в i18n: param.<key>.
// type: 'pct' — процент (хранится как доля), 'money' — сумма, 'int' — целое, 'bool'.
export const PARAM_FIELDS = {
  RU: [
    { key: 'contribBaseLimit', type: 'money' },
    { key: 'generalBelow', type: 'pct' },
    { key: 'generalAbove', type: 'pct' },
    { key: 'itBelow', type: 'pct' },
    { key: 'itAbove', type: 'pct' },
    { key: 'injuryRate', type: 'pct' },
    { key: 'mrot', type: 'money' },
  ],
  KZ: [
    { key: 'mrp', type: 'money' },
    { key: 'mzp', type: 'money' },
    { key: 'ipnRate', type: 'pct' },
    { key: 'ipnHighRate', type: 'pct' },
    { key: 'ipnHighThresholdMrp', type: 'int' },
    { key: 'stdDeductionMrp', type: 'int' },
    { key: 'stdDeductionForGph', type: 'bool' },
    { key: 'opvRate', type: 'pct' },
    { key: 'opvCapMzp', type: 'int' },
    { key: 'vosmsRate', type: 'pct' },
    { key: 'vosmsCapMzp', type: 'int' },
    { key: 'opvrRate', type: 'pct' },
    { key: 'opvrCapMzp', type: 'int' },
    { key: 'oosmsRate', type: 'pct' },
    { key: 'oosmsCapMzp', type: 'int' },
    { key: 'soRate', type: 'pct' },
    { key: 'soMinMzp', type: 'int' },
    { key: 'soCapMzp', type: 'int' },
    { key: 'snRate', type: 'pct' },
  ],
  UZ: [
    { key: 'ndflStandard', type: 'pct' },
    { key: 'socialStandard', type: 'pct' },
    { key: 'ndflItPark', type: 'pct' },
    { key: 'socialItPark', type: 'pct' },
    { key: 'inpsRate', type: 'pct' },
  ],
};

export function cloneDefaultParams() {
  return JSON.parse(JSON.stringify(DEFAULT_PARAMS, (k, v) => (v === Infinity ? 'Infinity' : v)), (k, v) =>
    v === 'Infinity' ? Infinity : v,
  );
}
