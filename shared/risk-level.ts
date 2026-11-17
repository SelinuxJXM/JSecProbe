import type { RiskLevelJudgment } from './types';

/** 解析 AI 定级结果时需要的最小候选信息（避免 shared 反向依赖 electron 服务） */
export interface GuidelineCandidateLite {
  id: string;
  title?: string;
}

const LEVEL_MAP: Record<string, RiskLevelJudgment['level']> = {
  high: 'high', '高风险': 'high', '高': 'high',
  medium: 'medium', '中风险': 'medium', '中': 'medium',
  low: 'low', '低风险': 'low', '低': 'low',
};

/**
 * 把模型返回的自由文本 / Markdown 围栏 / JSON 收敛为结构化定级结论。
 * matchedId 必须落在本次召回候选中，杜绝模型凭记忆编造指引条目。
 */
export function parseRiskLevelJudgment(
  content: string,
  candidates: GuidelineCandidateLite[] = [],
): RiskLevelJudgment {
  const raw = (content || '').trim();
  let cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  const first = cleaned.indexOf('{');
  const last = cleaned.lastIndexOf('}');
  if (first >= 0 && last > first) cleaned = cleaned.slice(first, last + 1);

  let obj: any = null;
  try {
    obj = JSON.parse(cleaned);
  } catch {
    const levelMatch = raw.match(/["']?level["']?\s*[:：]\s*["']?(高|中|低|high|medium|low)/i);
    if (levelMatch) {
      const reasonMatch = raw.match(/["']?reason["']?\s*[:：]\s*["']([^"']+)["']/);
      const idMatch = raw.match(/["']?matchedId["']?\s*[:：]\s*["']([^"']+)["']/);
      obj = { level: levelMatch[1], reason: reasonMatch?.[1], matchedId: idMatch?.[1] };
    }
  }

  const rawLevel = typeof obj?.level === 'string' ? obj.level.trim().toLowerCase() : '';
  const level = LEVEL_MAP[rawLevel];
  if (!level) throw new Error('AI 定级结果格式无法解析');

  const suggestedId = typeof obj?.matchedId === 'string' ? obj.matchedId.trim() : '';
  const matchedId = candidates.some(c => c.id === suggestedId) ? suggestedId : '';
  const reason = typeof obj?.reason === 'string' && obj.reason.trim()
    ? obj.reason.trim().slice(0, 300)
    : '依据判定指引与现场事实综合判定，建议人工复核。';

  return {
    level,
    matchedId,
    matchedTitle: matchedId ? candidates.find(c => c.id === matchedId)?.title : undefined,
    reason,
  };
}
