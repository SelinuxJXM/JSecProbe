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

export function registerAuthHandlers(): void {
  ipcMain.handle('auth:login', wrap(async (_event, username: string, password: string): Promise<LoginResult> => {
    const user = await AuthService.validateUser(username);

    if (!user) {
      await writeLog({
        action: 'login',
        module: 'auth',
        username,
        description: '登录失败：用户不存在',
      });
      return { success: false, message: '用户不存在' };
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
      return { success: false, message: '用户不存在' };
    }

    const valid = bcrypt.compareSync(password, dbUser.passwordHash);
    if (!valid) {
      await writeLog({
        userId: user.id,
        username,
        action: 'login',
        module: 'auth',
        description: '登录失败：密码错误',
      });
      return { success: false, message: '密码错误' };
    }

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

  ipcMain.handle('auth:changePassword', wrap(async (_event, userId: string, oldPassword: string, newPassword: string): Promise<void> => {
    await AuthService.changePassword(userId, oldPassword, newPassword);
  }, 'auth'));

  ipcMain.handle('auth:validateSession', wrap(async (_event, token: string): Promise<{ valid: boolean; userId?: string; username?: string }> => {
    const session = AuthService.getSession(token);
    if (!session) return { valid: false };
    return { valid: true, userId: session.userId, username: session.username };
  }, 'auth'));
}
