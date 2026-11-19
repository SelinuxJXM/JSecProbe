import crypto from 'node:crypto';
import * as fs from 'fs';
import { join } from 'path';
import type { Database } from 'better-sqlite3';
import log from 'electron-log';

/**
 * 幂等的 drizzle 迁移执行器。
 *
 * 为什么不用 drizzle 自带的 `migrate()`：
 *   本项目在 0001 之后长期靠 JS 兜底（`ensureCompatColumns()` 等）在运行时补列，
 *   存量库上这些列早已存在。此时若用原生 `migrate()` 执行 0002 的 `ALTER TABLE ADD COLUMN`，
 *   SQLite 会抛 "duplicate column name"，迁移整体回滚 → 进入迁移恢复流程 → 启动失败。
 *   即"修一个崩溃会引入另一个崩溃"。
 *
 * 本执行器与 drizzle 原生实现保持**账本兼容**（同一个 `__drizzle_migrations` 表、
 * 同样的 hash 算法 sha256(file)、同样的 created_at = _journal.json 的 `when`），
 * 因此可以随时切回原生 `migrate()`（前提是迁移 SQL 本身是幂等安全的），也可以直接接管
 * 由历史上原生 migrate 写入的记录。
 *
 * 额外的幂等保护（仅本执行器提供）：
 *   - `ALTER TABLE ... ADD COLUMN` 前先 `PRAGMA table_info` 判存，已存在则跳过；
 *   - `CREATE TABLE` / `CREATE [UNIQUE] INDEX` 自动改写为 `IF NOT EXISTS` 形式；
 *   - 存量库基线：账本为空但业务表已存在时只补记账本、不重放历史 DDL（见 applyBaseline）。
 */

const MIGRATIONS_TABLE = '__drizzle_migrations';
const IDENT = '[A-Za-z_][A-Za-z0-9_]*';

interface JournalEntry {
  idx: number;
  version: string;
  when: number;
  tag: string;
  breakpoints: boolean;
}

function hasColumn(sqlite: Database, table: string, column: string): boolean {
  try {
    const cols = sqlite.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    return cols.some(c => c.name === column);
  } catch {
    // 表不存在时 PRAGMA 不抛错而是返回空，这里仅为防御
    return false;
  }
}

interface PreparedStatement {
  sql: string | null;
  reason?: string;
}

/**
 * 去掉语句块开头的 SQL 注释行。
 *
 * 迁移文件按 `--> statement-breakpoint` 切块，注释与其后的首条语句会落在同一块里；
 * 若不剥离注释，`^ALTER TABLE` / `^CREATE TABLE` 的匹配会失效，幂等保护随之失效。
 */
function stripLeadingComments(stmt: string): string {
  const lines = stmt.split('\n');
  let i = 0;
  while (i < lines.length) {
    const t = lines[i].trim();
    if (t === '' || t.startsWith('--')) {
      i++;
      continue;
    }
    break;
  }
  return lines.slice(i).join('\n').trim();
}

function prepareStatement(stmt: string, sqlite: Database): PreparedStatement {
  const s = stripLeadingComments(stmt);
  if (!s) return { sql: null, reason: '空语句' };

  const alter = s.match(
    new RegExp(`^ALTER\\s+TABLE\\s+[\`"'\\[]?(${IDENT})[\`"'\\]]?\\s+ADD\\s+(?:COLUMN\\s+)?[\`"'\\[]?(${IDENT})[\`"'\\]]?`, 'i')
  );
  if (alter) {
    const table = alter[1];
    const column = alter[2];
    if (hasColumn(sqlite, table, column)) {
      return { sql: null, reason: `列已存在，跳过 ALTER：${table}.${column}` };
    }
    return { sql: s };
  }

  if (/^CREATE\s+TABLE\s+(?!IF\s+NOT\s+EXISTS)/i.test(s)) {
    return { sql: s.replace(/^CREATE\s+TABLE\s+/i, 'CREATE TABLE IF NOT EXISTS ') };
  }

  if (/^CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?!IF\s+NOT\s+EXISTS)/i.test(s)) {
    return {
      sql: s.replace(
        /^(CREATE\s+)(UNIQUE\s+)?(INDEX\s+)/i,
        (_m, a: string, b: string | undefined) => `${a}${b || ''}INDEX IF NOT EXISTS `
      ),
    };
  }

  return { sql: s };
}

function applyMigration(sqlite: Database, entry: JournalEntry, fileContent: string): void {
  const statements = fileContent.split('--> statement-breakpoint');
  sqlite.exec('BEGIN');
  try {
    for (const raw of statements) {
      const { sql, reason } = prepareStatement(raw, sqlite);
      if (!sql) {
        if (reason) log.debug(`[迁移] ${entry.tag}: ${reason}`);
        continue;
      }
      sqlite.exec(sql);
    }
    const hash = crypto.createHash('sha256').update(fileContent).digest('hex');
    sqlite
      .prepare(`INSERT INTO ${MIGRATIONS_TABLE} ("hash", "created_at") VALUES (?, ?)`)
      .run(hash, entry.when);
    sqlite.exec('COMMIT');
    log.info(`[迁移] 已应用 ${entry.tag}`);
  } catch (err) {
    try {
      sqlite.exec('ROLLBACK');
    } catch {
      // 回滚失败无需额外处理，原始错误更重要
    }
    throw err;
  }
}

