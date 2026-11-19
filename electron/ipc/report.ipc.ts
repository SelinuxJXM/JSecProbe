import { ipcMain } from 'electron';
import { reportService } from '../services/report.service';
import type { ProjectReportOptions } from '../services/report.service';
import { wrap } from '../utils/ipc-wrapper';
import { validateUserSelectedDir } from '../utils/path-resolver';
import * as path from 'path';

/**
 * 报告导出路径防御：savePath 此前完全由渲染层控制，XSS 挟持后可写磁盘任意位置。
 * 这里复用「用户对话框选目录」的白名单校验（挡根目录/系统保护目录/空字节），
 * 并把校验后的目录与原始文件名重新拼回，避免改变用户选的文件名。
 */
function validateReportSavePath(savePath: string): string {
  if (!savePath) throw new Error('导出路径不能为空');
  const dir = validateUserSelectedDir(path.dirname(savePath), '导出目录');
  const base = path.basename(savePath);
  if (!base || base === '.' || base === '..') throw new Error('导出文件名无效');
  return path.join(dir, base);
}

export function registerReportHandlers(): void {
  ipcMain.handle('report:generate', wrap(async (_event, options: any) => {
    if (options?.savePath) options.savePath = validateReportSavePath(options.savePath);
    const filePath = await reportService.generateReport(options);
    return { filePath };
  }, { moduleName: 'report', requireSession: true }));

  // 项目级合册报告：项目综述 + 各系统分册装订，groupId 对应 project_groups.id
  ipcMain.handle('report:generateProject', wrap(async (_event, options: ProjectReportOptions) => {
    if (options?.savePath) (options as any).savePath = validateReportSavePath(options.savePath);
    const filePath = await reportService.generateProjectReport(options);
    return { filePath };
  }, { moduleName: 'report', requireSession: true }));
}
