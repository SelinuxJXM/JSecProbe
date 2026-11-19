import { sqliteTable, text, integer, real, index, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

/**
 * 外键策略说明（审查项 P1-14）
 *
 * 本 schema **故意不使用** `.references()`，尽管运行时开了 `PRAGMA foreign_keys = ON`。
 * 原因：SQLite 无法给已存在的表追加 FOREIGN KEY 约束（只能重建表），
 * 存量库不会获得这些约束 —— 若在 schema.ts 声明，会造成「新库有约束、老库没有」的行为分裂，
 * 比统一不设约束更危险（开发以为有保护，生产实际裸奔）。
 *
 * 因此改用两条等价手段保证引用完整性：
 * 1. **删除时显式级联**：`project:remove`（`ipc/project.ipc.ts`）与资产删除（`ipc/asset.ipc.ts`）
 *    在事务内按子→父顺序手工清理，并对 `asset_id` 为空的 connection_profiles 做孤儿凭据清理。
 * 2. **启动时检测**：`detectSchemaDrift()` / `detectOrphanData()`（`db/index.ts`）比对结构并报告孤儿行。
 *
 * 后续若确实需要外键，应在正式迁移里重建表（建新表→搬数据→改名），而不是只改本文件。
 */

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  username: text('username').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  realName: text('real_name').notNull(),
  email: text('email'),
  phone: text('phone'),
  role: text('role').notNull().default('assessor'),
  isActive: integer('is_active').notNull().default(1),
  mustChangePassword: integer('must_change_password').notNull().default(1),
  lastLoginAt: text('last_login_at'),
  createdAt: text('created_at').notNull().default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`),
  updatedAt: text('updated_at').notNull(),
});

/**
 * 项目分组（委托 / 合同批次）。
 *
 * 业务背景：一个项目常包含多个被测系统，每个系统都要独立完成系统构成调研、
 * 现场测评、问题分析与整改建议。但历史上 `projects` 表的一行在业务语义上
 * **本来就是「一个系统的完整测评」**——报告服务按 projectId 取资产/记录/问题，
 * 模板里的"系统名称"即 `projects.system_name`。因此这里不把系统插到项目下面，
 * 而是反过来：在现有系统记录之上加一层轻量的项目分组，由 `projects.group_id` 关联。
 *
 * 这样做的直接收益：assets / assessment_records / issues / 报告 / 归档 / 统计 / AI
 * 全部维持原有的 project_id 归属，一行都不用改；每个系统天然数据隔离。
 */
export const projectGroups = sqliteTable('project_groups', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  projectNo: text('project_no'),
  assessedUnit: text('assessed_unit'),
  customerName: text('customer_name'),
  assessor: text('assessor'),
  startDate: text('start_date'),
  endDate: text('end_date'),
  description: text('description'),
  status: text('status').notNull().default('draft'),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => ({
  statusIdx: index('project_group_status_idx').on(table.status),
}));

export const projects = sqliteTable('projects', {
  id: text('id').primaryKey(),
  /** 所属项目分组；NULL 表示历史遗留的「未分组单系统项目」，由启动兜底自动回填 */
  groupId: text('group_id'),
  name: text('name').notNull(),
  projectNo: text('project_no'),
  systemName: text('system_name').notNull(),
  assessedUnit: text('assessed_unit'),
  standardSystem: text('standard_system'),
  levelCombo: text('level_combo'),
  extensionType: text('extension_type'),
  level: integer('level').notNull(),
  standardId: text('standard_id').notNull(),
  status: text('status').notNull().default('draft'),
  customerName: text('customer_name'),
  assessor: text('assessor'),
  startDate: text('start_date'),
  endDate: text('end_date'),
  description: text('description'),
  assetCount: integer('asset_count').notNull().default(0),
  complianceRate: real('compliance_rate'),
  progress: integer('progress').notNull().default(0),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => ({
  groupIdIdx: index('project_group_ref_idx').on(table.groupId),
}));

export const projectMembers = sqliteTable('project_members', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull(),
  userId: text('user_id').notNull(),
  role: text('role').notNull().default('assessor'),
  assignedDomains: text('assigned_domains'),
  createdAt: text('created_at').notNull(),
}, (table) => ({
  projectUserIdIdx: uniqueIndex('project_user_idx').on(table.projectId, table.userId),
}));

export const assets = sqliteTable('assets', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull(),
  category: text('category').notNull(),
  name: text('name').notNull(),
  os: text('os'),
  version: text('version'),
  deviceUsage: text('device_usage'),
  description: text('description'),
  quantity: integer('quantity').notNull().default(1),
  ip: text('ip'),
  importance: text('importance').notNull().default('medium'),
  isVirtual: integer('is_virtual').notNull().default(0),
  dbSystem: text('db_system'),
  middleware: text('middleware'),
  isAssessmentTarget: integer('is_assessment_target').notNull().default(1),
  position: text('position'),
  responsiblePerson: text('responsible_person'),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => ({
  projectCategoryIdx: index('asset_project_category_idx').on(table.projectId, table.category),
  projectIdIdx: index('asset_project_idx').on(table.projectId),
}));

export const standards = sqliteTable('standards', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  code: text('code').notNull().unique(),
  version: text('version').notNull(),
  description: text('description'),
  grade: integer('grade').notNull().default(3),
  domainCount: integer('domain_count').notNull().default(0),
  itemCount: integer('item_count').notNull().default(0),
  isDefault: integer('is_default').notNull().default(0),
  // 行标支持扩展字段
  standardType: text('standard_type').notNull().default('national'), // national(国标) | industry(行标) | local | enterprise
  industry: text('industry').default(''), // 电力/金融/医疗/电信/政务（行标时填）
  source: text('source').notNull().default('builtin'), // builtin(内置) | imported(导入) | custom(手动)
  presetTemplate: text('preset_template').default(''), // 配套预置模板相对路径
  domainsMeta: text('domains_meta'), // 标准域元信息 JSON（[{id,name,icon,domainType,sheetName,columnMap}]），行标导入时填充
  presetMethod: text('preset_method').default('check'), // 预置导入默认 method（interview/check/test），缺省 'check'
  columnMap: text('column_map'), // 预置导入列映射 JSON（{"序号":0,"控制点":1,"要求":2,"记录":3,"合规":4}），缺省沿用 A/B/C/D/E
  levelCombo: text('level_combo').default(''), // 适用等级组合，如 S2A2G2 / S2A3G3 等（G=max(S,A)）；grade 为最终保护等级用于标准匹配
  createdAt: text('created_at').notNull().default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`),
});

