import { ipcMain } from 'electron';
import log from 'electron-log';
import bcrypt from 'bcryptjs';
import { getDb } from '../db';
import * as schema from '../db/schema';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'crypto';

function wrap<T>(fn: () => T | Promise<T>): Promise<any> {
  return Promise.resolve()
    .then(fn)
    .then((data) => ({ success: true, data }))
    .catch((error) => {
      log.error('User IPC Error:', error);
      return {
        success: false,
        error: {
          code: error.code || 'INTERNAL_ERROR',
          message: error.message || '操作失败',
        },
      };
    });
}

export function registerUserHandlers(): void {
  ipcMain.handle('user:list', () =>
    wrap(async () => {
      const db = getDb();
      const users = await db.select().from(schema.users);
      return users.map(u => ({
        id: u.id,
        username: u.username,
        realName: u.realName,
        email: u.email,
        phone: u.phone,
        role: u.role,
        isActive: u.isActive === 1,
        lastLoginAt: u.lastLoginAt,
        createdAt: u.createdAt,
        updatedAt: u.updatedAt,
      }));
    })
  );

  ipcMain.handle('user:create', (_event, data: { username: string; password: string; realName: string; email?: string; phone?: string; role?: string }) =>
    wrap(async () => {
      const db = getDb();
      const id = randomUUID();
      const now = new Date().toISOString();
      const passwordHash = bcrypt.hashSync(data.password, 12);
      await db.insert(schema.users).values({
        id,
        username: data.username,
        passwordHash,
        realName: data.realName,
        email: data.email,
        phone: data.phone,
        role: data.role || 'assessor',
        isActive: 1,
        createdAt: now,
        updatedAt: now,
      });
      return { id, username: data.username, realName: data.realName };
    })
  );

  ipcMain.handle('user:update', (_event, id: string, data: { realName?: string; email?: string; phone?: string; role?: string; isActive?: boolean; password?: string }) =>
    wrap(async () => {
      const db = getDb();
      const now = new Date().toISOString();
      const updateData: any = { updatedAt: now };
      if (data.realName !== undefined) updateData.realName = data.realName;
      if (data.email !== undefined) updateData.email = data.email;
      if (data.phone !== undefined) updateData.phone = data.phone;
      if (data.role !== undefined) updateData.role = data.role;
      if (data.isActive !== undefined) updateData.isActive = data.isActive ? 1 : 0;
      if (data.password) {
        updateData.passwordHash = bcrypt.hashSync(data.password, 12);
      }
      await db.update(schema.users).set(updateData).where(eq(schema.users.id, id));
    })
  );

  ipcMain.handle('user:delete', (_event, id: string) =>
    wrap(async () => {
      const db = getDb();
      await db.delete(schema.users).where(eq(schema.users.id, id));
    })
  );
}
