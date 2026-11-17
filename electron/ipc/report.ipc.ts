import { ipcMain } from 'electron';
import { reportService } from '../services/report.service';
import type { ProjectReportOptions } from '../services/report.service';
import { wrap } from '../utils/ipc-wrapper';

export function registerReportHandlers(): void {
  ipcMain.handle('report:generate', wrap(async (_event, options: any) => {
    const filePath = await reportService.generateReport(options);
    return { filePath };
  }, { moduleName: 'report', requireSession: true }));

  // 项目级合册报告：项目综述 + 各系统分册装订，groupId 对应 project_groups.id
  ipcMain.handle('report:generateProject', wrap(async (_event, options: ProjectReportOptions) => {
    const filePath = await reportService.generateProjectReport(options);
    return { filePath };
  }, { moduleName: 'report', requireSession: true }));
}
