import { ipcMain, dialog } from 'electron';
import { randomUUID } from 'crypto';
import ExcelJS from 'exceljs';
import { getDb } from '../db';
import * as schema from '../db/schema';
import { eq, and, inArray } from 'drizzle-orm';
import type {
  MajorRiskRow,
  MajorRiskListResult,
  MajorRiskSummary,
  MajorRiskSavePayload,
  MajorRiskCatalogItem,
  MajorRiskVerdict,
} from '../../shared/types';
import { wrap } from '../utils/ipc-wrapper';
import { getRowMaxHeight, styleCell } from '../utils/excel-helper';
import { matchCatalogCandidates, searchAssessmentRecords } from '../services/major-risk.service';

/**
 * 重大风险隐患识别与分析后端。
 *
 * 清单（major_risk_catalog）全局共用，由用户提供内容后导入/编辑；
 * 分析结论（major_risk_analysis）一条问题一份，三要素各一段话 + 最终判定。
 * AI 判定返回草稿不写库，前端人工复核后走 majorRisk:save（带归属校验与字段白名单）。
 */

const LEVEL_LABEL: Record<string, string> = { high: '高', medium: '中', low: '低' };
const VERDICT_LABEL: Record<MajorRiskVerdict, string> = {
  major: '属于重大风险隐患',
  non_major: '不属于',
  pending: '待判定',
};

