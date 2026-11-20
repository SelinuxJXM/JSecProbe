import * as path from 'path';
import * as fs from 'fs';
import { getDb } from '../db';
import * as schema from '../db/schema';
import { eq, asc } from 'drizzle-orm';
import log from 'electron-log';
import { decryptSecret } from './credential.util';
import { ensureApiUrl } from './ai-url';
import { toAbsolutePath } from '../utils/path-resolver';
import { parseTopologyDoc } from '../../shared/topology-domain-text';

/**
 * HTML 转义：报告 HTML 由模板字符串手工拼接，项目名/单位名/问题描述等
 * 用户可控字段直接插值会在含 `<`、`&` 时破坏封面与表格渲染（并构成注入面）。
 * 仅用于 HTML 版报告；Word 版走 docx 库的对象模型，天然安全，不应使用本函数。
 */
function escapeHtml(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function decryptApiKey(stored: string): string {
  const result = decryptSecret(stored);
  if (!result && stored && (stored.startsWith('enc:v1:') || stored.startsWith('enc:'))) {
    log.error('[报告AI] 解密 API Key 失败（密文可能损坏或系统凭据变更）');
  }
  return result;
}

/**
 * 报告「4.3 风险分析」用的行视图。
 * 风险分析是问题清单式的：每条问题只填一段「分析结果」（可能导致XXXX的风险），
 * 存在 issues 行的 risk_consequence 列（复用 0005 迁移已有列）；问题初判等级取
 * issues.risk_level。gatherReportData 取到的 issues 已自带这些字段，Word / HTML
 * 两条链都直接从 problems 列表提取，不影响单系统报告与项目合册的既有取数逻辑。
 */
interface ReportRiskItem {
  title: string;
  controlName: string;
  level: string;
  result: string;
}

function collectRiskAnalysis(issues: any[]): ReportRiskItem[] {
  const LEVEL_TEXT: Record<string, string> = { high: '高', medium: '中', low: '低' };
  return (issues || [])
    // 只以分析内容为准：历史/导入数据可能只有 consequence 没有 analyzedAt，不应整段漏出报告
    .filter((i: any) => !!String(i.riskConsequence || '').trim())
    .map((i: any) => ({
      title: String(i.issueTitle || ''),
      controlName: String(i.controlName || ''),
      level: LEVEL_TEXT[i.riskLevel] || '—',
      result: String(i.riskConsequence || ''),
    }));
}

/**
 * 报告「重大风险隐患识别与分析」用的行视图。
 * 一条问题对应一份分析：三要素各一段 + 最终判定，命中清单条目名一并带上。
 * 只纳入 verdict 为 major / non_major 的已判定条目；pending 不进报告。
 */
interface ReportMajorRiskItem {
  title: string;
  catalogTitle: string;
  relevance: string;
  severity: string;
  frequency: string;
  verdictText: string;
  conclusion: string;
}

function collectMajorRisk(issues: any[], analyses: any[]): ReportMajorRiskItem[] {
  const byIssue = new Map<string, any>();
  for (const a of analyses || []) byIssue.set(a.issueId, a);
  const VERDICT_TEXT: Record<string, string> = { major: '属于重大风险隐患', non_major: '不属于', pending: '—' };
  const items: ReportMajorRiskItem[] = [];
  for (const issue of issues || []) {
    const a = byIssue.get(issue.id);
    if (!a || (a.verdict !== 'major' && a.verdict !== 'non_major')) continue;
    items.push({
      title: String(issue.issueTitle || ''),
      catalogTitle: String(a.catalogTitle || '未命中清单条目'),
      relevance: String(a.relevance || ''),
      severity: String(a.severity || ''),
      frequency: String(a.frequency || ''),
      verdictText: VERDICT_TEXT[a.verdict] || '—',
      conclusion: String(a.conclusion || ''),
    });
  }
  return items;
}
import {
  Document,
  Paragraph,
  TextRun,
  Table,
  TableRow,
  TableCell,
  AlignmentType,
  HeadingLevel,
  PageBreak,
  Header,
  Footer,
  PageNumber,
  TabStopPosition,
  TabStopType,
  WidthType,
  ShadingType,
  VerticalAlign,
  Packer,
  ImageRun,
} from 'docx';
import { getMainWindow } from '../main';
import { ASSET_CATEGORY_NAMES } from '../utils/excel-config';
import { getPromptTemplate, renderTemplate } from './ai-prompt.service';
import { computeAssessmentProgress } from './assessment-progress';

// 字体配置常量
const FONT_CN = 'STFangsong';
const FONT_EN = 'Times New Roman';

// 字号常量（半磅值）
const SIZE_BODY = 24;      // 12pt
const SIZE_HEADING1 = 36;  // 18pt
const SIZE_HEADING2 = 30;  // 15pt
const SIZE_HEADING3 = 26;  // 13pt
const SIZE_SMALL = 22;     // 11pt
const SIZE_TABLE = 20;     // 10pt

// 行距常量（twips）
const LINE_SPACING = 360;  // 1.5倍行距
const INDENT_FIRST_LINE = 480;  // 首行缩进2字符

/**
 * 创建中西文混合字体的 TextRun
 * 中文使用华文仿宋，英文和数字使用 Times New Roman
 */
function createMixedFontRun(text: string, options: {
  size?: number;
  bold?: boolean;
  color?: string;
  italics?: boolean;
}): TextRun {
  return new TextRun({
    text,
    size: options.size ?? SIZE_BODY,
    bold: options.bold,
    color: options.color,
    italics: options.italics,
    font: {
      ascii: FONT_EN,
      hAnsi: FONT_EN,
      eastAsia: FONT_CN,
      cs: FONT_EN,
      hint: 'default',
    },
  });
}

/**
 * 创建正文段落（带首行缩进）
 */
function createBodyParagraph(options: {
  text: string;
  size?: number;
  bold?: boolean;
  spacingBefore?: number;
  spacingAfter?: number;
  alignment?: (typeof AlignmentType)[keyof typeof AlignmentType];
}): Paragraph {
  return new Paragraph({
    alignment: options.alignment,
    spacing: {
      line: LINE_SPACING,
      before: options.spacingBefore,
      after: options.spacingAfter,
    },
    indent: {
      firstLine: INDENT_FIRST_LINE,
    },
    children: [
      createMixedFontRun(options.text, {
        size: options.size,
        bold: options.bold,
      }),
    ],
  });
}

/**
 * * 创建标题段落（无首行缩进，段前段后间距1.5倍行距）
 */
function createHeadingParagraph(options: {
  text: string;
  level: 'heading1' | 'heading2' | 'heading3';
  spacingBefore?: number;
}): Paragraph {
  const sizeMap = {
    heading1: SIZE_HEADING1,
    heading2: SIZE_HEADING2,
    heading3: SIZE_HEADING3,
  };

  const headingMap = {
    heading1: HeadingLevel.HEADING_1,
    heading2: HeadingLevel.HEADING_2,
    heading3: HeadingLevel.HEADING_3,
  };

  return new Paragraph({
    heading: headingMap[options.level],
    spacing: {
      line: LINE_SPACING,
      before: options.spacingBefore ?? LINE_SPACING,
      after: LINE_SPACING,
    },
    children: [
      createMixedFontRun(options.text, {
        size: sizeMap[options.level],
        bold: true,
      }),
    ],
  });
}

/**
 * * 创建表格单元格内的 TextRun（无首行缩进）
 */
function createTableTextRun(text: string, options: {
  size?: number;
  bold?: boolean;
  color?: string;
} = {}): TextRun {
  return createMixedFontRun(text, {
    size: options.size ?? SIZE_TABLE,
    bold: options.bold,
    color: options.color,
  });
}

/**
 * * 创建表格单元格段落（无首行缩进，1.5倍行距）
 */
function createTableParagraph(text: string, options: {
  size?: number;
  bold?: boolean;
  color?: string;
  alignment?: (typeof AlignmentType)[keyof typeof AlignmentType];
} = {}): Paragraph {
  return new Paragraph({
    alignment: options.alignment,
    spacing: { line: LINE_SPACING },
    children: [createTableTextRun(text, options)],
  });
}

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

interface ReportOptions {
  format: 'pdf' | 'docx';
  template: 'standard' | 'detailed' | 'simple';
  includeSections: string[];
  projectId: string;
  savePath: string;
  // AI 增强：用 AI 生成「总体分析评价」和「整改建议及规划」章节内容
  aiEnhanced?: boolean;
}

/**
 * 项目级合册报告参数：以「项目分组」为单位，把项目综述与其下每个系统的分册
 * 装订成一份文档。groupId 对应 project_groups.id（projects.group_id）。
 */
export interface ProjectReportOptions {
  format: 'pdf' | 'docx';
  template: 'standard' | 'detailed' | 'simple';
  includeSections: string[];
  groupId: string;
  savePath: string;
  // AI 增强会逐分册调用（每个系统各一次），系统较多时耗时明显增加
  aiEnhanced?: boolean;
}

/** 合册取数结果：分组台账 + 名下全部系统的单系统报告数据 */
interface ProjectReportData {
  group: any;
  systems: ReportData[];
}

interface ReportData {
  project: any;
  issues: any[];
  /** 重大风险隐患分析结论（按 issueId 索引），供「重大风险隐患识别与分析」章节使用 */
  majorRiskAnalyses: any[];
  summary: any;
  assets: any[];
  assessmentStats: any;
  // 动态域 ID→名称映射（按项目 standardId 加载，fallback 国标十域）
  domainNameMap: Record<string, string>;
  // 标准元信息（用于报告标题/概述/徽标，动态避免硬编码国标代号）
  standard: {
    id: string;
    name: string;
    code: string;                 // 标准代号：如 GB/T 22239-2019 / DL/T 36572-2018 / JR/T 0071-2020
    standardType: 'national' | 'industry' | string;
    industry?: string;            // 行业：电力/金融/医疗（standardType=industry 时填）
    // 行业配色（用于报告行业徽标）
    badgeColor: string;           // 十六进制
    badgeLabel: string;           // 徽标短名：GB / 电力 / 金融
    domainCount: number;          // 实际域数（行标含行业特色域，可能>10）
    domainNamesIncluded: string;  // 列举域名，用于概述文本（逗号分隔）
  };
}

// 行业色板（报告行业徽标配色），未知行业 fallback 通用灰色
const INDUSTRY_COLORS: Record<string, { color: string; label: string }> = {
  电力: { color: 'FF8A3D', label: '电力' },   // 电力橙
  金融: { color: '1F5FB8', label: '金融' },   // 金融深蓝
  医疗: { color: '12B6A3', label: '医疗' },   // 医疗青
  电信: { color: '3A72F0', label: '电信' },   // 电信蓝
  政务: { color: 'B83030', label: '政务' },   // 政务红
};

function getStandardBadge(std: any | undefined): { color: string; label: string } {
  if (std?.standardType === 'industry' && std?.industry) {
    const ind = String(std.industry);
    if (INDUSTRY_COLORS[ind]) return INDUSTRY_COLORS[ind];
    return { color: '6B7280', label: ind.slice(0, 4) || '行标' };
  }
  if (std?.code || std?.name) {
    // 非行标（国标/地标/企标）但有元信息 → 国标绿
    return { color: '16A34A', label: 'GB' };
  }
  // 标准被删除 / 老项目无 standardId → 灰色占位，避免误导显示 GB
  return { color: '9CA3AF', label: '未绑定' };
}

// === 工具：为报告统一解析「有效」standardId（移除硬编码 gb-t-22239-2019-l3，兼容老项目/被删标准）===
// 返回 { standardId: string; stdRow: any | null }
//  1) project.standardId 合法且 DB 存在 → 直接用；
//  2) project.standardId 存在但 DB 找不到（标准被删）→ 走兜底；
//  3) 兜底优先级：同 grade（取项目 level）→ isDefault → 列表首条；
//  4) 仍没 → 返回 standardId='', stdRow=null；后续流程按「未绑定标准」安全降级（counts=0）。
async function resolveStandardForReport(db: ReturnType<typeof getDb>, project: any): Promise<{ standardId: string; stdRow: any | null }> {
  const level = Number(project?.level) || 3;
  const raw = typeof project?.standardId === 'string' ? project.standardId.trim() : '';
  const all = await db
    .select({
      id: schema.standards.id,
      grade: schema.standards.grade,
      isDefault: schema.standards.isDefault,
      name: schema.standards.name,
      code: schema.standards.code,
      standardType: schema.standards.standardType,
      industry: schema.standards.industry,
      domainsMeta: schema.standards.domainsMeta,
    })
    .from(schema.standards);
  let chosen = raw ? all.find(s => s.id === raw) : undefined;
  if (!chosen && all.length > 0) {
    const sameGrade = all.find(s => Number(s.grade) === level);
    const def = all.find(s => Number(s.isDefault) === 1);
    chosen = sameGrade || def || all[0];
  }
  if (chosen) return { standardId: chosen.id, stdRow: chosen };
  return { standardId: '', stdRow: null };
}

export class ReportService {
  async generateReport(options: ReportOptions): Promise<string> {
    const data = await this.gatherReportData(options.projectId);
    
    const outputDir = path.dirname(options.savePath);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const projectName = data.project?.name || '未知项目';
    const timestamp = new Date().toISOString().slice(0, 10);

    if (options.format === 'docx') {
      return this.generateWordReport(data, options.savePath, projectName, timestamp, options);
    } else {
      return this.generatePdfReport(data, options.savePath, projectName, timestamp, options);
    }
  }

  /**
   * 生成项目级合册报告：项目综述 + 各系统分册装订成一份文档。
   *
   * 与 generateReport 完全独立的入口 —— 单系统报告的取数、模板与渲染逻辑一律不动，
   * 这里只负责「按分组取到 N 份 ReportData」再交给两条合册渲染链。
   */
  async generateProjectReport(options: ProjectReportOptions): Promise<string> {
    const reportData = await this.gatherProjectReportData(options.groupId);

    const outputDir = path.dirname(options.savePath);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const projectName = reportData.group?.name || '未知项目';
    const timestamp = new Date().toISOString().slice(0, 10);

    log.info(
      `[项目合册报告] 开始生成: ${projectName}，${reportData.systems.length} 个分册，` +
      `格式 ${options.format}${options.aiEnhanced ? '（AI 增强，逐分册调用）' : ''}`
    );

    if (options.format === 'docx') {
      return this.generateProjectWordReport(reportData, options.savePath, projectName, timestamp, options);
    }
    return this.generateProjectPdfReport(reportData, options.savePath, projectName, timestamp, options);
  }

  /** 按分组取台账 + 名下全部系统的单系统报告数据（全量，不受列表分页/筛选影响） */
  private async gatherProjectReportData(groupId: string): Promise<ProjectReportData> {
    const db = getDb();
    const [group] = await db
      .select()
      .from(schema.projectGroups)
      .where(eq(schema.projectGroups.id, groupId))
      .limit(1);
    if (!group) {
      throw new Error('项目不存在或已被删除');
    }

    // 按创建时间升序，保证分册顺序稳定；归档系统同样纳入（合册是交付物，不做隐式过滤）
    const systemRows = await db
      .select({ id: schema.projects.id })
      .from(schema.projects)
      .where(eq(schema.projects.groupId, groupId))
      .orderBy(asc(schema.projects.createdAt));
    if (systemRows.length === 0) {
      throw new Error('该项目下暂无系统，请先在「系统列表」创建系统后再生成合册报告');
    }

    const systems: ReportData[] = [];
    for (const row of systemRows) {
      systems.push(await this.gatherReportData(row.id));
    }
    return { group, systems };
  }

  // 按项目 standardId 加载域 ID→名称映射
  // 优先 standards.domains_meta，fallback 模块级 DOMAIN_ID_TO_NAME（国标十域）
  private async loadDomainNameMap(standardId: string): Promise<Record<string, string>> {
    const result: Record<string, string> = { ...DOMAIN_ID_TO_NAME };
    try {
      const db = getDb();
      const [std] = await db.select().from(schema.standards).where(eq(schema.standards.id, standardId)).limit(1);
      if (std?.domainsMeta) {
        try {
          const arr = JSON.parse(std.domainsMeta);
          if (Array.isArray(arr)) {
            for (const d of arr) {
              if (d?.id) result[d.id] = d.name || d.id;
            }
          }
        } catch { /* domainsMeta 解析失败用 fallback */ }
      }
    } catch { /* 查询失败用 fallback */ }
    return result;
  }

  private async gatherReportData(projectId: string): Promise<ReportData> {
    const db = getDb();

    const projectResult = await db.select().from(schema.projects).where(eq(schema.projects.id, projectId)).limit(1);
    const project = projectResult[0];

    // 统一按项目 & 当前 DB 解析 standard（老项目无 standardId / 标准被删 → 动态兜底；都没则空串安全降级）
    const { standardId, stdRow } = project ? await resolveStandardForReport(db, project) : { standardId: '', stdRow: null };
    const domainNameMap = await this.loadDomainNameMap(standardId);

    // 改造：标准完整元信息优先使用 resolveStandardForReport 的 stdRow（减少一次重复查询）
    const badge = getStandardBadge(stdRow || undefined);
    // 域名列举（用于概述文本：行标可能>10域，顺序按 domainsMeta，不在映射中的则用 fallback 顺序）
    const domainNameList = (() => {
      const list: string[] = [];
      // 优先 domainsMeta 中自然顺序
      if (stdRow?.domainsMeta) {
        try {
          const arr = JSON.parse(stdRow.domainsMeta);
          if (Array.isArray(arr)) {
            for (const d of arr) if (d?.name) list.push(d.name);
          }
        } catch { /* ignore */ }
      }
      // fallback：从 domainNameMap 收集（若 domainsMeta 缺失）
      if (list.length === 0) {
        for (const name of Object.values(domainNameMap)) if (name) list.push(name);
      }
      return Array.from(new Set(list)); // 去重保序
    })();

    const standard = {
      id: standardId,
      // 无标准时不要硬编码 GB/T 22239 误导
      name: stdRow?.name || (standardId ? '（标准元信息缺失）' : '（未绑定标准库）'),
      code: stdRow?.code || (standardId ? 'N/A' : 'UNBOUND'),
      standardType: (stdRow?.standardType as any) || (standardId ? 'national' : 'unknown'),
      industry: stdRow?.industry || undefined,
      badgeColor: badge.color,
      badgeLabel: badge.label,
      domainCount: Number(stdRow?.domainCount) || domainNameList.length || 0,
      domainNamesIncluded: domainNameList.join('、'),
    };

    const issues = await db.select().from(schema.issues).where(eq(schema.issues.projectId, projectId));

    // 重大风险隐患分析结论：与 issues 同源按项目取，报告章节据此筛选已判定条目
    const majorRiskAnalyses = await db.select().from(schema.majorRiskAnalysis)
      .where(eq(schema.majorRiskAnalysis.projectId, projectId));

    // 风险等级为字符串枚举（high/medium/low），数据库按字典序排序会得到 medium > low > high，
    // 导致高风险问题被排到列表底部。改为按风险权重在内存中降序排序，确保高风险置顶。
    const RISK_WEIGHT: Record<string, number> = { high: 3, medium: 2, low: 1 };
    issues.sort((a: any, b: any) => (RISK_WEIGHT[b.riskLevel] ?? 0) - (RISK_WEIGHT[a.riskLevel] ?? 0));

    const assets = await db.select().from(schema.assets).where(eq(schema.assets.projectId, projectId));

    const totalIssues = issues.length;
    const highRisk = issues.filter((i: any) => i.riskLevel === 'high').length;
    const mediumRisk = issues.filter((i: any) => i.riskLevel === 'medium').length;
    const lowRisk = issues.filter((i: any) => i.riskLevel === 'low').length;
    const pending = issues.filter((i: any) => i.status === 'pending').length;
    const rectifying = issues.filter((i: any) => i.status === 'rectifying').length;
    const resolved = issues.filter((i: any) => i.status === 'resolved').length;
    const closed = issues.filter((i: any) => i.status === 'closed').length;

    const domainCounts: Record<string, number> = {};
    // 4.2 表里的「风险等级」取该域下问题的真实最高等级，不再按问题条数臆断
    const DOMAIN_RISK_WEIGHT: Record<string, number> = { high: 3, medium: 2, low: 1 };
    const domainRisk: Record<string, string> = {};
    for (const issue of issues) {
      const name = domainNameMap[issue.securityDomain] || issue.securityDomain;
      domainCounts[name] = (domainCounts[name] || 0) + 1;
      const w = DOMAIN_RISK_WEIGHT[issue.riskLevel] || 0;
      const prev = domainRisk[name];
      if (!prev || w > (DOMAIN_RISK_WEIGHT[prev] || 0)) domainRisk[name] = issue.riskLevel || 'low';
    }
    const domainStats = Object.entries(domainCounts).map(([name, count]) => ({
      name, count, maxRiskLevel: domainRisk[name] || 'low',
    }));

    // 全部测评统计统一走 services/assessment-progress（格内口径），与问题清单页、
    // 现场核查页、合册符合率完全同源。此前报告同时算 getAssessmentStats（动态域名映射、
    // 无格内校验）和 progress，导致同一报告里"符合 150 项"与"符合率 87%"分母对不上。
    const progress = await computeAssessmentProgress(projectId, standardId);
    const assessmentStats = {
      total: progress.total,
      tested: progress.tested,
      compliant: progress.compliant,
      partial: progress.partial,
      nonCompliant: progress.nonCompliant,
      notApplicable: progress.na, // progress 里叫 na，报告文字用 notApplicable
      untested: progress.untested,
    };

    return {
      project,
      issues,
      majorRiskAnalyses,
      summary: {
        total: totalIssues,
        highRisk,
        mediumRisk,
        lowRisk,
        pending,
        rectifying,
        resolved,
        closed,
        complianceRate: progress.complianceRate,
        domainStats,
      },
      assets,
      assessmentStats,
      domainNameMap,
      standard,
    };
  }

  private async generateWordReport(
    data: ReportData,
    savePath: string,
    _projectName: string,
    timestamp: string,
    options: ReportOptions
  ): Promise<string> {
    const children = await this.buildWordContent(data, options.template, timestamp, options);
    return this.packWordDocument(children, savePath);
  }

  /**
   * 把段落/表格数组打包成 docx 文件。单系统报告与项目合册共用同一套字体、页眉页脚，
   * 页脚的 PageNumber.TOTAL_PAGES 因此覆盖整册，装订后页码连续、不按分册重置。
   */
  private async packWordDocument(children: (Paragraph | Table)[], savePath: string): Promise<string> {
    const doc = new Document({
      styles: {
        default: {
          document: {
            run: {
              font: {
                ascii: FONT_EN,
                hAnsi: FONT_EN,
                eastAsia: FONT_CN,
                cs: FONT_EN,
                hint: 'default',
              },
              size: SIZE_BODY,
            },
            paragraph: {
              spacing: { line: LINE_SPACING },
              indent: { firstLine: INDENT_FIRST_LINE },
            },
          },
          heading1: {
            run: {
              font: {
                ascii: FONT_EN,
                hAnsi: FONT_EN,
                eastAsia: FONT_CN,
                cs: FONT_EN,
                hint: 'default',
              },
              size: SIZE_HEADING1,
              bold: true,
            },
            paragraph: {
              spacing: { before: LINE_SPACING, after: LINE_SPACING, line: LINE_SPACING },
            },
          },
          heading2: {
            run: {
              font: {
                ascii: FONT_EN,
                hAnsi: FONT_EN,
                eastAsia: FONT_CN,
                cs: FONT_EN,
                hint: 'default',
              },
              size: SIZE_HEADING2,
              bold: true,
            },
            paragraph: {
              spacing: { before: LINE_SPACING, after: LINE_SPACING, line: LINE_SPACING },
            },
          },
          heading3: {
            run: {
              font: {
                ascii: FONT_EN,
                hAnsi: FONT_EN,
                eastAsia: FONT_CN,
                cs: FONT_EN,
                hint: 'default',
              },
              size: SIZE_HEADING3,
              bold: true,
            },
            paragraph: {
              spacing: { before: LINE_SPACING, after: LINE_SPACING, line: LINE_SPACING },
            },
          },
        },
      },
      sections: [
        {
          properties: {
            page: {
              margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
            },
          },
          headers: {
            default: new Header({
              children: [
                new Paragraph({
                  alignment: AlignmentType.CENTER,
                  spacing: { line: LINE_SPACING },
                  children: [
                    new TextRun({
                      text: '等级保护现场测评结果分析报告',
                      font: {
                        ascii: FONT_EN,
                        hAnsi: FONT_EN,
                        eastAsia: FONT_CN,
                        cs: FONT_EN,
                        hint: 'default',
                      },
                      size: 18,
                      color: '999999',
                    }),
                  ],
                }),
              ],
            }),
          },
          footers: {
            default: new Footer({
              children: [
                new Paragraph({
                  alignment: AlignmentType.CENTER,
                  spacing: { line: LINE_SPACING },
                  children: [
                    new TextRun({
                      text: '第 ',
                      font: {
                        ascii: FONT_EN,
                        hAnsi: FONT_EN,
                        eastAsia: FONT_CN,
                        cs: FONT_EN,
                        hint: 'default',
                      },
                      size: 18,
                    }),
                    new TextRun({
                      children: [PageNumber.CURRENT],
                      font: {
                        ascii: FONT_EN,
                        hAnsi: FONT_EN,
                        eastAsia: FONT_CN,
                        cs: FONT_EN,
                        hint: 'default',
                      },
                      size: 18,
                    }),
                    new TextRun({
                      text: ' 页 / 共 ',
                      font: {
                        ascii: FONT_EN,
                        hAnsi: FONT_EN,
                        eastAsia: FONT_CN,
                        cs: FONT_EN,
                        hint: 'default',
                      },
                      size: 18,
                    }),
                    new TextRun({
                      children: [PageNumber.TOTAL_PAGES],
                      font: {
                        ascii: FONT_EN,
                        hAnsi: FONT_EN,
                        eastAsia: FONT_CN,
                        cs: FONT_EN,
                        hint: 'default',
                      },
                      size: 18,
                    }),
                    new TextRun({
                      text: ' 页',
                      font: {
                        ascii: FONT_EN,
                        hAnsi: FONT_EN,
                        eastAsia: FONT_CN,
                        cs: FONT_EN,
                        hint: 'default',
                      },
                      size: 18,
                    }),
                  ],
                }),
              ],
            }),
          },
          children,
        },
      ],
    });

    const buffer = await Packer.toBuffer(doc);
    fs.writeFileSync(savePath, buffer);
    return savePath;
  }

  private async generateProjectWordReport(
    data: ProjectReportData,
    savePath: string,
    projectName: string,
    timestamp: string,
    options: ProjectReportOptions
  ): Promise<string> {
    const children = await this.buildProjectWordContent(data, projectName, timestamp, options);
    const out = await this.packWordDocument(children, savePath);
    log.info(`[项目合册报告] Word 合册已生成: ${out}`);
    return out;
  }

  /** 跨系统汇总口径：项目综述的表格与结论文字共用这一份聚合结果 */
  private aggregateProjectSummary(systems: ReportData[]): {
    assets: number;
    assessmentTotal: number;
    avgComplianceRate: number;
    highRisk: number;
    mediumRisk: number;
    lowRisk: number;
    issues: number;
    narrative: string;
  } {
    let assets = 0;
    let assessmentTotal = 0;
    let highRisk = 0;
    let mediumRisk = 0;
    let lowRisk = 0;
    let issues = 0;
    let compliantSum = 0;
    let testedSum = 0; // 有效判定数 = 符合 + 部分符合 + 不符合（与单系统 complianceRate 的分母同口径）
    for (const s of systems) {
      assets += s.assets?.length ?? 0;
      assessmentTotal += Number(s.assessmentStats?.total) || 0;
      highRisk += Number(s.summary?.highRisk) || 0;
      mediumRisk += Number(s.summary?.mediumRisk) || 0;
      lowRisk += Number(s.summary?.lowRisk) || 0;
      issues += Number(s.summary?.total) || 0;
      const compliant = Number(s.assessmentStats?.compliant) || 0;
      const partial = Number(s.assessmentStats?.partial) || 0;
      const nonCompliant = Number(s.assessmentStats?.nonCompliant) || 0;
      compliantSum += compliant;
      testedSum += compliant + partial + nonCompliant;
    }
    // 按测评项数加权，而非各系统符合率的算术平均：
    // 1000 项 10% + 10 项 100% 不能再显示成 55%
    const avgComplianceRate = testedSum > 0
      ? Math.round((compliantSum / testedSum) * 1000) / 10
      : 0;

    const riskRank = systems
      .map((s, i) => ({
        name: s.project?.systemName || s.project?.name || `系统 ${i + 1}`,
        total: Number(s.summary?.total) || 0,
      }))
      .sort((a, b) => b.total - a.total);
    const worst = riskRank[0];
    const worstText = worst && worst.total > 0
      ? `其中「${worst.name}」的问题数最多（${worst.total} 个），`
      : '';

    const narrative =
      `本项目共纳入 ${systems.length} 个被测系统，累计登记资产 ${assets} 台/套，` +
      `覆盖测评项 ${assessmentTotal} 项，各系统平均符合率 ${avgComplianceRate}%。` +
      `本次测评共发现安全问题 ${issues} 个，其中高风险 ${highRisk} 个、中风险 ${mediumRisk} 个、` +
      `低风险 ${lowRisk} 个。${worstText}` +
      `建议优先对高风险问题开展整改并复测，中风险问题限期闭环，低风险问题纳入日常运维持续改进。` +
      `各系统详细的测评结果、问题清单与整改建议见后续分册。`;

    return { assets, assessmentTotal, avgComplianceRate, highRisk, mediumRisk, lowRisk, issues, narrative };
  }

  /** 项目状态中文名（合册综述表格用） */
  private projectStatusLabel(status: unknown): string {
    const map: Record<string, string> = {
      draft: '草稿',
      in_progress: '进行中',
      active: '进行中',
      completed: '已完成',
      archived: '已归档',
    };
    return map[String(status || '')] || String(status || '-');
  }

  /** 合册 Word 正文：总封面 → 总目录 → 项目综述 → 各分册（扉页 + 正文） */
  private async buildProjectWordContent(
    data: ProjectReportData,
    _projectName: string,
    timestamp: string,
    options: ProjectReportOptions
  ): Promise<(Paragraph | Table)[]> {
    const content: (Paragraph | Table)[] = [];
    const { group, systems } = data;
    const agg = this.aggregateProjectSummary(systems);

    // 封面 / 扉页用的居中文字段落
    const centered = (text: string, size: number, opts: { bold?: boolean; italics?: boolean; before?: number; after?: number } = {}) =>
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: opts.before ?? 0, after: opts.after ?? 200 },
        indent: { left: 0, right: 0 },
        children: [createMixedFontRun(text, { size, bold: opts.bold, italics: opts.italics })],
      });

    // ===== 总封面（受 includeSections 控制，与单系统报告一致） =====
    if (options.includeSections.includes('cover')) {
    content.push(centered('等级保护测评项目综合报告', 56, { bold: true, before: 1800, after: 400 }));
    content.push(centered('Level Protection Assessment Project Report', 28, { italics: true, after: 500 }));
    const coverInfos = [
      `项目名称：${group?.name || '-'}`,
      `项目编号：${group?.projectNo || '-'}`,
      `被测单位：${group?.assessedUnit || '-'}`,
      `测评周期：${group?.startDate || '-'} 至 ${group?.endDate || '-'}`,
      `系统数量：${systems.length} 个`,
      `报告日期：${timestamp}`,
    ];
    for (const info of coverInfos) content.push(centered(info, 28));
    content.push(new Paragraph({ children: [new PageBreak()] }));
    }

    // ===== 总目录（受 includeSections 控制） =====
    if (options.includeSections.includes('toc')) {
    content.push(createHeadingParagraph({ text: '目  录', level: 'heading1' }));
    const tocLine = (text: string, indent = 0) =>
      new Paragraph({
        spacing: { before: 100, after: 100, line: LINE_SPACING },
        indent: { left: indent },
        tabStops: [{ type: TabStopType.RIGHT, position: TabStopPosition.MAX }],
        children: [createMixedFontRun(text, {})],
      });
    content.push(tocLine('一、项目综述'));
    content.push(tocLine('二、系统分册'));
    systems.forEach((s, i) => {
      const name = s.project?.systemName || s.project?.name || `系统 ${i + 1}`;
      content.push(tocLine(`第 ${i + 1} 分册　${name}（第 ${s.project?.level || '-'} 级 · ${s.standard.code}）`, 480));
    });
    content.push(new Paragraph({ children: [new PageBreak()] }));
    }

    // ===== 一、项目综述 =====
    content.push(createHeadingParagraph({ text: '一、项目综述', level: 'heading1' }));
    content.push(createHeadingParagraph({ text: '1.1 项目基本信息', level: 'heading2' }));
    content.push(
      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: [
          this.createTableRow('项目名称', group?.name || '-', '项目编号', group?.projectNo || '-'),
          this.createTableRow('被测单位', group?.assessedUnit || '-', '客户名称', group?.customerName || '-'),
          this.createTableRow('测评负责人', group?.assessor || '-', '测评周期', `${group?.startDate || '-'} 至 ${group?.endDate || '-'}`),
          this.createTableRow('项目状态', this.projectStatusLabel(group?.status), '系统数量', `${systems.length} 个`),
        ],
      })
    );
    if (group?.description) {
      content.push(createBodyParagraph({ text: `项目说明：${group.description}`, spacingAfter: 200 }));
    }

    content.push(createHeadingParagraph({ text: '1.2 系统构成与测评概况', level: 'heading2' }));
    const overviewRows: TableRow[] = [
      this.createHeaderRow('序号', '系统名称', '等级', '测评标准', '资产数', '测评项', '符合率'),
    ];
    systems.forEach((s, i) => {
      overviewRows.push(
        this.createTableRow(
          String(i + 1),
          s.project?.systemName || s.project?.name || '-',
          `第 ${s.project?.level || '-'} 级`,
          s.standard.code,
          `${s.assets?.length ?? 0}`,
          `${Number(s.assessmentStats?.total) || 0}`,
          `${Number(s.summary?.complianceRate) || 0}%`
        )
      );
    });
    overviewRows.push(
      this.createTableRow('合计', '—', '—', '—', `${agg.assets}`, `${agg.assessmentTotal}`, `${agg.avgComplianceRate}%`)
    );
    content.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: overviewRows }));

    // 系统拓扑与分区分域：按被测系统插入 AI 识别的多段描述与拓扑图（无数据则跳过）
    for (let si = 0; si < systems.length; si++) {
      const s = systems[si];
      const desc = String(s.project?.topologyDescription || '').trim();
      let attachments: Array<{ name: string; path: string; size: number }> = [];
      try { attachments = JSON.parse(s.project?.topologyAttachments || '[]'); } catch { attachments = []; }
      if (!desc && attachments.length === 0) continue;

      const sysName = s.project?.systemName || s.project?.name || `系统 ${si + 1}`;
      content.push(createHeadingParagraph({ text: `1.2.${si + 1} ${sysName} 网络拓扑与分区分域`, level: 'heading3' }));

      // 与前端共用同一套解析，确保"存的=看的=报告的"：先总述，再各域（正文按行分条）
      if (desc) {
        const topo = parseTopologyDoc(desc);
        if (topo.overview) content.push(createBodyParagraph({ text: topo.overview, spacingAfter: 120 }));
        for (const d of topo.domains) {
          content.push(createBodyParagraph({ text: `${d.name}：`, spacingAfter: 60 }));
          for (const line of d.description.split('\n').map(l => l.trim()).filter(Boolean)) {
            content.push(createBodyParagraph({ text: line, spacingAfter: 60 }));
          }
        }
      }

      // 拓扑图插图：受管相对路径 → 绝对路径 → ImageRun；单张宽 15cm
      for (const att of attachments) {
        try {
          const abs = await toAbsolutePath(att.path);
          if (!fs.existsSync(abs)) { log.warn('[报告] 拓扑图不存在:', abs); continue; }
          const buf = fs.readFileSync(abs);
          const ext = path.extname(abs).toLowerCase().replace('.', '');
          // docx 的 ImageRun 仅接受 svg/png/jpg/gif/bmp：jpeg 归一为 jpg，webp 无法直接嵌入则跳过
          if (ext === 'webp') {
            log.warn('[报告] WebP 拓扑图无法直接嵌入 Word，请转存为 PNG/JPG:', att.name);
            continue;
          }
          const type = (['png', 'jpg', 'gif', 'bmp'].includes(ext) ? ext : ext === 'jpeg' ? 'jpg' : 'png') as 'png' | 'jpg' | 'gif' | 'bmp';
          content.push(new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { before: 120, after: 120 },
            children: [new ImageRun({
              type,
              data: buf,
              transformation: { width: 560, height: 360 },
              altText: { title: sysName, description: att.name, name: att.name },
            })],
          }));
          content.push(new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { after: 160 },
            children: [new TextRun({ text: `图：${sysName} 网络拓扑图（${att.name}）`, size: 20, color: '666666' })],
          }));
        } catch (e: any) {
          log.warn('[报告] 拓扑图插入失败:', att.name, e.message);
        }
      }
    }

    content.push(createHeadingParagraph({ text: '1.3 问题分布与综合评价', level: 'heading2' }));
    const riskRows: TableRow[] = [
      this.createHeaderRow('序号', '系统名称', '高风险', '中风险', '低风险', '合计'),
    ];
    systems.forEach((s, i) => {
      riskRows.push(
        this.createTableRow(
          String(i + 1),
          s.project?.systemName || s.project?.name || '-',
          `${Number(s.summary?.highRisk) || 0}`,
          `${Number(s.summary?.mediumRisk) || 0}`,
          `${Number(s.summary?.lowRisk) || 0}`,
          `${Number(s.summary?.total) || 0}`
        )
      );
    });
    riskRows.push(
      this.createTableRow('合计', '—', `${agg.highRisk}`, `${agg.mediumRisk}`, `${agg.lowRisk}`, `${agg.issues}`)
    );
    content.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: riskRows }));
    content.push(createBodyParagraph({ text: agg.narrative, spacingAfter: 200 }));

    // ===== 二、系统分册 =====
    content.push(new Paragraph({ children: [new PageBreak()] }));
    content.push(createHeadingParagraph({ text: '二、系统分册', level: 'heading1' }));
    content.push(
      createBodyParagraph({
        text: `本报告共 ${systems.length} 个分册，每个分册对应一个被测系统的完整测评结果，章节自「一、报告概述」起独立编号。`,
        spacingAfter: 200,
      })
    );

    for (let i = 0; i < systems.length; i++) {
      const s = systems[i];
      const systemName = s.project?.systemName || s.project?.name || `系统 ${i + 1}`;

      // 分册扉页：与上一分册 / 综述强制分页，避免装订在同一页
      content.push(new Paragraph({ children: [new PageBreak()] }));
      content.push(centered(`第 ${i + 1} 分册`, 48, { bold: true, before: 1600, after: 300 }));
      content.push(centered(systemName, 36, { bold: true, after: 500 }));
      for (const info of [
        `项目名称：${group?.name || '-'}`,
        `被测单位：${s.project?.assessedUnit || group?.assessedUnit || '-'}`,
        `安全等级：第 ${s.project?.level || '-'} 级`,
        `测评标准：${s.standard.code} · ${s.standard.name}`,
      ]) {
        content.push(centered(info, 28));
      }
      content.push(new Paragraph({ children: [new PageBreak()] }));

      // 分册正文：复用单系统 Word 内容，但跳过其自带封面/目录（frontMatter=false）
      const volumeOptions: ReportOptions = {
        format: options.format,
        template: options.template,
        includeSections: options.includeSections,
        projectId: s.project?.id || '',
        savePath: options.savePath,
        aiEnhanced: options.aiEnhanced,
      };
      const volumeContent = await this.buildWordContent(s, options.template, timestamp, volumeOptions, false);
      content.push(...volumeContent);
    }

    return content;
  }

  private async buildWordContent(
    data: ReportData,
    template: string,
    timestamp: string,
    options: ReportOptions,
    frontMatter: boolean = true
  ): Promise<(Paragraph | Table)[]> {
    const content: (Paragraph | Table)[] = [];
    const { project, issues, summary, assets, standard } = data;

    const isSimple = template === 'simple';
    const isDetailed = template === 'detailed';

    // frontMatter=false 用于项目合册的「分册」：总封面/总目录已在册首统一给出，
    // 各分册直接从「一、报告概述」开始，避免每册重复一份封面和目录。
    if (frontMatter) {
    // 封面标题
    content.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 2000, after: 400 },
        children: [
          new TextRun({
            text: '等级保护现场测评结果分析报告',
            font: {
              ascii: FONT_EN,
              hAnsi: FONT_EN,
              eastAsia: FONT_CN,
              cs: FONT_EN,
              hint: 'default',
            },
            size: 56,
            bold: true,
          }),
        ],
      })
    );

    // 改造：行业徽标（标准徽章）—— 行标项目显示行业色徽章 + 标准代号，国标显示 GB 徽章
    // 通过 docx TextRun 字号+加粗+色号组合，在封面上形成醒目的"标准标签"
    content.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: isSimple ? 200 : 0 },
        indent: { left: 0, right: 0 },
        children: [
          // 徽章边框字符（圆角矩形）作为视觉分隔
          new TextRun({
            text: `【${standard.badgeLabel}】`,
            font: {
              ascii: FONT_EN,
              hAnsi: FONT_EN,
              eastAsia: FONT_CN,
              cs: FONT_EN,
              hint: 'default',
            },
            size: 26,
            bold: true,
            color: standard.badgeColor,
          }),
          new TextRun({
            text: `  ${standard.code}  ·  ${standard.name}`,
            font: {
              ascii: FONT_EN,
              hAnsi: FONT_EN,
              eastAsia: FONT_CN,
              cs: FONT_EN,
              hint: 'default',
            },
            size: 22,
            color: '374151',
          }),
        ],
      })
    );

    if (!isSimple) {
      content.push(
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 200 },
          children: [
            new TextRun({
              text: 'Level Protection On-site Assessment Report',
              font: {
                ascii: FONT_EN,
                hAnsi: FONT_EN,
                eastAsia: FONT_CN,
                cs: FONT_EN,
                hint: 'default',
              },
              size: 28,
              italics: true,
            }),
          ],
        })
      );
    }

    // 封面信息
    const coverInfos = [
      `项目名称：${project?.name || '-'}`,
      `被测单位：${project?.assessedUnit || '-'}`,
      `系统名称：${project?.systemName || '-'}`,
      `安全等级：第 ${project?.level || '-'} 级`,
      `报告日期：${timestamp}`,
    ];

    for (const info of coverInfos) {
      content.push(
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 200 },
          children: [
            new TextRun({
              text: info,
              font: {
                ascii: FONT_EN,
                hAnsi: FONT_EN,
                eastAsia: FONT_CN,
                cs: FONT_EN,
                hint: 'default',
              },
              size: 28,
            }),
          ],
        })
      );
    }

    content.push(new Paragraph({ children: [new PageBreak()] }));

    // 目录
    if (!isSimple) {
      content.push(
        createHeadingParagraph({
          text: '目  录',
          level: 'heading1',
        })
      );

      // 目录只列实际会输出的章节（与 includeSections 同步），避免目录与正文不符
      const allTocItems: Array<[string, string]> = [
        ['overview', '一、报告概述'],
        ['projectInfo', '二、项目概况'],
        ['methodology', '三、测评方法'],
        ['results', '四、测评结果汇总'],
        ['analysis', '五、总体分析评价'],
        ['issues', '六、问题清单及分析'],
        ['recommendations', '七、整改建议及规划'],
        ['appendix', '八、附录'],
      ];
      const tocItems = allTocItems
        .filter(([key]) => options.includeSections.includes(key))
        .map(([, label]) => label);
      for (const item of tocItems) {
        content.push(
          new Paragraph({
            spacing: { before: 100, after: 100, line: LINE_SPACING },
            tabStops: [{ type: TabStopType.RIGHT, position: TabStopPosition.MAX }],
            children: [
              new TextRun({
                text: item,
                font: {
                  ascii: FONT_EN,
                  hAnsi: FONT_EN,
                  eastAsia: FONT_CN,
                  cs: FONT_EN,
                  hint: 'default',
                },
                size: SIZE_BODY,
              }),
              new TextRun({
                text: '\t............................',
                font: {
                  ascii: FONT_EN,
                  hAnsi: FONT_EN,
                  eastAsia: FONT_CN,
                  cs: FONT_EN,
                  hint: 'default',
                },
                size: SIZE_BODY,
              }),
            ],
          })
        );
      }

      content.push(new Paragraph({ children: [new PageBreak()] }));
    }
    } // end if (frontMatter)

    // 一、报告概述（受 overview 开关）
    if (options.includeSections.includes('overview')) {
    content.push(
      createHeadingParagraph({
        text: '一、报告概述',
        level: 'heading1',
      })
    );

    // 改造：概述文案按项目标准动态渲染：标准代号+名称，以及全部安全域列表（避免硬编码 GB/T 22239/十域）
    //   行标项目自动带行业标注（如"电力行业标准 DL/T 36572-2018"）
    const standardPrefix = standard.standardType === 'industry' && standard.industry
      ? `${standard.industry}行业标准`
      : '国家标准';
    const overviewText = `本报告依据${standard.code}《${standard.name}》（${standardPrefix}）对${project?.systemName || '该系统'}进行等级保护测评。测评工作涵盖了${standard.domainNamesIncluded}等${standard.domainCount}个安全域。`;

    content.push(
      createBodyParagraph({
        text: overviewText,
        spacingAfter: 200,
      })
    );

    content.push(
      createBodyParagraph({
        text: `本次测评共发现安全问题${summary.total}个，其中高风险问题${summary.highRisk}个、中风险问题${summary.mediumRisk}个、低风险问题${summary.lowRisk}个。`,
        spacingAfter: 200,
      })
    );

    // 网络拓扑与分区分域（单系统报告：frontMatter=true；合册分册在综述 1.2 已统一插入，此处跳过避免重复）
    if (frontMatter) {
      const desc = String(project?.topologyDescription || '').trim();
      let attachments: Array<{ name: string; path: string; size: number }> = [];
      try { attachments = JSON.parse(project?.topologyAttachments || '[]'); } catch { attachments = []; }
      if (desc || attachments.length > 0) {
        content.push(createHeadingParagraph({ text: '1.1 网络拓扑与分区分域', level: 'heading2' }));
        const topo = parseTopologyDoc(desc);
        if (topo.overview) content.push(createBodyParagraph({ text: topo.overview, spacingAfter: 120 }));
        for (const d of topo.domains) {
          content.push(createBodyParagraph({ text: `${d.name}：`, spacingAfter: 60 }));
          for (const line of d.description.split('\n').map(l => l.trim()).filter(Boolean)) {
            content.push(createBodyParagraph({ text: line, spacingAfter: 60 }));
          }
        }
        for (const att of attachments) {
          try {
            const abs = await toAbsolutePath(att.path);
            if (!fs.existsSync(abs)) { log.warn('[报告] 拓扑图不存在:', abs); continue; }
            const ext = path.extname(abs).toLowerCase().replace('.', '');
            if (ext === 'webp') { log.warn('[报告] WebP 无法嵌入 Word:', att.name); continue; }
            const type = (['png', 'jpg', 'gif', 'bmp'].includes(ext) ? ext : ext === 'jpeg' ? 'jpg' : 'png') as 'png' | 'jpg' | 'gif' | 'bmp';
            content.push(new Paragraph({
              alignment: AlignmentType.CENTER,
              spacing: { before: 120, after: 120 },
              children: [new ImageRun({
                type, data: fs.readFileSync(abs),
                transformation: { width: 560, height: 360 },
                altText: { title: project?.systemName || '系统拓扑', description: att.name, name: att.name },
              })],
            }));
            content.push(new Paragraph({
              alignment: AlignmentType.CENTER, spacing: { after: 160 },
              children: [new TextRun({ text: `图：网络拓扑图（${att.name}）`, size: 20, color: '666666' })],
            }));
          } catch (e: any) {
            log.warn('[报告] 拓扑图插入失败:', att.name, e.message);
          }
        }
      }
    }
    }

    // 简洁模板 - 直接到问题清单
    if (isSimple) {
      content.push(new Paragraph({ children: [new PageBreak()] }));
      content.push(
        createHeadingParagraph({
          text: '二、问题清单',
          level: 'heading1',
        })
      );

      if (issues.length > 0) {
        const simpleIssueTable = new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: [
            this.createHeaderRow('序号', '风险等级', '安全域', '问题标题'),
            ...issues.map((issue: any, idx: number) => {
              const riskLabel = issue.riskLevel === 'high' ? '高' : issue.riskLevel === 'medium' ? '中' : '低';
              const domain = data.domainNameMap[issue.securityDomain] || issue.securityDomain;
              return new TableRow({
                children: [
                  new TableCell({ children: [createTableParagraph(`${idx + 1}`, { alignment: AlignmentType.CENTER })] }),
                  new TableCell({ children: [createTableParagraph(riskLabel, { alignment: AlignmentType.CENTER })] }),
                  new TableCell({ children: [createTableParagraph(domain)] }),
                  new TableCell({ children: [createTableParagraph(issue.issueTitle || '-')] }),
                ],
              });
            }),
          ],
        });
        content.push(simpleIssueTable);
      } else {
        content.push(
          createBodyParagraph({
            text: '本次测评未发现安全问题。',
            spacingAfter: 200,
          })
        );
      }

      content.push(new Paragraph({ children: [new PageBreak()] }));
      content.push(
        createHeadingParagraph({
          text: '三、整改建议',
          level: 'heading1',
        })
      );
      content.push(
        createBodyParagraph({
          text: `建议优先整改高风险问题，中风险问题应在90日内完成整改，低风险问题在日常运维中逐步完善。具体整改建议请参考各问题的详细描述。`,
          spacingAfter: 200,
        })
      );

      return content;
    }

    // 二、项目概况（受 projectInfo 开关，与 HTML 链对齐）
    if (options.includeSections.includes('projectInfo')) {
    content.push(new Paragraph({ children: [new PageBreak()] }));
    content.push(
      createHeadingParagraph({
        text: '二、项目概况',
        level: 'heading1',
      })
    );

    const overviewTable = new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [
        this.createTableRow('项目名称', project?.name || '-', '项目编号', project?.projectNo || '-'),
        this.createTableRow('被测单位', project?.assessedUnit || '-', '系统名称', project?.systemName || '-'),
        this.createTableRow('安全等级', `第 ${project?.level || '-'} 级`, '测评标准', `${standard.code}（${standard.standardType === 'industry' ? `${standard.industry || '行业'}行标` : '国标'}）`),
        this.createTableRow('测评人员', project?.assessor || '-', '资产数量', `${assets.length} 台/套`),
      ],
    });
    content.push(overviewTable);
    }

    // 三、测评方法
    // 三、测评方法（受 methodology 开关）
    if (options.includeSections.includes('methodology')) {
    content.push(new Paragraph({ children: [new PageBreak()] }));
    content.push(
      createHeadingParagraph({
        text: '三、测评方法',
        level: 'heading1',
      })
    );

    const methods = [
      '本次测评采用访谈、检查和测试三种方法，对各安全域的控制点进行全面评估：',
      '（1）访谈：通过与安全管理人员交流，了解安全管理制度和流程的执行情况。',
      '（2）检查：对安全策略、制度文档、配置记录等进行文档审查和现场核实。',
      '（3）测试：通过技术手段对安全功能进行验证，包括漏洞扫描、配置核查、渗透测试等。',
    ];

    for (let i = 0; i < methods.length; i++) {
      content.push(
        createBodyParagraph({
          text: methods[i],
          spacingAfter: i === 0 ? 200 : i === methods.length - 1 ? 200 : 100,
        })
      );
    }
    }

    // 四、测评结果汇总（与 HTML 链一致：子节按实际输出动态编号，避免跳号）
    let wordSubNo = 1;
    let wordChapter4Started = false; // 四章标题是否已输出（供 4.3/4.4 独立输出时补标题）
    const ensureWordChapter4 = () => {
      if (wordChapter4Started) return;
      content.push(new Paragraph({ children: [new PageBreak()] }));
      content.push(createHeadingParagraph({ text: '四、测评结果汇总', level: 'heading1' }));
      wordChapter4Started = true;
    };
    // 4.1/4.2 受 results 开关；4.3/4.4 各自独立，关闭 results 时仍输出
    if (options.includeSections.includes('results')) {
    ensureWordChapter4();

    content.push(
      createHeadingParagraph({
        text: `4.${wordSubNo++} 风险评估统计`,
        level: 'heading2',
      })
    );

    const statsTable = new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [
        this.createHeaderRow('统计项', '数量'),
        this.createTableRow('高风险问题', `${summary.highRisk} 个`),
        this.createTableRow('中风险问题', `${summary.mediumRisk} 个`),
        this.createTableRow('低风险问题', `${summary.lowRisk} 个`),
        this.createTableRow('问题总数', `${summary.total} 个`),
      ],
    });
    content.push(statsTable);

    content.push(
      createHeadingParagraph({
        text: `4.${wordSubNo++} 各安全域问题分布`,
        level: 'heading2',
        spacingBefore: 300,
      })
    );

    if (summary.domainStats && summary.domainStats.length > 0) {
      const domainTable = new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: [
          this.createHeaderRow('安全域', '问题数量', '风险等级'),
          ...summary.domainStats.map((d: any) => {
            const level = d.maxRiskLevel === 'high' ? '高' : d.maxRiskLevel === 'medium' ? '中' : '低';
            return this.createTableRow(d.name, `${d.count} 个`, level);
          }),
        ],
      });
      content.push(domainTable);
    }
    }

    // 4.3 风险分析：问题清单式，每条问题一段「分析结果」（issues.risk_consequence）。
    // 独立的 'riskAnalysis' 章节开关控制；没有已分析问题时空章节跳过。
    if (options.includeSections.includes('riskAnalysis')) {
      const riskItems = collectRiskAnalysis(issues);
      if (riskItems.length > 0) {
        ensureWordChapter4();
        content.push(createHeadingParagraph({ text: `4.${wordSubNo++} 风险分析`, level: 'heading2', spacingBefore: 300 }));
        content.push(createBodyParagraph({
          text: `针对测评发现的问题逐条开展风险分析，说明每项问题可能导致的风险。本次共完成 ${riskItems.length} 个问题的风险分析，结果如下。`,
          spacingAfter: 200,
        }));
        content.push(new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: [
            this.createHeaderRow('序号', '问题标题', '初判等级', '问题分析'),
            ...riskItems.map((r, idx) => this.createTableRow(
              `${idx + 1}`, r.title, r.level, r.result
            )),
          ],
        }));
      }
    }

    // 4.4 重大风险隐患识别与分析：一条问题一段，相关性/严重性/高发性各一段话 + 最终判定。
    // 独立 'majorRisk' 章节开关控制；没有已判定条目时跳过空章节。
    if (options.includeSections.includes('majorRisk')) {
      const majorItems = collectMajorRisk(issues, (data as any).majorRiskAnalyses || []);
      if (majorItems.length > 0) {
        ensureWordChapter4();
        content.push(createHeadingParagraph({ text: `4.${wordSubNo++} 重大风险隐患识别与分析`, level: 'heading2', spacingBefore: 300 }));
        content.push(createBodyParagraph({
          text: `依据《重大风险隐患清单》，结合现场测评记录，按相关性、严重性、高发性三要素对测评发现的问题逐条开展重大风险隐患识别与分析。本次纳入 ${majorItems.length} 条已判定问题，结果如下。`,
          spacingAfter: 200,
        }));
        majorItems.forEach((item, idx) => {
          content.push(createBodyParagraph({
            text: `${idx + 1}. 问题：${item.title}`,
            bold: true,
            spacingBefore: 200,
            spacingAfter: 100,
          }));
          content.push(createBodyParagraph({ text: `命中清单条目：${item.catalogTitle}`, spacingAfter: 100 }));
          if (item.relevance) content.push(createBodyParagraph({ text: `相关性：${item.relevance}`, spacingAfter: 100 }));
          if (item.severity) content.push(createBodyParagraph({ text: `严重性：${item.severity}`, spacingAfter: 100 }));
          if (item.frequency) content.push(createBodyParagraph({ text: `高发性：${item.frequency}`, spacingAfter: 100 }));
          content.push(createBodyParagraph({ text: `最终判定：${item.verdictText}${item.conclusion ? `。综合结论：${item.conclusion}` : ''}`, spacingAfter: 200 }));
        });
      }
    }

    // 五、总体分析评价（受 analysis 开关）
    if (options.includeSections.includes('analysis')) {
    content.push(new Paragraph({ children: [new PageBreak()] }));
    content.push(
      createHeadingParagraph({
        text: '五、总体分析评价',
        level: 'heading1',
      })
    );

    const overallAnalysis = options.aiEnhanced
      ? (await this.generateAiOverview(data)) || this.generateOverallAnalysis(data)
      : this.generateOverallAnalysis(data);
    for (const para of overallAnalysis) {
      content.push(
        createBodyParagraph({
          text: para,
          spacingAfter: 200,
        })
      );
    }
    }

    // 六、问题清单及分析（受 issues 开关）
    if (options.includeSections.includes('issues')) {
    content.push(new Paragraph({ children: [new PageBreak()] }));
    content.push(
      createHeadingParagraph({
        text: '六、问题清单及分析',
        level: 'heading1',
      })
    );

    if (issues.length > 0) {
      const issueTable = new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: [
          this.createHeaderRow('序号', '风险等级', '安全域', '控制点', '问题标题'),
          ...issues.map((issue: any, idx: number) => {
            const riskLabel = issue.riskLevel === 'high' ? '高' : issue.riskLevel === 'medium' ? '中' : '低';
            const domain = data.domainNameMap[issue.securityDomain] || issue.securityDomain;
            return new TableRow({
              children: [
                new TableCell({ children: [createTableParagraph(`${idx + 1}`, { alignment: AlignmentType.CENTER })] }),
                new TableCell({ children: [createTableParagraph(riskLabel, { alignment: AlignmentType.CENTER })] }),
                new TableCell({ children: [createTableParagraph(domain)] }),
                new TableCell({ children: [createTableParagraph(issue.controlPoint || '-')] }),
                new TableCell({ children: [createTableParagraph(issue.issueTitle || '-')] }),
              ],
            });
          }),
        ],
      });
      content.push(issueTable);

      // 高风险问题详细描述
      content.push(
        createHeadingParagraph({
          text: '6.1 高风险问题详细描述',
          level: 'heading2',
          spacingBefore: 300,
        })
      );

      const highRiskIssues = issues.filter((i: any) => i.riskLevel === 'high');
      if (highRiskIssues.length > 0) {
        for (const issue of highRiskIssues) {
          content.push(
            new Paragraph({
              spacing: { before: 200, after: 100, line: LINE_SPACING },
              indent: { firstLine: INDENT_FIRST_LINE },
              children: [
                new TextRun({
                  text: `【${issue.controlPoint || '-'}-${issue.controlName || '-'}] `,
                  font: {
                    ascii: FONT_EN,
                    hAnsi: FONT_EN,
                    eastAsia: FONT_CN,
                    cs: FONT_EN,
                    hint: 'default',
                  },
                  size: SIZE_SMALL,
                  bold: true,
                }),
                new TextRun({
                  text: issue.issueTitle || '-',
                  font: {
                    ascii: FONT_EN,
                    hAnsi: FONT_EN,
                    eastAsia: FONT_CN,
                    cs: FONT_EN,
                    hint: 'default',
                  },
                  size: SIZE_SMALL,
                }),
              ],
            })
          );
          content.push(
            createBodyParagraph({
              text: `问题描述：${issue.issueDescription || '-'}`,
              size: SIZE_SMALL,
              spacingAfter: 100,
            })
          );
          content.push(
            createBodyParagraph({
              text: `整改建议：${issue.rectificationSuggestion || '-'}`,
              size: SIZE_SMALL,
              spacingAfter: 100,
            })
          );
        }
      } else {
        content.push(
          createBodyParagraph({
            text: '本次测评未发现高风险问题。',
            spacingAfter: 200,
          })
        );
      }

      // 详细模板 - 中低风险问题
      if (isDetailed) {
        content.push(
          createHeadingParagraph({
            text: '6.2 中风险问题详细描述',
            level: 'heading2',
            spacingBefore: 300,
          })
        );

        const mediumRiskIssues = issues.filter((i: any) => i.riskLevel === 'medium');
        if (mediumRiskIssues.length > 0) {
          for (const issue of mediumRiskIssues) {
            content.push(
              new Paragraph({
                spacing: { before: 200, after: 100, line: LINE_SPACING },
                indent: { firstLine: INDENT_FIRST_LINE },
                children: [
                  new TextRun({
                    text: `【${issue.controlPoint || '-'}-${issue.controlName || '-'}] `,
                    font: {
                      ascii: FONT_EN,
                      hAnsi: FONT_EN,
                      eastAsia: FONT_CN,
                      cs: FONT_EN,
                      hint: 'default',
                    },
                    size: SIZE_SMALL,
                    bold: true,
                  }),
                  new TextRun({
                    text: issue.issueTitle || '-',
                    font: {
                      ascii: FONT_EN,
                      hAnsi: FONT_EN,
                      eastAsia: FONT_CN,
                      cs: FONT_EN,
                      hint: 'default',
                    },
                    size: SIZE_SMALL,
                  }),
                ],
              })
            );
            content.push(
              createBodyParagraph({
                text: `问题描述：${issue.issueDescription || '-'}`,
                size: SIZE_SMALL,
                spacingAfter: 100,
              })
            );
            content.push(
              createBodyParagraph({
                text: `整改建议：${issue.rectificationSuggestion || '-'}`,
                size: SIZE_SMALL,
                spacingAfter: 100,
              })
            );
          }
        } else {
          content.push(
            createBodyParagraph({
              text: '本次测评未发现中风险问题。',
              spacingAfter: 200,
            })
          );
        }

        content.push(
          createHeadingParagraph({
            text: '6.3 低风险问题详细描述',
            level: 'heading2',
            spacingBefore: 300,
          })
        );

        const lowRiskIssues = issues.filter((i: any) => i.riskLevel === 'low');
        if (lowRiskIssues.length > 0) {
          for (const issue of lowRiskIssues) {
            content.push(
              new Paragraph({
                spacing: { before: 200, after: 100, line: LINE_SPACING },
                indent: { firstLine: INDENT_FIRST_LINE },
                children: [
                  new TextRun({
                    text: `【${issue.controlPoint || '-'}-${issue.controlName || '-'}] `,
                    font: {
                      ascii: FONT_EN,
                      hAnsi: FONT_EN,
                      eastAsia: FONT_CN,
                      cs: FONT_EN,
                      hint: 'default',
                    },
                    size: SIZE_SMALL,
                    bold: true,
                  }),
                  new TextRun({
                    text: issue.issueTitle || '-',
                    font: {
                      ascii: FONT_EN,
                      hAnsi: FONT_EN,
                      eastAsia: FONT_CN,
                      cs: FONT_EN,
                      hint: 'default',
                    },
                    size: SIZE_SMALL,
                  }),
                ],
              })
            );
            content.push(
              createBodyParagraph({
                text: `问题描述：${issue.issueDescription || '-'}`,
                size: SIZE_SMALL,
                spacingAfter: 100,
              })
            );
            content.push(
              createBodyParagraph({
                text: `整改建议：${issue.rectificationSuggestion || '-'}`,
                size: SIZE_SMALL,
                spacingAfter: 100,
              })
            );
          }
        } else {
          content.push(
            createBodyParagraph({
              text: '本次测评未发现低风险问题。',
              spacingAfter: 200,
            })
          );
        }
      }
    }
    }

    // 七、整改建议及规划（受 recommendations 开关）
    if (options.includeSections.includes('recommendations')) {
    content.push(new Paragraph({ children: [new PageBreak()] }));
    content.push(
      createHeadingParagraph({
        text: '七、整改建议及规划',
        level: 'heading1',
      })
    );

    const rectificationPlan = options.aiEnhanced
      ? (await this.generateAiRectification(data, isDetailed)) || this.generateRectificationPlan(data, isDetailed)
      : this.generateRectificationPlan(data, isDetailed);
    for (const section of rectificationPlan) {
      content.push(
        createHeadingParagraph({
          text: section.title,
          level: 'heading2',
        })
      );
      for (const para of section.content) {
        content.push(
          createBodyParagraph({
            text: para,
            spacingAfter: 150,
          })
        );
      }
    }
    }

    // 八、附录（受 appendix 开关）
    if (options.includeSections.includes('appendix')) {
    content.push(new Paragraph({ children: [new PageBreak()] }));
    content.push(
      createHeadingParagraph({
        text: '八、附录',
        level: 'heading1',
      })
    );
    content.push(
      createHeadingParagraph({
        text: '附录A：测评资产清单',
        level: 'heading2',
      })
    );

    if (assets.length > 0) {
      const assetTable = new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: [
          this.createHeaderRow('序号', '资产名称', '资产类别', '操作系统', 'IP地址'),
          ...assets.map((asset: any, idx: number) => {
            const categoryName = ASSET_CATEGORY_NAMES[asset.category] || asset.category || '-';
            return new TableRow({
              children: [
                new TableCell({ children: [createTableParagraph(`${idx + 1}`, { alignment: AlignmentType.CENTER })] }),
                new TableCell({ children: [createTableParagraph(asset.name || '-')] }),
                new TableCell({ children: [createTableParagraph(categoryName)] }),
                new TableCell({ children: [createTableParagraph(asset.os || '-')] }),
                new TableCell({ children: [createTableParagraph(asset.ip || '-')] }),
              ],
            });
          }),
        ],
      });
      content.push(assetTable);
    }
    }

    return content;
  }

  private createHeaderRow(...cells: string[]): TableRow {
    return new TableRow({
      tableHeader: true,
      children: cells.map(
        (text) =>
          new TableCell({
            shading: { fill: '1B5FD9', type: ShadingType.CLEAR, color: 'auto' },
            verticalAlign: VerticalAlign.CENTER,
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                spacing: { line: LINE_SPACING },
                children: [
                  new TextRun({
                    text,
                    font: {
                      ascii: FONT_EN,
                      hAnsi: FONT_EN,
                      eastAsia: FONT_CN,
                      cs: FONT_EN,
                      hint: 'default',
                    },
                    size: SIZE_SMALL,
                    bold: true,
                    color: 'FFFFFF',
                  }),
                ],
              }),
            ],
          })
      ),
    });
  }

  private createTableRow(...cells: string[]): TableRow {
    return new TableRow({
      children: cells.map(
        (text) =>
          new TableCell({
            verticalAlign: VerticalAlign.CENTER,
            children: [createTableParagraph(text)],
          })
      ),
    });
  }

  /**
   * 通过 AI 生成「总体分析评价」章节内容
   * 返回段落数组，失败时返回 null（调用方 fallback 到硬编码模板）
   */
  private async generateAiOverview(data: ReportData): Promise<string[] | null> {
    try {
      const { project, summary, standard } = data;
      const domainStatsJson = JSON.stringify(summary.domainStats || [], null, 0);

      const template = await getPromptTemplate('report_overview');
      const prompt = renderTemplate(template, {
        '项目名称': project?.name || '未知项目',
        '系统名称': project?.systemName || '未知系统',
        '测评标准': `${standard.code}《${standard.name}》`,
        '问题总数': String(summary.total),
        '高风险数': String(summary.highRisk),
        '中风险数': String(summary.mediumRisk),
        '低风险数': String(summary.lowRisk),
        '各域问题分布': domainStatsJson,
        '合规率': summary.total > 0 ? `${((summary.total - summary.highRisk) / summary.total * 100).toFixed(1)}%` : '100%',
      });

      const content = await this.callAiForReport(prompt, 'report_overview');
      if (!content) return null;

      const paragraphs = content.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
      if (paragraphs.length < 2) return null;

      log.info('[报告AI] 总体分析评价生成成功，段落数:', paragraphs.length);
      return paragraphs;
    } catch (e: any) {
      log.error('[报告AI] 总体分析评价生成失败:', e.message);
      return null;
    }
  }

  /**
   * 通过 AI 生成「整改建议及规划」章节内容
   * 返回 { title, content }[] 数组，失败时返回 null（调用方 fallback 到硬编码模板）
   */
  private async generateAiRectification(data: ReportData, _isDetailed: boolean): Promise<{ title: string; content: string[] }[] | null> {
    try {
      const { project, issues, summary } = data;

      // 只取前 20 个问题避免 token 过多
      const topIssues = issues.slice(0, 20).map((i: any) => ({
        title: i.issueTitle,
        risk: i.riskLevel,
        domain: i.securityDomain,
        suggestion: i.rectificationSuggestion || '暂无',
      }));
      const issuesJson = JSON.stringify(topIssues, null, 0);

      const template = await getPromptTemplate('report_rectification');
      const prompt = renderTemplate(template, {
        '项目名称': project?.name || '未知项目',
        '系统名称': project?.systemName || '未知系统',
        '问题总数': String(summary.total),
        '高风险数': String(summary.highRisk),
        '中风险数': String(summary.mediumRisk),
        '低风险数': String(summary.lowRisk),
        '问题列表JSON': issuesJson,
      });

      const content = await this.callAiForReport(prompt, 'report_rectification');
      if (!content) return null;

      // 按空行拆分段落，再按内容启发式分组到小节
      const paragraphs = content.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
      if (paragraphs.length < 3) return null;

      const sections: { title: string; content: string[] }[] = [];
      let currentSection = { title: '整改建议', content: [] as string[] };

      for (const para of paragraphs) {
        // 识别小节标题：含"整改建议"、"整改规划"、"长期规划"等关键词且较短
        const isSectionTitle = para.length < 40 && (
          para.includes('整改') && para.includes('建议') ||
          para.includes('整改') && para.includes('规划') ||
          para.includes('长期') && para.includes('规划') ||
          para.includes('高风险') || para.includes('中风险') || para.includes('低风险')
        );
        if (isSectionTitle && currentSection.content.length > 0) {
          sections.push(currentSection);
          currentSection = { title: para, content: [] };
        } else if (isSectionTitle && currentSection.content.length === 0) {
          currentSection.title = para;
        } else {
          currentSection.content.push(para);
        }
      }
      if (currentSection.content.length > 0) sections.push(currentSection);

      if (sections.length === 0) return null;

      log.info('[报告AI] 整改建议及规划生成成功，小节数:', sections.length);
      return sections;
    } catch (e: any) {
      log.error('[报告AI] 整改建议及规划生成失败:', e.message);
      return null;
    }
  }

  /**
   * 调用 AI 生成报告章节内容的通用方法
   * 云端模式：按 priority 顺序遍历已启用的云端模型，全部失败才返回 null
   * 本地模式（Ollama/Herdsman）：沿用 ai.ipc 的本地推理调用方式
   * 任何失败均返回 null，由调用方回退到内置模板，保证报告始终可生成
   */
  private async callAiForReport(prompt: string, tag: string): Promise<string | null> {
    try {
      const db = getDb();
      const configs = await db.select().from(schema.aiConfigs).limit(1);
      if (configs.length === 0) throw new Error('AI未配置');
      const config = configs[0];
      const mode = config.mode === 'local' ? 'local' : 'cloud';

      const systemPrompt = '你是一名专业的等级保护测评师，擅长撰写测评报告。请根据提供的数据撰写报告章节内容，语言正式、客观、专业。直接返回正文，不要标题行，不要JSON格式。';
      const messages = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: prompt },
      ];

      if (mode === 'local') {
        return await this.callAiForReportLocal(messages, tag);
      }

      // 云端：优先走云端模型列表（按 priority 升序），最后兜底 aiConfigs 主配置
      const cloudModels = await db.select().from(schema.aiCloudModels)
        .where(eq(schema.aiCloudModels.enabled, 1))
        .orderBy(asc(schema.aiCloudModels.priority));

      const candidates: { name: string; apiBase: string; apiKey: string; model: string }[] = cloudModels.map(m => ({
        name: m.name,
        apiBase: m.apiBase,
        apiKey: m.apiKey ? decryptApiKey(m.apiKey) : '',
        model: m.model,
      }));
      if (config.apiKey) {
        candidates.push({
          name: '主配置',
          apiBase: config.apiBase || '',
          apiKey: decryptApiKey(String(config.apiKey || '')),
          model: config.model || 'gpt-4o-mini',
        });
      }

      if (candidates.length === 0) throw new Error('AI未配置');

      const errors: string[] = [];
      for (const c of candidates) {
        try {
          const content = await this.requestOpenAIChat(c.apiBase, c.apiKey, c.model, messages, tag);
          if (content) return content;
          errors.push(`${c.name}: 返回空内容`);
        } catch (e: any) {
          errors.push(`${c.name}: ${e.message}`);
        }
      }
      log.warn(`[报告AI] 所有模型均失败，回退内置模板: ${errors.join(' | ')}`);
      return null;
    } catch (e: any) {
      log.error(`[报告AI] 调用 AI 生成 ${tag} 失败:`, e.message);
      return null;
    }
  }

  /**
   * 本地模型（Ollama / Herdsman）生成报告章节
   * Ollama: POST /api/chat
   * Herdsman: POST /api/v1/chat/completions
   */
  private async callAiForReportLocal(messages: any[], tag: string): Promise<string | null> {
    try {
      const db = getDb();
      const configs = await db.select().from(schema.aiConfigs).limit(1);
      if (configs.length === 0) return null;
      const config = configs[0];
      const engine = config.localEngine === 'herdsman' ? 'herdsman' : 'ollama';

      let baseUrl = engine === 'herdsman'
        ? (config.herdsmanUrl || 'http://localhost:23334').replace(/\/$/, '')
        : (config.ollamaUrl || 'http://localhost:11434').replace(/\/$/, '');
      let model = engine === 'herdsman'
        ? (config.herdsmanModel || '')
        : (config.ollamaModel || '');
      const path_ = engine === 'herdsman' ? '/api/v1/chat/completions' : '/api/chat';

      // 模型为空时尝试从云端模型表外推取本地模型（无结果则用引擎默认）
      if (!model) model = engine === 'herdsman' ? 'qwen2.5:7b' : 'llama3.1:8b';

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 180000);
      const url = baseUrl + path_;
      log.info(`[报告AI] 调用本地 ${engine} 生成 ${tag}, url=${url}, model=${model}`);

      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, messages, stream: false, temperature: 0.3 }),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`本地模型错误 ${response.status}: ${errText.slice(0, 200)}`);
      }
      const result = await response.json();
      const content = result.choices?.[0]?.message?.content || result.message?.content || '';
      return content || null;
    } catch (e: any) {
      log.error(`[报告AI] 本地模型生成 ${tag} 失败:`, e.message);
      return null;
    }
  }

  /**
   * 单次 OpenAI 兼容 API 调用（60 秒超时，报告生成场景容忍较长响应）
   */
  private async requestOpenAIChat(
    apiBaseRaw: string,
    apiKey: string,
    model: string,
    messages: any[],
    _tag: string
  ): Promise<string | null> {
    if (!apiKey) throw new Error('API Key 为空');

    let apiBase = apiBaseRaw || 'https://api.openai.com/v1';
    if (!apiBase.startsWith('http')) apiBase = 'https://' + apiBase;
    // 与 ai.ipc.ts 共用同一套补全规则：地址不含版本段时补 /v1/chat/completions。
    // 此前这里只补 `chat/completions`，而保存配置时会把用户填的 /v1 剥掉，
    // 于是请求打到 `${host}/chat/completions` —— 一个不存在的端点（报告生成静默回退内置模板）。
    const url = ensureApiUrl(apiBase, 'cloud');

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 120000);

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ model, messages, temperature: 0.3 }),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`API ${response.status}: ${errText.slice(0, 120)}`);
    }
    const result = await response.json();
    return result.choices?.[0]?.message?.content || null;
  }

  private generateOverallAnalysis(data: ReportData): string[] {
    const { summary, assessmentStats } = data;
    const paragraphs: string[] = [];

    const totalItems = assessmentStats.total || 0;
    const compliant = assessmentStats.compliant || 0;
    const partial = assessmentStats.partial || 0;
    const nonCompliant = assessmentStats.nonCompliant || 0;
    const notApplicable = assessmentStats.notApplicable || 0;

    paragraphs.push(
      `经过全面测评，该系统在${summary.total === 0 ? '各安全域均表现良好' : '部分安全域存在安全问题'}。本次测评共涉及${totalItems || '若干'}项测评指标，其中符合${compliant}项、部分符合${partial}项、不符合${nonCompliant}项、不适用${notApplicable}项。`
    );

    if (summary.highRisk > 0) {
      paragraphs.push(
        `测评发现高风险问题${summary.highRisk}个，主要集中在安全管理制度和安全运维管理方面。这些问题可能对系统的整体安全性造成严重影响，建议优先整改。高风险问题主要包括安全策略不完善、访问控制不严格、日志审计不完整等。`
      );
    }

    if (summary.mediumRisk > 0) {
      paragraphs.push(
        `中风险问题${summary.mediumRisk}个，主要分布在安全计算环境和安全通信网络领域。这些问题虽然不会立即导致安全事件，但长期存在会增加系统被攻击的风险，建议在中期内完成整改。`
      );
    }

    if (summary.lowRisk > 0) {
      paragraphs.push(
        `低风险问题${summary.lowRisk}个，多为配置细节和管理流程方面的不足。建议在系统日常运维中逐步完善。`
      );
    }

    paragraphs.push(
      `综合来看，该系统安全防护水平有待进一步提升。建议按照本报告提出的整改建议，有计划、有步骤地开展安全整改工作，持续提升系统安全防护能力。`
    );

    return paragraphs;
  }

  private generateRectificationPlan(data: ReportData, isDetailed: boolean): { title: string; content: string[] }[] {
    const { summary, issues } = data;
    const sections: { title: string; content: string[] }[] = [];

    const highRiskPct = summary.total > 0 ? ((summary.highRisk / summary.total) * 100).toFixed(1) : '0';
    const mediumRiskPct = summary.total > 0 ? ((summary.mediumRisk / summary.total) * 100).toFixed(1) : '0';
    const lowRiskPct = summary.total > 0 ? ((summary.lowRisk / summary.total) * 100).toFixed(1) : '0';

    const domainIssueMap: Record<string, number> = {};
    for (const issue of issues) {
      const name = data.domainNameMap[issue.securityDomain] || issue.securityDomain;
      domainIssueMap[name] = (domainIssueMap[name] || 0) + 1;
    }
    const topDomains = Object.entries(domainIssueMap).sort((a, b) => b[1] - a[1]).slice(0, 3);
    const topDomainText = topDomains.map(([name, count]) => `${name}（${count}个）`).join('、');

    // 7.1 整改原则
    sections.push({
      title: '7.1 整改原则',
      content: [
        '（1）风险优先、分级处置：按照风险等级优先处理高风险问题，消除重大安全隐患，中风险问题限期整改，低风险问题持续改进。',
        '（2）业务连续、最小影响：整改过程中应制定详细的实施方案和回退预案，确保系统正常运行，避免因整改导致业务中断。',
        '（3）制度先行、技术支撑：先完善安全管理制度和流程，再部署技术安全措施，确保制度和技术双管齐下。',
        '（4）全员参与、落实责任：明确各级人员安全职责，建立安全工作责任制，确保整改措施落实到位。',
        '（5）验证闭环、持续改进：整改完成后应进行验证评估，确保问题得到彻底解决，形成PDCA闭环管理。',
      ],
    });

    // 7.2 高风险问题整改建议（始终存在）
    if (summary.highRisk > 0) {
      const highContent: string[] = [];
      highContent.push(`本次测评共发现高风险问题${summary.highRisk}个，占问题总数的${highRiskPct}%，涉及${topDomainText || '多个安全域'}。高风险问题可能导致严重安全事件，影响系统正常运行和数据安全，建议在30个工作日内完成整改。`);
      highContent.push('');
      highContent.push('一、安全管理制度建设');
      highContent.push('1. 完善安全策略体系：制定并发布安全管理总方针、策略和制度，明确安全目标和管理要求；');
      highContent.push('2. 健全安全操作规程：针对关键操作制定详细的操作规程，规范操作流程，减少人为失误；');
      highContent.push('3. 建立安全责任制：明确各级人员安全职责，签订安全责任书，将安全责任落实到人；');
      highContent.push('4. 定期制度评审：每年至少进行一次安全管理制度评审和修订，确保制度的时效性和适用性。');
      highContent.push('');
      highContent.push('二、访问控制与身份认证');
      highContent.push('1. 实施最小权限原则：根据岗位职责分配最小必要权限，定期审查权限配置，及时清理过期账号和冗余权限；');
      highContent.push('2. 强化身份认证：对重要系统和敏感数据访问采用多因素认证（MFA），禁用默认账号和弱口令；');
      highContent.push('3. 规范远程访问：采用VPN等加密通道进行远程运维，限制远程访问IP范围，记录远程操作日志；');
      highContent.push('4. 定期权限审查：每季度开展一次用户权限审查，及时清理离职、转岗人员的系统权限。');
      highContent.push('');
      highContent.push('三、安全审计与日志管理');
      highContent.push('1. 部署安全审计系统：覆盖服务器、数据库、网络设备、安全设备，确保关键操作可追溯；');
      highContent.push('2. 完善日志记录：开启系统操作日志、安全事件日志、数据库审计日志，日志保存期限不少于6个月；');
      highContent.push('3. 日志集中管理：部署日志服务器或SIEM平台，实现日志集中收集、存储和分析；');
      highContent.push('4. 异常行为分析：建立异常行为检测规则，对异常登录、敏感数据访问等行为实时告警。');
      highContent.push('');
      highContent.push('四、漏洞管理与补丁更新');
      highContent.push('1. 定期漏洞扫描：每月对网络设备、安全设备、服务器、数据库进行漏洞扫描，及时更新漏洞库；');
      highContent.push('2. 补丁更新管理：建立补丁更新流程，对高危漏洞在72小时内完成修复，中低危漏洞在30日内修复；');
      highContent.push('3. 渗透测试验证：每年至少开展一次渗透测试，验证安全防护措施的有效性；');
      highContent.push('4. 第三方组件管理：梳理系统使用的第三方组件和开源软件，及时更新存在安全漏洞的组件。');
      highContent.push('');
      highContent.push('五、应急响应与灾难恢复');
      highContent.push('1. 完善应急预案：制定网络安全事件应急预案，明确应急组织、处置流程和恢复步骤；');
      highContent.push('2. 建立应急队伍：成立应急响应小组，明确职责分工，确保7×24小时响应能力；');
      highContent.push('3. 定期应急演练：每年至少组织一次综合应急演练，检验预案有效性和应急队伍能力；');
      highContent.push('4. 数据备份恢复：建立数据备份策略，定期进行备份恢复演练，确保数据可恢复性。');
      
      if (isDetailed) {
        highContent.push('');
        highContent.push('六、安全培训与意识提升');
        highContent.push('1. 管理人员培训：对安全管理层进行安全法规、风险管理、应急处置等专项培训；');
        highContent.push('2. 技术人员培训：对安全运维人员进行安全技术、安全配置、漏洞修复等专业培训；');
        highContent.push('3. 普通员工培训：定期开展全员安全意识教育，涵盖钓鱼邮件防范、密码安全、数据安全等；');
        highContent.push('4. 培训考核机制：建立安全培训考核制度，确保培训效果，考核不合格者需补训。');
      }

      sections.push({
        title: '7.2 高风险问题整改建议',
        content: highContent,
      });
    } else {
      sections.push({
        title: '7.2 高风险问题整改建议',
        content: [
          '本次测评未发现高风险问题。',
          '',
          '为持续提升安全防护水平，建议关注以下方面：',
          '1. 完善安全策略体系：制定并发布安全管理总方针、策略和制度，明确安全目标和管理要求；',
          '2. 强化身份认证：对重要系统和敏感数据访问采用多因素认证（MFA），禁用默认账号和弱口令；',
          '3. 完善日志记录：开启系统操作日志、安全事件日志、数据库审计日志，日志保存期限不少于6个月；',
          '4. 定期漏洞扫描：每月对网络设备、安全设备、服务器、数据库进行漏洞扫描，及时更新漏洞库；',
          '5. 完善应急预案：制定网络安全事件应急预案，明确应急组织、处置流程和恢复步骤。',
        ],
      });
    }

    // 7.3 中风险问题整改建议（始终存在）
    if (summary.mediumRisk > 0) {
      const mediumContent: string[] = [];
      mediumContent.push(`本次测评共发现中风险问题${summary.mediumRisk}个，占问题总数的${mediumRiskPct}%。中风险问题长期存在会增加系统被攻击的风险，建议在90个工作日内完成整改。`);
      mediumContent.push('');
      mediumContent.push('一、网络安全架构优化');
      mediumContent.push('1. 安全域划分：按照业务功能和安全等级划分安全区域，区域间部署防火墙进行访问控制；');
      mediumContent.push('2. 边界防护加强：在网络边界部署入侵检测/防御系统（IDS/IPS），部署Web应用防火墙（WAF）保护业务系统；');
      mediumContent.push('3. 网络流量监控：部署网络流量分析设备，对异常流量进行实时监测和告警；');
      mediumContent.push('4. 无线网络管理：加强无线网络接入管理，采用WPA3加密，隔离访客网络和业务网络。');
      mediumContent.push('');
      mediumContent.push('二、数据安全保护');
      mediumContent.push('1. 数据分类分级：建立数据分类分级标准，明确重要数据和核心数据的范围；');
      mediumContent.push('2. 数据加密存储：对敏感数据采用加密存储，密钥由专人管理，定期轮换；');
      mediumContent.push('3. 数据传输加密：对重要数据传输采用SSL/TLS加密，防止数据在传输过程中被窃取；');
      mediumContent.push('4. 数据备份恢复：建立数据备份策略，采用异地备份或云备份，定期进行备份恢复演练；');
      mediumContent.push('5. 数据脱敏处理：在测试、开发环境中使用脱敏后的数据，防止敏感数据泄露。');
      mediumContent.push('');
      mediumContent.push('三、物理安全与环境安全');
      mediumContent.push('1. 机房环境保障：确保机房供电、空调、消防等设施正常运行，部署环境监控系统；');
      mediumContent.push('2. 物理访问控制：机房部署门禁系统、视频监控，记录进出人员信息，定期检查监控记录；');
      mediumContent.push('3. 设备资产管理：建立设备资产台账，定期盘点，防止设备丢失或被非法带出；');
      mediumContent.push('4. 介质安全管理：对存储介质进行标识、登记和销毁管理，防止数据通过介质泄露。');
      mediumContent.push('');
      mediumContent.push('四、安全运维管理');
      mediumContent.push('1. 资产台账管理：建立完整的信息化资产台账，包括硬件、软件、网络设备等，定期更新；');
      mediumContent.push('2. 变更管理流程：建立系统变更管理流程，变更前进行安全评估，变更后进行验证；');
      mediumContent.push('3. 配置基线管理：建立安全配置基线标准，定期进行配置核查，及时整改配置偏差；');
      mediumContent.push('4. 供应商管理：对运维服务商进行安全评估，签订保密协议，明确安全责任。');
      
      if (isDetailed) {
        mediumContent.push('');
        mediumContent.push('五、安全监控与预警');
        mediumContent.push('1. 安全监控中心：建立或接入安全监控中心，实现安全事件的集中监控和统一处置；');
        mediumContent.push('2. 威胁情报接入：订阅权威威胁情报服务，及时获取最新的安全威胁信息；');
        mediumContent.push('3. 安全态势感知：部署安全态势感知平台，对安全态势进行综合分析和可视化展示；');
        mediumContent.push('4. 安全信息通报：建立安全信息通报机制，及时通报安全事件和处置情况。');
      }

      sections.push({
        title: '7.3 中风险问题整改建议',
        content: mediumContent,
      });
    } else {
      sections.push({
        title: '7.3 中风险问题整改建议',
        content: [
          '本次测评未发现中风险问题。',
          '',
          '为持续提升安全防护水平，建议关注以下方面：',
          '1. 安全域划分：按照业务功能和安全等级划分安全区域，区域间部署防火墙进行访问控制；',
          '2. 数据安全保护：建立数据分类分级标准，对敏感数据采用加密存储和传输；',
          '3. 物理安全：确保机房供电、空调、消防等设施正常运行，部署环境监控系统；',
          '4. 安全运维管理：建立完整的信息化资产台账，定期更新，建立变更管理流程。',
        ],
      });
    }

    // 7.4 低风险问题整改建议（始终存在）
    if (summary.lowRisk > 0) {
      const lowContent: string[] = [];
      lowContent.push(`本次测评共发现低风险问题${summary.lowRisk}个，占问题总数的${lowRiskPct}%。低风险问题多为配置细节和管理流程方面的不足，建议在180个工作日内完成整改，在日常运维中逐步完善。`);
      lowContent.push('');
      lowContent.push('一、系统安全配置优化');
      lowContent.push('1. 服务最小化：关闭不必要的服务、端口和功能，减少系统攻击面；');
      lowContent.push('2. 默认配置修改：修改系统默认口令、默认SNMP团体字等默认配置，防止被轻易破解；');
      lowContent.push('3. 安全参数配置：配置密码复杂度、密码有效期、登录失败锁定等安全参数；');
      lowContent.push('4. 系统补丁管理：及时更新系统补丁，关注漏洞公告，评估补丁兼容性后及时部署。');
      lowContent.push('');
      lowContent.push('二、日常安全运维');
      lowContent.push('1. 定期安全巡检：建立日常安全巡检制度，涵盖系统运行状态、安全设备状态、日志审计等；');
      lowContent.push('2. 安全事件记录：建立安全事件台账，记录事件发生时间、原因、处置措施和结果；');
      lowContent.push('3. 安全报告制度：定期编制安全运行报告，向上级汇报安全工作情况；');
      lowContent.push('4. 安全知识积累：建立安全知识库，积累安全配置、故障处置等经验。');
      lowContent.push('');
      lowContent.push('三、安全培训与文化建设');
      lowContent.push('1. 安全意识教育：通过宣传海报、培训课程、考试等方式，提高全员安全意识；');
      lowContent.push('2. 安全技能培训：对IT运维人员进行安全配置、安全工具使用等技能培训；');
      lowContent.push('3. 安全活动开展：开展安全月、安全竞赛等活动，营造安全文化氛围；');
      lowContent.push('4. 典型案例分析：学习和分析行业典型安全事件，吸取教训，防范类似事件发生。');
      
      if (isDetailed) {
        lowContent.push('');
        lowContent.push('四、持续改进机制');
        lowContent.push('1. PDCA循环：按照计划-执行-检查-改进的循环，持续优化安全防护体系；');
        lowContent.push('2. 安全指标考核：建立安全指标体系，纳入部门和个人的绩效考核；');
        lowContent.push('3. 新技术跟踪：关注零信任、SASE、AI安全等新技术发展，适时引入提升防护能力；');
        lowContent.push('4. 同行交流学习：参加行业安全会议和培训，学习先进安全管理经验。');
      }

      sections.push({
        title: '7.4 低风险问题整改建议',
        content: lowContent,
      });
    } else {
      sections.push({
        title: '7.4 低风险问题整改建议',
        content: [
          '本次测评未发现低风险问题。',
          '',
          '为持续提升安全防护水平，建议关注以下方面：',
          '1. 服务最小化：关闭不必要的服务、端口和功能，减少系统攻击面；',
          '2. 默认配置修改：修改系统默认口令、默认SNMP团体字等默认配置；',
          '3. 定期安全巡检：建立日常安全巡检制度，涵盖系统运行状态、安全设备状态等；',
          '4. 安全意识教育：通过宣传海报、培训课程、考试等方式，提高全员安全意识。',
        ],
      });
    }

    // 7.5 整改规划
    const planContent: string[] = [];
    planContent.push(`根据本次测评结果，共发现安全问题${summary.total}个。为有序开展整改工作，建议按照以下规划分阶段实施：`);
    planContent.push('');
    planContent.push('第一阶段：立即整改（0-30个工作日）');
    if (summary.highRisk > 0) {
      planContent.push(`目标：完成${summary.highRisk}个高风险问题的整改，消除重大安全隐患。`);
      planContent.push('');
      planContent.push('工作内容：');
      planContent.push('  （1）成立由分管领导牵头的整改工作小组，明确责任分工和时间节点；');
      planContent.push('  （2）逐项分析高风险问题，制定具体整改方案，明确整改措施、责任人和完成时限；');
      planContent.push('  （3）优先处理涉及核心业务系统和重要数据的高风险问题；');
      planContent.push('  （4）建立整改工作台账，实行销号管理，每周汇报整改进度；');
      planContent.push('  （5）整改完成后组织内部验收，形成整改报告存档。');
    } else {
      planContent.push('无高风险问题需要立即整改，可直接进入下一阶段。');
    }
    planContent.push('');
    planContent.push('第二阶段：中期整改（30-90个工作日）');
    if (summary.mediumRisk > 0) {
      planContent.push(`目标：完成${summary.mediumRisk}个中风险问题的整改，提升整体安全防护水平。`);
      planContent.push('');
      planContent.push('工作内容：');
      planContent.push('  （1）完善安全管理制度体系，制定并发布安全管理策略、制度和操作规程；');
      planContent.push('  （2）优化网络安全架构，合理划分安全区域，部署必要的网络安全设备；');
      planContent.push('  （3）加强数据安全保护，实施数据分类分级，建立数据备份恢复机制；');
      planContent.push('  （4）建立安全培训制度，定期开展安全意识教育和技能培训；');
      planContent.push('  （5）建立安全监控体系，实现7×24小时安全事件监测；');
      planContent.push('  （6）对现有安全策略进行全面审查和更新，确保符合最新标准要求。');
    } else {
      planContent.push('无中风险问题需要中期整改，可直接进入下一阶段。');
    }
    planContent.push('');
    planContent.push('第三阶段：持续改进（90-180个工作日）');
    if (summary.lowRisk > 0) {
      planContent.push(`目标：完成${summary.lowRisk}个低风险问题的整改，持续优化安全防护体系。`);
      planContent.push('');
      planContent.push('工作内容：');
      planContent.push('  （1）完善系统安全配置，建立安全基线配置标准；');
      planContent.push('  （2）建立常态化安全巡检机制，及时发现和处理安全问题；');
      planContent.push('  （3）定期开展安全风险评估，及时发现和消除新的安全隐患；');
      planContent.push('  （4）持续更新安全策略，适应业务发展和安全需求变化；');
      planContent.push('  （5）开展安全文化建设活动，营造全员参与的安全氛围；');
      planContent.push('  （6）建立安全考核机制，将安全指标纳入绩效考核体系。');
    } else {
      planContent.push('无低风险问题需要整改，重点关注长期安全规划和持续改进。');
    }
    planContent.push('');
    planContent.push('整改保障措施：');
    planContent.push('  （1）组织保障：成立整改工作领导小组，定期召开整改推进会，协调解决整改中的问题；');
    planContent.push('  （2）经费保障：将整改经费纳入年度预算，确保整改资金到位；');
    planContent.push('  （3）技术保障：配备专职安全管理人员，必要时聘请第三方安全服务机构提供技术支持；');
    planContent.push('  （4）进度管控：建立整改工作台账和周报制度，定期检查整改进度，确保按时完成。');

    sections.push({
      title: '7.5 整改规划',
      content: planContent,
    });

    // 7.6 长期安全规划
    const longTermContent: string[] = [];
    longTermContent.push('为确保系统安全防护能力的持续提升，实现安全工作的长效化、制度化，建议制定以下长期安全规划：');
    longTermContent.push('');
    longTermContent.push('一、安全评估常态化');
    longTermContent.push('  （1）每年至少开展一次等级保护测评，确保系统持续符合等级保护标准要求；');
    longTermContent.push('  （2）每季度开展一次安全自查，涵盖安全管理、安全技术、安全运维等方面；');
    longTermContent.push('  （3）重要活动和重大节日前开展专项安全检查；');
    longTermContent.push('  （4）系统发生重大变更后及时开展安全评估。');
    longTermContent.push('');
    longTermContent.push('二、安全团队专业化');
    longTermContent.push('  （1）配备与业务规模相匹配的专职安全管理人员，明确岗位职责；');
    longTermContent.push('  （2）安全管理人员持证上岗，定期参加专业培训和安全认证（如CISP、CISSP等）；');
    longTermContent.push('  （3）建立安全专家库，必要时邀请外部专家进行安全咨询和指导；');
    longTermContent.push('  （4）加强与公安网安部门、行业安全组织的沟通联系。');
    longTermContent.push('');
    longTermContent.push('三、安全技术体系化');
    longTermContent.push('  （1）推进安全运营中心（SOC）建设，实现安全事件的集中监控、统一处置和可视化管理；');
    longTermContent.push('  （2）部署安全态势感知平台，对安全态势进行综合分析和预警；');
    longTermContent.push('  （3）探索零信任安全架构，逐步实现动态访问控制和微分段隔离；');
    longTermContent.push('  （4）应用AI和大数据技术，提升安全威胁检测和响应能力。');
    longTermContent.push('');
    longTermContent.push('四、安全运维规范化');
    longTermContent.push('  （1）建立完善的安全运维管理制度和流程，涵盖资产管理、变更管理、配置管理等；');
    longTermContent.push('  （2）部署自动化运维工具，提高安全运维效率；');
    longTermContent.push('  （3）建立安全配置基线标准，定期进行配置核查；');
    longTermContent.push('  （4）加强供应链安全管理，对第三方服务商进行安全评估和持续监督。');
    longTermContent.push('');
    longTermContent.push('五、应急响应实战化');
    longTermContent.push('  （1）完善网络安全事件应急预案，明确应急组织、处置流程和恢复步骤；');
    longTermContent.push('  （2）每年至少组织一次综合应急演练，检验预案有效性和应急队伍能力；');
    longTermContent.push('  （3）开展专项应急演练（如勒索软件、数据泄露、DDoS攻击等场景）；');
    longTermContent.push('  （4）建立与公安、网信等部门的应急联动机制。');
    
    if (isDetailed) {
      longTermContent.push('');
      longTermContent.push('六、安全投入持续化');
      longTermContent.push('  （1）建立安全投入保障机制，确保安全经费持续投入，安全投入占信息化投入比例不低于10%；');
      longTermContent.push('  （2）优先保障高风险问题整改、安全设备采购、安全服务等重点领域的资金投入；');
      longTermContent.push('  （3）建立安全投入效益评估机制，提高安全资金使用效率。');
      longTermContent.push('');
      longTermContent.push('七、合规管理动态化');
      longTermContent.push('  （1）持续关注等级保护2.0、《数据安全法》、《个人信息保护法》等法规标准动态；');
      longTermContent.push('  （2）及时调整安全策略和管理制度，确保合规要求落实到位；');
      longTermContent.push('  （3）积极参与行业标准制定和学习，了解最新安全要求；');
      longTermContent.push('  （4）建立合规自查机制，及时发现和整改合规差距。');
      longTermContent.push('');
      longTermContent.push('八、安全创新引领化');
      longTermContent.push('  （1）关注云安全、物联网安全、AI安全等新兴领域安全挑战；');
      longTermContent.push('  （2）探索安全新技术应用，如区块链、同态加密、安全多方计算等；');
      longTermContent.push('  （3）参与行业安全交流，学习先进安全管理经验；');
      longTermContent.push('  （4）建立安全创新机制，鼓励安全技术应用创新。');
    }

    sections.push({
      title: '7.6 长期安全规划',
      content: longTermContent,
    });

    return sections;
  }

  private async generatePdfReport(
    data: ReportData,
    savePath: string,
    projectName: string,
    timestamp: string,
    options: ReportOptions
  ): Promise<string> {
    const isSimple = options.template === 'simple';
    const isDetailed = options.template === 'detailed';
    const htmlContent = await this.generateHtmlContent(data, projectName, timestamp, options, isSimple, isDetailed);
    return this.renderHtmlToPdf(htmlContent, savePath);
  }

  /**
   * 把一份完整 HTML 文档渲染成 PDF。单系统报告与项目合册共用同一个隐藏窗口与打印参数，
   * 避免两条渲染链出现版式差异；临时 HTML 在 finally 中必删（正文含单位与问题细节）。
   */
  private async renderHtmlToPdf(htmlContent: string, savePath: string): Promise<string> {
    const mainWindow = getMainWindow();
    if (!mainWindow) {
      throw new Error('无法获取主窗口');
    }

    const { BrowserWindow } = require('electron');
    const hiddenWindow = new BrowserWindow({
      width: 800,
      height: 1100,
      show: false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
      },
    });

    // 通过临时文件加载，而非 data: URL。
    // 报告 HTML 动辄数百 KB（含内联样式与全部问题清单），data: URL 会逼近 Chromium 的
    // URL 长度上限，大报告会加载失败；写临时文件 + file:// 没有长度限制。
    const os = require('os');
    const crypto = require('crypto');
    // 临时 HTML 含被测单位名称与全部问题细节：文件名用密码学随机，
    // 且仅当前用户可读（mode 0600），避免同机其他用户在渲染期间读取
    const tmpHtmlPath = path.join(
      os.tmpdir(),
      `jsecprobe-report-${Date.now()}-${crypto.randomBytes(12).toString('hex')}.html`
    );

    try {
      fs.writeFileSync(tmpHtmlPath, htmlContent, { encoding: 'utf8', mode: 0o600 });
      await hiddenWindow.loadFile(tmpHtmlPath);

      // 固定 setTimeout(1000) 在慢机器上不够（分页与图片缺失）、在快机器上又白等。
      // 改为等页面真正就绪：loadFile 已解析 did-finish-load，这里再等字体就绪 + 一帧渲染。
      await hiddenWindow.webContents.executeJavaScript(
        `(async () => {
          if (document.fonts && document.fonts.ready) { try { await document.fonts.ready; } catch (e) {} }
          await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
          return document.readyState;
        })()`
      ).catch(() => { /* 执行失败不阻断，直接出 PDF */ });

      const pdfBuffer = await hiddenWindow.webContents.printToPDF({
        marginsType: 1,
        pageSize: 'A4',
        printBackground: true,
        printSelectionOnly: false,
        landscape: false,
      });

      fs.writeFileSync(savePath, pdfBuffer);
      return savePath;
    } finally {
      // 任何异常路径都必须销毁隐藏窗口，否则渲染进程会泄漏（用户反复触发报告生成会累积泄漏）
      if (hiddenWindow && !hiddenWindow.isDestroyed()) {
        hiddenWindow.destroy();
      }
      // 清理临时 HTML，避免残留报告正文（含被测单位与问题细节）在临时目录
      try {
        if (fs.existsSync(tmpHtmlPath)) fs.unlinkSync(tmpHtmlPath);
      } catch {
        // 临时文件删除失败不影响报告已生成的结果
      }
    }
  }

  private async generateProjectPdfReport(
    data: ProjectReportData,
    savePath: string,
    projectName: string,
    timestamp: string,
    options: ProjectReportOptions
  ): Promise<string> {
    const htmlContent = await this.buildProjectHtmlContent(data, projectName, timestamp, options);
    const out = await this.renderHtmlToPdf(htmlContent, savePath);
    log.info(`[项目合册报告] PDF 合册已生成: ${out}`);
    return out;
  }

  /** 从完整 HTML 文档拆出 <style> 与 <body> 内容，供合册重组（首尾为固定模板，匹配稳定） */
  private splitHtmlDocument(full: string): { style: string; body: string } {
    const style = full.match(/<style>[\s\S]*?<\/style>/)?.[0] ?? '';
    const body = full.match(/<body>([\s\S]*?)<\/body>/)?.[1] ?? '';
    return { style, body };
  }

  /**
   * 合册 HTML：一份文档 = 总封面 + 总目录 + 项目综述 + 各分册（扉页 + 正文）。
   * 分册正文复用现有 generateHtmlContent，但去掉各自的 cover/toc，样式只保留一份。
   * 所有用户可控字段统一走 escapeHtml。
   */
  private async buildProjectHtmlContent(
    data: ProjectReportData,
    _projectName: string,
    timestamp: string,
    options: ProjectReportOptions
  ): Promise<string> {
    const { group, systems } = data;
    const agg = this.aggregateProjectSummary(systems);
    const isSimple = options.template === 'simple';
    const isDetailed = options.template === 'detailed';

    // ---- 各分册正文 ----
    const volumeSections: string[] = [];
    let sharedStyle = '';
    for (let i = 0; i < systems.length; i++) {
      const s = systems[i];
      const volumeOptions: ReportOptions = {
        format: options.format,
        template: options.template,
        // 册首已统一给出封面与目录，分册不再重复
        includeSections: options.includeSections.filter(x => x !== 'cover' && x !== 'toc'),
        projectId: s.project?.id || '',
        savePath: options.savePath,
        aiEnhanced: options.aiEnhanced,
      };
      const full = await this.generateHtmlContent(
        s, s.project?.name || '', timestamp, volumeOptions, isSimple, isDetailed
      );
      const { style, body } = this.splitHtmlDocument(full);
      if (!sharedStyle) sharedStyle = style;

      const systemName = s.project?.systemName || s.project?.name || `系统 ${i + 1}`;
      volumeSections.push(`
    <div class="page-break"></div>
    <div class="volume-cover">
      <h1>第 ${i + 1} 分册</h1>
      <h2>${escapeHtml(systemName)}</h2>
      <p>项目名称：${escapeHtml(group?.name) || '-'}</p>
      <p>被测单位：${escapeHtml(s.project?.assessedUnit || group?.assessedUnit) || '-'}</p>
      <p>安全等级：第 ${escapeHtml(s.project?.level) || '-'} 级</p>
      <p>测评标准：${escapeHtml(s.standard.code) || '-'} · ${escapeHtml(s.standard.name) || '-'}</p>
    </div>
    <div class="page-break"></div>
    ${body}`);
    }

    // ---- 项目综述的两张汇总表 ----
    const overviewTableRows = systems.map((s, i) => `
      <tr>
        <td class="text-center">${i + 1}</td>
        <td>${escapeHtml(s.project?.systemName || s.project?.name) || '-'}</td>
        <td class="text-center">第 ${escapeHtml(s.project?.level) || '-'} 级</td>
        <td>${escapeHtml(s.standard.code) || '-'}</td>
        <td class="text-center">${s.assets?.length ?? 0}</td>
        <td class="text-center">${Number(s.assessmentStats?.total) || 0}</td>
        <td class="text-center">${Number(s.summary?.complianceRate) || 0}%</td>
      </tr>`).join('');
    const riskTableRows = systems.map((s, i) => `
      <tr>
        <td class="text-center">${i + 1}</td>
        <td>${escapeHtml(s.project?.systemName || s.project?.name) || '-'}</td>
        <td class="text-center">${Number(s.summary?.highRisk) || 0}</td>
        <td class="text-center">${Number(s.summary?.mediumRisk) || 0}</td>
        <td class="text-center">${Number(s.summary?.lowRisk) || 0}</td>
        <td class="text-center">${Number(s.summary?.total) || 0}</td>
      </tr>`).join('');

    const tocVolumes = systems.map((s, i) => {
      const name = s.project?.systemName || s.project?.name || `系统 ${i + 1}`;
      return `      <div class="toc-item project-toc-item">第 ${i + 1} 分册　${escapeHtml(name)}（第 ${escapeHtml(s.project?.level) || '-'} 级 · ${escapeHtml(s.standard.code) || '-'}）</div>`;
    }).join('\n');

    let html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  ${sharedStyle}
  <style>
    .volume-cover { text-align: center; padding-top: 120px; }
    .volume-cover h1 { font-size: 30px; margin: 0 0 30px 0; text-indent: 0; }
    .volume-cover h2 { font-size: 22px; border: none; margin: 20px 0 40px 0; text-indent: 0; }
    .volume-cover p { text-indent: 0; font-size: 16px; margin: 12px 0; }
    .project-toc-item { padding-left: 2em; }
  </style>
</head>
<body>`;

    // 总封面（与单系统报告一致，受 includeSections 控制）
    if (options.includeSections.includes('cover')) {
    html += `
    <div class="cover">
      <h1>等级保护测评项目综合报告</h1>
      <p>项目名称：${escapeHtml(group?.name) || '-'}</p>
      <p>项目编号：${escapeHtml(group?.projectNo) || '-'}</p>
      <p>被测单位：${escapeHtml(group?.assessedUnit) || '-'}</p>
      <p>测评周期：${escapeHtml(group?.startDate) || '-'} 至 ${escapeHtml(group?.endDate) || '-'}</p>
      <p>系统数量：${systems.length} 个</p>
      <p>报告日期：${timestamp}</p>
    </div>
    <div class="page-break"></div>`;
    }

    // 总目录（受 includeSections 控制）
    if (options.includeSections.includes('toc')) {
    html += `
    <h2>目录</h2>
    <div class="toc project-toc">
      <div class="toc-item">一、项目综述</div>
      <div class="toc-item">二、系统分册</div>
${tocVolumes}
    </div>
    <div class="page-break"></div>`;
    }

    // 一、项目综述
    html += `
    <h2>一、项目综述</h2>
    <h3>1.1 项目基本信息</h3>
    <table>
      <tr><th width="18%">项目名称</th><td>${escapeHtml(group?.name) || '-'}</td><th width="18%">项目编号</th><td>${escapeHtml(group?.projectNo) || '-'}</td></tr>
      <tr><th>被测单位</th><td>${escapeHtml(group?.assessedUnit) || '-'}</td><th>客户名称</th><td>${escapeHtml(group?.customerName) || '-'}</td></tr>
      <tr><th>测评负责人</th><td>${escapeHtml(group?.assessor) || '-'}</td><th>项目状态</th><td>${escapeHtml(this.projectStatusLabel(group?.status))}</td></tr>
      <tr><th>测评周期</th><td>${escapeHtml(group?.startDate) || '-'} 至 ${escapeHtml(group?.endDate) || '-'}</td><th>系统数量</th><td>${systems.length} 个</td></tr>
    </table>`;
    if (group?.description) {
      html += `    <p>项目说明：${escapeHtml(group.description)}</p>`;
    }

    // 系统拓扑与分区分域（HTML 版）：描述按段输出，图片以 data URI 内联，报告自包含
    let topologyHtml = '';
    for (let si = 0; si < systems.length; si++) {
      const s = systems[si];
      const desc = String(s.project?.topologyDescription || '').trim();
      let attachments: Array<{ name: string; path: string; size: number }> = [];
      try { attachments = JSON.parse(s.project?.topologyAttachments || '[]'); } catch { attachments = []; }
      if (!desc && attachments.length === 0) continue;
      const sysName = escapeHtml(s.project?.systemName || s.project?.name || `系统 ${si + 1}`);
      topologyHtml += `<h4>1.2.${si + 1} ${sysName} 网络拓扑与分区分域</h4>`;
      const topo = parseTopologyDoc(desc);
      if (topo.overview) topologyHtml += `<p>${escapeHtml(topo.overview)}</p>`;
      for (const d of topo.domains) {
        topologyHtml += `<p class="topo-domain-title"><strong>${escapeHtml(d.name)}：</strong></p>`;
        for (const line of d.description.split('\n').map(l => l.trim()).filter(Boolean)) {
          topologyHtml += `<p>${escapeHtml(line)}</p>`;
        }
      }
      for (const att of attachments) {
        try {
          const abs = await toAbsolutePath(att.path);
          if (!fs.existsSync(abs)) continue;
          const ext = path.extname(abs).toLowerCase().replace('.', '');
          const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'gif' ? 'image/gif' : ext === 'bmp' ? 'image/bmp' : ext === 'webp' ? 'image/webp' : 'image/png';
          const b64 = fs.readFileSync(abs).toString('base64');
          topologyHtml += `<div class="topology-figure" style="text-align:center;margin:12px 0;"><img src="data:${mime};base64,${b64}" alt="${escapeHtml(att.name)}" style="max-width:100%;max-height:520px;" /><p style="font-size:12px;color:#666;">图：${sysName} 网络拓扑图（${escapeHtml(att.name)}）</p></div>`;
        } catch (e: any) {
          log.warn('[报告HTML] 拓扑图插入失败:', att.name, e.message);
        }
      }
    }

    html += `
    <h3>1.2 系统构成与测评概况</h3>
    <table>
      <tr><th>序号</th><th>系统名称</th><th>等级</th><th>测评标准</th><th>资产数</th><th>测评项</th><th>符合率</th></tr>
${overviewTableRows}
      <tr><td class="text-center">合计</td><td>—</td><td class="text-center">—</td><td>—</td><td class="text-center">${agg.assets}</td><td class="text-center">${agg.assessmentTotal}</td><td class="text-center">${agg.avgComplianceRate}%</td></tr>
    </table>
${topologyHtml}
    <h3>1.3 问题分布与综合评价</h3>
    <table>
      <tr><th>序号</th><th>系统名称</th><th>高风险</th><th>中风险</th><th>低风险</th><th>合计</th></tr>
${riskTableRows}
      <tr><td class="text-center">合计</td><td>—</td><td class="text-center">${agg.highRisk}</td><td class="text-center">${agg.mediumRisk}</td><td class="text-center">${agg.lowRisk}</td><td class="text-center">${agg.issues}</td></tr>
    </table>
    <p>${escapeHtml(agg.narrative)}</p>
    <div class="page-break"></div>
    <h2>二、系统分册</h2>
    <p>本报告共 ${systems.length} 个分册，每个分册对应一个被测系统的完整测评结果，章节自「一、报告概述」起独立编号。</p>`;

    html += volumeSections.join('\n');
    html += `
  </body>
</html>`;

    return html;
  }

  private async generateHtmlContent(
    data: ReportData,
    _projectName: string,
    timestamp: string,
    options: ReportOptions,
    isSimple: boolean,
    isDetailed: boolean
  ): Promise<string> {
    const { project, issues, summary, assets, standard } = data;

    const riskLabel = (level: string) => {
      const map: Record<string, string> = { high: '高', medium: '中', low: '低' };
      return map[level] || level;
    };

    let html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: "STFangsong", "Times New Roman", serif; font-size: 14px; line-height: 1.5; color: #333; padding: 40px; }
    h1 { text-align: center; font-size: 24px; margin: 1.5em 0; font-family: "STFangsong", "Times New Roman", serif; line-height: 1.5; }
    h2 { font-size: 18px; margin: 1.5em 0; border-bottom: 2px solid #1B5FD9; padding-bottom: 5px; font-family: "STFangsong", "Times New Roman", serif; line-height: 1.5; }
    h3 { font-size: 16px; margin: 1.5em 0; font-family: "STFangsong", "Times New Roman", serif; line-height: 1.5; }
    p { text-indent: 2em; line-height: 1.5; font-family: "STFangsong", "Times New Roman", serif; margin: 0.5em 0; }
    .cover { text-align: center; padding-top: 100px; }
    .cover h1 { font-size: 28px; margin-bottom: 50px; font-family: "STFangsong", "Times New Roman", serif; text-indent: 0; }
    .cover p { font-size: 16px; margin: 15px 0; font-family: "STFangsong", "Times New Roman", serif; text-indent: 0; }
    /* 改造：行业标准徽章样式（彩色圆角标签） */
    .standard-badge { display: inline-block; padding: 4px 14px; margin: 8px 0 18px 0; border-radius: 999px; color: #fff; font-weight: bold; font-size: 14px; font-family: "Microsoft YaHei", sans-serif; letter-spacing: 1px; }
    .standard-code { font-size: 15px; color: #4B5563; margin-left: 12px; font-family: "Microsoft YaHei", sans-serif; }
    .toc { margin: 20px 0; }
    .toc-item { padding: 5px 0; border-bottom: 1px dotted #ccc; font-family: "STFangsong", "Times New Roman", serif; text-indent: 0; }
    table { width: 100%; border-collapse: collapse; margin: 15px 0; font-family: "STFangsong", "Times New Roman", serif; line-height: 1.5; }
    th, td { border: 1px solid #ddd; padding: 8px 12px; text-align: left; font-family: "STFangsong", "Times New Roman", serif; line-height: 1.5; text-indent: 0; }
    th { background: #1B5FD9; color: #fff; font-weight: bold; font-family: "STFangsong", "Times New Roman", serif; }
    tr:nth-child(even) { background: #f9f9f9; }
    .text-center { text-align: center; }
    .text-right { text-align: right; }
    .risk-high { color: #f56c6c; font-weight: bold; }
    .risk-medium { color: #e6a23c; font-weight: bold; }
    .risk-low { color: #67c23a; font-weight: bold; }
    .issue-item { margin: 15px 0; padding: 15px; background: #f5f7fa; border-left: 4px solid #1B5FD9; font-family: "STFangsong", "Times New Roman", serif; text-indent: 0; }
    .issue-title { font-weight: bold; margin-bottom: 8px; font-family: "STFangsong", "Times New Roman", serif; text-indent: 0; }
    .issue-desc { margin: 5px 0; font-family: "STFangsong", "Times New Roman", serif; text-indent: 0; }
    .page-break { page-break-after: always; }
    .footer { text-align: center; margin-top: 30px; font-size: 12px; color: #999; font-family: "STFangsong", "Times New Roman", serif; text-indent: 0; }
  </style>
</head>
<body>`;

    // 封面
    if (options.includeSections.includes('cover')) {
      html += `
    <div class="cover">
      <h1>等级保护现场测评结果分析报告</h1>
      <!-- 改造：行业标准徽章（彩色圆角标签 + 标准代号） -->
      <div>
        <span class="standard-badge" style="background:#${standard.badgeColor}">${escapeHtml(standard.badgeLabel)}</span>
        <span class="standard-code">${escapeHtml(standard.code)} · ${escapeHtml(standard.name)}</span>
      </div>
      <p>项目名称：${escapeHtml(project?.name) || '-'}</p>
      <p>被测单位：${escapeHtml(project?.assessedUnit) || '-'}</p>
      <p>系统名称：${escapeHtml(project?.systemName) || '-'}</p>
      <p>安全等级：第 ${escapeHtml(project?.level) || '-'} 级</p>
      <p>报告日期：${timestamp}</p>
    </div>
    <div class="page-break"></div>`;
    }

    // 目录
    if (!isSimple && options.includeSections.includes('toc')) {
      html += `
    <h2>目录</h2>
    <div class="toc">
      <div class="toc-item">一、报告概述</div>
      <div class="toc-item">二、项目概况</div>
      <div class="toc-item">三、测评方法</div>
      <div class="toc-item">四、测评结果汇总</div>
      <div class="toc-item">五、总体分析评价</div>
      <div class="toc-item">六、问题清单及分析</div>
      <div class="toc-item">七、整改建议及规划</div>
      <div class="toc-item">八、附录</div>
    </div>
    <div class="page-break"></div>`;
    }

    // 改造：概述文案按项目标准动态渲染（同 Word 版逻辑）
    const _htmlStandardPrefix = standard.standardType === 'industry' && standard.industry
      ? `${standard.industry}行业标准`
      : '国家标准';
    const _htmlOverviewClause = `本报告依据${escapeHtml(standard.code)}《${escapeHtml(standard.name)}》（${escapeHtml(_htmlStandardPrefix)}）对${escapeHtml(project?.systemName) || '该系统'}进行等级保护测评。测评工作涵盖了${escapeHtml(standard.domainNamesIncluded)}等${standard.domainCount}个安全域。`;

    // 概述
    if (options.includeSections.includes('overview')) {
      html += `
    <h2>一、报告概述</h2>
    <p>${_htmlOverviewClause}</p>
    <p>本次测评共发现安全问题${summary.total}个，其中高风险问题${summary.highRisk}个、中风险问题${summary.mediumRisk}个、低风险问题${summary.lowRisk}个。</p>
    <div class="page-break"></div>`;
    }

    // 项目概况
    if (!isSimple && options.includeSections.includes('projectInfo')) {
      html += `
    <h2>二、项目概况</h2>
    <table>
      <tr><th width="25%">项目</th><th width="25%">内容</th><th width="25%">项目</th><th width="25%">内容</th></tr>
      <tr><td>项目名称</td><td>${escapeHtml(project?.name) || '-'}</td><td>项目编号</td><td>${escapeHtml(project?.projectNo) || '-'}</td></tr>
      <tr><td>被测单位</td><td>${escapeHtml(project?.assessedUnit) || '-'}</td><td>系统名称</td><td>${escapeHtml(project?.systemName) || '-'}</td></tr>
      <tr><td>安全等级</td><td>第 ${escapeHtml(project?.level) || '-'} 级</td><td>测评标准</td><td>${escapeHtml(standard.code) || '-'}（${standard.standardType === 'industry' ? `${escapeHtml(standard.industry) || '行业'}行标` : '国标'}）</td></tr>
      <tr><td>资产数量</td><td>${assets.length} 台/套</td><td>-</td><td>-</td></tr>
    </table>
    <div class="page-break"></div>`;
    }

    // 网络拓扑与分区分域（单系统 HTML/PDF）：独立于「项目概况」开关，只要有数据就插入，
    // 与单系统 Word、合册报告的拓扑章节保持一致。图片以 data URI 内联供 PDF 渲染读取。
    {
      const topoDesc = String(project?.topologyDescription || '').trim();
      let topoAttachments: Array<{ name: string; path: string; size: number }> = [];
      try { topoAttachments = JSON.parse(project?.topologyAttachments || '[]'); } catch { topoAttachments = []; }
      if (topoDesc || topoAttachments.length > 0) {
        html += `\n    <h2>网络拓扑与分区分域</h2>`;
        const topo = parseTopologyDoc(topoDesc);
        if (topo.overview) html += `\n    <p>${escapeHtml(topo.overview)}</p>`;
        for (const d of topo.domains) {
          html += `\n    <p class="topo-domain-title"><strong>${escapeHtml(d.name)}：</strong></p>`;
          for (const line of d.description.split('\n').map(l => l.trim()).filter(Boolean)) {
            html += `\n    <p>${escapeHtml(line)}</p>`;
          }
        }
        for (const att of topoAttachments) {
          try {
            const abs = await toAbsolutePath(att.path);
            if (!fs.existsSync(abs)) { log.warn('[报告HTML] 拓扑图不存在:', abs); continue; }
            const ext = path.extname(abs).toLowerCase().replace('.', '');
            const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'gif' ? 'image/gif' : ext === 'bmp' ? 'image/bmp' : ext === 'webp' ? 'image/webp' : 'image/png';
            const b64 = fs.readFileSync(abs).toString('base64');
            html += `\n    <div class="topology-figure" style="text-align:center;margin:12px 0;"><img src="data:${mime};base64,${b64}" alt="${escapeHtml(att.name)}" style="max-width:100%;max-height:520px;" /><p style="font-size:12px;color:#666;text-indent:0;">图：网络拓扑图（${escapeHtml(att.name)}）</p></div>`;
          } catch (e: any) {
            log.warn('[报告HTML] 拓扑图插入失败:', att.name, e.message);
          }
        }
        html += `\n    <div class="page-break"></div>`;
      }
    }

    // 测评方法
    if (!isSimple && options.includeSections.includes('methodology')) {
      html += `
    <h2>三、测评方法</h2>
    <p>本次测评采用访谈、检查和测试三种方法，对各安全域的控制点进行全面评估：</p>
    <p>（1）访谈：通过与安全管理人员交流，了解安全管理制度和流程的执行情况。</p>
    <p>（2）检查：对安全策略、制度文档、配置记录等进行文档审查和现场核实。</p>
    <p>（3）测试：通过技术手段对安全功能进行验证，包括漏洞扫描、配置核查、渗透测试等。</p>
    <div class="page-break"></div>`;
    }

    // 测评结果汇总（4.1/4.2 受 results 开关；4.3/4.4 各自独立开关，与 Word 链对齐）。
    // M23：4.3/4.4 此前嵌在 results 块内，取消 results 时连风险分析/重大隐患一起消失；
    // T8：章节号按实际输出动态生成，避免只勾 majorRisk 时出现 4.2→4.4 跳号。
    let subNo = 1; // 4.x 子节计数器：仅在子节真正输出时递增
    if (options.includeSections.includes('results')) {
      html += `
    <h2>四、测评结果汇总</h2>
    <h3>4.${subNo++} 风险评估统计</h3>
    <table>
      <tr><th>统计项</th><th>数量</th></tr>
      <tr><td class="risk-high">高风险问题</td><td>${summary.highRisk} 个</td></tr>
      <tr><td class="risk-medium">中风险问题</td><td>${summary.mediumRisk} 个</td></tr>
      <tr><td class="risk-low">低风险问题</td><td>${summary.lowRisk} 个</td></tr>
      <tr><td>问题总数</td><td>${summary.total} 个</td></tr>
    </table>

    <h3>4.${subNo++} 各安全域问题分布</h3>
    <table>
      <tr><th>安全域</th><th>问题数量</th><th>风险等级</th></tr>`;
      if (summary.domainStats && summary.domainStats.length > 0) {
        for (const d of summary.domainStats) {
          const level = d.maxRiskLevel === 'high' ? '高' : d.maxRiskLevel === 'medium' ? '中' : '低';
          html += `<tr><td>${escapeHtml(d.name)}</td><td>${d.count} 个</td><td>${level}</td></tr>`;
        }
      }
      html += `</table>`;
    }

    // 4.3 风险分析：与 Word 链同源（issues.risk_consequence），由独立章节开关控制。
    // 所有来自问题清单的用户字段一律 escapeHtml，避免破坏表格结构或注入 HTML。
    if (options.includeSections.includes('riskAnalysis')) {
      const riskItems = collectRiskAnalysis(issues);
      if (riskItems.length > 0) {
        html += `
    <h3>4.${subNo++} 风险分析</h3>
    <p>针对测评发现的问题逐条开展风险分析，说明每项问题可能导致的风险。本次共完成 ${riskItems.length} 个问题的风险分析，结果如下。</p>
    <table>
      <tr><th>序号</th><th>问题标题</th><th>初判等级</th><th>问题分析</th></tr>`;
        for (let i = 0; i < riskItems.length; i++) {
          const r = riskItems[i];
          html += `<tr><td>${i + 1}</td><td>${escapeHtml(r.title)}</td><td>${escapeHtml(r.level)}</td><td>${escapeHtml(r.result)}</td></tr>`;
        }
        html += `</table>`;
      }
    }

    // 4.4 重大风险隐患识别与分析：与 Word 链同源，三要素各一段话 + 最终判定。
    if (options.includeSections.includes('majorRisk')) {
      const majorItems = collectMajorRisk(issues, (data as any).majorRiskAnalyses || []);
      if (majorItems.length > 0) {
        html += `<h3>4.${subNo++} 重大风险隐患识别与分析</h3>`;
        html += `<p>依据《重大风险隐患清单》，结合现场测评记录，按相关性、严重性、高发性三要素对测评发现的问题逐条开展重大风险隐患识别与分析。本次纳入 ${majorItems.length} 条已判定问题，结果如下。</p>`;
        for (let i = 0; i < majorItems.length; i++) {
          const m = majorItems[i];
          html += `<div style="margin:0.8em 0;">`;
          html += `<p style="margin:0.3em 0;"><strong>${i + 1}. 问题：</strong>${escapeHtml(m.title)}</p>`;
          html += `<p style="margin:0.3em 0;">命中清单条目：${escapeHtml(m.catalogTitle)}</p>`;
          if (m.relevance) html += `<p style="margin:0.3em 0;">相关性：${escapeHtml(m.relevance)}</p>`;
          if (m.severity) html += `<p style="margin:0.3em 0;">严重性：${escapeHtml(m.severity)}</p>`;
          if (m.frequency) html += `<p style="margin:0.3em 0;">高发性：${escapeHtml(m.frequency)}</p>`;
          html += `<p style="margin:0.3em 0;">最终判定：<strong>${escapeHtml(m.verdictText)}</strong>${m.conclusion ? `。综合结论：${escapeHtml(m.conclusion)}` : ''}</p>`;
          html += `</div>`;
        }
      }
    }
    // 四章有任一子节输出才分页
    if (subNo > 1) html += `<div class="page-break"></div>`;

    // 总体分析评价
    if (options.includeSections.includes('analysis')) {
      html += `
    <h2>五、总体分析评价</h2>`;
      const overallAnalysis = options.aiEnhanced
        ? (await this.generateAiOverview(data)) || this.generateOverallAnalysis(data)
        : this.generateOverallAnalysis(data);
      for (const para of overallAnalysis) {
        html += `<p style="margin: 0.5em 0;">${escapeHtml(para)}</p>`;
      }
      html += `<div class="page-break"></div>`;
    }

    // 问题清单
    if (options.includeSections.includes('issues')) {
      html += `
    <h2>六、问题清单及分析</h2>`;
      if (issues.length > 0) {
        html += `
    <h3>6.1 问题汇总表</h3>
    <table>
      <tr><th width="8%">序号</th><th width="10%">风险等级</th><th width="18%">安全域</th><th width="20%">控制点</th><th width="44%">问题标题</th></tr>`;
        for (let i = 0; i < issues.length; i++) {
          const issue = issues[i];
          const riskClass = issue.riskLevel === 'high' ? 'risk-high' : issue.riskLevel === 'medium' ? 'risk-medium' : 'risk-low';
          const domain = data.domainNameMap[issue.securityDomain] || issue.securityDomain;
          html += `<tr><td class="text-center">${i + 1}</td><td class="${riskClass}">${riskLabel(issue.riskLevel)}</td><td>${escapeHtml(domain)}</td><td>${escapeHtml(issue.controlPoint) || '-'}</td><td>${escapeHtml(issue.issueTitle) || '-'}</td></tr>`;
        }
        html += `</table>`;

        if (options.includeSections.includes('issues')) {
          const highRiskIssues = issues.filter((i: any) => i.riskLevel === 'high');
          if (highRiskIssues.length > 0) {
            html += `<h3>6.2 高风险问题详细描述</h3>`;
            for (const issue of highRiskIssues) {
              html += `
      <div class="issue-item">
        <div class="issue-title">【${escapeHtml(issue.controlPoint) || '-'}-${escapeHtml(issue.controlName) || '-'}】${escapeHtml(issue.issueTitle) || '-'}</div>
        <div class="issue-desc">问题描述：${escapeHtml(issue.issueDescription) || '-'}</div>
        <div class="issue-desc">整改建议：${escapeHtml(issue.rectificationSuggestion) || '-'}</div>
      </div>`;
            }
          }

          if (isDetailed) {
            const mediumRiskIssues = issues.filter((i: any) => i.riskLevel === 'medium');
            if (mediumRiskIssues.length > 0) {
              html += `<h3>6.3 中风险问题详细描述</h3>`;
              for (const issue of mediumRiskIssues) {
                html += `
      <div class="issue-item">
        <div class="issue-title">【${escapeHtml(issue.controlPoint) || '-'}-${escapeHtml(issue.controlName) || '-'}】${escapeHtml(issue.issueTitle) || '-'}</div>
        <div class="issue-desc">问题描述：${escapeHtml(issue.issueDescription) || '-'}</div>
        <div class="issue-desc">整改建议：${escapeHtml(issue.rectificationSuggestion) || '-'}</div>
      </div>`;
              }
            }

            const lowRiskIssues = issues.filter((i: any) => i.riskLevel === 'low');
            if (lowRiskIssues.length > 0) {
              html += `<h3>6.4 低风险问题详细描述</h3>`;
              for (const issue of lowRiskIssues) {
                html += `
      <div class="issue-item">
        <div class="issue-title">【${escapeHtml(issue.controlPoint) || '-'}-${escapeHtml(issue.controlName) || '-'}】${escapeHtml(issue.issueTitle) || '-'}</div>
        <div class="issue-desc">问题描述：${escapeHtml(issue.issueDescription) || '-'}</div>
        <div class="issue-desc">整改建议：${escapeHtml(issue.rectificationSuggestion) || '-'}</div>
      </div>`;
              }
            }
          }
        }
      } else {
        html += `<p>本次测评未发现安全问题。</p>`;
      }
      html += `<div class="page-break"></div>`;
    }

    // 整改建议
    if (options.includeSections.includes('recommendations')) {
      html += `<h2>七、整改建议及规划</h2>`;
      const rectificationPlan = options.aiEnhanced
        ? (await this.generateAiRectification(data, isDetailed)) || this.generateRectificationPlan(data, isDetailed)
        : this.generateRectificationPlan(data, isDetailed);
      for (const section of rectificationPlan) {
        html += `<h3>${escapeHtml(section.title)}</h3>`;
        for (const para of section.content) {
          html += `<p style="margin: 5px 0;">${escapeHtml(para)}</p>`;
        }
      }
      html += `<div class="page-break"></div>`;
    }

    // 附录
    if (!isSimple && options.includeSections.includes('appendix')) {
      html += `
    <h2>八、附录</h2>
    <h3>附录A：测评资产清单</h3>`;
      if (assets.length > 0) {
        html += `
    <table>
      <tr><th width="8%">序号</th><th width="25%">资产名称</th><th width="15%">资产类别</th><th width="25%">操作系统</th><th width="27%">IP地址</th></tr>`;
        for (let i = 0; i < assets.length; i++) {
          const asset = assets[i];
          const categoryName = ASSET_CATEGORY_NAMES[asset.category] || asset.category || '-';
          html += `<tr><td class="text-center">${i + 1}</td><td>${escapeHtml(asset.name) || '-'}</td><td>${escapeHtml(categoryName) || '-'}</td><td>${escapeHtml(asset.os) || '-'}</td><td>${escapeHtml(asset.ip) || '-'}</td></tr>`;
        }
        html += `</table>`;
      }
    }

    html += `
  </body>
</html>`;

    return html;
  }
}

export const reportService = new ReportService();