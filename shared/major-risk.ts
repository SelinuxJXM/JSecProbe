/**
 * 重大风险隐患识别与分析：纯文本逻辑（候选召回、提示词格式化、AI 草稿解析）。
 *
 * 放在 shared 下、不依赖 electron / db，便于单测直接覆盖。
 * 与 risk-level.ts 同构：召回只挑候选，最终判定交给 AI 并约束不得编造清单编号。
 */
import type { MajorRiskAiDraft, MajorRiskCatalogItem, MajorRiskVerdict } from './types';

/** 供召回用的精简问题入参 */
export interface RecallIssue {
  issueTitle?: string;
  issueDescription?: string;
  securityDomain?: string;
  controlPoint?: string;
  controlName?: string;
  assetName?: string;
}

/** 现场测评记录检索片段（格式化进提示词的最小字段集） */
export interface RecordSnippet {
  id: string;
  itemId: string;
  assetName: string;
  result: string;
  findings: string;
  evidence: string;
  commandOutput: string;
}

export function normalizeText(text: unknown): string {
  return (typeof text === 'string' ? text : '').toLowerCase().replace(/[\s\p{P}\p{S}]/gu, '');
}

/**
 * 防护措施/系统环境关键词：严重性与高发性判定需要参考全系统的缓解性证据
 * （如"已部署防火墙并配置严格访问控制策略""系统内部专网不连外网""账号专人专用"），
 * 这些记录往往与问题本身不同测评项/不同资产，纯关键词检索召回不到，
 * 检索时按命中数给加分，保证 AI 拿到系统级防护上下文。
 */
export const MITIGATION_TERMS: string[] = [
  '防火墙', 'waf', 'web应用防火墙', '访问控制策略', '访问控制规则', '白名单', '黑名单',
  '入侵检测', 'ids', 'ips', '态势感知', '抗apt', '全流量', '沙箱', '威胁情报',
  '堡垒机', '日志审计', '安全审计', '审计记录', '监测', '监控平台',
  '网络隔离', '逻辑隔离', 'vlan', '安全域', '区域划分', '单向隔离', '网闸', '专网', '内网',
  '不连外网', '未连接互联网', '不接入互联网', '互联网边界', '外网边界', '网络边界',
  '专人专用', '专用账号', '专责', '最小权限', '权限审批', '双因素', 'otp', 'ukey', '堡垒',
  '加密传输', '加密存储', '加密', 'vpn', 'ssl', '国密',
  '备份', '冗余', '集群', '双机', '热备',
  '恶意代码', '杀毒', '终端防护', 'edr', '杀毒软件',
  '口令策略', '密码策略', '口令复杂度', '定期更换', '登录失败',
];

/** 统计文本命中的防护/环境关键词个数（归一化后匹配，中文不分词也能命中） */
export function countMitigationHits(text: string): number {
  const norm = normalizeText(text);
  if (!norm) return 0;
  let hits = 0;
  for (const term of MITIGATION_TERMS) {
    const t = normalizeText(term);
    if (t && norm.includes(t)) hits++;
  }
  return hits;
}

function grams(text: string): Set<string> {
  const s = normalizeText(text);
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

function splitKeywords(keywords?: string): string[] {
  return (keywords || '').split(/[,，;；\r\n]+/).map(s => s.trim()).filter(Boolean);
}

/**
 * 从启用清单中召回与问题最相关的条目。
 * 评分口径：显式关键词命中权重最高，其次标题、判定标准、分类匹配。
 */
export function matchCatalogCandidates(
  issue: RecallIssue,
  catalog: MajorRiskCatalogItem[],
  limit = 6,
): MajorRiskCatalogItem[] {
  const enabled = catalog.filter(c => c.enabled !== false);
  if (enabled.length === 0) return [];

  const titleGrams = grams([issue.issueTitle, issue.controlName].filter(Boolean).join(' '));
  const descGrams = grams([issue.issueDescription, issue.assetName].filter(Boolean).join(' '));
  const category = normalizeText(issue.securityDomain || '');

  const scored = enabled.map(item => {
    let score = 0;
    const kws = splitKeywords(item.keywords);
    const keywordBlock = normalizeText(kws.join(' '));
    const descNorm = normalizeText(issue.issueDescription || '');
    const titleNorm = normalizeText(issue.issueTitle || '');
    for (const kw of kws) {
      const g = normalizeText(kw);
      if (g && (descNorm.includes(g) || titleNorm.includes(g))) score += 4;
    }
    if (keywordBlock && hitCount(keywordBlock, descGrams) > 0) score += Math.min(hitCount(keywordBlock, descGrams), 6) * 1.5;
    score += Math.min(hitCount(normalizeText(item.title), titleGrams), 6) * 1.4;
    score += Math.min(hitCount(normalizeText(item.criteria), descGrams), 8) * 0.9;
    if (category) {
      const cat = normalizeText(item.category || '');
      if (cat && (cat.includes(category) || category.includes(cat))) score += 6;
    }
    return { item, score };
  });

  const matched = scored.filter(x => x.score > 2.5)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(x => x.item);
  if (matched.length > 0) return matched;

  const sameCategory = scored.filter(x => category && normalizeText(x.item.category || '').includes(category))
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.min(3, limit))
    .map(x => x.item);
  return sameCategory;
}

