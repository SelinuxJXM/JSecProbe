import { ipcMain, shell } from 'electron';
import { wrap } from '../utils/ipc-wrapper';
import { validateNotEmpty } from '../utils/validation';
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

  ipcMain.handle('collection:createTask', wrap(async (event, data: any) => {
    validateNotEmpty(data?.projectId, '项目ID');
    validateNotEmpty(data?.assetId, '资产ID');
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
    return collectionService.saveDocument({ taskId: data.taskId, dirPath: data.dirPath });
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
}