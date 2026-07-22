import log from 'electron-log';

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

  static getInstance(): AppLogger {
    if (!AppLogger.instance) {
      AppLogger.instance = new AppLogger();
    }
    return AppLogger.instance;
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
