import { ipcMain } from 'electron';
import { getDb } from '../db';
import * as schema from '../db/schema';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import bcrypt from 'bcryptjs';
import { wrap } from '../utils/ipc-wrapper';

/** 合法角色白名单：防止客户端传入任意角色值（如超级管理员）造成越权 */
const VALID_ROLES = ['admin', 'assessor'] as const;

function assertValidRole(role: unknown): string {
  if (typeof role !== 'string' || !VALID_ROLES.includes(role as typeof VALID_ROLES[number])) {
    throw new Error(`非法角色值：${String(role)}（仅支持 ${VALID_ROLES.join(' / ')}）`);
  }
  return role as string;
}

export function registerUserHandlers(): void {
  ipcMain.handle('user:list', wrap(async () => {
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
      // 用户管理属管理类操作：强制管理员角色（角色校验隐含会话校验）
    }, { moduleName: 'user', requireRole: ['admin'] }));

  ipcMain.handle('user:create', wrap(async (_event, data: { username: string; password: string; realName: string; email?: string; phone?: string; role?: string }) => {
      if (!data.username || data.username.length < 3) throw new Error('用户名至少3个字符');
      if (!data.realName) throw new Error('请输入姓名');
      if (!data.password) throw new Error('请输入密码');
      if (data.password.length < 8) throw new Error('密码长度不能少于 8 位');
      if (typeof data.role === 'string') assertValidRole(data.role);
      const db = getDb();

      const existing = await db.select().from(schema.users).where(eq(schema.users.username, data.username)).limit(1);
      if (existing.length > 0) throw new Error('用户名已存在');

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
    }, { moduleName: 'user', requireRole: ['admin'] }));

  ipcMain.handle('user:update', wrap(async (_event, id: string, data: { realName?: string; email?: string; phone?: string; role?: string; isActive?: boolean; password?: string }) => {
      const db = getDb();
      // 改角色/启用状态/重置密码均为管理类操作，此处已在 wrap 层强制 admin；
      // 再对角色与密码取值做校验，杜绝写入任意角色或过短密码
      if (data.role !== undefined) assertValidRole(data.role);
      if (data.password !== undefined && data.password.length > 0 && data.password.length < 8) {
        throw new Error('密码长度不能少于 8 位');
      }
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
    }, { moduleName: 'user', requireRole: ['admin'] }));

  ipcMain.handle('user:delete', wrap(async (_event, id: string) => {
      const db = getDb();
      await db.delete(schema.users).where(eq(schema.users.id, id));
    }, { moduleName: 'user', requireRole: ['admin'] }));
}