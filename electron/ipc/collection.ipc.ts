import { ipcMain, shell } from 'electron';
import { wrap } from '../utils/ipc-wrapper';
import { validateNotEmpty } from '../utils/validation';
import { validateUserSelectedDir } from '../utils/path-resolver';
import * as collectionService from '../services/collection.service';

export function registerCollectionHandlers(): void {
  ipcMain.handle('collection:listProfiles', wrap(async () => {
    return collectionService.listProfiles();
  }, { moduleName: 'collection', requireSession: true }));

  ipcMain.handle('collection:saveProfile', wrap(async (_event, data: any) => {
    validateNotEmpty(data?.name, '连接名称');
    validateNotEmpty(data?.host, '主机地址');
    if (data?.password && data.password.length > 0 && data.password.length < 6) {
      throw new Error('密码长度不能少于 6 位');
    }
    return collectionService.saveProfile({
      id: data.id,
      name: data.name,
      connType: data.connType,
      host: data.host,
      port: data.port ?? null,
      username: data.username ?? null,
      authMethod: data.authMethod,
      password: data.password,
      privateKeyPath: data.privateKeyPath ?? null,
      timeoutMs: data.timeoutMs,
      extraConfig: data.extraConfig ?? null,
      assetId: data.assetId ?? null,
    });
  }, { moduleName: 'collection', requireSession: true }));

  ipcMain.handle('collection:deleteProfile', wrap(async (_event, id: string) => {
    validateNotEmpty(id, '连接配置ID');
    return collectionService.deleteProfile(id);
  }, { moduleName: 'collection', requireSession: true }));

  ipcMain.handle('collection:batchDeleteProfiles', wrap(async (_event, ids: string[]) => {
    if (!Array.isArray(ids) || ids.length === 0) {
      throw new Error('请提供要删除的连接配置ID数组');
    }
    return collectionService.batchDeleteProfiles(ids);
  }, { moduleName: 'collection', requireSession: true }));

  ipcMain.handle('collection:testConnection', wrap(async (_event, id: string) => {
    validateNotEmpty(id, '连接配置ID');
    return collectionService.testConnection(id);
  }, { moduleName: 'collection', requireSession: true }));

  ipcMain.handle('collection:testConnectionWithProfile', wrap(async (_event, data: any) => {
    validateNotEmpty(data?.name, '连接名称');
    validateNotEmpty(data?.host, '主机地址');
    if (data?.password && data.password.length > 0 && data.password.length < 6) {
      throw new Error('密码长度不能少于 6 位');
    }
    return collectionService.testConnectionWithProfile({
      id: data.id,
      name: data.name,
      connType: data.connType,
      host: data.host,
      port: data.port ?? null,
      username: data.username ?? null,
      authMethod: data.authMethod,
      password: data.password,
      privateKeyPath: data.privateKeyPath ?? null,
      timeoutMs: data.timeoutMs,
      extraConfig: data.extraConfig ?? null,
      assetId: data.assetId ?? null,
    });
  }, { moduleName: 'collection', requireSession: true }));

  ipcMain.handle('collection:createTask', wrap(async (event, data: any) => {
    validateNotEmpty(data?.projectId, '项目ID');
    // assetId 允许为空：连接配置可不关联资产（手动目标），collectionTasks.assetId 为 NOT NULL，空串可正常写入
    validateNotEmpty(data?.connectionId, '连接配置ID');
    if (!Array.isArray(data?.commandIds) || data.commandIds.length === 0) {
      throw new Error('请至少选择一条核查命令');
    }
    return collectionService.createTask({
      projectId: data.projectId,
      assetId: data.assetId,
      connectionId: data.connectionId,
      commandIds: data.commandIds,
    }, event.sender);
  }, { moduleName: 'collection', requireSession: true }));

  ipcMain.handle('collection:cancelTask', wrap(async (_event, id: string) => {
    validateNotEmpty(id, '任务ID');
    return collectionService.cancelTask(id);
  }, { moduleName: 'collection', requireSession: true }));

  ipcMain.handle('collection:deleteTask', wrap(async (_event, id: string) => {
    validateNotEmpty(id, '任务ID');
    return collectionService.deleteTask(id);
  }, { moduleName: 'collection', requireSession: true }));

  ipcMain.handle('collection:getTask', wrap(async (_event, id: string) => {
    validateNotEmpty(id, '任务ID');
    return collectionService.getTask(id);
  }, { moduleName: 'collection', requireSession: true }));

  ipcMain.handle('collection:listTasks', wrap(async (_event, data: any) => {
    validateNotEmpty(data?.projectId, '项目ID');
    return collectionService.listTasks({ projectId: data.projectId, assetId: data.assetId });
  }, { moduleName: 'collection', requireSession: true }));

  ipcMain.handle('collection:listResults', wrap(async (_event, taskId: string) => {
    validateNotEmpty(taskId, '任务ID');
    return collectionService.listResults(taskId);
  }, { moduleName: 'collection', requireSession: true }));

  ipcMain.handle('collection:confirmResult', wrap(async (_event, data: any) => {
    validateNotEmpty(data?.resultId, '采集结果ID');
    validateNotEmpty(data?.projectId, '项目ID');
    validateNotEmpty(data?.itemId, '测评项ID');
    validateNotEmpty(data?.assetId, '资产ID');
    validateNotEmpty(data?.result, '符合性结论');
    return collectionService.confirmResult({
      resultId: data.resultId,
      projectId: data.projectId,
      itemId: data.itemId,
      assetId: data.assetId,
      result: data.result,
      method: data.method,
      evidence: data.evidence,
    });
  }, { moduleName: 'collection', requireSession: true }));

  ipcMain.handle('collection:saveDocument', wrap(async (_event, data: any) => {
    validateNotEmpty(data?.taskId, '任务ID');
    validateNotEmpty(data?.dirPath, '保存目录');
    // 用户自选的导出目录：允许 appData 之外（否则无法导出到桌面/移动盘），
    // 但拒绝磁盘根目录与系统保护目录，避免渲染层被挟持后往系统路径写文件。
    const dirPath = validateUserSelectedDir(data.dirPath, '保存目录');
    return collectionService.saveDocument({ taskId: data.taskId, dirPath });
  }, { moduleName: 'collection', requireSession: true }));

  ipcMain.handle('collection:listDocuments', wrap(async (_event, projectId: string) => {
    validateNotEmpty(projectId, '项目ID');
    return collectionService.listDocuments(projectId);
  }, { moduleName: 'collection', requireSession: true }));

  ipcMain.handle('collection:deleteDocument', wrap(async (_event, id: string) => {
    validateNotEmpty(id, '文档ID');
    return collectionService.deleteDocument(id);
  }, { moduleName: 'collection', requireSession: true }));

  ipcMain.handle('collection:openDocumentDir', wrap(async (_event, filePath: string) => {
    validateNotEmpty(filePath, '文件路径');
    shell.showItemInFolder(filePath);
    return;
  }, { moduleName: 'collection', requireSession: true }));

  ipcMain.handle('collection:exportLocalScript', wrap(async (_event, data: any) => {
    if (!Array.isArray(data?.commandIds) || data.commandIds.length === 0) {
      throw new Error('请至少选择一条核查命令');
    }
    return collectionService.exportLocalScript({
      host: typeof data?.host === 'string' ? data.host : '',
      commandIds: data.commandIds.map((id: unknown) => String(id)),
    });
  }, { moduleName: 'collection', requireSession: true }));

  ipcMain.handle('collection:importLocalResults', wrap(async (_event, data: any) => {
    validateNotEmpty(data?.projectId, '项目ID');
    // 本地采集为手动投放兜底模式，不建立远程连接，connectionId 可为空串（无需勾选连接配置）。
    // 仅校验其为字符串类型（允许空串），不再强制非空。
    if (typeof data?.connectionId !== 'string') {
      throw new Error('连接配置ID类型不合法');
    }
    if (typeof data?.jsonContent !== 'string' || data.jsonContent.length === 0) {
      throw new Error('请提供本地采集结果文件内容');
    }
    return collectionService.importLocalResults({
      projectId: data.projectId,
      assetId: typeof data?.assetId === 'string' ? data.assetId : '',
      connectionId: data.connectionId,
      jsonContent: data.jsonContent,
    });
  }, { moduleName: 'collection', requireSession: true }));
}