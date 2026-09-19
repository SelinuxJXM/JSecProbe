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
 *   - `CREATE TABLE` / `CREATE [UNIQUE] INDEX` 自动改写为 `IF NOT EXISTS` 形式。
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

  const last = sqlite
    .prepare(`SELECT id, hash, created_at FROM ${MIGRATIONS_TABLE} ORDER BY created_at DESC LIMIT 1`)
    .get() as { id: number; hash: string; created_at: number } | undefined;

  for (const entry of journal.entries) {
    const file = join(migrationsFolder, `${entry.tag}.sql`);
    if (!fs.existsSync(file)) {
      throw new Error(`No file ${file} found in ${migrationsFolder} folder`);
    }
    if (last && Number(last.created_at) >= entry.when) {
      continue;
    }
    const content = fs.readFileSync(file, 'utf8');
    applyMigration(sqlite, entry, content);
  }
}
