import mysql from 'mysql2/promise';
import type { ConnectionProfile } from '../../../shared/types';
import { decryptSecret } from '../credential.util';
import type { IConnector, ExecResult } from './connector';
import {
  parseExtraConfig,
  getCommandTimeout,
  withTimeout,
  formatRows,
  splitSqlStatements,
  assertReadonlySql,
} from './db.util';

export class MySqlConnector implements IConnector {
  private conn: mysql.Connection | null = null;
  private commandTimeoutMs = 15000;

  async connect(profile: ConnectionProfile): Promise<void> {
    if (this.conn) return;
    const cfg = parseExtraConfig(profile.extraConfig);
    const password = decryptSecret(profile.passwordEncrypted);
    this.commandTimeoutMs = getCommandTimeout(profile);
    const conn = await mysql.createConnection({
      host: profile.host,
      port: profile.port || 3306,
      user: profile.username || undefined,
      password: password || undefined,
      database: cfg.database || undefined,
      connectTimeout: profile.timeoutMs || 10000,
    });
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