import type { ConnectionProfile } from '../../../shared/types';
import { CommandTimeoutError } from './connector';

export interface DbExtraConfig {
  database?: string;
  instance?: string;
  sid?: string;
  serviceName?: string;
  commandTimeoutMs?: number;
  [key: string]: unknown;
}

export const DEFAULT_COMMAND_TIMEOUT = 15000;

export function parseExtraConfig(extraConfig: string | null): DbExtraConfig {
  if (!extraConfig) return {};
  try {
    const parsed = JSON.parse(extraConfig) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as DbExtraConfig;
    }
  } catch {
    // 非 JSON 时按空配置处理
  }
  return {};
}

/**
 * 判断连接失败是否由 TLS 握手引起。
 * 用于"优先 TLS、服务端不支持时降级明文"的回退逻辑 —— 内网老库普遍不支持 TLS，
 * 强制 TLS 会让核查功能直接不可用，因此降级是必要的工程折中，但必须告警留痕。
 */
export function isTlsHandshakeError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? '');
  return /tls|ssl|certificate|handshake|protocol version|unsupported.*encrypt/i.test(msg);
}

export function getCommandTimeout(profile: ConnectionProfile): number {
  const cfg = parseExtraConfig(profile.extraConfig);
  const custom = Number(cfg.commandTimeoutMs);
  if (Number.isFinite(custom) && custom > 0) return custom;
  return DEFAULT_COMMAND_TIMEOUT;
}

export function withTimeout<T>(promise: Promise<T>, ms: number, message = '命令执行超时'): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new CommandTimeoutError(message)), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      }
    );
  });
}

export function formatRows(rows: unknown[]): string {
  if (!rows || rows.length === 0) return '(0 行)';
  const cols: string[] = [];
  for (const row of rows) {
    if (row && typeof row === 'object') {
      for (const key of Object.keys(row)) {
        if (!cols.includes(key)) cols.push(key);
      }
    }
  }
  if (cols.length === 0) return JSON.stringify(rows, null, 2);

  const str = (v: unknown): string => {
    if (v === null || v === undefined) return 'NULL';
    if (Buffer.isBuffer(v)) return v.toString('utf8');
    if (v instanceof Date) return v.toISOString();
    return String(v);
  };
  const widths = cols.map((c) => Math.max(c.length, ...rows.map((r) => str((r as Record<string, unknown>)[c]).length)));
  const pad = (s: string, w: number) => s.padEnd(w);
  const lines: string[] = [];
  lines.push(cols.map((c, i) => pad(c, widths[i])).join(' | '));
  lines.push(cols.map((_, i) => '-'.repeat(widths[i])).join('-+-'));
  for (const row of rows) {
    lines.push(cols.map((c, i) => pad(str((row as Record<string, unknown>)[c]), widths[i])).join(' | '));
  }
  return lines.join('\n');
}

export function splitSqlStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = '';
  let inSingle = false;
  let inDouble = false;
  let inBacktick = false;
  let inLineComment = false;
  let inBlockComment = false;
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    const next = sql[i + 1];
    if (inLineComment) {
      current += ch;
      if (ch === '\n') inLineComment = false;
      continue;
    }
    if (inBlockComment) {
      current += ch;
      if (ch === '*' && next === '/') {
        current += '/';
        i++;
        inBlockComment = false;
      }
      continue;
    }
    if (!inSingle && !inDouble && !inBacktick) {
      if (ch === '-' && next === '-') {
        inLineComment = true;
        current += ch;
        continue;
      }
      if (ch === '/' && next === '*') {
        inBlockComment = true;
        current += ch;
        continue;
      }
    }
    if (ch === "'" && !inDouble && !inBacktick) {
      inSingle = !inSingle;
      current += ch;
      continue;
    }
    if (ch === '"' && !inSingle && !inBacktick) {
      inDouble = !inDouble;
      current += ch;
      continue;
    }
    if (ch === '`' && !inSingle && !inDouble) {
      inBacktick = !inBacktick;
      current += ch;
      continue;
    }
    if (ch === ';' && !inSingle && !inDouble && !inBacktick) {
      const stmt = current.trim();
      if (stmt) statements.push(stmt);
      current = '';
      continue;
    }
    current += ch;
  }
  const tail = current.trim();
  if (tail) statements.push(tail);
  return statements;
}

