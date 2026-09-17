import type { CommandParser, ParsedData } from './types';

const PASSWD_RE = /(passwd|shadow)/i;
const CONFIG_FILE_RE = /(sshd_config|sudoers|fstab)/i;

export const regexExtractParser: CommandParser = {
  name: 'RegexExtractParser',
  canParse(cmd: string): boolean {
    return PASSWD_RE.test(cmd) || CONFIG_FILE_RE.test(cmd);
  },
  parse(cmd: string, stdout: string): ParsedData {
    const lines = stdout.split('\n').map((l) => l.trim()).filter(Boolean);
    if (PASSWD_RE.test(cmd)) {
      const uidZeroAccounts = lines
        .filter((l) => {
          const parts = l.split(':');
          return parts.length >= 3 && parts[2] === '0';
        })
        .map((l) => l.split(':')[0]);
      return { totalLines: lines.length, uidZeroAccounts };
    }
    const config: Record<string, string> = {};
    for (const line of lines) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_-]*)\s+(.+?)\s*$/);
      if (m) config[m[1]] = m[2];
    }
    return { totalLines: lines.length, config };
  },
};