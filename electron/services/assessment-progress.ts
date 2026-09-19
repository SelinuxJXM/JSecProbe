import { getDb } from '../db';
import * as schema from '../db/schema';
import { eq, and, count, sql, inArray, lte, or } from 'drizzle-orm';

/**
 * 测评进度与符合率的**唯一**统计实现。
 *
 * 背景：此前「问题清单页」(issue.ipc.ts) 与「现场核查页」(assessment.ipc.ts) 各写了一份符合率计算，
 * 公式相同（符合 / (已判定 − 不适用)），但现场核查页多一层「格内校验」(gridInFilter)：
 *   - 全局层面的项只认 asset_id 为空的记录；
 *   - 资产层面的项只认「资产所属层面 === 项所属层面」的配对。
 * 少了这层校验，跨层面错配的记录会被重复计入，两页数字因此不一致。
 * 现统一为带格内校验的口径，两个页面共用本函数。
 */

export interface AssessmentProgress {
  /** 应测评总项数 = Σ(层面资产数 × 层面测评项数) + 全局层面测评项数 */
  total: number;
  /** 已判定记录数（含不适用），上限为 total */
  tested: number;
  compliant: number;
  partial: number;
  nonCompliant: number;
  na: number;
  /** 符合率 = 符合 / (已判定 − 不适用)，分母为 0 时取 0 */
  complianceRate: number;
  untested: number;
  /** 实际参与统计的标准 ID（便于排查「标准解析不到导致全 0」） */
  standardId: string;
}

const EXT_TYPE_MAP: Record<string, string> = {
  '安全通用要求': 'general',
  '云计算安全扩展要求': 'cloud',
  '移动互联安全扩展要求': 'mobile',
  '物联网安全扩展要求': 'iot',
  '工业控制系统安全扩展要求': 'industrial',
  '大数据安全扩展要求': 'bigdata',
  '大数据安全扩展要求（国标附录）': 'bigdata',
  '关键信息基础设施安全扩展要求': 'cii',
};

/** 资产类别 → 安全层面（与前端 onsite-verification、report.service 保持一致） */
const CATEGORY_TO_DOMAIN: Record<string, string> = {
  server_storage: 'secure_computing',
  sys_doc: 'secure_computing',
  network_device: 'secure_computing',
  security_device: 'secure_computing',
  business_app: 'secure_computing',
  terminal: 'secure_computing',
  management_platform: 'secure_computing',
  machine_room: 'secure_physical',
  data_resource: 'secure_computing',
  network_boundary: 'secure_boundary',
  data_category: 'secure_computing',
  other_asset: 'secure_computing',
  crypto_product: 'secure_computing',
};

function parseExtensionCodes(extensionType?: string | null): string[] {
  const codes: string[] = [];
  if (!extensionType) return codes;
  for (const t of extensionType.split(',').filter(Boolean)) {
    const code = EXT_TYPE_MAP[t.trim()] || t.trim();
    if (!codes.includes(code)) codes.push(code);
  }
  return codes;
}

/**
 * 解析项目适用的标准 ID。
 * 策略：项目绑定值（且确实存在于 standards 表）→ 同等级标准 → 默认标准 → 列表首条。
 * 与前端 onsite-verification 的 pickDefaultStandardId 保持一致；标准被删除时不会返回失效 ID。
 */
export async function resolveStandardIdForProject(projectId: string): Promise<string> {
  const db = getDb();
  const project = await db.query.projects.findFirst({ where: eq(schema.projects.id, projectId) });
  if (!project) return '';

  const standardsAll = await db
    .select({ id: schema.standards.id, grade: schema.standards.grade, isDefault: schema.standards.isDefault })
    .from(schema.standards);

  const raw = typeof project.standardId === 'string' ? project.standardId.trim() : '';
  if (raw && standardsAll.some((s) => s.id === raw)) return raw;
  if (standardsAll.length === 0) return '';

  const level = Number(project.level) || 3;
  const sameGrade = standardsAll.find((s) => Number(s.grade) === level);
  const def = standardsAll.find((s) => Number(s.isDefault) === 1);
  return (sameGrade || def || standardsAll[0]).id;
}

const EMPTY_PROGRESS: AssessmentProgress = {
  total: 0, tested: 0, compliant: 0, partial: 0,
  nonCompliant: 0, na: 0, complianceRate: 0, untested: 0, standardId: '',
};

/**
 * 计算项目测评进度与符合率（格内口径）。
 * @param standardId 不传或为空时自动按 resolveStandardIdForProject 解析，避免调用方各写一套 fallback。
 */
