import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';
import type { User } from '../../shared/types';

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
  chat: ipc<{ content: string; suggestions: string[]; modelName?: string; switched?: boolean }>('ai:chat'),
  analyzeAssessment: ipc<{ content: string }>('ai:analyzeAssessment'),
  batchAnalyzeScreenshots: ipc<{ content: string }>('ai:batchAnalyzeScreenshots'),
  analyzeIssue: ipc<{ content: string }>('ai:analyzeIssue'),
  analyzeIssueDescription: ipc<{ content: string }>('ai:analyzeIssueDescription'),
  batchAnalyzeIssues: ipc<{ results: Array<{ issueId: string; suggestion: string; success: boolean; error?: string }> }>('ai:batchAnalyzeIssues'),
  getConfig: ipc<any>('ai:getConfig'),
  saveConfig: ipc<void>('ai:saveConfig'),
  testConnection: ipc<any>('ai:testConnection'),
  getProgress: ipc<{ stage: string; message: string; percent: number; timestamp: number } | null>('ai:getProgress'),
  // 多模型管理
  getModels: ipc<{ models: Array<{ id: string; name: string; apiBase: string; model: string; apiFormat: string; enabled: boolean; priority: number }>; activeModelId: string | null }>('ai:getModels'),
  createModel: ipc<{ id: string }>('ai:createModel'),
  updateModel: ipc<void>('ai:updateModel'),
  deleteModel: ipc<void>('ai:deleteModel'),
  setActiveModel: ipc<void>('ai:setActiveModel'),
  testModelConnection: ipc<any>('ai:testModelConnection'),
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
    validateSession: ipc<{ valid: boolean; userId?: string; username?: string; user?: User }>('auth:validateSession'),
    encryptCredential: ipc<{ encrypted: string }>('auth:encryptCredential'),
    decryptCredential: ipc<{ decrypted: string }>('auth:decryptCredential'),
    isEncryptionAvailable: ipc<{ available: boolean }>('auth:isEncryptionAvailable'),
  },
  project: {
    list: ipc<any>('project:list'),
    get: ipc<any>('project:get'),
    getStatistics: ipc<any>('project:getStatistics'),
    getTrend: ipc<any>('project:getTrend'),
    create: ipc<any>('project:create'),
    update: ipc<any>('project:update'),
    remove: ipc<void>('project:remove'),
    import: ipc<{ imported: number }>('project:import'),
    export: ipc<{ path: string }>('project:export'),
    exportAll: ipc<{ path: string }>('project:exportAll'),
    resolveStandardId: ipc<string>('project:resolveStandardId'),
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
    import: ipc<any>('standard:import'),
    parseExcel: ipc<any>('standard:parseExcel'),
    create: ipc<any>('standard:create'),
    update: ipc<any>('standard:update'),
    export: ipc<any>('standard:export'),
    exportBatch: ipc<any>('standard:exportBatch'),
    exportExcel: ipc<any>('standard:exportExcel'),
    downloadTemplate: ipc<any>('standard:downloadTemplate'),
    compare: ipc<any>('standard:compare'),
  },
  assessment: {
    getItems: ipc<any>('assessment:getItems'),
    getItemsByCategory: ipc<any>('assessment:getItemsByCategory'),
    getRecords: ipc<any>('assessment:getRecords'),
    getRecordsByAsset: ipc<any>('assessment:getRecordsByAsset'),
    getProjectRecords: ipc<any>('assessment:getProjectRecords'),
    getRecordByAssetAndItem: ipc<any>('assessment:getRecordByAssetAndItem'),
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
    listCommandIndustries: ipc<any>('knowledge:listCommandIndustries'),
    createCommand: ipc<string>('knowledge:createCommand'),
    updateCommand: ipc<void>('knowledge:updateCommand'),
    deleteCommand: ipc<void>('knowledge:deleteCommand'),
    favoriteCommand: ipc<void>('knowledge:favoriteCommand'),
    importExcel: ipc<{ imported: number; errors: string[] }>('knowledge:importExcel'),
    getStats: ipc<any>('knowledge:getStats'),
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
    exists: (filePath: string) => ipcRenderer.invoke('file:exists', filePath),
    readAsArrayBuffer: (filePath: string) => ipcRenderer.invoke('file:readAsArrayBuffer', filePath),
    readAsText: (filePath: string, encoding?: string) => ipcRenderer.invoke('file:readAsText', filePath, encoding),
    cleanupScreenshots: (opts?: any) => ipcRenderer.invoke('file:cleanupScreenshots', opts),
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
  window: {
    minimize: ipc<void>('window:minimize'),
    maximizeToggle: ipc<boolean>('window:maximizeToggle'),
    isMaximized: ipc<boolean>('window:isMaximized'),
    close: ipc<void>('window:close'),
    onMaximizeChange: (callback: (maximized: boolean) => void) => {
      const handler = (_e: IpcRendererEvent, maximized: boolean) => callback(maximized);
      ipcRenderer.on('window:maximizeChanged', handler);
      return () => ipcRenderer.removeListener('window:maximizeChanged', handler);
    },
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
  ollama: {
    getStatus: ipc<{ state: string; models?: any[]; error?: string }>('ollama:getStatus'),
    listModels: ipc<any[]>('ollama:listModels'),
    pullModel: ipc<any>('ollama:pullModel'),
    deleteModel: ipc<void>('ollama:deleteModel'),
    start: ipc<any>('ollama:start'),
    getInstallGuide: ipc<{ windows: string[]; mac: string[]; linux: string[]; downloadUrl: string }>('ollama:getInstallGuide'),
    testConnection: ipc<{ success: boolean; message: string }>('ollama:testConnection'),
    getRecommendedModels: ipc<Array<{ name: string; label: string; description: string; size: string; minMemory: number; supportsVision: boolean }>>('ollama:getRecommendedModels'),
    onPullProgress: (callback: (data: { modelName: string; status: string; completed?: number; total?: number }) => void) => {
      const handler = (_e: IpcRendererEvent, data: any) => callback(data);
      ipcRenderer.on('ollama:pullProgress', handler);
      return () => ipcRenderer.removeListener('ollama:pullProgress', handler);
    },
  },
  ocr: {
    extractText: ipc<{ text: string; confidence: number; words: any[] }>('ocr:extractText'),
    extractTextFromMultiple: ipc<Array<{ path: string; result: { text: string; confidence: number; words: any[] } }>>('ocr:extractTextFromMultiple'),
    isEnabled: ipc<boolean>('ocr:isEnabled'),
  },
  document: {
    extractText: ipc<{ name: string; content: string }[]>('document:extractText'),
  },
  attachment: {
    save: ipc<{ path: string; name: string; size: number; type: 'image' | 'document' }>('attachment:save'),
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
    // 注意：主进程 wrap() 返回 IpcResponse<T>；此处显式 IpcResponse 让渲染端拿到 success/error 字段，而不是被 void 吞掉
    writeFile: ipc<any>('fs:writeFile'),
    readFile: ipc<string>('fs:readFile'),
    readFileBase64: ipc<string>('fs:readFileBase64'),
    writeTextFile: ipc<any>('fs:writeTextFile'),
  },


  /**
   * 监听主进程日志，转发到 DevTools Console
   */
  onMainLog: (callback: (data: { level: string; message: string; timestamp: string; context?: any }) => void) => {
    const handler = (_e: IpcRendererEvent, data: any) => callback(data);
    ipcRenderer.on('main-process-log', handler);
    return () => ipcRenderer.removeListener('main-process-log', handler);
  },

  versions: {
    node: () => process.versions.node,
    chrome: () => process.versions.chrome,
    electron: () => process.versions.electron,
  },

  platform: process.platform,
  isPackaged: process.argv.includes('--jsecprobe-packaged=true'),
};

contextBridge.exposeInMainWorld('api', api);
