// 合规差距统计公共模块
// 统一 standard.ipc.ts（纯统计通道）与 ai.ipc.ts（AI 分析）两处的统计口径，
// 避免双份实现漂移，并统一域名解析（domains_meta → DOMAIN_NAMES → 原值）。
import { eq, and, inArray, lte, gte, or } from 'drizzle-orm';
import { getDb } from '../db';
import * as schema from '../db/schema';

// 与 standard.ipc.ts 保持一致的内置域名显示表（兜底）
const DOMAIN_NAMES: Record<string, { name: string; icon: string }> = {
  secure_physical: { name: '安全物理环境', icon: 'OfficeBuilding' },
  secure_communication: { name: '安全通信网络', icon: 'Connection' },
  secure_boundary: { name: '安全区域边界', icon: 'Grid' },
  secure_computing: { name: '安全计算环境', icon: 'Monitor' },
  secure_management: { name: '安全管理中心', icon: 'Setting' },
  security_management: { name: '安全管理制度', icon: 'Document' },
  security_organization: { name: '安全管理机构', icon: 'Briefcase' },
  security_personnel: { name: '安全管理人员', icon: 'User' },
  security_construction: { name: '安全建设管理', icon: 'Tools' },
  security_maintenance: { name: '安全运维管理', icon: 'Box' },
};

// 条目判定"最不利原则"排序：越靠前越不利。
// not_applicable 仅在"全部记录均为不适用"时成立（即无其它已判定结果）。
const ITEM_RESULT_ORDER = ['non_compliant', 'nonconform', 'partial', 'compliant', 'conform', 'not_applicable'];

// 解析标准 domains_meta 为 { id: { name } } 映射
function parseDomainsMeta(raw?: string | null): Record<string, { name: string }> {
  if (!raw) return {};
  try {
    const arr = JSON.parse(raw);
    const map: Record<string, { name: string }> = {};
    if (Array.isArray(arr)) {
      for (const d of arr) {
        if (d?.id) map[d.id] = { name: d.name || d.id };
      }
    }
    return map;
  } catch {
    return {};
  }
}

export interface ComplianceDomainStat {
  id: string;
  name: string;
  total: number;
  tested: number;
  compliant: number;
  partial: number;
  nonCompliant: number;
  na: number;
  untested: number;
  coverageRate: number;
  complianceRate: number;
}

export interface ComplianceStats {
  domains: ComplianceDomainStat[];
  summary: {
    totalItems: number;
    tested: number;
    compliant: number;
    partial: number;
    nonCompliant: number;
    na: number;
    untested: number;
    coverageRate: number;
    complianceRate: number;
  };
  nonCompliantSamples: Array<{ domain: string; controlPoint: string; controlName: string; requirement: string }>;
}

/**
 * 计算「项目 × 标准」合规差距统计（纯统计，不调 AI）。
 * 口径：
 *   - 适用条目：standardId 下 minLevel ≤ 项目等级 ≤ maxLevel，且 extensionType 为 general 或与项目扩展类型一致
 *   - 条目级判定：按"最不利"原则聚合（任一资产不符合→不符合；任一部分符合→部分符合；有符合→符合；全部记录均不适用→不适用；无已判定→未测评）
 *   - coverageRate = 已判定条目(含不适用) / 适用条目总数；complianceRate = 符合 / (已判定 − 不适用)
 */
