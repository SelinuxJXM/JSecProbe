import { ipcMain, dialog } from 'electron';
import log from 'electron-log';
import { getDb } from '../db';
import * as schema from '../db/schema';
import { eq, and, count, sql, like, or, desc, asc, inArray, lte } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import ExcelJS from 'exceljs';
import * as path from 'path';
import * as fs from 'fs';
import { getRowMaxHeight, styleCell } from '../utils/excel-helper';
import { getAppDataPath } from '../main/paths';
import { wrap } from '../utils/ipc-wrapper';

// 安全域ID到中文名称映射
const DOMAIN_ID_TO_NAME: Record<string, string> = {
  'secure_physical': '安全物理环境',
  'secure_communication': '安全通信网络',
  'secure_boundary': '安全区域边界',
  'secure_computing': '安全计算环境',
  'secure_management': '安全管理中心',
  'security_management': '安全管理制度',
  'security_organization': '安全管理机构',
  'security_personnel': '安全管理人员',
  'security_construction': '安全建设管理',
  'security_maintenance': '安全运维管理',
};

// 安全域中文名称到ID映射（用于导入）
const DOMAIN_NAME_TO_ID: Record<string, string> = {
  '安全物理环境': 'secure_physical',
  '安全通信网络': 'secure_communication',
  '安全区域边界': 'secure_boundary',
  '安全计算环境': 'secure_computing',
  '安全管理中心': 'secure_management',
  '安全管理制度': 'security_management',
  '安全管理机构': 'security_organization',
  '安全管理人员': 'security_personnel',
  '安全建设管理': 'security_construction',
  '安全运维管理': 'security_maintenance',
};

function getSecurityDomainName(domainId: string): string {
  return DOMAIN_ID_TO_NAME[domainId] || domainId || '-';
}

function parseSecurityDomain(value: string): string {
  if (!value) return '';
  const trimmed = value.trim();
  // 如果是中文，转换为ID
  if (DOMAIN_NAME_TO_ID[trimmed]) return DOMAIN_NAME_TO_ID[trimmed];
  // 如果已经是ID，直接返回
  if (DOMAIN_ID_TO_NAME[trimmed]) return trimmed;
  // 未知值，原样返回
  return trimmed;
}

async function getAllowedBasePaths(): Promise<string[]> {
  const dataPath = await getAppDataPath();
  return [
    dataPath,
    path.join(dataPath, 'screenshots'),
    path.join(dataPath, 'evidence'),
    path.join(dataPath, 'knowledge'),
    path.join(dataPath, 'temp'),
    path.join(dataPath, 'backups'),
  ];
}

async function validatePath(inputPath: string): Promise<string> {
  const resolved = path.resolve(inputPath);
  const allowedPaths = await getAllowedBasePaths();
  const isAllowed = allowedPaths.some(base => {
    const resolvedBase = path.resolve(base);
    return resolved === resolvedBase || resolved.startsWith(resolvedBase + path.sep);
  });
  if (!isAllowed) {
    throw new Error(`路径访问被拒绝: ${inputPath} (仅允许访问应用数据目录)`);
  }
  return resolved;
}

