import { Shell, Command } from 'winrm-client';
import log from 'electron-log';
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
  /** HTTP 降级用的端口（仅当用户未显式指定端口时取 5985） */
  private httpFallbackPort = 5985;
  /** 是否允许在 HTTPS 连不上时降级到 HTTP。仅当用户未显式声明 useHttps 时为 true */
  private allowHttpFallback = false;

  async connect(profile: ConnectionProfile): Promise<void> {
    if (this.conn) return;
    const cfg = parseExtraConfig(profile.extraConfig);
    const password = decryptSecret(profile.passwordEncrypted);
    const username = profile.username || '';
    this.commandTimeoutMs = getCommandTimeout(profile);
    this.usePowershell = cfg.usePowershell === true;
    const authMethod: WinRmAuthMethod =
      cfg.authMethod === 'basic' || cfg.authMethod === 'ntlm' ? cfg.authMethod : detectAuthMethod(username);

    // 传输安全：默认 HTTPS(5986)。原实现默认走 HTTP(5985)，
    // 管理员口令（Basic 下等同明文）与命令回显全部明文过网。
    // 未配置证书的内网主机普遍只开 5985，因此仅在用户未显式声明 useHttps 时允许降级，
    // 显式 useHttps=true 表示"该实例确认支持加密"，失败即报错不静默降级。
    const useHttps = cfg.useHttps !== false;
    this.allowHttpFallback = cfg.useHttps === undefined;
    this.httpFallbackPort = profile.port || 5985;

    // Basic 认证只是把 "域\用户:口令" 做 base64 后放进 HTTP 头，等价于明文传输。
    // 在 HTTP(5985) 下走 Basic，链路上任何嗅探者都能直接还原管理员口令，
    // 因此默认拒绝；确需明文（如临时排障、纯内网）必须显式 allowInsecureBasic。
    if (!useHttps && authMethod === 'basic' && cfg.allowInsecureBasic !== true) {
      throw new Error(
        'WinRM Basic 认证不允许通过明文 HTTP 传输。' +
          '请启用 HTTPS(端口 5986) 并在连接配置中设置 extraConfig.useHttps=true；' +
          '若确需在隔离网络下使用明文，请在 extraConfig 中显式设置 allowInsecureBasic=true。'
      );
    }
    if (!useHttps) {
      log.warn(
        `[WinRM] 正在通过明文 HTTP(${profile.port || 5985}) 连接 ${profile.host}，` +
          `NTLM 提供消息级加密但无法防御重放与降级，建议改用 HTTPS(5986)。`
      );
    }

    this.conn = {
      host: profile.host,
      port: profile.port || (useHttps ? 5986 : 5985),
      path: '/wsman',
      username,
      password: password || '',
      authMethod,
      useHttps,
      rejectUnauthorized: cfg.rejectUnauthorized !== false,
    };
  }

  async execute(cmd: string): Promise<ExecResult> {
    if (!this.conn) throw new Error('WinRM 连接未建立');
    const start = Date.now();
    try {
      const { stdout, stderr, exitCode } = await this.execWinRmWithFallback(cmd);
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

  /**
   * 默认走 HTTPS，连不上时降级到 HTTP 重试一次。
   *
   * 内网 Windows 主机多数只开 5985（HTTP），不允许降级会让 WinRM 核查整体不可用；
   * 但降级必须：① 仅当用户未显式声明 useHttps；② 打印告警留痕；
   * ③ Basic 认证不降级（明文 base64 等同泄露口令，见 connect 中的拒绝逻辑）。
   * 降级后仍失败时，把两次的错误一起抛，避免用户只看到其中一半而误判原因。
   */
  private async execWinRmWithFallback(command: string): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    try {
      return await this.execWinRm(command);
    } catch (err) {
      const params = this.conn;
      if (!params || !params.useHttps || !this.allowHttpFallback) throw err;
      if (params.authMethod === 'basic') throw err;

      const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));
      log.warn(
        `[WinRM] ${params.host} 的 HTTPS(${params.port}) 连接失败，已降级为明文 HTTP(${this.httpFallbackPort})。` +
          `NTLM 提供消息级加密但无法防御重放与降级，建议在该主机上启用 5986/HTTPS。`
      );
      this.conn = { ...params, useHttps: false, port: this.httpFallbackPort };
      try {
        return await this.execWinRm(command);
      } catch (plainErr) {
        throw new Error(`${msg(err)}（已尝试降级到 HTTP(${this.httpFallbackPort}) 仍失败：${msg(plainErr)}）`);
      }
    }
  }

  async disconnect(): Promise<void> {
    this.conn = null;
  }

  async testConnection(profile: ConnectionProfile): Promise<boolean> {
    try {
      await this.connect(profile);
      const res = await this.execWinRmWithFallback('hostname');
      return res.exitCode === 0;
    } catch {
      return false;
    }
  }
}