import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';
import type { AiChatStreamChunk, User, ApiBridge, RiskLevelJudgment, RiskLevelJudgeResult, IpcResponse } from '../../shared/types';

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
  // 注：主进程从不发送 'update:progress'，下载进度随 'update:status' 的 downloadProgress 字段传递。
  // 原先这里有一个监听该事件的 onDownloadProgress，无人调用且永不触发，已删除。
};

/**
 * 外链模块：用 ApiBridge['externalLink'] 反向约束本对象，
 * 避免「主进程加了通道、preload 漏注册」这类只有运行到才发现的错。
 */
const externalLinkService: ApiBridge['externalLink'] = {
  list: ipc('externalLink:list'),
  create: ipc('externalLink:create'),
  update: ipc('externalLink:update'),
  delete: ipc('externalLink:delete'),
  reorder: ipc('externalLink:reorder'),
  open: ipc('externalLink:open'),
  import: ipc('externalLink:import'),
  export: ipc('externalLink:export'),
};

/** 项目分组：与 externalLink 一样用 ApiBridge 反向约束，避免主进程加了通道 preload 漏注册 */
const projectGroupService: ApiBridge['projectGroup'] = {
  list: ipc('projectGroup:list'),
  get: ipc('projectGroup:get'),
  create: ipc('projectGroup:create'),
  update: ipc('projectGroup:update'),
  remove: ipc('projectGroup:remove'),
};

/** 风险分析：同样用 ApiBridge 反向约束，避免主进程加了通道 preload 漏注册 */
const riskAnalysisService: ApiBridge['riskAnalysis'] = {
  list: ipc('riskAnalysis:list'),
  save: ipc('riskAnalysis:save'),
  clear: ipc('riskAnalysis:clear'),
  generateDraft: ipc('riskAnalysis:generateDraft'),
  exportExcel: ipc('riskAnalysis:exportExcel'),
};

/** 重大风险隐患识别与分析：清单 + 三要素判定 */
const majorRiskService: ApiBridge['majorRisk'] = {
  list: ipc('majorRisk:list'),
  save: ipc('majorRisk:save'),
  clear: ipc('majorRisk:clear'),
  exportExcel: ipc('majorRisk:exportExcel'),
  catalogList: ipc('majorRisk:catalogList'),
  catalogSave: ipc('majorRisk:catalogSave'),
  catalogRemove: ipc('majorRisk:catalogRemove'),
  catalogImport: ipc('majorRisk:catalogImport'),
  matchCatalog: ipc('majorRisk:matchCatalog'),
  searchRecords: ipc('majorRisk:searchRecords'),
};

