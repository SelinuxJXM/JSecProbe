import { app } from 'electron';
import { join, resolve } from 'path';
import { existsSync, mkdirSync, readFileSync, writeFileSync, cpSync } from 'fs';
import log from 'electron-log';

let appDataPath = '';

const CONFIG_FILE_NAME = 'app-config.json';

export function getDefaultBasePath(): string {
  if (app.isPackaged) {
    return 'C:\\JSecProbeData';
  }
  return join(process.cwd(), 'JSecProbeData');
}

function getDefaultConfigPath(): string {
  return join(getDefaultBasePath(), CONFIG_FILE_NAME);
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
    writeFileSync(getDefaultConfigPath(), JSON.stringify(config, null, 2), 'utf-8');
  } catch (e) {
    log.error('写入配置文件失败:', e);
    throw e;
  }
}

export async function getAppDataPath(): Promise<string> {
  if (appDataPath) return appDataPath;
  
  const config = readConfig();
  let basePath = config.dataPath || getDefaultBasePath();
  basePath = resolve(basePath);
  
  // 数据迁移：如果新路径不存在，检查旧路径（程序目录/JSecProbeData）是否有数据
  if (!existsSync(basePath) && app.isPackaged) {
    const execDir = process.execPath.substring(0, process.execPath.lastIndexOf('\\'));
    const oldPath = join(execDir, 'JSecProbeData');
    if (existsSync(oldPath)) {
      log.info(`检测到旧版数据目录，正在迁移: ${oldPath} -> ${basePath}`);
      try {
        cpSync(oldPath, basePath, { recursive: true });
        log.info('数据迁移完成');
      } catch (e) {
        log.error('数据迁移失败:', e);
        basePath = oldPath;
      }
    }
  }
  
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
  writeConfig(config);

  log.info(`数据存储路径已更改为: ${resolvedPath}`);
}

export function getDefaultUserDataPath(): string {
  return getDefaultBasePath();
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
