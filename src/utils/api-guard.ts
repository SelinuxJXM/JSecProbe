/**
 * API Guard Utility
 * 安全调用 window.api，避免在浏览器环境中报错
 */

/**
 * 检查是否在 Electron 环境中运行
 */
export function isElectron(): boolean {
  return typeof window !== 'undefined' && !!window.api;
}

/**
 * 安全调用 API 方法
 * @param method - API 方法名
 * @param args - 参数
 * @returns API 调用结果或错误信息
 */
export async function safeApiCall<T>(method: string, ...args: any[]): Promise<{ success: boolean; data?: T; message?: string }> {
  if (!isElectron()) {
    return {
      success: false,
      message: '应用未初始化，请在 Electron 环境中运行',
    };
  }

  try {
    const api = window.api as any;
    const result = await api[method]?.(...args);
    return result || { success: false, message: 'API 调用失败' };
  } catch (error: any) {
    return {
      success: false,
      message: error.message || 'API 调用失败',
    };
  }
}

/**
 * 获取 API 实例（如果可用）
 */
export function getApi(): any | null {
  return isElectron() ? window.api : null;
}