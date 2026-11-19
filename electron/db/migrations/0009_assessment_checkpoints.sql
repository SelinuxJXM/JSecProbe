-- 测评点知识库：从等保测评作业指导书导入的「测评项 → 测评点」结构化数据
-- 语义键（域+控制点+要求文本归一化）标准无关，跨二/三级复用；deviceKey 区分不同设备核查方法
CREATE TABLE IF NOT EXISTS assessment_checkpoints (
  id TEXT PRIMARY KEY,
  semantic_key TEXT NOT NULL,
  device_key TEXT NOT NULL DEFAULT '',
  domain TEXT,
  control_point TEXT,
  requirement TEXT NOT NULL,
  checkpoints TEXT NOT NULL DEFAULT '[]',
  interpretation TEXT,
  result_template TEXT,
  catalog_no TEXT,
  source TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS assessment_checkpoints_semantic_device_unique
  ON assessment_checkpoints(semantic_key, device_key);
CREATE INDEX IF NOT EXISTS assessment_checkpoints_semantic_idx
  ON assessment_checkpoints(semantic_key);
