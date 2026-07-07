import { ipcMain } from 'electron';
import log from 'electron-log';
import { getDb } from '../db';
import * as schema from '../db/schema';
import { eq } from 'drizzle-orm';
import jsPDF from 'jspdf';
import 'jspdf-autotable';

function wrap<T>(fn: () => T | Promise<T>): Promise<any> {
  return Promise.resolve()
    .then(fn)
    .then((data) => ({ success: true, data }))
    .catch((error) => {
      log.error('Report IPC Error:', error);
      return {
        success: false,
        error: {
          code: error.code || 'INTERNAL_ERROR',
          message: error.message || '操作失败',
        },
      };
    });
}

export function registerReportHandlers(): void {
  ipcMain.handle('report:generate', (_event, projectId: string) =>
    wrap<string>(async () => {
      const db = getDb();

      // 获取项目信息
      const project = await db.query.projects.findFirst({
        where: eq(schema.projects.id, projectId),
      });
      if (!project) throw new Error('项目不存在');

      // 获取测评记录
      const records = await db
        .select()
        .from(schema.assessmentRecords)
        .where(eq(schema.assessmentRecords.projectId, projectId))
        .orderBy(schema.assessmentRecords.createdAt);

      // 获取问题列表
      const issues = await db
        .select()
        .from(schema.issues)
        .where(eq(schema.issues.projectId, projectId));

      // 创建 PDF
      const doc = new jsPDF();

      // 标题
      doc.setFontSize(20);
      doc.text(`等级保护测评报告`, 105, 20, { align: 'center' });

      // 项目信息
      doc.setFontSize(12);
      doc.text(`项目名称: ${project.name}`, 20, 40);
      doc.text(`系统名称: ${project.systemName}`, 20, 50);
      doc.text(`保护等级: 第${project.level}级`, 20, 60);
      doc.text(`测评时间: ${new Date().toLocaleDateString('zh-CN')}`, 20, 70);

      // 测评结果统计
      let compliantCount = 0;
      let nonCompliantCount = 0;
      records.forEach(r => {
        if (r.result === 'compliant' || r.result === 'conform') compliantCount++;
        else if (r.result === 'non_compliant' || r.result === 'nonconform') nonCompliantCount++;
      });

      doc.text(`测评项总数: ${records.length}`, 20, 90);
      doc.text(`符合项: ${compliantCount}`, 20, 100);
      doc.text(`不符合项: ${nonCompliantCount}`, 20, 110);

      // 问题列表
      if (issues.length > 0) {
        doc.text('问题清单:', 20, 130);
        const issueData = issues.map((issue, index) => [
          index + 1,
          issue.issueTitle,
          issue.riskLevel,
          issue.status,
        ]);
        (doc as any).autoTable({
          startY: 135,
          head: [['序号', '问题标题', '风险等级', '状态']],
          body: issueData,
        });
      }

      // 保存 PDF
      const path = require('path');
      const fs = require('fs');
      const appDataPath = process.env.APPDATA || path.join(process.env.HOME || '', '.config');
      const reportsDir = path.join(appDataPath, 'mlps', 'reports');
      fs.mkdirSync(reportsDir, { recursive: true });

      const fileName = `report_${project.name}_${Date.now()}.pdf`;
      const filePath = path.join(reportsDir, fileName);
      doc.save(filePath);

      return filePath;
    })
  );
}