function textOf(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function normalizeVerdict(value: unknown): MajorRiskVerdict {
  return value === 'major' || value === 'non_major' || value === 'pending' ? value : 'pending';
}

function toCatalogItem(row: any): MajorRiskCatalogItem {
  return {
    id: row.id,
    code: row.code || undefined,
    title: row.title || '',
    category: row.category || undefined,
    criteria: row.criteria || undefined,
    keywords: row.keywords || undefined,
    source: row.source || undefined,
    sortOrder: Number(row.sortOrder ?? row.sort_order ?? 0),
    enabled: Number(row.enabled ?? 1) === 1,
    createdAt: row.createdAt || row.created_at || '',
    updatedAt: row.updatedAt || row.updated_at || '',
  };
}

/** 把 issues 行 + 分析行 + 资产名映射成前端视图行 */
function toRow(issue: any, analysis: any | undefined, assetName?: string): MajorRiskRow {
  return {
    issueId: issue.id,
    projectId: issue.projectId,
    issueTitle: issue.issueTitle || '',
    issueDescription: issue.issueDescription || '',
    securityDomain: issue.securityDomain || '',
    controlPoint: issue.controlPoint || '',
    controlName: issue.controlName || '',
    assetName: assetName || '',
    riskLevel: (['high', 'medium', 'low'].includes(issue.riskLevel) ? issue.riskLevel : 'medium') as MajorRiskRow['riskLevel'],
    status: issue.status || 'pending',
    catalogId: analysis?.catalogId || undefined,
    catalogTitle: analysis?.catalogTitle || undefined,
    relevance: analysis?.relevance || undefined,
    severity: analysis?.severity || undefined,
    frequency: analysis?.frequency || undefined,
    verdict: normalizeVerdict(analysis?.verdict),
    conclusion: analysis?.conclusion || undefined,
    analyst: analysis?.analyst || undefined,
    analyzedAt: analysis?.analyzedAt || undefined,
    reviewedAt: analysis?.reviewedAt || undefined,
    source: analysis?.source === 'ai' ? 'ai' : 'manual',
  };
}

async function loadRows(projectId: string): Promise<{ list: MajorRiskRow[]; catalogCount: number }> {
  const db = getDb();
  const issues = await db.select().from(schema.issues).where(eq(schema.issues.projectId, projectId));
  const analyses = await db.select().from(schema.majorRiskAnalysis)
    .where(eq(schema.majorRiskAnalysis.projectId, projectId));
  const analysisByIssue = new Map<string, any>();
  analyses.forEach(a => analysisByIssue.set(a.issueId, a));

  const assetIds = [...new Set(issues.map((i: any) => i.assetId).filter(Boolean))] as string[];
  const assetMap: Record<string, string> = {};
  if (assetIds.length > 0) {
    const assets = await db.select().from(schema.assets).where(inArray(schema.assets.id, assetIds));
    assets.forEach((a: any) => { assetMap[a.id] = a.name || ''; });
  }

  const catalogRows = await db.select().from(schema.majorRiskCatalog)
    .where(eq(schema.majorRiskCatalog.enabled, 1));
  const list = issues.map((i: any) => toRow(i, analysisByIssue.get(i.id), i.assetId ? assetMap[i.assetId] : undefined));
  // 待判定排前；已分析按分析时间倒序
  list.sort((a, b) => {
    const aDone = a.verdict !== 'pending' ? 1 : 0;
    const bDone = b.verdict !== 'pending' ? 1 : 0;
    if (aDone !== bDone) return aDone - bDone;
    if (aDone === 1) return (b.analyzedAt || '').localeCompare(a.analyzedAt || '');
    return 0;
  });
  return { list, catalogCount: catalogRows.length };
}

function buildSummary(rows: MajorRiskRow[], catalogCount: number): MajorRiskSummary {
  return {
    total: rows.length,
    analyzed: rows.filter(r => r.verdict !== 'pending').length,
    pending: rows.filter(r => r.verdict === 'pending').length,
    major: rows.filter(r => r.verdict === 'major').length,
    nonMajor: rows.filter(r => r.verdict === 'non_major').length,
    catalogCount,
  };
}

export function registerMajorRiskHandlers(): void {
  // ---- 清单管理（全局） ----
  ipcMain.handle('majorRisk:catalogList', wrap(async () => {
    const db = getDb();
    const rows = await db.select().from(schema.majorRiskCatalog);
    return rows
      .map(toCatalogItem)
      .sort((a, b) => a.sortOrder - b.sortOrder || a.title.localeCompare(b.title));
  }, { moduleName: 'majorRisk' }));

  ipcMain.handle('majorRisk:catalogSave', wrap(async (_event, raw: Partial<MajorRiskCatalogItem> & { id?: string }) => {
    const db = getDb();
    const now = new Date().toISOString();
    const title = textOf(raw?.title).trim();
    if (!title) throw new Error('请填写隐患名称');
    const values = {
      code: textOf(raw.code).slice(0, 80) || null,
      title: title.slice(0, 300),
      category: textOf(raw.category).slice(0, 120) || null,
      criteria: textOf(raw.criteria).slice(0, 4000) || null,
      keywords: textOf(raw.keywords).slice(0, 2000) || null,
      source: textOf(raw.source).slice(0, 300) || null,
      sortOrder: Number.isFinite(raw.sortOrder) ? Number(raw.sortOrder) : 0,
      enabled: raw.enabled === false ? 0 : 1,
      updatedAt: now,
    };
    if (raw.id) {
      await db.update(schema.majorRiskCatalog).set(values).where(eq(schema.majorRiskCatalog.id, raw.id));
      const [updated] = await db.select().from(schema.majorRiskCatalog).where(eq(schema.majorRiskCatalog.id, raw.id)).limit(1);
      return toCatalogItem(updated);
    }
    const id = randomUUID();
    await db.insert(schema.majorRiskCatalog).values({
      id,
      ...values,
      createdAt: now,
    });
    const [created] = await db.select().from(schema.majorRiskCatalog).where(eq(schema.majorRiskCatalog.id, id)).limit(1);
    return toCatalogItem(created);
  }, { moduleName: 'majorRisk' }));

  ipcMain.handle('majorRisk:catalogRemove', wrap(async (_event, id: string) => {
    const db = getDb();
    if (!id) throw new Error('缺少清单条目ID');
    await db.delete(schema.majorRiskCatalog).where(eq(schema.majorRiskCatalog.id, id));
  }, { moduleName: 'majorRisk' }));

  ipcMain.handle('majorRisk:catalogImport', wrap(async (_event, items: Array<Partial<MajorRiskCatalogItem>>) => {
    const db = getDb();
    if (!Array.isArray(items)) throw new Error('导入内容格式不正确');
    const now = new Date().toISOString();
    const clean = items
      .map(it => ({ ...it, title: textOf(it?.title).trim() }))
      .filter(it => !!it.title)
      .slice(0, 3000);
    // 全量替换：清单是用户提供的单一来源，导入即覆盖，避免重复累积。
    // 删除与插入必须同一事务，否则中途失败会留下空清单或半套清单且不会自愈
    db.transaction((tx) => {
      tx.delete(schema.majorRiskCatalog).run();
      for (let i = 0; i < clean.length; i++) {
        const it = clean[i];
        tx.insert(schema.majorRiskCatalog).values({
          id: randomUUID(),
          code: textOf(it.code).slice(0, 80) || null,
          title: it.title!.slice(0, 300),
          category: textOf(it.category).slice(0, 120) || null,
          criteria: textOf(it.criteria).slice(0, 4000) || null,
          keywords: textOf(it.keywords).slice(0, 2000) || null,
          source: textOf(it.source).slice(0, 300) || null,
          sortOrder: Number.isFinite(it.sortOrder) ? Number(it.sortOrder) : i,
          enabled: it.enabled === false ? 0 : 1,
          createdAt: now,
          updatedAt: now,
        }).run();
      }
    });
    return { count: clean.length, replaced: true };
  }, { moduleName: 'majorRisk' }));

  // ---- 召回（供页面展示"命中依据"与 AI 识别前使用） ----
  ipcMain.handle('majorRisk:matchCatalog', wrap(async (_event, params: {
    issueTitle?: string;
    issueDescription?: string;
    securityDomain?: string;
    controlPoint?: string;
    controlName?: string;
    assetName?: string;
  }) => {
    const db = getDb();
    const rows = await db.select().from(schema.majorRiskCatalog)
      .where(eq(schema.majorRiskCatalog.enabled, 1));
    return matchCatalogCandidates(params || {}, rows.map(toCatalogItem));
  }, { moduleName: 'majorRisk' }));

  ipcMain.handle('majorRisk:searchRecords', wrap(async (_event, params: {
    projectId: string; issueId?: string; keyword?: string;
  }) => {
    if (!params?.projectId) throw new Error('缺少项目ID');
    return searchAssessmentRecords(params);
  }, { moduleName: 'majorRisk' }));

  // ---- 分析结论读写 ----
  ipcMain.handle('majorRisk:list', wrap(async (_event, params: { projectId: string }) => {
    const projectId = params?.projectId;
    if (!projectId) throw new Error('缺少项目ID');
    const { list, catalogCount } = await loadRows(projectId);
    const result: MajorRiskListResult = { list, summary: buildSummary(list, catalogCount) };
    return result;
  }, { moduleName: 'majorRisk' }));

  ipcMain.handle('majorRisk:save', wrap(async (_event, payload: MajorRiskSavePayload) => {
    const db = getDb();
    const { issueId, projectId } = payload || ({} as MajorRiskSavePayload);
    if (!issueId || !projectId) throw new Error('缺少问题ID或项目ID');

    // 归属校验：只允许改本项目名下的问题
    const [issue] = await db.select().from(schema.issues)
      .where(and(eq(schema.issues.id, issueId), eq(schema.issues.projectId, projectId)))
      .limit(1);
    if (!issue) throw new Error('问题不存在或不属于当前系统');

    const now = new Date().toISOString();
    const verdict = normalizeVerdict(payload.verdict);
    let catalogId = textOf(payload.catalogId).slice(0, 100) || null;
    // AI 来源二次校验：清单表里查不到的编号（模型编造）落库前清掉，
    // catalogTitle 保留作为快照依据，但不再挂一个不存在的条目 id。
    if (payload.source === 'ai' && catalogId) {
      const [known] = await db.select({ id: schema.majorRiskCatalog.id })
        .from(schema.majorRiskCatalog).where(eq(schema.majorRiskCatalog.id, catalogId)).limit(1);
      if (!known) catalogId = null;
    }
    const values = {
      projectId,
      issueId,
      catalogId,
      catalogTitle: textOf(payload.catalogTitle).slice(0, 300) || null,
      relevance: textOf(payload.relevance).slice(0, 3000) || null,
      severity: textOf(payload.severity).slice(0, 3000) || null,
      frequency: textOf(payload.frequency).slice(0, 3000) || null,
      verdict,
      conclusion: textOf(payload.conclusion).slice(0, 3000) || null,
      analyst: textOf(payload.analyst).slice(0, 100) || null,
      source: payload.source === 'ai' ? 'ai' : 'manual',
      analyzedAt: now,
      reviewedAt: now,
      updatedAt: now,
    };

    const [existing] = await db.select().from(schema.majorRiskAnalysis)
      .where(eq(schema.majorRiskAnalysis.issueId, issueId)).limit(1);
    let savedId: string;
    if (existing) {
      savedId = existing.id;
      // reviewedAt 只记录人工复核：AI 草稿回写不制造"已复核"假象。
      // 若此前已人工复核、现在重跑 AI，判定内容已变，复核时间同步清空，需重新复核。
      const finalValues = values.source === 'ai'
        ? { ...values, reviewedAt: null }
        : values;
      await db.update(schema.majorRiskAnalysis).set(finalValues).where(eq(schema.majorRiskAnalysis.id, existing.id));
    } else {
      savedId = randomUUID();
      await db.insert(schema.majorRiskAnalysis).values({
        id: savedId,
        ...values,
        reviewedAt: values.source === 'ai' ? null : now,
        createdAt: now,
      });
    }
    const [saved] = await db.select().from(schema.majorRiskAnalysis)
      .where(eq(schema.majorRiskAnalysis.id, savedId)).limit(1);
    const [asset] = issue.assetId
      ? await db.select().from(schema.assets).where(eq(schema.assets.id, issue.assetId)).limit(1)
      : [];
    return toRow(issue, saved, asset?.name);
  }, { moduleName: 'majorRisk' }));

  ipcMain.handle('majorRisk:clear', wrap(async (_event, payload: { issueId: string; projectId: string }) => {
    const db = getDb();
    // 必须同时带 issueId 与 projectId：早期兼容字符串调用会跳过归属校验构成越权后门，已移除
    const issueId = payload?.issueId;
    const projectId = payload?.projectId;
    if (!issueId || !projectId) throw new Error('缺少问题ID或项目ID');
    const [issue] = await db.select().from(schema.issues)
      .where(and(eq(schema.issues.id, issueId), eq(schema.issues.projectId, projectId)))
      .limit(1);
    if (!issue) throw new Error('问题不存在或不属于当前系统');
    await db.delete(schema.majorRiskAnalysis).where(and(
      eq(schema.majorRiskAnalysis.issueId, issueId),
      eq(schema.majorRiskAnalysis.projectId, projectId),
    ));
  }, { moduleName: 'majorRisk' }));

  // ---- 导出 Excel ----
  ipcMain.handle('majorRisk:exportExcel', wrap(async (_event, projectId: string) => {
    const db = getDb();
    if (!projectId) throw new Error('缺少项目ID');
    const project = await db.query.projects.findFirst({ where: eq(schema.projects.id, projectId) });
    const projectName = project?.name || '未知项目';
    const { list } = await loadRows(projectId);

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('重大风险隐患识别与分析');
    const columns = [
      { header: '序号', key: 'index', width: 7 },
      { header: '问题描述', key: 'issueTitle', width: 32 },
      { header: '安全域', key: 'securityDomain', width: 16 },
      { header: '测评对象', key: 'assetName', width: 18 },
      { header: '控制点', key: 'controlPoint', width: 16 },
      { header: '初判等级', key: 'riskLevel', width: 11 },
      { header: '命中清单条目', key: 'catalogTitle', width: 30 },
      { header: '相关性', key: 'relevance', width: 50 },
      { header: '严重性', key: 'severity', width: 50 },
      { header: '高发性', key: 'frequency', width: 50 },
      { header: '最终判定', key: 'verdict', width: 16 },
      { header: '综合结论', key: 'conclusion', width: 50 },
      { header: '复核人', key: 'analyst', width: 14 },
    ];
    worksheet.columns = columns as ExcelJS.Column[];
    const headerRow = worksheet.getRow(1);
    headerRow.eachCell(cell => {
      styleCell(cell, { bold: true, fontSize: 12, fontColor: 'FFFFFFFF', bgColor: 'FF409EFF', alignH: 'center', alignV: 'middle', border: 'medium' });
    });
    headerRow.height = 30;

    list.forEach((r, index) => {
      const row = worksheet.addRow({
        index: index + 1,
        issueTitle: r.issueTitle,
        securityDomain: r.securityDomain,
        assetName: r.assetName || '-',
        controlPoint: r.controlPoint,
        riskLevel: `${LEVEL_LABEL[r.riskLevel] || '中'}风险`,
        catalogTitle: r.catalogTitle || '',
        relevance: r.relevance || '',
        severity: r.severity || '',
        frequency: r.frequency || '',
        verdict: VERDICT_LABEL[r.verdict],
        conclusion: r.conclusion || '',
        analyst: r.analyst || '',
      });
      row.height = getRowMaxHeight(row, columns.map((_, i) => i + 1), worksheet);
      row.eachCell((cell, colNumber) => {
        styleCell(cell, {
          bgColor: index % 2 === 1 ? 'FFF7F9FC' : undefined,
          alignH: [1, 6, 11].includes(colNumber) ? 'center' : 'left',
          alignV: 'middle',
          border: 'thin',
        });
      });
    });

    const result = await dialog.showSaveDialog({
      defaultPath: `${projectName}_重大风险隐患识别与分析_${new Date().toISOString().slice(0, 10).replace(/-/g, '')}.xlsx`,
      filters: [{ name: 'Excel文件', extensions: ['xlsx'] }],
    });
    if (result.canceled || !result.filePath) throw new Error('用户取消');
    await workbook.xlsx.writeFile(result.filePath);
    return result.filePath;
  }, { moduleName: 'majorRisk' }));
}
