-- 0003_external_links
--
-- 内置 / 自定义外链模块。结构对齐 electron/db/schema.ts 末尾的 external_links 表。
-- 内置清单本身不入库：只读 seed 随版本打包；本表只承载用户新增项与「覆盖层」。
-- 导航站作为一条内置外链提供，需要把其中链接搬进应用时用「导入 sites.txt」手动完成，
-- 不设远程同步、不缓存外部清单。
--
-- 幂等：migrator.ts 会把 CREATE TABLE 改写为 CREATE TABLE IF NOT EXISTS，
-- 且 electron/db/index.ts 的 ensureExternalLinkTables() 无条件再兜底一次。
CREATE TABLE IF NOT EXISTS external_links (
  id TEXT PRIMARY KEY,
  link_key TEXT,
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  group_name TEXT NOT NULL DEFAULT '自定义',
  description TEXT NOT NULL DEFAULT '',
  icon_text TEXT,
  network_zone TEXT NOT NULL DEFAULT 'internet',
  is_builtin INTEGER NOT NULL DEFAULT 0,
  is_hidden INTEGER NOT NULL DEFAULT 0,
  is_favorite INTEGER NOT NULL DEFAULT 0,
  is_stale INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  scope TEXT NOT NULL DEFAULT 'global',
  owner_id TEXT,
  last_opened_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