const aiService = {
  chat: ipc<{ content: string; suggestions: string[]; modelName?: string; switched?: boolean }>('ai:chat'),
  chatStream: ipc<any>('ai:chatStream'),
  cancelChat: ipc<{ canceled: boolean }>('ai:cancelChat'),
  analyzeAssessment: ipc<{ content: string }>('ai:analyzeAssessment'),
  cancelSingleAnalysis: ipc<{ canceled: boolean }>('ai:cancelSingleAnalysis'),
  batchAnalyzeScreenshots: ipc<{ content: string }>('ai:batchAnalyzeScreenshots'),
  cancelBatchScreenshots: ipc<{ canceled: boolean }>('ai:cancelBatchScreenshots'),
  analyzeIssue: ipc<{ content: string }>('ai:analyzeIssue'),
  cancelIssue: ipc<{ canceled: boolean }>('ai:cancelIssue'),
  analyzeIssueDescription: ipc<{ content: string }>('ai:analyzeIssueDescription'),
  batchAnalyzeIssueDescriptions: ipc<{ results: Array<{ issueId: string; content: string; success: boolean; error?: string }>; canceled?: boolean }>('ai:batchAnalyzeIssueDescriptions'),
  cancelIssueDescription: ipc<{ canceled: boolean }>('ai:cancelIssueDescription'),
  batchAnalyzeIssues: ipc<{ results: Array<{ issueId: string; suggestion: string; success: boolean; error?: string }>; canceled?: boolean }>('ai:batchAnalyzeIssues'),
  cancelBatchIssueAnalysis: ipc<{ canceled: boolean }>('ai:cancelBatchIssueAnalysis'),
  analyzeRisk: ipc<{ result: string }>('ai:analyzeRisk'),
  cancelRiskAnalysis: ipc<{ canceled: boolean }>('ai:cancelRiskAnalysis'),
  batchAnalyzeRisks: ipc<{
    results: Array<{
      issueId: string;
      draft?: { result: string };
      success: boolean;
      error?: string;
    }>;
    canceled?: boolean;
  }>('ai:batchAnalyzeRisks'),
  judgeRiskLevel: ipc<RiskLevelJudgment>('ai:judgeRiskLevel'),
  batchJudgeRiskLevels: ipc<{ results: RiskLevelJudgeResult[]; canceled: boolean }>('ai:batchJudgeRiskLevels'),
  cancelRiskLevelJudge: ipc<{ canceled: boolean }>('ai:cancelRiskLevelJudge'),
  searchKnowledge: ipc<{ content: string; modelName?: string; referencedDocs: Array<{ id: string; title: string }> }>('ai:searchKnowledge'),
  recommendCommands: ipc<{ commands: any[]; aiMethods: any[] }>('ai:recommendCommands'),
  identifyAssets: ipc<{ assets: any[] }>('ai:identifyAssets'),
  checkMissingAssets: ipc<{ missing: any[] }>('ai:checkMissingAssets'),
  dashboardInsight: ipc<{
    insight: string;
    alerts: Array<{ key: string; severity: string; title: string; detail: string }>;
    alertAdvices: Array<{ key: string; advice: string }>;
  }>('ai:dashboardInsight'),
  explainStandardDiff: ipc<{
    summary: string;
    keyDiffs: Array<{ domain: string; point: string; impact: string }>;
    advice: string;
  }>('ai:explainStandardDiff'),
  standardComplianceGap: ipc<{
    summary: string;
    gaps: Array<{ domain: string; gap: string; risk: string; priority: string; suggestion: string }>;
    domains: Array<Record<string, any>>;
    nonCompliantSamples: Array<Record<string, any>>;
    stats: Record<string, any>;
  }>('ai:standardComplianceGap'),
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
  // 提示词管理
  listPrompts: ipc<any>('ai:prompts:list'),
  savePrompt: ipc<{ success: boolean }>('ai:prompts:save'),
  resetPrompt: ipc<{ success: boolean }>('ai:prompts:reset'),
  onChatChunk: (callback: (data: AiChatStreamChunk) => void) => {
    const handler = (_e: IpcRendererEvent, data: AiChatStreamChunk) => callback(data);
    ipcRenderer.on('ai:chatChunk', handler);
    return () => ipcRenderer.removeListener('ai:chatChunk', handler);
  },
  onAnalysisProgress: (callback: (data: { stage: string; message: string; percent: number; scope?: string }) => void) => {
    const handler = (_e: IpcRendererEvent, data: any) => callback(data);
    ipcRenderer.on('ai:progress', handler);
    return () => ipcRenderer.removeListener('ai:progress', handler);
  },
  onAssetIdentifyProgress: (callback: (data: { stage: string; message: string; percent: number; currentBatch?: number; totalBatches?: number; batchLabels?: string[] }) => void) => {
    const handler = (_e: IpcRendererEvent, data: any) => callback(data);
    ipcRenderer.on('ai:assetIdentifyProgress', handler);
    return () => ipcRenderer.removeListener('ai:assetIdentifyProgress', handler);
  },
  analyzeTopology: ipc<{ domains: Array<{ name: string; description: string }>; overview?: string; partial?: boolean }>('ai:analyzeTopology'),
  onTopologyProgress: (callback: (data: { stage: string; message: string; percent: number }) => void) => {
    const handler = (_e: IpcRendererEvent, data: any) => callback(data);
    ipcRenderer.on('ai:topologyProgress', handler);
    return () => ipcRenderer.removeListener('ai:topologyProgress', handler);
  },
  onBatchIssueDescProgress: (callback: (data: { stage: string; message: string; percent: number; current: number; total: number }) => void) => {
    const handler = (_e: IpcRendererEvent, data: any) => callback(data);
    ipcRenderer.on('ai:batchIssueDescProgress', handler);
    return () => ipcRenderer.removeListener('ai:batchIssueDescProgress', handler);
  },
  onBatchIssueProgress: (callback: (data: { stage: string; message: string; percent: number; current: number; total: number }) => void) => {
    const handler = (_e: IpcRendererEvent, data: any) => callback(data);
    ipcRenderer.on('ai:batchIssueProgress', handler);
    return () => ipcRenderer.removeListener('ai:batchIssueProgress', handler);
  },
  onBatchRiskProgress: (callback: (data: { stage: string; message: string; percent: number; current: number; total: number }) => void) => {
    const handler = (_e: IpcRendererEvent, data: any) => callback(data);
    ipcRenderer.on('ai:batchRiskProgress', handler);
    return () => ipcRenderer.removeListener('ai:batchRiskProgress', handler);
  },
  analyzeMajorRisk: ipc<{ catalogId: string; catalogTitle: string; relevance: string; severity: string; frequency: string; verdict: string; conclusion: string }>('ai:analyzeMajorRisk'),
  cancelMajorRiskAnalysis: ipc<{ canceled: boolean }>('ai:cancelMajorRiskAnalysis'),
  batchAnalyzeMajorRisks: ipc<{
    results: Array<{
      issueId: string;
      draft?: { catalogId: string; catalogTitle: string; relevance: string; severity: string; frequency: string; verdict: string; conclusion: string };
      success: boolean;
      error?: string;
    }>;
    canceled?: boolean;
  }>('ai:batchAnalyzeMajorRisks'),
  onBatchMajorRiskProgress: (callback: (data: { stage: string; message: string; percent: number; current: number; total: number }) => void) => {
    const handler = (_e: IpcRendererEvent, data: any) => callback(data);
    ipcRenderer.on('ai:batchMajorRiskProgress', handler);
    return () => ipcRenderer.removeListener('ai:batchMajorRiskProgress', handler);
  },
  onBatchRiskLevelProgress: (callback: (data: { stage: string; message: string; percent: number; current: number; total: number }) => void) => {
    const handler = (_e: IpcRendererEvent, data: any) => callback(data);
    ipcRenderer.on('ai:batchRiskLevelProgress', handler);
    return () => ipcRenderer.removeListener('ai:batchRiskLevelProgress', handler);
  },
};

