import Database from 'better-sqlite3';
import { drizzle, BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { join, dirname } from 'path';
import * as fs from 'fs';
import log from 'electron-log';
import bcrypt from 'bcryptjs';
import * as schema from './schema';
import { getDbPath, getAppDataPath } from '../main/paths';
import { eq, count } from 'drizzle-orm';

let db: BetterSQLite3Database<typeof schema> | null = null;
let sqliteInstance: Database.Database | null = null;

export function getDb(): BetterSQLite3Database<typeof schema> {
  if (!db) {
    throw new Error('Database not initialized');
  }
  return db;
}


export function closeDb(): void {
  if (sqliteInstance) {
    try {
      walCheckpoint();
      sqliteInstance.close();
      log.info('数据库已关闭');
    } catch (e) {
      log.error('关闭数据库失败:', e);
    } finally {
      sqliteInstance = null;
      db = null;
    }
  }
}

export function walCheckpoint(): void {
  if (sqliteInstance) {
    sqliteInstance.pragma('wal_checkpoint(TRUNCATE)');
    log.info('WAL checkpoint 完成');
  }
}

const MIGRATION_RECOVERY_THRESHOLD = 3;

export async function initDatabase(): Promise<void> {
  try {
    await getAppDataPath();
    const dbPath = getDbPath();
    log.info('初始化数据库:', dbPath);

    // 兜底：确保数据库文件所在目录存在，避免 better-sqlite3 因父目录缺失而报 "directory does not exist"
    const dbDir = dirname(dbPath);
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }

    const sqlite = new Database(dbPath);
    sqliteInstance = sqlite;

    sqlite.pragma('journal_mode = WAL');
    sqlite.pragma('synchronous = NORMAL');
    sqlite.pragma('cache_size = -20000');
    sqlite.pragma('temp_store = MEMORY');
    sqlite.pragma('foreign_keys = ON');
    sqlite.pragma('busy_timeout = 5000');

    db = drizzle(sqlite, { schema });

    const migrationsPath = join(__dirname, 'migrations');
    const metaJournalPath = join(migrationsPath, 'meta', '_journal.json');

    if (fs.existsSync(metaJournalPath)) {
      try {
        log.info('执行数据库迁移:', migrationsPath);
        migrate(db, { migrationsFolder: migrationsPath });
        log.info('数据库迁移完成');
      } catch (migrateError) {
        log.error('数据库迁移失败，尝试恢复:', migrateError);
        await recoverFromMigrationError(sqlite, migrationsPath, db);
      }
    } else {
      log.info('未找到迁移文件，使用自动建表');
      await autoCreateTables(sqlite);
    }

    migrateAiConfigsTable(sqlite);
    createIndexes(sqlite);
    await initDefaultData();
    await initStandardLibrary();
    await initKnowledgeBase();
    await initCommandLibrary();

    log.info('数据库初始化成功');
  } catch (error) {
    log.error('数据库初始化失败:', error);
    throw error;
  }
}

async function recoverFromMigrationError(
  sqlite: Database.Database,
  migrationsPath: string,
  drizzleDb: BetterSQLite3Database<typeof schema>
): Promise<void> {
  for (let attempt = 1; attempt <= MIGRATION_RECOVERY_THRESHOLD; attempt++) {
    try {
      log.info(`迁移恢复尝试 ${attempt}/${MIGRATION_RECOVERY_THRESHOLD}`);
      migrate(drizzleDb, { migrationsFolder: migrationsPath });
      log.info('迁移恢复成功');
      return;
    } catch (err) {
      log.warn(`恢复尝试 ${attempt} 失败:`, err);
      if (attempt === MIGRATION_RECOVERY_THRESHOLD) {
        log.warn('自动恢复失败，使用兼容模式建表...');
        await autoCreateTables(sqlite);
        return;
      }
    }
  }
}

