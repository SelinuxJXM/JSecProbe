/**
 * 测评结论枚举 —— UI 值域与数据库值域的唯一真相源。
 *
 * 项目里存在两套值域，历史上被多处各自手抄（表格、AI 分析、统计 SQL、报告、导入导出），
 * 新增或改动一个写法时很容易漏掉其中一处，而且失败是静默的：统计把未知值 `continue` 跳过，
 * 不报错、只是少算一条。本模块把「有哪些值」和「怎么解析」收口到一处，
 * 由 tests/shared/assessment-result.test.ts 做反向断言，任何一处漂移都会让测试红。
 *
 * - UI 值（`tableRows[].compliance`）：'' | conform | partial | nonconform | na
 * - DB 值（`assessment_records.result`）：见 DB_RESULT_VALUES，含新旧两代别名
 *
 * 注意：本模块只负责枚举与解析，**不改变任何统计口径**。各 SQL 里硬编码的
 * `result IN (...)` 原样保留，改由测试比对它们与本模块声明的集合是否一致。
 */

/** 表格行使用的结论值；空串表示「待判定 / 未测」。 */
export const UI_COMPLIANCE = ['conform', 'partial', 'nonconform', 'na'] as const;
export type UiCompliance = (typeof UI_COMPLIANCE)[number];
export type UiComplianceValue = UiCompliance | '';

/**
 * 数据库合法值，与 `electron/utils/validation.ts` 的历史白名单一一对应。
 * 这里保持原样（不增不减），避免放宽校验把中文标签写进数据库。
 */
export const DB_RESULT_VALUES = [
  'untested',
  'conform', 'compliant',
  'partial',
  'nonconform', 'non_compliant',
  'notapplicable', 'not_applicable',
] as const;
export type DbResult = (typeof DB_RESULT_VALUES)[number];

/** 统计口径：已判定（含不适用）的取值集合，与现有 SQL 字面量一致。 */
export const TESTED_RESULTS = [
  'compliant', 'conform', 'partial', 'non_compliant', 'nonconform', 'not_applicable',
] as const;
export const COMPLIANT_RESULTS = ['compliant', 'conform'] as const;
export const PARTIAL_RESULTS = ['partial'] as const;
export const NON_COMPLIANT_RESULTS = ['non_compliant', 'nonconform'] as const;
export const NOT_APPLICABLE_RESULTS = ['not_applicable'] as const;

/**
 * 已知例外（本轮刻意不动）：`notapplicable` 是校验层允许的旧别名，但不在统计口径里。
 * 若哪天要统一，必须同步迁移历史数据并回归所有统计/报表，不能只在常量里补一个值。
 */

/** DB 值 / 展示别名 → UI 值。键覆盖 index.vue 原先两份 complianceMap 的全部写法。 */
const DB_TO_UI: Record<string, UiComplianceValue> = {
  '': '',
  untested: '',
  conform: 'conform',
  compliant: 'conform',
  partial: 'partial',
  nonconform: 'nonconform',
  non_compliant: 'nonconform',
  na: 'na',
  notapplicable: 'na',
  not_applicable: 'na',
};

/** AI 或人工填写的中文标签 → UI 值。 */
const LABEL_TO_UI: Record<string, UiComplianceValue> = {
  '待判定': '',
  '未测评': '',
  '符合': 'conform',
  '部分符合': 'partial',
  '不符合': 'nonconform',
  '不适用': 'na',
};

/** 精确匹配表：DB 别名 + 中文标签 + UI 值自身。 */
const EXACT_TABLE: Record<string, UiComplianceValue> = (() => {
  const table: Record<string, UiComplianceValue> = { ...DB_TO_UI, ...LABEL_TO_UI };
  for (const value of UI_COMPLIANCE) table[value] = value;
  return table;
})();

function lookupExact(text: string): { hit: boolean; value: UiComplianceValue } {
  const lower = text.toLowerCase();
  if (Object.prototype.hasOwnProperty.call(EXACT_TABLE, text)) {
    return { hit: true, value: EXACT_TABLE[text] };
  }
  if (Object.prototype.hasOwnProperty.call(EXACT_TABLE, lower)) {
    return { hit: true, value: EXACT_TABLE[lower] };
  }
  return { hit: false, value: '' };
}

/**
 * 把数据库值 / 中文标签 / UI 值统一转成表格行的结论值。
 * 精确匹配，未知值返回空串（保持原有 `complianceMap[x] || ''` 的行为）。
 */
export function toUiCompliance(raw: unknown): UiComplianceValue {
  if (typeof raw !== 'string') return '';
  return lookupExact(raw.trim()).value;
}

/**
 * 解析 AI 返回的自由文本结论，供「写入表格」和「显示标签颜色」共用。
 *
 * 关键顺序：否定词必须排在「符合」之前。历史写法用 `includes('符合')` 打头，
 * 「不符合」「部分符合」都会先命中第一分支被标成 conform —— 入库值是对的（精确 map），
 * 但界面样式会错。这里按「最不利 / 否定优先」排列，从根上消除该歧义。
 */
export function parseAiCompliance(raw: unknown): UiComplianceValue {
  if (typeof raw !== 'string') return '';
  const text = raw.trim();
  if (!text) return '';

  const exact = lookupExact(text);
  if (exact.hit) return exact.value;

  const lower = text.toLowerCase();
  // 1. 不符合（含「符合」二字，必须先判）
  if (text.includes('不符合') || text.includes('不合规')
    || /non[-_ ]?compliant|nonconform|not compliant/.test(lower)) return 'nonconform';
  // 2. 部分符合（同样含「符合」）
  if (text.includes('部分符合') || lower.includes('partial')) return 'partial';
  // 3. 不适用
  if (text.includes('不适用') || /not[-_ ]?applicable/.test(lower)) return 'na';
  // 4. 符合，兜底
  if (text.includes('符合') || lower.includes('compliant') || lower.includes('conform')) return 'conform';

  return '';
}

/** 供 validation.ts 使用的类型守卫。 */
export function isDbResult(value: string): value is DbResult {
  return (DB_RESULT_VALUES as readonly string[]).includes(value);
}
