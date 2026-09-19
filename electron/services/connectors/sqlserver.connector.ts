import sql from 'mssql';
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
} from './db.util';

export class SqlServerConnector implements IConnector {
  private pool: sql.ConnectionPool | null = null;
  private commandTimeoutMs = 15000;

  async connect(profile: ConnectionProfile): Promise<void> {
    if (this.pool) return;
    const cfg = parseExtraConfig(profile.extraConfig);
    const password = decryptSecret(profile.passwordEncrypted);
    this.commandTimeoutMs = getCommandTimeout(profile);
    // 传输安全：默认开启 TDS 加密（encrypt:true + trustServerCertificate:true
    // = 加密传输但接受自签证书）。原实现硬编码 encrypt:false，
    // 凭据与核查结果在链路上完全明文，对测评工具属致命缺陷。
    // 内网老版本 SQL Server 不支持加密时，可在连接配置的 extraConfig 中显式
    // 设置 {"encrypt": false} 回退，此时会打印告警留痕。
    const encrypt = cfg.encrypt === undefined ? true : !!cfg.encrypt;
    const trustCert = cfg.trustServerCertificate === undefined ? true : !!cfg.trustServerCertificate;
    if (!encrypt) {
      log.warn(`[SQLServer] ${profile.host} 已显式关闭传输加密，凭据与查询结果将明文传输`);
    }
    const config: sql.config = {
      server: profile.host,
      port: profile.port || 1433,
      user: profile.username || undefined,
      password: password || undefined,
      database: cfg.database || 'master',
      options: {
        encrypt,
        trustServerCertificate: trustCert,
        instanceName: cfg.instance || undefined,
        requestTimeout: this.commandTimeoutMs,
        connectTimeout: profile.timeoutMs || 10000,
      },
      pool: {
        max: 1,
        min: 0,
        idleTimeoutMillis: 30000,
      },
    };
    const pool = new sql.ConnectionPool(config);
    // 连接池空闲期间服务端断连会在 pool 上 emit 'error'，无监听会打崩主进程；
    // 挂兜底监听防止进程级崩溃，连接错误交由后续 query 的异常捕获路径处理
    pool.on('error', () => {});
    await pool.connect();
    this.pool = pool;
  }

  async execute(cmd: string): Promise<ExecResult> {
    if (!this.pool) throw new Error('SQL Server 连接未建立');
    const start = Date.now();
    try {
      const statements = splitSqlStatements(cmd);
      const outputs: string[] = [];
      for (const stmt of statements) {
        assertReadonlySql(stmt);
        const result = await this.pool.request().query(stmt);
        outputs.push(formatRows(result.recordset as unknown[]));
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
    if (this.pool) {
      try {
        await this.pool.close();
      } finally {
        this.pool = null;
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