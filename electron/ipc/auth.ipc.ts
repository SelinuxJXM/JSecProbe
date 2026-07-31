import { ipcMain } from 'electron';
import log from 'electron-log';
import bcrypt from 'bcryptjs';
import { AuthService } from '../services/auth.service';
import type { LoginResult } from '../../shared/types';
import { wrap } from '../utils/ipc-wrapper';
import { getDb } from '../db';
import * as schema from '../db/schema';
import { eq } from 'drizzle-orm';
import { writeOperationLog as writeLog } from '../utils/operation-log';

const loginAttempts = new Map<string, { count: number; lockedUntil: number }>();

function checkRateLimit(username: string): { allowed: boolean; message?: string } {
  const record = loginAttempts.get(username);
  if (record && record.lockedUntil > Date.now()) {
    const remaining = Math.ceil((record.lockedUntil - Date.now()) / 1000 / 60);
    return { allowed: false, message: `账号已被锁定，请 ${remaining} 分钟后重试` };
  }
  return { allowed: true };
}

function recordFailedAttempt(username: string): void {
  const record = loginAttempts.get(username) || { count: 0, lockedUntil: 0 };
  record.count++;
  if (record.count >= 5) {
    record.lockedUntil = Date.now() + 5 * 60 * 1000;
    record.count = 0;
  }
  loginAttempts.set(username, record);
}

function clearAttempts(username: string): void {
  loginAttempts.delete(username);
}

export function registerAuthHandlers(): void {
  ipcMain.handle('auth:login', wrap(async (_event, username: string, password: string): Promise<LoginResult> => {
    const rateLimit = checkRateLimit(username);
    if (!rateLimit.allowed) {
      return { success: false, message: rateLimit.message! };
    }

    const user = await AuthService.validateUser(username);

    if (!user) {
      recordFailedAttempt(username);
      await writeLog({
        action: 'login',
        module: 'auth',
        username,
        description: '登录失败：用户不存在',
      });
      return { success: false, message: '用户名或密码错误' };
    }

    if (!user.isActive) {
      await writeLog({
        userId: user.id,
        username,
        action: 'login',
        module: 'auth',
        description: '登录失败：账号已被禁用',
      });
      return { success: false, message: '账号已被禁用' };
    }

    const db = getDb();
    const dbUser = await db.query.users.findFirst({
      where: eq(schema.users.id, user.id),
    });

    if (!dbUser) {
      recordFailedAttempt(username);
      return { success: false, message: '用户名或密码错误' };
    }

    const valid = await bcrypt.compare(password, dbUser.passwordHash);
    if (!valid) {
      recordFailedAttempt(username);
      await writeLog({
        userId: user.id,
        username,
        action: 'login',
        module: 'auth',
        description: '登录失败：密码错误',
      });
      return { success: false, message: '用户名或密码错误' };
    }

    clearAttempts(username);
    await AuthService.updateLastLogin(user.id);
    const session = AuthService.createSession(user.id, user.username);

    await writeLog({
      userId: user.id,
      username,
      action: 'login',
      module: 'auth',
      description: `用户 ${username} 登录系统`,
    });

    return {
      success: true,
      user,
      token: session.token,
    };
  }, 'auth'));

  ipcMain.handle('auth:logout', wrap(async (_event, token?: string): Promise<void> => {
    if (token) {
      AuthService.destroySession(token);
    }
    log.info('用户登出');
    await writeLog({
      action: 'logout',
      module: 'auth',
      description: '用户登出系统',
    });
  }, 'auth'));

  ipcMain.handle('auth:getCurrentUser', wrap(async (_event, token: string): Promise<{ userId: string; username: string } | null> => {
    const session = AuthService.getSession(token);
    if (!session) return null;
    return { userId: session.userId, username: session.username };
  }, 'auth'));

  ipcMain.handle('auth:changePassword', wrap(async (_event, params: { token: string; oldPassword: string; newPassword: string }): Promise<void> => {
    const { token, oldPassword, newPassword } = params;
    const session = AuthService.getSession(token);
    if (!session) {
      throw new Error('会话无效或已过期，请重新登录');
    }
    await AuthService.changePassword(session.userId, oldPassword, newPassword);
  }, 'auth'));

  ipcMain.handle('auth:validateSession', wrap(async (_event, token: string): Promise<{ valid: boolean; userId?: string; username?: string }> => {
    const session = AuthService.getSession(token);
    if (!session) return { valid: false };
    return { valid: true, userId: session.userId, username: session.username };
  }, 'auth'));
}
