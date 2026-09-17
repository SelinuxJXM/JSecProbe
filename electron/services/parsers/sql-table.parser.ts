import type { CommandParser, ParsedData } from './types';

const TABLE_CMD_RE = /^\s*(SHOW|SELECT|CONFIG\s+GET|DESC|DESCRIBE|EXPLAIN|PRAGMA)\b/i;
const SEPARATOR_RE = /^[\s\-+|]+$/;

export const sqlTableParser: CommandParser = {
  name: 'SqlTableParser',
  canParse(cmd: string, stdout: string): boolean {
    return TABLE_CMD_RE.test(cmd.trim()) && stdout.includes('-+-');
  },
  parse(_cmd: string, stdout: string): ParsedData {
    const lines = stdout.split('\n').map((l) => l.trimEnd()).filter(Boolean);
    const sepIdx = lines.findIndex((l) => SEPARATOR_RE.test(l.trim()) && l.includes('-'));
    if (sepIdx <= 0) return { columns: [], rows: [] };
    const header = lines[sepIdx - 1];
    const cols = header.split('|').map((c) => c.trim());
    const rows: Array<Record<string, string>> = [];
    for (let i = sepIdx + 1; i < lines.length; i++) {
      const parts = lines[i].split('|').map((c) => c.trim());
      if (parts.length !== cols.length) continue;
      const row: Record<string, string> = {};
      cols.forEach((c, idx) => {
        row[c] = parts[idx] ?? '';
      });
      rows.push(row);
    }
    return { columns: cols, rows };
  },
};