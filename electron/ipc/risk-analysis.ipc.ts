import { ipcMain, dialog } from 'electron';
import ExcelJS from 'exceljs';
import { getDb } from '../db';
import * as schema from '../db/schema';
import { eq, and, inArray } from 'drizzle-orm';
import { loadRequirementMap } from '../utils/excel-import';
import type {
  IssueRiskAnalysis,
  RiskAnalysisListResult,
  RiskAnalysisSavePayload,
  RiskAnalysisSummary,
  RiskLevel3,
} from '../../shared/types';
import { wrap } from '../utils/ipc-wrapper';
import { getRowMaxHeight, styleCell } from '../utils/excel-helper';

/**
 * 风险分析后端（问题清单式）。
 *
 * 定位：风险分析不是风险评估。页面与问题清单同构，只是每条问题多填一段
 * 「分析结果」文本（形如"可能导致XXXX的风险"），不做可能性×影响矩阵、
 * 风险值或结论等级评定；问题本身的初判等级仍来自问题清单的 issues.risk_level。
 *
 * 数据：结论存在 issues 行的 risk_consequence 列上（复用 0005 迁移已有列，
 * 该列原本存"可能后果"，语义与"分析结果"一致），分析人/时间沿用
 * risk_analyst / risk_analyzed_at。不新增列、不改表结构，因此归档导入导出、
 * 项目级联删除、备份、Excel 链路全部无需改动，也不会产生孤儿数据。
 * 其余 risk_* 矩阵列保留但不再写入，历史数据不主动破坏。
 */

const LEVEL_LABEL: Record<RiskLevel3, string> = { high: '高', medium: '中', low: '低' };

function normalizeLevel(value: unknown): RiskLevel3 {
  return value === 'high' || value === 'medium' || value === 'low' ? value : 'medium';
}

