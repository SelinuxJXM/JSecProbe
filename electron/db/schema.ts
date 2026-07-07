import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core';

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
  createdAt: text('created_at').notNull(),
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
});

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
});

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
  createdAt: text('created_at').notNull(),
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
});

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
});

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
});

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
  temperature: real('temperature').notNull().default(0.7),
  ocrProvider: text('ocr_provider').default('tesseract'),
  ocrApiKey: text('ocr_api_key'),
  enableAi: integer('enable_ai').notNull().default(0),
  updatedAt: text('updated_at').notNull(),
});

export const systemSettings = sqliteTable('system_settings', {
  id: text('id').primaryKey().default('default'),
  dbVersion: integer('db_version').notNull().default(1),
  theme: text('theme').default('light'),
  language: text('language').default('zh-CN'),
  autoBackupEnabled: integer('auto_backup_enabled').notNull().default(1),
  autoBackupDays: integer('auto_backup_days').notNull().default(7),
  dataPath: text('data_path'),
  defaultStandard: text('default_standard').default('gb-t-22239-2019'),
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
  createdAt: text('created_at').notNull(),
});
