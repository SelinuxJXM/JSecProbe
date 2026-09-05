import log from 'electron-log';
import type { WebContents } from 'electron';

export type LogLevel = 'info' | 'warn' | 'error' | 'debug';

export interface LogContext {
  module?: string;
  userId?: string;
  projectId?: string;
  duration?: number;
  [key: string]: unknown;
}

class AppLogger {
  private static instance: AppLogger;
  private isProduction: boolean = false;
  private targetWebContents: WebContents | null = null;

  static getInstance(): AppLogger {
    if (!AppLogger.instance) {
      AppLogger.instance = new AppLogger();
    }
    return AppLogger.instance;
  }

  /**
   * 设置目标窗口，用于将日志转发到 DevTools Console
   */
  setTargetWindow(contents: WebContents | null): void {
    this.targetWebContents = contents;
  }

  setProductionMode(isProd: boolean): void {
    this.isProduction = isProd;
    log.transports.file.level = isProd ? 'info' : 'debug';
    log.transports.console.level = isProd ? 'warn' : 'debug';
  }

  info(message: string, context?: LogContext): void {
    this.log('info', message, context);
  }

  warn(message: string, context?: LogContext): void {
    this.log('warn', message, context);
  }

  error(message: string, context?: LogContext): void {
    this.log('error', message, context);
  }

  debug(message: string, context?: LogContext): void {
    if (!this.isProduction) {
      this.log('debug', message, context);
    }
  }

  ipcInfo(channel: string, context?: LogContext): void {
    this.info(`[IPC] ${channel}`, context);
  }

  ipcError(channel: string, error: unknown, context?: LogContext): void {
    const message = error instanceof Error ? error.message : String(error);
    this.error(`[IPC] ${channel} 失败: ${message}`, {
      ...context,
      stack: error instanceof Error ? error.stack : undefined,
    });
  }

  dbInfo(operation: string, context?: LogContext): void {
    this.info(`[DB] ${operation}`, context);
  }

  dbError(operation: string, error: unknown, context?: LogContext): void {
    const message = error instanceof Error ? error.message : String(error);
    this.error(`[DB] ${operation} 失败: ${message}`, {
      ...context,
      stack: error instanceof Error ? error.stack : undefined,
    });
  }

  serviceInfo(service: string, message: string, context?: LogContext): void {
    this.info(`[${service}] ${message}`, context);
  }

  serviceError(service: string, message: string, error: unknown, context?: LogContext): void {
    const detail = error instanceof Error ? error.message : String(error);
    this.error(`[${service}] ${message}: ${detail}`, {
      ...context,
      stack: error instanceof Error ? error.stack : undefined,
    });
  }

  private forwardToDevTools(level: LogLevel, message: string, context?: LogContext): void {
    if (!this.targetWebContents || this.isProduction) return;

    try {
      this.targetWebContents.send('main-process-log', {
        level,
        message,
        timestamp: new Date().toISOString(),
        context: context ? this.serializeContext(context) : undefined,
      });
    } catch {
      // 静默忽略转发失败
    }
  }

  // 敏感字段脱敏：键名匹配 password/token/secret/hash/key/apiKey 等的字段一律替换为 ***
  // 防止密码、会话令牌、API 凭证等敏感信息写入 electron-log 文件日志
  private static readonly SENSITIVE_KEY_REGEX = /^(password|passwordHash|token|secret|apiKey|api_key|authorization|cookie|sessionId|refreshToken|privateKey)$/i;
  private static readonly SENSITIVE_KEY_HINT_REGEX = /password|token|secret|hash|apiKey|api_key|authorization|privateKey/i;

  private static maskValue(value: unknown): unknown {
    if (typeof value === 'string') {
      // 字符串值：保留前后 2 字符用于排查，中间脱敏（短串全脱敏）
      if (value.length <= 6) return '***';
      return `${value.slice(0, 2)}***${value.slice(-2)}`;
    }
    if (Array.isArray(value)) {
      return value.map(v => AppLogger.maskValue(v));
    }
    if (value && typeof value === 'object') {
      // 对象：递归脱敏
      try {
        const masked: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
          masked[k] = AppLogger.maskValue(v);
        }
        return masked;
      } catch {
        return '***';
      }
    }
    return '***';
  }

  private serializeContext(context: LogContext): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(context)) {
      if (key === 'stack') {
        result[key] = typeof value === 'string' ? value : String(value);
      } else if (typeof value !== 'function' && typeof value !== 'symbol') {
        // 敏感字段脱敏：精确匹配 passwordHash/token 等或键名包含敏感词
        if (
          AppLogger.SENSITIVE_KEY_REGEX.test(key) ||
          AppLogger.SENSITIVE_KEY_HINT_REGEX.test(key)
        ) {
          result[key] = AppLogger.maskValue(value);
          continue;
        }
        try {
          // 尝试序列化，避免循环引用
          JSON.stringify(value);
          result[key] = value;
        } catch {
          result[key] = '[Unserializable]';
        }
      }
    }
    return result;
  }

  private log(level: LogLevel, message: string, context?: LogContext): void {
    const parts: string[] = [];

    if (context?.module) {
      parts.push(`[${context.module}]`);
    }
    if (context?.duration !== undefined) {
      parts.push(`(${context.duration}ms)`);
    }

    const prefix = parts.length > 0 ? parts.join(' ') + ' ' : '';

    const logMessage = `${prefix}${message}`;

    // 转发到 DevTools Console（仅开发模式）
    this.forwardToDevTools(level, logMessage, context);

    if (context && Object.keys(context).filter(k => !['module', 'duration'].includes(k)).length > 0) {
      const { module: _m, duration: _d, ...extra } = context;
      if (Object.keys(extra).length > 0) {
        log[level](logMessage, extra);
        return;
      }
    }

    log[level](logMessage);
  }
}

export const logger = AppLogger.getInstance();
export default logger;
