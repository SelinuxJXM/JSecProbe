import { ipcMain, dialog } from 'electron';
import log from 'electron-log';
import { getDb } from '../db';
import * as schema from '../db/schema';
import { eq, and, count, sql, or, desc, asc, inArray } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import ExcelJS from 'exceljs';
import { getRowMaxHeight, styleCell } from '../utils/excel-helper';
import { wrap } from '../utils/ipc-wrapper';
import { loadRequirementMap } from '../utils/excel-import';
import { computeAssessmentProgress } from '../services/assessment-progress';

// 国标十域 fallback（兼容旧标准库、未配置 domainsMeta 的标准）
// 改造：动态化后端，所有 issue 相关的域名/排序按项目 standardId 从 standards.domainsMeta 加载
const FALLBACK_DOMAIN_META: Array<{ id: string; name: string }> = [
  { id: 'secure_physical', name: '安全物理环境' },
  { id: 'secure_communication', name: '安全通信网络' },
  { id: 'secure_boundary', name: '安全区域边界' },
  { id: 'secure_computing', name: '安全计算环境' },
  { id: 'secure_management', name: '安全管理中心' },
  { id: 'security_management', name: '安全管理制度' },
  { id: 'security_organization', name: '安全管理机构' },
  { id: 'security_personnel', name: '安全管理人员' },
  { id: 'security_construction', name: '安全建设管理' },
  { id: 'security_maintenance', name: '安全运维管理' },
];

const FALLBACK_DOMAIN_ID_TO_NAME: Record<string, string> = Object.fromEntries(
  FALLBACK_DOMAIN_META.map(d => [d.id, d.name])
);

const FALLBACK_DOMAIN_ORDER: string[] = FALLBACK_DOMAIN_META.map(d => d.id);

// 项目级域映射信息（按项目 standardId 加载，fallback 国标十域）
interface ProjectDomainInfo {
  // 域 ID → 中文名（含 fallback，行标项目会用 domainsMeta 覆盖）
  domainIdToName: Record<string, string>;
  // 域顺序（domainsMeta 中数组的自然顺序，fallback 国标十域顺序）
  domainOrder: string[];
  // 中文名 → 域 ID（Excel 导入用，sheet 名解析为域 ID）
  domainNameToId: Record<string, string>;
}

// 按项目 standardId 加载域映射信息
// 优先 standards.domainsMeta，fallback 国标十域（兼容旧标准库、未配置 domainsMeta 的标准）
async function loadProjectDomainInfo(projectId: string): Promise<ProjectDomainInfo> {
  const fallbackNameToId = Object.fromEntries(
    Object.entries(FALLBACK_DOMAIN_ID_TO_NAME).map(([id, name]) => [name, id])
  );
  const result: ProjectDomainInfo = {
    domainIdToName: { ...FALLBACK_DOMAIN_ID_TO_NAME },
    domainOrder: [...FALLBACK_DOMAIN_ORDER],
    domainNameToId: { ...fallbackNameToId },
  };
  try {
    const db = getDb();
    const project = await db.query.projects.findFirst({ where: eq(schema.projects.id, projectId) });
    if (!project?.standardId) return result;
    const [std] = await db.select().from(schema.standards).where(eq(schema.standards.id, project.standardId)).limit(1);
    if (!std?.domainsMeta) return result;
    const arr = JSON.parse(std.domainsMeta);
    if (!Array.isArray(arr) || arr.length === 0) return result;
    const idToName: Record<string, string> = {};
    const order: string[] = [];
    for (const d of arr) {
      if (!d?.id) continue;
      idToName[d.id] = d.name || d.id;
      order.push(d.id);
    }
    if (order.length === 0) return result;
    // 行标项目：用 domainsMeta 完全覆盖 fallback（不合并，避免国标残留域混入行标展示）
    result.domainIdToName = idToName;
    result.domainOrder = order;
    result.domainNameToId = Object.fromEntries(
      Object.entries(idToName).map(([id, name]) => [name, id])
    );
  } catch (err) {
    log.warn('加载项目域映射信息失败，使用国标 fallback:', err);
  }
  return result;
}