// AI 智能助手历史会话
const aiConversationService = {
  list: ipc<Array<{ id: string; title: string; projectId: string | null; createdAt: string; updatedAt: string }>>('aiConversation:list'),
  create: ipc<{ id: string; title: string; createdAt: string; updatedAt: string }>('aiConversation:create'),
  rename: ipc<void>('aiConversation:rename'),
  delete: ipc<void>('aiConversation:delete'),
  appendMessages: ipc<void>('aiConversation:appendMessages'),
  clearMessages: ipc<void>('aiConversation:clearMessages'),
  getMessages: ipc<Array<{ id: string; role: string; content: string; suggestions?: string[]; attachments?: Array<{ name: string; path: string; type: 'image' | 'document'; size: number }>; createdAt: string }>>('aiConversation:getMessages'),
};

// 等保测评点知识库（指导书导入）
const checkpointService = {
  pickFile: ipc<{ paths: string[] }>('checkpoint:pickFile'),
  downloadTemplate: ipc<{ canceled?: boolean; path?: string }>('checkpoint:downloadTemplate'),
  preview: ipc<any>('checkpoint:preview'),
  commit: ipc<{ inserted: number; updated: number; skipped: number }>('checkpoint:commit'),
  stats: ipc<{ total: number; withDevice: number; unmatched: number }>('checkpoint:stats'),
  list: ipc<any[]>('checkpoint:list'),
  update: ipc<{ ok: boolean; reason?: string; duplicateOf?: string }>('checkpoint:update'),
  delete: ipc<{ ok: boolean }>('checkpoint:delete'),
  clear: ipc<{ removed: number }>('checkpoint:clear'),
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
    updateTopology: ipc<any>('project:updateTopology'),
    remove: ipc<void>('project:remove'),
    export: ipc<{ path: string }>('project:export'),
    exportAll: ipc<{ path: string }>('project:exportAll'),
    resolveStandardId: ipc<string>('project:resolveStandardId'),
    // 项目归档：完整数据（资产/测评记录/问题/采集/附件/依赖标准）的导出与还原
    exportArchive: ipc<{
      success: boolean; path?: string; size?: number; fileCount?: number; missingFiles?: string[];
    }>('project:exportArchive'),
    selectArchive: ipc<{ path: string; encrypted: boolean }>('project:selectArchive'),
    previewArchive: ipc<{
      success: boolean;
      manifest?: {
        version: string; appVersion: string; createdAt: string;
        projects: Array<{
          id: string; name: string; systemName: string; level: number; status: string;
          createdAt: string; assetCount: number; recordCount: number; issueCount: number; taskCount: number;
        }>;
        /** 新版归档携带的项目分组台账；旧版归档无此字段 */
        groups?: Array<{ id: string; name: string; projectNo?: string }>;
        counts: Record<string, number>;
        includeStandards: boolean; credentialsIncluded: boolean; encrypted: boolean;
      };
      projects?: Array<{ id: string; name: string; existsLocally: boolean; localName?: string; assetCount: number; recordCount: number; issueCount: number }>;
      encrypted?: boolean;
      warnings?: string[];
    }>('project:previewArchive'),
    importArchive: ipc<{
      success: boolean;
      imported: Array<{ id: string; name: string; mode: 'new' | 'overwrite' | 'copy' }>;
      /** 本次导入还原出的项目分组（系统数用于前端提示） */
      groups?: Array<{ id: string; name: string; systemCount: number }>;
      skipped: string[];
      restoredFiles: number;
      missingFiles: number;
      warnings: string[];
    }>('project:importArchive'),
  },
  projectGroup: projectGroupService,
  riskAnalysis: riskAnalysisService,
  majorRisk: majorRiskService,
  asset: {
    list: ipc<any>('asset:list'),
    create: ipc<any>('asset:create'),
    update: ipc<any>('asset:update'),
    remove: ipc<void>('asset:remove'),
    batchRemove: ipc<void>('asset:batchRemove'),
    importExcel: ipc<{ count: number; category?: string; skipped?: number; results?: Array<{ sheet: string; count: number }> }>('asset:importExcel'),
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
    getComplianceStats: ipc<any>('standard:getComplianceStats'),
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
    getExcelSheetInfo: ipc<any>('assessment:getExcelSheetInfo'),
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
  },
  report: {
    generate: ipc<{ filePath: string }>('report:generate'),
    generateProject: ipc<{ filePath: string }>('report:generateProject'),
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
    isBackupEncrypted: ipc<boolean>('system:isBackupEncrypted'),
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
  aiConversation: aiConversationService,
  checkpoint: checkpointService,
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
  document: {
    extractText: ipc<Array<{ name: string; content: string; error?: string }>>('document:extractText'),
  },
  attachment: {
    save: ipc<IpcResponse<{ path: string; name: string; size: number; type: 'image' | 'document' }>>('attachment:save'),
    delete: ipc<IpcResponse<boolean>>('attachment:delete'),
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
  externalLink: externalLinkService,

  collection: {
    listProfiles: ipc<any[]>('collection:listProfiles'),
    saveProfile: ipc<any>('collection:saveProfile'),
    deleteProfile: ipc<void>('collection:deleteProfile'),
    batchDeleteProfiles: ipc<any>('collection:batchDeleteProfiles'),
    testConnection: ipc<any>('collection:testConnection'),
    testConnectionWithProfile: ipc<any>('collection:testConnectionWithProfile'),
    listTasks: ipc<any[]>('collection:listTasks'),
    getTask: ipc<any>('collection:getTask'),
    createTask: ipc<any>('collection:createTask'),
    cancelTask: ipc<void>('collection:cancelTask'),
    deleteTask: ipc<void>('collection:deleteTask'),
    listResults: ipc<any[]>('collection:listResults'),
    confirmResult: ipc<void>('collection:confirmResult'),
    saveDocument: ipc<any>('collection:saveDocument'),
    listDocuments: ipc<any[]>('collection:listDocuments'),
    deleteDocument: ipc<void>('collection:deleteDocument'),
    openDocumentDir: ipc<void>('collection:openDocumentDir'),
    exportLocalScript: ipc<any>('collection:exportLocalScript'),
    importLocalResults: ipc<any>('collection:importLocalResults'),
    onProgress: (callback: (data: any) => void) => {
      const handler = (_e: IpcRendererEvent, data: any) => callback(data);
      ipcRenderer.on('collection:progress', handler);
      return () => ipcRenderer.removeListener('collection:progress', handler);
    },
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

// 注：ApiBridge 中的 sendLog/on 为预留通道，preload 暂未暴露（主进程无对应监听），
// 故此处不做整体 satisfies 校验；新增业务通道仍逐命名空间用 ApiBridge[...] 约束。
contextBridge.exposeInMainWorld('api', api);
