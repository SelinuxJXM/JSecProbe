-- 补齐 0000_init.sql / 0001 遗漏的字段（schema.ts 已定义但 SQL 未同步）
-- 执行前会检查字段是否存在，幂等可重跑

-- 1. standards 补充 preset_method / column_map（0001 遗漏）
ALTER TABLE standards ADD COLUMN preset_method TEXT NOT NULL DEFAULT 'check';
--> statement-breakpoint
ALTER TABLE standards ADD COLUMN column_map TEXT;
--> statement-breakpoint

-- 2. assessment_items 补充 preset_result / preset_record
ALTER TABLE assessment_items ADD COLUMN preset_result TEXT;
--> statement-breakpoint
ALTER TABLE assessment_items ADD COLUMN preset_record TEXT;
--> statement-breakpoint

-- 3. operation_logs 补充 detail_json
ALTER TABLE operation_logs ADD COLUMN detail_json TEXT;
--> statement-breakpoint

-- 4. knowledge_commands 补充 industry
ALTER TABLE knowledge_commands ADD COLUMN industry TEXT NOT NULL DEFAULT '';
--> statement-breakpoint

-- 5. system_settings 补充 created_at
ALTER TABLE system_settings ADD COLUMN created_at TEXT NOT NULL DEFAULT (datetime('now'));
--> statement-breakpoint

-- 6. 修正 ai_configs.temperature 默认值（0000 为 0.7，schema.ts 为 0.3）
-- SQLite 不支持 ALTER COLUMN，通过重建表实现
CREATE TABLE ai_configs_new (
  id TEXT PRIMARY KEY DEFAULT 'default',
  provider TEXT DEFAULT 'openai',
  api_key TEXT,
  api_base TEXT,
  model TEXT DEFAULT 'gpt-4o-mini',
  temperature REAL NOT NULL DEFAULT 0.3,
  ocr_provider TEXT DEFAULT 'tesseract',
  ocr_api_key TEXT,
  enable_ai INTEGER NOT NULL DEFAULT 0,
  privacy_mode INTEGER NOT NULL DEFAULT 0,
  sensitive_words TEXT,
  mode TEXT DEFAULT 'cloud',
  ollama_model TEXT,
  ollama_url TEXT DEFAULT 'http://localhost:11434',
  ocr_preprocess INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
--> statement-breakpoint
INSERT INTO ai_configs_new SELECT * FROM ai_configs;
--> statement-breakpoint
DROP TABLE ai_configs;
--> statement-breakpoint
ALTER TABLE ai_configs_new RENAME TO ai_configs;