const MAX_EXCEL_SIZE = 50 * 1024 * 1024;
const MAX_EXCEL_ROWS = 10000;

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
        conditions.push(
          or(
            like(schema.issues.issueTitle, `%${keyword}%`),
            like(schema.issues.issueDescription, `%${keyword}%`)
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
      if (sortField) {
        list = await db.select().from(schema.issues)
          .where(whereClause)
          .orderBy(sortFn(sortField))
          .limit(pageSize)
          .offset((page - 1) * pageSize);
      } else {
        list = await db.select().from(schema.issues)
          .where(whereClause)
          .orderBy(desc(schema.issues.createdAt))
          .limit(pageSize)
          .offset((page - 1) * pageSize);
      }

      // 获取资产名称映射
      const assetIds = [...new Set(list.map((i: any) => i.assetId).filter(Boolean))];
      const assetNameMap: Record<string, string> = {};
      if (assetIds.length > 0) {
        const assetRows = await db.select({ id: schema.assets.id, name: schema.assets.name }).from(schema.assets).where(inArray(schema.assets.id, assetIds));
        assetRows.forEach((a: any) => { assetNameMap[a.id] = a.name; });
      }

      // 添加资产名称到结果
      const listWithAssetName = list.map((item: any) => ({
        ...item,
        assetName: item.assetId ? (assetNameMap[item.assetId] || '-') : '-',
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
      await db.insert(schema.issues).values({
        ...data,
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
      await db.update(schema.issues).set({
        ...data,
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

      // 适用范围条件
      const applicableConditions = [
        eq(schema.assessmentItems.standardId, project?.standardId || 'gb-t-22239-2019-l3'),
        extOr,
      ];
      if (project?.level) {
        applicableConditions.push(lte(schema.assessmentItems.minLevel, project.level));
      }

      // 子查询：适用范围的项ID
      const itemIdsSubquery = db
        .select({ id: schema.assessmentItems.id })
        .from(schema.assessmentItems)
        .where(and(...applicableConditions));

      const testedRecords = await db
        .select({ value: count() })
        .from(schema.assessmentRecords)
        .where(and(
          eq(schema.assessmentRecords.projectId, projectId),
          inArray(schema.assessmentRecords.itemId, itemIdsSubquery),
          sql`result IN ('compliant', 'conform', 'partial', 'non_compliant', 'nonconform')`
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
      const complianceRate = (tested + na) > 0 ? Math.round((compliant / (tested + na)) * 100) : 0;

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

      issues = issues.sort((a: any, b: any) => {
        const riskOrder: Record<string, number> = { high: 0, medium: 1, low: 2 };
        return (riskOrder[a.riskLevel] || 99) - (riskOrder[b.riskLevel] || 99);
      });

      // 获取资产名称映射
      const assetIds = [...new Set(issues.map((i: any) => i.assetId).filter(Boolean))];
      const assetNameMap: Record<string, string> = {};
      if (assetIds.length > 0) {
        const assetRows = await db.select({ id: schema.assets.id, name: schema.assets.name }).from(schema.assets).where(inArray(schema.assets.id, assetIds));
        assetRows.forEach((a: any) => { assetNameMap[a.id] = a.name; });
      }
      issues = issues.map((item: any) => ({
        ...item,
        assetName: item.assetId ? (assetNameMap[item.assetId] || '-') : '-',
      }));

      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('问题清单');

      const columns = [
        { header: '序号', key: 'index', width: 7 },
        { header: '风险等级', key: 'riskLevel', width: 10 },
        { header: '安全域', key: 'securityDomain', width: 16 },
        { header: '测评对象', key: 'assetName', width: 18 },
        { header: '控制点', key: 'controlPoint', width: 16 },
        { header: '控制项', key: 'controlName', width: 20 },
        { header: '问题标题', key: 'issueTitle', width: 30 },
        { header: '问题描述', key: 'issueDescription', width: 40 },
        { header: '整改建议', key: 'rectificationSuggestion', width: 40 },
        { header: '整改日期', key: 'fixedDate', width: 14 },
        { header: '整改描述', key: 'fixedDescription', width: 30 },
        { header: '测评人', key: 'assessor', width: 12 },
        { header: '状态', key: 'status', width: 10 },
        { header: '创建时间', key: 'createdAt', width: 18 },
      ];
      worksheet.columns = columns as ExcelJS.Column[];

      const riskMap: Record<string, string> = { high: '高风险', medium: '中风险', low: '低风险' };
      const statusMap: Record<string, string> = { pending: '待整改', rectifying: '整改中', resolved: '已整改', closed: '已关闭' };

      const headerRow = worksheet.getRow(1);
      headerRow.eachCell((cell) => {
        styleCell(cell, { bold: true, fontSize: 12, fontColor: 'FFFFFFFF', bgColor: 'FF409EFF', alignH: 'center', alignV: 'middle', border: 'medium' });
      });
      headerRow.height = 28;

      const dataColIndexes = columns.map((_, i) => i + 1);

      issues.forEach((issue: any, index) => {
        const row = worksheet.addRow({
          index: index + 1,
          riskLevel: riskMap[issue.riskLevel] || issue.riskLevel,
          securityDomain: getSecurityDomainName(issue.securityDomain),
          assetName: issue.assetName || '-',
          controlPoint: issue.controlPoint,
          controlName: issue.controlName,
          issueTitle: issue.issueTitle,
          issueDescription: issue.issueDescription,
          rectificationSuggestion: issue.rectificationSuggestion || '',
          fixedDate: issue.fixedDate || '',
          fixedDescription: issue.fixedDescription || '',
          assessor: issue.assessor || '',
          status: statusMap[issue.status] || issue.status,
          createdAt: issue.createdAt,
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
          // Keep risk level color highlighting
          if (colNumber === 2 && riskColor) {
            cell.font = { size: 11, bold: true, color: { argb: riskColor } };
          }
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
      const worksheet = workbook.addWorksheet('问题清单');

      const columns = [
        { header: '序号', key: 'index', width: 7 },
        { header: '风险等级', key: 'riskLevel', width: 10 },
        { header: '安全域', key: 'securityDomain', width: 16 },
        { header: '测评对象', key: 'assetName', width: 18 },
        { header: '控制点', key: 'controlPoint', width: 16 },
        { header: '控制项', key: 'controlName', width: 20 },
        { header: '问题标题', key: 'issueTitle', width: 30 },
        { header: '问题描述', key: 'issueDescription', width: 40 },
        { header: '整改建议', key: 'rectificationSuggestion', width: 40 },
        { header: '整改日期', key: 'fixedDate', width: 14 },
        { header: '整改描述', key: 'fixedDescription', width: 30 },
        { header: '测评人', key: 'assessor', width: 12 },
        { header: '状态', key: 'status', width: 10 },
        { header: '创建时间', key: 'createdAt', width: 18 },
      ];
      worksheet.columns = columns as ExcelJS.Column[];

      // Header row
      const headerRow = worksheet.getRow(1);
      headerRow.eachCell((cell) => {
        styleCell(cell, { bold: true, fontSize: 12, fontColor: 'FFFFFFFF', bgColor: 'FF409EFF', alignH: 'center', alignV: 'middle', border: 'medium' });
      });
      headerRow.height = 28;

      // Example data
      const examples = [
        {
          riskLevel: '高风险',
          securityDomain: '安全计算环境',
          assetName: '应用服务器',
          controlPoint: '身份鉴别',
          controlName: '应对登录的用户进行身份标识和鉴别',
          issueTitle: '未设置密码复杂度策略',
          issueDescription: '系统未配置密码复杂度要求，允许使用简单密码',
          rectificationSuggestion: '在系统安全策略中配置密码复杂度要求，包括最小长度、大小写字母、数字和特殊字符组合',
          fixedDate: '',
          fixedDescription: '',
          assessor: '张三',
          status: '待整改',
          createdAt: new Date().toISOString().slice(0, 10),
        },
        {
          riskLevel: '中风险',
          securityDomain: '安全区域边界',
          assetName: '下一代防火墙',
          controlPoint: '边界防护',
          controlName: '应能够在网络边界处监视入侵行为',
          issueTitle: '入侵检测规则未及时更新',
          issueDescription: '入侵检测系统的检测规则库超过3个月未更新',
          rectificationSuggestion: '定期更新入侵检测规则库，建议每月至少更新一次',
          fixedDate: '',
          fixedDescription: '',
          assessor: '李四',
          status: '整改中',
          createdAt: new Date().toISOString().slice(0, 10),
        },
        {
          riskLevel: '低风险',
          securityDomain: '安全管理制度',
          assetName: '-',
          controlPoint: '管理制度',
          controlName: '应制定信息安全工作的总体方针和安全策略',
          issueTitle: '信息安全方针策略文档需更新',
          issueDescription: '信息安全总体方针文档内容陈旧，未反映当前业务实际情况',
          rectificationSuggestion: '根据当前业务发展和安全要求，更新信息安全总体方针文档',
          fixedDate: new Date().toISOString().slice(0, 10),
          fixedDescription: '已完成方针文档更新并发布',
          assessor: '王五',
          status: '已整改',
          createdAt: new Date().toISOString().slice(0, 10),
        },
      ];

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
      const worksheet = workbook.getWorksheet('问题清单') || workbook.worksheets[0];

      if (!worksheet) {
        throw new Error('Excel文件中未找到工作表');
      }
      
      if (worksheet.rowCount > MAX_EXCEL_ROWS) {
        throw new Error(`Excel行数过多 (最大${MAX_EXCEL_ROWS}行)`);
      }

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

          const issueTitle = getCell('问题标题');
          if (!issueTitle) continue;

          rowsToInsert.push({
            id: randomUUID(),
            projectId,
            securityDomain: parseSecurityDomain(getCell('安全域')),
            controlPoint: getCell('控制点'),
            controlName: getCell('控制项'),
            issueTitle,
            issueDescription: getCell('问题描述'),
            rectificationSuggestion: getCell('整改建议'),
            fixedDate: getCell('整改日期'),
            fixedDescription: getCell('整改描述'),
            assessor: getCell('测评人'),
            riskLevel,
            status,
            createdAt: now,
            updatedAt: now,
          });
        } catch (err: any) {
          errors.push(`第${rowNumber}行: ${err.message}`);
        }
      }

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
