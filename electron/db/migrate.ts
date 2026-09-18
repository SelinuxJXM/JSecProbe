import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { getDb } from './index';
import { join } from 'path';
import log from 'electron-log';

export async function runMigration() {
  try {
    const db = getDb();
    log.info('开始执行数据库迁移...');
    // 使用绝对路径，避免 CLI 直接运行时 CWD 不同导致找不到迁移目录
    await migrate(db, { migrationsFolder: join(__dirname, 'migrations') });
    log.info('数据库迁移完成');
  } catch (error) {
    log.error('数据库迁移失败:', error);
    throw error;
  }
}

// 如果直接运行此文件，执行迁移
if (import.meta.url === `file://${process.argv[1]}`) {
  runMigration()
    .then(() => process.exit(0))
    .catch((err) => {
      log.error('迁移脚本执行失败:', err);
      process.exit(1);
    });
}