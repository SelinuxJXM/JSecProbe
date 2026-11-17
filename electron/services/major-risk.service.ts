/**
 * 重大风险隐患识别与分析：现场测评记录检索（DB 侧）。
 *
 * 纯文本逻辑（候选召回/提示词格式化/草稿解析）已抽到 shared/major-risk.ts，
 * 便于单测直接覆盖；这里只保留需要 better-sqlite3 的检索部分。
 * 召回范式与 high-risk-guideline.service.ts 一致：只挑候选，最终判定交给 AI。
 */
import { getDb } from '../db';
import * as schema from '../db/schema';
import { eq, and } from 'drizzle-orm';
import { normalizeText, countMitigationHits } from '../../shared/major-risk';

export {
  matchCatalogCandidates,
  formatCatalogCandidates,
  formatRecordSnippets,
  normalizeText,
} from '../../shared/major-risk';
export type { RecallIssue, RecordSnippet } from '../../shared/major-risk';

function clip(text: string, max = 600): string {
  const value = (text || '').trim();
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

/**
 * 检索现场测评记录：优先取与问题同测评项/同资产的记录，再按文本相关性补充。
 * 严重性/高发性判定需要全系统防护上下文（防火墙策略、专网隔离、专人专用账号、
 * 审计监测等），这类记录往往与问题不同测评项/不同资产，因此对命中防护/环境
 * 关键词的记录给予加分，保证它们能进入 AI 上下文。
 * 只读取 findings / evidence / commandOutput 等现场文本，不返回截图二进制。
 */
export async function searchAssessmentRecords(params: {
  projectId: string;
  issueId?: string;
  keyword?: string;
  limit?: number;
}) {
  const db = getDb();
  const limit = Math.min(Math.max(params.limit || 12, 1), 24);

  let itemId = '';
  let assetId = '';
  if (params.issueId) {
    const [issue] = await db.select().from(schema.issues)
      .where(and(eq(schema.issues.id, params.issueId), eq(schema.issues.projectId, params.projectId)))
      .limit(1);
    if (issue) {
      itemId = (issue as any).itemId || '';
      assetId = (issue as any).assetId || '';
    }
  }

  const records = await db
    .select({
      id: schema.assessmentRecords.id,
      itemId: schema.assessmentRecords.itemId,
      assetId: schema.assessmentRecords.assetId,
      result: schema.assessmentRecords.result,
      findings: schema.assessmentRecords.findings,
      evidence: schema.assessmentRecords.evidence,
      commandOutput: schema.assessmentRecords.commandOutput,
      assetName: schema.assets.name,
    })
    .from(schema.assessmentRecords)
    .leftJoin(schema.assets, eq(schema.assessmentRecords.assetId, schema.assets.id))
    .where(eq(schema.assessmentRecords.projectId, params.projectId));

  const keywordNorm = normalizeText(params.keyword || '');
  const kg = normalizeText(params.keyword || '');
  const keywordGrams = new Set<string>();
  for (let i = 0; i < kg.length - 1; i++) { const g = kg.slice(i, i + 2); if (g) keywordGrams.add(g); }

  const scored = records.map(r => {
    const text = normalizeText(`${r.findings || ''} ${r.evidence || ''} ${r.commandOutput || ''}`);
    let score = 0;
    if (itemId && r.itemId === itemId) score += 10;
    if (assetId && r.assetId === assetId) score += 6;
    if (keywordNorm && text.includes(keywordNorm)) score += 5;
    let hits = 0;
    for (const g of keywordGrams) if (text.includes(g)) hits++;
    score += Math.min(hits, 8) * 0.5;
    // 全系统防护/环境上下文：让"防火墙严格策略、不连外网、专人专用账号"这类
    // 缓解性证据也能被召回（上限 4.5 分，不会压过同测评项记录的 10 分权重）
    score += Math.min(countMitigationHits(`${r.findings || ''} ${r.evidence || ''} ${r.commandOutput || ''}`), 3) * 1.5;
    if ((r.findings || '').trim()) score += 2;
    return { r, score };
  });

  return scored
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ r }) => ({
      id: r.id,
      itemId: r.itemId,
      assetName: r.assetName || '',
      result: r.result || '',
      findings: clip(r.findings || '', 500),
      evidence: clip(r.evidence || '', 400),
      commandOutput: clip(r.commandOutput || '', 400),
    }));
}
