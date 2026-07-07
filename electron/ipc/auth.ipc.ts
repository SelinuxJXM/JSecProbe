import { ipcMain } from 'electron';
import log from 'electron-log';
import { getDb } from '../db';
import * as schema from '../db/schema';
import { eq } from 'drizzle-orm';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';
import type { LoginResult } from '../../shared/types';
import { writeOperationLog } from '../utils/operation-log';

function wrap<T>(fn: () => T | Promise<T>): Promise<any> {
  return Promise.resolve()
    .then(fn)
    .then((data) => ({ success: true, data }))
    .catch((error) => {
      log.error('Auth IPC Error:', error);
      return {
        success: false,
        error: {
          code: error.code || 'INTERNAL_ERROR',
          message: error.message || '操作失败',
        },
      };
    });
}

export function registerAuthHandlers(): void {
  ipcMain.handle('auth:login', (_event, username: string, password: string) =>
    wrap<LoginResult>(async () => {
      const db = getDb();
      const user = await db.query.users.findFirst({
        where: eq(schema.users.username, username),
      });

      if (!user) {
        await writeOperationLog({
          action: 'login',
          module: 'auth',
          username,
          description: '登录失败：用户不存在',
        });
        return { success: false, message: '用户不存在' };
      }

      if (user.isActive !== 1) {
        await writeOperationLog({
          userId: user.id,
          username,
          action: 'login',
          module: 'auth',
          description: '登录失败：账号已被禁用',
        });
        return { success: false, message: '账号已被禁用' };
      }

      const valid = bcrypt.compareSync(password, user.passwordHash);
      if (!valid) {
        await writeOperationLog({
          userId: user.id,
          username,
          action: 'login',
          module: 'auth',
          description: '登录失败：密码错误',
        });
        return { success: false, message: '密码错误' };
      }

      const now = new Date().toISOString();
      await db.update(schema.users)
        .set({ lastLoginAt: now, updatedAt: now })
        .where(eq(schema.users.id, user.id));

      await writeOperationLog({
        userId: user.id,
        username,
        action: 'login',
        module: 'auth',
        description: `用户 ${username} 登录系统`,
      });

      return {
        success: true,
        user: {
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
        },
        token: randomUUID(),
      };
    })
  );

  ipcMain.handle('auth:logout', () =>
    wrap<void>(async () => {
      log.info('用户登出');
      await writeOperationLog({
        action: 'logout',
        module: 'auth',
        description: '用户登出系统',
      });
    })
  );

  ipcMain.handle('auth:getCurrentUser', () =>
    wrap(() => null)
  );

  ipcMain.handle('auth:changePassword', (_event, userId: string, oldPassword: string, newPassword: string) =>
    wrap<void>(async () => {
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
    })
  );
}