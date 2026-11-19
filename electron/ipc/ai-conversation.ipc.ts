import { ipcMain } from 'electron';
import { randomUUID } from 'crypto';
import { getDb } from '../db';
import * as schema from '../db/schema';
import { eq, desc } from 'drizzle-orm';
import { wrap } from '../utils/ipc-wrapper';
import { validateDataPath } from '../utils/path-resolver';
import * as fs from 'fs';

/** 落库的消息结构（附件只存相对路径） */
export interface StoredMessage {
  id: string;
  role: string;
  content: string;
  suggestions?: string[];
  attachments?: Array<{ name: string; path: string; type: 'image' | 'document'; size: number }>;
}

/**
 * AI 智能助手会话持久化 IPC。
 *
 * 设计要点：
 * - 所有通道走 wrap（默认会话校验），与全应用鉴权契约一致。
 * - 用户已确认「隐私模式开启时仍保存对话正文」：发送可对模型脱敏，
 *   但本地历史必须保留原文，否则历史会话无法继续追问。
 * - 附件由 attachment:save 落到受管目录，这里只存相对路径；删除会话时同步清理文件。
 * - appendMessages 用事务整轮写入（用户消息 + AI 回复），避免半截对话入历史。
 */
export function registerAiConversationHandlers(): void {
  const db = () => getDb();

  // 列出会话（按更新时间倒序），供历史下拉使用
  ipcMain.handle('aiConversation:list', wrap(async () => {
    return db().select({
      id: schema.aiConversations.id,
      title: schema.aiConversations.title,
      projectId: schema.aiConversations.projectId,
      createdAt: schema.aiConversations.createdAt,
      updatedAt: schema.aiConversations.updatedAt,
    }).from(schema.aiConversations)
      .orderBy(desc(schema.aiConversations.updatedAt))
      .all();
  }, { moduleName: 'aiConversation' }));

  // 新建会话，返回 id
  ipcMain.handle('aiConversation:create', wrap(async (_event, data?: { title?: string; projectId?: string | null }) => {
    const id = randomUUID();
    const now = new Date().toISOString();
    db().insert(schema.aiConversations).values({
      id,
      title: (data?.title || '').trim() || '新对话',
      projectId: data?.projectId || null,
      createdAt: now,
      updatedAt: now,
    }).run();
    return { id, title: data?.title || '新对话', createdAt: now, updatedAt: now };
  }, { moduleName: 'aiConversation' }));

  // 重命名会话
  ipcMain.handle('aiConversation:rename', wrap(async (_event, id: string, title: string) => {
    const name = String(title || '').trim();
    if (!name) throw new Error('会话标题不能为空');
    if (name.length > 100) throw new Error('会话标题不能超过 100 字');
    db().update(schema.aiConversations)
      .set({ title: name, updatedAt: new Date().toISOString() })
      .where(eq(schema.aiConversations.id, id)).run();
    return { success: true };
  }, { moduleName: 'aiConversation' }));

  // 删除会话 + 其全部消息 + 落盘附件文件
  ipcMain.handle('aiConversation:delete', wrap(async (_event, id: string) => {
    const database = db();
    const msgs = database.select({ attachments: schema.aiMessages.attachments })
      .from(schema.aiMessages)
      .where(eq(schema.aiMessages.conversationId, id)).all();
    database.transaction((tx) => {
      tx.delete(schema.aiMessages).where(eq(schema.aiMessages.conversationId, id)).run();
      tx.delete(schema.aiConversations).where(eq(schema.aiConversations.id, id)).run();
    });
    // 清理附件文件：只删受管目录内的相对路径，失败不影响删除会话本身
    for (const m of msgs) {
      if (!m.attachments) continue;
      try {
        const list = JSON.parse(m.attachments) as Array<{ path: string }>;
        for (const att of list) {
          if (!att?.path) continue;
          try {
            const resolved = await validateDataPath(att.path);
            if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) fs.unlinkSync(resolved);
          } catch { /* 路径越界或文件已不存在，跳过 */ }
        }
      } catch { /* JSON 损坏，跳过 */ }
    }
    return { success: true };
  }, { moduleName: 'aiConversation' }));

  // 追加消息（一整轮：用户消息 + AI 回复）。事务保证原子性。
  ipcMain.handle('aiConversation:appendMessages', wrap(async (_event, conversationId: string, messages: StoredMessage[]) => {
    if (!conversationId) throw new Error('会话ID不能为空');
    if (!Array.isArray(messages) || messages.length === 0) return { success: true };
    const database = db();
    const now = new Date().toISOString();
    database.transaction((tx) => {
      for (const m of messages) {
        tx.insert(schema.aiMessages).values({
          id: String(m.id || randomUUID()),
          conversationId,
          role: m.role === 'assistant' ? 'assistant' : 'user',
          content: String(m.content || ''),
          suggestions: m.suggestions?.length ? JSON.stringify(m.suggestions) : null,
          attachments: m.attachments?.length ? JSON.stringify(m.attachments) : null,
          createdAt: now,
        }).run();
      }
      tx.update(schema.aiConversations)
        .set({ updatedAt: now })
        .where(eq(schema.aiConversations.id, conversationId)).run();
    });
    return { success: true };
  }, { moduleName: 'aiConversation' }));

  // 清空某会话的消息（保留会话本身），对应前端「清空对话」
  ipcMain.handle('aiConversation:clearMessages', wrap(async (_event, conversationId: string) => {
    db().delete(schema.aiMessages).where(eq(schema.aiMessages.conversationId, conversationId)).run();
    return { success: true };
  }, { moduleName: 'aiConversation' }));

  // 读取某会话的全部消息（按创建时间正序），供切换会话时恢复
  ipcMain.handle('aiConversation:getMessages', wrap(async (_event, conversationId: string) => {
    const rows = db().select().from(schema.aiMessages)
      .where(eq(schema.aiMessages.conversationId, conversationId))
      .orderBy(schema.aiMessages.createdAt)
      .all();
    return rows.map(r => ({
      id: r.id,
      role: r.role,
      content: r.content,
      suggestions: r.suggestions ? safeParse(r.suggestions) : undefined,
      attachments: r.attachments ? safeParse(r.attachments) : undefined,
      createdAt: r.createdAt,
    }));
  }, { moduleName: 'aiConversation' }));
}

function safeParse<T>(json: string): T | undefined {
  try { return JSON.parse(json) as T; } catch { return undefined; }
}
