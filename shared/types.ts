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
  /** 所属项目分组；历史升级数据由启动兜底自动回填 */
  groupId?: string;
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
  /** JSON 字符串：Array<{name,path,size}>，系统拓扑图（可多张），受管相对路径 */
  topologyAttachments?: string;
  /** AI 按等保安全域分段生成的拓扑描述，纯文本，段落间换行分隔 */
  topologyDescription?: string;
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
  /** 只列某个项目分组下的系统；不传则列全部 */
  groupId?: string;
}

export interface ProjectListResult {
  list: Project[];
  total: number;
}

/**
 * 项目分组（委托 / 合同批次）。
 * 一个分组下可挂多个系统，每个系统对应 `projects` 表的一行，
 * 系统构成 / 现场测评 / 问题清单的数据隔离仍由该行的 id（project_id）承担。
 */
export interface ProjectGroup {
  id: string;
  name: string;
  projectNo?: string;
  assessedUnit?: string;
  customerName?: string;
  assessor?: string;
  startDate?: string;
  endDate?: string;
  description?: string;
  status: 'draft' | 'in_progress' | 'completed' | 'archived';
  sortOrder: number;
  /** 该分组下的系统数（由后端聚合） */
  systemCount: number;
  /** 各系统测评进度的平均值（由后端聚合） */
  progress: number;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectGroupListParams {
  page: number;
  pageSize: number;
  keyword?: string;
  status?: string;
  excludeArchived?: boolean;
}

export interface ProjectGroupListResult {
  list: ProjectGroup[];
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
  standardType?: string;  // national(国标) | industry(行标) | local | enterprise
  industry?: string;       // 电力/金融/医疗/电信/政务（行标时填）
  source?: string;         // builtin(内置) | imported(导入) | custom(手动)
  presetTemplate?: string; // 配套预置模板相对路径
  // 改造：预置导入配置（method 默认值 + 列映射），缺省 'check' / A/B/C/D/E
  presetMethod?: string;                              // 'interview' | 'check' | 'test'
  columnMap?: Record<string, number>;                 // {"序号":0,"控制点":1,"要求":2,"记录":3,"合规":4}
  createdAt: string;
}

export interface StandardDomain {
  id: string;
  name: string;
  icon: string;
  domainType?: string;  // national | industry
  count: number;
}

// 标准 JSON 导入/导出数据结构（用户导入行标、标准导出备份）
export interface StandardImportData {
  id: string;
  name: string;
  code: string;
  version: string | number;
  grade: number;
  description?: string;
  standardType?: string;
  industry?: string;
  presetTemplate?: string;
  // 改造：标准 JSON 可指定预置导入配置
  presetMethod?: string;                                  // 'interview' | 'check' | 'test'，缺省 'check'
  columnMap?: Record<string, number>;                     // 缺省 {"序号":0,"控制点":1,"要求":2,"记录":3,"合规":4}
  domains: Array<{
    id: string;
    name?: string;
    icon?: string;
    domainType?: string;
    sheetName?: string;
    columnMap?: Record<string, number>;                    // 按域覆盖标准级 columnMap
    items: Array<{
      id: string;
      controlPoint: string;
      controlName?: string;
      requirement: string;
      minLevel?: number;
      maxLevel?: number;
      extensionType?: string;
      isHighRisk?: boolean;
      sortOrder?: number;
      parentId?: string;
    }>;
  }>;
}

export interface AssessmentProgress {
  total: number;
  tested: number;
  compliant: number;
  partial: number;
  nonCompliant: number;
  na: number;
  complianceRate: number;
  untested: number;
}

// 导入 Excel 时单个 sheet 的解析结果（供导入弹窗可视化选择）
export interface ExcelSheetInfo {
  sheetName: string;        // 原始 sheet 名
  domainKey: string | null; // 域 ID，null = 层面未识别
  domainName: string;       // 层面中文名（未识别时回退为 sheetName 原文）
  assetId: string | null;   // 匹配到的资产 id，null = 全局层面或未匹配
  assetName: string | null;
  isGlobal: boolean;        // 是否「_全局层面」sheet
  importable: boolean;      // 层面识别成功即可导入
  assetMatched: boolean;    // 资产 sheet 是否真的匹配上了资产（全局层面恒为 true）
  rowCount: number;         // 数据行数估算（不含表头）
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
  /** 风险分析结论（可选，未分析时为 undefined / null） */
  riskLikelihood?: RiskLevel3;
  riskImpact?: RiskLevel3;
  riskScore?: number;
  riskEvaluatedLevel?: RiskLevel3;
  riskThreat?: string;
  riskConsequence?: string;
  riskStrategy?: RiskStrategy;
  riskCountermeasure?: string;
  riskResidual?: string;
  riskAnalyst?: string;
  riskAnalyzedAt?: string;
  createdAt: string;
  updatedAt: string;
}

/** 风险三级枚举：可能性、影响程度、分析后结论等级共用 */
export type RiskLevel3 = 'high' | 'medium' | 'low';
/** 风险处置策略：降低 / 转移 / 规避 / 接受 */
export type RiskStrategy = 'mitigate' | 'transfer' | 'avoid' | 'accept';

/**
 * 风险分析行：issues 行 + 风险分析结果的合成视图。
 * 风险分析只对每条问题给出一段「分析结果」文本（形如"可能导致XXXX的风险"），
 * 不做可能性×影响矩阵、风险值或结论等级评定；问题本身的初判等级仍来自问题清单。
 */
export interface IssueRiskAnalysis {
  issueId: string;
  projectId: string;
  issueTitle: string;
  issueDescription: string;
  securityDomain: string;
  controlPoint: string;
  controlName: string;
  assetName?: string;
  /** 问题清单里的原始风险等级（初判，仅用于展示与统计） */
  riskLevel: RiskLevel3;
  status: string;
  rectificationSuggestion?: string;
  /** 分析结果文本：可能导致XXXX的风险 */
  result?: string;
  analyst?: string;
  analyzedAt?: string;
}

export interface RiskAnalysisSavePayload {
  issueId: string;
  projectId: string;
  /** 分析结果文本，形如"可能导致XXXX的风险" */
  result: string;
  analyst?: string;
}

export interface RiskAnalysisSummary {
  total: number;
  analyzed: number;
  pending: number;
  /** 按问题初判风险等级统计（与问题清单口径一致） */
  high: number;
  medium: number;
  low: number;
}

export interface RiskAnalysisListResult {
  list: IssueRiskAnalysis[];
  summary: RiskAnalysisSummary;
}

/** AI 生成的风险分析结果草稿（仅一段文本，落库统一走 riskAnalysis:save） */
export interface RiskAiDraft {
  result: string;
}

/** 批量风险分析进度推送（ai:batchRiskProgress 事件） */
export interface RiskBatchProgress {
  stage: string;
  message: string;
  percent: number;
  current: number;
  total: number;
}

/** AI 依据等保高风险判定指引给出的定级结论 */
export interface RiskLevelJudgment {
  level: 'high' | 'medium' | 'low';
  /** 命中的指引条目 ID；未匹配到任何条目时为空字符串 */
  matchedId: string;
  /** 命中的指引条目标题，便于前端展示依据 */
  matchedTitle?: string;
  /** 判定依据（40～90 字） */
  reason: string;
}

/** 单条 / 批量风险等级判定输入 */
export interface RiskLevelJudgeParams {
  issueId?: string;
  issueTitle: string;
  issueDescription: string;
  securityDomain: string;
  controlPoint: string;
  controlName: string;
  assetName?: string;
  rectificationSuggestion?: string;
  currentLevel?: string;
}

/** 批量定级结果项 */
export interface RiskLevelJudgeResult {
  issueId: string;
  judgment?: RiskLevelJudgment;
  success: boolean;
  error?: string;
}

/* ============================================================================
 * 重大风险隐患识别与分析
 * 清单（majorRiskCatalog）全局共用；分析结论（majorRiskAnalysis）一条问题一份。
 * ==========================================================================*/

/** 重大风险隐患清单条目（用户提供内容后导入/编辑，全局共用） */
export interface MajorRiskCatalogItem {
  id: string;
  code?: string;
  title: string;
  category?: string;
  criteria?: string;
  keywords?: string;
  source?: string;
  sortOrder: number;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

/** 最终判定：属于重大风险隐患 / 不属于 / 待判定 */
export type MajorRiskVerdict = 'major' | 'non_major' | 'pending';

/** 一条问题的三要素分析结果（视图行：issues 字段 + 分析字段） */
export interface MajorRiskRow {
  issueId: string;
  projectId: string;
  issueTitle: string;
  issueDescription: string;
  securityDomain: string;
  controlPoint: string;
  controlName: string;
  assetName?: string;
  riskLevel: RiskLevel3;
  status: string;
  /** 命中的清单条目 id（快照名一并给，清单条目被删也能显示依据） */
  catalogId?: string;
  catalogTitle?: string;
  /** 相关性：与清单条目的关联程度，一段话 */
  relevance?: string;
  /** 严重性：危害后果的严重程度，一段话 */
  severity?: string;
  /** 高发性：问题反复出现的可能性，一段话 */
  frequency?: string;
  verdict: MajorRiskVerdict;
  conclusion?: string;
  analyst?: string;
  analyzedAt?: string;
  reviewedAt?: string;
  source: 'ai' | 'manual';
}

export interface MajorRiskSummary {
  total: number;
  analyzed: number;
  pending: number;
  major: number;
  nonMajor: number;
  /** 清单条目总数（启用的） */
  catalogCount: number;
}

export interface MajorRiskListResult {
  list: MajorRiskRow[];
  summary: MajorRiskSummary;
}

/** 保存/复核一条分析结果（后端带归属校验与字段白名单） */
export interface MajorRiskSavePayload {
  issueId: string;
  projectId: string;
  catalogId?: string;
  catalogTitle?: string;
  relevance?: string;
  severity?: string;
  frequency?: string;
  verdict: MajorRiskVerdict;
  conclusion?: string;
  analyst?: string;
  source?: 'ai' | 'manual';
}

/** AI 生成的三要素草稿（不写库，前端回填后走 majorRisk:save 落库） */
export interface MajorRiskAiDraft {
  catalogId: string;
  catalogTitle: string;
  relevance: string;
  severity: string;
  frequency: string;
  verdict: MajorRiskVerdict;
  conclusion: string;
}

/** 单条 AI 识别输入：问题描述来自风险分析页，附现场记录检索片段 */
export interface MajorRiskAiParams {
  issueId: string;
  projectId: string;
  issueTitle: string;
  issueDescription: string;
  securityDomain: string;
  controlPoint: string;
  controlName: string;
  assetName?: string;
  riskLevel?: string;
  rectificationSuggestion?: string;
}

/** 批量识别进度推送（ai:batchMajorRiskProgress 事件） */
export interface MajorRiskBatchProgress {
  stage: string;
  message: string;
  percent: number;
  current: number;
  total: number;
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
  // Phase 4 · 任务 30：命令库行业维度（可选）。空字符串表示通用命令（跨行业通用）。
  industry?: string;
  isFavorite: number;
  referenceCount: number;
  createdAt: string;
  updatedAt: string;
}

export type KnowledgeCommandIndustryMode = 'exact' | 'universal' | 'matchOrUniversal' | 'matchOrAll';

export interface KnowledgeCommandListParams {
  keyword?: string;
  os?: string;
  brand?: string;
  deviceType?: string;
  category?: string;
  subCategory?: string;
  // Phase 4 · 任务 30：行业筛选
  industry?: string;                                  // 精确匹配 industry 列；空字符串表示只查询通用命令
  industryMode?: KnowledgeCommandIndustryMode;       // 筛选模式：exact=只 industry；universal=只通用；matchOrUniversal=行业 + 通用（默认）；matchOrAll=行业 + 所有其他
  projectStandardId?: string;                         // 项目标准 ID（内部）：自动解析 standards.industry 再筛选
  page?: number;
  pageSize?: number;
}

export interface KnowledgeCommandListResult {
  list: KnowledgeCommand[];
  total: number;
  // 若启用了项目级行业筛选，这里会返回实际匹配到的行业（可空）
  matchedIndustry?: string | null;
}

export interface KnowledgeCommandIndustryStat {
  industry: string;   // 空字符串表示通用命令
  count: number;
}

export interface CloudModel {
  id: string;
  name: string;
  apiBase: string;
  apiKey?: string;
  model: string;
  apiFormat: string;
  enabled: boolean;
  priority: number;
}

// AI 提示词信息（自定义提示词管理）
export interface AiPromptVariable {
  name: string;
  description: string;
}

export interface AiPromptInfo {
  key: string;
  name: string;
  description: string;
  variables: AiPromptVariable[];
  template: string;
  builtinTemplate: string;
  customized: boolean;
  warnings: string[];
}

export interface ChatAttachment {
  name: string;
  path: string;
  type: 'image' | 'document';
  size: number;
}

export interface ChatMessageWithAttachments {
  role: string;
  content: string;
  attachments?: ChatAttachment[];
}

/** AI 助手对话的流式增量事件（主进程 → 发起窗口）。 */
export interface AiChatStreamChunk {
  requestId: string;
  type: 'delta';
  text: string;
}

/** ai:chatStream 的返回数据；失败时 error.code = AI_STREAM_FALLBACK 由前端回退一次性请求。 */
export interface AiChatStreamResult {
  content: string;
  modelName?: string;
  switched?: boolean;
  suggestions: string[];
  partial?: 'canceled' | 'interrupted';
}

// ============ 项目归档（整包导出 / 整包还原） ============

export interface ProjectArchiveCounts {
  assets: number;
  records: number;
  issues: number;
  tasks: number;
  results: number;
  documents: number;
  members: number;
  connections: number;
  standards: number;
  items: number;
  files: number;
}

export interface ProjectArchiveSummary {
  id: string;
  name: string;
  systemName: string;
  level: number;
  status: string;
  createdAt: string;
  assetCount: number;
  recordCount: number;
  issueCount: number;
  taskCount: number;
  /** 仅预览（导入前）时给出：该 id 的项目在本机是否已存在 */
  existsLocally?: boolean;
  localName?: string;
}

export interface ProjectArchiveManifest {
  version: string;
  appVersion: string;
  createdAt: string;
  projects: ProjectArchiveSummary[];
  counts: ProjectArchiveCounts;
  includeStandards: boolean;
  credentialsIncluded: boolean;
  encrypted: boolean;
}

export interface ProjectArchiveExportResult {
  success?: boolean;
  path?: string;
  size?: number;
  fileCount?: number;
  missingFiles?: string[];
}

export interface ProjectArchivePreview {
  manifest: ProjectArchiveManifest;
  projects: ProjectArchiveSummary[];
  encrypted?: boolean;
  warnings?: string[];
}

export type ProjectArchiveConflictStrategy = 'skip' | 'overwrite' | 'copy';

export interface ProjectArchiveImportResult {
  imported: Array<{ id: string; name: string; mode: 'new' | 'overwrite' | 'copy' }>;
  skipped: string[];
  restoredFiles: number;
  missingFiles: number;
  warnings: string[];
}

// ============ 内置 / 自定义外链 ============
// 与主进程 electron/services/external-link-core.ts 的 ExternalLinkItem 字段一一对应。
// 主进程用 core 的类型，渲染层用这里的类型，IPC 边界靠字段一致而非共享运行时对象。
export type ExternalLinkSource = 'builtin' | 'custom';
export type ExternalLinkNetworkZone = 'internet' | 'intranet';

export interface ExternalLinkItem {
  id: string;
  key: string;
  title: string;
  url: string;
  groupName: string;
  description: string;
  iconText: string;
  networkZone: ExternalLinkNetworkZone;
  source: ExternalLinkSource;
  isHidden: boolean;
  isFavorite: boolean;
  isStale: boolean;
  sortOrder: number;
  lastOpenedAt: string | null;
  hasOverride: boolean;
  scope: string;
}

export interface ExternalLinkCreateInput {
  title: string;
  url: string;
  groupName?: string;
  description?: string;
  iconText?: string;
  networkZone?: ExternalLinkNetworkZone;
  isHidden?: boolean;
  isFavorite?: boolean;
  sortOrder?: number;
}

export interface ExternalLinkPatch {
  title?: string;
  url?: string;
  groupName?: string;
  description?: string;
  iconText?: string;
  networkZone?: ExternalLinkNetworkZone;
  isHidden?: boolean;
  isFavorite?: boolean;
  isStale?: boolean;
  sortOrder?: number;
}

export interface LinkOpenContext {
  projectName?: string;
  assetIp?: string;
  standardCode?: string;
}

export interface ExternalLinkImportResult {
  imported: number;
  skipped: number;
  errors: string[];
}

/**
 * 手动导入 sites.txt 时「仅测评相关分类」勾选框使用的推荐分类。
 * 只是导入时的默认建议，不是同步白名单；取消勾选即可全量导入。
 */
export const RECOMMENDED_SITES_GROUPS = [
  '学习资料 / 等保密评',
  '学习资料 / 标准学习',
  '渗透相关 / 空间测绘',
  '渗透相关 / 渗透测试',
  '技术论坛',
];

export type ExternalLinkImportFormat = 'sites' | 'bookmarks' | 'json';

export interface ApiBridge {
  auth: {
    login: (username: string, password: string) => Promise<IpcResponse<LoginResult>>;
    logout: (token?: string) => Promise<IpcResponse<void>>;
    getCurrentUser: (token: string) => Promise<IpcResponse<{ userId: string; username: string } | null>>;
    changePassword: (params: { token: string; oldPassword: string; newPassword: string }) => Promise<IpcResponse<void>>;
    validateSession: (token: string) => Promise<IpcResponse<{ valid: boolean; userId?: string; username?: string; user?: User }>>;
    encryptCredential: (plaintext: string) => Promise<IpcResponse<{ encrypted: string }>>;
    decryptCredential: (encrypted: string) => Promise<IpcResponse<{ decrypted: string }>>;
    isEncryptionAvailable: () => Promise<IpcResponse<{ available: boolean }>>;
  };
  project: {
    list: (params: ProjectListParams) => Promise<IpcResponse<ProjectListResult>>;
    get: (id: string) => Promise<IpcResponse<Project>>;
    getStatistics: () => Promise<IpcResponse<{
      projectCount: number;
      inProgressCount: number;
      completedCount: number;
      draftCount: number;
      archivedCount: number;
      level2Count: number;
      level3Count: number;
      level4Count: number;
      otherLevelCount: number;
      assetCount: number;
    }>>;
    getTrend: () => Promise<IpcResponse<{ months: string[]; created: number[]; cumulative: number[] }>>;
    create: (data: Partial<Project>) => Promise<IpcResponse<Project>>;
    update: (id: string, data: Partial<Project>) => Promise<IpcResponse<Project>>;
    /** 系统拓扑图专用更新（附件列表与分区分域描述），不影响测评进度 */
    updateTopology: (id: string, data: {
      attachments?: Array<{ name: string; path: string; size: number }>;
      description?: string;
    }) => Promise<IpcResponse<Project>>;
    remove: (id: string) => Promise<IpcResponse<void>>;
    export: (projectId: string) => Promise<IpcResponse<{ path: string }>>;
    /** 导出项目字段清单（Excel，不可回导）；不传 projectIds 则导出全部 */
    exportAll: (projectIds?: string[]) => Promise<IpcResponse<{ path: string }>>;
    resolveStandardId: (projectId: string) => Promise<IpcResponse<string>>;
    // —— 项目归档：把项目的全部数据（含附件与依赖标准）整体导出 / 还原 ——
    exportArchive: (payload: {
      projectIds: string[];
      password?: string;
      includeStandards?: boolean;
      includeCredentials?: boolean;
    }) => Promise<IpcResponse<ProjectArchiveExportResult>>;
    selectArchive: () => Promise<IpcResponse<{ path: string; encrypted: boolean }>>;
    previewArchive: (payload: {
      archivePath: string;
      password?: string;
    }) => Promise<IpcResponse<ProjectArchivePreview>>;
    importArchive: (payload: {
      archivePath: string;
      password?: string;
      strategy: ProjectArchiveConflictStrategy;
    }) => Promise<IpcResponse<ProjectArchiveImportResult>>;
  };
  /** 项目分组：一个项目下可包含多个独立测评的系统 */
  projectGroup: {
    list: (params: ProjectGroupListParams) => Promise<IpcResponse<ProjectGroupListResult>>;
    get: (id: string) => Promise<IpcResponse<ProjectGroup>>;
    create: (data: Partial<ProjectGroup>) => Promise<IpcResponse<ProjectGroup>>;
    update: (id: string, data: Partial<ProjectGroup>) => Promise<IpcResponse<ProjectGroup>>;
    remove: (id: string) => Promise<IpcResponse<void>>;
  };
  asset: {
    list: (params: AssetListParams) => Promise<IpcResponse<AssetListResult>>;
    create: (data: Partial<Asset>) => Promise<IpcResponse<Asset>>;
    update: (id: string, data: Partial<Asset>) => Promise<IpcResponse<Asset>>;
    remove: (id: string) => Promise<IpcResponse<void>>;
    batchRemove: (ids: string[]) => Promise<IpcResponse<void>>;
    // expectedCategory：用户在系统构成页当前选中的分类。单 sheet 导入时按此落库，避免靠 sheet 名/路径猜分类
    importExcel: (projectId: string, filePath: string, expectedCategory?: string) => Promise<IpcResponse<{ count: number; category?: string; skipped?: number; results?: Array<{ sheet: string; count: number }> }>>;
    exportExcel: (projectId: string, category: string) => Promise<IpcResponse<string>>;
    downloadTemplate: (projectId: string) => Promise<IpcResponse<string>>;
  };
  standard: {
    list: () => Promise<IpcResponse<Standard[]>>;
    getDomains: (standardId: string) => Promise<IpcResponse<StandardDomain[]>>;
    getItems: (standardId: string, domain?: string) => Promise<IpcResponse<AssessmentItem[]>>;
    setDefault: (standardId: string) => Promise<IpcResponse<void>>;
    remove: (standardId: string) => Promise<IpcResponse<void>>;
    import: (data: StandardImportData, opts?: { overwrite?: boolean; dryRun?: boolean }) => Promise<IpcResponse<{
      id: string; domainCount: number; itemCount: number;
      standard?: Standard | null;
      dryRun?: boolean; ok?: boolean;
      message?: string;
      warnings?: string[];
      details?: Partial<{ domainCount: number; itemCount: number; highRiskCount: number; industryDomains: number; nationalDomains: number }>;
      duplicateItemIds?: string[];
    }>>;
    // 从 Excel 文件解析标准数据（xlsx base64 → StandardImportData JSON）
    parseExcel: (content: string) => Promise<IpcResponse<StandardImportData>>;
    create: (data: Partial<StandardImportData>) => Promise<IpcResponse<{ id: string }>>;
    update: (standardId: string, fields: Partial<Standard>) => Promise<IpcResponse<{ success: boolean }>>;
    export: (standardId: string) => Promise<IpcResponse<StandardImportData>>;
    // 批量导出标准：把多个标准一次性序列化为 JSON 数组；前端按每个标准独立写文件
    exportBatch: (standardIds: string[]) => Promise<IpcResponse<Array<StandardImportData & { _exportWarnings?: string[] }>>>;
    // 标准导出为 Excel（控制手册/导入回灌格式，一标准 = 1 个多 sheet 工作簿）
    // 单条：返回 {kind:'xlsx', fileName, content: base64}
    // 多条：返回 {kind:'zip', fileName, content: base64}（zip 内含每个标准独立 .xlsx）
    exportExcel: (standardIds: string[]) => Promise<IpcResponse<{
      kind: 'xlsx' | 'zip';
      fileName: string;
      content: string; // base64
      fileCount: number;
      warnings?: string[];
    }>>;
    // 导入模板下载：kind='json' 返回 JSON 示例内容（UTF-8 文本）；kind='excel' 返回 xlsx Buffer base64
    // preset 默认 'national'；industry='power'/'finance'/'custom' 会调整示例表头/扩展列
    downloadTemplate: (params: {
      kind: 'json' | 'excel';
      preset?: 'national' | 'power' | 'finance' | 'custom';
    }) => Promise<IpcResponse<{
      kind: 'json' | 'excel';
      fileName: string;
      // JSON 模板：content 为字符串（UTF-8 文本，写 .json）；Excel 模板：content 为 base64（写 .xlsx）
      content: string;
      sampleStandardName?: string;
    }>>;
    // Phase 4 · 任务 27：双标准对照表（可选，按需启用）
    compare: (leftStandardId: string, rightStandardId: string) => Promise<IpcResponse<any>>;
    // 合规统计：项目 × 标准 → 按域/汇总统计（适用条目、判定结果、覆盖率、合规率）
    getComplianceStats: (params: { projectId: string; standardId: string }) => Promise<IpcResponse<any>>;
  };
  assessment: {
    getItems: (standardId: string, domain?: string, projectLevel?: number, extensionType?: string | string[]) => Promise<IpcResponse<AssessmentItem[]>>;
    // 第二参数是 projectId（用于行标项目的动态 sheet 名解析），不是项目等级
    getItemsByCategory: (category: string, projectId?: string) => Promise<IpcResponse<AssessmentItem[]>>;
    getRecords: (projectId: string, itemId: string) => Promise<IpcResponse<AssessmentRecord[]>>;
    getRecordsByAsset: (projectId: string, assetId: string) => Promise<IpcResponse<AssessmentRecord[]>>;
    getProjectRecords: (projectId: string) => Promise<IpcResponse<AssessmentRecord[]>>;
    getRecordByAssetAndItem: (projectId: string, assetId: string, itemId: string) => Promise<IpcResponse<AssessmentRecord | null>>;
    saveRecord: (data: Partial<AssessmentRecord>) => Promise<IpcResponse<AssessmentRecord>>;
    getProgress: (projectId: string, standardId: string) => Promise<IpcResponse<AssessmentProgress>>;
    listDomains: (standardId?: string) => Promise<IpcResponse<{ id: string; name: string; count: number }[]>>;
    exportExcel: (projectId: string, domain?: string) => Promise<IpcResponse<{ path: string }>>;
    exportExcelByAssets: (projectId: string, assetIds: string[], domainIds: string[]) => Promise<IpcResponse<{ path: string }>>;
    getExcelSheetInfo: (projectId: string, filePath: string) => Promise<IpcResponse<{ sheets: ExcelSheetInfo[] }>>;
    importExcel: (projectId: string, filePath: string, sheetNames?: string[]) => Promise<IpcResponse<{ count: number }>>;
  };
  screenshot: {
    upload: (params: { projectId: string; itemId: string; filePath: string }) => Promise<IpcResponse<{ path: string; name: string }>>;
    saveFromBase64: (params: { projectId: string; itemId: string; base64Data: string }) => Promise<IpcResponse<{ path: string; name: string }>>;
    getBase64: (params: { filePath: string }) => Promise<IpcResponse<{ base64: string; mimeType: string }>>;
    uploadFile: (params: { projectId: string; itemId: string; filePath: string }) => Promise<IpcResponse<{ path: string; name: string }>>;
    readText: (params: { filePath: string }) => Promise<IpcResponse<{ content: string }>>;
    readWord: (params: { filePath: string }) => Promise<IpcResponse<{ content: string }>>;
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
    batchUpdateStatus: (ids: string[], status?: string, riskLevel?: string) => Promise<IpcResponse<void>>;
    updateEvidence: (id: string, evidenceFiles: string[]) => Promise<IpcResponse<void>>;
  };
  /** 风险分析：读写 issues 行上的 risk_* 列，一条问题一份分析结论 */
  riskAnalysis: {
    list: (params: { projectId: string }) => Promise<IpcResponse<RiskAnalysisListResult>>;
    save: (payload: RiskAnalysisSavePayload) => Promise<IpcResponse<IssueRiskAnalysis>>;
    clear: (payload: { issueId: string; projectId: string }) => Promise<IpcResponse<void>>;
    generateDraft: (projectId: string) => Promise<IpcResponse<{ count: number }>>;
    exportExcel: (projectId: string) => Promise<IpcResponse<string>>;
  };
  /** 重大风险隐患识别与分析：全局清单 + 一条问题一份三要素判定 */
  majorRisk: {
    list: (params: { projectId: string }) => Promise<IpcResponse<MajorRiskListResult>>;
    save: (payload: MajorRiskSavePayload) => Promise<IpcResponse<MajorRiskRow>>;
    clear: (payload: { issueId: string; projectId: string }) => Promise<IpcResponse<void>>;
    exportExcel: (projectId: string) => Promise<IpcResponse<string>>;
    catalogList: () => Promise<IpcResponse<MajorRiskCatalogItem[]>>;
    catalogSave: (item: Partial<MajorRiskCatalogItem> & { id?: string }) => Promise<IpcResponse<MajorRiskCatalogItem>>;
    catalogRemove: (id: string) => Promise<IpcResponse<void>>;
    catalogImport: (items: Array<Partial<MajorRiskCatalogItem>>) => Promise<IpcResponse<{ count: number; replaced: boolean }>>;
    /** AI 识别前按当前问题从清单召回的候选条目（供展示"命中依据"） */
    matchCatalog: (params: MajorRiskAiParams) => Promise<IpcResponse<MajorRiskCatalogItem[]>>;
    /** AI 识别时一并检索的现场测评记录片段 */
    searchRecords: (params: { projectId: string; issueId?: string; keyword?: string }) => Promise<IpcResponse<Array<{ id: string; itemId: string; assetName: string; result: string; findings: string; evidence: string; commandOutput: string }>>>;
  };
  report: {
    generate: (options: {
      format: 'pdf' | 'docx';
      template: 'standard' | 'detailed' | 'simple';
      includeSections: string[];
      projectId: string;
      savePath: string;
      aiEnhanced?: boolean;
    }) => Promise<IpcResponse<{ filePath: string }>>;
    /** 项目级合册报告：项目综述 + 各系统分册装订，groupId 为 project_groups.id */
    generateProject: (options: {
      format: 'pdf' | 'docx';
      template: 'standard' | 'detailed' | 'simple';
      includeSections: string[];
      groupId: string;
      savePath: string;
      aiEnhanced?: boolean;
    }) => Promise<IpcResponse<{ filePath: string }>>;
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
    listCommandIndustries: () => Promise<IpcResponse<KnowledgeCommandIndustryStat[]>>;
    createCommand: (data: Partial<KnowledgeCommand>) => Promise<IpcResponse<string>>;
    updateCommand: (id: string, data: Partial<KnowledgeCommand>) => Promise<IpcResponse<void>>;
    deleteCommand: (id: string) => Promise<IpcResponse<void>>;
    favoriteCommand: (id: string, isFavorite: number) => Promise<IpcResponse<void>>;
    importExcel: (filePath: string) => Promise<IpcResponse<{ imported: number; errors: string[] }>>;
    getStats: () => Promise<IpcResponse<any>>;
    importKnowledge: (filePath: string) => Promise<IpcResponse<{ count: number }>>;
    exportKnowledge: () => Promise<IpcResponse<{ path: string }>>;
    downloadDocument: (id: string) => Promise<IpcResponse<{ path: string; title: string }>>;
    downloadAndSave: (id: string) => Promise<IpcResponse<{ saved: boolean; path?: string }>>;
    uploadDocument: (data: { categoryId: string; title: string; type: string; description: string; version: string; tags: string; filePath: string }) => Promise<IpcResponse<{ id: string }>>;
    referenceDocument: (data: { documentId: string; targetId: string; targetType: string }) => Promise<IpcResponse<void>>;
    importSingleDocument: (data: { categoryId: string; title: string; type: string; description: string; version: string; tags: string; filePath: string }) => Promise<IpcResponse<{ id: string }>>;
    listDirectoryFiles: (dirPath: string) => Promise<IpcResponse<{ name: string; path: string; size: number; isFile: boolean }[]>>;
    readExcelFile: (filePath: string, sheetName?: string) => Promise<IpcResponse<{ sheetNames: string[]; columns: string[]; data: any[] }>>;
    readWordFile: (filePath: string) => Promise<IpcResponse<{ html: string }>>;
  };
  file: {
    exists: (filePath: string) => Promise<IpcResponse<boolean>>;
    readAsArrayBuffer: (filePath: string) => Promise<IpcResponse<ArrayBuffer>>;
    readAsText: (filePath: string) => Promise<IpcResponse<string>>;
    // Phase 4 可选：孤儿截图/证据清理（方案 §九.496）
    // - dryRun=true（默认）返回预清理报告，不真正删
    // - dryRun=false 真正执行删除；不传 projectId = 全局
    cleanupScreenshots: (opts?: { dryRun?: boolean; projectId?: string }) => Promise<IpcResponse<{
      dryRun: boolean;
      scannedDirs: string[];
      totalScanned: number;
      totalReferenced: number;
      orphanCount: number;
      orphanSizeBytes: number;
      orphans: Array<{ absPath: string; size: number; mtime: number }>;
      deleted: Array<{ absPath: string; size: number }>;
      failed: Array<{ absPath: string; error: string }>;
      emptyDirsRemoved: number;
      tempCleanupCount: number;
    }>>;
  };
  system: {
    getInfo: () => Promise<IpcResponse<SystemInfo>>;
    openDataFolder: () => Promise<IpcResponse<void>>;
    selectFile: (filters?: FileFilter[]) => Promise<IpcResponse<string | null>>;
    saveFile: (defaultPath?: string, filters?: FileFilter[]) => Promise<IpcResponse<string | null>>;
    backupData: (customPath?: string, password?: string) => Promise<IpcResponse<string>>;
    restoreData: (backupPath: string, options?: { incremental?: boolean; projectIds?: string[]; password?: string }) => Promise<IpcResponse<void>>;
    previewBackup: (backupPath: string, password?: string) => Promise<IpcResponse<any>>;
    isBackupEncrypted: (backupPath: string) => Promise<IpcResponse<boolean>>;
    listBackups: () => Promise<IpcResponse<any[]>>;
    changeDataPath: (newPath: string) => Promise<IpcResponse<string>>;
  };
  window: {
    minimize: () => Promise<IpcResponse<void>>;
    maximizeToggle: () => Promise<IpcResponse<boolean>>;
    isMaximized: () => Promise<IpcResponse<boolean>>;
    close: () => Promise<IpcResponse<void>>;
    onMaximizeChange: (callback: (maximized: boolean) => void) => () => void;
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
    chat: (params: { messages: ChatMessageWithAttachments[]; model?: string; temperature?: number; context?: string }) => Promise<IpcResponse<{ content: string; suggestions: string[] }>>;
    chatStream: (params: { messages: ChatMessageWithAttachments[]; model?: string; temperature?: number; context?: string; requestId: string }) => Promise<IpcResponse<AiChatStreamResult>>;
    onChatChunk: (callback: (data: AiChatStreamChunk) => void) => () => void;
    cancelChat: () => Promise<IpcResponse<{ canceled: boolean }>>;
    analyzeAssessment: (params: { controlPoint: string; requirement: string; command: string; result: string; screenshots?: string[]; ocrPreprocess?: boolean; standardId?: string; itemId?: string; domain?: string; assetCategory?: string; assetOs?: string }) => Promise<IpcResponse<{ content: string; recalledCount?: number; recalledCheckpoints?: string[] }>>;
    cancelSingleAnalysis: () => Promise<IpcResponse<{ canceled: boolean }>>;
    batchAnalyzeScreenshots: (params: { items: { id: string; controlPoint: string; requirement: string; domain?: string; assetCategory?: string; assetOs?: string }[]; screenshots: string[]; documents?: { name: string; content: string }[]; ocrPreprocess?: boolean }) => Promise<IpcResponse<{ content: string }>>;
    cancelBatchScreenshots: () => Promise<IpcResponse<{ canceled: boolean }>>;
    analyzeIssue: (params: { issueId: string; issueTitle: string; issueDescription: string; securityDomain: string; controlPoint: string; controlName: string; standardId?: string; projectId?: string; itemId?: string }) => Promise<IpcResponse<{ content: string }>>;
    cancelIssue: () => Promise<IpcResponse<{ canceled: boolean }>>;
    analyzeIssueDescription: (params: { issueId: string; issueTitle: string; issueDescription: string; securityDomain: string; controlPoint: string; controlName: string; standardId?: string; projectId?: string; itemId?: string }) => Promise<IpcResponse<{ content: string }>>;
    /** 批量分析问题描述（分批次，一次多条） */
    batchAnalyzeIssueDescriptions: (params: { issues: Array<{ issueId: string; issueTitle: string; issueDescription: string; securityDomain: string; controlPoint: string; controlName: string }> }) => Promise<IpcResponse<{ results: Array<{ issueId: string; content: string; success: boolean; error?: string }>; canceled?: boolean }>>;
    cancelIssueDescription: () => Promise<IpcResponse<{ canceled: boolean }>>;
    batchAnalyzeIssues: (params: { issues: Array<{ issueId: string; issueTitle: string; issueDescription: string; securityDomain: string; controlPoint: string; controlName: string; standardId?: string; itemId?: string }>; projectId?: string }) => Promise<IpcResponse<{ results: Array<{ issueId: string; suggestion: string; success: boolean; error?: string }>; canceled?: boolean }>>;
    cancelBatchIssueAnalysis: () => Promise<IpcResponse<{ canceled: boolean }>>;
    analyzeRisk: (params: {
      issueId?: string;
      issueTitle: string;
      issueDescription: string;
      securityDomain: string;
      controlPoint: string;
      controlName: string;
      assetName?: string;
      riskLevel?: string;
      rectificationSuggestion?: string;
    }) => Promise<IpcResponse<RiskAiDraft>>;
    cancelRiskAnalysis: () => Promise<IpcResponse<{ canceled: boolean }>>;
    batchAnalyzeRisks: (params: { issues: Array<{
      issueId: string;
      issueTitle: string;
      issueDescription: string;
      securityDomain: string;
      controlPoint: string;
      controlName: string;
      assetName?: string;
      riskLevel?: string;
      rectificationSuggestion?: string;
    }> }) => Promise<IpcResponse<{ results: Array<{ issueId: string; draft?: RiskAiDraft; success: boolean; error?: string }>; canceled?: boolean }>>;
    onBatchRiskProgress: (callback: (data: RiskBatchProgress) => void) => () => void;
    /** 重大风险隐患：三要素识别（相关性/严重性/高发性 + 最终判定 + 现场记录检索） */
    analyzeMajorRisk: (params: MajorRiskAiParams) => Promise<IpcResponse<MajorRiskAiDraft>>;
    cancelMajorRiskAnalysis: () => Promise<IpcResponse<{ canceled: boolean }>>;
    batchAnalyzeMajorRisks: (params: { issues: MajorRiskAiParams[] }) => Promise<IpcResponse<{
      results: Array<{ issueId: string; draft?: MajorRiskAiDraft; success: boolean; error?: string }>;
      canceled?: boolean;
    }>>;
    onBatchMajorRiskProgress: (callback: (data: MajorRiskBatchProgress) => void) => () => void;
    judgeRiskLevel: (params: RiskLevelJudgeParams) => Promise<IpcResponse<RiskLevelJudgment>>;
    batchJudgeRiskLevels: (params: { issues: RiskLevelJudgeParams[] }) => Promise<IpcResponse<{ results: RiskLevelJudgeResult[]; canceled: boolean }>>;
    cancelRiskLevelJudge: () => Promise<IpcResponse<{ canceled: boolean }>>;
    onBatchRiskLevelProgress: (callback: (data: RiskBatchProgress) => void) => () => void;
    searchKnowledge: (params: { question: string }) => Promise<IpcResponse<{ content: string; modelName?: string; referencedDocs: Array<{ id: string; title: string }> }>>;
    recommendCommands: (params: { controlPoint?: string; controlName?: string; requirement?: string; assetLabel?: string; brand?: string; os?: string; deviceType?: string }) => Promise<IpcResponse<{
      commands: Array<Record<string, any> & { reason?: string; source?: 'library' }>;
      aiMethods: Array<{
        type: 'check' | 'interview' | 'test';
        title: string;
        steps: string[];
        commands: Array<{ name: string; command: string; os: string; brand: string }>;
        reason: string;
        source: 'ai';
      }>;
    }>>;
    identifyAssets: (params: { projectId?: string; systemName?: string; description?: string; imagePaths?: string[]; documents?: string[]; ocrPreprocess?: boolean }) => Promise<IpcResponse<{ assets: Array<Record<string, any>>; warnings?: string[]; truncated?: boolean; capped?: boolean }>>;
    checkMissingAssets: (params: { projectId?: string; systemName?: string }) => Promise<IpcResponse<{ missing: Array<{ category: string; risk: string; suggestion: string }> }>>;
    dashboardInsight: () => Promise<IpcResponse<{
      insight: string;
      alerts: Array<{ key: string; severity: string; title: string; detail: string }>;
      alertAdvices: Array<{ key: string; advice: string }>;
    }>>;
    explainStandardDiff: (params: {
      baseStandard: string;
      targetStandard: string;
      stats?: Record<string, any>;
      rows?: Array<Record<string, any>>;
    }) => Promise<IpcResponse<{
      summary: string;
      keyDiffs: Array<{ domain: string; point: string; impact: string }>;
      advice: string;
    }>>;
    standardComplianceGap: (params: { projectId: string; standardId: string; precomputed?: { domains?: Array<Record<string, any>>; summary?: Record<string, any>; nonCompliantSamples?: Array<Record<string, any>> } }) => Promise<IpcResponse<{
      summary: string;
      gaps: Array<{ domain: string; gap: string; risk: string; priority: string; suggestion: string }>;
      domains: Array<Record<string, any>>;
      nonCompliantSamples: Array<Record<string, any>>;
      stats: Record<string, any>;
    }>>;
    getConfig: () => Promise<IpcResponse<any>>;
    saveConfig: (config: { apiBase: string; apiKey: string; model: string; temperature: number; privacyMode?: number; sensitiveWords?: string; mode?: string; localEngine?: 'ollama' | 'herdsman'; ollamaModel?: string; ollamaUrl?: string; herdsmanUrl?: string; herdsmanModel?: string; ocrPreprocess?: boolean; proxyMode?: 'system' | 'manual' | 'none'; proxyUrl?: string | null }) => Promise<IpcResponse<void>>;
    testConnection: (params?: { apiBase?: string; apiKey?: string; model?: string; mode?: string; ollamaUrl?: string; herdsmanUrl?: string; localEngine?: 'ollama' | 'herdsman' }) => Promise<IpcResponse<any>>;
    getModels: () => Promise<IpcResponse<{ models: CloudModel[]; activeModelId: string | null }>>;
    createModel: (data: Omit<CloudModel, 'id'>) => Promise<IpcResponse<{ id: string }>>;
    updateModel: (modelId: string, data: Partial<CloudModel>) => Promise<IpcResponse<void>>;
    deleteModel: (modelId: string) => Promise<IpcResponse<void>>;
    setActiveModel: (modelId: string | null) => Promise<IpcResponse<void>>;
    testModelConnection: (modelId: string) => Promise<IpcResponse<any>>;
    getProgress: () => Promise<IpcResponse<{ stage: string; message: string; percent: number; timestamp: number } | null>>;
    onAnalysisProgress: (callback: (data: { stage: string; message: string; percent: number; scope?: string }) => void) => () => void;
    onAssetIdentifyProgress: (callback: (data: { stage: string; message: string; percent: number; currentBatch?: number; totalBatches?: number; batchLabels?: string[] }) => void) => () => void;
    /** 拓扑图分区分域识别（独立按钮，不触碰资产） */
    analyzeTopology: (params: { projectId?: string; systemName?: string; imagePaths?: string[] }) => Promise<IpcResponse<{ domains: Array<{ name: string; description: string }>; overview?: string; partial?: boolean }>>;
    onTopologyProgress: (callback: (data: { stage: string; message: string; percent: number }) => void) => () => void;
    onBatchIssueProgress: (callback: (data: { stage: string; message: string; percent: number; current: number; total: number }) => void) => () => void;
    onBatchIssueDescProgress: (callback: (data: { stage: string; message: string; percent: number; current: number; total: number }) => void) => () => void;
    listPrompts: () => Promise<IpcResponse<AiPromptInfo[]>>;
    savePrompt: (payload: { key: string; template: string }) => Promise<IpcResponse<{ success: boolean }>>;
    resetPrompt: (payload: { key: string }) => Promise<IpcResponse<{ success: boolean }>>;
  };
  aiConversation: {
    list: () => Promise<IpcResponse<Array<{ id: string; title: string; projectId: string | null; createdAt: string; updatedAt: string }>>>;
    create: (data?: { title?: string; projectId?: string | null }) => Promise<IpcResponse<{ id: string; title: string; createdAt: string; updatedAt: string }>>;
    rename: (id: string, title: string) => Promise<IpcResponse<void>>;
    delete: (id: string) => Promise<IpcResponse<void>>;
    appendMessages: (conversationId: string, messages: Array<{
      id: string;
      role: string;
      content: string;
      suggestions?: string[];
      attachments?: Array<{ name: string; path: string; type: 'image' | 'document'; size: number }>;
    }>) => Promise<IpcResponse<void>>;
    clearMessages: (conversationId: string) => Promise<IpcResponse<void>>;
    getMessages: (conversationId: string) => Promise<IpcResponse<Array<{
      id: string;
      role: string;
      content: string;
      suggestions?: string[];
      attachments?: Array<{ name: string; path: string; type: 'image' | 'document'; size: number }>;
      createdAt: string;
    }>>>;
  };
  checkpoint: {
    pickFile: () => Promise<IpcResponse<{ paths: string[] }>>;
    downloadTemplate: () => Promise<IpcResponse<{ canceled?: boolean; path?: string }>>;
    preview: (filePath: string) => Promise<IpcResponse<{
      file: string;
      rows: Array<{
        seq: string; domain: string; controlPoint: string; requirement: string;
        checkpoints: string[]; interpretation?: string; resultTemplate?: string;
        catalogNo?: string; deviceKey: string; semanticKey: string;
        match: 'auto' | 'fuzzy' | 'unmatched'; matchedItemId?: string; matchedRequirement?: string;
        overwrite?: boolean;
      }>;
      stats: { total: number; auto: number; fuzzy: number; unmatched: number; sheets: number };
    }>>;
    commit: (rows: any[], clearFirst?: boolean) => Promise<IpcResponse<{ inserted: number; updated: number; skipped: number }>>;
    stats: () => Promise<IpcResponse<{ total: number; withDevice: number; unmatched: number }>>;
    list: (keyword?: string) => Promise<IpcResponse<any[]>>;
    update: (input: any) => Promise<IpcResponse<{ ok: boolean; reason?: string; duplicateOf?: string }>>;
    delete: (id: string) => Promise<IpcResponse<{ ok: boolean }>>;
    clear: () => Promise<IpcResponse<{ removed: number }>>;
  };
  ollama: {
    getStatus: (url?: string, engine?: 'ollama' | 'herdsman', force?: boolean) => Promise<IpcResponse<{ state: string; models?: any[]; error?: string }>>;
    listModels: (url?: string, engine?: 'ollama' | 'herdsman') => Promise<IpcResponse<any[]>>;
    pullModel: (modelName: string, url?: string, engine?: 'ollama' | 'herdsman') => Promise<IpcResponse<any>>;
    deleteModel: (modelName: string, url?: string, engine?: 'ollama' | 'herdsman') => Promise<IpcResponse<void>>;
    start: (url?: string, engine?: 'ollama' | 'herdsman') => Promise<IpcResponse<any>>;
    getInstallGuide: (engine?: 'ollama' | 'herdsman') => Promise<IpcResponse<{ windows: string[]; mac: string[]; linux: string[]; downloadUrl: string }>>;
    testConnection: (url?: string, engine?: 'ollama' | 'herdsman') => Promise<IpcResponse<{ success: boolean; message: string }>>;
    getRecommendedModels: (engine?: 'ollama' | 'herdsman') => Promise<IpcResponse<Array<{ name: string; label: string; description: string; size: string; minMemory: number; supportsVision: boolean }>>>;
    onPullProgress: (callback: (data: { modelName: string; status: string; completed?: number; total?: number }) => void) => () => void;
  };
  document: {
    extractText: (params: { filePaths: string[] }) => Promise<IpcResponse<Array<{ name: string; content: string; error?: string }>>>;
  };
  attachment: {
    save: (params: { name: string; base64Data: string }) => Promise<IpcResponse<{ path: string; name: string; size: number; type: 'image' | 'document' }>>;
    /** 删除受管附件（仅允许应用附件目录内的文件） */
    delete: (filePath: string) => Promise<IpcResponse<boolean>>;
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
    readFile: (path: string) => Promise<IpcResponse<string>>;
    readFileBase64: (path: string) => Promise<IpcResponse<string>>;
    writeTextFile: (path: string, data: string) => Promise<IpcResponse<void>>;
  };
  /** 内置 / 自定义外链：统一出口在 externalLink:open，别再用 shell.openExternal 拼新地址 */
  externalLink: {
    list: () => Promise<IpcResponse<ExternalLinkItem[]>>;
    create: (data: ExternalLinkCreateInput) => Promise<IpcResponse<string>>;
    update: (id: string, patch: ExternalLinkPatch) => Promise<IpcResponse<ExternalLinkItem>>;
    delete: (id: string) => Promise<IpcResponse<void>>;
    reorder: (orderedIds: string[]) => Promise<IpcResponse<void>>;
    open: (id: string, context?: LinkOpenContext) => Promise<IpcResponse<{
      url: string;
      missing: string[];
      source: string;
    }>>;
    import: (payload: {
      format: ExternalLinkImportFormat;
      content: string;
      groups?: string[];
    }) => Promise<IpcResponse<ExternalLinkImportResult>>;
    export: () => Promise<IpcResponse<string>>;
  };
  /**
   * 渲染进程发送日志到主进程
   */
  sendLog: (level: string, message: string) => void;
  /**
   * 监听主进程日志，转发到 DevTools Console
   */
  onMainLog: (callback: (data: { level: string; message: string; timestamp: string; context?: any }) => void) => () => void;
  /**
   * 监听 IPC 事件
   */
  on: (channel: string, callback: (...args: any[]) => void) => () => void;
  collection: {
    listProfiles: () => Promise<IpcResponse<ConnectionProfile[]>>;
    saveProfile: (data: ConnectionProfileInput) => Promise<IpcResponse<ConnectionProfile>>;
    deleteProfile: (id: string) => Promise<IpcResponse<void>>;
    batchDeleteProfiles: (ids: string[]) => Promise<IpcResponse<{ deleted: number }>>;
    testConnection: (id: string) => Promise<IpcResponse<{ ok: boolean; message?: string }>>;
    testConnectionWithProfile: (data: ConnectionProfileInput) => Promise<IpcResponse<{ ok: boolean; message?: string }>>;
    listTasks: (params: { projectId: string; assetId?: string }) => Promise<IpcResponse<CollectionTask[]>>;
    getTask: (id: string) => Promise<IpcResponse<CollectionTask | null>>;
    createTask: (data: { projectId: string; assetId: string; connectionId: string; commandIds: string[] }) => Promise<IpcResponse<CollectionTask>>;
    cancelTask: (id: string) => Promise<IpcResponse<void>>;
    deleteTask: (id: string) => Promise<IpcResponse<void>>;
    listResults: (taskId: string) => Promise<IpcResponse<CollectionResult[]>>;
    confirmResult: (data: { resultId: string; projectId: string; itemId: string; assetId: string; result: string; method?: string; evidence?: string }) => Promise<IpcResponse<void>>;
    saveDocument: (data: { taskId: string; dirPath: string }) => Promise<IpcResponse<{ filePath: string; title: string }>>;
    listDocuments: (projectId: string) => Promise<IpcResponse<CollectionDocument[]>>;
    deleteDocument: (id: string) => Promise<IpcResponse<void>>;
    openDocumentDir: (filePath: string) => Promise<IpcResponse<void>>;
    exportLocalScript: (data: { host: string; commandIds: string[] }) => Promise<IpcResponse<{ content: string; commandCount: number }>>;
    importLocalResults: (data: { projectId: string; assetId: string; connectionId: string; jsonContent: string }) => Promise<IpcResponse<{ taskId: string; imported: number }>>;
    onProgress: (callback: (data: CollectionProgress) => void) => () => void;
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
  /** 默认按钮下标（对应 buttons 数组）。缺省时 electron 默认 0 */
  defaultId?: number;
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
  downloadSpeed?: number;
  downloadTransferred?: number;
  downloadTotal?: number;
  error?: string;
}

// ============ 自动采集执行引擎（Phase 1） ============

export type ConnectionType = 'ssh' | 'winrm' | 'mysql' | 'oracle' | 'postgresql' | 'sqlserver' | 'redis' | 'http';

export interface ConnectionProfile {
  id: string;
  name: string;
  connType: ConnectionType;
  host: string;
  port: number | null;
  username: string | null;
  authMethod: 'password' | 'privateKey' | 'integrated';
  passwordEncrypted: string | null;
  privateKeyPath: string | null;
  timeoutMs: number;
  extraConfig: string | null;
  assetId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ConnectionProfileInput {
  id?: string;
  name: string;
  connType: ConnectionType;
  host: string;
  port?: number | null;
  username?: string | null;
  authMethod?: 'password' | 'privateKey' | 'integrated';
  password?: string;
  privateKeyPath?: string | null;
  timeoutMs?: number;
  extraConfig?: string | null;
  assetId?: string | null;
}

export interface CollectionTask {
  id: string;
  projectId: string;
  assetId: string;
  connectionId: string;
  status: 'pending' | 'running' | 'success' | 'partial' | 'failed' | 'canceled';
  totalCommands: number;
  completedCommands: number;
  progress: number;
  startedAt: string | null;
  finishedAt: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CollectionResult {
  id: string;
  taskId: string;
  commandId: string | null;
  command: string;
  status: 'success' | 'failed' | 'timeout' | 'error';
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  parsedData: string | null;
  createdAt: string;
}

export interface CollectionCommandState {
  commandId: string;
  command: string;
  status: 'pending' | 'running' | 'success' | 'failed' | 'timeout' | 'error';
  durationMs?: number;
}

export interface CollectionProgress {
  taskId: string;
  status: string;
  stage: string;
  message: string;
  percent: number;
  completedCommands: number;
  totalCommands: number;
  commandStates?: CollectionCommandState[];
}

export interface CollectionDocument {
  id: string;
  taskId: string;
  projectId: string;
  assetId: string | null;
  assetName: string;
  host: string;
  filePath: string;
  title: string;
  createdAt: string;
}