/** 库里是否已有业务表（用于区分全新空库与靠 JS 兜底建立的存量库）。 */
function hasExistingSchema(sqlite: Database): boolean {
  try {
    return !!sqlite
      .prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'projects'`)
      .get();
  } catch {
    return false;
  }
}

function journalFilesExist(folder: string, entries: JournalEntry[]): boolean {
  return entries.every(e => fs.existsSync(join(folder, `${e.tag}.sql`)));
}

/**
 * 存量库基线：把历史迁移直接登记为「已应用」，不重放 DDL。
 *
 * 背景：打包产物长期不带迁移目录（vite 只编译 TS，静态 SQL 不会自动跟随），正式版一直走
 * autoCreateTables + ensure* 兜底建表，库里连 __drizzle_migrations 账本表都没有。
 * 一旦把迁移文件补进包，这类库若不处理就会从 0000 起重放全部历史 DDL。
 *
 * 虽然本执行器已把 CREATE 改写为 IF NOT EXISTS、ALTER 会判存跳过，重放是幂等的，
 * 但：1) 结构已由 JS 兜底建立，重放没有收益；2) 迁移 SQL 与 autoCreateTables 是两份
 * 独立维护的 DDL，没必要让任何定义差异被放大；3) 升级用户的库应做到行为零变化。
 * 因此只补记账本（hash / created_at 与 applyMigration 完全一致，保持与 drizzle 原生
 * migrate() 的账本兼容）。此后新增迁移的 when 必然更大，仍会正常执行。
 */
function applyBaseline(sqlite: Database, folder: string, entries: JournalEntry[]): void {
  const insert = sqlite.prepare(
    `INSERT INTO ${MIGRATIONS_TABLE} ("hash", "created_at") VALUES (?, ?)`
  );
  sqlite.transaction(() => {
    for (const entry of entries) {
      const content = fs.readFileSync(join(folder, `${entry.tag}.sql`), 'utf8');
      const hash = crypto.createHash('sha256').update(content).digest('hex');
      insert.run(hash, entry.when);
    }
  })();
  log.info(`[迁移] 存量库基线：已登记 ${entries.length} 条历史迁移，跳过历史 DDL 重放`);
}

export function runMigrations(sqlite: Database, migrationsFolder: string): void {
  const journalPath = join(migrationsFolder, 'meta', '_journal.json');
  if (!fs.existsSync(journalPath)) {
    throw new Error(`Can't find meta/_journal.json file`);
  }

  const journal = JSON.parse(fs.readFileSync(journalPath, 'utf8')) as {
    entries: JournalEntry[];
  };

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE} (
      id SERIAL PRIMARY KEY,
      hash text NOT NULL,
      created_at numeric
    )
  `);

  const applied = sqlite
    .prepare(`SELECT COUNT(*) AS c FROM ${MIGRATIONS_TABLE}`)
    .get() as { c: number };

  if (
    applied.c === 0 &&
    journal.entries.length > 0 &&
    hasExistingSchema(sqlite) &&
    journalFilesExist(migrationsFolder, journal.entries)
  ) {
    applyBaseline(sqlite, migrationsFolder, journal.entries);
  }

  // 基线可能刚写入账本，必须在它之后重新读取 last，否则历史条目会被再执行一遍。
  const last = sqlite
    .prepare(`SELECT id, hash, created_at FROM ${MIGRATIONS_TABLE} ORDER BY created_at DESC LIMIT 1`)
    .get() as { id: number; hash: string; created_at: number } | undefined;

  // L7：读取全部已应用迁移的 hash，检测"历史迁移文件被改动但账本未更新"。
  // 修正过的历史迁移（when 不变）此前永不重放，结构漂移无法发现；这里至少醒目告警。
  const appliedRows = sqlite.prepare(`SELECT created_at, hash FROM ${MIGRATIONS_TABLE}`).all() as Array<{ created_at: number; hash: string }>;
  const appliedByWhen = new Map(appliedRows.map(r => [Number(r.created_at), r.hash]));

  for (const entry of journal.entries) {
    const file = join(migrationsFolder, `${entry.tag}.sql`);
    if (!fs.existsSync(file)) {
      throw new Error(`No file ${file} found in ${migrationsFolder} folder`);
    }
    const content = fs.readFileSync(file, 'utf8');
    if (last && Number(last.created_at) >= entry.when) {
      // 已应用的迁移：比对内容 hash，不一致则告警（不自动重放，避免破坏已有数据）
      const recorded = appliedByWhen.get(entry.when);
      if (recorded) {
        const crypto = require('crypto');
        const currentHash = crypto.createHash('sha256').update(content).digest('hex');
        if (recorded !== currentHash) {
          console.warn(`[migrator] 迁移 ${entry.tag} 文件内容已变更（账本 hash 不匹配），但未重放。如需应用请手动处理账本。`);
        }
      }
      continue;
    }
    applyMigration(sqlite, entry, content);
  }
}
