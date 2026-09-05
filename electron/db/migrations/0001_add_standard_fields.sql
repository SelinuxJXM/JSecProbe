-- 行标支持：standards 表新增 4 个扩展字段（standard_type/industry/source/preset_template）
-- 现有国标行自动回填默认值（national/''/builtin/''），零影响
ALTER TABLE standards ADD COLUMN standard_type TEXT NOT NULL DEFAULT 'national';
--> statement-breakpoint
ALTER TABLE standards ADD COLUMN industry TEXT;
--> statement-breakpoint
ALTER TABLE standards ADD COLUMN source TEXT NOT NULL DEFAULT 'builtin';
--> statement-breakpoint
ALTER TABLE standards ADD COLUMN preset_template TEXT;
--> statement-breakpoint
ALTER TABLE standards ADD COLUMN domains_meta TEXT;
