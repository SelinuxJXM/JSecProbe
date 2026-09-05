import { getDb } from '../db';
import * as schema from '../db/schema';
import { eq } from 'drizzle-orm';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'fs';
import { dirname, join } from 'path';
import log from 'electron-log';
import { getDbPath } from '../main/paths';
import type { User } from '../../shared/types';

interface Session {
  userId: string;
  username: string;
  token: string;
  createdAt: number;
  lastAccessedAt: number;
}

const SESSION_TIMEOUT_MS = 24 * 60 * 60 * 1000;
const SESSION_PERSIST_THROTTLE_MS = 10 * 60 * 1000;
const sessions = new Map<string, Session>();
let sessionCleanupTimer: ReturnType<typeof setInterval> | null = null;
let lastSessionPersistAt = 0;
// 单用户桌面应用：记录当前进程的活动登录会话 token，用于后端会话强制校验
let activeToken: string | null = null;

function getSessionFilePath(): string {
  return join(dirname(getDbPath()), 'session.json');
}

/** 将活动会话写入磁盘（重启后可恢复登录态）；不传 session 表示清除 */
function persistActiveSession(session?: Session): void {
  try {
    const file = getSessionFilePath();
    if (!session) {
      if (existsSync(file)) unlinkSync(file);
      return;
    }
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify({
      token: session.token,
      userId: session.userId,
      username: session.username,
      createdAt: session.createdAt,
      lastAccessedAt: session.lastAccessedAt,
    }, null, 2), 'utf-8');
    lastSessionPersistAt = Date.now();
  } catch (e) {
    log.warn('持久化登录会话失败:', e);
  }
}

export class AuthService {
  /** 启动定期会话清理定时器（每小时清理一次过期会话） */
  static startSessionCleanupTimer(): void {
    if (sessionCleanupTimer) return;
    sessionCleanupTimer = setInterval(() => {
      this.cleanupExpiredSessions();
    }, 60 * 60 * 1000);
  }

  /** 停止会话清理定时器 */
  static stopSessionCleanupTimer(): void {
    if (sessionCleanupTimer) {
      clearInterval(sessionCleanupTimer);
      sessionCleanupTimer = null;
    }
  }

  /** 应用启动时从磁盘恢复上次登录会话（未过期则恢复登录态） */
  static restorePersistedSession(): void {
    try {
      const file = getSessionFilePath();
      if (!existsSync(file)) return;
      const raw = JSON.parse(readFileSync(file, 'utf-8'));
      if (!raw?.token || !raw?.userId || !raw?.username) {
        persistActiveSession();
        return;
      }
      const session: Session = {
        userId: raw.userId,
        username: raw.username,
        token: raw.token,
        createdAt: raw.createdAt || Date.now(),
        lastAccessedAt: raw.lastAccessedAt || raw.createdAt || Date.now(),
      };
      if (Date.now() - session.lastAccessedAt > SESSION_TIMEOUT_MS) {
        log.info('持久化会话已过期，清除');
        persistActiveSession();
        return;
      }
      sessions.set(session.token, session);
      activeToken = session.token;
      lastSessionPersistAt = Date.now();
      log.info(`已恢复登录会话: ${session.username}`);
    } catch (e) {
      log.warn('恢复登录会话失败:', e);
    }
  }

  static async validateUser(username: string): Promise<User | null> {
    const db = getDb();
    const user = await db.query.users.findFirst({
      where: eq(schema.users.username, username),
    });
    if (!user) return null;

    return {
      id: user.id,
      username: user.username,
      realName: user.realName,
      email: user.email || undefined,
      phone: user.phone || undefined,
      role: user.role,
      isActive: !!user.isActive,
      mustChangePassword: !!user.mustChangePassword,
      lastLoginAt: user.lastLoginAt || undefined,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }

  static createSession(userId: string, username: string): Session {
    this.cleanupExpiredSessions();
    const now = Date.now();
    const session: Session = {
      userId,
      username,
      token: randomUUID(),
      createdAt: now,
      lastAccessedAt: now,
    };
    sessions.set(session.token, session);
    activeToken = session.token;
    persistActiveSession(session);
    return session;
  }

  static getSession(token: string): Session | null {
    const session = sessions.get(token);
    if (!session) return null;
    if (Date.now() - session.lastAccessedAt > SESSION_TIMEOUT_MS) {
      sessions.delete(token);
      if (activeToken === token) {
        activeToken = null;
        persistActiveSession();
      }
      return null;
    }
    session.lastAccessedAt = Date.now();
    // 节流刷新持久化的 lastAccessedAt，避免跨重启时误判超时
    if (token === activeToken && Date.now() - lastSessionPersistAt > SESSION_PERSIST_THROTTLE_MS) {
      persistActiveSession(session);
    }
    return session;
  }

  static destroySession(token: string): boolean {
    const removed = sessions.delete(token);
    if (removed && activeToken === token) {
      activeToken = null;
      persistActiveSession();
    }
    return removed;
  }

  static getAllSessions(): ReadonlyMap<string, Session> {
    return sessions;
  }

  /** 是否存在已登录的活动会话（单用户桌面应用：进程级判定，用于后端 IPC 会话强制校验） */
  static isAuthenticated(): boolean {
    return activeToken !== null && sessions.has(activeToken);
  }

  private static cleanupExpiredSessions(): void {
    const now = Date.now();
    for (const [token, session] of sessions) {
      if (now - session.lastAccessedAt > SESSION_TIMEOUT_MS) {
        sessions.delete(token);
      }
    }
  }

  static async changePassword(userId: string, oldPassword: string, newPassword: string): Promise<void> {
    const minPasswordLength = 8;
    if (newPassword.length < minPasswordLength) {
      throw new Error(`新密码长度不能少于 ${minPasswordLength} 位`);
    }
    if (newPassword === oldPassword) {
      throw new Error('新密码不能与旧密码相同');
    }

    const db = getDb();
    const user = await db.query.users.findFirst({
      where: eq(schema.users.id, userId),
    });
    if (!user) throw new Error('用户不存在');

    const valid = bcrypt.compareSync(oldPassword, user.passwordHash);
    if (!valid) throw new Error('旧密码错误');

    const newHash = bcrypt.hashSync(newPassword, 12);
    const now = new Date().toISOString();
    await db.update(schema.users)
      .set({ passwordHash: newHash, mustChangePassword: 0, updatedAt: now })
      .where(eq(schema.users.id, userId));

    for (const session of sessions.values()) {
      if (session.userId === userId) {
        sessions.delete(session.token);
        if (activeToken === session.token) {
          activeToken = null;
          persistActiveSession();
        }
      }
    }
  }

  static async updateLastLogin(userId: string): Promise<void> {
    const db = getDb();
    const now = new Date().toISOString();
    await db.update(schema.users)
      .set({ lastLoginAt: now, updatedAt: now })
      .where(eq(schema.users.id, userId));
  }
}
