-- 重大风险隐患识别与分析：
-- 1) major_risk_catalog 全局清单（用户提供内容后导入/编辑，跨项目共用，不随单项目归档）
-- 2) major_risk_analysis 一条问题一份三要素判定（相关性/严重性/高发性各一段 + 最终结论）
-- migrator 对 CREATE TABLE 做 IF NOT EXISTS 改写，可安全重复执行。
CREATE TABLE major_risk_catalog (
  id TEXT PRIMARY KEY,
  code TEXT,
  title TEXT NOT NULL,
  category TEXT,
  criteria TEXT,
  keywords TEXT,
  source TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE INDEX major_risk_catalog_enabled_idx ON major_risk_catalog (enabled);
--> statement-breakpoint
CREATE TABLE major_risk_analysis (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  issue_id TEXT NOT NULL,
  catalog_id TEXT,
  catalog_title TEXT,
  relevance TEXT,
  severity TEXT,
  frequency TEXT,
  verdict TEXT NOT NULL DEFAULT 'pending',
  conclusion TEXT,
  analyst TEXT,
  analyzed_at TEXT,
  reviewed_at TEXT,
  source TEXT NOT NULL DEFAULT 'manual',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE INDEX major_risk_analysis_project_idx ON major_risk_analysis (project_id);
--> statement-breakpoint
CREATE UNIQUE INDEX major_risk_analysis_issue_unique ON major_risk_analysis (issue_id);