function clip(text: string, max = 600): string {
  const value = (text || '').trim();
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

export function formatCatalogCandidates(items: MajorRiskCatalogItem[]): string {
  if (items.length === 0) return '（未从清单中召回到相关条目，不得编造清单编号）';
  return items.map((item, index) => [
    `[${index + 1}] 编号 ${item.code || item.id} | ${item.category || '未分类'} | ${item.title}`,
    `  判定要点：${clip(item.criteria || '', 300)}`,
    `  关键词：${clip(item.keywords || '', 120)}`,
  ].join('\n')).join('\n\n');
}

export function formatRecordSnippets(snippets: RecordSnippet[]): string {
  if (snippets.length === 0) return '（未检索到相关现场测评记录，请基于问题事实审慎分析）';
  return snippets.map((s, index) => [
    `[${index + 1}] 测评项 ${s.itemId}${s.assetName ? ` | 测评对象 ${s.assetName}` : ''} | 结果 ${s.result}`,
    `  发现：${s.findings || '—'}`,
    `  证据点：${s.evidence || '—'}`,
    `  命令输出：${s.commandOutput || '—'}`,
  ].join('\n')).join('\n\n');
}

/** 从自由文本中提取顶层 JSON 对象（去围栏 + 按大括号配平） */
function extractJsonObj(text: string, label: string): Record<string, any> {
  let s = String(text ?? '').trim();
  s = s.replace(/^```(?:json|text)?\s*/i, '').replace(/\s*```$/, '').trim();
  const first = s.indexOf('{');
  if (first < 0) throw new Error(`${label} 返回格式异常：未找到 JSON 对象`);
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = first; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (esc) { esc = false; continue; }
      if (c === '\\') { esc = true; continue; }
      if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') { inStr = true; continue; }
    if (c === '{') depth++;
    if (c === '}') {
      depth--;
      if (depth === 0) return JSON.parse(s.slice(first, i + 1));
    }
  }
  throw new Error(`${label} JSON 未闭合`);
}

/**
 * 解析重大风险隐患 AI 草稿：严格 JSON 优先，容错围栏；三要素各自单独保留一段；
 * verdict 非法回落 pending。不写库。
 */
export function parseMajorRiskDraft(content: string): MajorRiskAiDraft {
  const raw = String(content || '').trim();
  let obj: Record<string, any> = {};
  const cleaned = raw.replace(/^```(?:json|text)?\s*/i, '').replace(/\s*```$/, '').trim();
  if (cleaned.startsWith('{')) {
    try {
      obj = extractJsonObj(cleaned, '重大风险隐患分析');
    } catch {
      obj = {};
    }
  }
  const pick = (v: unknown, max = 3000): string => (typeof v === 'string' ? v : '').trim().slice(0, max);
  const verdictRaw = pick(obj.verdict, 32).toLowerCase();
  const verdict: MajorRiskVerdict =
    verdictRaw === 'major' || verdictRaw === 'non_major' || verdictRaw === 'pending' ? verdictRaw : 'pending';
  return {
    catalogId: pick(obj.catalogId, 100),
    catalogTitle: pick(obj.catalogTitle, 300),
    relevance: pick(obj.relevance),
    severity: pick(obj.severity),
    frequency: pick(obj.frequency),
    verdict,
    conclusion: pick(obj.conclusion),
  };
}
