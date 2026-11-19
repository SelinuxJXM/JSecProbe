-- AI 智能助手会话与消息持久化
-- 会话按项目可选关联；消息正文原文落库（隐私模式也保存，用户已确认）；
-- 附件存相对路径 JSON，不存 base64，避免数据库被图片撑爆。
CREATE TABLE IF NOT EXISTS ai_conversations (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  project_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ai_messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  suggestions TEXT,
  attachments TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS ai_conversations_updated_idx ON ai_conversations(updated_at);
CREATE INDEX IF NOT EXISTS ai_conversations_project_idx ON ai_conversations(project_id);
CREATE INDEX IF NOT EXISTS ai_messages_conversation_idx ON ai_messages(conversation_id, created_at);
