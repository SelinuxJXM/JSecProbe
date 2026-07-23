import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';
import * as fs from 'fs';

const ipc = <T = any>(channel: string) => (...args: any[]): Promise<T> => ipcRenderer.invoke(channel, ...args);

const updateService = {
  check: ipc<void>('update:check'),
  download: ipc<void>('update:download'),
  install: ipc<void>('update:install'),
  getStatus: ipc<any>('update:getStatus'),
  getCurrentVersion: ipc<string>('update:getCurrentVersion'),
  onStatusChange: (callback: (status: any) => void) => {
    const handler = (_e: IpcRendererEvent, status: any) => callback(status);
    ipcRenderer.on('update:status', handler);
    return () => ipcRenderer.removeListener('update:status', handler);
  },
  onDownloadProgress: (callback: (info: any) => void) => {
    const handler = (_e: IpcRendererEvent, info: any) => callback(info);
    ipcRenderer.on('update:progress', handler);
    return () => ipcRenderer.removeListener('update:progress', handler);
  },
};

const aiService = {
  chat: ipc<{ content: string; suggestions: string[] }>('ai:chat'),
  analyzeAssessment: ipc<{ content: string }>('ai:analyzeAssessment'),
  batchAnalyzeScreenshots: ipc<{ content: string }>('ai:batchAnalyzeScreenshots'),
  analyzeIssue: ipc<{ content: string }>('ai:analyzeIssue'),
  batchAnalyzeIssues: ipc<{ results: Array<{ issueId: string; suggestion: string; success: boolean; error?: string }> }>('ai:batchAnalyzeIssues'),
  getConfig: ipc<any>('ai:getConfig'),
  saveConfig: ipc<void>('ai:saveConfig'),
  testConnection: ipc<any>('ai:testConnection'),
  getProgress: ipc<{ stage: string; message: string; percent: number; timestamp: number } | null>('ai:getProgress'),
  onAnalysisProgress: (callback: (data: { stage: string; message: string; percent: number }) => void) => {
    const handler = (_e: IpcRendererEvent, data: any) => callback(data);
    ipcRenderer.on('ai:progress', handler);
    return () => ipcRenderer.removeListener('ai:progress', handler);
  },
  onBatchIssueProgress: (callback: (data: { stage: string; message: string; percent: number; current: number; total: number }) => void) => {
    const handler = (_e: IpcRendererEvent, data: any) => callback(data);
    ipcRenderer.on('ai:batchIssueProgress', handler);
    return () => ipcRenderer.removeListener('ai:batchIssueProgress', handler);
  },
};

