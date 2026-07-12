import Database from 'better-sqlite3';
import { drizzle, BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { join } from 'path';
import * as fs from 'fs';
import log from 'electron-log';
import * as schema from './schema';
import { getDbPath } from '../main/paths';
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

export async function initDatabase(): Promise<void> {
  try {
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
    log.info('执行数据库迁移:', migrationsPath);
    
    await ensureTablesExist(sqlite);
    
    const metaJournalPath = join(migrationsPath, 'meta', '_journal.json');
    if (fs.existsSync(metaJournalPath)) {
      try {
        migrate(db, { migrationsFolder: migrationsPath });
        log.info('数据库迁移完成');
      } catch (migrateError) {
        log.error('数据库迁移失败:', migrateError);
        throw new Error(`数据库迁移失败: ${migrateError instanceof Error ? migrateError.message : String(migrateError)}`);
      }
    } else {
      log.info('迁移元数据文件不存在，跳过数据库迁移（使用手动建表）');
    }
    
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

async function ensureTablesExist(sqlite: Database.Database): Promise<void> {
  log.info('手动创建数据库表...');
  
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
      last_login_at TEXT,
      created_at TEXT NOT NULL,
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
      is_assessment_target INTEGER NOT NULL DEFAULT 1,
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
      category TEXT NOT NULL DEFAULT '',
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
  
  log.info('数据库表创建完成，开始升级旧表结构...');

  const alterStatements: Array<{ table: string; column: string; definition: string }> = [
    { table: 'users', column: 'email', definition: 'TEXT' },
    { table: 'users', column: 'phone', definition: 'TEXT' },
    { table: 'users', column: 'last_login_at', definition: 'TEXT' },
    { table: 'users', column: 'must_change_password', definition: 'INTEGER DEFAULT 1' },
    { table: 'projects', column: 'project_no', definition: 'TEXT' },
    { table: 'projects', column: 'assessed_unit', definition: 'TEXT' },
    { table: 'projects', column: 'standard_system', definition: 'TEXT' },
    { table: 'projects', column: 'level_combo', definition: 'TEXT' },
    { table: 'projects', column: 'extension_type', definition: 'TEXT' },
    { table: 'projects', column: 'compliance_rate', definition: 'REAL' },
    { table: 'projects', column: 'progress', definition: 'INTEGER DEFAULT 0' },
    { table: 'assets', column: 'position', definition: 'TEXT' },
    { table: 'assets', column: 'db_system', definition: 'TEXT' },
    { table: 'assets', column: 'middleware', definition: 'TEXT' },
    { table: 'assessment_items', column: 'min_level', definition: 'INTEGER NOT NULL DEFAULT 2' },
    { table: 'assessment_items', column: 'max_level', definition: 'INTEGER NOT NULL DEFAULT 4' },
    { table: 'assessment_items', column: 'extension_type', definition: "TEXT NOT NULL DEFAULT 'general'" },
    { table: 'assessment_items', column: 'control_point', definition: 'TEXT' },
    { table: 'assessment_items', column: 'control_name', definition: 'TEXT' },
    { table: 'assessment_items', column: 'is_high_risk', definition: 'INTEGER DEFAULT 0' },
    { table: 'assessment_items', column: 'parent_id', definition: 'TEXT' },
    { table: 'assessment_records', column: 'method', definition: "TEXT DEFAULT 'check'" },
    { table: 'assessment_records', column: 'command_output', definition: 'TEXT' },
    { table: 'assessment_records', column: 'screenshot_paths', definition: 'TEXT' },
    { table: 'issues', column: 'security_domain', definition: 'TEXT' },
    { table: 'issues', column: 'control_point', definition: 'TEXT' },
    { table: 'issues', column: 'control_name', definition: 'TEXT' },
    { table: 'issues', column: 'rectification_suggestion', definition: 'TEXT' },
    { table: 'issues', column: 'rectification_deadline', definition: 'TEXT' },
    { table: 'issues', column: 'fixed_description', definition: 'TEXT' },
    { table: 'issues', column: 'fixed_date', definition: 'TEXT' },
    { table: 'issues', column: 'evidence_files', definition: 'TEXT' },
    { table: 'knowledge_categories', column: 'parent_id', definition: 'TEXT' },
    { table: 'knowledge_categories', column: 'icon_color', definition: 'TEXT' },
    { table: 'knowledge_categories', column: 'document_count', definition: 'INTEGER DEFAULT 0' },
    { table: 'knowledge_categories', column: 'created_at', definition: 'TEXT' },
    { table: 'knowledge_categories', column: 'updated_at', definition: 'TEXT' },
    { table: 'knowledge_documents', column: 'type', definition: "TEXT DEFAULT 'markdown'" },
    { table: 'knowledge_documents', column: 'version', definition: "TEXT DEFAULT '1.0'" },
    { table: 'knowledge_documents', column: 'reference_count', definition: 'INTEGER DEFAULT 0' },
    { table: 'knowledge_documents', column: 'upload_date', definition: 'TEXT' },
    { table: 'knowledge_commands', column: 'brand', definition: "TEXT DEFAULT ''" },
    { table: 'knowledge_commands', column: 'device_type', definition: "TEXT DEFAULT ''" },
    { table: 'knowledge_commands', column: 'sub_category', definition: "TEXT DEFAULT ''" },
    { table: 'ai_configs', column: 'api_base', definition: 'TEXT' },
    { table: 'ai_configs', column: 'enable_ai', definition: 'INTEGER NOT NULL DEFAULT 0' },
    { table: 'ai_configs', column: 'ocr_api_key', definition: 'TEXT' },
    { table: 'ai_configs', column: 'privacy_mode', definition: 'INTEGER NOT NULL DEFAULT 0' },
    { table: 'ai_configs', column: 'sensitive_words', definition: 'TEXT' },
    { table: 'ai_configs', column: 'created_at', definition: "TEXT NOT NULL DEFAULT ''" },
    { table: 'system_settings', column: 'data_path', definition: 'TEXT' },
    { table: 'system_settings', column: 'default_standard', definition: "TEXT DEFAULT 'gb-t-22239-2019-l3'" },
    { table: 'system_settings', column: 'standard_data_version', definition: 'INTEGER NOT NULL DEFAULT 1' },
    { table: 'standards', column: 'grade', definition: 'INTEGER DEFAULT 3' },
    { table: 'standards', column: 'is_default', definition: 'INTEGER DEFAULT 0' },
    { table: 'standards', column: 'created_at', definition: 'TEXT DEFAULT NULL' },
  ];

  for (const { table, column, definition } of alterStatements) {
    try {
      const colInfo = sqlite
        .prepare(`PRAGMA table_info(${table})`)
        .all() as Array<{ name: string }>;
      const colExists = colInfo.some((c) => c.name === column);
      if (!colExists) {
        sqlite.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
        log.info(`添加列: ${table}.${column}`);
      }
    } catch (err) {
      log.warn(`升级列 ${table}.${column} 失败:`, err);
    }
  }

  log.info('数据库表结构升级完成');

  createIndexes(sqlite);
}

function createIndexes(sqlite: Database.Database): void {
  try {
    sqlite.exec(`
      CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status);
      CREATE INDEX IF NOT EXISTS idx_assets_project_id ON assets(project_id);
      CREATE INDEX IF NOT EXISTS idx_assessment_items_standard_domain ON assessment_items(standard_id, domain);
      CREATE INDEX IF NOT EXISTS idx_assessment_items_level ON assessment_items(min_level);
      CREATE INDEX IF NOT EXISTS idx_assessment_items_extension ON assessment_items(extension_type);
      CREATE INDEX IF NOT EXISTS idx_assessment_records_project_id ON assessment_records(project_id);
      CREATE INDEX IF NOT EXISTS idx_assessment_records_item_id ON assessment_records(item_id);
      CREATE INDEX IF NOT EXISTS idx_issues_project_id ON issues(project_id);
      CREATE INDEX IF NOT EXISTS idx_issues_project_risk ON issues(project_id, risk_level);
      CREATE INDEX IF NOT EXISTS idx_issues_project_status ON issues(project_id, status);
      CREATE INDEX IF NOT EXISTS idx_issues_project_domain ON issues(project_id, security_domain);
      CREATE INDEX IF NOT EXISTS idx_issues_asset_id ON issues(asset_id);
      CREATE INDEX IF NOT EXISTS idx_issues_item_id ON issues(item_id);
      CREATE INDEX IF NOT EXISTS idx_knowledge_documents_category ON knowledge_documents(category_id);
      CREATE INDEX IF NOT EXISTS idx_knowledge_documents_title ON knowledge_documents(title);
    `);
  } catch (err) {
    log.warn('创建索引失败（可能是旧数据库缺少列）:', err);
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
    const bcrypt = await import('bcryptjs');
    const now = new Date().toISOString();
    const passwordHash = bcrypt.default?.hashSync('admin123', 12) || bcrypt.hashSync('admin123', 12);
    
    await dbInstance.insert(schema.users).values({
      id: 'default_admin',
      username: 'admin',
      passwordHash,
      realName: '系统管理员',
      role: 'admin',
      isActive: 1,
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

  const standardCount = await dbInstance
    .select()
    .from(schema.standards)
    .where(eq(schema.standards.code, 'GB/T 22239-2019-L3'))
    .limit(1);
  
  // 检查测评项表中的数据
  let itemCountResult = await dbInstance
    .select({ count: count() })
    .from(schema.assessmentItems);
  let itemCount = itemCountResult[0]?.count || 0;
  log.info(`测评项表当前数据量: ${itemCount} 条`);
  
  // 查看assessment_items表的实际列结构
  let hasSectionField = false;
  let hasMinLevelField = false;
  let hasExtensionTypeField = false;
  try {
    if (!sqliteInstance) throw new Error('数据库未初始化');
    const tableInfo = sqliteInstance.prepare('PRAGMA table_info(assessment_items)').all() as any[];
    log.info('assessment_items 表结构:', JSON.stringify(tableInfo.map(c => ({ name: c.name, type: c.type, notnull: c.notnull, dflt_value: c.dflt_value }))));
    hasSectionField = tableInfo.some(c => c.name === 'section');
    hasMinLevelField = tableInfo.some(c => c.name === 'min_level');
    hasExtensionTypeField = tableInfo.some(c => c.name === 'extension_type');
  } catch (e) {
    log.warn('获取表结构失败:', e);
  }
  
  // 检查表结构是否需要升级
  const needRebuild = hasSectionField || !hasMinLevelField || !hasExtensionTypeField;

  // 检查 level 列是否有 NOT NULL 约束（旧数据库问题）
  let levelNotNull = false;
  try {
    if (sqliteInstance) {
      const colInfo = sqliteInstance.prepare("PRAGMA table_info(assessment_items)").all() as any[];
      const levelCol = colInfo.find((c: any) => c.name === 'level');
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
      
      // 重建后重新获取数据量
      itemCountResult = await dbInstance
        .select({ count: count() })
        .from(schema.assessmentItems);
      itemCount = itemCountResult[0]?.count || 0;
      log.info(`重建后测评项表数据量: ${itemCount} 条`);
    } catch (e) {
      log.error('重建assessment_items表失败:', e);
    }
  }
  
  // 按标准统计测评项
  const itemsByStandard = await dbInstance
    .select({
      standardId: schema.assessmentItems.standardId,
      count: count()
    })
    .from(schema.assessmentItems)
    .groupBy(schema.assessmentItems.standardId);
  log.info('按标准统计测评项:', JSON.stringify(itemsByStandard));
  
  const STANDARD_DATA_VERSION = 7;

  // 检查是否存在旧的三级标准库数据（旧编码 GB/T 22239-2019）
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
      // 检查二级标准库是否存在
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
            await dbInstance.insert(schema.standards).values(seedL2.standard as any);
            log.info('已插入二级标准记录');
          }
          
          const batchSize = 50;
          for (let i = 0; i < seedL2.items.length; i += batchSize) {
            const batch = seedL2.items.slice(i, i + batchSize);
            await dbInstance.insert(schema.assessmentItems).values(batch as any[]);
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
      await dbInstance.insert(schema.standards).values(seed.standard as any);
      log.info('已插入三级标准记录');
    }
    
    if (itemCount === 0 && seed.items.length > 0) {
      const batchSize = 50;
      for (let i = 0; i < seed.items.length; i += batchSize) {
        const batch = seed.items.slice(i, i + batchSize);
        await dbInstance.insert(schema.assessmentItems).values(batch as any[]);
      }
      log.info(`已插入 ${seed.items.length} 条三级测评项`);
    }
    
    // 导入二级标准库
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
        await dbInstance.insert(schema.standards).values(seedL2.standard as any);
        log.info('已插入二级标准记录');
      }
      
      if (l2ItemCount === 0 && seedL2.items.length > 0) {
        const batchSize = 50;
        for (let i = 0; i < seedL2.items.length; i += batchSize) {
          const batch = seedL2.items.slice(i, i + batchSize);
          await dbInstance.insert(schema.assessmentItems).values(batch as any[]);
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
    
    // 始终清空并重新初始化知识库，确保种子数据更新生效
    log.info('初始化知识库：清空旧数据并重新导入种子数据...');
    await dbInstance.delete(schema.knowledgeDocuments);
    await dbInstance.delete(schema.knowledgeCategories);
    
    log.info('初始化知识库:', seed.categories.length + '个分类，' + seed.documents.length + '篇文档');
    
    if (seed.categories.length > 0) {
      await dbInstance.insert(schema.knowledgeCategories).values(seed.categories as any[]);
    }
    
    if (seed.documents.length > 0) {
      const batchSize = 20;
      for (let i = 0; i < seed.documents.length; i += batchSize) {
        const batch = seed.documents.slice(i, i + batchSize);
        await dbInstance.insert(schema.knowledgeDocuments).values(batch as any[]);
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
