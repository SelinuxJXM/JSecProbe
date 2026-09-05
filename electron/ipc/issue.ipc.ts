import { ipcMain, dialog } from 'electron';
import log from 'electron-log';
import { getDb } from '../db';
import * as schema from '../db/schema';
import { eq, and, count, sql, or, desc, asc, inArray, lte } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import ExcelJS from 'exceljs';
import * as path from 'path';
import * as fs from 'fs';
import { getRowMaxHeight, styleCell } from '../utils/excel-helper';
import { wrap } from '../utils/ipc-wrapper';

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

async function validatePath(inputPath: string): Promise<string> {
  if (!inputPath) {
    throw new Error('路径不能为空');
  }
  // 在解析前按路径段检查：拒绝显式包含的 '..'（路径穿越尝试）。
  // path.resolve 会折叠 '../'，解析后字面 '..' 已不存在，仅做 includes('..') 判断会永远不命中，
  // 导致目录穿越穿透放行；同时用户通过对话框选择的任意绝对路径（无 '..' 段）不受影响。
  const segments = inputPath.split(/[\\/]/);
  if (segments.includes('..')) {
    throw new Error('路径访问被拒绝: 非法的路径格式');
  }
  return path.resolve(inputPath);
}

const MAX_EXCEL_SIZE = 50 * 1024 * 1024;

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
        // 默认排序：先获取所有符合条件的数据，在应用层按安全域和资产类型排序，再分页
        const allList = await db.select().from(schema.issues).where(whereClause);

        // 获取资产信息用于排序
        const allAssetIds = [...new Set(allList.map((i: any) => i.assetId).filter(Boolean))];
        if (allAssetIds.length > 0) {
          const assetRows = await db.select().from(schema.assets).where(inArray(schema.assets.id, allAssetIds));
          assetRows.forEach((a: any) => { assetNameMap[a.id] = a; });
        }

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

        // 按安全域排序，安全计算环境按资产类型排序
        allList.sort((a: any, b: any) => {
          const domainIdxA = DOMAIN_ORDER.indexOf(a.securityDomain);
          const domainIdxB = DOMAIN_ORDER.indexOf(b.securityDomain);
          if (domainIdxA !== domainIdxB) return (domainIdxA === -1 ? 999 : domainIdxA) - (domainIdxB === -1 ? 999 : domainIdxB);

          // 同属安全计算环境时，按资产类型排序
          if (a.securityDomain === 'secure_computing' && b.securityDomain === 'secure_computing') {
            const assetA = assetNameMap[a.assetId];
            const assetB = assetNameMap[b.assetId];
            const typeA = assetA?.category || '';
            const typeB = assetB?.category || '';
            const typeIdxA = ASSET_TYPE_ORDER.indexOf(typeA);
            const typeIdxB = ASSET_TYPE_ORDER.indexOf(typeB);
            if (typeIdxA !== typeIdxB) return (typeIdxA === -1 ? 999 : typeIdxA) - (typeIdxB === -1 ? 999 : typeIdxB);
          }

          return 0;
        });

        // 分页
        const startIndex = (page - 1) * pageSize;
        list = allList.slice(startIndex, startIndex + pageSize);
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

      const project = await db.query.projects.findFirst({ where: eq(schema.projects.id, projectId) });

      // 解析项目扩展类型
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
      const projectExtCodes: string[] = [];
      if (project?.extensionType) {
        for (const t of project.extensionType.split(',').filter(Boolean)) {
          const code = EXT_TYPE_MAP[t.trim()] || t.trim();
          if (!projectExtCodes.includes(code)) projectExtCodes.push(code);
        }
      }

      // 构建扩展类型过滤条件
      const extOrConditions = [eq(schema.assessmentItems.extensionType, 'general')];
      for (const ext of projectExtCodes) {
        extOrConditions.push(eq(schema.assessmentItems.extensionType, ext));
      }
      const extOr = or(...extOrConditions);

      // === 解析有效 standardId（移除硬编码 gb-t-22239-2019-l3，兼容老项目/被删标准）===
      // 策略：项目绑定值（trim 后合法） → 同 grade=project.level → isDefault=1 → 列表首条；找不到则空串（适用项=0，进度=0）
      const projectRawStandard = typeof project?.standardId === 'string' ? project.standardId.trim() : '';
      const level = Number(project?.level) || 3;
      const standardsAll = await db
        .select({ id: schema.standards.id, grade: schema.standards.grade, isDefault: schema.standards.isDefault })
        .from(schema.standards);
      let standardId = '';
      if (projectRawStandard && standardsAll.some(s => s.id === projectRawStandard)) {
        standardId = projectRawStandard;
      } else if (standardsAll.length > 0) {
        const sameGrade = standardsAll.find(s => Number(s.grade) === level);
        const def = standardsAll.find(s => Number(s.isDefault) === 1);
        standardId = (sameGrade || def || standardsAll[0]).id;
      }

      // 适用范围条件：无 standardId 时不再生成硬编码条件，保证 DB 查 0 条不报错
      const applicableConditions: any[] = [];
      if (standardId) applicableConditions.push(eq(schema.assessmentItems.standardId, standardId));
      if (standardId) applicableConditions.push(extOr);
      if (project?.level) applicableConditions.push(lte(schema.assessmentItems.minLevel, project.level));

      // 子查询：适用范围的项ID（空条件退回永远假，避免 inArray 传空数组导致 SQL 语法错误）
      const hasApplicableFilters = applicableConditions.length > 0;
      const itemIdsSubquery = hasApplicableFilters
        ? db
            .select({ id: schema.assessmentItems.id })
            .from(schema.assessmentItems)
            .where(and(...applicableConditions))
        : db
            .select({ id: schema.assessmentItems.id })
            .from(schema.assessmentItems)
            .where(sql`0 = 1`)
            .limit(0);

      const testedRecords = await db
        .select({ value: count() })
        .from(schema.assessmentRecords)
        .where(and(
          eq(schema.assessmentRecords.projectId, projectId),
          inArray(schema.assessmentRecords.itemId, itemIdsSubquery),
          sql`result IN ('compliant', 'conform', 'partial', 'non_compliant', 'nonconform', 'not_applicable')`
        ));

      const compliantRecords = await db
        .select({ value: count() })
        .from(schema.assessmentRecords)
        .where(and(
          eq(schema.assessmentRecords.projectId, projectId),
          inArray(schema.assessmentRecords.itemId, itemIdsSubquery),
          sql`result IN ('compliant', 'conform')`
        ));

      const naRecords = await db
        .select({ value: count() })
        .from(schema.assessmentRecords)
        .where(and(
          eq(schema.assessmentRecords.projectId, projectId),
          inArray(schema.assessmentRecords.itemId, itemIdsSubquery),
          sql`result = 'not_applicable'`
        ));

      const tested = testedRecords[0]?.value || 0;
      const compliant = compliantRecords[0]?.value || 0;
      const na = naRecords[0]?.value || 0;
      const effectiveTested = Math.max(0, tested - na);
      const complianceRate = effectiveTested > 0
        ? Number(((compliant / effectiveTested) * 100).toFixed(2))
        : 0;

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
        { header: '控制项', key: 'controlName', width: 20 },
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
            controlName: issue.controlName,
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
        defaultPath: `${projectName}_问题清单_${new Date().toISOString().slice(0, 10).replace(/-/g, '')}.xlsx`,
        filters: [{ name: 'Excel文件', extensions: ['xlsx'] }],
      });
      if (result.canceled || !result.filePath) throw new Error('用户取消');

      await workbook.xlsx.writeFile(result.filePath);
      return result.filePath;
    })
  );

  ipcMain.handle('issue:downloadTemplate', wrap(async (_event, _projectId: string) => {
      const workbook = new ExcelJS.Workbook();

      const columns = [
        { header: '序号', key: 'index', width: 7 },
        { header: '风险等级', key: 'riskLevel', width: 10 },
        { header: '测评对象', key: 'assetName', width: 18 },
        { header: '控制点', key: 'controlPoint', width: 16 },
        { header: '控制项', key: 'controlName', width: 20 },
        { header: '问题描述', key: 'issueDescription', width: 40 },
        { header: '整改建议', key: 'rectificationSuggestion', width: 40 },
        { header: '整改描述', key: 'fixedDescription', width: 30 },
        { header: '状态', key: 'status', width: 10 },
      ];

      // 示例数据，按安全域分组（10个安全域）
      const examplesByDomain: Record<string, any[]> = {
        '安全物理环境': [
          {
            riskLevel: '中风险',
            assetName: '机房',
            controlPoint: '物理位置选择',
            controlName: '应选择在具有防震、防风和防雨等能力的建筑内',
            issueDescription: '机房位于建筑物顶层，存在漏水风险',
            rectificationSuggestion: '建议对机房进行防水处理，或选择低楼层机房',
            fixedDescription: '',
            status: '待整改',
          },
        ],
        '安全通信网络': [
          {
            riskLevel: '中风险',
            assetName: '核心交换机',
            controlPoint: '网络架构',
            controlName: '应保证网络设备的业务处理能力满足业务高峰期需要',
            issueDescription: '核心交换机在业务高峰期CPU利用率超过80%，存在性能瓶颈',
            rectificationSuggestion: '建议升级核心交换机设备，或增加负载分担设备',
            fixedDescription: '',
            status: '待整改',
          },
        ],
        '安全区域边界': [
          {
            riskLevel: '中风险',
            assetName: '下一代防火墙',
            controlPoint: '边界防护',
            controlName: '应能够在网络边界处监视入侵行为',
            issueDescription: '入侵检测系统的检测规则库超过3个月未更新',
            rectificationSuggestion: '定期更新入侵检测规则库，建议每月至少更新一次',
            fixedDescription: '',
            status: '整改中',
          },
        ],
        '安全计算环境': [
          {
            riskLevel: '高风险',
            assetName: '应用服务器',
            controlPoint: '身份鉴别',
            controlName: '应对登录的用户进行身份标识和鉴别',
            issueDescription: '系统未配置密码复杂度要求，允许使用简单密码',
            rectificationSuggestion: '在系统安全策略中配置密码复杂度要求，包括最小长度、大小写字母、数字和特殊字符组合',
            fixedDescription: '',
            status: '待整改',
          },
          {
            riskLevel: '中风险',
            assetName: '数据库服务器',
            controlPoint: '访问控制',
            controlName: '应授予管理用户所需的最小权限',
            issueDescription: '数据库用户权限配置过大，未遵循最小权限原则',
            rectificationSuggestion: '按照最小权限原则重新配置数据库用户权限',
            fixedDescription: '',
            status: '整改中',
          },
        ],
        '安全管理中心': [
          {
            riskLevel: '中风险',
            assetName: '安全管理系统',
            controlPoint: '系统管理',
            controlName: '应对设备进行集中管控',
            issueDescription: '未对所有安全设备进行集中管控，管理分散',
            rectificationSuggestion: '建议部署统一安全管理平台，实现安全设备的集中管控',
            fixedDescription: '',
            status: '待整改',
          },
        ],
        '安全管理制度': [
          {
            riskLevel: '低风险',
            assetName: '-',
            controlPoint: '管理制度',
            controlName: '应制定信息安全工作的总体方针和安全策略',
            issueDescription: '信息安全总体方针文档内容陈旧，未反映当前业务实际情况',
            rectificationSuggestion: '根据当前业务发展和安全要求，更新信息安全总体方针文档',
            fixedDescription: '已完成方针文档更新并发布',
            status: '已整改',
          },
        ],
        '安全管理机构': [
          {
            riskLevel: '低风险',
            assetName: '-',
            controlPoint: '岗位设置',
            controlName: '应设立系统管理员、安全管理员等岗位',
            issueDescription: '已设置安全管理员岗位，但职责划分不够清晰',
            rectificationSuggestion: '建议明确各安全岗位职责，形成书面文件',
            fixedDescription: '',
            status: '待整改',
          },
        ],
        '安全管理人员': [
          {
            riskLevel: '低风险',
            assetName: '-',
            controlPoint: '人员考核',
            controlName: '应对定期进行安全意识教育和培训',
            issueDescription: '本年度安全培训计划已制定，但执行记录不完整',
            rectificationSuggestion: '建议完善安全培训记录，包括培训内容、参加人员等',
            fixedDescription: '',
            status: '待整改',
          },
        ],
        '安全建设管理': [
          {
            riskLevel: '中风险',
            assetName: '-',
            controlPoint: '工程实施',
            controlName: '应制定工程实施方案和控制措施',
            issueDescription: '安全工程实施方案中未明确安全控制措施',
            rectificationSuggestion: '建议补充完善工程实施方案中的安全控制措施',
            fixedDescription: '',
            status: '待整改',
          },
        ],
        '安全运维管理': [
          {
            riskLevel: '中风险',
            assetName: '-',
            controlPoint: '环境管理',
            controlName: '应建立机房安全管理制度',
            issueDescription: '机房安全管理制度已建立，但部分条款需要更新',
            rectificationSuggestion: '建议对机房安全管理制度进行修订完善',
            fixedDescription: '',
            status: '待整改',
          },
        ],
      };

      // 为每个安全域创建sheet
      Object.entries(examplesByDomain).forEach(([domainName, examples]) => {
        const worksheet = workbook.addWorksheet(domainName);

        worksheet.columns = columns as ExcelJS.Column[];

        const headerRow = worksheet.getRow(1);
        headerRow.eachCell((cell) => {
          styleCell(cell, { bold: true, fontSize: 12, fontColor: 'FFFFFFFF', bgColor: 'FF409EFF', alignH: 'center', alignV: 'middle', border: 'medium' });
        });
        headerRow.height = 28;

        examples.forEach((example, index) => {
          const row = worksheet.addRow({
            index: index + 1,
            ...example,
          });

          const riskColor = example.riskLevel === '高风险' ? 'FFC62828' : example.riskLevel === '中风险' ? 'FFF57F17' : example.riskLevel === '低风险' ? 'FF2E7D32' : null;
          const isZebra = index % 2 === 1;

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
          row.height = 40;
        });
      });

      const timestamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      const result = await dialog.showSaveDialog({
        defaultPath: `问题清单导入模板_${timestamp}.xlsx`,
        filters: [{ name: 'Excel文件', extensions: ['xlsx'] }],
      });
      if (result.canceled || !result.filePath) {
        throw new Error('用户取消');
      }

      await workbook.xlsx.writeFile(result.filePath);
      return result.filePath;
    })
  );

  ipcMain.handle('issue:importExcel', wrap(async (_event, projectId: string, filePath: string) => {
      const db = getDb();
      const safePath = await validatePath(filePath);
      
      const stats = fs.statSync(safePath);
      if (stats.size > MAX_EXCEL_SIZE) {
        throw new Error(`Excel文件过大 (最大${MAX_EXCEL_SIZE / 1024 / 1024}MB)`);
      }
      
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.readFile(safePath);

      // 改造：按项目 standardId 动态加载"中文名 → 域 ID"映射，fallback 国标十域
      // sheet 名解析为域 ID，行标项目导入时使用行标实际域名
      const { domainNameToId: DOMAIN_NAME_TO_ID } = await loadProjectDomainInfo(projectId);

      const now = new Date().toISOString();
      const errors: string[] = [];
      const rowsToInsert: Array<Record<string, unknown>> = [];

      const riskReverseMap: Record<string, string> = {
        '高风险': 'high',
        '中风险': 'medium',
        '低风险': 'low',
      };
      const statusReverseMap: Record<string, string> = {
        '待整改': 'pending',
        '整改中': 'rectifying',
        '已整改': 'resolved',
        '已关闭': 'closed',
      };

      // 遍历所有sheet，根据sheet名称确定安全域
      workbook.worksheets.forEach((worksheet) => {
        if (!worksheet) return;
        if (worksheet.rowCount < 2) return; // 只有标题行，没有数据

        const sheetName = worksheet.name;
        const securityDomain = DOMAIN_NAME_TO_ID[sheetName] || '';

        const headerRow = worksheet.getRow(1);
        const colMap: Record<string, number> = {};
        headerRow.eachCell((cell, colNumber) => {
          const header = cell.value ? String(cell.value).trim() : '';
          colMap[header] = colNumber;
        });

        for (let rowNumber = 2; rowNumber <= worksheet.rowCount; rowNumber++) {
          try {
            const getCell = (header: string) => {
              const col = colMap[header];
              if (!col) return '';
              const cell = worksheet.getRow(rowNumber).getCell(col);
              return cell.value ? String(cell.value) : '';
            };

            const validRiskLevels = ['high', 'medium', 'low'];
            const validStatuses = ['pending', 'rectifying', 'resolved', 'closed'];

            const riskLevelRaw = getCell('风险等级');
            const riskLevel = riskReverseMap[riskLevelRaw] || (validRiskLevels.includes(riskLevelRaw) ? riskLevelRaw : 'medium');
            const statusRaw = getCell('状态');
            const status = statusReverseMap[statusRaw] || (validStatuses.includes(statusRaw) ? statusRaw : 'pending');

            const controlName = getCell('控制项');
            if (!controlName) continue;

            rowsToInsert.push({
              id: randomUUID(),
              projectId,
              securityDomain,
              controlPoint: getCell('控制点'),
              controlName,
              issueDescription: getCell('问题描述'),
              rectificationSuggestion: getCell('整改建议'),
              fixedDescription: getCell('整改描述'),
              riskLevel,
              status,
              createdAt: now,
              updatedAt: now,
            });
          } catch (err: any) {
            errors.push(`${sheetName} 第${rowNumber}行: ${err.message}`);
          }
        }
      });

      let count = 0;
      if (rowsToInsert.length > 0) {
        await db.insert(schema.issues).values(rowsToInsert as any);
        count = rowsToInsert.length;
      }

      if (errors.length > 0) {
        log.warn(`Excel导入部分失败: ${errors.join('; ')}`);
      }

      return { count, errors };
    })
  );
}
