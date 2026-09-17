import type { CommandParser, ParsedData } from './types';

const KV_LINE_RE = /^\s*[^:=]+?\s*[:=]\s*\S/;

export const keyValueParser: CommandParser = {
  name: 'KeyValueParser',
  canParse(_cmd: string, stdout: string): boolean {
    const lines = stdout.split('\n').map((l) => l.trim()).filter(Boolean);
    return lines.length > 0 && lines.every((l) => KV_LINE_RE.test(l));
  },
  parse(_cmd: string, stdout: string): ParsedData {
    const result: Record<string, string> = {};
    for (const line of stdout.split('\n')) {
      const m = line.match(/^\s*([^:=]+?)\s*[:=]\s*(.*?)\s*$/);
      if (m) result[m[1].trim()] = m[2].trim();
    }
    return result;
  },
};