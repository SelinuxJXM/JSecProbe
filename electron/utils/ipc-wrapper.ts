import { app, type IpcMainInvokeEvent } from 'electron';
import logger from './logger';
import { requireAuth, requireSession, requireRole, requirePasswordChanged } from './auth-guard';

/**
 * 强制改密检查的放行模块。
 * - `auth`：改密流程本身（auth:changePassword / auth:login），拦了就无法改密，自锁死
 * - `window`：窗口最小化/最大化/关闭，属于壳层操作，不属于业务数据访问
 */
const PASSWORD_CHANGE_EXEMPT_MODULES = new Set(['auth', 'window']);

export type { IpcMainInvokeEvent };

export interface IpcResponse<T = unknown> {
  success: boolean;
  data?: T;
  error: {
    code: string;
    message: string;
    details?: unknown;
  } | null;
}

type IpcHandler<TArgs extends unknown[], TReturn> = (
  event: IpcMainInvokeEvent,
  ...args: TArgs
) => Promise<TReturn> | TReturn;

interface WrapOptions {
  moduleName?: string;
  logArgs?: boolean;
  logResult?: boolean;
  logDuration?: boolean;
  requireAuth?: boolean;
  /**
   * 是否强制已登录会话。
   * 默认 **开启**：除登录/会话恢复/加解密凭据等必须在登录前可用的通道外，
   * 所有业务通道都应要求会话，避免未登录状态下读写测评数据。
   * 需要放开时显式传 requireSession: false 并注明原因。
   */
  requireSession?: boolean;
  /** 允许执行该操作的角色列表（如 ['admin']）；设置后会同时强制会话校验 */
  requireRole?: string[];
}

/**
 * 解析 wrap 选项。requireSession 默认取反为 true（安全默认），
 * 仅在显式关闭或属于"登录前必须可用"的白名单通道时放行。
 */
function resolveOptions(options: WrapOptions | string): Required<Omit<WrapOptions, 'requireRole'>> & Pick<WrapOptions, 'requireRole'> {
  const opts: WrapOptions = typeof options === 'string' ? { moduleName: options } : options;
  return {
    moduleName: opts.moduleName ?? 'ipc',
    logArgs: opts.logArgs ?? false,
    logResult: opts.logResult ?? false,
    logDuration: opts.logDuration ?? true,
    requireAuth: opts.requireAuth ?? true,
    requireSession: opts.requireSession ?? true,
    requireRole: opts.requireRole,
  };
}

export function wrap<TArgs extends unknown[], TReturn>(
  handler: IpcHandler<TArgs, TReturn>,
  options: WrapOptions | string = {}
) {
  const {
    moduleName,
    logArgs,
    logResult,
    logDuration,
    requireAuth: needAuth,
    requireSession: needSession,
    requireRole: allowedRoles,
  } = resolveOptions(options);

  return async (event: IpcMainInvokeEvent, ...args: TArgs): Promise<IpcResponse<TReturn>> => {
    const startTime = Date.now();
    try {
      if (needAuth) {
        requireAuth(event);
      }
      // 角色校验隐含会话校验：requireRole 内部会先执行 requireSession
      if (allowedRoles && allowedRoles.length > 0) {
        await requireRole(event, allowedRoles);
      } else if (needSession) {
        // 敏感操作：在来源校验之外再强制已登录会话（单用户桌面应用走进程级活动会话判定）
        requireSession(event);
      }
      // 服务端强制改密（E2）：使用初始口令的用户只能调用改密相关通道
      if (needSession && !PASSWORD_CHANGE_EXEMPT_MODULES.has(moduleName)) {
        requirePasswordChanged(event);
      }
      if (logArgs) {
        logger.debug(`[${moduleName}] Called`, { args });
      }
      const data = await handler(event, ...args);
      if (logDuration || logResult) {
        logger.ipcInfo(`[${moduleName}] completed`, {
          module: moduleName,
          duration: Date.now() - startTime,
        });
      }
      return { success: true, data, error: null };
    } catch (error: unknown) {
      const err = error instanceof Error ? error : new Error(String(error));
      logger.ipcError(`[${moduleName}]`, error, {
        module: moduleName,
        duration: Date.now() - startTime,
      });
      return {
        success: false,
        data: undefined,
        error: {
          code: (error as NodeJS.ErrnoException)?.code || 'INTERNAL_ERROR',
          message: err.message || '操作失败',
          details: app.isPackaged ? undefined : err.stack,
        },
      };
    }
  };
}

export function wrapRaw<TArgs extends unknown[], TReturn>(
  handler: IpcHandler<TArgs, TReturn>,
  options: WrapOptions | string = {}
) {
  const {
    moduleName,
    logArgs,
    requireAuth: needAuth,
    requireSession: needSession,
    requireRole: allowedRoles,
  } = resolveOptions(options);

  return async (event: IpcMainInvokeEvent, ...args: TArgs): Promise<TReturn> => {
    try {
      if (needAuth) {
        requireAuth(event);
      }
      if (allowedRoles && allowedRoles.length > 0) {
        await requireRole(event, allowedRoles);
      } else if (needSession) {
        requireSession(event);
      }
      // 服务端强制改密（E2）：与 wrap 保持同一套判定
      if (needSession && !PASSWORD_CHANGE_EXEMPT_MODULES.has(moduleName)) {
        requirePasswordChanged(event);
      }
      if (logArgs) {
        logger.debug(`[${moduleName}] Called`, { args });
      }
      return await handler(event, ...args);
    } catch (error: unknown) {
      const err = error instanceof Error ? error : new Error(String(error));
      logger.error(`[${moduleName}] Raw IPC Error:`, { module: moduleName });
      throw err;
    }
  };
}