function textOf(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** 把 issues 行 + 资产名映射成前端使用的视图行 */
function toRow(issue: any, assetName?: string): IssueRiskAnalysis {
  return {
    issueId: issue.id,
    projectId: issue.projectId,
    issueTitle: issue.issueTitle || '',
    issueDescription: issue.issueDescription || '',
    securityDomain: issue.securityDomain || '',
    controlPoint: issue.controlPoint || '',
    controlName: issue.controlName || '',
    assetName: assetName || '',
    riskLevel: normalizeLevel(issue.riskLevel),
    status: issue.status || 'pending',
    rectificationSuggestion: issue.rectificationSuggestion || undefined,
    result: issue.riskConsequence || undefined,
    analyst: issue.riskAnalyst || undefined,
    analyzedAt: issue.riskAnalyzedAt || undefined,
  };
}

async function loadRows(projectId: string): Promise<IssueRiskAnalysis[]> {
  const db = getDb();
  const issues = await db.select().from(schema.issues).where(eq(schema.issues.projectId, projectId));
  const assetIds = [...new Set(issues.map((i: any) => i.assetId).filter(Boolean))] as string[];
  const assetMap: Record<string, string> = {};
  if (assetIds.length > 0) {
    const assets = await db.select().from(schema.assets).where(inArray(schema.assets.id, assetIds));
    assets.forEach((a: any) => { assetMap[a.id] = a.name || ''; });
  }
  const rows = issues.map((i: any) => toRow(i, i.assetId ? assetMap[i.assetId] : undefined));
  // 待分析排前面；已分析的按分析时间倒序，便于从最近复核往下看
  rows.sort((a, b) => {
    const aDone = a.analyzedAt ? 1 : 0;
    const bDone = b.analyzedAt ? 1 : 0;
    if (aDone !== bDone) return aDone - bDone;
    if (aDone === 1) return (b.analyzedAt || '').localeCompare(a.analyzedAt || '');
    return 0;
  });
  return rows;
}

function buildSummary(rows: IssueRiskAnalysis[]): RiskAnalysisSummary {
  const analyzedRows = rows.filter(r => !!r.analyzedAt);
  const levelCounts: Record<RiskLevel3, number> = { high: 0, medium: 0, low: 0 };
  for (const r of rows) {
    // 统计口径与问题清单一致：一律按问题的初判风险等级
    levelCounts[r.riskLevel] += 1;
  }
  return {
    total: rows.length,
    analyzed: analyzedRows.length,
    pending: rows.length - analyzedRows.length,
    high: levelCounts.high,
    medium: levelCounts.medium,
    low: levelCounts.low,
  };
}

/** 生成「分析结果」初稿：按初判等级与控制项拼一段审慎的风险描述 */
function draftResultOf(issue: any): string {
  const controlName = textOf(issue.controlName) || '该控制项';
  const riskLevel = normalizeLevel(issue.riskLevel);
  const qualifier = riskLevel === 'high' ? '较高' : riskLevel === 'low' ? '较低' : '一定';
  return `该问题反映${controlName}相关安全措施存在缺失或未有效落实，可能导致${controlName}防护失效、相关数据或业务被未授权访问与利用的风险；结合问题初判等级（${LEVEL_LABEL[riskLevel]}），其影响具有${qualifier}可能性，需结合现场实际与资产重要性复核确认。`;
}

export function registerRiskAnalysisHandlers(): void {
  ipcMain.handle('riskAnalysis:list', wrap(async (_event, params: { projectId: string }) => {
    const projectId = params?.projectId;
    if (!projectId) throw new Error('缺少项目ID');
    const list = await loadRows(projectId);
    const result: RiskAnalysisListResult = { list, summary: buildSummary(list) };
    return result;
  }, { moduleName: 'riskAnalysis' }));

  ipcMain.handle('riskAnalysis:save', wrap(async (_event, payload: RiskAnalysisSavePayload) => {
    const db = getDb();
    const { issueId, projectId } = payload || ({} as RiskAnalysisSavePayload);
    if (!issueId || !projectId) throw new Error('缺少问题ID或项目ID');
    const result = textOf(payload.result).trim();
    if (!result) throw new Error('请填写分析结果');

    // 归属校验：只允许改本项目名下的问题，避免跨项目写入
    const [issue] = await db.select().from(schema.issues)
      .where(and(eq(schema.issues.id, issueId), eq(schema.issues.projectId, projectId)))
      .limit(1);
    if (!issue) throw new Error('问题不存在或不属于当前系统');

    const now = new Date().toISOString();
    // 显式白名单：只写分析结果三列；其余 risk_* 矩阵列保留历史值不动
    await db.update(schema.issues).set({
      riskConsequence: result.slice(0, 2000),
      riskAnalyst: textOf(payload.analyst).slice(0, 100),
      riskAnalyzedAt: now,
      updatedAt: now,
    }).where(eq(schema.issues.id, issueId));

    const [updated] = await db.select().from(schema.issues).where(eq(schema.issues.id, issueId)).limit(1);
    return toRow(updated);
  }, { moduleName: 'riskAnalysis' }));

  ipcMain.handle('riskAnalysis:clear', wrap(async (_event, issueId: string) => {
    const db = getDb();
    if (!issueId) throw new Error('缺少问题ID');
    await db.update(schema.issues).set({
      riskConsequence: null,
      riskAnalyst: null,
      riskAnalyzedAt: null,
      updatedAt: new Date().toISOString(),
    }).where(eq(schema.issues.id, issueId));
  }, { moduleName: 'riskAnalysis' }));

  ipcMain.handle('riskAnalysis:generateDraft', wrap(async (_event, projectId: string) => {
    const db = getDb();
    if (!projectId) throw new Error('缺少项目ID');
    const targets = await db.select().from(schema.issues).where(eq(schema.issues.projectId, projectId));
    let count = 0;
    for (const issue of targets) {
      // 只为还没有分析结果的问题生成初稿，不覆盖已填写内容
      if (textOf(issue.riskConsequence).trim()) continue;
      const result = draftResultOf(issue);
      const now = new Date().toISOString();
      await db.update(schema.issues).set({
        riskConsequence: result,
        riskAnalyzedAt: now,
        updatedAt: now,
      }).where(eq(schema.issues.id, issue.id));
      count++;
    }
    return { count };
  }, { moduleName: 'riskAnalysis' }));

  ipcMain.handle('riskAnalysis:exportExcel', wrap(async (_event, projectId: string) => {
    const db = getDb();
    if (!projectId) throw new Error('缺少项目ID');
    const project = await db.query.projects.findFirst({ where: eq(schema.projects.id, projectId) });
    const projectName = project?.name || '未知项目';
    const rows = await loadRows(projectId);

    // 「测评项」列：按 issues.itemId 关联测评项条款原文，取不到时回退 controlName
    const issueItems = await db.select({ id: schema.issues.id, itemId: schema.issues.itemId })
      .from(schema.issues).where(eq(schema.issues.projectId, projectId));
    const requirementMap = await loadRequirementMap(issueItems.map((i: any) => i.itemId || ''));
    const requirementByIssue: Record<string, string> = {};
    issueItems.forEach((i: any) => {
      requirementByIssue[i.id] = (i.itemId && requirementMap[i.itemId]) || '';
    });

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('风险分析');
    const columns = [
      { header: '序号', key: 'index', width: 7 },
      { header: '问题描述', key: 'issueTitle', width: 34 },
      { header: '安全域', key: 'securityDomain', width: 18 },
      { header: '测评对象', key: 'assetName', width: 18 },
      { header: '控制点', key: 'controlPoint', width: 16 },
      { header: '测评项', key: 'controlName', width: 40 },
      { header: '初判等级', key: 'riskLevel', width: 12 },
      { header: '问题分析', key: 'result', width: 52 },
    ];
    worksheet.columns = columns as ExcelJS.Column[];
    const headerRow = worksheet.getRow(1);
    headerRow.eachCell(cell => {
      styleCell(cell, { bold: true, fontSize: 12, fontColor: 'FFFFFFFF', bgColor: 'FF409EFF', alignH: 'center', alignV: 'middle', border: 'medium' });
    });
    headerRow.height = 28;

    rows.forEach((r, index) => {
      const row = worksheet.addRow({
        index: index + 1,
        issueTitle: r.issueTitle,
        securityDomain: r.securityDomain,
        assetName: r.assetName || '-',
        controlPoint: r.controlPoint,
        controlName: requirementByIssue[r.issueId] || r.controlName,
        riskLevel: `${LEVEL_LABEL[r.riskLevel]}风险`,
        result: r.result || '',
      });
      row.height = getRowMaxHeight(row, columns.map((_, i) => i + 1), worksheet);
      row.eachCell((cell, colNumber) => {
        styleCell(cell, {
          bgColor: index % 2 === 1 ? 'FFF7F9FC' : undefined,
          alignH: [1, 7].includes(colNumber) ? 'center' : 'left',
          alignV: 'middle',
          border: 'thin',
        });
      });
    });

    const result = await dialog.showSaveDialog({
      defaultPath: `${projectName}_风险分析_${new Date().toISOString().slice(0, 10).replace(/-/g, '')}.xlsx`,
      filters: [{ name: 'Excel文件', extensions: ['xlsx'] }],
    });
    if (result.canceled || !result.filePath) throw new Error('用户取消');
    await workbook.xlsx.writeFile(result.filePath);
    return result.filePath;
  }, { moduleName: 'riskAnalysis' }));

}
