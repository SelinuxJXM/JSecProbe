import type { ConnectionProfile } from '../../../shared/types';
import { decryptSecret } from '../credential.util';
import type { IConnector, ExecResult } from './connector';
import { parseExtraConfig, getCommandTimeout } from './db.util';

export class HttpConnector implements IConnector {
  private baseUrl = '';
  private username = '';
  private password = '';
  private commandTimeoutMs = 15000;

  async connect(profile: ConnectionProfile): Promise<void> {
    const cfg = parseExtraConfig(profile.extraConfig);
    const password = decryptSecret(profile.passwordEncrypted);
    const useHttps = cfg.useHttps === true;
    const protocol = useHttps ? 'https' : 'http';
    const port = profile.port || (useHttps ? 7002 : 7001);
    this.baseUrl = `${protocol}://${profile.host}:${port}`;
    this.username = profile.username || '';
    this.password = password || '';
    this.commandTimeoutMs = getCommandTimeout(profile);
  }

  async execute(cmd: string): Promise<ExecResult> {
    const start = Date.now();
    try {
      const url = this.buildUrl(cmd);
      const headers: Record<string, string> = {
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'User-Agent': 'JSecProbe/1.0 (MLPS Assessment)',
      };
      if (this.username) {
        const basic = Buffer.from(`${this.username}:${this.password}`, 'utf8').toString('base64');
        headers.Authorization = `Basic ${basic}`;
      }
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.commandTimeoutMs);
      try {
        const res = await fetch(url, {
          headers,
          signal: controller.signal,
          redirect: 'follow',
        });
        const body = await res.text();
        const summary = this.analyzeResponse(url, res.status, res.headers, body);
        return { stdout: summary, stderr: '', exitCode: 0, durationMs: Date.now() - start };
      } finally {
        clearTimeout(timer);
      }
    } catch (err) {
      return {
        stdout: '',
        stderr: err instanceof Error ? err.message : String(err),
        exitCode: 1,
        durationMs: Date.now() - start,
      };
    }
  }

  private buildUrl(cmd: string): string {
    const trimmed = cmd.trim();
    if (/^https?:\/\//i.test(trimmed)) return trimmed;
    const path = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
    return `${this.baseUrl}${path}`;
  }

  private analyzeResponse(url: string, status: number, headers: Headers, body: string): string {
    const lines: string[] = [];
    lines.push(`URL: ${url}`);
    lines.push(`HTTP 状态: ${status}`);
    const server = headers.get('server');
    if (server) lines.push(`Server: ${server}`);
    const xPoweredBy = headers.get('x-powered-by');
    if (xPoweredBy) lines.push(`X-Powered-By: ${xPoweredBy}`);
    const setCookie = headers.get('set-cookie');
    if (setCookie) lines.push(`Set-Cookie: ${setCookie.slice(0, 200)}`);
    const cookies = (headers.get('set-cookie') || '').split(/[;,]/).map((c) => c.trim()).filter(Boolean);
    const sessionCookies = cookies.filter((c) => /JSESSIONID|WL-PROXY-CLIENT-IP|WL-AUTH|ADMINCONSOLESESSION/i.test(c));
    if (sessionCookies.length) lines.push(`会话特征: ${sessionCookies.join(', ')}`);

    const titleMatch = body.match(/<title[^>]*>([^<]*)<\/title>/i);
    if (titleMatch?.[1]) lines.push(`页面标题: ${titleMatch[1].trim().slice(0, 120)}`);

    const features: string[] = [];
    if (/WebLogic Server|Oracle WebLogic|weblogic/i.test(body)) features.push('WebLogic');
    if (/LoginForm|j_username|j_password/i.test(body)) features.push('控制台登录表单');
    if (/console\.portal|AdminConsole|Administration Console/i.test(body)) features.push('管理控制台');
    if (features.length) lines.push(`特征识别: ${features.join(', ')}`);
    lines.push(`内容长度: ${body.length}`);
    if (body.length > 0) {
      const snippet = body.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      lines.push(`内容摘要: ${snippet.slice(0, 200)}`);
    }
    return lines.join('\n');
  }

  async disconnect(): Promise<void> {
    this.baseUrl = '';
    this.username = '';
    this.password = '';
  }

  async testConnection(profile: ConnectionProfile): Promise<boolean> {
    try {
      await this.connect(profile);
      const res = await this.execute('/weblogic/ready');
      return res.exitCode === 0;
    } catch {
      return false;
    }
  }
}