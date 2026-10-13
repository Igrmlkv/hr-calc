// Параметры налогов и сборов по умолчанию (2026 год).
// Все ставки — доли (0.13 = 13 %). Все пороги — в национальной валюте.
// Значения можно переопределить в интерфейсе («Параметры расчёта»).

export const PARAMS_VERSION = '2026-01';

export const COUNTRIES = {
  RU: { name: 'Россия', currency: 'RUB', symbol: '₽' },
  KZ: { name: 'Казахстан', currency: 'KZT', symbol: '₸' },
  UZ: { name: 'Узбекистан', currency: 'UZS', symbol: 'сум' },
};

export const REGIMES = {
  ru_td_general: {
    country: 'RU',
    label: 'Трудовой договор, общий тариф взносов',
    short: 'ТД, общий тариф',
    notes: [
      'НДФЛ по прогрессивной шкале (13–22 %), ставка определяется по годовому доходу.',
      'Страховые взносы по единому тарифу 30 % до предельной базы и 15,1 % сверх неё.',
      'Взносы на травматизм (класс риска I — 0,2 %).',
    ],
  },
  ru_td_it: {
    country: 'RU',
    label: 'Трудовой договор, аккредитованная ИТ-компания',
    short: 'ТД, ИТ-компания',
    notes: [
      'НДФЛ по прогрессивной шкале (13–22 %).',
      'Пониженный тариф взносов 7,6 % до предельной базы и 15 % сверх неё (с 2026 г.).',
      'Взносы на травматизм 0,2 %.',
    ],
  },
  ru_gph: {
    country: 'RU',
    label: 'Договор ГПХ (подряд / услуги)',
    short: 'ГПХ',
    notes: [
      'НДФЛ по прогрессивной шкале (13–22 %).',
      'Страховые взносы по единому тарифу 30 % / 15,1 % (включая ВНиМ с 2023 г.).',
      'Взносы на травматизм не начисляются, если договором не предусмотрено иное.',
      'Отпускные и больничные не положены — учтите это при сравнении с ТД.',
    ],
  },
  kz_td_our: {
    country: 'KZ',
    label: 'Трудовой договор, работодатель на общеустановленном режиме',
    short: 'ТД, ОУР',
    notes: [
      'Удержания: ОПВ 10 %, ВОСМС 2 %, ИПН 10 % (15 % с превышения 8 500 МРП в год) после стандартного вычета 30 МРП.',
      'Работодатель: ОПВР 3,5 %, ООСМС 3 %, СО 5 %, СН 11 % (за минусом СО).',
    ],
  },
  kz_td_simplified: {
    country: 'KZ',
    label: 'Трудовой договор, работодатель на упрощённой декларации',
    short: 'ТД, упрощёнка',
    notes: [
      'Удержания с сотрудника те же, что и на ОУР.',
      'Работодатель на СНР по упрощённой декларации не платит социальный налог за работников.',
      'Остальные отчисления (ОПВР, ООСМС, СО) уплачиваются.',
    ],
  },
  kz_gph: {
    country: 'KZ',
    label: 'Договор ГПХ',
    short: 'ГПХ',
    notes: [
      'Удержания: ОПВ 10 %, ВОСМС 2 %, ИПН 10 % (стандартный вычет 30 МРП по умолчанию не применяется).',
      'Заказчик уплачивает ОПВР 3,5 %. СО, ООСМС и СН по ГПХ не начисляются.',
    ],
  },
  uz_td_standard: {
    country: 'UZ',
    label: 'Трудовой договор, стандартный режим',
    short: 'ТД, стандарт',
    notes: [
      'НДФЛ 12 % (в том числе 0,1 % — отчисления на ИНПС внутри НДФЛ).',
      'Социальный налог работодателя 12 %.',
    ],
  },
  uz_td_itpark: {
    country: 'UZ',
    label: 'Трудовой договор, резидент IT Park',
    short: 'ТД, IT Park',
    notes: [
      'НДФЛ 7,5 % для сотрудников резидентов IT Park.',
      'Резиденты IT Park освобождены от социального налога.',
    ],
  },
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

// Описание редактируемых полей для панели «Параметры расчёта».
// type: 'pct' — процент (хранится как доля), 'money' — сумма, 'int' — целое, 'bool'.
export const PARAM_FIELDS = {
  RU: [
    { key: 'contribBaseLimit', label: 'Предельная база по взносам (год)', type: 'money' },
    { key: 'generalBelow', label: 'Общий тариф взносов до базы', type: 'pct' },
    { key: 'generalAbove', label: 'Общий тариф взносов сверх базы', type: 'pct' },
    { key: 'itBelow', label: 'ИТ-тариф до базы', type: 'pct' },
    { key: 'itAbove', label: 'ИТ-тариф сверх базы', type: 'pct' },
    { key: 'injuryRate', label: 'Травматизм (класс риска)', type: 'pct' },
    { key: 'mrot', label: 'МРОТ (справочно)', type: 'money' },
  ],
  KZ: [
    { key: 'mrp', label: 'МРП', type: 'money' },
    { key: 'mzp', label: 'МЗП', type: 'money' },
    { key: 'ipnRate', label: 'ИПН, базовая ставка', type: 'pct' },
    { key: 'ipnHighRate', label: 'ИПН с превышения порога', type: 'pct' },
    { key: 'ipnHighThresholdMrp', label: 'Порог ИПН, МРП в год', type: 'int' },
    { key: 'stdDeductionMrp', label: 'Стандартный вычет, МРП', type: 'int' },
    { key: 'stdDeductionForGph', label: 'Применять вычет к ГПХ', type: 'bool' },
    { key: 'opvRate', label: 'ОПВ', type: 'pct' },
    { key: 'opvCapMzp', label: 'Предел базы ОПВ, МЗП', type: 'int' },
    { key: 'vosmsRate', label: 'ВОСМС', type: 'pct' },
    { key: 'vosmsCapMzp', label: 'Предел базы ВОСМС, МЗП', type: 'int' },
    { key: 'opvrRate', label: 'ОПВР', type: 'pct' },
    { key: 'opvrCapMzp', label: 'Предел базы ОПВР, МЗП', type: 'int' },
    { key: 'oosmsRate', label: 'ООСМС', type: 'pct' },
    { key: 'oosmsCapMzp', label: 'Предел базы ООСМС, МЗП', type: 'int' },
    { key: 'soRate', label: 'СО', type: 'pct' },
    { key: 'soMinMzp', label: 'Мин. база СО, МЗП', type: 'int' },
    { key: 'soCapMzp', label: 'Предел базы СО, МЗП', type: 'int' },
    { key: 'snRate', label: 'СН', type: 'pct' },
  ],
  UZ: [
    { key: 'ndflStandard', label: 'НДФЛ, стандарт', type: 'pct' },
    { key: 'socialStandard', label: 'Соцналог, стандарт', type: 'pct' },
    { key: 'ndflItPark', label: 'НДФЛ, IT Park', type: 'pct' },
    { key: 'socialItPark', label: 'Соцналог, IT Park', type: 'pct' },
    { key: 'inpsRate', label: 'ИНПС (внутри НДФЛ, справочно)', type: 'pct' },
  ],
};

export function cloneDefaultParams() {
  return JSON.parse(JSON.stringify(DEFAULT_PARAMS, (k, v) => (v === Infinity ? 'Infinity' : v)), (k, v) =>
    v === 'Infinity' ? Infinity : v,
  );
}
