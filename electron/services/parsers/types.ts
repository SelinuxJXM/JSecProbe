export type ParsedData = Record<string, unknown> | unknown[] | string | number | null;

export interface CommandParser {
  name: string;
  canParse(cmd: string, stdout: string): boolean;
  parse(cmd: string, stdout: string): ParsedData;
}