export const assessmentItems = sqliteTable('assessment_items', {
  id: text('id').primaryKey(),
  standardId: text('standard_id').notNull(),
  domain: text('domain').notNull(),
  controlPoint: text('control_point').notNull(),
  controlName: text('control_name').notNull(),
  requirement: text('requirement').notNull(),
  minLevel: integer('min_level').notNull().default(2), // 最低适用等级（2=二级起适用，3=仅三级适用）
  maxLevel: integer('max_level').notNull().default(4), // 最高适用等级
  extensionType: text('extension_type').notNull().default('general'), // general/cloud/mobile/iot/industrial/bigdata
  isHighRisk: integer('is_high_risk').notNull().default(0),
  sortOrder: integer('sort_order').notNull().default(0),
  parentId: text('parent_id'),
  // 预置记录（合并自原 S3A3G3.xlsx 模板）：导入标准时随测评项一起入库，
  // 创建资产时直接从表中读取写入 assessment_records，不再依赖外部 Excel 模板
  presetResult: text('preset_result'),   // 预置符合情况：符合/不符合/部分符合/不适用/未测评
  presetRecord: text('preset_record'),   // 预置结果记录/证据文本
  presetByType: text('preset_by_type'),  // 安全计算环境按资产类型区分的预置，JSON: { [categoryKey]: { result, record } }
}, (table) => ({
  standardDomainIdx: index('item_standard_domain_idx').on(table.standardId, table.domain),
  standardIdIdx: index('item_standard_idx').on(table.standardId),
}));

