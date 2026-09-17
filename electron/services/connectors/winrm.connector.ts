import { Shell, Command } from 'winrm-client';
import type { ConnectionProfile } from '../../../shared/types';
import { decryptSecret } from '../credential.util';
import { CommandTimeoutError, type IConnector, type ExecResult } from './connector';
import { parseExtraConfig, getCommandTimeout } from './db.util';

type WinRmAuthMethod = 'basic' | 'ntlm';

interface WinRmConnectionParams {
  host: string;
  port: number;
  path: string;
  username: string;
  password: string;
  authMethod: WinRmAuthMethod;
  useHttps: boolean;
  rejectUnauthorized: boolean;
  shellId?: string;
  commandId?: string;
  httpTimeout?: number;
}

function detectAuthMethod(username: string): WinRmAuthMethod {
  return username.includes('\\') || username.includes('@') ? 'ntlm' : 'basic';
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export class WinRmConnector implements IConnector {
  private conn: WinRmConnectionParams | null = null;
  private commandTimeoutMs = 15000;
  private usePowershell = false;

  async connect(profile: ConnectionProfile): Promise<void> {
    if (this.conn) return;
    const cfg = parseExtraConfig(profile.extraConfig);
    const password = decryptSecret(profile.passwordEncrypted);
    const username = profile.username || '';
    this.commandTimeoutMs = getCommandTimeout(profile);
    this.usePowershell = cfg.usePowershell === true;
    const authMethod: WinRmAuthMethod =
      cfg.authMethod === 'basic' || cfg.authMethod === 'ntlm' ? cfg.authMethod : detectAuthMethod(username);
    this.conn = {
      host: profile.host,
      port: profile.port || 5985,
      path: '/wsman',
      username,
      password: password || '',
      authMethod,
      useHttps: cfg.useHttps === true,
      rejectUnauthorized: cfg.rejectUnauthorized !== false,
    };
  }

  async execute(cmd: string): Promise<ExecResult> {
    if (!this.conn) throw new Error('WinRM 连接未建立');
    const start = Date.now();
    try {
      const { stdout, stderr, exitCode } = await this.execWinRm(cmd);
      return { stdout, stderr, exitCode, durationMs: Date.now() - start };
    } catch (err) {
      return {
        stdout: '',
        stderr: err instanceof Error ? err.message : String(err),
        exitCode: 1,
        durationMs: Date.now() - start,
      };
    }
  }

  private async execWinRm(command: string): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    const params = this.conn!;
    let shellId: string | null = null;
    try {
      shellId = await Shell.doCreateShell(params);
      const shellParams: WinRmConnectionParams = { ...params, shellId };
      const commandId = this.usePowershell
        ? await Command.doExecutePowershell({ ...shellParams, command, httpTimeout: this.commandTimeoutMs })
        : await Command.doExecuteCommand({ ...shellParams, command, httpTimeout: this.commandTimeoutMs });
      const receiveParams: WinRmConnectionParams = { ...shellParams, commandId };
      let stdout = '';
      let stderr = '';
      const deadline = Date.now() + this.commandTimeoutMs;
      for (;;) {
        const remain = deadline - Date.now();
        if (remain <= 0) {
          throw new CommandTimeoutError('WinRM 命令执行超时');
        }
        const res = await Command.doReceiveOutputNonBlocking({ ...receiveParams, httpTimeout: remain });
        stdout += res.output;
        stderr += res.stderr;
        if (res.isComplete) break;
        await sleep(300);
      }
      return { stdout: stdout.trim(), stderr: stderr.trim(), exitCode: stderr.trim() ? 1 : 0 };
    } finally {
      if (shellId) {
        try {
          await Shell.doDeleteShell({ ...params, shellId });
        } catch {
          // 忽略关闭异常
        }
      }
    }
  }

  async disconnect(): Promise<void> {
    this.conn = null;
  }

  async testConnection(profile: ConnectionProfile): Promise<boolean> {
    try {
      await this.connect(profile);
      const res = await this.execWinRm('hostname');
      return res.exitCode === 0;
    } catch {
      return false;
    }
  }
}