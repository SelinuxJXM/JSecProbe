-- 0004_project_groups
--
-- 项目分组层：一个项目（委托 / 合同批次）下可包含多个独立测评的系统。
--
-- 设计要点：现有 `projects` 表的一行在业务语义上本来就是「一个系统的完整测评」
-- （报告服务按 project_id 取资产 / 测评记录 / 问题，模板里的系统名称即 system_name）。
-- 因此本次只在系统记录之上加一层分组，由 projects.group_id 关联；
-- assets / assessment_records / issues 等所有业务表的数据归属完全不动，
-- 老项目升级后零数据搬运。
--
-- 幂等：migrator.ts 会把 CREATE TABLE / CREATE INDEX 改写为 IF NOT EXISTS，
-- 并对 ALTER TABLE ADD COLUMN 先做 PRAGMA table_info 判存。
-- 老项目的分组回填放在 electron/db/index.ts 的 ensureProjectGroupTables() 中，
-- 因为它需要生成 UUID 且要在「账本已标记完成但表被恢复丢失」时仍能自愈。
CREATE TABLE IF NOT EXISTS project_groups (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  project_no TEXT,
  assessed_unit TEXT,
  customer_name TEXT,
  assessor TEXT,
  start_date TEXT,
  end_date TEXT,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS project_group_status_idx ON project_groups(status);

--> statement-breakpoint
ALTER TABLE projects ADD COLUMN group_id TEXT;

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS project_group_ref_idx ON projects(group_id);
