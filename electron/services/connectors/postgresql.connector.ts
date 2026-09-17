import { Client } from 'pg';
import type { ConnectionProfile } from '../../../shared/types';
import { decryptSecret } from '../credential.util';
import type { IConnector, ExecResult } from './connector';
import {
  parseExtraConfig,
  getCommandTimeout,
  formatRows,
  splitSqlStatements,
  assertReadonlySql,
} from './db.util';

export class PostgresqlConnector implements IConnector {
  private client: Client | null = null;
  private commandTimeoutMs = 15000;

  async connect(profile: ConnectionProfile): Promise<void> {
    if (this.client) return;
    const cfg = parseExtraConfig(profile.extraConfig);
    const password = decryptSecret(profile.passwordEncrypted);
    this.commandTimeoutMs = getCommandTimeout(profile);
    const client = new Client({
      host: profile.host,
      port: profile.port || 5432,
      user: profile.username || undefined,
      password: password || undefined,
      database: cfg.database || 'postgres',
      connectionTimeoutMillis: profile.timeoutMs || 10000,
      query_timeout: this.commandTimeoutMs,
      statement_timeout: this.commandTimeoutMs,
    });
    await client.connect();
    this.client = client;
  }

  async execute(cmd: string): Promise<ExecResult> {
    if (!this.client) throw new Error('PostgreSQL 连接未建立');
    const start = Date.now();
    try {
      const statements = splitSqlStatements(cmd);
      const outputs: string[] = [];
      for (const stmt of statements) {
        assertReadonlySql(stmt);
        const res = await this.client.query(stmt);
        outputs.push(formatRows(res.rows as unknown[]));
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
    if (this.client) {
      try {
        await this.client.end();
      } finally {
        this.client = null;
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