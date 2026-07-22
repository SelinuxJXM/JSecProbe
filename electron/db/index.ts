import Database from 'better-sqlite3';
import { drizzle, BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { join } from 'path';
import * as fs from 'fs';
import log from 'electron-log';
import bcrypt from 'bcryptjs';
import * as schema from './schema';
import { getDbPath, getAppDataPath } from '../main/paths';
import { eq, count, ne } from 'drizzle-orm';

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
    sqliteInstance.close();
    sqliteInstance = null;
    db = null;
    log.info('数据库已关闭');
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
      temperature REAL NOT NULL DEFAULT 0.7,
      ocr_provider TEXT DEFAULT 'tesseract',
      ocr_api_key TEXT,
      enable_ai INTEGER NOT NULL DEFAULT 0,
      privacy_mode INTEGER NOT NULL DEFAULT 0,
      sensitive_words TEXT,
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

  log.info('自动建表完成');
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
      defaultStandard: 'gb-t-22239-2019-l3',
      updatedAt: now,
    });
    log.info('初始化系统设置');
  }

  const userCount = await dbInstance.select().from(schema.users).limit(1);
  if (userCount.length === 0) {
    const now = new Date().toISOString();
    const passwordHash = bcrypt.hashSync('admin123', 12);

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

  const STANDARD_DATA_VERSION = 7;

  const standardCount = await dbInstance
    .select()
    .from(schema.standards)
    .where(eq(schema.standards.code, 'GB/T 22239-2019-L3'))
    .limit(1);

  let itemCountResult = await dbInstance
    .select({ count: count() })
    .from(schema.assessmentItems);
  let itemCount = itemCountResult[0]?.count || 0;
  log.info(`测评项表当前数据量: ${itemCount} 条`);

  let hasSectionField = false;
  let hasMinLevelField = false;
  let hasExtensionTypeField = false;
  try {
    if (!sqliteInstance) throw new Error('数据库未初始化');
    const tableInfo = sqliteInstance.prepare('PRAGMA table_info(assessment_items)').all() as Array<{ name: string }>;
    log.info('assessment_items 表结构:', JSON.stringify(tableInfo.map(c => ({ name: c.name }))));
    hasSectionField = tableInfo.some(c => c.name === 'section');
    hasMinLevelField = tableInfo.some(c => c.name === 'min_level');
    hasExtensionTypeField = tableInfo.some(c => c.name === 'extension_type');
  } catch (e) {
    log.warn('获取表结构失败:', e);
  }

  const needRebuild = hasSectionField || !hasMinLevelField || !hasExtensionTypeField;

  let levelNotNull = false;
  try {
    if (sqliteInstance) {
      const colInfo = sqliteInstance.prepare("PRAGMA table_info(assessment_items)").all() as Array<{ name: string; notnull: number }>;
      const levelCol = colInfo.find((c) => c.name === 'level');
      if (levelCol && levelCol.notnull === 1) {
        levelNotNull = true;
      }
    }
  } catch (e) {
    log.warn('检查level列失败:', e);
  }
  if (needRebuild && itemCount > 0) {
    log.info('检测到表结构不兼容，备份并重建assessment_items表...');
    try {
      sqliteInstance.exec('DROP TABLE IF EXISTS assessment_items_backup');
      sqliteInstance.exec('CREATE TABLE assessment_items_backup AS SELECT * FROM assessment_items');
      const backupCount = sqliteInstance.prepare('SELECT COUNT(*) as cnt FROM assessment_items_backup').get() as { cnt: number };
      log.info(`已创建assessment_items_backup备份表 (${backupCount.cnt} 条记录)`);
    } catch (e) {
      log.warn('创建备份表失败:', e);
    }
  }

  if (needRebuild || levelNotNull) {
    try {
      log.info('重建assessment_items表...');
      await dbInstance.delete(schema.assessmentRecords);
      log.info('已删除所有测评记录');
      sqliteInstance.exec('DROP TABLE IF EXISTS assessment_items');
      sqliteInstance.exec(`
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
        )
      `);
      sqliteInstance.exec('CREATE INDEX IF NOT EXISTS idx_items_standard_domain ON assessment_items(standard_id, domain)');
      sqliteInstance.exec('CREATE INDEX IF NOT EXISTS idx_items_level ON assessment_items(min_level)');
      sqliteInstance.exec('CREATE INDEX IF NOT EXISTS idx_items_extension ON assessment_items(extension_type)');
      log.info('assessment_items表重建完成');

      itemCountResult = await dbInstance
        .select({ count: count() })
        .from(schema.assessmentItems);
      itemCount = itemCountResult[0]?.count || 0;
      log.info(`重建后测评项表数据量: ${itemCount} 条`);
    } catch (e) {
      log.error('重建assessment_items表失败:', e);
    }
  }

  const itemsByStandard = await dbInstance
    .select({
      standardId: schema.assessmentItems.standardId,
      count: count()
    })
    .from(schema.assessmentItems)
    .groupBy(schema.assessmentItems.standardId);
  log.info('按标准统计测评项:', JSON.stringify(itemsByStandard));

  const oldStandardCount = await dbInstance
    .select()
    .from(schema.standards)
    .where(eq(schema.standards.code, 'GB/T 22239-2019'))
    .limit(1);

  if (oldStandardCount.length > 0) {
    log.info('检测到旧的三级标准库数据（GB/T 22239-2019），需要清理并重新导入...');
    await dbInstance.delete(schema.assessmentRecords);
    log.info('已删除所有测评记录');
    await dbInstance.delete(schema.assessmentItems);
    await dbInstance.delete(schema.standards).where(eq(schema.standards.code, 'GB/T 22239-2019'));
    itemCount = 0;
  }

  if (standardCount.length > 0 && itemCount > 0) {
    let needReimport = false;

    if (hasExtensionTypeField) {
      const extCountResult = await dbInstance
        .select({ count: count() })
        .from(schema.assessmentItems)
        .where(ne(schema.assessmentItems.extensionType, 'general'));
      const extCount = extCountResult[0]?.count || 0;

      if (extCount < 20) {
        log.info(`检测到扩展测评项数量不足(${extCount})，需重新导入标准库...`);
        needReimport = true;
      }
    }

    if (!needReimport) {
      try {
        const settingsResult = await dbInstance
          .select()
          .from(schema.systemSettings)
          .where(eq(schema.systemSettings.id, 'default'))
          .limit(1);
        const currentVersion = settingsResult[0]?.standardDataVersion || 0;
        if (currentVersion < STANDARD_DATA_VERSION) {
          log.info(`检测到标准数据版本过低(${currentVersion} < ${STANDARD_DATA_VERSION})，重新导入标准库...`);
          needReimport = true;
        }
      } catch (e) {
        log.warn('检查标准数据版本失败:', e);
      }
    }

    if (needReimport) {
      await dbInstance.delete(schema.assessmentRecords);
      log.info('已删除所有测评记录');
      await dbInstance.delete(schema.assessmentItems);
      itemCount = 0;
    } else {
      try {
        const { getStandardSeedL2 } = await import('./seeds/standard-gbt22239-l2');
        const seedL2 = getStandardSeedL2();

        const l2Count = await dbInstance
          .select({ count: count() })
          .from(schema.assessmentItems)
          .where(eq(schema.assessmentItems.standardId, 'gb-t-22239-2019-l2'));
        const l2ItemCount = l2Count[0]?.count || 0;

        if (l2ItemCount === 0 && seedL2.items.length > 0) {
          log.info(`检测到二级标准库缺失，开始导入 ${seedL2.items.length} 条二级测评项...`);

          const l2Standard = await dbInstance
            .select()
            .from(schema.standards)
            .where(eq(schema.standards.code, 'GB/T 22239-2019-L2'))
            .limit(1);

          if (l2Standard.length === 0) {
            await dbInstance.insert(schema.standards).values(seedL2.standard as typeof schema.standards.$inferInsert);
            log.info('已插入二级标准记录');
          }

          const batchSize = 50;
          for (let i = 0; i < seedL2.items.length; i += batchSize) {
            const batch = seedL2.items.slice(i, i + batchSize);
            await dbInstance.insert(schema.assessmentItems).values(batch as Array<typeof schema.assessmentItems.$inferInsert>);
          }
          log.info(`已插入 ${seedL2.items.length} 条二级测评项`);
        } else {
          log.info(`二级标准库已存在(${l2ItemCount}条)`);
        }
      } catch (e) {
        log.warn('检查/导入二级标准库失败:', e);
      }

      log.info('标准库已存在且数据完整，跳过初始化');
      return;
    }
  }

  try {
    const { getStandardSeed } = await import('./seeds/standard-gbt22239');
    const seed = getStandardSeed();

    log.info('初始化三级标准库:', seed.standard.name);

    if (standardCount.length === 0) {
      await dbInstance.insert(schema.standards).values(seed.standard as typeof schema.standards.$inferInsert);
      log.info('已插入三级标准记录');
    }

    if (itemCount === 0 && seed.items.length > 0) {
      const batchSize = 50;
      for (let i = 0; i < seed.items.length; i += batchSize) {
        const batch = seed.items.slice(i, i + batchSize);
        await dbInstance.insert(schema.assessmentItems).values(batch as Array<typeof schema.assessmentItems.$inferInsert>);
      }
      log.info(`已插入 ${seed.items.length} 条三级测评项`);
    }

    try {
      const { getStandardSeedL2 } = await import('./seeds/standard-gbt22239-l2');
      const seedL2 = getStandardSeedL2();

      const l2Count = await dbInstance
        .select({ count: count() })
        .from(schema.assessmentItems)
        .where(eq(schema.assessmentItems.standardId, 'gb-t-22239-2019-l2'));
      const l2ItemCount = l2Count[0]?.count || 0;

      const l2Standard = await dbInstance
        .select()
        .from(schema.standards)
        .where(eq(schema.standards.code, 'GB/T 22239-2019-L2'))
        .limit(1);

      if (l2Standard.length === 0) {
        await dbInstance.insert(schema.standards).values(seedL2.standard as typeof schema.standards.$inferInsert);
        log.info('已插入二级标准记录');
      }

      if (l2ItemCount === 0 && seedL2.items.length > 0) {
        const batchSize = 50;
        for (let i = 0; i < seedL2.items.length; i += batchSize) {
          const batch = seedL2.items.slice(i, i + batchSize);
          await dbInstance.insert(schema.assessmentItems).values(batch as Array<typeof schema.assessmentItems.$inferInsert>);
        }
        log.info(`已插入 ${seedL2.items.length} 条二级测评项`);
      } else {
        log.info(`二级标准库已存在(${l2ItemCount}条)，跳过导入`);
      }
    } catch (e) {
      log.warn('导入二级标准库失败:', e);
    }

    try {
      await dbInstance.update(schema.systemSettings)
        .set({ standardDataVersion: STANDARD_DATA_VERSION, updatedAt: new Date().toISOString() })
        .where(eq(schema.systemSettings.id, 'default'));
    } catch (e) {
      log.warn('更新标准数据版本失败:', e);
    }

    log.info(`标准库初始化完成`);
  } catch (error) {
    log.error('标准库初始化失败:', error);
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

    await dbInstance.delete(schema.knowledgeCommands);

    for (const cmd of seeds) {
      await dbInstance.insert(schema.knowledgeCommands).values({
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
      });
    }

    log.info('核查命令库初始化完成');
  } catch (error) {
    log.error('核查命令库初始化失败:', error);
  }
}
