/**
 * AI 批量结果解析（4 个批量分析功能共用）。
 *
 * AI 返回 {"results":[{"issueId":"...","字段":...},...]}，可能因输出过长被截断、
 * 或包了代码围栏。本工具：剥围栏 → 整体解析 → 逐对象救回 → 按 issueId 建索引，
 * 并拒绝空 id / 无有效字段的项。调用方按 issueId 精确回填，杜绝顺序错配。
 */
import { rescueArrayByKey } from './ai-json-rescue';

export interface BatchParseResult<T extends { issueId: string }> {
  /** 按 issueId 索引的结果 */
  byId: Map<string, T>;
  /** 是否走了逐对象救回（输出可能被截断） */
  partial: boolean;
  /** 原始结果条数（解析出的对象数） */
  count: number;
}

/**
 * 解析批量 AI 返回，按 issueId 建索引。
 * @param content AI 原始返回文本
 * @param isValid 判断某个结果对象是否"有效"（至少有一个目标字段非空）；返回 false 的项被丢弃
 */
export function parseBatchResultsById<T extends { issueId: string }>(
  content: string,
  isValid: (item: T) => boolean,
): BatchParseResult<T> {
  let text = String(content || '').trim();
  text = text.replace(/^\s*```(?:json|text)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();

  let raw: any[] = [];
  let partial = false;

  try {
    const parsed = JSON.parse(text);
    raw = Array.isArray(parsed?.results) ? parsed.results : [];
  } catch {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        const parsed = JSON.parse(text.slice(start, end + 1));
        raw = Array.isArray(parsed?.results) ? parsed.results : [];
      } catch { raw = []; }
    }
    if (!raw.length) {
      const rescued = rescueArrayByKey(text, 'results');
      if (rescued) { raw = rescued; partial = true; }
    }
  }

  const byId = new Map<string, T>();
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const id = String(item.issueId || '').trim();
    if (!id) continue;
    const typed = item as T;
    if (!isValid(typed)) continue;
    byId.set(id, typed);
  }
  return { byId, partial, count: raw.length };
}
