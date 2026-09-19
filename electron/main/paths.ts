import { app } from 'electron';
import { join, resolve } from 'path';
import { existsSync, mkdirSync, readFileSync, writeFileSync, cpSync } from 'fs';
import log from 'electron-log';

let appDataPath = '';

const CONFIG_FILE_NAME = 'app-config.json';

/**
 * 历史默认数据根目录（v2.4.x 及更早）。
 * 问题：C 盘根目录写入通常需要管理员权限（安装后首次启动极易失败），
 * 且多用户共用一台测评机时，库文件（含 password_hash 与加密凭据）对所有本地用户可读。
 * 保留此常量仅用于**存量数据迁移**，新安装不再使用它。
 */
const LEGACY_BASE_PATH = 'C:\\JSecProbeData';

export function getDefaultBasePath(): string {
  const isDev = !app.isPackaged || process.env.NODE_ENV === 'development' || process.env.ELECTRON_DEV === '1';
  if (!isDev) {
    // 生产环境默认落在**当前用户的文档目录**：无需管理员权限、多用户之间天然隔离，
    // 且用户容易找到自己的数据目录（等保场景下常需要整体拷贝带走）。
    try {
      const documents = app.getPath('documents');
      if (documents) return join(documents, 'JSecProbeData');
    } catch (e) {
      log.warn('获取文档目录失败，回退到 userData:', e);
    }
    return join(app.getPath('userData'), 'JSecProbeData');
  }
  return join(process.cwd(), 'JSecProbeData');
}

/** 迁移时需要依次探测的历史数据目录 */
function getLegacyPaths(): string[] {
  const paths: string[] = [LEGACY_BASE_PATH];
  try {
    const execDir = process.execPath.substring(0, process.execPath.lastIndexOf('\\'));
    paths.push(join(execDir, 'JSecProbeData'));
  } catch {
    // execPath 异常时忽略程序目录这一候选
  }
  return paths;
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

export function getAppDataPathSync(): string {
  ensurePathResolved();
  return appDataPath;
}

const SUB_DATA_DIRS = ['data', 'attachments', 'standards', 'templates', 'logs', 'backup', 'screenshots', 'evidence', 'knowledge', 'temp', 'backups'];

// 幂等确保数据子目录存在（含 data 等关键目录），无论 appDataPath 来自缓存、迁移回退还是配置
function ensureDataDirs(basePath: string): void {
  for (const dir of SUB_DATA_DIRS) {
    const fullPath = join(basePath, dir);
    if (!existsSync(fullPath)) {
      mkdirSync(fullPath, { recursive: true });
      log.info(`创建目录: ${fullPath}`);
    }
  }
}

// 同步内核：读配置 + 旧路径迁移 + 目录创建，getAppDataPath/getAppDataPathSync 统一走此函数，
// 两条入口语义完全一致，任何调用顺序都不会污染缓存
function ensurePathResolved(): string {
  if (appDataPath) {
    ensureDataDirs(appDataPath);
    return appDataPath;
  }

  const config = readConfig();
  let basePath = config.dataPath || getDefaultBasePath();
  basePath = resolve(basePath);

  // 数据迁移：新路径不存在时，依次探测历史数据目录（C:\JSecProbeData → 程序目录/JSecProbeData）
  if (!existsSync(basePath) && app.isPackaged) {
    for (const oldPath of getLegacyPaths()) {
      if (!existsSync(oldPath)) continue;
      log.info(`检测到旧版数据目录，正在迁移: ${oldPath} -> ${basePath}`);
      try {
        cpSync(oldPath, basePath, { recursive: true });
        log.info(`数据迁移完成（旧目录 ${oldPath} 已保留，确认新目录数据完整后可自行删除）`);
        break;
      } catch (e) {
        log.error(`数据迁移失败: ${oldPath} -> ${basePath}`, e);
        // 迁移失败则直接使用该旧目录，保证用户数据不丢（与既有行为一致）
        basePath = oldPath;
        break;
      }
    }
  }

  appDataPath = basePath;
  ensureDataDirs(appDataPath);

  return appDataPath;
}

export async function getAppDataPath(): Promise<string> {
  return ensurePathResolved();
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
  return join(getAppDataPathSync(), 'data', 'mlps.db');
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
