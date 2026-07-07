import { contextBridge, ipcRenderer } from 'electron';
import type { ApiBridge } from '../../shared/types';

const api: ApiBridge = {
  auth: {
    login: (username, password) => 
      ipcRenderer.invoke('auth:login', username, password),
    logout: () => 
      ipcRenderer.invoke('auth:logout'),
    getCurrentUser: () => 
      ipcRenderer.invoke('auth:getCurrentUser'),
    changePassword: (userId, oldPassword, newPassword) =>
      ipcRenderer.invoke('auth:changePassword', userId, oldPassword, newPassword),
  },
  project: {
    list: (params) => 
      ipcRenderer.invoke('project:list', params),
    get: (id) => 
      ipcRenderer.invoke('project:get', id),
    create: (data) => 
      ipcRenderer.invoke('project:create', data),
    update: (id, data) => 
      ipcRenderer.invoke('project:update', id, data),
    remove: (id) => 
      ipcRenderer.invoke('project:remove', id),
    import: () =>
      ipcRenderer.invoke('project:import'),
    export: (projectId) =>
      ipcRenderer.invoke('project:export', projectId),
    exportAll: () =>
      ipcRenderer.invoke('project:exportAll'),
  },
  asset: {
    list: (params) => 
      ipcRenderer.invoke('asset:list', params),
    create: (data) => 
      ipcRenderer.invoke('asset:create', data),
    update: (id, data) => 
      ipcRenderer.invoke('asset:update', id, data),
    remove: (id) => 
      ipcRenderer.invoke('asset:remove', id),
    batchRemove: (ids) => 
      ipcRenderer.invoke('asset:batchRemove', ids),
    importExcel: (projectId, filePath) =>
      ipcRenderer.invoke('asset:importExcel', projectId, filePath),
    exportExcel: (projectId, category) =>
      ipcRenderer.invoke('asset:exportExcel', projectId, category),
  },
  standard: {
    list: () =>
      ipcRenderer.invoke('standard:list'),
    getDomains: (standardId) =>
      ipcRenderer.invoke('standard:getDomains', standardId),
    getItems: (standardId, domain) =>
      ipcRenderer.invoke('standard:getItems', standardId, domain),
    setDefault: (standardId) =>
      ipcRenderer.invoke('standard:setDefault', standardId),
    remove: (standardId) =>
      ipcRenderer.invoke('standard:remove', standardId),
  },
  assessment: {
    getItems: (standardId, domain, projectLevel, extensionType) =>
      ipcRenderer.invoke('assessment:getItems', standardId, domain, projectLevel, extensionType),
    getItemsByCategory: (category, projectLevel, extensionType) =>
      ipcRenderer.invoke('assessment:getItemsByCategory', category, projectLevel, extensionType),
    getRecords: (projectId, itemId) =>
      ipcRenderer.invoke('assessment:getRecords', projectId, itemId),
    getRecordsByAsset: (projectId, assetId) =>
      ipcRenderer.invoke('assessment:getRecordsByAsset', projectId, assetId),
    getRecordByAssetAndItem: (projectId, assetId, itemId) =>
      ipcRenderer.invoke('assessment:getRecordByAssetAndItem', projectId, assetId, itemId),
    getRecordsByDomain: (projectId, domain, projectLevel, extensionType) =>
      ipcRenderer.invoke('assessment:getRecordsByDomain', projectId, domain, projectLevel, extensionType),
    saveRecord: (data) =>
      ipcRenderer.invoke('assessment:saveRecord', data),
    getProgress: (projectId, standardId) =>
      ipcRenderer.invoke('assessment:getProgress', projectId, standardId),
    listDomains: (standardId) =>
      ipcRenderer.invoke('assessment:listDomains', standardId),
    exportExcel: (projectId, domain) =>
      ipcRenderer.invoke('assessment:exportExcel', projectId, domain),
    exportExcelByAssets: (projectId, assetIds, domainIds) =>
      ipcRenderer.invoke('assessment:exportExcelByAssets', projectId, assetIds, domainIds),
    importExcel: (projectId, filePath) =>
      ipcRenderer.invoke('assessment:importExcel', projectId, filePath),
  },
  screenshot: {
    upload: ({ projectId, itemId, filePath }) =>
      ipcRenderer.invoke('screenshot:upload', { projectId, itemId, filePath }),
    saveFromBase64: ({ projectId, itemId, base64Data }) =>
      ipcRenderer.invoke('screenshot:saveFromBase64', { projectId, itemId, base64Data }),
    getBase64: ({ filePath }) =>
      ipcRenderer.invoke('screenshot:getBase64', { filePath }),
    uploadFile: (params: { projectId: string; itemId: string; filePath: string }) =>
      ipcRenderer.invoke('screenshot:uploadFile', params),
    readText: (params: { filePath: string }) =>
      ipcRenderer.invoke('screenshot:readText', params),
    deleteFile: (params: { filePath: string }) =>
      ipcRenderer.invoke('screenshot:deleteFile', params),
  },
  issue: {
    list: (params) =>
      ipcRenderer.invoke('issue:list', params),
    get: (id) =>
      ipcRenderer.invoke('issue:get', id),
    create: (data) =>
      ipcRenderer.invoke('issue:create', data),
    update: (id, data) =>
      ipcRenderer.invoke('issue:update', id, data),
    remove: (id) =>
      ipcRenderer.invoke('issue:remove', id),
    generateFromRecords: (projectId) =>
      ipcRenderer.invoke('issue:generateFromRecords', projectId),
    getSummary: (projectId) =>
      ipcRenderer.invoke('issue:getSummary', projectId),
    exportExcel: (projectId) =>
      ipcRenderer.invoke('issue:exportExcel', projectId),
    batchRemove: (ids) =>
      ipcRenderer.invoke('issue:batchRemove', ids),
    batchUpdateStatus: (ids, status) =>
      ipcRenderer.invoke('issue:batchUpdateStatus', ids, status),
    updateEvidence: (id, evidenceFiles) =>
      ipcRenderer.invoke('issue:updateEvidence', id, evidenceFiles),
    importExcel: (projectId, filePath) =>
      ipcRenderer.invoke('issue:importExcel', projectId, filePath),
  },
  report: {
    generate: (projectId) =>
      ipcRenderer.invoke('report:generate', projectId),
  },
  knowledge: {
    listCategories: () =>
      ipcRenderer.invoke('knowledge:listCategories'),
    listDocuments: (params) =>
      ipcRenderer.invoke('knowledge:listDocuments', params),
    getDocument: (id) =>
      ipcRenderer.invoke('knowledge:getDocument', id),
    createDocument: (data) =>
      ipcRenderer.invoke('knowledge:createDocument', data),
    updateDocument: (id, data) =>
      ipcRenderer.invoke('knowledge:updateDocument', id, data),
    deleteDocument: (id) =>
      ipcRenderer.invoke('knowledge:deleteDocument', id),
    createCategory: (data) =>
      ipcRenderer.invoke('knowledge:createCategory', data),
    updateCategory: (id, data) =>
      ipcRenderer.invoke('knowledge:updateCategory', id, data),
    deleteCategory: (id) =>
      ipcRenderer.invoke('knowledge:deleteCategory', id),
    listCommands: (params) =>
      ipcRenderer.invoke('knowledge:listCommands', params),
    createCommand: (data) =>
      ipcRenderer.invoke('knowledge:createCommand', data),
    updateCommand: (id, data) =>
      ipcRenderer.invoke('knowledge:updateCommand', id, data),
    deleteCommand: (id) =>
      ipcRenderer.invoke('knowledge:deleteCommand', id),
    favoriteCommand: (id, isFavorite) =>
      ipcRenderer.invoke('knowledge:favoriteCommand', id, isFavorite),
    importKnowledge: (filePath) =>
      ipcRenderer.invoke('knowledge:importKnowledge', filePath),
    exportKnowledge: () =>
      ipcRenderer.invoke('knowledge:exportKnowledge'),
    downloadDocument: (id) =>
      ipcRenderer.invoke('knowledge:downloadDocument', id),
    downloadAndSave: (id) =>
      ipcRenderer.invoke('knowledge:downloadAndSave', id),
    uploadDocument: (data) =>
      ipcRenderer.invoke('knowledge:uploadDocument', data),
    referenceDocument: (data) =>
      ipcRenderer.invoke('knowledge:referenceDocument', data),
    importSingleDocument: (data) =>
      ipcRenderer.invoke('knowledge:importSingleDocument', data),
    listDirectoryFiles: (dirPath) =>
      ipcRenderer.invoke('knowledge:listDirectoryFiles', dirPath),
  },
  system: {
    getInfo: () => 
      ipcRenderer.invoke('system:getInfo'),
    openDataFolder: () => 
      ipcRenderer.invoke('system:openDataFolder'),
    selectFile: (filters) =>
      ipcRenderer.invoke('system:selectFile', filters),
    saveFile: (defaultPath, filters) =>
      ipcRenderer.invoke('system:saveFile', defaultPath, filters),
    backupData: (customPath?: string) =>
      ipcRenderer.invoke('system:backupData', customPath),
    restoreData: (backupPath) =>
      ipcRenderer.invoke('system:restoreData', backupPath),
    changeDataPath: (newPath) =>
      ipcRenderer.invoke('system:changeDataPath', newPath),
  },
  user: {
    list: () =>
      ipcRenderer.invoke('user:list'),
    create: (data) =>
      ipcRenderer.invoke('user:create', data),
    update: (id, data) =>
      ipcRenderer.invoke('user:update', id, data),
    delete: (id) =>
      ipcRenderer.invoke('user:delete', id),
  },
  log: {
    list: (params) =>
      ipcRenderer.invoke('log:list', params),
  },
  ai: {
    chat: (params) =>
      ipcRenderer.invoke('ai:chat', params),
    analyzeAssessment: (params) =>
      ipcRenderer.invoke('ai:analyzeAssessment', params),
    batchAnalyzeScreenshots: (params) =>
      ipcRenderer.invoke('ai:batchAnalyzeScreenshots', params),
    getConfig: () =>
      ipcRenderer.invoke('ai:getConfig'),
    saveConfig: (config) =>
      ipcRenderer.invoke('ai:saveConfig', config),
    testConnection: (params) =>
      ipcRenderer.invoke('ai:testConnection', params),
    onAnalysisProgress: (callback: (data: any) => void) => {
      const listener = (_event: unknown, data: unknown) => callback(data as any);
      ipcRenderer.on('ai:analysisProgress', listener);
      return () => ipcRenderer.removeListener('ai:analysisProgress', listener);
    },
  },
  document: {
    extractText: (params) =>
      ipcRenderer.invoke('document:extractText', params),
  },
  image: {
    saveScreenshot: (base64Data, fileName) =>
      ipcRenderer.invoke('image:saveScreenshot', base64Data, fileName),
  },
  dialog: {
    showOpenDialog: (options) =>
      ipcRenderer.invoke('dialog:showOpenDialog', options),
    showSaveDialog: (options) =>
      ipcRenderer.invoke('dialog:showSaveDialog', options),
    showMessageBox: (options) =>
      ipcRenderer.invoke('dialog:showMessageBox', options),
  },
  update: {
    check: () =>
      ipcRenderer.invoke('update:check'),
    download: () =>
      ipcRenderer.invoke('update:download'),
    install: () =>
      ipcRenderer.invoke('update:install'),
    getStatus: () =>
      ipcRenderer.invoke('update:getStatus'),
    getCurrentVersion: () =>
      ipcRenderer.invoke('update:getCurrentVersion'),
    onStatusChange: (callback) => {
      const listener = (_event: unknown, status: unknown) => callback(status as any);
      ipcRenderer.on('update:status', listener);
      return () => ipcRenderer.removeListener('update:status', listener);
    },
  },
  getPath: (name: string) =>
    ipcRenderer.invoke('system:getPath', name),
  shell: {
    openPath: (filePath: string) =>
      ipcRenderer.invoke('shell:openPath', filePath),
    openExternal: (filePath: string) =>
      ipcRenderer.invoke('shell:openExternal', filePath),
  },
  fs: {
    ensureDir: (path: string) =>
      ipcRenderer.invoke('fs:ensureDir', path),
    writeFile: (path: string, data: Buffer) =>
      ipcRenderer.invoke('fs:writeFile', path, data),
  },
};

contextBridge.exposeInMainWorld('api', api);
