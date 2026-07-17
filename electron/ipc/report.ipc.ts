import { ipcMain } from 'electron';
import log from 'electron-log';
import { reportService } from '../services/report.service';

export function registerReportHandlers(): void {
  ipcMain.handle('report:generate', async (_event, options: any) => {
    try {
      const filePath = await reportService.generateReport(options);
      return { success: true, data: { filePath } };
    } catch (error: any) {
      log.error('Report generation error:', error);
      return {
        success: false,
        error: {
          code: 'REPORT_GENERATION_ERROR',
          message: error.message || '报告生成失败',
        },
      };
    }
  });
}
