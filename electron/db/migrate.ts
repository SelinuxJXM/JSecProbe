import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { getDb } from './index';
import log from 'electron-log';

export async function runMigration() {
  try {
    const db = getDb();
    log.info('开始执行数据库迁移...');
    await migrate(db, { migrationsFolder: './electron/db/migrations' });
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
      console.error(err);
      process.exit(1);
    });
}