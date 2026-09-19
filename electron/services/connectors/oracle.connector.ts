import oracledb from 'oracledb';
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

export class OracleConnector implements IConnector {
  private conn: oracledb.Connection | null = null;
  private commandTimeoutMs = 15000;

  async connect(profile: ConnectionProfile): Promise<void> {
    if (this.conn) return;
    const cfg = parseExtraConfig(profile.extraConfig);
    const password = decryptSecret(profile.passwordEncrypted);
    this.commandTimeoutMs = getCommandTimeout(profile);
    const port = profile.port || 1521;
    const service = cfg.database || cfg.serviceName || 'ORCL';
    // 传输安全：对齐 MySQL / PostgreSQL / Redis 的「优先加密、服务端不支持时降级」策略。
    // 原实现默认走明文 TCP，口令与查询结果明文过网。
    // Oracle 的 TCPS 需要服务端监听已配置 SSL/TLS，内网老库普遍没有，因此保留降级，
    // 但必须告警留痕。可用 extraConfig 显式控制：{"tcps": true|false}。
    const tcpsConnectString =
      `(DESCRIPTION=(ADDRESS=(PROTOCOL=TCPS)(HOST=${profile.host})(PORT=${port}))(CONNECT_DATA=(SERVICE_NAME=${service})))`;
    const tcpConnectString = `${profile.host}:${port}/${service}`;

    const doConnect = (connectString: string, timeoutMs: number) =>
      withTimeout(
        oracledb.getConnection({
          user: profile.username || undefined,
          password: password || undefined,
          connectString,
          connectTimeout: timeoutMs,
        }),
        timeoutMs,
        'Oracle 连接超时'
      );

    const fullTimeout = profile.timeoutMs || 10000;
    // 显式关闭时才完全跳过 TCPS 尝试；否则先试加密链路
    if (cfg.tcps !== false) {
      // 首次尝试给一个较短的超时，避免不支持 TCPS 的实例把连接耗时拖到两倍
      const probeTimeout = Math.min(fullTimeout, 5000);
      try {
        this.conn = await doConnect(tcpsConnectString, probeTimeout);
        return;
      } catch (err) {
        // 显式要求 TCPS 时不降级，直接失败（用户已明确声明该实例支持加密）
        if (cfg.tcps === true) throw err;
        if (!isTlsHandshakeError(err)) {
          // 非加密握手类错误（口令错误、服务名不存在等）直接抛出，不误导为 TLS 问题
          throw err;
        }
        log.warn(
          `[Oracle] ${profile.host}:${port} 不支持 TCPS，已降级为明文连接（口令与查询结果将以明文传输）；` +
          `如需强制加密请在服务端配置 SSL/TLS 监听`
        );
      }
    } else {
      log.warn(
        `[Oracle] ${profile.host}:${port} 已按 {"tcps": false} 使用明文连接，口令与查询结果将以明文传输`
      );
    }
    this.conn = await doConnect(tcpConnectString, fullTimeout);
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