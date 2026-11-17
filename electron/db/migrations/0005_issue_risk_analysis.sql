-- 风险分析：一条问题对应一份分析结论（可能性 × 影响程度 → 风险值 → 结论等级），
-- 结论随 issues 行一起走归档/备份/级联删除，不引入独立实体。
-- 所有列可空，未分析的问题保持 NULL；migrator 对 ADD COLUMN 做 PRAGMA 判存，可安全重复执行。
ALTER TABLE issues ADD COLUMN risk_likelihood TEXT;
--> statement-breakpoint
ALTER TABLE issues ADD COLUMN risk_impact TEXT;
--> statement-breakpoint
ALTER TABLE issues ADD COLUMN risk_score INTEGER;
--> statement-breakpoint
ALTER TABLE issues ADD COLUMN risk_evaluated_level TEXT;
--> statement-breakpoint
ALTER TABLE issues ADD COLUMN risk_threat TEXT;
--> statement-breakpoint
ALTER TABLE issues ADD COLUMN risk_consequence TEXT;
--> statement-breakpoint
ALTER TABLE issues ADD COLUMN risk_strategy TEXT;
--> statement-breakpoint
ALTER TABLE issues ADD COLUMN risk_countermeasure TEXT;
--> statement-breakpoint
ALTER TABLE issues ADD COLUMN risk_residual TEXT;
--> statement-breakpoint
ALTER TABLE issues ADD COLUMN risk_analyst TEXT;
--> statement-breakpoint
ALTER TABLE issues ADD COLUMN risk_analyzed_at TEXT;
