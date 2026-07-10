export interface IpcResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export interface Project {
  id: string;
  name: string;
  projectNo?: string;
  systemName: string;
  assessedUnit?: string;
  standardSystem?: string;
  levelCombo?: string;
  extensionType?: string;
  level: number;
  standardId: string;
  status: 'draft' | 'in_progress' | 'completed' | 'archived';
  customerName?: string;
  assessor?: string;
  startDate?: string;
  endDate?: string;
  description?: string;
  assetCount: number;
  complianceRate?: number;
  progress: number;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectListParams {
  page: number;
  pageSize: number;
  keyword?: string;
  status?: string;
  level?: number;
  excludeArchived?: boolean;
}

export interface ProjectListResult {
  list: Project[];
  total: number;
}

export interface Asset {
  id: string;
  projectId: string;
  category: string;
  name: string;
  os?: string;
  version?: string;
  deviceUsage?: string;
  description?: string;
  quantity: number;
  ip?: string;
  importance: 'high' | 'medium' | 'low';
  isVirtual: boolean;
  dbSystem?: string;
  middleware?: string;
  isAssessmentTarget: boolean;
  position?: string;
  responsiblePerson?: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface AssetCategory {
  id: string;
  name: string;
  icon: string;
  count: number;
}

export interface AssetListParams {
  projectId: string;
  category?: string;
  keyword?: string;
  page?: number;
  pageSize?: number;
}

export interface AssetListResult {
  list: Asset[];
  total: number;
  categoryStats: AssetCategory[];
}

export interface AssessmentItem {
  id: string;
  standardId: string;
  domain: string;
  controlPoint: string;
  controlName: string;
  requirement: string;
  minLevel: number;  // 最低适用等级（2=二级起适用，3=仅三级适用）
  maxLevel: number;  // 最高适用等级
  extensionType: string;  // general/cloud/mobile/iot/industrial/bigdata
  isHighRisk: boolean;
  sortOrder: number;
  parentId?: string;
}

export interface AssessmentRecord {
  id: string;
  projectId: string;
  itemId: string;
  assetId?: string;
  result: 'compliant' | 'partial' | 'non_compliant' | 'not_applicable' | 'untested';
  method?: 'interview' | 'check' | 'test';
  commandOutput?: string;
  evidence?: string;
  findings?: string;
  assessor?: string;
  assessmentDate?: string;
  screenshotPaths?: string;
  createdAt: string;
  updatedAt: string;
}

export interface User {
  id: string;
  username: string;
  realName: string;
  email?: string;
  phone?: string;
  role: string;
  isActive: boolean;
  mustChangePassword?: boolean;
  lastLoginAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface LoginResult {
  success: boolean;
  user?: User;
  token?: string;
  message?: string;
}

export interface SystemInfo {
  appVersion: string;
  electronVersion: string;
  nodeVersion: string;
  platform: string;
  dataPath: string;
}

export interface Standard {
  id: string;
  name: string;
  code: string;
  version: string;
  description?: string;
  level: number;
  domainCount: number;
  itemCount: number;
  isDefault: boolean;
  createdAt: string;
}

export interface StandardDomain {
  id: string;
  name: string;
  icon: string;
  count: number;
}

export interface AssessmentProgress {
  total: number;
  tested: number;
  compliant: number;
  complianceRate: number;
  untested: number;
}

export interface Issue {
  id: string;
  projectId: string;
  assetId?: string;
  itemId?: string;
  securityDomain: string;
  controlPoint: string;
  controlName: string;
  issueTitle: string;
  issueDescription: string;
  riskLevel: 'high' | 'medium' | 'low';
  status: 'pending' | 'rectifying' | 'resolved' | 'closed';
  rectificationSuggestion?: string;
  rectificationDeadline?: string;
  responsiblePerson?: string;
  fixedDescription?: string;
  fixedDate?: string;
  assessor?: string;
  evidenceFiles?: string;
  createdAt: string;
  updatedAt: string;
}

export interface IssueSummary {
  total: number;
  highRisk: number;
  mediumRisk: number;
  lowRisk: number;
  pending: number;
  rectifying: number;
  resolved: number;
  closed: number;
  complianceRate?: number;
  riskStats?: { level: string; label: string; count: number; color: string }[];
  domainStats?: { name: string; count: number }[];
}

export interface IssueListParams {
  projectId: string;
  keyword?: string;
  riskLevel?: string;
  status?: string;
  securityDomain?: string;
  sortProp?: string;
  sortOrder?: string;
  page?: number;
  pageSize?: number;
}

export interface IssueListResult {
  list: Issue[];
  total: number;
  riskStats: { level: string; label: string; count: number; color: string }[];
  errors?: string[];
}

export interface FileFilter {
  name: string;
  extensions: string[];
}

export interface OperationLog {
  id: string;
  userId?: string;
  username?: string;
  action: string;
  module: string;
  targetId?: string;
  targetName?: string;
  description?: string;
  ipAddress?: string;
  createdAt: string;
}

export interface KnowledgeCategory {
  id: string;
  parentId?: string;
  name: string;
  icon?: string;
  color?: string;
  sortOrder: number;
  documentCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface KnowledgeDocument {
  id: string;
  categoryId: string;
  title: string;
  type: string;
  filePath?: string;
  content?: string;
  description?: string;
  version?: string;
  tags?: string;
  referenceCount: number;
  uploadDate: string;
  createdAt: string;
  updatedAt: string;
}

export interface KnowledgeListParams {
  categoryId?: string;
  keyword?: string;
  page?: number;
  pageSize?: number;
}

export interface KnowledgeCommand {
  id: string;
  name: string;
  target: string;
  command: string;
  description: string;
  os: string;
  brand: string;
  deviceType: string;
  category: string;
  subCategory: string;
  isFavorite: number;
  referenceCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface KnowledgeCommandListParams {
  keyword?: string;
  os?: string;
  brand?: string;
  deviceType?: string;
  category?: string;
  subCategory?: string;
  page?: number;
  pageSize?: number;
}

export interface KnowledgeCommandListResult {
  list: KnowledgeCommand[];
  total: number;
}

export interface ApiBridge {
  auth: {
    login: (username: string, password: string) => Promise<IpcResponse<LoginResult>>;
    logout: () => Promise<IpcResponse<void>>;
    getCurrentUser: () => Promise<IpcResponse<User | null>>;
    changePassword: (userId: string, oldPassword: string, newPassword: string) => Promise<IpcResponse<void>>;
  };
  project: {
    list: (params: ProjectListParams) => Promise<IpcResponse<ProjectListResult>>;
    get: (id: string) => Promise<IpcResponse<Project>>;
    create: (data: Partial<Project>) => Promise<IpcResponse<Project>>;
    update: (id: string, data: Partial<Project>) => Promise<IpcResponse<Project>>;
    remove: (id: string) => Promise<IpcResponse<void>>;
    import: () => Promise<IpcResponse<{ imported: number }>>;
    export: (projectId: string) => Promise<IpcResponse<{ path: string }>>;
    exportAll: () => Promise<IpcResponse<{ path: string }>>;
  };
  asset: {
    list: (params: AssetListParams) => Promise<IpcResponse<AssetListResult>>;
    create: (data: Partial<Asset>) => Promise<IpcResponse<Asset>>;
    update: (id: string, data: Partial<Asset>) => Promise<IpcResponse<Asset>>;
    remove: (id: string) => Promise<IpcResponse<void>>;
    batchRemove: (ids: string[]) => Promise<IpcResponse<void>>;
    importExcel: (projectId: string, filePath: string) => Promise<IpcResponse<{ count: number; category?: string; results?: Array<{ sheet: string; count: number }> }>>;
    exportExcel: (projectId: string, category: string) => Promise<IpcResponse<string>>;
  };
  standard: {
    list: () => Promise<IpcResponse<Standard[]>>;
    getDomains: (standardId: string) => Promise<IpcResponse<StandardDomain[]>>;
    getItems: (standardId: string, domain?: string) => Promise<IpcResponse<AssessmentItem[]>>;
    setDefault: (standardId: string) => Promise<IpcResponse<void>>;
    remove: (standardId: string) => Promise<IpcResponse<void>>;
  };
  assessment: {
    getItems: (standardId: string, domain?: string, projectLevel?: number, extensionType?: string | string[]) => Promise<IpcResponse<AssessmentItem[]>>;
    getItemsByCategory: (category: string, projectLevel?: number, extensionType?: string) => Promise<IpcResponse<AssessmentItem[]>>;
    getRecords: (projectId: string, itemId: string) => Promise<IpcResponse<AssessmentRecord[]>>;
    getRecordsByAsset: (projectId: string, assetId: string) => Promise<IpcResponse<AssessmentRecord[]>>;
    getRecordByAssetAndItem: (projectId: string, assetId: string, itemId: string) => Promise<IpcResponse<AssessmentRecord | null>>;
    getRecordsByDomain: (projectId: string, domain: string, projectLevel?: number, extensionType?: string | string[]) => Promise<IpcResponse<AssessmentRecord[]>>;
    saveRecord: (data: Partial<AssessmentRecord>) => Promise<IpcResponse<AssessmentRecord>>;
    getProgress: (projectId: string, standardId: string) => Promise<IpcResponse<AssessmentProgress>>;
    listDomains: (standardId?: string) => Promise<IpcResponse<{ id: string; name: string; count: number }[]>>;
    exportExcel: (projectId: string, domain?: string) => Promise<IpcResponse<{ path: string }>>;
    exportExcelByAssets: (projectId: string, assetIds: string[], domainIds: string[]) => Promise<IpcResponse<{ path: string }>>;
    importExcel: (projectId: string, filePath: string) => Promise<IpcResponse<{ count: number }>>;
  };
  screenshot: {
    upload: (params: { projectId: string; itemId: string; filePath: string }) => Promise<IpcResponse<{ path: string; name: string }>>;
    saveFromBase64: (params: { projectId: string; itemId: string; base64Data: string }) => Promise<IpcResponse<{ path: string; name: string }>>;
    getBase64: (params: { filePath: string }) => Promise<IpcResponse<{ base64: string; mimeType: string }>>;
    uploadFile: (params: { projectId: string; itemId: string; filePath: string }) => Promise<IpcResponse<{ path: string; name: string }>>;
    readText: (params: { filePath: string }) => Promise<IpcResponse<{ content: string }>>;
    deleteFile: (params: { filePath: string }) => Promise<IpcResponse<void>>;
  };
  issue: {
    list: (params: IssueListParams) => Promise<IpcResponse<IssueListResult>>;
    get: (id: string) => Promise<IpcResponse<Issue | null>>;
    create: (data: Partial<Issue>) => Promise<IpcResponse<string>>;
    update: (id: string, data: Partial<Issue>) => Promise<IpcResponse<void>>;
    remove: (id: string) => Promise<IpcResponse<void>>;
    generateFromRecords: (projectId: string) => Promise<IpcResponse<{ count: number }>>;
    getSummary: (projectId: string) => Promise<IpcResponse<IssueSummary>>;
    exportExcel: (projectId: string) => Promise<IpcResponse<string>>;
    batchRemove: (ids: string[]) => Promise<IpcResponse<void>>;
    batchUpdateStatus: (ids: string[], status: string) => Promise<IpcResponse<void>>;
    updateEvidence: (id: string, evidenceFiles: string[]) => Promise<IpcResponse<void>>;
    importExcel: (projectId: string, filePath: string) => Promise<IpcResponse<{ count: number; errors?: string[] }>>;
  };
  report: {
    generate: (projectId: string) => Promise<IpcResponse<string>>;
  };
  knowledge: {
    listCategories: () => Promise<IpcResponse<KnowledgeCategory[]>>;
    listDocuments: (params: KnowledgeListParams) => Promise<IpcResponse<{ list: KnowledgeDocument[]; total: number }>>;
    getDocument: (id: string) => Promise<IpcResponse<KnowledgeDocument | null>>;
    createDocument: (data: Partial<KnowledgeDocument>) => Promise<IpcResponse<string>>;
    updateDocument: (id: string, data: Partial<KnowledgeDocument>) => Promise<IpcResponse<void>>;
    deleteDocument: (id: string) => Promise<IpcResponse<void>>;
    createCategory: (data: Partial<KnowledgeCategory>) => Promise<IpcResponse<KnowledgeCategory>>;
    updateCategory: (id: string, data: Partial<KnowledgeCategory>) => Promise<IpcResponse<void>>;
    deleteCategory: (id: string) => Promise<IpcResponse<void>>;
    listCommands: (params: KnowledgeCommandListParams) => Promise<IpcResponse<KnowledgeCommandListResult>>;
    createCommand: (data: Partial<KnowledgeCommand>) => Promise<IpcResponse<string>>;
    updateCommand: (id: string, data: Partial<KnowledgeCommand>) => Promise<IpcResponse<void>>;
    deleteCommand: (id: string) => Promise<IpcResponse<void>>;
    favoriteCommand: (id: string, isFavorite: number) => Promise<IpcResponse<void>>;
    importKnowledge: (filePath: string) => Promise<IpcResponse<{ count: number }>>;
    exportKnowledge: () => Promise<IpcResponse<{ path: string }>>;
    downloadDocument: (id: string) => Promise<IpcResponse<{ path: string; title: string }>>;
    downloadAndSave: (id: string) => Promise<IpcResponse<{ path: string; title: string }>>;
    uploadDocument: (data: { categoryId: string; title: string; type: string; description: string; version: string; tags: string; filePath: string }) => Promise<IpcResponse<{ id: string }>>;
    referenceDocument: (data: { documentId: string; targetId: string; targetType: string }) => Promise<IpcResponse<void>>;
    importSingleDocument: (data: { categoryId: string; title: string; type: string; description: string; version: string; tags: string; filePath: string }) => Promise<IpcResponse<{ id: string }>>;
    listDirectoryFiles: (dirPath: string) => Promise<IpcResponse<{ name: string; path: string; size: number; isFile: boolean }[]>>;
  };
  system: {
    getInfo: () => Promise<IpcResponse<SystemInfo>>;
    openDataFolder: () => Promise<IpcResponse<void>>;
    selectFile: (filters?: FileFilter[]) => Promise<IpcResponse<string | null>>;
    saveFile: (defaultPath?: string, filters?: FileFilter[]) => Promise<IpcResponse<string | null>>;
    backupData: (customPath?: string) => Promise<IpcResponse<string>>;
    restoreData: (backupPath: string) => Promise<IpcResponse<void>>;
    changeDataPath: (newPath: string) => Promise<IpcResponse<string>>;
  };
  user: {
    list: () => Promise<IpcResponse<User[]>>;
    create: (data: { username: string; password: string; realName: string; email?: string; phone?: string; role?: string }) => Promise<IpcResponse<{ id: string; username: string; realName: string }>>;
    update: (id: string, data: { realName?: string; email?: string; phone?: string; role?: string; isActive?: boolean; password?: string }) => Promise<IpcResponse<void>>;
    delete: (id: string) => Promise<IpcResponse<void>>;
  };
  log: {
    list: (params: { page?: number; pageSize?: number; module?: string; action?: string }) => Promise<IpcResponse<{ list: OperationLog[]; total: number }>>;
  };
  ai: {
    chat: (params: { messages: { role: string; content: any }[]; model?: string; temperature?: number; context?: string }) => Promise<IpcResponse<{ content: string; suggestions: string[] }>>;
    analyzeAssessment: (params: { controlPoint: string; requirement: string; command: string; result: string; screenshots?: string[] }) => Promise<IpcResponse<{ content: string }>>;
    batchAnalyzeScreenshots: (params: { items: { id: string; controlPoint: string; requirement: string }[]; screenshots: string[]; documents?: { name: string; content: string }[] }) => Promise<IpcResponse<{ content: string }>>;
    getConfig: () => Promise<IpcResponse<any>>;
    saveConfig: (config: { apiBase: string; apiKey: string; model: string; temperature: number }) => Promise<IpcResponse<void>>;
    testConnection: (params?: { apiBase?: string; apiKey?: string; model?: string }) => Promise<IpcResponse<any>>;
    onAnalysisProgress: (callback: (data: { stage: string; message: string; percent: number }) => void) => () => void;
  };
  document: {
    extractText: (params: { filePaths: string[] }) => Promise<IpcResponse<{ name: string; content: string }[]>>;
  };
  image: {
    saveScreenshot: (base64Data: string, fileName: string) => Promise<IpcResponse<{ filePath: string; fileName: string }>>;
  };
  dialog: {
    showOpenDialog: (options: DialogOpenOptions) => Promise<IpcResponse<DialogOpenResult>>;
    showSaveDialog: (options: DialogSaveOptions) => Promise<IpcResponse<DialogSaveResult>>;
    showMessageBox: (options: DialogMessageOptions) => Promise<IpcResponse<DialogMessageResult>>;
  };
  update: {
    check: () => Promise<IpcResponse<void>>;
    download: () => Promise<IpcResponse<void>>;
    install: () => Promise<IpcResponse<void>>;
    getStatus: () => Promise<IpcResponse<UpdateStatus>>;
    getCurrentVersion: () => Promise<IpcResponse<string>>;
    onStatusChange: (callback: (status: UpdateStatus) => void) => () => void;
  };
  getPath: (name: string) => Promise<IpcResponse<string>>;
  shell: {
    openPath: (filePath: string) => Promise<IpcResponse<void>>;
    openExternal: (filePath: string) => Promise<IpcResponse<void>>;
  };
  fs: {
    ensureDir: (path: string) => Promise<IpcResponse<void>>;
    writeFile: (path: string, data: Buffer) => Promise<IpcResponse<void>>;
  };
}

export interface DialogOpenOptions {
  title?: string;
  defaultPath?: string;
  filters?: FileFilter[];
  properties?: Array<'openFile' | 'openDirectory' | 'multiSelections' | 'showHiddenFiles'>;
}

export interface DialogSaveOptions {
  title?: string;
  defaultPath?: string;
  filters?: FileFilter[];
}

export interface DialogMessageOptions {
  type?: 'none' | 'info' | 'error' | 'question' | 'warning';
  title?: string;
  message: string;
  detail?: string;
  buttons?: string[];
}

export interface DialogOpenResult {
  canceled: boolean;
  filePaths: string[];
}

export interface DialogSaveResult {
  canceled: boolean;
  filePath?: string;
}

export interface DialogMessageResult {
  response: number;
}

export interface UpdateStatus {
  status: 'idle' | 'checking' | 'downloading' | 'available' | 'notavailable' | 'downloaded' | 'error';
  version?: string;
  releaseDate?: string;
  releaseNotes?: string;
  downloadProgress?: number;
  error?: string;
}