const SQL_WRITE_MARKERS = [
  'INSERT',
  'UPDATE',
  'DELETE',
  'DROP',
  'ALTER',
  'CREATE',
  'TRUNCATE',
  'GRANT',
  'REVOKE',
  'MERGE',
  'RENAME',
  'COMMENT',
  'CALL',
  'DO ',
  'SET ',
  'LOCK',
  'UNLOCK',
  'INTO OUTFILE',
  'INTO DUMPFILE',
  'LOAD DATA',
  'REPLACE INTO',
  'VACUUM',
  'ANALYZE',
  'REINDEX',
  'CLUSTER',
  'REFRESH MATERIALIZED VIEW',
  'BEGIN',
  'COMMIT',
  'ROLLBACK',
  'START TRANSACTION',
  'COPY ',
];

/**
 * Shell 命令安全护栏（SSH / WinRM 通道）。
 *
 * SQL / Redis 通道已有只读白名单，但 shell 通道此前可把知识库里任意命令发到目标机
 * 以管理员权限执行——测评账户常是高权限，一旦知识库被污染或有人手输破坏性命令，
 * 后果不可逆。这里只拦"最明确的破坏性模式"，不追求完整白名单（核查命令形态太多，
 * 白名单会误伤正常核查）；误伤风险由"只列明确破坏动词 + 立即用现有命令库回归"控制。
 */
const DANGEROUS_SHELL_PATTERNS: Array<{ re: RegExp; label: string }> = [
  { re: /\brm\s+-[a-z]*[rf][a-z]*\s+/i, label: '递归强制删除(rm -rf/-fr)' },
  { re: /\brm\s+-rf\s+[\/\\]/i, label: '根目录删除' },
  { re: /\bdd\s+if=/i, label: 'dd 设备写入' },
  { re: /\bmkfs(\.|\s|$)/i, label: '格式化文件系统' },
  { re: /\b(shutdown|reboot|halt|poweroff)\b/i, label: '关机/重启' },
  { re: /\binit\s+[06]\b/i, label: '切换运行级别(关机/重启)' },
  { re: /\bchmod\s+(-r\s+)?777\b/i, label: '全局可写权限' },
  { re: /\bchown\s+-R\b/i, label: '递归改属主' },
  { re: /:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;?\s*:/, label: 'fork 炸弹' },
  { re: /\b(curl|wget)\b[^|]*\|\s*(ba)?sh\b/i, label: '下载并直接执行' },
  { re: /\bdel\s+\/[fqs]/i, label: 'Windows 强制删除' },
  { re: /\bformat\s+[a-z]:/i, label: 'Windows 格式化磁盘' },
  { re: /\breg\s+(add|delete)\b/i, label: 'Windows 注册表写入' },
  { re: /\b(net\s+user\s+\S+\s+\S+|useradd|userdel)\b/i, label: '创建/删除系统账户' },
];

export function assertSafeShellCommand(cmd: string): void {
  const text = String(cmd || '');
  for (const { re, label } of DANGEROUS_SHELL_PATTERNS) {
    if (re.test(text)) {
      throw new Error(`已拦截高危命令（${label}）：${text.slice(0, 120)}`);
    }
  }
}

