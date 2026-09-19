import { Client } from 'pg';
import type { ConnectionProfile } from '../../../shared/types';
import { decryptSecret } from '../credential.util';
import { logger as log } from '../../utils/logger';
import type { IConnector, ExecResult } from './connector';
import {
  parseExtraConfig,
  getCommandTimeout,
  formatRows,
  splitSqlStatements,
  assertReadonlySql,
  isTlsHandshakeError,
} from './db.util';

/** 构造 pg 客户端（含 TLS 选项），失败时由调用方决定是否降级 */
function createPgClient(profile: ConnectionProfile, cfg: ReturnType<typeof parseExtraConfig>, password: string, commandTimeoutMs: number, useTls: boolean): Client {
  const client = new Client({
    host: profile.host,
    port: profile.port || 5432,
    user: profile.username || undefined,
    password: password || undefined,
    database: cfg.database || 'postgres',
    connectionTimeoutMillis: profile.timeoutMs || 10000,
    query_timeout: commandTimeoutMs,
    statement_timeout: commandTimeoutMs,
    // 传输安全：优先 TLS（rejectUnauthorized:false = 接受自签/内网证书）。
    // 原实现完全不启用 ssl，口令与查询结果明文过网。
    ...(useTls ? { ssl: { rejectUnauthorized: cfg.rejectUnauthorized === true } } : {}),
  });
  // 连接存活期间服务端断连/网络中断会在 client 上 emit 'error'；
  // 不挂监听会成为未捕获异常直接打崩主进程（uncaughtException → 应用退出）。
  // 连接级错误交由后续 query 的异常捕获路径处理，这里仅需兜底防崩。
  client.on('error', () => {});
  return client;
}

export class PostgresqlConnector implements IConnector {
  private client: Client | null = null;
  private commandTimeoutMs = 15000;

  async connect(profile: ConnectionProfile): Promise<void> {
    if (this.client) return;
    const cfg = parseExtraConfig(profile.extraConfig);
    const password = decryptSecret(profile.passwordEncrypted);
    this.commandTimeoutMs = getCommandTimeout(profile);
    const useTls = cfg.ssl === undefined ? true : !!cfg.ssl;
    const client = createPgClient(profile, cfg, password, this.commandTimeoutMs, useTls);
    try {
      await client.connect();
    } catch (err) {
      if (useTls && isTlsHandshakeError(err)) {
        log.warn(`[PostgreSQL] ${profile.host} 不支持 TLS，已降级为明文连接（凭据与结果将以明文传输）`);
        const fallback = createPgClient(profile, cfg, password, this.commandTimeoutMs, false);
        await fallback.connect();
        this.client = fallback;
        return;
      }
      throw err;
    }
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