import guidelineData from '../data/high-risk-guideline.json';

/**
 * 网络安全等级保护高风险判定指引（网页版快照）本地检索服务。
 *
 * 来源：https://www.soer.ccwu.cc/JSecRisk 「等保测评高风险指引库」，
 * 页面内嵌 DATA 共 81 条判定项。做成项目内快照而非运行时联网抓取，
 * 避免测评现场无外网时 AI 判定能力整体失效。
 *
 * 这里只做「候选条目召回」：先按安全域、控制点、问题描述的文本重合度
 * 挑出最相关的若干条，再交给 AI 结合现场事实判断是否符合高风险场景、
 * 是否存在缓解措施。AI 不得编造候选之外的条目 ID。
 */

export interface GuidelineItem {
  id: string;
  category: string;
  controlPoint: string;
  title: string;
  requirement: string;
  riskScenario: string;
  basis: string;
  mitigation: string;
  evaluation: string;
}

export interface GuidelineJudgeIssue {
  issueTitle?: string;
  issueDescription?: string;
  securityDomain?: string;
  controlPoint?: string;
  controlName?: string;
  assetName?: string;
}

export const guidelineItems: GuidelineItem[] = guidelineData.items as GuidelineItem[];

/** 安全域 ID / 简称 → 指引库中的 category 名称 */
const DOMAIN_CATEGORY: Record<string, string> = {
  secure_physical: '安全物理环境', physical: '安全物理环境',
  secure_communication: '安全通信网络', network: '安全通信网络',
  secure_boundary: '安全区域边界', perimeter: '安全区域边界',
  secure_computing: '安全计算环境', computing: '安全计算环境',
  secure_management: '安全管理中心', management: '安全管理中心',
  security_management: '安全管理制度',
  security_organization: '安全管理机构',
  security_personnel: '安全管理人员',
  security_construction: '安全建设管理',
  security_maintenance: '安全运维管理',
};

function toCategory(domain?: string): string {
  const value = (domain || '').trim();
  if (!value) return '';
  if (DOMAIN_CATEGORY[value]) return DOMAIN_CATEGORY[value];
  // 页面/数据库里可能直接存中文域名。只做单向包含（输入值足够长且完整包含已知分类名），
  // 不再用 c.includes(value)：短值"网络"会同时命中多个安全域，按对象顺序误取第一个。
  const known = [...new Set(Object.values(DOMAIN_CATEGORY))];
  return known.find(c => value.length >= c.length && value.includes(c)) || '';
}

function normalize(text: string): string {
  return (text || '').toLowerCase().replace(/[\s\p{P}\p{S}]/gu, '');
}

function grams(text: string): Set<string> {
  const s = normalize(text);
  const result = new Set<string>();
  for (let i = 0; i < s.length - 1; i++) {
    const g = s.slice(i, i + 2);
    if (g) result.add(g);
  }
  return result;
}

function hitCount(haystack: string, needles: Set<string>): number {
  let hits = 0;
  for (const n of needles) if (haystack.includes(n)) hits++;
  return hits;
}

/**
 * 召回与当前问题最相关的判定条目。
 * 候选数量默认 6：足够覆盖同一控制点的不同场景，又不会把提示词撑得过长。
 */
export function searchGuidelineCandidates(issue: GuidelineJudgeIssue, limit = 6): GuidelineItem[] {
  const category = toCategory(issue.securityDomain);
  const titleGrams = grams([issue.issueTitle, issue.controlName].filter(Boolean).join(' '));
  const descGrams = grams([issue.issueDescription, issue.assetName].filter(Boolean).join(' '));
  const control = normalize([issue.controlPoint, issue.controlName].filter(Boolean).join(' '));

  const scored = guidelineItems.map(item => {
    let score = 0;
    if (category && item.category === category) score += 8;
    if (control) {
      const target = normalize(`${item.controlPoint}${item.title}${item.requirement}`);
      if (target.includes(control) || control.includes(normalize(item.controlPoint))) score += 6;
    }
    score += Math.min(hitCount(normalize(item.title), titleGrams), 6) * 1.2;
    score += Math.min(hitCount(normalize(item.riskScenario), descGrams), 8) * 0.8;
    score += Math.min(hitCount(normalize(item.requirement), titleGrams), 4) * 0.4;
    return { item, score };
  });

  const matched = scored.filter(x => x.score > 3)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(x => x.item);
  if (matched.length > 0) return matched;

  // 文本重合度太低时，至少给出同安全域的条目供 AI 参考；仍无则留空，
  // 让 AI 明确按「未匹配到判定指引」口径判中/低风险。
  return scored.filter(x => category && x.item.category === category)
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.min(3, limit))
    .map(x => x.item);
}

function clip(text: string, max = 320): string {
  const value = (text || '').trim();
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

/** 把候选条目格式化进提示词，字段与原网页一一对应 */
export function formatGuidelineCandidates(items: GuidelineItem[]): string {
  if (items.length === 0) return '（未召回到相关判定条目，不得编造条目 ID）';
  return items.map((item, index) => [
    `[${index + 1}] ID ${item.id} | ${item.category} / ${item.controlPoint} | ${item.title}`,
    `  适用范围：${clip(item.basis, 120)}`,
    `  标准要求：${clip(item.requirement)}`,
    `  问题场景：${clip(item.riskScenario)}`,
    `  可能缓解措施：${clip(item.mitigation)}`,
    `  风险评价：${clip(item.evaluation)}`,
  ].join('\n')).join('\n\n');
}

/** 供 AI 回填 matchedTitle，避免前端再查一遍 */
export function findGuidelineItem(id: string): GuidelineItem | undefined {
  return guidelineItems.find(item => item.id === id);
}