async function autoCreateTables(sqlite: Database.Database): Promise<void> {
  log.info('执行自动建表（兼容模式）...');

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      real_name TEXT NOT NULL,
      email TEXT,
      phone TEXT,
      role TEXT NOT NULL DEFAULT 'assessor',
      is_active INTEGER NOT NULL DEFAULT 1,
      must_change_password INTEGER NOT NULL DEFAULT 1,
      last_login_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      project_no TEXT,
      system_name TEXT NOT NULL,
      assessed_unit TEXT,
      standard_system TEXT,
      level_combo TEXT,
      extension_type TEXT,
      level INTEGER NOT NULL,
      standard_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft',
      customer_name TEXT,
      assessor TEXT,
      start_date TEXT,
      end_date TEXT,
      description TEXT,
      asset_count INTEGER NOT NULL DEFAULT 0,
      compliance_rate REAL,
      progress INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS project_members (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'assessor',
      assigned_domains TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS assets (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      category TEXT NOT NULL,
      name TEXT NOT NULL,
      os TEXT,
      version TEXT,
      device_usage TEXT,
      description TEXT,
      quantity INTEGER NOT NULL DEFAULT 1,
      ip TEXT,
      importance TEXT NOT NULL DEFAULT 'medium',
      is_virtual INTEGER NOT NULL DEFAULT 0,
      db_system TEXT,
      middleware TEXT,
      is_assessment_target INTEGER NOT NULL DEFAULT 1,
      position TEXT,
      responsible_person TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS standards (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      code TEXT UNIQUE NOT NULL,
      version TEXT NOT NULL,
      description TEXT,
      grade INTEGER NOT NULL DEFAULT 3,
      domain_count INTEGER NOT NULL DEFAULT 0,
      item_count INTEGER NOT NULL DEFAULT 0,
      is_default INTEGER NOT NULL DEFAULT 0,
      standard_type TEXT NOT NULL DEFAULT 'national',
      industry TEXT,
      level_combo TEXT,
      source TEXT NOT NULL DEFAULT 'builtin',
      preset_template TEXT,
      domains_meta TEXT,
      preset_method TEXT DEFAULT 'check',
      column_map TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS assessment_items (
      id TEXT PRIMARY KEY,
      standard_id TEXT NOT NULL,
      domain TEXT NOT NULL,
      control_point TEXT NOT NULL,
      control_name TEXT NOT NULL,
      requirement TEXT NOT NULL,
      min_level INTEGER NOT NULL DEFAULT 2,
      max_level INTEGER NOT NULL DEFAULT 4,
      extension_type TEXT NOT NULL DEFAULT 'general',
      is_high_risk INTEGER NOT NULL DEFAULT 0,
      sort_order INTEGER NOT NULL DEFAULT 0,
      parent_id TEXT
    );

    CREATE TABLE IF NOT EXISTS assessment_records (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      item_id TEXT NOT NULL,
      asset_id TEXT,
      result TEXT NOT NULL DEFAULT 'untested',
      method TEXT NOT NULL DEFAULT 'check',
      command_output TEXT,
      evidence TEXT,
      findings TEXT,
      assessor TEXT,
      assessment_date TEXT,
      screenshot_paths TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS issues (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      asset_id TEXT,
      item_id TEXT,
      security_domain TEXT NOT NULL,
      control_point TEXT NOT NULL,
      control_name TEXT NOT NULL,
      issue_title TEXT NOT NULL,
      issue_description TEXT NOT NULL,
      risk_level TEXT NOT NULL DEFAULT 'medium',
      status TEXT NOT NULL DEFAULT 'pending',
      rectification_suggestion TEXT,
      rectification_deadline TEXT,
      responsible_person TEXT,
      fixed_description TEXT,
      fixed_date TEXT,
      assessor TEXT,
      evidence_files TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS knowledge_categories (
      id TEXT PRIMARY KEY,
      parent_id TEXT,
      name TEXT NOT NULL,
      icon TEXT,
      icon_color TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      document_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS knowledge_documents (
      id TEXT PRIMARY KEY,
      category_id TEXT NOT NULL,
      title TEXT NOT NULL,
      type TEXT NOT NULL,
      file_path TEXT,
      content TEXT,
      description TEXT,
      version TEXT DEFAULT '1.0',
      tags TEXT,
      reference_count INTEGER NOT NULL DEFAULT 0,
      upload_date TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS knowledge_commands (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      target TEXT NOT NULL,
      command TEXT NOT NULL,
      description TEXT NOT NULL,
      os TEXT NOT NULL,
      brand TEXT NOT NULL DEFAULT '',
      device_type TEXT NOT NULL DEFAULT '',
      category TEXT NOT NULL DEFAULT '',
      sub_category TEXT NOT NULL DEFAULT '',
      is_favorite INTEGER NOT NULL DEFAULT 0,
      reference_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS report_templates (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      category TEXT,
      description TEXT,
      content TEXT NOT NULL,
      variables TEXT,
      is_default INTEGER NOT NULL DEFAULT 0,
      created_by TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS ai_configs (
      id TEXT PRIMARY KEY DEFAULT 'default',
      provider TEXT DEFAULT 'openai',
      api_key TEXT,
      api_base TEXT,
      model TEXT DEFAULT 'gpt-4o-mini',
      temperature REAL NOT NULL DEFAULT 0.3,
      ocr_provider TEXT DEFAULT 'tesseract',
      ocr_api_key TEXT,
      enable_ai INTEGER NOT NULL DEFAULT 0,
      privacy_mode INTEGER NOT NULL DEFAULT 0,
      sensitive_words TEXT,
      mode TEXT DEFAULT 'cloud',
      ollama_model TEXT,
      ollama_url TEXT DEFAULT 'http://localhost:11434',
      ocr_preprocess INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS system_settings (
      id TEXT PRIMARY KEY DEFAULT 'default',
      db_version INTEGER NOT NULL DEFAULT 1,
      theme TEXT DEFAULT 'light',
      language TEXT DEFAULT 'zh-CN',
      auto_backup_enabled INTEGER NOT NULL DEFAULT 1,
      auto_backup_days INTEGER NOT NULL DEFAULT 7,
      data_path TEXT,
      default_standard TEXT DEFAULT 'gb-t-22239-2019-l3',
      standard_data_version INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS operation_logs (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      username TEXT,
      action TEXT NOT NULL,
      module TEXT NOT NULL,
      target_id TEXT,
      target_name TEXT,
      description TEXT,
      ip_address TEXT,
      created_at TEXT NOT NULL
    );
  `);

  // 兼容旧库：standards 表已存在但缺新字段时补齐（CREATE TABLE IF NOT EXISTS 不更新已存在表）
  try {
    const stdCols = sqlite.prepare("PRAGMA table_info(standards)").all() as Array<{ name: string }>;
    const stdColNames = stdCols.map(c => c.name);
    const newStdCols: Array<{ name: string; ddl: string }> = [
      { name: 'standard_type', ddl: "ALTER TABLE standards ADD COLUMN standard_type TEXT NOT NULL DEFAULT 'national'" },
      { name: 'industry', ddl: 'ALTER TABLE standards ADD COLUMN industry TEXT' },
      { name: 'source', ddl: "ALTER TABLE standards ADD COLUMN source TEXT NOT NULL DEFAULT 'builtin'" },
      { name: 'preset_template', ddl: 'ALTER TABLE standards ADD COLUMN preset_template TEXT' },
      { name: 'domains_meta', ddl: 'ALTER TABLE standards ADD COLUMN domains_meta TEXT' },
      { name: 'preset_method', ddl: "ALTER TABLE standards ADD COLUMN preset_method TEXT DEFAULT 'check'" },
      { name: 'column_map', ddl: 'ALTER TABLE standards ADD COLUMN column_map TEXT' },
    ];
    for (const col of newStdCols) {
      if (!stdColNames.includes(col.name)) {
        sqlite.exec(col.ddl);
        log.info(`已添加 ${col.name} 列到 standards 表`);
      }
    }
  } catch (err) {
    log.warn('standards 表字段迁移失败:', err);
  }

  // 兼容旧库：operation_logs 追加 detail_json（Phase 4 标准导入/导出审计）
  try {
    const logCols = sqlite.prepare("PRAGMA table_info(operation_logs)").all() as Array<{ name: string }>;
    const logColNames = logCols.map(c => c.name);
    if (!logColNames.includes('detail_json')) {
      sqlite.exec('ALTER TABLE operation_logs ADD COLUMN detail_json TEXT');
      log.info('已添加 detail_json 列到 operation_logs 表');
    }
  } catch (err) {
    log.warn('operation_logs 表字段迁移失败:', err);
  }

  // 兼容旧库：knowledge_commands 追加 industry（Phase 4 命令库行业维度）
  try {
    const cols = sqlite.prepare("PRAGMA table_info(knowledge_commands)").all() as Array<{ name: string }>;
    const names = cols.map(c => c.name);
    if (!names.includes('industry')) {
      sqlite.exec("ALTER TABLE knowledge_commands ADD COLUMN industry TEXT NOT NULL DEFAULT ''");
      log.info('已添加 industry 列到 knowledge_commands 表');
    }
  } catch (err) {
    log.warn('knowledge_commands 表 industry 迁移失败:', err);
  }

  log.info('自动建表完成');
}

function migrateAiConfigsTable(sqlite: Database.Database): void {
  try {
    const columns = sqlite.prepare("PRAGMA table_info(ai_configs)").all() as Array<{ name: string }>;
    const columnNames = columns.map(c => c.name);

    if (!columnNames.includes('mode')) {
      sqlite.exec("ALTER TABLE ai_configs ADD COLUMN mode TEXT DEFAULT 'cloud'");
      log.info('已添加 mode 列到 ai_configs 表');
    }
    if (!columnNames.includes('ollama_model')) {
      sqlite.exec("ALTER TABLE ai_configs ADD COLUMN ollama_model TEXT");
      log.info('已添加 ollama_model 列到 ai_configs 表');
    }
    if (!columnNames.includes('ollama_url')) {
      sqlite.exec("ALTER TABLE ai_configs ADD COLUMN ollama_url TEXT DEFAULT 'http://localhost:11434'");
      log.info('已添加 ollama_url 列到 ai_configs 表');
    }
    if (!columnNames.includes('ocr_preprocess')) {
      sqlite.exec("ALTER TABLE ai_configs ADD COLUMN ocr_preprocess INTEGER NOT NULL DEFAULT 0");
      log.info('已添加 ocr_preprocess 列到 ai_configs 表');
    }
    if (!columnNames.includes('active_model_id')) {
      sqlite.exec("ALTER TABLE ai_configs ADD COLUMN active_model_id TEXT");
      log.info('已添加 active_model_id 列到 ai_configs 表');
    }

    // 创建云端模型表
    const tables = sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='ai_cloud_models'").all() as Array<{ name: string }>;
    if (tables.length === 0) {
      sqlite.exec(`
        CREATE TABLE ai_cloud_models (
          id TEXT PRIMARY KEY,
          config_id TEXT NOT NULL DEFAULT 'default',
          name TEXT NOT NULL,
          api_base TEXT NOT NULL,
          api_key TEXT,
          model TEXT NOT NULL,
          api_format TEXT NOT NULL DEFAULT 'openai',
          enabled INTEGER NOT NULL DEFAULT 1,
          priority INTEGER NOT NULL DEFAULT 99,
          updated_at TEXT NOT NULL,
          created_at TEXT NOT NULL
        );
      `);
      log.info('已创建 ai_cloud_models 表');
    }
  } catch (err) {
    log.warn('迁移 ai_configs 表失败:', err);
  }
}

function createIndexes(sqlite: Database.Database): void {
  try {
    sqlite.exec(`
      CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status);
      CREATE INDEX IF NOT EXISTS idx_projects_status_created ON projects(status, created_at);
      CREATE INDEX IF NOT EXISTS idx_assets_project_id ON assets(project_id);
      CREATE INDEX IF NOT EXISTS idx_assessment_items_standard_domain ON assessment_items(standard_id, domain);
      CREATE INDEX IF NOT EXISTS idx_assessment_items_level ON assessment_items(min_level);
      CREATE INDEX IF NOT EXISTS idx_assessment_items_extension ON assessment_items(extension_type);
      CREATE INDEX IF NOT EXISTS idx_assessment_records_project_id ON assessment_records(project_id);
      CREATE INDEX IF NOT EXISTS idx_assessment_records_item_id ON assessment_records(item_id);
      CREATE INDEX IF NOT EXISTS idx_assessment_records_result ON assessment_records(result);
      CREATE INDEX IF NOT EXISTS idx_issues_project_id ON issues(project_id);
      CREATE INDEX IF NOT EXISTS idx_issues_project_risk ON issues(project_id, risk_level);
      CREATE INDEX IF NOT EXISTS idx_issues_project_status ON issues(project_id, status);
      CREATE INDEX IF NOT EXISTS idx_issues_project_domain ON issues(project_id, security_domain);
      CREATE INDEX IF NOT EXISTS idx_issues_asset_id ON issues(asset_id);
      CREATE INDEX IF NOT EXISTS idx_issues_item_id ON issues(item_id);
      CREATE INDEX IF NOT EXISTS idx_knowledge_documents_category ON knowledge_documents(category_id);
      CREATE INDEX IF NOT EXISTS idx_knowledge_documents_title ON knowledge_documents(title);
      CREATE INDEX IF NOT EXISTS idx_operation_logs_module_action ON operation_logs(module, action);
      CREATE INDEX IF NOT EXISTS idx_operation_logs_created_at ON operation_logs(created_at);
      CREATE UNIQUE INDEX IF NOT EXISTS project_user_idx ON project_members(project_id, user_id);
    `);
  } catch (err) {
    log.warn('创建索引失败:', err);
  }
}

async function initDefaultData(): Promise<void> {
  const dbInstance = getDb();

  const settingsCount = await dbInstance.select().from(schema.systemSettings).limit(1);
  if (settingsCount.length === 0) {
    const now = new Date().toISOString();
    await dbInstance.insert(schema.systemSettings).values({
      id: 'default',
      dbVersion: 1,
      theme: 'light',
      language: 'zh-CN',
      autoBackupEnabled: 1,
      autoBackupDays: 7,
      defaultStandard: '',
      updatedAt: now,
    });
    log.info('初始化系统设置');
  }

  const userCount = await dbInstance.select().from(schema.users).limit(1);
  if (userCount.length === 0) {
    const now = new Date().toISOString();
    const passwordHash = await bcrypt.hash('admin123', 12);

    await dbInstance.insert(schema.users).values({
      id: 'default_admin',
      username: 'admin',
      passwordHash,
      realName: '系统管理员',
      role: 'admin',
      isActive: 1,
      mustChangePassword: 0,
      createdAt: now,
      updatedAt: now,
    });
    log.info('创建默认管理员账号: admin / admin123');
  }

  const aiConfigCount = await dbInstance.select().from(schema.aiConfigs).limit(1);
  if (aiConfigCount.length === 0) {
    const now = new Date().toISOString();
    await dbInstance.insert(schema.aiConfigs).values({
      id: 'default',
      provider: 'openai',
      model: 'gpt-4o-mini',
      temperature: 0.7,
      ocrProvider: 'tesseract',
      enableAi: 0,
      updatedAt: now,
      createdAt: now,
    });
    log.info('初始化AI配置');
  }
}

async function initStandardLibrary(): Promise<void> {
  const dbInstance = getDb();
  if (!sqliteInstance) throw new Error('数据库未初始化');

  const dbPath = sqliteInstance.name;
  const backupPath = `${dbPath}.bak-${Date.now()}`;
  try {
    sqliteInstance.exec(`VACUUM INTO '${backupPath}'`);
    log.info(`数据库已备份到: ${backupPath}`);
  } catch (e) {
    log.warn('数据库备份失败，继续执行:', e);
  }

  // 防御性迁移：为 assessment_items 补充新增的预置字段列（避免旧库 no such column）
  try {
    const tableInfo = sqliteInstance.prepare('PRAGMA table_info(assessment_items)').all() as Array<{ name: string }>;
    if (!tableInfo.some(c => c.name === 'preset_result')) {
      sqliteInstance.exec('ALTER TABLE assessment_items ADD COLUMN preset_result TEXT');
      log.info('已为 assessment_items 添加 preset_result 列');
    }
    if (!tableInfo.some(c => c.name === 'preset_record')) {
      sqliteInstance.exec('ALTER TABLE assessment_items ADD COLUMN preset_record TEXT');
      log.info('已为 assessment_items 添加 preset_record 列');
    }
    if (!tableInfo.some(c => c.name === 'preset_by_type')) {
      sqliteInstance.exec('ALTER TABLE assessment_items ADD COLUMN preset_by_type TEXT');
      log.info('已为 assessment_items 添加 preset_by_type 列');
    }
  } catch (e) {
    log.warn('补充预置字段列失败:', e);
  }

  // 内置测评标准 seed 入驻：数据源来自用户在「标准库」中导入的标准，封装为内置 seed。
  // 关键约束（满足用户需求）：
  //  - 全新环境 / 版本升级时自动入驻；
  //  - 按 code 幂等判重：若该 code 已存在（含用户覆盖导入的内置标准、或用户导入的其他标准），
  //    绝不重复插入、绝不覆盖、也绝不删除用户的测评记录或既有测评项；
  //  - 仅对「本次新入驻」的标准写入其测评项。
  const STANDARD_DATA_VERSION = 8;
  try {
    const { getStandardSeeds } = await import('./seeds/standards');
    const seed = getStandardSeeds();
    // code -> seed 等级组合与行业映射，用于内置标准强制同步（校正历史误填的非对角线组合/行业）
    const seedComboByCode = new Map<string, { levelCombo: string; industry: string }>();
    for (const s of seed.standards) {
      if (s.code) seedComboByCode.set(s.code, { levelCombo: s.levelCombo || '', industry: s.industry || '' });
    }

    // 防御性迁移：为 standards 补充 level_combo 列，并回填/校正存量数据的等级组合与行业
    //  - 内置 seed 标准：始终以 seed 的 levelCombo / industry 为准（校正历史误填，如电力 S2A3G3 / 行业）
    //  - 用户导入/自定义标准：仅在 level_combo 为空时按 grade 回填对角线 S{grade}A{grade}G{grade}；行业不强制改动
    try {
      const stdTableInfo = sqliteInstance.prepare('PRAGMA table_info(standards)').all() as Array<{ name: string }>;
      if (!stdTableInfo.some(c => c.name === 'level_combo')) {
        sqliteInstance.exec('ALTER TABLE standards ADD COLUMN level_combo TEXT');
        log.info('已为 standards 添加 level_combo 列');
      }
      const rows = sqliteInstance.prepare('SELECT id, code, grade, level_combo, industry FROM standards').all() as Array<{ id: string; code: string; grade: number; level_combo: string | null; industry: string | null }>;
      let backfilled = 0;
      let corrected = 0;
      for (const row of rows) {
        const seed = seedComboByCode.get(row.code);
        if (seed) {
          // 内置标准：强制同步到 seed 组合与行业（校正历史误填）
          if (row.level_combo !== seed.levelCombo) {
            sqliteInstance.prepare('UPDATE standards SET level_combo = ? WHERE id = ?').run(seed.levelCombo, row.id);
            corrected++;
          }
          if ((row.industry || '') !== seed.industry) {
            sqliteInstance.prepare('UPDATE standards SET industry = ? WHERE id = ?').run(seed.industry, row.id);
            corrected++;
          }
        } else {
          // 用户标准：仅在 level_combo 为空时回填对角线
          const combo = row.level_combo;
          if (combo === null || combo === undefined || combo.trim() === '') {
            const g = Number(row.grade) || 3;
            sqliteInstance.prepare('UPDATE standards SET level_combo = ? WHERE id = ?').run(`S${g}A${g}G${g}`, row.id);
            backfilled++;
          }
        }
      }
      if (backfilled > 0) log.info(`已回填 ${backfilled} 条用户 standards 的 level_combo`);
      if (corrected > 0) log.info(`已校正 ${corrected} 条内置 standards 的 level_combo / industry`);
    } catch (e) {
      log.warn('补充 level_combo 列/回填失败:', e);
    }

    const existingRows = await dbInstance
      .select({ code: schema.standards.code })
      .from(schema.standards);
    const existingCodes = new Set(existingRows.map(r => r.code));

    let added = 0;
    for (const std of seed.standards) {
      if (existingCodes.has(std.code)) {
        log.info(`内置标准已存在(code=${std.code})，跳过入驻，不覆盖`);
        continue;
      }

      await dbInstance.insert(schema.standards).values({
        id: std.id,
        name: std.name,
        code: std.code,
        version: std.version,
        description: std.description,
        grade: std.grade,
        domainCount: std.domainCount,
        itemCount: std.itemCount,
        isDefault: std.isDefault,
        standardType: std.standardType,
        industry: std.industry,
        source: std.source,
        presetTemplate: std.presetTemplate,
        domainsMeta: std.domainsMeta,
        presetMethod: std.presetMethod,
        columnMap: std.columnMap,
        levelCombo: std.levelCombo,
        createdAt: new Date().toISOString(),
      });

      const items = seed.items.filter(i => i.standardId === std.id);
      if (items.length > 0) {
        await dbInstance.insert(schema.assessmentItems).values(items.map(i => ({
          id: i.id,
          standardId: i.standardId,
          domain: i.domain,
          controlPoint: i.controlPoint,
          controlName: i.controlName,
          requirement: i.requirement,
          minLevel: i.minLevel,
          maxLevel: i.maxLevel,
          extensionType: i.extensionType,
          isHighRisk: i.isHighRisk,
          sortOrder: i.sortOrder,
          parentId: i.parentId,
          presetResult: i.presetResult,
          presetRecord: i.presetRecord,
          presetByType: i.presetByType,
        })));
      }
      added++;
      log.info(`内置标准入驻成功: ${std.name}(code=${std.code})，测评项 ${items.length} 条`);
    }

    log.info(`内置标准入驻完成：本次新增 ${added} 个（seed 共 ${seed.standards.length} 个）`);
  } catch (e) {
    log.error('内置标准入驻失败:', e);
  }

  // 版本号更新（同步 system_settings.standardDataVersion，便于后续升级识别）
  try {
    await dbInstance.update(schema.systemSettings)
      .set({ standardDataVersion: STANDARD_DATA_VERSION, updatedAt: new Date().toISOString() })
      .where(eq(schema.systemSettings.id, 'default'));
    log.info(`标准库初始化完成（数据版本=${STANDARD_DATA_VERSION}）`);
  } catch (e) {
    log.warn('更新标准数据版本失败:', e);
  }
}

async function initKnowledgeBase(): Promise<void> {
  const dbInstance = getDb();

  try {
    const { getKnowledgeSeed } = await import('./seeds/knowledge');
    const seed = getKnowledgeSeed();

    const existingCategories = await dbInstance
      .select({ count: count() })
      .from(schema.knowledgeCategories);
    const existingDocs = await dbInstance
      .select({ count: count() })
      .from(schema.knowledgeDocuments);

    const categoryCount = existingCategories[0]?.count || 0;
    const docCount = existingDocs[0]?.count || 0;

    if (categoryCount > 0 || docCount > 0) {
      log.info(`知识库已存在(${categoryCount}个分类，${docCount}篇文档)，跳过初始化`);
      return;
    }

    log.info('初始化知识库：导入种子数据...');
    log.info('初始化知识库:', seed.categories.length + '个分类，' + seed.documents.length + '篇文档');

    if (seed.categories.length > 0) {
      await dbInstance.insert(schema.knowledgeCategories).values(seed.categories as Array<typeof schema.knowledgeCategories.$inferInsert>);
    }

    if (seed.documents.length > 0) {
      const batchSize = 20;
      for (let i = 0; i < seed.documents.length; i += batchSize) {
        const batch = seed.documents.slice(i, i + batchSize);
        await dbInstance.insert(schema.knowledgeDocuments).values(batch as Array<typeof schema.knowledgeDocuments.$inferInsert>);
      }
    }

    log.info('知识库初始化完成');
  } catch (error) {
    log.error('知识库初始化失败:', error);
  }
}

async function initCommandLibrary(): Promise<void> {
  const dbInstance = getDb();

  try {
    const { getCommandSeeds } = await import('./seeds/commands');
    const seeds = getCommandSeeds();

    const existing = await dbInstance
      .select({ count: count() })
      .from(schema.knowledgeCommands);
    const existingCount = existing[0]?.count || 0;

    if (existingCount > 0 && existingCount >= seeds.length) {
      log.info(`核查命令库已存在(${existingCount}条命令)，跳过初始化`);
      return;
    }

    log.info(`初始化核查命令库: ${seeds.length}条命令`);

    for (const cmd of seeds) {
      await dbInstance.insert(schema.knowledgeCommands)
        .values({
          id: cmd.id,
          name: cmd.name,
          target: cmd.target,
          command: cmd.command,
          description: cmd.description,
          os: cmd.os,
          brand: cmd.brand,
          deviceType: cmd.deviceType,
          category: cmd.category,
          subCategory: cmd.subCategory,
          isFavorite: 0,
          referenceCount: 0,
          createdAt: cmd.createdAt || new Date().toISOString(),
          updatedAt: cmd.updatedAt || new Date().toISOString(),
        })
        .onConflictDoUpdate({
          target: schema.knowledgeCommands.id,
          set: {
            name: cmd.name,
            target: cmd.target,
            command: cmd.command,
            description: cmd.description,
            os: cmd.os,
            brand: cmd.brand,
            deviceType: cmd.deviceType,
            category: cmd.category,
            subCategory: cmd.subCategory,
            updatedAt: cmd.updatedAt || new Date().toISOString(),
          },
        });
    }

    log.info('核查命令库初始化完成');
  } catch (error) {
    log.error('核查命令库初始化失败:', error);
  }
}
