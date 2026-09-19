#!/usr/bin/env node
/**
 * 结构漂移检查：比对 `electron/db/schema.ts` 声明的表/列 与 `electron/db/migrations/*.sql`
 * 实际建出的表/列。
 *
 * 目的：drizzle 迁移目录是结构的唯一真相。历史上曾出现「schema.ts 已声明、业务代码已写入，
 * 但迁移 SQL 里根本没有这一列」的情况，故障不在启动期暴露，而是等到运行时才抛
 * "no such column"。本脚本把这类问题前移到 CI / 发版前。
 *
 * 说明：
 *  - 只做纯文本解析，不加载 better-sqlite3（本机 Node ABI 与其编译目标不一致，加载会失败）。
 *  - 若某处差异确实由 `electron/db/index.ts` 的 JS 兜底覆盖，应当把它补进正式迁移，
 *    而不是加白名单 —— 否则兜底与迁移会长期双轨。
 *
 * 用法：npm run check:schema
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SCHEMA_FILE = path.join(ROOT, 'electron/db/schema.ts');
const MIGRATIONS_DIR = path.join(ROOT, 'electron/db/migrations');

const IDENT = '[A-Za-z_][A-Za-z0-9_]*';

function parseSchema(file) {
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  const tables = {};
  let cur = null;
  for (const line of lines) {
    const t = line.match(/sqliteTable\(\s*'([^']+)'\s*,\s*\{/);
    if (t) {
      cur = t[1];
      tables[cur] = [];
      continue;
    }
    if (cur === null) continue;
    if (/^\}\);\s*$/.test(line) || /^\},/.test(line)) {
      cur = null;
      continue;
    }
    // 取 drizzle 列定义里的**数据库列名**（text('snake_case')），而非 camelCase 字段名
    const c = line.match(new RegExp(`^\\s{2}${IDENT}\\s*:\\s*(?:text|integer|real|blob)\\(\\s*'([^']+)'`));
    if (c) tables[cur].push(c[1]);
  }
  return tables;
}

function parseMigrations(dir) {
  const journalPath = path.join(dir, 'meta/_journal.json');
  if (!fs.existsSync(journalPath)) {
    throw new Error(`找不到迁移索引: ${journalPath}`);
  }
  const journal = JSON.parse(fs.readFileSync(journalPath, 'utf8'));
  const tables = {};
  for (const entry of journal.entries) {
    const file = path.join(dir, `${entry.tag}.sql`);
    if (!fs.existsSync(file)) {
      throw new Error(`_journal.json 登记了 ${entry.tag}，但文件不存在: ${file}`);
    }
    const sql = fs.readFileSync(file, 'utf8');
    let m;
    const createRe = new RegExp(`CREATE TABLE (?:IF NOT EXISTS )?[\`"'\\[]?(${IDENT})[\`"'\\]]?\\s*\\(([\\s\\S]*?)\\n\\);`, 'g');
    while ((m = createRe.exec(sql)) !== null) {
      const name = m[1];
      tables[name] = tables[name] || [];
      for (const line of m[2].split('\n')) {
        const c = line.match(new RegExp(`^\\s+[\`"'\\[]?(${IDENT})[\`"'\\]]?\\s+(?:integer|text|real|blob|numeric)`, 'i'));
        if (c && !tables[name].includes(c[1])) tables[name].push(c[1]);
      }
    }
    const alterRe = new RegExp(`ALTER TABLE [\`"'\\[]?(${IDENT})[\`"'\\]]?\\s+ADD(?:\\s+COLUMN)?\\s+[\`"'\\[]?(${IDENT})[\`"'\\]]?`, 'gi');
    while ((m = alterRe.exec(sql)) !== null) {
      tables[m[1]] = tables[m[1]] || [];
      if (!tables[m[1]].includes(m[2])) tables[m[1]].push(m[2]);
    }
  }
  return tables;
}

function main() {
  const declared = parseSchema(SCHEMA_FILE);
  const built = parseMigrations(MIGRATIONS_DIR);

  const problems = [];
  for (const [table, cols] of Object.entries(declared)) {
    const actual = built[table];
    if (!actual) {
      problems.push(`迁移 SQL 未建表：${table}`);
      continue;
    }
    for (const col of cols) {
      if (!actual.includes(col)) problems.push(`迁移 SQL 缺列：${table}.${col}`);
    }
  }

  if (problems.length === 0) {
    const tableCount = Object.keys(declared).length;
    console.log(`✅ 结构一致：schema.ts ${tableCount} 张表全部被迁移 SQL 覆盖`);
    return 0;
  }

  console.error(`❌ 检测到 ${problems.length} 处结构漂移（schema.ts 已声明，迁移 SQL 未覆盖）：\n`);
  for (const p of problems) console.error(`  - ${p}`);
  console.error('\n请补充 drizzle 迁移；新增的 ALTER 由 electron/db/migrator.ts 保证幂等，可安全重复执行。');
  return 1;
}

process.exit(main());
