-- 0002_align_schema
--
-- 背景：drizzle 正式迁移长期停在 0001，其后新增的表与列全部靠 electron/db/index.ts 里的
-- JS 兜底（ensureCompatColumns / migrateAiConfigsTable / ensureCollectionTables）在运行时补建。
-- 这带来两个问题：
--   1. 迁移 SQL 不再是结构的唯一真相，schema.ts 与 migrations 目录持续漂移；
--   2. 全新库完全依赖 JS 兜底路径，任何兜底逻辑改动都会改变全新库的结构。
--
-- 本迁移把 JS 兜底覆盖的全部结构补齐到正式迁移中，使「0000 + 0001 + 0002」即可还原
-- schema.ts 声明的完整结构。
--
-- 幂等性说明：存量库上这些列/表已经由 JS 兜底创建过，直接执行会抛 "duplicate column name"。
-- 因此本文件由 electron/db/migrator.ts 的自定义迁移器执行：
--   - ALTER TABLE ... ADD COLUMN 前先 PRAGMA table_info 判存，已存在则跳过；
--   - CREATE TABLE 自动改写为 CREATE TABLE IF NOT EXISTS。
-- 请勿改用 drizzle 原生 migrate() 执行本文件。

-- ===== 采集引擎相关表（原由 ensureCollectionTables() 创建） =====
CREATE TABLE IF NOT EXISTS connection_profiles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  conn_type TEXT NOT NULL,
  host TEXT NOT NULL,
  port INTEGER,
  username TEXT,
  auth_method TEXT NOT NULL DEFAULT 'password',
  password_encrypted TEXT,
  private_key_path TEXT,
  timeout_ms INTEGER NOT NULL DEFAULT 10000,
  extra_config TEXT,
  asset_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS asset_connections (
  id TEXT PRIMARY KEY,
  asset_id TEXT NOT NULL,
  connection_id TEXT NOT NULL,
  command_scope TEXT,
  created_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS collection_tasks (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  asset_id TEXT NOT NULL,
  connection_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  total_commands INTEGER NOT NULL DEFAULT 0,
  completed_commands INTEGER NOT NULL DEFAULT 0,
  progress INTEGER NOT NULL DEFAULT 0,
  started_at TEXT,
  finished_at TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS collection_results (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  command_id TEXT,
  command TEXT NOT NULL,
  status TEXT NOT NULL,
  exit_code INTEGER,
  stdout TEXT,
  stderr TEXT,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  parsed_data TEXT,
  created_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS collection_documents (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  asset_id TEXT,
  asset_name TEXT NOT NULL,
  host TEXT NOT NULL,
  file_path TEXT NOT NULL,
  title TEXT NOT NULL,
  created_at TEXT NOT NULL
);
--> statement-breakpoint

-- ===== AI 相关表（原由 migrateAiConfigsTable() 创建） =====
CREATE TABLE IF NOT EXISTS ai_cloud_models (
  id TEXT PRIMARY KEY,
  config_id TEXT NOT NULL DEFAULT 'default',
  name TEXT NOT NULL,
  api_base TEXT NOT NULL,
  api_key TEXT,
  model TEXT NOT NULL,
  api_format TEXT NOT NULL DEFAULT 'openai',
  enabled INTEGER NOT NULL DEFAULT 1,
  priority INTEGER NOT NULL DEFAULT 99,
  updated_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS ai_prompts (
  prompt_key TEXT PRIMARY KEY,
  template TEXT NOT NULL,
  updated_at TEXT
);
--> statement-breakpoint

-- ===== 补列（原分散在 ensureCompatColumns / migrateAiConfigsTable / 防御性迁移中） =====
ALTER TABLE operation_logs ADD COLUMN detail_json TEXT;
--> statement-breakpoint
ALTER TABLE knowledge_commands ADD COLUMN industry TEXT NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE system_settings ADD COLUMN created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'));
--> statement-breakpoint
ALTER TABLE connection_profiles ADD COLUMN asset_id TEXT;
--> statement-breakpoint
ALTER TABLE standards ADD COLUMN preset_method TEXT DEFAULT 'check';
--> statement-breakpoint
ALTER TABLE standards ADD COLUMN column_map TEXT;
--> statement-breakpoint
ALTER TABLE standards ADD COLUMN level_combo TEXT;
--> statement-breakpoint
ALTER TABLE assessment_items ADD COLUMN preset_result TEXT;
--> statement-breakpoint
ALTER TABLE assessment_items ADD COLUMN preset_record TEXT;
--> statement-breakpoint
ALTER TABLE assessment_items ADD COLUMN preset_by_type TEXT;
--> statement-breakpoint
ALTER TABLE ai_configs ADD COLUMN mode TEXT DEFAULT 'cloud';
--> statement-breakpoint
ALTER TABLE ai_configs ADD COLUMN ollama_model TEXT;
--> statement-breakpoint
ALTER TABLE ai_configs ADD COLUMN ollama_url TEXT DEFAULT 'http://localhost:11434';
--> statement-breakpoint
ALTER TABLE ai_configs ADD COLUMN ocr_preprocess INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE ai_configs ADD COLUMN active_model_id TEXT;
--> statement-breakpoint
ALTER TABLE ai_configs ADD COLUMN proxy_mode TEXT DEFAULT 'system';
--> statement-breakpoint
ALTER TABLE ai_configs ADD COLUMN proxy_url TEXT;
--> statement-breakpoint
ALTER TABLE ai_configs ADD COLUMN local_engine TEXT DEFAULT 'ollama';
--> statement-breakpoint
ALTER TABLE ai_configs ADD COLUMN herdsman_url TEXT DEFAULT 'http://localhost:8080';
--> statement-breakpoint
ALTER TABLE ai_configs ADD COLUMN herdsman_model TEXT;
--> statement-breakpoint
-- 补齐 schema.ts 中声明、但此前从未进入正式迁移的索引（P2-13）。
-- 迁移执行器会自动改写为 CREATE [UNIQUE] INDEX IF NOT EXISTS，存量库重复执行安全。
CREATE INDEX asset_project_idx ON assets(project_id);
--> statement-breakpoint
CREATE INDEX asset_project_category_idx ON assets(project_id, category);
--> statement-breakpoint
CREATE INDEX item_standard_idx ON assessment_items(standard_id);
--> statement-breakpoint
CREATE INDEX item_standard_domain_idx ON assessment_items(standard_id, domain);
--> statement-breakpoint
CREATE INDEX record_project_idx ON assessment_records(project_id);
--> statement-breakpoint
CREATE INDEX record_project_item_idx ON assessment_records(project_id, item_id);
--> statement-breakpoint
CREATE INDEX record_project_asset_idx ON assessment_records(project_id, asset_id);
--> statement-breakpoint
-- assessment_records 按 asset_id 过滤此前无任何索引，最大表走全表扫描
CREATE INDEX record_asset_idx ON assessment_records(asset_id);
--> statement-breakpoint
CREATE INDEX issue_project_idx ON issues(project_id);
--> statement-breakpoint
CREATE INDEX issue_project_status_idx ON issues(project_id, status);
--> statement-breakpoint
CREATE INDEX issue_project_risk_idx ON issues(project_id, risk_level);
