import { ipcMain, dialog } from 'electron';
import * as fs from 'fs';
import { wrap } from '../utils/ipc-wrapper';
import { validateReadablePath, authorizeUserFiles } from '../utils/path-resolver';
import * as service from '../services/checkpoint.service';
import type { PreviewRow } from '../services/checkpoint.service';

/**
 * 测评点知识库 IPC：导入赛飞指导书 + 管理。
 * 导入文件必须经用户对话框选过（validateReadablePath 内部校验 isUserAuthorizedFile）。
 */
export function registerCheckpointHandlers(): void {
  // 选择指导书文件（用户对话框登记，后续 import 才能读）
  ipcMain.handle('checkpoint:pickFile', wrap(async () => {
    const res = await dialog.showOpenDialog({
      title: '选择等保测评作业指导书（Excel）',
      filters: [{ name: 'Excel 文件', extensions: ['xlsx'] }],
      properties: ['openFile', 'multiSelections'],
    });
    if (res.canceled) return { paths: [] };
    // S1：必须登记授权，否则 preview 的 validateReadablePath 会拒绝桌面/下载目录的文件
    authorizeUserFiles(res.filePaths);
    return { paths: res.filePaths.filter(p => fs.existsSync(p) && p.toLowerCase().endsWith('.xlsx')) };
  }, { moduleName: 'checkpoint', requireRole: ['admin'] }));

  // 下载统一导入模板（用户选保存位置）
  ipcMain.handle('checkpoint:downloadTemplate', wrap(async () => {
    const res = await dialog.showSaveDialog({
      title: '保存测评点统一导入模板',
      defaultPath: '测评点导入模板.xlsx',
      filters: [{ name: 'Excel 文件', extensions: ['xlsx'] }],
    });
    if (res.canceled || !res.filePath) return { canceled: true };
    await service.generateImportTemplate(res.filePath);
    return { canceled: false, path: res.filePath };
  }, { moduleName: 'checkpoint', requireRole: ['admin'] }));

  // 预览一个文件（只读解析，返回匹配结果供前端审查）
  ipcMain.handle('checkpoint:preview', wrap(async (_event, filePath: string) => {
    const safePath = await validateReadablePath(filePath, '指导书文件');
    return await service.previewCheckpointFile(safePath);
  }, { moduleName: 'checkpoint', requireRole: ['admin'] }));

  // 确认落库（前端可编辑/剔除行）
  ipcMain.handle('checkpoint:commit', wrap(async (_event, rows: PreviewRow[], clearFirst?: boolean) => {
    if (!Array.isArray(rows)) throw new Error('导入数据无效');
    // S5：clear 并入 commit 的同一事务（service 内部处理）
    return service.commitCheckpointRows(rows, clearFirst === true);
  }, { moduleName: 'checkpoint', requireRole: ['admin'] }));

  // 统计
  ipcMain.handle('checkpoint:stats', wrap(async () => service.listCheckpointStats(), { moduleName: 'checkpoint', requireRole: ['admin'] }));

  // 库内记录列表（导入后管理：编辑/删除用）
  ipcMain.handle('checkpoint:list', wrap(async (_event, keyword?: string) => service.listCheckpoints(keyword), { moduleName: 'checkpoint', requireRole: ['admin'] }));

  // 单条更新（服务端重算语义键）
  ipcMain.handle('checkpoint:update', wrap(async (_event, input: any) => {
    if (!input?.id || typeof input.id !== 'string') throw new Error('缺少记录 ID');
    return service.updateCheckpointRow(input);
  }, { moduleName: 'checkpoint', requireRole: ['admin'] }));

  // 单条删除
  ipcMain.handle('checkpoint:delete', wrap(async (_event, id: string) => {
    if (typeof id !== 'string' || !id) throw new Error('缺少记录 ID');
    return { ok: service.deleteCheckpointRow(id) };
  }, { moduleName: 'checkpoint', requireRole: ['admin'] }));

  // 清空（重新导入前）
  ipcMain.handle('checkpoint:clear', wrap(async () => {
    const removed = service.clearCheckpoints();
    return { removed };
  }, { moduleName: 'checkpoint', requireRole: ['admin'] }));
}