export async function computeAssessmentProgress(projectId: string, standardId?: string): Promise<AssessmentProgress> {
  const db = getDb();

  const project = await db.query.projects.findFirst({ where: eq(schema.projects.id, projectId) });
  if (!project) return { ...EMPTY_PROGRESS };

  // standardId 缺省或指向已删除的标准时，回落到统一解析
  let stdId = (standardId || '').trim();
  if (stdId) {
    const exists = await db
      .select({ id: schema.standards.id })
      .from(schema.standards)
      .where(eq(schema.standards.id, stdId))
      .limit(1);
    if (exists.length === 0) stdId = '';
  }
  if (!stdId) stdId = await resolveStandardIdForProject(projectId);
  if (!stdId) return { ...EMPTY_PROGRESS };

  const projectExtCodes = parseExtensionCodes(project.extensionType);

  // 扩展类型过滤：通用要求 + 项目选择的扩展要求
  const extOrConditions = [eq(schema.assessmentItems.extensionType, 'general')];
  for (const ext of projectExtCodes) {
    extOrConditions.push(eq(schema.assessmentItems.extensionType, ext));
  }
  const extOr = or(...extOrConditions);

  // 测评对象（security_personnel 是登记类信息，不参与总项数与已完成统计）
  const allAssets = await db.query.assets.findMany({
    where: and(eq(schema.assets.projectId, projectId), eq(schema.assets.isAssessmentTarget, 1)),
  });
  const assets = allAssets.filter((a) => a.category !== 'security_personnel');

  // 适用项 = 标准 + 扩展类型 + minLevel ≤ 项目等级
  const applicableConditions: any[] = [
    eq(schema.assessmentItems.standardId, stdId),
    extOr,
  ];
  if (project.level) {
    applicableConditions.push(lte(schema.assessmentItems.minLevel, project.level));
  }
  const globalItems = await db.query.assessmentItems.findMany({
    where: and(...applicableConditions),
    columns: { id: true, domain: true },
  });

  // 层面 → 测评项数
  const domainItemCounts: Record<string, number> = {};
  for (const item of globalItems) {
    domainItemCounts[item.domain] = (domainItemCounts[item.domain] || 0) + 1;
  }

  // 全局层面 = 不属于任何资产映射层面的域（兼容电力等行业标准的额外安全层面）
  const assetDomainIds = new Set(Object.values(CATEGORY_TO_DOMAIN));
  const GLOBAL_DOMAINS = Object.keys(domainItemCounts).filter((d) => !assetDomainIds.has(d));

  // 总项数 = Σ(层面资产数 × 层面项数) + 全局层面项数
  const domainAssetCounts: Record<string, number> = {};
  for (const asset of assets) {
    const domainId = CATEGORY_TO_DOMAIN[asset.category] || 'secure_computing';
    domainAssetCounts[domainId] = (domainAssetCounts[domainId] || 0) + 1;
  }
  let total = 0;
  for (const [domainId, assetCount] of Object.entries(domainAssetCounts)) {
    total += assetCount * (domainItemCounts[domainId] || 0);
  }
  for (const domainId of GLOBAL_DOMAINS) {
    if ((domainItemCounts[domainId] || 0) > 0 && !domainAssetCounts[domainId]) {
      total += domainItemCounts[domainId];
    }
  }

  // 格内清单：全局层面项（记录不绑资产）与各层面「资产 → 项」配对
  const globalItemIds: string[] = [];
  const domainItemIds: Record<string, string[]> = {};
  for (const item of globalItems) {
    if (GLOBAL_DOMAINS.includes(item.domain)) {
      globalItemIds.push(item.id);
    } else {
      if (!domainItemIds[item.domain]) domainItemIds[item.domain] = [];
      domainItemIds[item.domain].push(item.id);
    }
  }
  const domainAssetIds: Record<string, string[]> = {};
  for (const asset of assets) {
    const domainId = CATEGORY_TO_DOMAIN[asset.category] || 'secure_computing';
    if (!domainAssetIds[domainId]) domainAssetIds[domainId] = [];
    domainAssetIds[domainId].push(asset.id);
  }

  const gridInConditions: any[] = [];
  if (globalItemIds.length > 0) {
    gridInConditions.push(and(
      sql`(asset_id IS NULL OR asset_id = '')`,
      inArray(schema.assessmentRecords.itemId, globalItemIds),
    ));
  }
  for (const [domainId, assetIds] of Object.entries(domainAssetIds)) {
    const itemIds = domainItemIds[domainId];
    if (!itemIds || itemIds.length === 0) continue;
    gridInConditions.push(and(
      inArray(schema.assessmentRecords.assetId, assetIds),
      inArray(schema.assessmentRecords.itemId, itemIds),
    ));
  }
  // 无任何格内组合时计 0
  const gridInFilter = gridInConditions.length > 0 ? or(...gridInConditions) : sql`1 = 0`;

  const itemIdsSubquery = db
    .select({ id: schema.assessmentItems.id })
    .from(schema.assessmentItems)
    .where(and(...applicableConditions));

  const baseWhere = (extra: any) => and(
    eq(schema.assessmentRecords.projectId, projectId),
    inArray(schema.assessmentRecords.itemId, itemIdsSubquery),
    extra,
    gridInFilter,
  );

  const [testedRow] = await db.select({ value: count() }).from(schema.assessmentRecords).where(baseWhere(
    sql`result IN ('compliant', 'conform', 'partial', 'non_compliant', 'nonconform', 'not_applicable')`,
  ));
  const [compliantRow] = await db.select({ value: count() }).from(schema.assessmentRecords).where(baseWhere(
    sql`result IN ('compliant', 'conform')`,
  ));
  const [partialRow] = await db.select({ value: count() }).from(schema.assessmentRecords).where(baseWhere(
    sql`result = 'partial'`,
  ));
  const [nonCompliantRow] = await db.select({ value: count() }).from(schema.assessmentRecords).where(baseWhere(
    sql`result IN ('non_compliant', 'nonconform')`,
  ));
  const [naRow] = await db.select({ value: count() }).from(schema.assessmentRecords).where(baseWhere(
    sql`result = 'not_applicable'`,
  ));

  const tested = testedRow?.value || 0;
  const compliant = compliantRow?.value || 0;
  const na = naRow?.value || 0;
  const effectiveTested = Math.max(0, tested - na);
  const complianceRate = effectiveTested > 0
    ? Number(((compliant / effectiveTested) * 100).toFixed(2))
    : 0;

  // 防御性限制：已完成不超过总项数（避免脏数据导致 已完成 > 总项数）
  const safeTested = Math.min(tested, total);

  return {
    total,
    tested: safeTested,
    compliant,
    partial: partialRow?.value || 0,
    nonCompliant: nonCompliantRow?.value || 0,
    na,
    complianceRate,
    untested: Math.max(0, total - safeTested),
    standardId: stdId,
  };
}
