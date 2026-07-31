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

  private serializeContext(context: LogContext): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(context)) {
      if (key === 'stack') {
        result[key] = typeof value === 'string' ? value : String(value);
      } else if (typeof value !== 'function' && typeof value !== 'symbol') {
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
