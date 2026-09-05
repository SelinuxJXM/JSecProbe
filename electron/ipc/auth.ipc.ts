import { ipcMain } from 'electron';
import log from 'electron-log';
import bcrypt from 'bcryptjs';
import { AuthService } from '../services/auth.service';
import type { LoginResult, User } from '../../shared/types';
import { wrap } from '../utils/ipc-wrapper';
import { getDb } from '../db';
import * as schema from '../db/schema';
import { eq } from 'drizzle-orm';
import { writeOperationLog as writeLog } from '../utils/operation-log';
import { getAppDataPathSync } from '../main/paths';
import * as fs from 'fs';
import * as pathMod from 'path';

interface LoginAttemptRecord { count: number; lockedUntil: number; lastFailedAt?: number }
type LoginAttemptsStore = Record<string, LoginAttemptRecord>;

const loginAttempts = new Map<string, LoginAttemptRecord>();
const LOGIN_ATTEMPTS_FILE = () => pathMod.join(getAppDataPathSync(), 'login-attempts.json');
const MAX_ATTEMPTS = 5;
const LOCK_MINUTES = 5;
const ATTEMPTS_TTL_MS = 24 * 60 * 60 * 1000; // 24小时后自动清理
// 全局限流：防止攻击者轮换不同用户名绕过单用户名锁定
const GLOBAL_KEY = '__global__';
const GLOBAL_MAX_ATTEMPTS = 20;
const GLOBAL_LOCK_MINUTES = 15;

function cleanupExpiredAttempts(): void {
  const now = Date.now();
  let changed = false;
  for (const [key, record] of loginAttempts.entries()) {
    // 清理已过期锁定且超过 TTL 的条目，以及长时间无失败尝试的普通条目
    const lastActivity = Math.max(record.lockedUntil, record.lastFailedAt || 0);
    if (lastActivity > 0 && lastActivity < now - ATTEMPTS_TTL_MS) {
      loginAttempts.delete(key);
      changed = true;
    } else if (lastActivity === 0) {
      loginAttempts.delete(key);
      changed = true;
    }
  }
  if (changed) {
    saveLoginAttempts();
  }
}

function loadLoginAttempts(): void {
  try {
    const p = LOGIN_ATTEMPTS_FILE();
    if (!fs.existsSync(p)) return;
    const raw = fs.readFileSync(p, 'utf-8');
    const data = JSON.parse(raw) as LoginAttemptsStore;
    for (const [k, v] of Object.entries(data)) {
      if (v && typeof v.count === 'number' && typeof v.lockedUntil === 'number') {
        loginAttempts.set(k, v);
      }
    }
  } catch (e) {
    log.warn('加载登录尝试记录失败,使用内存状态:', String(e));
  }
}

function saveLoginAttempts(): void {
  try {
    const p = LOGIN_ATTEMPTS_FILE();
    const dir = pathMod.dirname(p);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const obj: LoginAttemptsStore = {};
    for (const [k, v] of loginAttempts.entries()) obj[k] = v;
    fs.writeFileSync(p, JSON.stringify(obj, null, 2), 'utf-8');
  } catch (e) {
    log.warn('保存登录尝试记录失败:', String(e));
  }
}

function checkRateLimit(username: string): { allowed: boolean; message?: string } {
  cleanupExpiredAttempts();
  const record = loginAttempts.get(username);
  if (record && record.lockedUntil > Date.now()) {
    const remaining = Math.ceil((record.lockedUntil - Date.now()) / 1000 / 60);
    return { allowed: false, message: `账号已被锁定，请 ${remaining} 分钟后重试` };
  }
  // 全局限流检查（基于本机累计失败，防用户名轮换攻击）
  const globalRecord = loginAttempts.get(GLOBAL_KEY);
  if (globalRecord && globalRecord.lockedUntil > Date.now()) {
    const remaining = Math.ceil((globalRecord.lockedUntil - Date.now()) / 1000 / 60);
    return { allowed: false, message: `失败尝试过多，请 ${remaining} 分钟后重试` };
  }
  return { allowed: true };
}

function recordFailedAttempt(username: string): void {
  const now = Date.now();
  const record = loginAttempts.get(username) || { count: 0, lockedUntil: 0 };
  record.count++;
  record.lastFailedAt = now;
  if (record.count >= MAX_ATTEMPTS) {
    record.lockedUntil = now + LOCK_MINUTES * 60 * 1000;
    record.count = 0;
  }
  loginAttempts.set(username, record);

  // 同步累加全局失败计数
  const globalRecord = loginAttempts.get(GLOBAL_KEY) || { count: 0, lockedUntil: 0 };
  globalRecord.count++;
  globalRecord.lastFailedAt = now;
  if (globalRecord.count >= GLOBAL_MAX_ATTEMPTS) {
    globalRecord.lockedUntil = now + GLOBAL_LOCK_MINUTES * 60 * 1000;
    globalRecord.count = 0;
  }
  loginAttempts.set(GLOBAL_KEY, globalRecord);

  saveLoginAttempts();
}

function clearAttempts(username: string): void {
  loginAttempts.delete(username);
  // 登录成功时重置全局计数（合法用户成功登录表明当前无攻击行为）
  loginAttempts.delete(GLOBAL_KEY);
  saveLoginAttempts();
}

loadLoginAttempts();

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

  ipcMain.handle('auth:validateSession', wrap(async (_event, token: string): Promise<{ valid: boolean; userId?: string; username?: string; user?: User }> => {
    const session = AuthService.getSession(token);
    if (!session) return { valid: false };
    const user = await AuthService.validateUser(session.username);
    if (!user || !user.isActive) {
      AuthService.destroySession(token);
      return { valid: false };
    }
    return { valid: true, userId: session.userId, username: session.username, user };
  }, 'auth'));

  ipcMain.handle('auth:encryptCredential', wrap(async (_event, plaintext: string) => {
    const { safeStorage } = await import('electron');
    try {
      const encrypted = await safeStorage.encryptString(plaintext);
      return { success: true, encrypted };
    } catch (err: any) {
      return { success: false, error: err.message || '加密失败' };
    }
  }, 'auth'));

  ipcMain.handle('auth:decryptCredential', wrap(async (_event, encrypted: string) => {
    const { safeStorage } = await import('electron');
    try {
      const decrypted = await safeStorage.decryptString(Buffer.from(encrypted));
      return { success: true, decrypted };
    } catch (err: any) {
      return { success: false, error: err.message || '解密失败' };
    }
  }, 'auth'));

  ipcMain.handle('auth:isEncryptionAvailable', wrap(async () => {
    const { safeStorage } = await import('electron');
    return { available: await safeStorage.isEncryptionAvailable() };
  }, 'auth'));
}
