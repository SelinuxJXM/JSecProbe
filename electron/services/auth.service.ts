import { getDb } from '../db';
import * as schema from '../db/schema';
import { eq } from 'drizzle-orm';

export class AuthService {
  static async validateUser(username: string): Promise<any> {
    const db = getDb();
    return await db.query.users.findFirst({
      where: eq(schema.users.username, username),
    });
  }

  static async updateLastLogin(userId: string): Promise<void> {
    const db = getDb();
    const now = new Date().toISOString();
    await db.update(schema.users)
      .set({ lastLoginAt: now, updatedAt: now })
      .where(eq(schema.users.id, userId));
  }

  static async changePassword(userId: string, oldPassword: string, newPassword: string): Promise<void> {
    const db = getDb();
    const user = await db.query.users.findFirst({
      where: eq(schema.users.id, userId),
    });
    if (!user) throw new Error('用户不存在');
    const bcrypt = await import('bcryptjs');
    const valid = bcrypt.compareSync(oldPassword, user.passwordHash);
    if (!valid) throw new Error('旧密码错误');
    const newHash = bcrypt.hashSync(newPassword, 12);
    const now = new Date().toISOString();
    await db.update(schema.users)
      .set({ passwordHash: newHash, mustChangePassword: 0, updatedAt: now })
      .where(eq(schema.users.id, userId));
  }
}