const api = {
  auth: {
    login: ipc<any>('auth:login'),
    logout: ipc<void>('auth:logout'),
    getCurrentUser: ipc<{ userId: string; username: string } | null>('auth:getCurrentUser'),
    changePassword: ipc<void>('auth:changePassword'),
    validateSession: ipc<{ valid: boolean; userId?: string; username?: string }>('auth:validateSession'),
  },
  project: {
    list: ipc<any>('project:list'),
    get: ipc<any>('project:get'),
    getStatistics: ipc<any>('project:getStatistics'),
    create: ipc<any>('project:create'),
    update: ipc<any>('project:update'),
    remove: ipc<void>('project:remove'),
    import: ipc<{ imported: number }>('project:import'),
    export: ipc<{ path: string }>('project:export'),
    exportAll: ipc<{ path: string }>('project:exportAll'),
  },
  asset: {
    list: ipc<any>('asset:list'),
    create: ipc<any>('asset:create'),
    update: ipc<any>('asset:update'),
    remove: ipc<void>('asset:remove'),
    batchRemove: ipc<void>('asset:batchRemove'),
    importExcel: ipc<{ count: number; category?: string }>('asset:importExcel'),
    exportExcel: ipc<string>('asset:exportExcel'),
    downloadTemplate: ipc<string>('asset:downloadTemplate'),
  },
  standard: {
    list: ipc<any>('standard:list'),
    getDomains: ipc<any>('standard:getDomains'),
    getItems: ipc<any>('standard:getItems'),
    setDefault: ipc<void>('standard:setDefault'),
    remove: ipc<void>('standard:remove'),
  },
  assessment: {
    getItems: ipc<any>('assessment:getItems'),
    getItemsByCategory: ipc<any>('assessment:getItemsByCategory'),
    getRecords: ipc<any>('assessment:getRecords'),
    getRecordsByAsset: ipc<any>('assessment:getRecordsByAsset'),
    getRecordByAssetAndItem: ipc<any>('assessment:getRecordByAssetAndItem'),
    getRecordsByDomain: ipc<any>('assessment:getRecordsByDomain'),
    saveRecord: ipc<any>('assessment:saveRecord'),
    getProgress: ipc<any>('assessment:getProgress'),
    listDomains: ipc<any>('assessment:listDomains'),
    exportExcel: ipc<any>('assessment:exportExcel'),
    exportExcelByAssets: ipc<any>('assessment:exportExcelByAssets'),
    importExcel: ipc<any>('assessment:importExcel'),
  },
  screenshot: {
    upload: ipc<{ path: string; name: string }>('screenshot:upload'),
    saveFromBase64: ipc<{ path: string; name: string }>('screenshot:saveFromBase64'),
    getBase64: ipc<{ base64: string; mimeType: string }>('screenshot:getBase64'),
    uploadFile: ipc<{ path: string; name: string }>('screenshot:uploadFile'),
    readText: ipc<{ content: string }>('screenshot:readText'),
    readWord: ipc<{ content: string }>('screenshot:readWord'),
    deleteFile: ipc<void>('screenshot:deleteFile'),
  },
  issue: {
    list: ipc<any>('issue:list'),
    get: ipc<any>('issue:get'),
    create: ipc<string>('issue:create'),
    update: ipc<void>('issue:update'),
    remove: ipc<void>('issue:remove'),
    generateFromRecords: ipc<{ count: number }>('issue:generateFromRecords'),
    getSummary: ipc<any>('issue:getSummary'),
    exportExcel: ipc<string>('issue:exportExcel'),
    batchRemove: ipc<void>('issue:batchRemove'),
    batchUpdateStatus: ipc<void>('issue:batchUpdateStatus'),
    updateEvidence: ipc<void>('issue:updateEvidence'),
    importExcel: ipc<{ count: number }>('issue:importExcel'),
    downloadTemplate: ipc<string>('issue:downloadTemplate'),
  },
  report: {
    generate: ipc<{ filePath: string }>('report:generate'),
  },
  knowledge: {
    listCategories: ipc<any>('knowledge:listCategories'),
    listDocuments: ipc<{ list: any[]; total: number }>('knowledge:listDocuments'),
    getDocument: ipc<any>('knowledge:getDocument'),
    createDocument: ipc<string>('knowledge:createDocument'),
    updateDocument: ipc<void>('knowledge:updateDocument'),
    deleteDocument: ipc<void>('knowledge:deleteDocument'),
    createCategory: ipc<any>('knowledge:createCategory'),
    updateCategory: ipc<void>('knowledge:updateCategory'),
    deleteCategory: ipc<void>('knowledge:deleteCategory'),
    listCommands: ipc<any>('knowledge:listCommands'),
    createCommand: ipc<string>('knowledge:createCommand'),
    updateCommand: ipc<void>('knowledge:updateCommand'),
    deleteCommand: ipc<void>('knowledge:deleteCommand'),
    favoriteCommand: ipc<void>('knowledge:favoriteCommand'),
    importKnowledge: ipc<{ count: number }>('knowledge:importKnowledge'),
    exportKnowledge: ipc<{ path: string }>('knowledge:exportKnowledge'),
    downloadDocument: ipc<{ path: string; title: string }>('knowledge:downloadDocument'),
    downloadAndSave: ipc<{ saved: boolean; path?: string }>('knowledge:downloadAndSave'),
    uploadDocument: ipc<{ id: string }>('knowledge:uploadDocument'),
    referenceDocument: ipc<void>('knowledge:referenceDocument'),
    importSingleDocument: ipc<{ id: string }>('knowledge:importSingleDocument'),
    listDirectoryFiles: ipc<any[]>('knowledge:listDirectoryFiles'),
    readExcelFile: ipc<{ sheetNames: string[]; columns: string[]; data: any[] }>('knowledge:readExcelFile'),
    readWordFile: ipc<{ html: string }>('knowledge:readWordFile'),
  },
  file: {
    exists: (filePath: string) => fs.existsSync(filePath),
    readAsArrayBuffer: (filePath: string): { success: boolean; data?: number[]; error?: string } => {
      try {
        const buf = fs.readFileSync(filePath);
        return { success: true, data: Array.from(buf) };
      } catch (err: any) {
        return { success: false, error: err.message };
      }
    },
    readAsText: (filePath: string, encoding: BufferEncoding = 'utf-8') => fs.readFileSync(filePath, encoding),
  },
  system: {
    getInfo: ipc<any>('system:getInfo'),
    openDataFolder: ipc<void>('system:openDataFolder'),
    selectFile: ipc<string | null>('system:selectFile'),
    saveFile: ipc<string | null>('system:saveFile'),
    backupData: ipc<string>('system:backupData'),
    restoreData: ipc<void>('system:restoreData'),
    previewBackup: ipc<any>('system:previewBackup'),
    listBackups: ipc<any[]>('system:listBackups'),
    changeDataPath: ipc<string>('system:changeDataPath'),
  },
  user: {
    list: ipc<any>('user:list'),
    create: ipc<{ id: string; username: string; realName: string }>('user:create'),
    update: ipc<void>('user:update'),
    delete: ipc<void>('user:delete'),
  },
  log: {
    list: ipc<{ list: any[]; total: number }>('log:list'),
  },
  ai: aiService,
  document: {
    extractText: ipc<{ name: string; content: string }[]>('document:extractText'),
  },
  image: {
    saveScreenshot: ipc<{ filePath: string; fileName: string }>('image:saveScreenshot'),
  },
  dialog: {
    showOpenDialog: ipc<any>('dialog:showOpenDialog'),
    showSaveDialog: ipc<any>('dialog:showSaveDialog'),
    showMessageBox: ipc<any>('dialog:showMessageBox'),
  },
  update: updateService,
  getPath: ipc<string>('system:getPath'),
  shell: {
    openPath: ipc<any>('shell:openPath'),
    openExternal: ipc<any>('shell:openExternal'),
  },
  fs: {
    ensureDir: ipc<void>('fs:ensureDir'),
    writeFile: ipc<void>('fs:writeFile'),
  },

  on(channel: string, callback: (...args: any[]) => void) {
    const handler = (_e: IpcRendererEvent, ...args: any[]) => callback(...args);
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.removeListener(channel, handler);
  },

  sendLog(level: string, message: string) {
    ipcRenderer.send('log:line', { level, message });
  },

  versions: {
    node: () => process.versions.node,
    chrome: () => process.versions.chrome,
    electron: () => process.versions.electron,
  },

  platform: process.platform,
  isPackaged: process.env.NODE_ENV === 'production',
};

contextBridge.exposeInMainWorld('api', api);
