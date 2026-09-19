import { join } from 'path';
import log from 'electron-log';
import { getSqlite } from './index';
import { runMigrations } from './migrator';

/**
 * 独立执行迁移（开发/排障用）。
 *
 * 走自建的幂等迁移器（见 ./migrator.ts），与运行时 initDatabase() 内的调用路径一致，
 * 避免在存量库上因 duplicate column name 而失败。
 */
export async function runMigration() {
  try {
    const sqlite = getSqlite();
    if (!sqlite) {
      throw new Error('数据库尚未初始化，请先调用 initDatabase()');
    }
    log.info('开始执行数据库迁移...');
    // 使用绝对路径，避免 CLI 直接运行时 CWD 不同导致找不到迁移目录
    runMigrations(sqlite, join(__dirname, 'migrations'));
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
