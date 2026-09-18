import { Client, type ClientChannel, type ConnectConfig } from 'ssh2';
import * as fs from 'fs';
import type { ConnectionProfile } from '../../../shared/types';
import { decryptSecret } from '../credential.util';
import { getCommandTimeout } from './db.util';
import { CommandTimeoutError, type IConnector, type ExecResult } from './connector';

export class SshConnector implements IConnector {
  private client: Client | null = null;
  private commandTimeoutMs = 15000;

  async connect(profile: ConnectionProfile): Promise<void> {
    if (this.client) return;
    const cfg: ConnectConfig = {
      host: profile.host,
      port: profile.port || 22,
      username: profile.username || undefined,
      readyTimeout: profile.timeoutMs || 10000,
    };
    if (profile.authMethod === 'privateKey' && profile.privateKeyPath) {
      cfg.privateKey = await fs.promises.readFile(profile.privateKeyPath, 'utf8');
    } else {
      cfg.password = decryptSecret(profile.passwordEncrypted);
    }
    this.commandTimeoutMs = getCommandTimeout(profile);
    await new Promise<void>((resolve, reject) => {
      const client = new Client();
      let settled = false;
      client.on('ready', () => {
        if (settled) return;
        settled = true;
        this.client = client;
        resolve();
      });
      // 连接失败时必须显式关掉这个 Client，否则它会被遗弃（this.client 仍为 null，
      // disconnect() 无从回收），底层 socket 继续重试解析 DNS，重复失败会不断累积泄漏的连接。
      client.on('error', (e) => {
        if (settled) return;
        settled = true;
        try {
          client.end();
        } catch {
          // 忽略关闭异常
        }
        reject(e);
      });
      client.connect(cfg);
    });
  }

  async execute(cmd: string): Promise<ExecResult> {
    if (!this.client) throw new Error('SSH 连接未建立');
    return new Promise((resolve, reject) => {
      const start = Date.now();
      let settled = false;
      let streamRef: ClientChannel | null = null;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        try {
          streamRef?.close();
        } catch {
          // 忽略关闭异常
        }
        try {
          this.client?.end();
        } catch {
          // 忽略连接关闭异常
        }
        reject(new CommandTimeoutError('SSH 命令执行超时'));
      }, this.commandTimeoutMs);

      this.client!.exec(cmd, (err, stream) => {
        if (err) {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          reject(err);
          return;
        }
        streamRef = stream;
        let stdout = '';
        let stderr = '';
        stream.on('close', (code: number) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve({ stdout, stderr, exitCode: code, durationMs: Date.now() - start });
        });
        stream.on('data', (d: Buffer) => {
          stdout += d.toString();
        });
        stream.stderr.on('data', (d: Buffer) => {
          stderr += d.toString();
        });
        stream.on('error', (e: Error) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          reject(e);
        });
      });
    });
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      this.client.end();
      this.client = null;
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