import * as path from 'path';
import * as fs from 'fs';
import { getDb } from '../db';
import * as schema from '../db/schema';
import { eq, desc, sql } from 'drizzle-orm';
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

    const stats = await db.select({
      total: sql<number>`count(*)`,
      compliant: sql<number>`sum(case when ${schema.assessmentRecords.result} = 'compliant' then 1 else 0 end)`,
      nonCompliant: sql<number>`sum(case when ${schema.assessmentRecords.result} = 'non_compliant' then 1 else 0 end)`,
      partial: sql<number>`sum(case when ${schema.assessmentRecords.result} = 'partial' then 1 else 0 end)`,
    }).from(schema.assessmentRecords).where(eq(schema.assessmentRecords.projectId, projectId));

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
      assessmentStats: stats[0] || { total: 0, compliant: 0, nonCompliant: 0, partial: 0 },
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
            run: { font: 'SimSun', size: 24 },
            paragraph: { spacing: { line: 360 } },
          },
          heading1: {
            run: { font: 'SimHei', size: 36, bold: true },
            paragraph: { spacing: { before: 400, after: 200 } },
          },
          heading2: {
            run: { font: 'SimHei', size: 30, bold: true },
            paragraph: { spacing: { before: 300, after: 150 } },
          },
          heading3: {
            run: { font: 'SimHei', size: 26, bold: true },
            paragraph: { spacing: { before: 200, after: 100 } },
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
                  children: [
                    new TextRun({ text: '等级保护测评报告', font: 'SimSun', size: 18, color: '999999' }),
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
                  children: [
                    new TextRun({ text: '第 ', size: 18 }),
                    new TextRun({ children: [PageNumber.CURRENT], size: 18 }),
                    new TextRun({ text: ' 页 / 共 ', size: 18 }),
                    new TextRun({ children: [PageNumber.TOTAL_PAGES], size: 18 }),
                    new TextRun({ text: ' 页', size: 18 }),
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

    content.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 2000, after: 400 },
        children: [
          new TextRun({ text: '等级保护测评报告', font: 'SimHei', size: 56, bold: true }),
        ],
      })
    );

    if (!isSimple) {
      content.push(
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 200 },
          children: [new TextRun({ text: 'Level Protection Assessment Report', font: 'Times New Roman', size: 28, italics: true })],
        })
      );
    }

    content.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: isSimple ? 2000 : 1000, after: 200 },
        children: [new TextRun({ text: `项目名称：${project?.name || '-'}`, font: 'SimHei', size: 28 })],
      })
    );
    content.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 200 },
        children: [new TextRun({ text: `被测单位：${project?.assessedUnit || '-'}`, font: 'SimHei', size: 28 })],
      })
    );
    content.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 200 },
        children: [new TextRun({ text: `系统名称：${project?.systemName || '-'}`, font: 'SimHei', size: 28 })],
      })
    );
    content.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 200 },
        children: [new TextRun({ text: `安全等级：第 ${project?.level || '-'} 级`, font: 'SimHei', size: 28 })],
      })
    );
    content.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 200 },
        children: [new TextRun({ text: `测评日期：${timestamp}`, font: 'SimHei', size: 28 })],
      })
    );

    content.push(new Paragraph({ children: [new PageBreak()] }));

    if (!isSimple) {
      content.push(
        new Paragraph({
          heading: HeadingLevel.HEADING_1,
          children: [new TextRun({ text: '目  录', font: 'SimHei', size: 36, bold: true })],
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
            spacing: { before: 100, after: 100 },
            tabStops: [{ type: TabStopType.RIGHT, position: TabStopPosition.MAX }],
            children: [
              new TextRun({ text: item, font: 'SimSun', size: 24 }),
              new TextRun({ children: ['\t', '............................'], font: 'SimSun', size: 24 }),
            ],
          })
        );
      }

      content.push(new Paragraph({ children: [new PageBreak()] }));
    }

    content.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_1,
        children: [new TextRun({ text: '一、报告概述', font: 'SimHei', size: 36, bold: true })],
      })
    );
    content.push(
      new Paragraph({
        spacing: { after: 200 },
        children: [
          new TextRun({
            text: `本报告依据GB/T 22239-2019《信息安全技术 网络安全等级保护基本要求》对${project?.systemName || '该系统'}进行等级保护测评。测评工作于${project?.startDate || '近期'}至${project?.endDate || '近期'}进行，涵盖了安全物理环境、安全通信网络、安全区域边界、安全计算环境、安全管理中心、安全管理制度、安全管理机构、安全管理人员、安全建设管理、安全运维管理等十个安全域。`,
            font: 'SimSun',
            size: 24,
          }),
        ],
      })
    );
    content.push(
      new Paragraph({
        spacing: { after: 200 },
        children: [
          new TextRun({
            text: `本次测评共发现安全问题${summary.total}个，其中高风险问题${summary.highRisk}个、中风险问题${summary.mediumRisk}个、低风险问题${summary.lowRisk}个。系统整体合规率为${summary.complianceRate}%。`,
            font: 'SimSun',
            size: 24,
          }),
        ],
      })
    );

    if (isSimple) {
      content.push(new Paragraph({ children: [new PageBreak()] }));
      content.push(
        new Paragraph({
          heading: HeadingLevel.HEADING_1,
          children: [new TextRun({ text: '二、问题清单', font: 'SimHei', size: 36, bold: true })],
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
                  new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: `${idx + 1}`, size: 20 })] })] }),
                  new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: riskLabel, size: 20 })] })] }),
                  new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: domain, size: 20 })] })] }),
                  new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: issue.issueTitle || '-', size: 20 })] })] }),
                ],
              });
            }),
          ],
        });
        content.push(simpleIssueTable);
      } else {
        content.push(
          new Paragraph({
            spacing: { after: 200 },
            children: [new TextRun({ text: '本次测评未发现安全问题。', font: 'SimSun', size: 24 })],
          })
        );
      }

      content.push(new Paragraph({ children: [new PageBreak()] }));
      content.push(
        new Paragraph({
          heading: HeadingLevel.HEADING_1,
          children: [new TextRun({ text: '三、整改建议', font: 'SimHei', size: 36, bold: true })],
        })
      );
      content.push(
        new Paragraph({
          spacing: { after: 200 },
          children: [
            new TextRun({
              text: `建议优先整改高风险问题，中风险问题应在90日内完成整改，低风险问题在日常运维中逐步完善。具体整改建议请参考各问题的详细描述。`,
              font: 'SimSun',
              size: 24,
            }),
          ],
        })
      );

      return content;
    }

    content.push(new Paragraph({ children: [new PageBreak()] }));

    content.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_1,
        children: [new TextRun({ text: '二、项目概况', font: 'SimHei', size: 36, bold: true })],
      })
    );

    const overviewTable = new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [
        this.createTableRow('项目名称', project?.name || '-', '项目编号', project?.projectNo || '-'),
        this.createTableRow('被测单位', project?.assessedUnit || '-', '系统名称', project?.systemName || '-'),
        this.createTableRow('安全等级', `第 ${project?.level || '-'} 级`, '测评标准', project?.standardSystem || 'GB/T 22239-2019'),
        this.createTableRow('测评开始日期', project?.startDate || '-', '测评结束日期', project?.endDate || '-'),
        this.createTableRow('测评人员', project?.assessor || '-', '资产数量', `${assets.length} 台/套`),
      ],
    });
    content.push(overviewTable);

    content.push(new Paragraph({ children: [new PageBreak()] }));

    content.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_1,
        children: [new TextRun({ text: '三、测评方法', font: 'SimHei', size: 36, bold: true })],
      })
    );
    content.push(
      new Paragraph({
        spacing: { after: 200 },
        children: [
          new TextRun({
            text: '本次测评采用访谈、检查和测试三种方法，对各安全域的控制点进行全面评估：',
            font: 'SimSun',
            size: 24,
          }),
        ],
      })
    );
    content.push(
      new Paragraph({
        spacing: { after: 100 },
        children: [
          new TextRun({ text: '（1）访谈：通过与安全管理人员交流，了解安全管理制度和流程的执行情况。', font: 'SimSun', size: 24 }),
        ],
      })
    );
    content.push(
      new Paragraph({
        spacing: { after: 100 },
        children: [
          new TextRun({ text: '（2）检查：对安全策略、制度文档、配置记录等进行文档审查和现场核实。', font: 'SimSun', size: 24 }),
        ],
      })
    );
    content.push(
      new Paragraph({
        spacing: { after: 200 },
        children: [
          new TextRun({ text: '（3）测试：通过技术手段对安全功能进行验证，包括漏洞扫描、配置核查、渗透测试等。', font: 'SimSun', size: 24 }),
        ],
      })
    );

    content.push(new Paragraph({ children: [new PageBreak()] }));

    content.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_1,
        children: [new TextRun({ text: '四、测评结果汇总', font: 'SimHei', size: 36, bold: true })],
      })
    );

    content.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        children: [new TextRun({ text: '4.1 风险评估统计', font: 'SimHei', size: 30, bold: true })],
      })
    );

    const statsTable = new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [
        this.createHeaderRow('统计项', '数量', '占比'),
        this.createTableRow('高风险问题', `${summary.highRisk} 个`, summary.total > 0 ? `${((summary.highRisk / summary.total) * 100).toFixed(1)}%` : '0%'),
        this.createTableRow('中风险问题', `${summary.mediumRisk} 个`, summary.total > 0 ? `${((summary.mediumRisk / summary.total) * 100).toFixed(1)}%` : '0%'),
        this.createTableRow('低风险问题', `${summary.lowRisk} 个`, summary.total > 0 ? `${((summary.lowRisk / summary.total) * 100).toFixed(1)}%` : '0%'),
        this.createTableRow('问题总数', `${summary.total} 个`, '100%'),
        this.createTableRow('系统合规率', `${summary.complianceRate}%`, '-'),
      ],
    });
    content.push(statsTable);

    content.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 300 },
        children: [new TextRun({ text: '4.2 各安全域问题分布', font: 'SimHei', size: 30, bold: true })],
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

    content.push(new Paragraph({ children: [new PageBreak()] }));

    content.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_1,
        children: [new TextRun({ text: '五、总体分析评价', font: 'SimHei', size: 36, bold: true })],
      })
    );

    const overallAnalysis = this.generateOverallAnalysis(data);
    for (const para of overallAnalysis) {
      content.push(
        new Paragraph({
          spacing: { after: 200 },
          children: [new TextRun({ text: para, font: 'SimSun', size: 24 })],
        })
      );
    }

    content.push(new Paragraph({ children: [new PageBreak()] }));

    content.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_1,
        children: [new TextRun({ text: '六、问题清单及分析', font: 'SimHei', size: 36, bold: true })],
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
                new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: `${idx + 1}`, size: 20 })] })] }),
                new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: riskLabel, size: 20 })] })] }),
                new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: domain, size: 20 })] })] }),
                new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: issue.controlPoint || '-', size: 20 })] })] }),
                new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: issue.issueTitle || '-', size: 20 })] })] }),
              ],
            });
          }),
        ],
      });
      content.push(issueTable);

      content.push(
        new Paragraph({
          heading: HeadingLevel.HEADING_2,
          spacing: { before: 300 },
          children: [new TextRun({ text: '6.1 高风险问题详细描述', font: 'SimHei', size: 30, bold: true })],
        })
      );

      const highRiskIssues = issues.filter((i: any) => i.riskLevel === 'high');
      if (highRiskIssues.length > 0) {
        for (const issue of highRiskIssues) {
          content.push(
            new Paragraph({
              spacing: { before: 200, after: 100 },
              children: [
                new TextRun({ text: `【${issue.controlPoint || '-'}-${issue.controlName || '-'}] `, font: 'SimHei', size: 22, bold: true }),
                new TextRun({ text: issue.issueTitle || '-', font: 'SimSun', size: 22 }),
              ],
            })
          );
          content.push(
            new Paragraph({
              spacing: { after: 100 },
              children: [new TextRun({ text: `问题描述：${issue.issueDescription || '-'}`, font: 'SimSun', size: 22 })],
            })
          );
          content.push(
            new Paragraph({
              spacing: { after: 100 },
              children: [new TextRun({ text: `整改建议：${issue.rectificationSuggestion || '-'}`, font: 'SimSun', size: 22 })],
            })
          );
        }
      } else {
        content.push(
          new Paragraph({
            spacing: { after: 200 },
            children: [new TextRun({ text: '本次测评未发现高风险问题。', font: 'SimSun', size: 24 })],
          })
        );
      }

      if (isDetailed) {
        content.push(
          new Paragraph({
            heading: HeadingLevel.HEADING_2,
            spacing: { before: 300 },
            children: [new TextRun({ text: '6.2 中风险问题详细描述', font: 'SimHei', size: 30, bold: true })],
          })
        );

        const mediumRiskIssues = issues.filter((i: any) => i.riskLevel === 'medium');
        if (mediumRiskIssues.length > 0) {
          for (const issue of mediumRiskIssues) {
            content.push(
              new Paragraph({
                spacing: { before: 200, after: 100 },
                children: [
                  new TextRun({ text: `【${issue.controlPoint || '-'}-${issue.controlName || '-'}] `, font: 'SimHei', size: 22, bold: true }),
                  new TextRun({ text: issue.issueTitle || '-', font: 'SimSun', size: 22 }),
                ],
              })
            );
            content.push(
              new Paragraph({
                spacing: { after: 100 },
                children: [new TextRun({ text: `问题描述：${issue.issueDescription || '-'}`, font: 'SimSun', size: 22 })],
              })
            );
            content.push(
              new Paragraph({
                spacing: { after: 100 },
                children: [new TextRun({ text: `整改建议：${issue.rectificationSuggestion || '-'}`, font: 'SimSun', size: 22 })],
              })
            );
          }
        } else {
          content.push(
            new Paragraph({
              spacing: { after: 200 },
              children: [new TextRun({ text: '本次测评未发现中风险问题。', font: 'SimSun', size: 24 })],
            })
          );
        }

        content.push(
          new Paragraph({
            heading: HeadingLevel.HEADING_2,
            spacing: { before: 300 },
            children: [new TextRun({ text: '6.3 低风险问题详细描述', font: 'SimHei', size: 30, bold: true })],
          })
        );

        const lowRiskIssues = issues.filter((i: any) => i.riskLevel === 'low');
        if (lowRiskIssues.length > 0) {
          for (const issue of lowRiskIssues) {
            content.push(
              new Paragraph({
                spacing: { before: 200, after: 100 },
                children: [
                  new TextRun({ text: `【${issue.controlPoint || '-'}-${issue.controlName || '-'}] `, font: 'SimHei', size: 22, bold: true }),
                  new TextRun({ text: issue.issueTitle || '-', font: 'SimSun', size: 22 }),
                ],
              })
            );
            content.push(
              new Paragraph({
                spacing: { after: 100 },
                children: [new TextRun({ text: `问题描述：${issue.issueDescription || '-'}`, font: 'SimSun', size: 22 })],
              })
            );
            content.push(
              new Paragraph({
                spacing: { after: 100 },
                children: [new TextRun({ text: `整改建议：${issue.rectificationSuggestion || '-'}`, font: 'SimSun', size: 22 })],
              })
            );
          }
        } else {
          content.push(
            new Paragraph({
              spacing: { after: 200 },
              children: [new TextRun({ text: '本次测评未发现低风险问题。', font: 'SimSun', size: 24 })],
            })
          );
        }
      }
    }

    content.push(new Paragraph({ children: [new PageBreak()] }));

    content.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_1,
        children: [new TextRun({ text: '七、整改建议及规划', font: 'SimHei', size: 36, bold: true })],
      })
    );

    const rectificationPlan = this.generateRectificationPlan(data, isDetailed);
    for (const section of rectificationPlan) {
      content.push(
        new Paragraph({
          heading: HeadingLevel.HEADING_2,
          children: [new TextRun({ text: section.title, font: 'SimHei', size: 30, bold: true })],
        })
      );
      for (const para of section.content) {
        content.push(
          new Paragraph({
            spacing: { after: 150 },
            children: [new TextRun({ text: para, font: 'SimSun', size: 24 })],
          })
        );
      }
    }

    content.push(new Paragraph({ children: [new PageBreak()] }));

    content.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_1,
        children: [new TextRun({ text: '八、附录', font: 'SimHei', size: 36, bold: true })],
      })
    );
    content.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        children: [new TextRun({ text: '附录A：测评资产清单', font: 'SimHei', size: 30, bold: true })],
      })
    );

    if (assets.length > 0) {
      const assetTable = new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: [
          this.createHeaderRow('序号', '资产名称', '资产类别', '操作系统', 'IP地址'),
          ...assets.map((asset: any, idx: number) => {
            return new TableRow({
              children: [
                new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: `${idx + 1}`, size: 20 })] })] }),
                new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: asset.name || '-', size: 20 })] })] }),
                new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: asset.category || '-', size: 20 })] })] }),
                new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: asset.os || '-', size: 20 })] })] }),
                new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: asset.ip || '-', size: 20 })] })] }),
              ],
            });
          }),
        ],
      });
      content.push(assetTable);
    }

    if (isDetailed) {
      content.push(
        new Paragraph({
          heading: HeadingLevel.HEADING_2,
          spacing: { before: 300 },
          children: [new TextRun({ text: '附录B：测评指标统计', font: 'SimHei', size: 30, bold: true })],
        })
      );

      const { assessmentStats } = data;
      const detailStatsTable = new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: [
          this.createHeaderRow('统计项', '数量', '占比'),
          this.createTableRow('符合项', `${assessmentStats.compliant || 0} 项`, assessmentStats.total > 0 ? `${(((assessmentStats.compliant || 0) / assessmentStats.total) * 100).toFixed(1)}%` : '0%'),
          this.createTableRow('部分符合项', `${assessmentStats.partial || 0} 项`, assessmentStats.total > 0 ? `${(((assessmentStats.partial || 0) / assessmentStats.total) * 100).toFixed(1)}%` : '0%'),
          this.createTableRow('不符合项', `${assessmentStats.nonCompliant || 0} 项`, assessmentStats.total > 0 ? `${(((assessmentStats.nonCompliant || 0) / assessmentStats.total) * 100).toFixed(1)}%` : '0%'),
          this.createTableRow('测评指标总数', `${assessmentStats.total || 0} 项`, '100%'),
        ],
      });
      content.push(detailStatsTable);
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
                children: [new TextRun({ text, font: 'SimHei', size: 22, bold: true, color: 'FFFFFF' })],
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
            children: [new Paragraph({ children: [new TextRun({ text, font: 'SimSun', size: 22 })] })],
          })
      ),
    });
  }

  private generateOverallAnalysis(data: ReportData): string[] {
    const { summary, assessmentStats } = data;
    const paragraphs: string[] = [];

    paragraphs.push(
      `经过全面测评，该系统在${summary.total === 0 ? '各安全域均表现良好' : '部分安全域存在安全问题'}。本次测评共涉及${assessmentStats.total || '若干'}项测评指标，其中符合${assessmentStats.compliant || 0}项、部分符合${assessmentStats.partial || 0}项、不符合${assessmentStats.nonCompliant || 0}项。`
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
      `综合来看，该系统安全防护水平${summary.complianceRate >= 80 ? '较高' : summary.complianceRate >= 60 ? '一般' : '有待提升'}，整体合规率为${summary.complianceRate}%。建议按照本报告提出的整改建议，有计划、有步骤地开展安全整改工作，持续提升系统安全防护能力。`
    );

    return paragraphs;
  }

  private generateRectificationPlan(data: ReportData, isDetailed: boolean): { title: string; content: string[] }[] {
    const { summary } = data;
    const sections: { title: string; content: string[] }[] = [];

    sections.push({
      title: '7.1 整改原则',
      content: [
        '（1）优先整改高风险问题，消除重大安全隐患。',
        '（2）按照风险等级制定分阶段整改计划，确保整改工作有序进行。',
        '（3）整改过程中应确保系统正常运行，避免因整改导致业务中断。',
        '（4）整改完成后应进行验证，确保问题得到彻底解决。',
      ],
    });

    if (summary.highRisk > 0) {
      const highContent = [
        `针对本次测评发现的${summary.highRisk}个高风险问题，建议在30个工作日内完成整改：`,
        '（1）完善安全管理制度体系，制定并发布安全管理策略、制度和操作规程。',
        '（2）加强访问控制管理，实施最小权限原则，定期审查用户权限。',
        '（3）部署安全审计系统，确保关键操作可追溯。',
        '（4）修复已识别的安全漏洞，更新系统补丁和安全配置。',
        '（5）建立安全事件应急响应机制，制定应急预案并定期演练。',
      ];

      if (isDetailed) {
        highContent.push(
          '（6）对相关责任人进行安全培训，提高安全意识和操作技能。',
          '（7）建立整改跟踪机制，每周汇报整改进度，确保按时完成。',
          '（8）整改完成后组织内部验收，形成整改报告存档。'
        );
      }

      sections.push({
        title: '7.2 高风险问题整改方案（立即整改）',
        content: highContent,
      });
    }

    if (summary.mediumRisk > 0) {
      const mediumContent = [
        `针对${summary.mediumRisk}个中风险问题，建议在90个工作日内完成整改：`,
        '（1）优化网络安全架构，合理划分安全区域，部署必要的网络安全设备。',
        '（2）加强数据安全管理，实施数据分类分级，建立数据备份恢复机制。',
        '（3）完善物理安全措施，加强机房环境监控和访问管理。',
        '（4）建立安全培训制度，定期开展安全意识教育和技能培训。',
      ];

      if (isDetailed) {
        mediumContent.push(
          '（5）对现有安全策略进行全面审查和更新，确保符合最新标准要求。',
          '（6）建立安全监控体系，实现7×24小时安全事件监测。',
          '（7）定期开展安全风险评估，及时发现和消除新的安全隐患。',
          '（8）与第三方安全机构建立合作关系，获取专业技术支持。'
        );
      }

      sections.push({
        title: '7.3 中风险问题整改方案（90日内整改）',
        content: mediumContent,
      });
    }

    if (summary.lowRisk > 0) {
      const lowContent = [
        `针对${summary.lowRisk}个低风险问题，建议在180个工作日内完成整改：`,
        '（1）完善系统配置，关闭不必要的服务和端口。',
        '（2）加强日常巡检，及时发现和处理安全事件。',
        '（3）定期更新安全策略，适应业务发展和安全需求变化。',
      ];

      if (isDetailed) {
        lowContent.push(
          '（4）建立安全基线配置标准，确保新系统上线符合安全要求。',
          '（5）开展安全文化建设活动，营造全员参与的安全氛围。',
          '（6）定期组织安全应急演练，提高应急处置能力。',
          '（7）建立安全考核机制，将安全指标纳入绩效考核体系。'
        );
      }

      sections.push({
        title: '7.4 低风险问题整改方案（180日内整改）',
        content: lowContent,
      });
    }

    const longTermContent = [
      '（1）建立常态化的安全评估机制，每年至少开展一次等级保护测评。',
      '（2）持续关注安全威胁动态，及时更新安全防护策略。',
      '（3）加强安全团队建设，配备专职安全管理人员。',
      '（4）推进安全运营中心（SOC）建设，提升安全事件响应能力。',
      '（5）定期开展安全演练，验证安全防护措施的有效性。',
    ];

    if (isDetailed) {
      longTermContent.push(
        '（6）关注等级保护2.0标准动态，提前做好合规准备。',
        '（7）探索零信任安全架构，逐步实现动态访问控制。',
        '（8）建立安全投入保障机制，确保安全经费持续投入。',
        '（9）参与行业安全交流，学习先进安全管理经验。',
        '（10）建立安全创新机制，鼓励安全技术应用创新。'
      );
    }

    sections.push({
      title: '7.5 长期安全规划',
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

    // 生成HTML内容
    const htmlContent = this.generateHtmlContent(data, projectName, timestamp, options, isSimple, isDetailed);

    // 创建隐藏的BrowserWindow来渲染HTML
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

    // 加载HTML
    await hiddenWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(htmlContent)}`);

    // 等待渲染完成
    await new Promise(resolve => setTimeout(resolve, 1000));

    // 打印为PDF
    const pdfBuffer = await hiddenWindow.webContents.printToPDF({
      marginsType: 1,
      pageSize: 'A4',
      printBackground: true,
      printSelectionOnly: false,
      landscape: false,
    });

    // 关闭隐藏窗口
    hiddenWindow.close();

    // 保存PDF
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
    body { font-family: "SimSun", "Microsoft YaHei", serif; font-size: 14px; line-height: 1.8; color: #333; padding: 40px; }
    h1 { text-align: center; font-size: 24px; margin-bottom: 30px; }
    h2 { font-size: 18px; margin: 20px 0 10px; border-bottom: 2px solid #1B5FD9; padding-bottom: 5px; }
    h3 { font-size: 16px; margin: 15px 0 8px; }
    .cover { text-align: center; padding-top: 100px; }
    .cover h1 { font-size: 28px; margin-bottom: 50px; }
    .cover p { font-size: 16px; margin: 15px 0; }
    .toc { margin: 20px 0; }
    .toc-item { padding: 5px 0; border-bottom: 1px dotted #ccc; }
    table { width: 100%; border-collapse: collapse; margin: 15px 0; }
    th, td { border: 1px solid #ddd; padding: 8px 12px; text-align: left; }
    th { background: #1B5FD9; color: #fff; font-weight: bold; }
    tr:nth-child(even) { background: #f9f9f9; }
    .text-center { text-align: center; }
    .text-right { text-align: right; }
    .risk-high { color: #f56c6c; font-weight: bold; }
    .risk-medium { color: #e6a23c; font-weight: bold; }
    .risk-low { color: #67c23a; font-weight: bold; }
    .issue-item { margin: 15px 0; padding: 15px; background: #f5f7fa; border-left: 4px solid #1B5FD9; }
    .issue-title { font-weight: bold; margin-bottom: 8px; }
    .issue-desc { margin: 5px 0; }
    .page-break { page-break-after: always; }
    .footer { text-align: center; margin-top: 30px; font-size: 12px; color: #999; }
  </style>
</head>
<body>`;

    // 封面
    if (options.includeSections.includes('cover')) {
      html += `
    <div class="cover">
      <h1>等级保护测评报告</h1>
      <p>项目名称：${project?.name || '-'}</p>
      <p>被测单位：${project?.assessedUnit || '-'}</p>
      <p>系统名称：${project?.systemName || '-'}</p>
      <p>安全等级：第 ${project?.level || '-'} 级</p>
      <p>测评日期：${timestamp}</p>
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
    <p>本报告依据GB/T 22239-2019《信息安全技术 网络安全等级保护基本要求》对${project?.systemName || '该系统'}进行等级保护测评。测评工作于${project?.startDate || '近期'}至${project?.endDate || '近期'}进行，涵盖了安全物理环境、安全通信网络、安全区域边界、安全计算环境、安全管理中心、安全管理制度、安全管理机构、安全管理人员、安全建设管理、安全运维管理等十个安全域。</p>
    <p>本次测评共发现安全问题${summary.total}个，其中高风险问题${summary.highRisk}个、中风险问题${summary.mediumRisk}个、低风险问题${summary.lowRisk}个。系统整体合规率为${summary.complianceRate}%。</p>
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
      <tr><td>测评开始日期</td><td>${project?.startDate || '-'}</td><td>测评结束日期</td><td>${project?.endDate || '-'}</td></tr>
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
      <tr><th>统计项</th><th>数量</th><th>占比</th></tr>
      <tr><td class="risk-high">高风险问题</td><td>${summary.highRisk} 个</td><td>${summary.total > 0 ? ((summary.highRisk / summary.total) * 100).toFixed(1) : '0'}%</td></tr>
      <tr><td class="risk-medium">中风险问题</td><td>${summary.mediumRisk} 个</td><td>${summary.total > 0 ? ((summary.mediumRisk / summary.total) * 100).toFixed(1) : '0'}%</td></tr>
      <tr><td class="risk-low">低风险问题</td><td>${summary.lowRisk} 个</td><td>${summary.total > 0 ? ((summary.lowRisk / summary.total) * 100).toFixed(1) : '0'}%</td></tr>
      <tr><td>问题总数</td><td>${summary.total} 个</td><td>100%</td></tr>
      <tr><td>系统合规率</td><td>${summary.complianceRate}%</td><td>-</td></tr>
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
        html += `<p style="text-indent: 2em; margin: 10px 0;">${para}</p>`;
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

        // 高风险问题详细描述
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
          html += `<tr><td class="text-center">${i + 1}</td><td>${asset.name || '-'}</td><td>${asset.category || '-'}</td><td>${asset.os || '-'}</td><td>${asset.ip || '-'}</td></tr>`;
        }
        html += `</table>`;
      }

      if (isDetailed) {
        html += `
    <h3>附录B：测评指标统计</h3>
    <table>
      <tr><th>统计项</th><th>数量</th><th>占比</th></tr>
      <tr><td>符合项</td><td>${data.assessmentStats?.compliant || 0} 项</td><td>${data.assessmentStats?.total > 0 ? (((data.assessmentStats?.compliant || 0) / data.assessmentStats.total) * 100).toFixed(1) : '0'}%</td></tr>
      <tr><td>部分符合项</td><td>${data.assessmentStats?.partial || 0} 项</td><td>${data.assessmentStats?.total > 0 ? (((data.assessmentStats?.partial || 0) / data.assessmentStats.total) * 100).toFixed(1) : '0'}%</td></tr>
      <tr><td>不符合项</td><td>${data.assessmentStats?.nonCompliant || 0} 项</td><td>${data.assessmentStats?.total > 0 ? (((data.assessmentStats?.nonCompliant || 0) / data.assessmentStats.total) * 100).toFixed(1) : '0'}%</td></tr>
      <tr><td>测评指标总数</td><td>${data.assessmentStats?.total || 0} 项</td><td>100%</td></tr>
    </table>`;
      }
    }

    html += `
  </body>
</html>`;

    return html;
  }
}

export const reportService = new ReportService();
