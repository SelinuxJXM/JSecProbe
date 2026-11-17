-- 重大风险隐患清单内置种子版本标记（0=未入驻，>0=已入驻）。
-- 仅当该版本 < 当前种子版本时入驻一次；用户导入/清空清单后不会被重新覆盖。
ALTER TABLE system_settings ADD COLUMN major_risk_seed_version INTEGER NOT NULL DEFAULT 0;
