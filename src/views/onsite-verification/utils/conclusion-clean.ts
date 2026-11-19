/**
 * 测评结论正文清洗。
 *
 * 背景：批量/单条 AI 分析时，模型常在 conclusion 句尾追加"判定为符合/部分符合/
 * 不符合"这类符合性判定的复述。判定结果已由独立字段 compliance 承载，
 * 正文里再写一遍属于冗余的判定性描述，用户不需要。
 *
 * 这里只剥除句尾明确的判定分句，保留前面的客观事实陈述；不改动正文中间内容，
 * 避免误删有效描述。多处判定时循环剥除。
 */

/** 句尾判定分句：支持"判定为X""因此判定为X""，判定为X""，故判定为X"及中文句号/无句号 */
const VERDICT_TAIL_RE = /[,，]?\s*(?:因此|故|所以)?\s*判定为\s*(?:符合|部分符合|不符合|不适用)\s*[。.]?\s*$/;

/**
 * 剥除结论正文末尾的判定性描述，返回清洗后的正文。
 * 若剥除后正文为空，则保留原文（宁可留判定，也不把结论清空）。
 */
export function stripVerdictTail(conclusion: string): string {
  const text = String(conclusion || '').trim();
  let cleaned = text;
  let stripped = false;
  // 循环剥除：AI 偶尔会连写多个判定尾巴
  for (let i = 0; i < 5; i++) {
    const next = cleaned.replace(VERDICT_TAIL_RE, '').trim();
    if (next === cleaned) break;
    cleaned = next;
    stripped = true;
  }
  // 没有判定尾就原样返回，绝不改动（避免误伤占位/测试文本）
  if (!stripped || !cleaned) return text;
  // 剥除判定尾后正文可能以逗号或无标点结尾，补一个句号使语句完整
  if (!/[。.!！?？]$/.test(cleaned)) {
    cleaned = cleaned.replace(/[,，、;；]\s*$/, '') + '。';
  }
  return cleaned;
}
