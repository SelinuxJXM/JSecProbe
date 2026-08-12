import * as path from 'path';
import * as fs from 'fs';
import { getDb } from '../db';
import * as schema from '../db/schema';
import { eq, desc, sql, and, or, lte, inArray, count } from 'drizzle-orm';
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
} from 'docx';
import { getMainWindow } from '../main';
import { ASSET_CATEGORY_NAMES } from '../utils/excel-config';

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
}

interface ReportData {
  project: any;
  issues: any[];
  summary: any;
  assets: any[];
  assessmentStats: any;
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

  private async gatherReportData(projectId: string): Promise<ReportData> {
    const db = getDb();

    const projectResult = await db.select().from(schema.projects).where(eq(schema.projects.id, projectId)).limit(1);
    const project = projectResult[0];

    const issues = await db.select().from(schema.issues).where(eq(schema.issues.projectId, projectId)).orderBy(desc(schema.issues.riskLevel));

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
    for (const issue of issues) {
      const name = DOMAIN_ID_TO_NAME[issue.securityDomain] || issue.securityDomain;
      domainCounts[name] = (domainCounts[name] || 0) + 1;
    }
    const domainStats = Object.entries(domainCounts).map(([name, count]) => ({ name, count }));

    const assessmentStats = await this.getAssessmentStats(projectId, project?.standardId || 'gb-t-22239-2019-l3');

    return {
      project,
      issues,
      summary: {
        total: totalIssues,
        highRisk,
        mediumRisk,
        lowRisk,
        pending,
        rectifying,
        resolved,
        closed,
        complianceRate: project?.complianceRate || 0,
        domainStats,
      },
      assets,
      assessmentStats,
    };
  }