export async function computeComplianceStats(projectId: string, standardId: string): Promise<ComplianceStats> {
  const db = getDb();

  const proj = await db.select().from(schema.projects).where(eq(schema.projects.id, projectId)).limit(1);
  const std = await db.select().from(schema.standards).where(eq(schema.standards.id, standardId)).limit(1);
  if (proj.length === 0) throw new Error('项目不存在');
  if (std.length === 0) throw new Error('标准不存在');
  const project = proj[0];
  const standard = std[0];

  // 等级：用 ?? 兜底（避免 level=0 被 || 误判为 3）
  const rawLevel = Number(project.level);
  const level = Number.isFinite(rawLevel) && rawLevel > 0 ? rawLevel : 3;
  const extType = String(project.extensionType || '').trim() || 'general';

  // 适用条目
  const items = await db
    .select({
      id: schema.assessmentItems.id,
      domain: schema.assessmentItems.domain,
      controlPoint: schema.assessmentItems.controlPoint,
      controlName: schema.assessmentItems.controlName,
      requirement: schema.assessmentItems.requirement,
    })
    .from(schema.assessmentItems)
    .where(and(
      eq(schema.assessmentItems.standardId, standardId),
      lte(schema.assessmentItems.minLevel, level),
      gte(schema.assessmentItems.maxLevel, level),
      or(eq(schema.assessmentItems.extensionType, 'general'), eq(schema.assessmentItems.extensionType, extType)),
    ));

  // 域名解析（优先 domains_meta，fallback DOMAIN_NAMES，最后原值展示）
  const metaMap = parseDomainsMeta(standard.domainsMeta);
  const domainName = (id: string) => metaMap[id]?.name || DOMAIN_NAMES[id]?.name || id;

  // 拉取该项目对适用条目的全部测评记录（分批 inArray，规避 SQLite 变量上限）
  const itemIds = items.map(i => i.id);
  const itemIdSet = new Set(items.map(i => i.id));
  const records: Array<{ itemId: string | null; result: string }> = [];
  const CHUNK = 500;
  for (let i = 0; i < itemIds.length; i += CHUNK) {
    const chunk = itemIds.slice(i, i + CHUNK);
    if (chunk.length === 0) break;
    const rows = await db
      .select({ itemId: schema.assessmentRecords.itemId, result: schema.assessmentRecords.result })
      .from(schema.assessmentRecords)
      .where(and(
        eq(schema.assessmentRecords.projectId, projectId),
        inArray(schema.assessmentRecords.itemId, chunk),
      ));
    records.push(...rows);
  }

  // 条目级判定聚合（最不利原则）
  const itemVerdict = new Map<string, string>();
  for (const r of records) {
    if (!r.itemId || !itemIdSet.has(r.itemId)) continue;
    const res = String(r.result || '').trim();
    if (!res || res === 'untested') continue;
    const ci = ITEM_RESULT_ORDER.indexOf(res);
    if (ci < 0) continue; // 未知 result 值跳过（避免误统计）
    const prev = itemVerdict.get(r.itemId);
    if (!prev) { itemVerdict.set(r.itemId, res); continue; }
    const pi = ITEM_RESULT_ORDER.indexOf(prev);
    if (pi < 0 || ci < pi) itemVerdict.set(r.itemId, res);
  }

  // 按域聚合（域顺序：domains_meta 自然顺序优先，未列出的按首次出现）
  const domainIds: string[] = [];
  for (const it of items) if (!domainIds.includes(it.domain)) domainIds.push(it.domain);
  let domainOrder: string[] = [];
  try {
    const raw = standard.domainsMeta ? JSON.parse(standard.domainsMeta) : [];
    if (Array.isArray(raw)) for (const d of raw) if (d?.id) domainOrder.push(d.id);
  } catch { /* 解析失败按首次出现顺序 */ }
  domainIds.sort((a, b) => {
    const ia = domainOrder.indexOf(a);
    const ib = domainOrder.indexOf(b);
    if (ia >= 0 && ib >= 0) return ia - ib;
    if (ia >= 0) return -1;
    if (ib >= 0) return 1;
    return 0;
  });

  const domains: ComplianceDomainStat[] = [];
  let sCompliant = 0, sPartial = 0, sNonCompliant = 0, sNa = 0;
  for (const dom of domainIds) {
    const domItems = items.filter(i => i.domain === dom);
    let compliant = 0, partial = 0, nonCompliant = 0, na = 0;
    for (const it of domItems) {
      const v = itemVerdict.get(it.id);
      if (v === 'not_applicable') na++;
      else if (v === 'non_compliant' || v === 'nonconform') nonCompliant++;
      else if (v === 'partial') partial++;
      else if (v === 'compliant' || v === 'conform') compliant++;
    }
    const total = domItems.length;
    const judged = compliant + partial + nonCompliant;
    const tested = judged + na;
    domains.push({
      id: dom,
      name: domainName(dom),
      total,
      tested,
      compliant,
      partial,
      nonCompliant,
      na,
      untested: Math.max(0, total - tested),
      coverageRate: total > 0 ? Math.round((tested / total) * 1000) / 10 : 0,
      complianceRate: tested - na > 0 ? Math.round((compliant / (tested - na)) * 1000) / 10 : 0,
    });
    sCompliant += compliant; sPartial += partial; sNonCompliant += nonCompliant; sNa += na;
  }
  const sTested = sCompliant + sPartial + sNonCompliant + sNa;

  // 不符合样例（最多 10 条，requirement 截断 200 字，domain 用解析后的显示名）
  const nonCompliantSamples = items
    .filter(i => {
      const v = itemVerdict.get(i.id);
      return v === 'non_compliant' || v === 'nonconform';
    })
    .slice(0, 10)
    .map(i => ({
      domain: domainName(i.domain),
      controlPoint: i.controlPoint,
      controlName: i.controlName,
      requirement: String(i.requirement || '').slice(0, 200),
    }));

  return {
    domains,
    summary: {
      totalItems: items.length,
      tested: sTested,
      compliant: sCompliant,
      partial: sPartial,
      nonCompliant: sNonCompliant,
      na: sNa,
      untested: Math.max(0, items.length - sTested),
      coverageRate: items.length > 0 ? Math.round((sTested / items.length) * 1000) / 10 : 0,
      complianceRate: sTested - sNa > 0 ? Math.round((sCompliant / (sTested - sNa)) * 1000) / 10 : 0,
    },
    nonCompliantSamples,
  };
}
