import type { IpcMainInvokeEvent } from 'electron';
import log from 'electron-log';

export interface IpcResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
}

type IpcHandler<T = unknown> = (event: IpcMainInvokeEvent, ...args: any[]) => T | Promise<T>;

export function wrap<T>(handler: IpcHandler<T>, moduleName: string = 'ipc') {
  return async (event: IpcMainInvokeEvent, ...args: any[]) => {
    try {
      const data = await handler(event, ...args);
      return { success: true, data } as IpcResponse<T>;
    } catch (error: any) {
      log.error(`[${moduleName}] IPC Error:`, error);
      return {
        success: false,
        error: {
          code: error.code || 'INTERNAL_ERROR',
          message: error.message || '操作失败',
        },
      } as IpcResponse<T>;
    }
  };
}