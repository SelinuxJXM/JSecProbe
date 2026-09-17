import oracledb from 'oracledb';
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

export class OracleConnector implements IConnector {
  private conn: oracledb.Connection | null = null;
  private commandTimeoutMs = 15000;

  async connect(profile: ConnectionProfile): Promise<void> {
    if (this.conn) return;
    const cfg = parseExtraConfig(profile.extraConfig);
    const password = decryptSecret(profile.passwordEncrypted);
    this.commandTimeoutMs = getCommandTimeout(profile);
    const connectString = `${profile.host}:${profile.port || 1521}/${cfg.database || 'ORCL'}`;
    const conn = await withTimeout(
      oracledb.getConnection({
        user: profile.username || undefined,
        password: password || undefined,
        connectString,
        connectTimeout: profile.timeoutMs || 10000,
      }),
      profile.timeoutMs || 10000,
      'Oracle 连接超时'
    );
    this.conn = conn;
  }

  async execute(cmd: string): Promise<ExecResult> {
    if (!this.conn) throw new Error('Oracle 连接未建立');
    const start = Date.now();
    try {
      const statements = splitSqlStatements(cmd);
      const outputs: string[] = [];
      for (const stmt of statements) {
        assertReadonlySql(stmt);
        const result = await withTimeout(this.conn.execute(stmt), this.commandTimeoutMs, 'Oracle 命令执行超时');
        const rows: Array<Record<string, unknown>> = (result.rows || []).map((r) => {
          const row = (r ?? []) as Array<unknown>;
          const obj: Record<string, unknown> = {};
          (result.metaData || []).forEach((col, idx) => {
            obj[col.name] = row[idx] ?? null;
          });
          return obj;
        });
        outputs.push(formatRows(rows));
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
        await this.conn.close();
      } finally {
        this.conn = null;
      }
    }
  }

  async testConnection(profile: ConnectionProfile): Promise<boolean> {
    try {
      await this.connect(profile);
      const res = await this.conn!.execute('SELECT 1 FROM DUAL');
      const ok = Array.isArray(res.rows) && res.rows.length > 0;
      await this.disconnect();
      return ok;
    } catch {
      return false;
    }
  }
}