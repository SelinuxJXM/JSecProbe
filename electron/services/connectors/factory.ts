import type { ConnectionProfile } from '../../../shared/types';
import type { IConnector } from './connector';
import { SshConnector } from './ssh.connector';
import { MySqlConnector } from './mysql.connector';
import { RedisConnector } from './redis.connector';
import { PostgresqlConnector } from './postgresql.connector';
import { SqlServerConnector } from './sqlserver.connector';
import { WinRmConnector } from './winrm.connector';
import { OracleConnector } from './oracle.connector';
import { HttpConnector } from './http.connector';

export function createConnector(profile: ConnectionProfile): IConnector {
  switch (profile.connType) {
    case 'ssh':
      return new SshConnector();
    case 'winrm':
      return new WinRmConnector();
    case 'mysql':
      return new MySqlConnector();
    case 'postgresql':
      return new PostgresqlConnector();
    case 'sqlserver':
      return new SqlServerConnector();
    case 'redis':
      return new RedisConnector();
    case 'oracle':
      return new OracleConnector();
    case 'http':
      return new HttpConnector();
    default:
      throw new Error(`暂不支持连接类型: ${profile.connType}`);
  }
}