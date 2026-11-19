-- 测评点知识库：为模糊召回的 control_point 过滤加索引（审查 M9 修复）
-- 不改动历史迁移 0009，避免账本 hash 不匹配告警
CREATE INDEX IF NOT EXISTS assessment_checkpoints_control_point_idx
  ON assessment_checkpoints(control_point);
