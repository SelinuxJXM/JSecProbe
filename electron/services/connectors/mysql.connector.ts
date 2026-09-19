import mysql from 'mysql2/promise';
import type { ConnectionProfile } from '../../../shared/types';
import { decryptSecret } from '../credential.util';
import { logger as log } from '../../utils/logger';
import type { IConnector, ExecResult } from './connector';
import {
  parseExtraConfig,
  getCommandTimeout,
  withTimeout,
  formatRows,
  splitSqlStatements,
  assertReadonlySql,
  isTlsHandshakeError,
} from './db.util';

export class MySqlConnector implements IConnector {
  private conn: mysql.Connection | null = null;
  private commandTimeoutMs = 15000;

  async connect(profile: ConnectionProfile): Promise<void> {
    if (this.conn) return;
    const cfg = parseExtraConfig(profile.extraConfig);
    const password = decryptSecret(profile.passwordEncrypted);
    this.commandTimeoutMs = getCommandTimeout(profile);
    const baseConfig = {
      host: profile.host,
      port: profile.port || 3306,
      user: profile.username || undefined,
      password: password || undefined,
      database: cfg.database || undefined,
      connectTimeout: profile.timeoutMs || 10000,
    };
    // 传输安全：优先以 TLS 连接（rejectUnauthorized:false = 接受自签/内网证书）。
    // 原实现完全不启用 TLS，口令与查询结果明文过网。
    // 服务端不支持 TLS 时自动降级并告警，避免内网老库直接连不上。
    const useTls = cfg.ssl === undefined ? true : !!cfg.ssl;
    const tlsConfig = useTls ? { ssl: { rejectUnauthorized: cfg.rejectUnauthorized === true } } : {};
    let conn: mysql.Connection;
    try {
      conn = await mysql.createConnection({ ...baseConfig, ...tlsConfig });
    } catch (err) {
      if (useTls && isTlsHandshakeError(err)) {
        log.warn(`[MySQL] ${profile.host} 不支持 TLS，已降级为明文连接（凭据与结果将以明文传输）`);
        conn = await mysql.createConnection(baseConfig);
      } else {
        throw err;
      }
    }
    // mysql2 空闲期间服务端断连会在底层连接上 emit 'error'，无监听会打崩主进程；
    // 挂兜底监听防止进程级崩溃，连接错误交由后续 query 的异常捕获路径处理
    (conn as any).connection?.on?.('error', () => {});
    this.conn = conn;
  }

  async execute(cmd: string): Promise<ExecResult> {
    if (!this.conn) throw new Error('MySQL 连接未建立');
    const start = Date.now();
    try {
      const statements = splitSqlStatements(cmd);
      const outputs: string[] = [];
      for (const stmt of statements) {
        assertReadonlySql(stmt);
        const [rows] = await withTimeout(
          this.conn.query(stmt),
          this.commandTimeoutMs,
          'MySQL 命令执行超时'
        );
        outputs.push(formatRows(rows as unknown[]));
      }
      return { stdout: outputs.join('\n'), stderr: '', exitCode: 0, durationMs: Date.now() - start };
    } catch (err) {
      return {
        stdout: '',
        stderr: err instanceof Error ? err.message : String(err),
        exitCode: 1,
        durationMs: Date.now() - start,
      };
    }
  }

  async disconnect(): Promise<void> {
    if (this.conn) {
      try {
        await this.conn.end();
      } finally {
        this.conn = null;
      }
    }
  }

  async testConnection(profile: ConnectionProfile): Promise<boolean> {
    try {
      await this.connect(profile);
      await this.disconnect();
      return true;
    } catch {
      return false;
    }
  }
}