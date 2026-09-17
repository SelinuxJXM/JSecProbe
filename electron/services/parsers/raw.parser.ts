import type { CommandParser, ParsedData } from './types';

export const rawTextParser: CommandParser = {
  name: 'RawTextParser',
  canParse(): boolean {
    return true;
  },
  parse(_cmd: string, stdout: string): ParsedData {
    return { text: stdout };
  },
};