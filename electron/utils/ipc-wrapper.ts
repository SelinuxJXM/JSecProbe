import { app, type IpcMainInvokeEvent } from 'electron';
import logger from './logger';
import { requireAuth, requireSession } from './auth-guard';

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
  /** 是否强制已登录会话（敏感操作开启，默认关闭以免破坏既有流程） */
  requireSession?: boolean;
}

export function wrap<TArgs extends unknown[], TReturn>(
  handler: IpcHandler<TArgs, TReturn>,
  options: WrapOptions | string = {}
) {
  const opts: WrapOptions = typeof options === 'string' ? { moduleName: options } : options;
  const {
    moduleName = 'ipc',
    logArgs = false,
    logResult = false,
    logDuration = true,
    requireAuth: needAuth = true,
    requireSession: needSession = false,
  } = opts;

  return async (event: IpcMainInvokeEvent, ...args: TArgs): Promise<IpcResponse<TReturn>> => {
    const startTime = Date.now();
    try {
      if (needAuth) {
        requireAuth(event);
      }
      if (needSession) {
        // 敏感操作：在来源校验之外再强制已登录会话（单用户桌面应用走进程级活动会话判定）
        requireSession(event);
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
  const opts: WrapOptions = typeof options === 'string' ? { moduleName: options } : options;
  const {
    moduleName = 'ipc',
    logArgs = false,
    requireAuth: needAuth = true,
    requireSession: needSession = false,
  } = opts;

  return async (event: IpcMainInvokeEvent, ...args: TArgs): Promise<TReturn> => {
    try {
      if (needAuth) {
        requireAuth(event);
      }
      if (needSession) {
        requireSession(event);
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