export function registerIssueHandlers(): void {
  ipcMain.handle('issue:list', wrap(async (_event, params: {
    projectId: string;
    keyword?: string;
    riskLevel?: string;
    status?: string;
    securityDomain?: string;
    sortProp?: string;
    sortOrder?: string;
    page?: number;
    pageSize?: number;
  }) => {
      const db = getDb();
      const {
        projectId, keyword, riskLevel, status, securityDomain,
        sortProp, sortOrder, page = 1, pageSize = 20
      } = params;

      const conditions: any[] = [eq(schema.issues.projectId, projectId)];

      if (keyword) {
        const escapedKeyword = keyword.replace(/[%_\\]/g, '\\$&');
        conditions.push(
          or(
            sql`${schema.issues.issueTitle} LIKE ${`%${escapedKeyword}%`} ESCAPE '\\'`,
            sql`${schema.issues.issueDescription} LIKE ${`%${escapedKeyword}%`} ESCAPE '\\'`
          )
        );
      }
      if (riskLevel) {
        conditions.push(eq(schema.issues.riskLevel, riskLevel));
      }
      if (status) {
        conditions.push(eq(schema.issues.status, status));
      }
      if (securityDomain) {
        conditions.push(eq(schema.issues.securityDomain, securityDomain));
      }

      const whereClause = conditions.length > 1 ? and(...conditions) : conditions[0];

      const countResult = await db.select({ value: count() }).from(schema.issues).where(whereClause);
      const total = countResult[0]?.value || 0;

      const sortFieldMap: Record<string, any> = {
        issueTitle: schema.issues.issueTitle,
        securityDomain: schema.issues.securityDomain,
        assetName: schema.issues.assetId,
        controlPoint: schema.issues.controlPoint,
        riskLevel: schema.issues.riskLevel,
        status: schema.issues.status,
        createdAt: schema.issues.createdAt,
      };

      const sortField = sortFieldMap[sortProp || ''];
      const sortFn = sortField && sortOrder === 'descending' ? desc : asc;

      let list: any[];
      // 资产信息映射（id → 完整资产对象），用于排序与输出名称映射，避免重复查询资产表
      const assetNameMap: Record<string, any> = {};
      if (sortField) {
        // 用户指定了排序字段，按指定字段排序
        list = await db.select().from(schema.issues)
          .where(whereClause)
          .orderBy(sortFn(sortField))
          .limit(pageSize)
          .offset((page - 1) * pageSize);

        // 预取本页资产信息，供输出阶段映射资产名称（与默认排序分支共用 assetNameMap，避免重复查询）
        const sortAssetIds = [...new Set(list.map((i: any) => i.assetId).filter(Boolean))];
        if (sortAssetIds.length > 0) {
          const sortAssetRows = await db.select().from(schema.assets).where(inArray(schema.assets.id, sortAssetIds));
          sortAssetRows.forEach((a: any) => { assetNameMap[a.id] = a; });
        }
      } else {
        // 默认排序：此前是把整张符合条件的 issues 表 SELECT 进内存、JS 排序后再切片，
        // 一次请求可能拉全表。现在把排序下推成 SQL 的 CASE 表达式，直接 limit/offset 分页。
        // 改造：按项目 standardId 动态加载域顺序，fallback 国标十域
        const { domainOrder: DOMAIN_ORDER } = await loadProjectDomainInfo(projectId);

        // 安全计算环境资产类型排序
        const ASSET_TYPE_ORDER = [
          'network_device',    // 网络设备
          'security_device',   // 安全设备
          'server_storage',    // 服务器
          'sys_doc',              // 系统管理文档
          'management_platform', // 系统管理平台
          'business_app',      // 应用系统
          'terminal',           // 终端
          'data_resource',      // 数据资源
          'data_category',      // 数据分类
        ];

        // 域值/类型值一律走参数绑定，不拼进 SQL 字符串
        const domainCase = sql.join(
          DOMAIN_ORDER.map((d, i) => sql`WHEN ${d} THEN ${i}`),
          sql` `
        );
        const domainOrderExpr = sql`CASE ${schema.issues.securityDomain} ${domainCase} ELSE ${DOMAIN_ORDER.length} END`;

        const typeCase = sql.join(
          ASSET_TYPE_ORDER.map((t, i) => sql`WHEN ${t} THEN ${i}`),
          sql` `
        );
        // 只有安全计算环境内部才按资产类型细分，其余层面该列恒为 0
        const assetTypeOrderExpr = sql`CASE WHEN ${schema.issues.securityDomain} = 'secure_computing' THEN (CASE ${schema.assets.category} ${typeCase} ELSE ${ASSET_TYPE_ORDER.length} END) ELSE 0 END`;

        const rows = await db
          .select({
            issue: schema.issues,
            assetName: schema.assets.name,
          })
          .from(schema.issues)
          .leftJoin(schema.assets, eq(schema.assets.id, schema.issues.assetId))
          .where(whereClause)
          .orderBy(domainOrderExpr, assetTypeOrderExpr)
          .limit(pageSize)
          .offset((page - 1) * pageSize);

        for (const r of rows) {
          if (r.issue.assetId && r.assetName) {
            assetNameMap[r.issue.assetId] = { name: r.assetName };
          }
        }
        list = rows.map(r => r.issue);
      }

      // 添加资产名称到结果（assetNameMap 已在上方按路径预取，含完整资产对象，直接取 name）
      const listWithAssetName = list.map((item: any) => ({
        ...item,
        assetName: item.assetId ? (assetNameMap[item.assetId]?.name || '-') : '-',
      }));

      const riskStatsResult = await db
        .select({ riskLevel: schema.issues.riskLevel, count: count() })
        .from(schema.issues)
        .where(eq(schema.issues.projectId, projectId))
        .groupBy(schema.issues.riskLevel);

      const riskCounts: Record<string, number> = {};
      riskStatsResult.forEach((row: any) => {
        riskCounts[row.riskLevel] = row.count;
      });

      const riskStats = [
        { level: 'high', label: '高风险', count: riskCounts['high'] || 0, color: '#f56c6c' },
        { level: 'medium', label: '中风险', count: riskCounts['medium'] || 0, color: '#e6a23c' },
        { level: 'low', label: '低风险', count: riskCounts['low'] || 0, color: '#67c23a' },
      ];

      return { list: listWithAssetName, total, riskStats };
    })
  );

  ipcMain.handle('issue:get', wrap(async (_event, id: string) => {
      const db = getDb();
      const result = await db.select().from(schema.issues).where(eq(schema.issues.id, id)).limit(1);
      return result[0] || null;
    })
  );

  ipcMain.handle('issue:create', wrap(async (_event, data: any) => {
      const db = getDb();
      const id = randomUUID();
      const now = new Date().toISOString();
      // 显式字段白名单，防止 Mass Assignment 覆盖 id/createdAt/updatedAt 等内部字段
      const {
        projectId, assetId, itemId, securityDomain, controlPoint, controlName,
        issueTitle, issueDescription, riskLevel, status, rectificationSuggestion,
        rectificationDeadline, responsiblePerson, fixedDescription, fixedDate,
        assessor, evidenceFiles,
      } = data;
      await db.insert(schema.issues).values({
        projectId, assetId, itemId, securityDomain, controlPoint, controlName,
        issueTitle, issueDescription, riskLevel, status, rectificationSuggestion,
        rectificationDeadline, responsiblePerson, fixedDescription, fixedDate,
        assessor, evidenceFiles,
        id,
        createdAt: now,
        updatedAt: now,
      });
      return id;
    })
  );

  ipcMain.handle('issue:update', wrap(async (_event, id: string, data: any) => {
      const db = getDb();
      const now = new Date().toISOString();
      // 显式字段白名单，防止 Mass Assignment 覆盖 id/projectId/createdAt 等内部字段
      const {
        assetId, itemId, securityDomain, controlPoint, controlName,
        issueTitle, issueDescription, riskLevel, status, rectificationSuggestion,
        rectificationDeadline, responsiblePerson, fixedDescription, fixedDate,
        assessor, evidenceFiles,
      } = data;
      await db.update(schema.issues).set({
        assetId, itemId, securityDomain, controlPoint, controlName,
        issueTitle, issueDescription, riskLevel, status, rectificationSuggestion,
        rectificationDeadline, responsiblePerson, fixedDescription, fixedDate,
        assessor, evidenceFiles,
        updatedAt: now,
      }).where(eq(schema.issues.id, id));
    })
  );

  ipcMain.handle('issue:remove', wrap(async (_event, id: string) => {
      const db = getDb();
      await db.delete(schema.issues).where(eq(schema.issues.id, id));
    })
  );

  ipcMain.handle('issue:batchRemove', wrap(async (_event, ids: string[]) => {
      const db = getDb();
      await db.delete(schema.issues).where(inArray(schema.issues.id, ids));
    })
  );

  ipcMain.handle('issue:batchUpdateStatus', wrap(async (_event, ids: string[], status?: string, riskLevel?: string) => {
      const db = getDb();
      const now = new Date().toISOString();
      const updateData: any = { updatedAt: now };
      if (status) updateData.status = status;
      if (riskLevel) updateData.riskLevel = riskLevel;
      await db.update(schema.issues).set(updateData).where(inArray(schema.issues.id, ids));
    })
  );

  ipcMain.handle('issue:updateEvidence', wrap(async (_event, id: string, evidenceFiles: string[]) => {
      const db = getDb();
      const now = new Date().toISOString();
      await db.update(schema.issues).set({
        evidenceFiles: JSON.stringify(evidenceFiles),
        updatedAt: now,
      }).where(eq(schema.issues.id, id));
    })
  );

  ipcMain.handle('issue:generateFromRecords', wrap(async (_event, projectId: string) => {
      const db = getDb();
      const now = new Date().toISOString();

      // 查询不符合和部分符合的测评记录
      const records = await db
        .select()
        .from(schema.assessmentRecords)
        .innerJoin(schema.assessmentItems, eq(schema.assessmentRecords.itemId, schema.assessmentItems.id))
        .where(and(
          eq(schema.assessmentRecords.projectId, projectId),
          sql`result IN ('non_compliant', 'nonconform', 'partial')`
        ));

      // 改造：按项目 standardId 动态加载域顺序，fallback 国标十域
      const { domainOrder: DOMAIN_ORDER } = await loadProjectDomainInfo(projectId);

      // 安全计算环境资产类型排序
      const ASSET_TYPE_ORDER = [
        'network_device',    // 网络设备
        'security_device',   // 安全设备
        'server_storage',    // 服务器
        'sys_doc',              // 系统管理文档
        'management_platform', // 系统管理平台
        'business_app',      // 应用系统
        'terminal',           // 终端
        'data_resource',      // 数据资源
        'data_category',      // 数据分类
      ];

      // 获取项目所有资产，用于排序
      const allAssets = await db.select().from(schema.assets).where(eq(schema.assets.projectId, projectId));
      const assetMap = new Map<string, any>();
      allAssets.forEach((a: any) => assetMap.set(a.id, a));

      // 按安全域排序，安全计算环境按资产类型排序
      records.sort((a: any, b: any) => {
        const itemA = a.assessment_items;
        const itemB = b.assessment_items;
        const domainIdxA = DOMAIN_ORDER.indexOf(itemA.domain);
        const domainIdxB = DOMAIN_ORDER.indexOf(itemB.domain);
        if (domainIdxA !== domainIdxB) return (domainIdxA === -1 ? 999 : domainIdxA) - (domainIdxB === -1 ? 999 : domainIdxB);

        // 同属安全计算环境时，按资产类型排序
        if (itemA.domain === 'secure_computing' && itemB.domain === 'secure_computing') {
          const assetA = assetMap.get(a.assessment_records.assetId);
          const assetB = assetMap.get(b.assessment_records.assetId);
          const typeA = assetA?.category || '';
          const typeB = assetB?.category || '';
          const typeIdxA = ASSET_TYPE_ORDER.indexOf(typeA);
          const typeIdxB = ASSET_TYPE_ORDER.indexOf(typeB);
          if (typeIdxA !== typeIdxB) return (typeIdxA === -1 ? 999 : typeIdxA) - (typeIdxB === -1 ? 999 : typeIdxB);
        }

        return 0;
      });

      let count = 0;

      for (const rec of records) {
        const record = rec.assessment_records as any;
        const item = rec.assessment_items as any;

        const existing = await db
          .select()
          .from(schema.issues)
          .where(and(
            eq(schema.issues.projectId, projectId),
            eq(schema.issues.itemId, item.id)
          ))
          .limit(1);

        if (existing.length > 0) continue;

        // 根据结果类型设置不同标题和风险等级
        const isNonCompliant = record.result === 'non_compliant' || record.result === 'nonconform';
        const riskLevel = isNonCompliant ? (item.isHighRisk ? 'high' : 'medium') : 'low';

        await db.insert(schema.issues).values({
          id: randomUUID(),
          projectId,
          itemId: item.id,
          assetId: record.assetId,
          securityDomain: item.domain,
          controlPoint: item.controlPoint,
          controlName: item.controlName,
          issueTitle: `${item.controlName} - ${isNonCompliant ? '不符合' : '部分符合'}`,
          issueDescription: record.findings || `经测评发现，${item.controlName}${isNonCompliant ? '不符合' : '部分符合'}要求。`,
          riskLevel,
          status: 'pending',
          rectificationSuggestion: `根据等保2.0标准要求，${item.requirement}`,
          createdAt: now,
          updatedAt: now,
        } as any);
        count++;
      }

      return { count };
    })
  );

  ipcMain.handle('issue:getSummary', wrap(async (_event, projectId: string) => {
      const db = getDb();

      const riskStatsResult = await db
        .select({ riskLevel: schema.issues.riskLevel, count: count() })
        .from(schema.issues)
        .where(eq(schema.issues.projectId, projectId))
        .groupBy(schema.issues.riskLevel);

      const statusStatsResult = await db
        .select({ status: schema.issues.status, count: count() })
        .from(schema.issues)
        .where(eq(schema.issues.projectId, projectId))
        .groupBy(schema.issues.status);

      const domainStatsResult = await db
        .select({ securityDomain: schema.issues.securityDomain, count: count() })
        .from(schema.issues)
        .where(eq(schema.issues.projectId, projectId))
        .groupBy(schema.issues.securityDomain);

      const totalResult = await db
        .select({ value: count() })
        .from(schema.issues)
        .where(eq(schema.issues.projectId, projectId));

      const total = totalResult[0]?.value || 0;

      const riskCounts: Record<string, number> = {};
      riskStatsResult.forEach((row: any) => { riskCounts[row.riskLevel] = row.count; });

      const statusCounts: Record<string, number> = {};
      statusStatsResult.forEach((row: any) => { statusCounts[row.status] = row.count; });

      const domainCounts: Record<string, number> = {};
      domainStatsResult.forEach((row: any) => { domainCounts[row.securityDomain] = row.count; });

      // 符合率统一走 services/assessment-progress（格内口径），与「现场核查页」完全一致。
      // 此前这里只按 itemId 过滤、不做格内校验，跨层面错配的记录会被计入，两页数字因此不一致。
      const progress = await computeAssessmentProgress(projectId);
      const complianceRate = progress.complianceRate;

      return {
        total,
        highRisk: riskCounts['high'] || 0,
        mediumRisk: riskCounts['medium'] || 0,
        lowRisk: riskCounts['low'] || 0,
        pending: statusCounts['pending'] || 0,
        rectifying: statusCounts['rectifying'] || 0,
        resolved: statusCounts['resolved'] || 0,
        closed: statusCounts['closed'] || 0,
        complianceRate,
        riskStats: [
          { level: 'high', label: '高风险', count: riskCounts['high'] || 0, color: '#f56c6c' },
          { level: 'medium', label: '中风险', count: riskCounts['medium'] || 0, color: '#e6a23c' },
          { level: 'low', label: '低风险', count: riskCounts['low'] || 0, color: '#67c23a' },
        ],
        domainStats: Object.entries(domainCounts).map(([name, count]) => ({ name, count: count as number })),
      };
    })
  );

  ipcMain.handle('issue:exportExcel', wrap(async (_event, projectId: string) => {
      const db = getDb();
      const project = await db.query.projects.findFirst({ where: eq(schema.projects.id, projectId) });
      const projectName = project?.name || '未知项目';
      let issues = await db.select().from(schema.issues).where(eq(schema.issues.projectId, projectId));

      // 「测评项」列：按 issues.itemId 关联测评项条款原文，取不到时回退 controlName
      const requirementMap = await loadRequirementMap(issues.map((i: any) => i.itemId || ''));

      // 获取资产信息用于排序
      const assetIds = [...new Set(issues.map((i: any) => i.assetId).filter(Boolean))];
      const assetMap: Record<string, any> = {};
      if (assetIds.length > 0) {
        const assetRows = await db.select().from(schema.assets).where(inArray(schema.assets.id, assetIds));
        assetRows.forEach((a: any) => { assetMap[a.id] = a; });
      }
      issues = issues.map((item: any) => ({
        ...item,
        assetName: item.assetId ? (assetMap[item.assetId]?.name || '-') : '-',
        assetCategory: item.assetId ? (assetMap[item.assetId]?.category || '') : '',
      }));

      // 改造：按项目 standardId 动态加载域顺序与域名映射，fallback 国标十域
      const { domainOrder: DOMAIN_ORDER, domainIdToName: DOMAIN_ID_TO_NAME } = await loadProjectDomainInfo(projectId);

      // 安全计算环境资产类型排序
      const ASSET_TYPE_ORDER = [
        'network_device',    // 网络设备
        'security_device',   // 安全设备
        'server_storage',    // 服务器
        'sys_doc',              // 系统管理文档
        'management_platform', // 系统管理平台
        'business_app',      // 应用系统
        'terminal',           // 终端
        'data_resource',      // 数据资源
        'data_category',      // 数据分类
      ];

      // 按安全域排序，安全计算环境按资产类型排序
      issues.sort((a: any, b: any) => {
        const domainIdxA = DOMAIN_ORDER.indexOf(a.securityDomain);
        const domainIdxB = DOMAIN_ORDER.indexOf(b.securityDomain);
        if (domainIdxA !== domainIdxB) return (domainIdxA === -1 ? 999 : domainIdxA) - (domainIdxB === -1 ? 999 : domainIdxB);

        // 同属安全计算环境时，按资产类型排序
        if (a.securityDomain === 'secure_computing' && b.securityDomain === 'secure_computing') {
          const typeIdxA = ASSET_TYPE_ORDER.indexOf(a.assetCategory);
          const typeIdxB = ASSET_TYPE_ORDER.indexOf(b.assetCategory);
          if (typeIdxA !== typeIdxB) return (typeIdxA === -1 ? 999 : typeIdxA) - (typeIdxB === -1 ? 999 : typeIdxB);
          // 同资产类型时，按资产名称排序
          const nameA = a.assetName || '';
          const nameB = b.assetName || '';
          if (nameA !== nameB) return nameA.localeCompare(nameB);
        }

        // 其他情况按风险等级排序
        const riskOrder: Record<string, number> = { high: 0, medium: 1, low: 2 };
        return (riskOrder[a.riskLevel] || 99) - (riskOrder[b.riskLevel] || 99);
      });

      // 按安全域分组
      const issuesByDomain: Record<string, any[]> = {};
      DOMAIN_ORDER.forEach(domain => { issuesByDomain[domain] = []; });
      issues.forEach((issue: any) => {
        const domain = issue.securityDomain;
        if (!issuesByDomain[domain]) issuesByDomain[domain] = [];
        issuesByDomain[domain].push(issue);
      });

      const workbook = new ExcelJS.Workbook();

      const columns = [
        { header: '序号', key: 'index', width: 7 },
        { header: '风险等级', key: 'riskLevel', width: 10 },
        { header: '测评对象', key: 'assetName', width: 18 },
        { header: '控制点', key: 'controlPoint', width: 16 },
        { header: '测评项', key: 'controlName', width: 40 },
        { header: '问题描述', key: 'issueDescription', width: 40 },
        { header: '整改建议', key: 'rectificationSuggestion', width: 40 },
        { header: '整改描述', key: 'fixedDescription', width: 30 },
        { header: '状态', key: 'status', width: 10 },
      ];

      const riskMap: Record<string, string> = { high: '高风险', medium: '中风险', low: '低风险' };
      const statusMap: Record<string, string> = { pending: '待整改', rectifying: '整改中', resolved: '已整改', closed: '已关闭' };

      // 为每个安全域创建sheet
      DOMAIN_ORDER.forEach(domain => {
        const domainIssues = issuesByDomain[domain];
        if (!domainIssues || domainIssues.length === 0) return;

        const domainName = DOMAIN_ID_TO_NAME[domain] || domain;
        const worksheet = workbook.addWorksheet(domainName);

        worksheet.columns = columns as ExcelJS.Column[];

        const headerRow = worksheet.getRow(1);
        headerRow.eachCell((cell) => {
          styleCell(cell, { bold: true, fontSize: 12, fontColor: 'FFFFFFFF', bgColor: 'FF409EFF', alignH: 'center', alignV: 'middle', border: 'medium' });
        });
        headerRow.height = 28;

        const dataColIndexes = columns.map((_, i) => i + 1);

        domainIssues.forEach((issue: any, index) => {
          const row = worksheet.addRow({
            index: index + 1,
            riskLevel: riskMap[issue.riskLevel] || issue.riskLevel,
            assetName: issue.assetName || '-',
            controlPoint: issue.controlPoint,
            controlName: (issue.itemId && requirementMap[issue.itemId]) || issue.controlName,
            issueDescription: issue.issueDescription,
            rectificationSuggestion: issue.rectificationSuggestion || '',
            fixedDescription: issue.fixedDescription || '',
            status: statusMap[issue.status] || issue.status,
          });

          const rowHeight = getRowMaxHeight(row, dataColIndexes, worksheet);
          row.height = rowHeight;

          const isZebra = index % 2 === 1;
          const riskColor = issue.riskLevel === 'high' ? 'FFC62828' : issue.riskLevel === 'medium' ? 'FFF57F17' : issue.riskLevel === 'low' ? 'FF2E7D32' : null;

          row.eachCell((cell, colNumber) => {
            styleCell(cell, {
              bgColor: isZebra ? 'FFF7F9FC' : undefined,
              alignH: colNumber === 1 ? 'center' : 'left',
              alignV: 'middle',
              border: 'thin',
            });
            if (colNumber === 2 && riskColor) {
              cell.font = { size: 11, bold: true, color: { argb: riskColor } };
            }
          });
        });
      });

      const result = await dialog.showSaveDialog({
        defaultPath: `${projectName}_整改建议_${new Date().toISOString().slice(0, 10).replace(/-/g, '')}.xlsx`,
        filters: [{ name: 'Excel文件', extensions: ['xlsx'] }],
      });
      if (result.canceled || !result.filePath) throw new Error('用户取消');

      await workbook.xlsx.writeFile(result.filePath);
      return result.filePath;
    })
  );
}
