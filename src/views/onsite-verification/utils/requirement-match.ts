/**
 * 条款原文相似度比对，用于批量 AI 分析回填时的错配纠正。
 *
 * 背景：批量"智能匹配"会让 AI 自己把文档内容对应到测评项。当多个测评项主题相近
 * （如都涉及账户/权限），AI 生成长 JSON 时偶发把某项的结论写到相邻项的 itemId 下。
 * 提示词已要求 AI 在每条结果里回显对应测评项的 requirement 原文；
 * 前端据此校验 itemId 与结论是否错位，本模块提供比对原语。
 */

/** 归一化条款文本：去所有空白与中英文标点，只留文字/数字，并转小写。 */
export function normalizeRequirementText(text: string): string {
  return String(text || '')
    .replace(/[\s\n\r\t]/g, '')
    // eslint-disable-next-line no-useless-escape
    .replace(/[，。；、：（）()「」【】\[\]""''"'.,;:!?！？\-—_]/g, '')
    .toLowerCase();
}

/**
 * 判断两段条款原文是否"实质相同"：
 * - 归一化后完全相等 → 相同
 * - 一方包含另一方，且较短方 >= 12 字 → 相同（避免"应符合"这类短语误判）
 */
export function requirementTextMatches(a: string, b: string): boolean {
  const na = normalizeRequirementText(a);
  const nb = normalizeRequirementText(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const shorter = na.length <= nb.length ? na : nb;
  if (shorter.length < 12) return false;
  return na.includes(nb) || nb.includes(na);
}
