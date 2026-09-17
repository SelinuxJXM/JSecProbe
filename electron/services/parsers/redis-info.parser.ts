import type { CommandParser, ParsedData } from './types';

export const redisInfoParser: CommandParser = {
  name: 'RedisInfoParser',
  canParse(cmd: string, stdout: string): boolean {
    return /^INFO\b/i.test(cmd.trim()) && stdout.includes('# ');
  },
  parse(_cmd: string, stdout: string): ParsedData {
    const result: Record<string, Record<string, string>> = {};
    let section = '';
    for (const line of stdout.split('\n')) {
      const t = line.trim();
      if (!t) continue;
      if (t.startsWith('#')) {
        section = t.slice(1).trim();
        result[section] = {};
      } else if (section) {
        const idx = t.indexOf(':');
        if (idx > -1) {
          const key = t.slice(0, idx).trim();
          const val = t.slice(idx + 1).trim();
          result[section][key] = val;
        }
      }
    }
    return result;
  },
};