import { sqliteTable, text, integer, real, index, uniqueIndex } from 'drizzle-orm/sqlite-core';

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
  createdAt: text('created_at').notNull().default(new Date().toISOString()),
  updatedAt: text('updated_at').notNull(),
});

export const projects = sqliteTable('projects', {
  id: text('id').primaryKey(),
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
});

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
  createdAt: text('created_at').notNull().default(new Date().toISOString()),
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

export const reportTemplates = sqliteTable('report_templates', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  category: text('category'),
  description: text('description'),
  content: text('content').notNull(),
  variables: text('variables'),
  isDefault: integer('is_default').notNull().default(0),
  createdBy: text('created_by'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const aiConfigs = sqliteTable('ai_configs', {
  id: text('id').primaryKey().default('default'),
  provider: text('provider').default('openai'),
  apiKey: text('api_key'),
  apiBase: text('api_base'),
  model: text('model').default('gpt-4o-mini'),
  temperature: real('temperature').notNull().default(0.3),
  ocrProvider: text('ocr_provider').default('tesseract'),
  ocrApiKey: text('ocr_api_key'),
  enableAi: integer('enable_ai').notNull().default(0),
  privacyMode: integer('privacy_mode').notNull().default(0),
  sensitiveWords: text('sensitive_words'),
  mode: text('mode').default('cloud'),
  ollamaModel: text('ollama_model'),
  ollamaUrl: text('ollama_url').default('http://localhost:11434'),
  // OCR预处理：云端模式默认关闭(0)，本地模式默认开启(1)
  ocrPreprocess: integer('ocr_preprocess').notNull().default(0),
  // 当前聊天使用的云端模型 ID（null 时 fallback 到 priority=1 的启用模型）
  activeModelId: text('active_model_id'),
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

export const systemSettings = sqliteTable('system_settings', {
  id: text('id').primaryKey().default('default'),
  dbVersion: integer('db_version').notNull().default(1),
  theme: text('theme').default('light'),
  language: text('language').default('zh-CN'),
  autoBackupEnabled: integer('auto_backup_enabled').notNull().default(1),
  autoBackupDays: integer('auto_backup_days').notNull().default(7),
  dataPath: text('data_path'),
  defaultStandard: text('default_standard').default('gb-t-22239-2019-l3'),
  standardDataVersion: integer('standard_data_version').notNull().default(1),
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
