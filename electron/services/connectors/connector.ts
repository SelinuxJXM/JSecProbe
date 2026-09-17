import type { ConnectionProfile } from '../../../shared/types';

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
}

export class CommandTimeoutError extends Error {
  constructor(message = '命令执行超时') {
    super(message);
    this.name = 'CommandTimeoutError';
  }
}

export interface IConnector {
  connect(profile: ConnectionProfile): Promise<void>;
  execute(cmd: string): Promise<ExecResult>;
  disconnect(): Promise<void>;
  testConnection(profile: ConnectionProfile): Promise<boolean>;
}