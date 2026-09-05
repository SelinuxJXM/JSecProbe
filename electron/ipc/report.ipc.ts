import { ipcMain } from 'electron';
import { reportService } from '../services/report.service';
import { wrap } from '../utils/ipc-wrapper';

export function registerReportHandlers(): void {
  ipcMain.handle('report:generate', wrap(async (_event, options: any) => {
    const filePath = await reportService.generateReport(options);
    return { filePath };
  }, { moduleName: 'report', requireSession: true }));
}
