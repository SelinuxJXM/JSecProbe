import type { CommandParser } from './types';
import { rawTextParser } from './raw.parser';
import { keyValueParser } from './key-value.parser';
import { sqlTableParser } from './sql-table.parser';
import { regexExtractParser } from './regex-extract.parser';
import { redisInfoParser } from './redis-info.parser';

const PARSERS: CommandParser[] = [
  redisInfoParser,
  sqlTableParser,
  regexExtractParser,
  keyValueParser,
  rawTextParser,
];

export function parseCommandOutput(cmd: string, stdout: string, stderr: string): string | null {
  if (stderr || !stdout.trim()) return null;
  for (const parser of PARSERS) {
    if (!parser.canParse(cmd, stdout)) continue;
    try {
      const data = parser.parse(cmd, stdout);
      if (data === null || data === undefined) return null;
      return JSON.stringify(data);
    } catch {
      return null;
    }
  }
  return null;
}