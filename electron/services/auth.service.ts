import { getDb } from '../db';
import * as schema from '../db/schema';
import { eq } from 'drizzle-orm';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'fs';
import { dirname, join } from 'path';
import log from 'electron-log';
import { getDbPath } from '../main/paths';
import { encryptSecret, decryptSecret } from './credential.util';
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

/** 将活动会话写入磁盘（重启后可恢复登录态）；不传 session 表示清除。
 *  token 字段用 safeStorage 加密落盘，避免明文 token 泄露；读取时自动解密，兼容旧版明文文件。 */
function persistActiveSession(session?: Session): void {
  try {
    const file = getSessionFilePath();
    if (!session) {
      if (existsSync(file)) unlinkSync(file);
      return;
    }
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify({
      token: encryptSecret(session.token),
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
      // decryptSecret 会自动识别 enc: 前缀解密；旧版明文 token（无前缀）原样返回，保持兼容
      const token = decryptSecret(raw?.token);
      if (!token || !raw?.userId || !raw?.username) {
        persistActiveSession();
        return;
      }
      const session: Session = {
        userId: raw.userId,
        username: raw.username,
        token,
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
      // 若磁盘上仍是旧版明文 token（无 enc: 前缀），立即用加密格式重写落盘，避免明文残留
      if (typeof raw?.token === 'string' && !raw.token.startsWith('enc:')) {
        persistActiveSession(session);
      }
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

  /** 获取当前进程的活动会话（未登录返回 null）。
   *  注意：不做过期清理，仅用于读取会话主体做权限判定；过期判定由 getSession 负责。 */
  static getActiveSession(): Session | null {
    if (!activeToken) return null;
    return sessions.get(activeToken) || null;
  }

  /** 查询指定用户的角色（不存在或已禁用返回 null） */
  static async getUserRole(userId: string): Promise<string | null> {
    try {
      const db = getDb();
      const user = await db.query.users.findFirst({
        where: eq(schema.users.id, userId),
      });
      if (!user || !user.isActive) return null;
      return user.role || null;
    } catch (e) {
      log.warn('查询用户角色失败:', e);
      return null;
    }
  }

  /** 当前活动会话用户的角色（未登录/查询失败返回 null） */
  static async getActiveUserRole(): Promise<string | null> {
    const session = this.getActiveSession();
    if (!session) return null;
    return this.getUserRole(session.userId);
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

    // 改密完成：立即失效缓存，否则服务端强制改密会因 3 秒缓存继续拦截刚改完密码的用户
    this.invalidateMustChangeCache(userId);

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

  /**
   * 「必须改密」查询缓存（E2 服务端强制改密）。
   *
   * 强制改密需要在**每次 IPC** 上判断，逐次查库会让自动保存、列表刷新等高频通道明显变慢。
   * 这里缓存 3 秒，并在改密成功 / 登出时主动失效，避免"密码已改却仍被拦截"。
   */
  private static mustChangeCache = new Map<string, { value: boolean; expiresAt: number }>();
  private static readonly MUST_CHANGE_TTL_MS = 3000;

  /** 使「必须改密」缓存失效；不传 userId 时清空全部 */
  static invalidateMustChangeCache(userId?: string): void {
    if (userId) {
      this.mustChangeCache.delete(userId);
    } else {
      this.mustChangeCache.clear();
    }
  }

  /**
   * 指定用户是否仍在使用初始口令（mustChangePassword=1）。
   *
   * 实现为**同步**：better-sqlite3 本身就是同步驱动，而该判断发生在每一次 IPC 上，
   * 走 async 会迫使 `assertTrusted()`（ai.ipc.ts 中 22 处裸通道的守卫）连带改成异步，
   * 波及全部调用点。
   *
   * 查询失败时返回 false（放行）—— 相较"因数据库抖动把整个应用锁死"，
   * 短暂放开是更合理的取舍，且该状态在日志中会留痕。
   */
  static mustChangePassword(userId: string): boolean {
    const now = Date.now();
    const hit = this.mustChangeCache.get(userId);
    if (hit && hit.expiresAt > now) return hit.value;
    try {
      const db = getDb();
      const user = db.select({ mustChangePassword: schema.users.mustChangePassword })
        .from(schema.users)
        .where(eq(schema.users.id, userId))
        .get();
      const value = !!user?.mustChangePassword;
      this.mustChangeCache.set(userId, { value, expiresAt: now + this.MUST_CHANGE_TTL_MS });
      return value;
    } catch (e) {
      log.warn('查询用户是否需强制改密失败:', e);
      return false;
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
