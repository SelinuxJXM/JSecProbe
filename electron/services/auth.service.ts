import { getDb } from '../db';
import * as schema from '../db/schema';
import { eq } from 'drizzle-orm';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';
import type { User } from '../../shared/types';

interface Session {
  userId: string;
  username: string;
  token: string;
  createdAt: number;
  lastAccessedAt: number;
}

const SESSION_TIMEOUT_MS = 24 * 60 * 60 * 1000;
const sessions = new Map<string, Session>();

export class AuthService {
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
    return session;
  }

  static getSession(token: string): Session | null {
    const session = sessions.get(token);
    if (!session) return null;
    if (Date.now() - session.lastAccessedAt > SESSION_TIMEOUT_MS) {
      sessions.delete(token);
      return null;
    }
    session.lastAccessedAt = Date.now();
    return session;
  }

  static destroySession(token: string): boolean {
    return sessions.delete(token);
  }

  static getAllSessions(): ReadonlyMap<string, Session> {
    return sessions;
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