  private async getAssessmentStats(projectId: string, standardId: string): Promise<any> {
    const db = getDb();

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

    const project = await db.query.projects.findFirst({ where: eq(schema.projects.id, projectId) });
    if (!project) {
      return { total: 0, compliant: 0, nonCompliant: 0, partial: 0, notApplicable: 0, untested: 0, tested: 0 };
    }

    const projectExtCodes: string[] = [];
    if (project.extensionType) {
      for (const t of project.extensionType.split(',').filter(Boolean)) {
        const code = EXT_TYPE_MAP[t.trim()] || t.trim();
        if (!projectExtCodes.includes(code)) projectExtCodes.push(code);
      }
    }

    const extOrConditions = [eq(schema.assessmentItems.extensionType, 'general')];
    for (const ext of projectExtCodes) {
      extOrConditions.push(eq(schema.assessmentItems.extensionType, ext));
    }
    const extOr = or(...extOrConditions);

    const assets = await db.query.assets.findMany({
      where: and(
        eq(schema.assets.projectId, projectId),
        eq(schema.assets.isAssessmentTarget, 1),
      ),
    });

    const CATEGORY_TO_DOMAIN: Record<string, string> = {
      'server_storage': 'secure_computing',
      'sys_doc': 'secure_computing',
      'network_device': 'secure_computing',
      'security_device': 'secure_computing',
      'business_app': 'secure_computing',
      'terminal': 'secure_computing',
      'management_platform': 'secure_computing',
      'machine_room': 'secure_physical',
      'data_resource': 'secure_computing',
      'network_boundary': 'secure_boundary',
      'data_category': 'secure_computing',
    };
    const domainAssetCounts: Record<string, number> = {};
    for (const asset of assets) {
      const domainId = CATEGORY_TO_DOMAIN[asset.category] || 'secure_computing';
      domainAssetCounts[domainId] = (domainAssetCounts[domainId] || 0) + 1;
    }

    const globalItems = await db.query.assessmentItems.findMany({
      where: and(
        eq(schema.assessmentItems.standardId, standardId),
        extOr,
        ...(project.level ? [lte(schema.assessmentItems.minLevel, project.level)] : [])
      ),
      columns: { domain: true },
    });

    const domainItemCounts: Record<string, number> = {};
    for (const item of globalItems) {
      domainItemCounts[item.domain] = (domainItemCounts[item.domain] || 0) + 1;
    }

    const GLOBAL_DOMAINS = [
      'secure_communication',
      'secure_management',
      'security_management',
      'security_organization',
      'security_personnel',
      'security_construction',
      'security_maintenance',
    ];

    let total = 0;
    for (const [domainId, assetCount] of Object.entries(domainAssetCounts)) {
      const itemCount = domainItemCounts[domainId] || 0;
      total += assetCount * itemCount;
    }

    for (const domainId of GLOBAL_DOMAINS) {
      const itemCount = domainItemCounts[domainId] || 0;
      total += itemCount;
    }

    const applicableConditions = [
      eq(schema.assessmentItems.standardId, standardId),
      extOr,
    ];
    if (project.level) {
      applicableConditions.push(lte(schema.assessmentItems.minLevel, project.level));
    }

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

    const partialRecords = await db
      .select({ value: count() })
      .from(schema.assessmentRecords)
      .where(and(
        eq(schema.assessmentRecords.projectId, projectId),
        inArray(schema.assessmentRecords.itemId, itemIdsSubquery),
        sql`result = 'partial'`
      ));

    const nonCompliantRecords = await db
      .select({ value: count() })
      .from(schema.assessmentRecords)
      .where(and(
        eq(schema.assessmentRecords.projectId, projectId),
        inArray(schema.assessmentRecords.itemId, itemIdsSubquery),
        sql`result IN ('non_compliant', 'nonconform')`
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
    const partial = partialRecords[0]?.value || 0;
    const nonCompliant = nonCompliantRecords[0]?.value || 0;
    const notApplicable = naRecords[0]?.value || 0;
    const untested = Math.max(0, total - tested - notApplicable);

    return {
      total,
      tested,
      compliant,
      partial,
      nonCompliant,
      notApplicable,
      untested,
    };
  }

  private async generateWordReport(
    data: ReportData,
    savePath: string,
    _projectName: string,
    timestamp: string,
    options: ReportOptions
  ): Promise<string> {
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
          children: this.buildWordContent(data, options.template, timestamp),
        },
      ],
    });

    const buffer = await Packer.toBuffer(doc);
    fs.writeFileSync(savePath, buffer);
    return savePath;
  }

  private buildWordContent(data: ReportData, template: string, timestamp: string): (Paragraph | Table)[] {
    const content: (Paragraph | Table)[] = [];
    const { project, issues, summary, assets } = data;

    const isSimple = template === 'simple';
    const isDetailed = template === 'detailed';

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

      const tocItems = [
        '一、报告概述',
        '二、项目概况',
        '三、测评方法',
        '四、测评结果汇总',
        '五、总体分析评价',
        '六、问题清单及分析',
        '七、整改建议及规划',
        '八、附录',
      ];
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

    // 一、报告概述
    content.push(
      createHeadingParagraph({
        text: '一、报告概述',
        level: 'heading1',
      })
    );

    content.push(
      createBodyParagraph({
        text: `本报告依据GB/T 22239-2019《信息安全技术 网络安全等级保护基本要求》对${project?.systemName || '该系统'}进行等级保护测评。测评工作涵盖了安全物理环境、安全通信网络、安全区域边界、安全计算环境、安全管理中心、安全管理制度、安全管理机构、安全管理人员、安全建设管理、安全运维管理等十个安全域。`,
        spacingAfter: 200,
      })
    );

    content.push(
      createBodyParagraph({
        text: `本次测评共发现安全问题${summary.total}个，其中高风险问题${summary.highRisk}个、中风险问题${summary.mediumRisk}个、低风险问题${summary.lowRisk}个。`,
        spacingAfter: 200,
      })
    );

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
              const domain = DOMAIN_ID_TO_NAME[issue.securityDomain] || issue.securityDomain;
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

    // 二、项目概况
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
        this.createTableRow('安全等级', `第 ${project?.level || '-'} 级`, '测评标准', project?.standardSystem || 'GB/T 22239-2019'),
        this.createTableRow('测评人员', project?.assessor || '-', '资产数量', `${assets.length} 台/套`),
      ],
    });
    content.push(overviewTable);

    // 三、测评方法
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

    // 四、测评结果汇总
    content.push(new Paragraph({ children: [new PageBreak()] }));
    content.push(
      createHeadingParagraph({
        text: '四、测评结果汇总',
        level: 'heading1',
      })
    );

    content.push(
      createHeadingParagraph({
        text: '4.1 风险评估统计',
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
        text: '4.2 各安全域问题分布',
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
            const level = d.count > 5 ? '高' : d.count > 2 ? '中' : '低';
            return this.createTableRow(d.name, `${d.count} 个`, level);
          }),
        ],
      });
      content.push(domainTable);
    }

    // 五、总体分析评价
    content.push(new Paragraph({ children: [new PageBreak()] }));
    content.push(
      createHeadingParagraph({
        text: '五、总体分析评价',
        level: 'heading1',
      })
    );

    const overallAnalysis = this.generateOverallAnalysis(data);
    for (const para of overallAnalysis) {
      content.push(
        createBodyParagraph({
          text: para,
          spacingAfter: 200,
        })
      );
    }

    // 六、问题清单及分析
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
            const domain = DOMAIN_ID_TO_NAME[issue.securityDomain] || issue.securityDomain;
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

    // 七、整改建议及规划
    content.push(new Paragraph({ children: [new PageBreak()] }));
    content.push(
      createHeadingParagraph({
        text: '七、整改建议及规划',
        level: 'heading1',
      })
    );

    const rectificationPlan = this.generateRectificationPlan(data, isDetailed);
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

    // 八、附录
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
      const name = DOMAIN_ID_TO_NAME[issue.securityDomain] || issue.securityDomain;
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
    const mainWindow = getMainWindow();
    if (!mainWindow) {
      throw new Error('无法获取主窗口');
    }

    const isSimple = options.template === 'simple';
    const isDetailed = options.template === 'detailed';

    const htmlContent = this.generateHtmlContent(data, projectName, timestamp, options, isSimple, isDetailed);

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

    await hiddenWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(htmlContent)}`);

    await new Promise(resolve => setTimeout(resolve, 1000));

    const pdfBuffer = await hiddenWindow.webContents.printToPDF({
      marginsType: 1,
      pageSize: 'A4',
      printBackground: true,
      printSelectionOnly: false,
      landscape: false,
    });

    hiddenWindow.destroy();

    fs.writeFileSync(savePath, pdfBuffer);
    return savePath;
  }

  private generateHtmlContent(
    data: ReportData,
    _projectName: string,
    timestamp: string,
    options: ReportOptions,
    isSimple: boolean,
    isDetailed: boolean
  ): string {
    const { project, issues, summary, assets } = data;

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
      <p>项目名称：${project?.name || '-'}</p>
      <p>被测单位：${project?.assessedUnit || '-'}</p>
      <p>系统名称：${project?.systemName || '-'}</p>
      <p>安全等级：第 ${project?.level || '-'} 级</p>
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

    // 概述
    if (options.includeSections.includes('overview')) {
      html += `
    <h2>一、报告概述</h2>
    <p>本报告依据GB/T 22239-2019《信息安全技术 网络安全等级保护基本要求》对${project?.systemName || '该系统'}进行等级保护测评。测评工作涵盖了安全物理环境、安全通信网络、安全区域边界、安全计算环境、安全管理中心、安全管理制度、安全管理机构、安全管理人员、安全建设管理、安全运维管理等十个安全域。</p>
    <p>本次测评共发现安全问题${summary.total}个，其中高风险问题${summary.highRisk}个、中风险问题${summary.mediumRisk}个、低风险问题${summary.lowRisk}个。</p>
    <div class="page-break"></div>`;
    }

    // 项目概况
    if (!isSimple && options.includeSections.includes('projectInfo')) {
      html += `
    <h2>二、项目概况</h2>
    <table>
      <tr><th width="25%">项目</th><th width="25%">内容</th><th width="25%">项目</th><th width="25%">内容</th></tr>
      <tr><td>项目名称</td><td>${project?.name || '-'}</td><td>项目编号</td><td>${project?.projectNo || '-'}</td></tr>
      <tr><td>被测单位</td><td>${project?.assessedUnit || '-'}</td><td>系统名称</td><td>${project?.systemName || '-'}</td></tr>
      <tr><td>安全等级</td><td>第 ${project?.level || '-'} 级</td><td>测评标准</td><td>${project?.standardSystem || 'GB/T 22239-2019'}</td></tr>
      <tr><td>资产数量</td><td>${assets.length} 台/套</td><td>-</td><td>-</td></tr>
    </table>
    <div class="page-break"></div>`;
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

    // 测评结果汇总
    if (options.includeSections.includes('results')) {
      html += `
    <h2>四、测评结果汇总</h2>
    <h3>4.1 风险评估统计</h3>
    <table>
      <tr><th>统计项</th><th>数量</th></tr>
      <tr><td class="risk-high">高风险问题</td><td>${summary.highRisk} 个</td></tr>
      <tr><td class="risk-medium">中风险问题</td><td>${summary.mediumRisk} 个</td></tr>
      <tr><td class="risk-low">低风险问题</td><td>${summary.lowRisk} 个</td></tr>
      <tr><td>问题总数</td><td>${summary.total} 个</td></tr>
    </table>

    <h3>4.2 各安全域问题分布</h3>
    <table>
      <tr><th>安全域</th><th>问题数量</th><th>风险等级</th></tr>`;
      if (summary.domainStats && summary.domainStats.length > 0) {
        for (const d of summary.domainStats) {
          const level = d.count > 5 ? '高' : d.count > 2 ? '中' : '低';
          html += `<tr><td>${d.name}</td><td>${d.count} 个</td><td>${level}</td></tr>`;
        }
      }
      html += `</table><div class="page-break"></div>`;
    }

    // 总体分析评价
    if (options.includeSections.includes('analysis')) {
      html += `
    <h2>五、总体分析评价</h2>`;
      const overallAnalysis = this.generateOverallAnalysis(data);
      for (const para of overallAnalysis) {
        html += `<p style="margin: 0.5em 0;">${para}</p>`;
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
          const domain = DOMAIN_ID_TO_NAME[issue.securityDomain] || issue.securityDomain;
          html += `<tr><td class="text-center">${i + 1}</td><td class="${riskClass}">${riskLabel(issue.riskLevel)}</td><td>${domain}</td><td>${issue.controlPoint || '-'}</td><td>${issue.issueTitle || '-'}</td></tr>`;
        }
        html += `</table>`;

        if (options.includeSections.includes('issues')) {
          const highRiskIssues = issues.filter((i: any) => i.riskLevel === 'high');
          if (highRiskIssues.length > 0) {
            html += `<h3>6.2 高风险问题详细描述</h3>`;
            for (const issue of highRiskIssues) {
              html += `
      <div class="issue-item">
        <div class="issue-title">【${issue.controlPoint || '-'}-${issue.controlName || '-'})】${issue.issueTitle || '-'}</div>
        <div class="issue-desc">问题描述：${issue.issueDescription || '-'}</div>
        <div class="issue-desc">整改建议：${issue.rectificationSuggestion || '-'}</div>
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
        <div class="issue-title">【${issue.controlPoint || '-'}-${issue.controlName || '-'})】${issue.issueTitle || '-'}</div>
        <div class="issue-desc">问题描述：${issue.issueDescription || '-'}</div>
        <div class="issue-desc">整改建议：${issue.rectificationSuggestion || '-'}</div>
      </div>`;
              }
            }

            const lowRiskIssues = issues.filter((i: any) => i.riskLevel === 'low');
            if (lowRiskIssues.length > 0) {
              html += `<h3>6.4 低风险问题详细描述</h3>`;
              for (const issue of lowRiskIssues) {
                html += `
      <div class="issue-item">
        <div class="issue-title">【${issue.controlPoint || '-'}-${issue.controlName || '-'})】${issue.issueTitle || '-'}</div>
        <div class="issue-desc">问题描述：${issue.issueDescription || '-'}</div>
        <div class="issue-desc">整改建议：${issue.rectificationSuggestion || '-'}</div>
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
      const rectificationPlan = this.generateRectificationPlan(data, isDetailed);
      for (const section of rectificationPlan) {
        html += `<h3>${section.title}</h3>`;
        for (const para of section.content) {
          html += `<p style="margin: 5px 0;">${para}</p>`;
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
          html += `<tr><td class="text-center">${i + 1}</td><td>${asset.name || '-'}</td><td>${categoryName}</td><td>${asset.os || '-'}</td><td>${asset.ip || '-'}</td></tr>`;
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