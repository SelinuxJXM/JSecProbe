CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  real_name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  role TEXT NOT NULL DEFAULT 'assessor',
  is_active INTEGER NOT NULL DEFAULT 1,
  last_login_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  project_no TEXT,
  system_name TEXT NOT NULL,
  assessed_unit TEXT,
  standard_system TEXT,
  level_combo TEXT,
  extension_type TEXT,
  level INTEGER NOT NULL,
  standard_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  customer_name TEXT,
  assessor TEXT,
  start_date TEXT,
  end_date TEXT,
  description TEXT,
  asset_count INTEGER NOT NULL DEFAULT 0,
  compliance_rate REAL,
  progress INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status);
CREATE INDEX IF NOT EXISTS idx_projects_level ON projects(level);

CREATE TABLE IF NOT EXISTS project_members (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'assessor',
  assigned_domains TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(project_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_project_members_project_id ON project_members(project_id);
CREATE INDEX IF NOT EXISTS idx_project_members_user_id ON project_members(user_id);

CREATE TABLE IF NOT EXISTS assets (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  category TEXT NOT NULL,
  name TEXT NOT NULL,
  os TEXT,
  version TEXT,
  device_usage TEXT,
  description TEXT,
  quantity INTEGER NOT NULL DEFAULT 1,
  ip TEXT,
  importance TEXT NOT NULL DEFAULT 'medium',
  is_virtual INTEGER NOT NULL DEFAULT 0,
  has_guide INTEGER NOT NULL DEFAULT 0,
  is_assessment_target INTEGER NOT NULL DEFAULT 1,
  responsible_person TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_assets_project_id ON assets(project_id);
CREATE INDEX IF NOT EXISTS idx_assets_category ON assets(category);

CREATE TABLE IF NOT EXISTS standards (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  code TEXT NOT NULL UNIQUE,
  version TEXT NOT NULL,
  description TEXT,
  grade INTEGER NOT NULL DEFAULT 3,
  domain_count INTEGER NOT NULL DEFAULT 0,
  item_count INTEGER NOT NULL DEFAULT 0,
  is_default INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS assessment_items (
  id TEXT PRIMARY KEY,
  standard_id TEXT NOT NULL,
  domain TEXT NOT NULL,
  control_point TEXT NOT NULL,
  control_name TEXT NOT NULL,
  requirement TEXT NOT NULL,
  level INTEGER NOT NULL,
  is_high_risk INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  parent_id TEXT
);

CREATE INDEX IF NOT EXISTS idx_items_standard_domain ON assessment_items(standard_id, domain);

CREATE TABLE IF NOT EXISTS assessment_records (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  asset_id TEXT,
  result TEXT NOT NULL DEFAULT 'untested',
  evidence TEXT,
  findings TEXT,
  assessor TEXT,
  assessment_date TEXT,
  screenshot_paths TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_records_project_id ON assessment_records(project_id);
CREATE INDEX IF NOT EXISTS idx_records_asset_id ON assessment_records(asset_id);
CREATE INDEX IF NOT EXISTS idx_records_item_id ON assessment_records(item_id);

CREATE TABLE IF NOT EXISTS issues (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  asset_id TEXT,
  item_id TEXT,
  security_domain TEXT NOT NULL,
  control_point TEXT NOT NULL,
  control_name TEXT NOT NULL,
  issue_title TEXT NOT NULL,
  issue_description TEXT NOT NULL,
  risk_level TEXT NOT NULL DEFAULT 'medium',
  status TEXT NOT NULL DEFAULT 'pending',
  rectification_suggestion TEXT,
  rectification_deadline TEXT,
  responsible_person TEXT,
  fixed_description TEXT,
  fixed_date TEXT,
  assessor TEXT,
  evidence_files TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_issues_project_id ON issues(project_id);
CREATE INDEX IF NOT EXISTS idx_issues_project_risk ON issues(project_id, risk_level);
CREATE INDEX IF NOT EXISTS idx_issues_project_status ON issues(project_id, status);
CREATE INDEX IF NOT EXISTS idx_issues_project_domain ON issues(project_id, security_domain);

CREATE TABLE IF NOT EXISTS knowledge_categories (
  id TEXT PRIMARY KEY,
  parent_id TEXT,
  name TEXT NOT NULL,
  icon TEXT,
  icon_color TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  document_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_knowledge_categories_parent ON knowledge_categories(parent_id);

CREATE TABLE IF NOT EXISTS knowledge_documents (
  id TEXT PRIMARY KEY,
  category_id TEXT NOT NULL,
  title TEXT NOT NULL,
  type TEXT NOT NULL,
  file_path TEXT,
  content TEXT,
  description TEXT,
  version TEXT DEFAULT '1.0',
  tags TEXT,
  reference_count INTEGER NOT NULL DEFAULT 0,
  upload_date TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_knowledge_docs_category ON knowledge_documents(category_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_docs_type ON knowledge_documents(type);

CREATE TABLE IF NOT EXISTS report_templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT,
  description TEXT,
  content TEXT NOT NULL,
  variables TEXT,
  is_default INTEGER NOT NULL DEFAULT 0,
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ai_configs (
  id TEXT PRIMARY KEY DEFAULT 'default',
  provider TEXT DEFAULT 'openai',
  api_key TEXT,
  api_base TEXT,
  model TEXT DEFAULT 'gpt-4o-mini',
  temperature REAL NOT NULL DEFAULT 0.7,
  ocr_provider TEXT DEFAULT 'tesseract',
  ocr_api_key TEXT,
  enable_ai INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS system_settings (
  id TEXT PRIMARY KEY DEFAULT 'default',
  db_version INTEGER NOT NULL DEFAULT 1,
  theme TEXT DEFAULT 'light',
  language TEXT DEFAULT 'zh-CN',
  auto_backup_enabled INTEGER NOT NULL DEFAULT 1,
  auto_backup_days INTEGER NOT NULL DEFAULT 7,
  data_path TEXT,
  default_standard TEXT DEFAULT 'gb-t-22239-2019',
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS operation_logs (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  username TEXT,
  action TEXT NOT NULL,
  module TEXT NOT NULL,
  target_id TEXT,
  target_name TEXT,
  description TEXT,
  ip_address TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_op_logs_user ON operation_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_op_logs_action ON operation_logs(action);
CREATE INDEX IF NOT EXISTS idx_op_logs_created ON operation_logs(created_at);