export function assertReadonlySql(sql: string): void {
  const trimmed = sql.replace(/^\s+/, '');
  const upper = trimmed.toUpperCase();
  const execMatch = trimmed.match(/^\s*EXEC(?:UTE)?\s+sp_configure\s+['"][^'"]+['"]\s*$/i);
  if (execMatch) return;
  const allowedPrefix = /^(SELECT|SHOW|DESC|DESCRIBE|EXPLAIN|WITH|TABLE|VALUES|PRAGMA)\b/;
  if (!allowedPrefix.test(upper)) {
    throw new Error(`仅允许执行只读核查语句（SELECT/SHOW 等），已拦截: ${sql.slice(0, 120)}`);
  }
  for (const marker of SQL_WRITE_MARKERS) {
    if (upper.includes(marker)) {
      throw new Error(`检测到疑似写操作（${marker.trim()}），已拦截: ${sql.slice(0, 120)}`);
    }
  }
}

const REDIS_READONLY_PATTERNS: RegExp[] = [
  /^ACL\s+(LIST|WHOAMI|GETUSER|LOG|CAT|HELP)\b/i,
  /^CONFIG\s+GET\b/i,
  /^INFO\b/i,
  /^CLIENT\s+(LIST|GETNAME|ID|INFO)\b/i,
  /^SLOWLOG\s+(GET|LEN|HELP)\b/i,
  /^MEMORY\s+(DOCTOR|STATS|USAGE)\b/i,
  /^DBSIZE\b/i,
  /^TIME\b/i,
  /^PING\b/i,
];

export function assertReadonlyRedis(cmd: string): void {
  const trimmed = cmd.trim();
  if (!REDIS_READONLY_PATTERNS.some((re) => re.test(trimmed))) {
    throw new Error(`仅允许执行只读核查命令（ACL/CONFIG GET/INFO 等），已拦截: ${trimmed.slice(0, 120)}`);
  }
}

export function splitRedisCommands(input: string): string[] {
  const verbs = '(?:ACL|CONFIG|INFO|CLIENT|SLOWLOG|MEMORY|DBSIZE|TIME|PING)';
  const re = new RegExp(`\\b${verbs}\\b`, 'i');
  const commands: string[] = [];
  let rest = input.trim();
  while (rest) {
    const first = rest.match(new RegExp(`^${verbs}\\b`, 'i'));
    if (!first) {
      commands.push(rest);
      break;
    }
    const afterFirst = rest.slice(first[0].length).trim();
    const next = afterFirst.search(re);
    if (next === -1) {
      commands.push(rest);
      break;
    }
    commands.push(rest.slice(0, first[0].length + next).trim());
    rest = rest.slice(first[0].length + next).trim();
  }
  return commands.filter(Boolean);
}

export function formatRedisReply(reply: unknown): string {
  if (reply === null || reply === undefined) return '(nil)';
  if (typeof reply === 'string') return reply;
  if (Buffer.isBuffer(reply)) return reply.toString('utf8');
  if (Array.isArray(reply)) {
    if (reply.every((v) => v === null || typeof v === 'string' || Buffer.isBuffer(v))) {
      const first = reply[0];
      const firstStr = first === null || first === undefined ? '' : Buffer.isBuffer(first) ? first.toString('utf8') : String(first);
      if (firstStr.trim().toLowerCase().startsWith('user ')) {
        return reply.map((v) => (v === null ? '(nil)' : Buffer.isBuffer(v) ? v.toString('utf8') : String(v))).join('\n');
      }
      const lines: string[] = [];
      for (let i = 0; i < reply.length; i += 2) {
        const key = reply[i];
        const val = reply[i + 1];
        if (val === undefined) {
          lines.push(key === null ? '(nil)' : String(key));
        } else {
          lines.push(`${key === null ? '(nil)' : String(key)}: ${val === null ? '(nil)' : String(val)}`);
        }
      }
      return lines.length ? lines.join('\n') : '(空)';
    }
    return JSON.stringify(
      reply,
      (_k, v) => (Buffer.isBuffer(v) ? v.toString('utf8') : v),
      2
    );
  }
  return String(reply);
}