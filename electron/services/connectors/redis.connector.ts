import Redis from 'ioredis';
import type { ConnectionProfile } from '../../../shared/types';
import { decryptSecret } from '../credential.util';
import { logger as log } from '../../utils/logger';
import type { IConnector, ExecResult } from './connector';
import {
  parseExtraConfig,
  getCommandTimeout,
  withTimeout,
  splitRedisCommands,
  assertReadonlyRedis,
  formatRedisReply,
  isTlsHandshakeError,
} from './db.util';

export class RedisConnector implements IConnector {
  private client: Redis | null = null;
  private commandTimeoutMs = 15000;

  async connect(profile: ConnectionProfile): Promise<void> {
    if (this.client) return;
    const cfg = parseExtraConfig(profile.extraConfig);
    const password = decryptSecret(profile.passwordEncrypted);
    this.commandTimeoutMs = getCommandTimeout(profile);
    // 传输安全：对齐 MySQL / PostgreSQL 的「优先 TLS、服务端不支持时降级明文」策略。
    // 原实现默认走明文（仅 6380 端口才启用 TLS），AUTH 口令与查询结果明文过网。
    // 内网老实例普遍不支持 TLS，强制 TLS 会让核查功能直接不可用，因此保留降级，
    // 但必须告警留痕。可用 extraConfig 显式控制：{"tls": true|false}。
    const port = profile.port || 6379;
    const useTls = cfg.tls === undefined ? true : !!cfg.tls;
    const baseOptions = {
      host: profile.host,
      port,
      password: password || undefined,
      db: cfg.database !== undefined ? Number(cfg.database) || 0 : 0,
      connectTimeout: profile.timeoutMs || 10000,
      commandTimeout: this.commandTimeoutMs,
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      enableReadyCheck: true,
    };
    const tlsOptions = useTls
      ? { tls: { rejectUnauthorized: cfg.rejectUnauthorized === true } as any }
      : {};

    const client = new Redis({ ...baseOptions, ...tlsOptions });
    try {
      await client.connect();
    } catch (err) {
      if (useTls && isTlsHandshakeError(err)) {
        log.warn(
          `[Redis] ${profile.host}:${port} 不支持 TLS，已降级为明文连接（AUTH 口令与查询结果将以明文传输）`
        );
        client.disconnect();
        const plainClient = new Redis(baseOptions);
        try {
          await plainClient.connect();
        } catch (plainErr) {
          plainClient.disconnect();
          // 降级后仍失败：抛明文连接的错误，它更贴近真实原因（口令错误/端口不通等）
          throw plainErr;
        }
        this.client = plainClient;
        return;
      }
      client.disconnect();
      throw err;
    }
    this.client = client;
  }

  async execute(cmd: string): Promise<ExecResult> {
    if (!this.client) throw new Error('Redis 连接未建立');
    const start = Date.now();
    try {
      const commands = splitRedisCommands(cmd);
      const outputs: string[] = [];
      for (const raw of commands) {
        assertReadonlyRedis(raw);
        const parts = raw.split(/\s+/).filter(Boolean);
        const reply = await withTimeout(
          this.client.call(parts[0], ...parts.slice(1)),
          this.commandTimeoutMs,
          'Redis 命令执行超时'
        );
        outputs.push(formatRedisReply(reply));
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
        this.client.disconnect();
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