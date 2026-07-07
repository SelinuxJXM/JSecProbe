import { app } from 'electron';
import { join, resolve } from 'path';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import log from 'electron-log';

let appDataPath = '';

const CONFIG_FILE_NAME = 'app-config.json';

function getDefaultConfigPath(): string {
  return join(app.getPath('userData'), CONFIG_FILE_NAME);
}

function readConfig(): Record<string, any> {
  try {
    const configPath = getDefaultConfigPath();
    if (existsSync(configPath)) {
      const content = readFileSync(configPath, 'utf-8');
      return JSON.parse(content);
    }
  } catch (e) {
    log.warn('读取配置文件失败:', e);
  }
  return {};
}

function writeConfig(config: Record<string, any>): void {
  try {
    const configPath = getDefaultConfigPath();
    log.info(`写入配置文件: ${configPath}`);
    writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
    log.info(`配置文件写入成功: ${configPath}`);
  } catch (e) {
    log.error('写入配置文件失败:', e);
    throw e;
  }
}

export async function getAppDataPath(): Promise<string> {
  if (appDataPath) return appDataPath;
  
  const config = readConfig();
  let basePath = config.dataPath || app.getPath('userData');
  basePath = resolve(basePath);
  
  appDataPath = basePath;
  
  const subDirs = ['data', 'attachments', 'standards', 'templates', 'logs', 'backup', 'screenshots', 'evidence', 'knowledge', 'temp', 'backups'];
  for (const dir of subDirs) {
    const fullPath = join(basePath, dir);
    if (!existsSync(fullPath)) {
      mkdirSync(fullPath, { recursive: true });
      log.info(`创建目录: ${fullPath}`);
    }
  }
  
  return appDataPath;
}

export function setAppDataPath(newPath: string): void {
  const resolvedPath = resolve(newPath);
  appDataPath = resolvedPath;

  const config = readConfig();
  config.dataPath = resolvedPath;
  log.info(`准备将数据存储路径写入配置: ${resolvedPath}`);
  writeConfig(config);

  log.info(`数据存储路径已更改为: ${resolvedPath}`);
}

export function getDefaultUserDataPath(): string {
  return app.getPath('userData');
}

export function getDbPath(): string {
  return join(appDataPath, 'data', 'mlps.db');
}

export function getLogPath(): string {
  return join(appDataPath, 'logs');
}

export function getBackupPath(): string {
  return join(appDataPath, 'backup');
}

export function getAttachmentsPath(): string {
  return join(appDataPath, 'attachments');
}

export function getStandardsPath(): string {
  return join(appDataPath, 'standards');
}

export function getTemplatesPath(): string {
  return join(appDataPath, 'templates');
}
