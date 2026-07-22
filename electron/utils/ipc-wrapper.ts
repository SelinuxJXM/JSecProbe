import type { IpcMainInvokeEvent } from 'electron';
import logger from './logger';

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
}

export function wrap<TArgs extends unknown[], TReturn>(
  handler: IpcHandler<TArgs, TReturn>,
  options: WrapOptions | string = {}
) {
  const opts: WrapOptions = typeof options === 'string' ? { moduleName: options } : options;
  const { moduleName = 'ipc', logArgs = false, logResult = false, logDuration = true } = opts;

  return async (event: IpcMainInvokeEvent, ...args: TArgs): Promise<IpcResponse<TReturn>> => {
    const startTime = Date.now();
    try {
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
          details: err.stack,
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
  const { moduleName = 'ipc', logArgs = false } = opts;

  return async (event: IpcMainInvokeEvent, ...args: TArgs): Promise<TReturn> => {
    try {
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