export const assessmentRecords = sqliteTable('assessment_records', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull(),
  itemId: text('item_id').notNull(),
  assetId: text('asset_id'),
  result: text('result').notNull().default('untested'),
  method: text('method').notNull().default('check'),
  commandOutput: text('command_output'),
  evidence: text('evidence'),
  findings: text('findings'),
  assessor: text('assessor'),
  assessmentDate: text('assessment_date'),
  screenshotPaths: text('screenshot_paths'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => ({
  projectItemIdx: index('record_project_item_idx').on(table.projectId, table.itemId),
  projectAssetIdx: index('record_project_asset_idx').on(table.projectId, table.assetId),
  projectIdIdx: index('record_project_idx').on(table.projectId),
}));

export const issues = sqliteTable('issues', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull(),
  assetId: text('asset_id'),
  itemId: text('item_id'),
  securityDomain: text('security_domain').notNull(),
  controlPoint: text('control_point').notNull(),
  controlName: text('control_name').notNull(),
  issueTitle: text('issue_title').notNull(),
  issueDescription: text('issue_description').notNull(),
  riskLevel: text('risk_level').notNull().default('medium'),
  status: text('status').notNull().default('pending'),
  rectificationSuggestion: text('rectification_suggestion'),
  rectificationDeadline: text('rectification_deadline'),
  responsiblePerson: text('responsible_person'),
  fixedDescription: text('fixed_description'),
  fixedDate: text('fixed_date'),
  assessor: text('assessor'),
  evidenceFiles: text('evidence_files'),
  // 风险分析（一条问题对应一份分析结论，全部可选；未分析时保持 NULL）
  riskLikelihood: text('risk_likelihood'),
  riskImpact: text('risk_impact'),
  riskScore: integer('risk_score'),
  riskEvaluatedLevel: text('risk_evaluated_level'),
  riskThreat: text('risk_threat'),
  riskConsequence: text('risk_consequence'),
  riskStrategy: text('risk_strategy'),
  riskCountermeasure: text('risk_countermeasure'),
  riskResidual: text('risk_residual'),
  riskAnalyst: text('risk_analyst'),
  riskAnalyzedAt: text('risk_analyzed_at'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => ({
  projectStatusIdx: index('issue_project_status_idx').on(table.projectId, table.status),
  projectRiskIdx: index('issue_project_risk_idx').on(table.projectId, table.riskLevel),
  projectIdIdx: index('issue_project_idx').on(table.projectId),
}));

export const knowledgeCategories = sqliteTable('knowledge_categories', {
  id: text('id').primaryKey(),
  parentId: text('parent_id'),
  name: text('name').notNull(),
  icon: text('icon'),
  color: text('icon_color'),
  sortOrder: integer('sort_order').notNull().default(0),
  documentCount: integer('document_count').notNull().default(0),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const knowledgeDocuments = sqliteTable('knowledge_documents', {
  id: text('id').primaryKey(),
  categoryId: text('category_id').notNull(),
  title: text('title').notNull(),
  type: text('type').notNull(),
  filePath: text('file_path'),
  content: text('content'),
  description: text('description'),
  version: text('version').default('1.0'),
  tags: text('tags'),
  referenceCount: integer('reference_count').notNull().default(0),
  uploadDate: text('upload_date').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const aiConfigs = sqliteTable('ai_configs', {
  id: text('id').primaryKey().default('default'),
  provider: text('provider').default('openai'),
  apiKey: text('api_key'),
  apiBase: text('api_base'),
  model: text('model').default('gpt-4o-mini'),
  // 与迁移 0000_init.sql 及 initDefaultData() 的实际值保持一致（此前此处写 0.3，
  // 而真实建表与初始化均为 0.7 —— 声明与实际漂移会让新库与老库行为不一致）
  temperature: real('temperature').notNull().default(0.7),
  ocrProvider: text('ocr_provider').default('tesseract'),
  ocrApiKey: text('ocr_api_key'),
  enableAi: integer('enable_ai').notNull().default(0),
  privacyMode: integer('privacy_mode').notNull().default(0),
  sensitiveWords: text('sensitive_words'),
  mode: text('mode').default('cloud'),
  ollamaModel: text('ollama_model'),
  ollamaUrl: text('ollama_url').default('http://localhost:11434'),
  // 本地引擎：ollama=Ollama / herdsman=Herdsman(牧马人)，两者可共存切换
  localEngine: text('local_engine').default('ollama'),
  herdsmanUrl: text('herdsman_url').default('http://localhost:8080'),
  herdsmanModel: text('herdsman_model'),
  // OCR预处理：云端模式默认关闭(0)，本地模式默认开启(1)
  ocrPreprocess: integer('ocr_preprocess').notNull().default(0),
  // 当前聊天使用的云端模型 ID（null 时 fallback 到 priority=1 的启用模型）
  activeModelId: text('active_model_id'),
  // AI 请求代理：system=跟随系统代理(Clash 等) / manual=手动代理 / none=直连
  proxyMode: text('proxy_mode').default('system'),
  // 手动代理地址，如 127.0.0.1:7890 或 socks5://127.0.0.1:7890
  proxyUrl: text('proxy_url'),
  updatedAt: text('updated_at').notNull(),
  createdAt: text('created_at').notNull(),
});

export const aiCloudModels = sqliteTable('ai_cloud_models', {
  id: text('id').primaryKey(),
  configId: text('config_id').notNull().default('default'),
  name: text('name').notNull(),
  apiBase: text('api_base').notNull(),
  apiKey: text('api_key'),
  model: text('model').notNull(),
  apiFormat: text('api_format').notNull().default('openai'),
  enabled: integer('enabled').notNull().default(1),
  priority: integer('priority').notNull().default(99),
  updatedAt: text('updated_at').notNull(),
  createdAt: text('created_at').notNull(),
});

// 用户自定义 AI 提示词：有记录=已自定义，无记录=使用内置默认模板
export const aiPrompts = sqliteTable('ai_prompts', {
  // 功能键：analyze_record / batch_match / rectify_suggestion / issue_desc
  promptKey: text('prompt_key').primaryKey(),
  // 完整模板，使用 {{变量名}} 占位符
  template: text('template').notNull(),
  updatedAt: text('updated_at'),
});

/**
 * 测评点知识库：从等保测评作业指导书（赛飞 V2.0）导入的「测评项 → 测评点」结构化数据。
 *
 * 语义键（semanticKey）而不是 itemId 关联：itemId 是内容 hash，换标准/重导入就变；
 * 语义键 = 安全域 + 控制点 + 要求文本归一化（标准无关），跨二/三级、换标准都能复用。
 * deviceKey 区分同一条款在不同设备上的不同核查方法（Linux 查 /etc/login.defs，网络设备查设备配置）。
 *
 * checkpoints 为 JSON 数组：['1) 应核查...', '2) 应核查...']，由指导书「测评方法/测评要求」列按编号拆分。
 * interpretation 为「要求解读」列（扩展要求表），是条款含义解释，对 AI 理解极有价值。
 * resultTemplate 为「预期结果/结果记录/现场记录」列，是逐点填空模板。
 */
export const assessmentCheckpoints = sqliteTable('assessment_checkpoints', {
  id: text('id').primaryKey(),
  semanticKey: text('semantic_key').notNull(),
  deviceKey: text('device_key').notNull().default(''),
  domain: text('domain'),
  controlPoint: text('control_point'),
  requirement: text('requirement').notNull(),
  /** JSON: string[] 逐条测评点 */
  checkpoints: text('checkpoints').notNull().default('[]'),
  /** 要求解读（扩展要求表） */
  interpretation: text('interpretation'),
  /** 预期结果/结果记录模板 */
  resultTemplate: text('result_template'),
  /** 标准条款号（14列模板的 TestItemNumber） */
  catalogNo: text('catalog_no'),
  /** 来源文件/sheet */
  source: text('source'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => ({
  semanticDeviceUnique: uniqueIndex('assessment_checkpoints_semantic_device_unique').on(table.semanticKey, table.deviceKey),
  semanticIdx: index('assessment_checkpoints_semantic_idx').on(table.semanticKey),
  controlPointIdx: index('assessment_checkpoints_control_point_idx').on(table.controlPoint),
}));

export const systemSettings = sqliteTable('system_settings', {
  id: text('id').primaryKey().default('default'),
  dbVersion: integer('db_version').notNull().default(1),
  theme: text('theme').default('light'),
  language: text('language').default('zh-CN'),
  autoBackupEnabled: integer('auto_backup_enabled').notNull().default(1),
  autoBackupDays: integer('auto_backup_days').notNull().default(7),
  dataPath: text('data_path'),
  // 原默认 'gb-t-22239-2019-l3' 在种子标准库中并不存在，会造成"默认标准指向空标准"。
  // 与 initDefaultData() 的实际写入保持一致：默认留空，由前端按"无标准"安全降级。
  defaultStandard: text('default_standard').default(''),
  standardDataVersion: integer('standard_data_version').notNull().default(1),
  /** 重大风险隐患清单内置种子版本：0=未入驻，>0=已入驻对应版本；用户导入后不回滚 */
  majorRiskSeedVersion: integer('major_risk_seed_version').notNull().default(0),
  updatedAt: text('updated_at').notNull(),
});

export const knowledgeCommands = sqliteTable('knowledge_commands', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  target: text('target').notNull(),
  command: text('command').notNull(),
  description: text('description').notNull(),
  os: text('os').notNull(),
  brand: text('brand').notNull().default(''),
  deviceType: text('device_type').notNull().default(''),
  category: text('category').notNull().default(''),
  subCategory: text('sub_category').notNull().default(''),
  // Phase 4 · 任务 30：命令库行业维度（通用=空；电力/金融/医疗/电信/政务…）
  industry: text('industry').notNull().default(''),
  isFavorite: integer('is_favorite').notNull().default(0),
  referenceCount: integer('reference_count').notNull().default(0),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const operationLogs = sqliteTable('operation_logs', {
  id: text('id').primaryKey(),
  userId: text('user_id'),
  username: text('username'),
  action: text('action').notNull(),
  module: text('module').notNull(),
  targetId: text('target_id'),
  targetName: text('target_name'),
  description: text('description'),
  ipAddress: text('ip_address'),
  detailJson: text('detail_json'), // 详细 JSON 审计信息（标准导入/导出等）
  createdAt: text('created_at').notNull(),
});

// ============ 自动采集执行引擎（Phase 1） ============

// 连接配置：SSH / 数据库 / 中间件等（Phase 1 仅使用 ssh 类型，表结构为后续阶段预留）
export const connectionProfiles = sqliteTable('connection_profiles', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  connType: text('conn_type').notNull(),
  host: text('host').notNull(),
  port: integer('port'),
  username: text('username'),
  authMethod: text('auth_method').notNull().default('password'),
  passwordEncrypted: text('password_encrypted'),
  privateKeyPath: text('private_key_path'),
  timeoutMs: integer('timeout_ms').notNull().default(10000),
  extraConfig: text('extra_config'),
  assetId: text('asset_id'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

// 资产-连接配置关联（Phase 1 暂不写入，预留）
export const assetConnections = sqliteTable('asset_connections', {
  id: text('id').primaryKey(),
  assetId: text('asset_id').notNull(),
  connectionId: text('connection_id').notNull(),
  commandScope: text('command_scope'),
  createdAt: text('created_at').notNull(),
});

// 采集任务
export const collectionTasks = sqliteTable('collection_tasks', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull(),
  assetId: text('asset_id').notNull(),
  connectionId: text('connection_id').notNull(),
  status: text('status').notNull().default('pending'),
  totalCommands: integer('total_commands').notNull().default(0),
  completedCommands: integer('completed_commands').notNull().default(0),
  progress: integer('progress').notNull().default(0),
  startedAt: text('started_at'),
  finishedAt: text('finished_at'),
  createdBy: text('created_by'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

// 采集结果
export const collectionResults = sqliteTable('collection_results', {
  id: text('id').primaryKey(),
  taskId: text('task_id').notNull(),
  commandId: text('command_id'),
  command: text('command').notNull(),
  status: text('status').notNull(),
  exitCode: integer('exit_code'),
  stdout: text('stdout'),
  stderr: text('stderr'),
  durationMs: integer('duration_ms').notNull().default(0),
  parsedData: text('parsed_data'),
  createdAt: text('created_at').notNull(),
});

// 采集文档（Markdown 元数据）
export const collectionDocuments = sqliteTable('collection_documents', {
  id: text('id').primaryKey(),
  taskId: text('task_id').notNull(),
  projectId: text('project_id').notNull(),
  assetId: text('asset_id'),
  assetName: text('asset_name').notNull(),
  host: text('host').notNull(),
  filePath: text('file_path').notNull(),
  title: text('title').notNull(),
  createdAt: text('created_at').notNull(),
});

// ============ 内置 / 自定义外链 ============
//
// 设计要点：内置链接**不写入本表**，而是以只读 seed（external-link.seed.ts）形式随版本打包。
// 本表只存两类数据：
//   1. is_builtin = 0：用户自己新增的链接；
//   2. is_builtin = 1 + link_key：用户对某条内置/远程链接的「覆盖层」（改名、换 URL、
//      隐藏、排序、收藏、失效标记、最近打开时间）。
// 升级内置清单时只需替换 seed，用户的排序与改动不会冲突。导航站本身是 seed 里的一条
// 外链；若要把站内链接搬进应用，用「导入 sites.txt」手动完成，不做任何远程同步或缓存。
// link_key 允许多个覆盖行共存于不同 scope，故不设 UNIQUE；由服务层按 (link_key, scope, owner_id)
// 定位，定位不到时才插入。
export const externalLinks = sqliteTable('external_links', {
  id: text('id').primaryKey(),
  linkKey: text('link_key'),
  title: text('title').notNull(),
  url: text('url').notNull(),
  groupName: text('group_name').notNull().default('自定义'),
  description: text('description').notNull().default(''),
  iconText: text('icon_text'),
  networkZone: text('network_zone').notNull().default('internet'),
  isBuiltin: integer('is_builtin').notNull().default(0),
  isHidden: integer('is_hidden').notNull().default(0),
  isFavorite: integer('is_favorite').notNull().default(0),
  isStale: integer('is_stale').notNull().default(0),
  sortOrder: integer('sort_order').notNull().default(0),
  scope: text('scope').notNull().default('global'),
  ownerId: text('owner_id'),
  lastOpenedAt: text('last_opened_at'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

/**
 * 重大风险隐患清单（全局参考清单，用户提供内容后导入/编辑）。
 *
 * 与 high-risk-guideline.json（只读快照）不同，这张表是用户维护的：
 * 「我提供的重大风险隐患清单」由用户在页面上导入或逐条编辑，跨项目共用，
 * 属于全局参考数据（同标准库），不随单个项目归档带走。
 * 每条的 keywords 用逗号/换行分隔，供与问题「问题描述」做文本召回；
 * title / criteria 同时进 AI 提示词作为判定依据。
 */
export const majorRiskCatalog = sqliteTable('major_risk_catalog', {
  id: text('id').primaryKey(),
  code: text('code'),                       // 清单编号（可选）
  title: text('title').notNull(),           // 隐患名称/简述
  category: text('category'),               // 分类/安全域
  criteria: text('criteria'),               // 判定标准/识别要点
  keywords: text('keywords'),               // 匹配关键词（逗号或换行分隔）
  source: text('source'),                   // 来源出处
  sortOrder: integer('sort_order').notNull().default(0),
  enabled: integer('enabled').notNull().default(1),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => ({
  enabledIdx: index('major_risk_catalog_enabled_idx').on(table.enabled),
}));

/**
 * 重大风险隐患识别与分析结论：一条问题（issues 行）对应一份分析。
 *
 * 字段含义：
 * - catalogId/catalogTitle：命中的清单条目（含快照名，清单改动也不丢判定依据）
 * - relevance/severity/frequency：相关性、严重性、高发性三要素各一段话
 * - verdict：最终判定 major（属于）/ non_major（不属于）/ pending（待判定）
 * - conclusion：综合判定说明；analyst/reviewedAt 记录人工复核；source 区分 AI 与人工
 * 独立成表：分析字段较多，且清单命中是过程数据，不塞进 issues 行。
 */
export const majorRiskAnalysis = sqliteTable('major_risk_analysis', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull(),
  issueId: text('issue_id').notNull(),
  catalogId: text('catalog_id'),
  catalogTitle: text('catalog_title'),
  relevance: text('relevance'),
  severity: text('severity'),
  frequency: text('frequency'),
  verdict: text('verdict').notNull().default('pending'),
  conclusion: text('conclusion'),
  analyst: text('analyst'),
  analyzedAt: text('analyzed_at'),
  reviewedAt: text('reviewed_at'),
  source: text('source').notNull().default('manual'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => ({
  projectIdx: index('major_risk_analysis_project_idx').on(table.projectId),
  issueUnique: uniqueIndex('major_risk_analysis_issue_unique').on(table.issueId),
}));

/**
 * AI 智能助手会话与消息持久化。
 *
 * 会话按项目可选关联（project_id 为 null 表示通用会话），标题可自动生成/手工重命名。
 * 消息正文原文落库：用户已确认「隐私模式开启时仍保存对话正文」，与脱敏发送是两件事——
 * 发送可对模型脱敏，本地存储保留完整上下文，否则历史对话无法继续追问。
 * 附件以 {name, path, type, size} JSON 存相对路径（由 attachment:save 落到受管目录），不存 base64。
 */
export const aiConversations = sqliteTable('ai_conversations', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  projectId: text('project_id'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => ({
  updatedIdx: index('ai_conversations_updated_idx').on(table.updatedAt),
  projectIdx: index('ai_conversations_project_idx').on(table.projectId),
}));

export const aiMessages = sqliteTable('ai_messages', {
  id: text('id').primaryKey(),
  conversationId: text('conversation_id').notNull(),
  role: text('role').notNull(),
  content: text('content').notNull(),
  /** JSON: string[]，AI 的建议追问气泡 */
  suggestions: text('suggestions'),
  /** JSON: Array<{name,path,type,size}>，附件相对路径 */
  attachments: text('attachments'),
  createdAt: text('created_at').notNull(),
}, (table) => ({
  conversationIdx: index('ai_messages_conversation_idx').on(table.conversationId, table.createdAt),
}));

