/**
 * IPC Renderer Utilities
 * 封装 IPC 调用，提供统一的错误处理和响应格式
 */

type IpcResponse<T> = {
  success: boolean;
  data?: T;
  error?: { code: string; message: string };
};

/**
 * 调用 IPC 并返回响应
 */
export async function ipcCall<T>(channel: string, ...args: any[]): Promise<IpcResponse<T>> {
  try {
    const api = window.api as any;
    const result = await api[channel]?.(...args);
    if (!result) {
      return { success: false, error: { code: 'CHANNEL_ERROR', message: `IPC channel ${channel} not found` } };
    }
    return result as IpcResponse<T>;
  } catch (error: any) {
    return {
      success: false,
      error: {
        code: error.code || 'IPC_ERROR',
        message: error.message || 'IPC调用失败',
      },
    };
  }
}

/**
 * 调用 IPC 并直接返回数据，失败时抛出错误
 */
export async function ipcCallOrThrow<T>(channel: string, ...args: any[]): Promise<T> {
  const result = await ipcCall<T>(channel, ...args);
  if (!result.success) {
    throw new Error(result.error?.message || '调用失败');
  }
  return result.data!;
}

/**
 * 批量调用 IPC（串行）
 */
export async function ipcBatch<T>(calls: Array<{ channel: string; args: any[] }>): Promise<IpcResponse<T>[]> {
  const results: IpcResponse<T>[] = [];
  for (const call of calls) {
    const result = await ipcCall<T>(call.channel, ...call.args);
    results.push(result);
  }
  return results;
}

/**
 * 带重试的 IPC 调用
 */
export async function ipcCallWithRetry<T>(channel: string, args: any[], maxRetries = 3, delayMs = 1000): Promise<IpcResponse<T>> {
  for (let i = 0; i < maxRetries; i++) {
    const result = await ipcCall<T>(channel, ...args);
    if (result.success) {
      return result;
    }
    if (i < maxRetries - 1) {
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }
  return { success: false, error: { code: 'RETRY_EXHAUSTED', message: `重试 ${maxRetries} 次后仍失败` } };
}