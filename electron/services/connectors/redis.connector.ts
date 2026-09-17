import Redis from 'ioredis';
import type { ConnectionProfile } from '../../../shared/types';
import { decryptSecret } from '../credential.util';
import type { IConnector, ExecResult } from './connector';
import {
  parseExtraConfig,
  getCommandTimeout,
  withTimeout,
  splitRedisCommands,
  assertReadonlyRedis,
  formatRedisReply,
} from './db.util';

export class RedisConnector implements IConnector {
  private client: Redis | null = null;
  private commandTimeoutMs = 15000;

  async connect(profile: ConnectionProfile): Promise<void> {
    if (this.client) return;
    const cfg = parseExtraConfig(profile.extraConfig);
    const password = decryptSecret(profile.passwordEncrypted);
    this.commandTimeoutMs = getCommandTimeout(profile);
    const client = new Redis({
      host: profile.host,
      port: profile.port || 6379,
      password: password || undefined,
      db: cfg.database !== undefined ? Number(cfg.database) || 0 : 0,
      connectTimeout: profile.timeoutMs || 10000,
      commandTimeout: this.commandTimeoutMs,
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      enableReadyCheck: true,
    });
    await client.connect();
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