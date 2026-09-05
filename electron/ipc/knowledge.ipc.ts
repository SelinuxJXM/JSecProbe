import { ipcMain } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { getDb } from '../db';
import * as schema from '../db/schema';
import { eq, and, like, or, sql } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { getAppDataPath } from '../main/paths';
import { wrap } from '../utils/ipc-wrapper';
import { toRelativePath, validateDataPath } from '../utils/path-resolver';

const MAX_EXCEL_SIZE = 50 * 1024 * 1024;
const MAX_EXCEL_ROWS = 10000;

export function registerKnowledgeHandlers(): void {
  ipcMain.handle('knowledge:listCategories', wrap(async () => {
      const db = getDb();
      const categories = await db
        .select()
        .from(schema.knowledgeCategories)
        .orderBy(schema.knowledgeCategories.sortOrder);

      const docs = await db.select({ categoryId: schema.knowledgeDocuments.categoryId })
        .from(schema.knowledgeDocuments);
      const countMap: Record<string, number> = {};
      for (const doc of docs) {
        countMap[doc.categoryId] = (countMap[doc.categoryId] || 0) + 1;
      }

      return categories.map(cat => ({
        ...cat,
        color: cat.color,
        documentCount: countMap[cat.id] || 0,
      }));
    }));

  ipcMain.handle('knowledge:createCategory', wrap(async (_event, data: any) => {
      const db = getDb();
      const id = randomUUID();
      const now = new Date().toISOString();
      await db.insert(schema.knowledgeCategories).values({
        id,
        name: data.name,
        parentId: data.parentId || null,
        icon: data.icon || 'Document',
        color: data.color || '#409EFF',
        sortOrder: data.sortOrder || 0,
        documentCount: 0,
        createdAt: now,
        updatedAt: now,
      });
      return { id, ...data };
    }));

  ipcMain.handle('knowledge:updateCategory', wrap(async (_event, id: string, data: any) => {
      const db = getDb();
      const now = new Date().toISOString();
      await db.update(schema.knowledgeCategories).set({
        ...data,
        updatedAt: now,
      }).where(eq(schema.knowledgeCategories.id, id));
      return { id, ...data };
    }));

  ipcMain.handle('knowledge:deleteCategory', wrap((_event, id: string) => {
      const db = getDb();
      const allIds: string[] = [];
      const queue: string[] = [id];
      while (queue.length > 0) {
        const currentId = queue.shift()!;
        allIds.push(currentId);
        const children = db.select({ id: schema.knowledgeCategories.id })
          .from(schema.knowledgeCategories)
          .where(eq(schema.knowledgeCategories.parentId, currentId))
          .all();
        queue.push(...children.map(c => c.id));
      }
      db.transaction((tx) => {
        for (const cid of allIds) {
          tx.update(schema.knowledgeDocuments)
            .set({ categoryId: '' })
            .where(eq(schema.knowledgeDocuments.categoryId, cid))
            .run();
          tx.delete(schema.knowledgeCategories)
            .where(eq(schema.knowledgeCategories.id, cid))
            .run();
        }
      });
    }));

  ipcMain.handle('knowledge:listDocuments', wrap(async (_event, params: {
    categoryId?: string;
    keyword?: string;
    type?: string;
    sortField?: string;
    sortOrder?: string;
    page?: number;
    pageSize?: number;
  }) => {
      const db = getDb();
      const { categoryId, keyword, type, sortField, sortOrder, page = 1, pageSize = 20 } = params;

      let query = db.select().from(schema.knowledgeDocuments).$dynamic();

      if (categoryId) {
        query = query.where(eq(schema.knowledgeDocuments.categoryId, categoryId));
      }

      const all = await query;

      let filtered = all;
      if (keyword) {
        const kw = keyword.toLowerCase();
        filtered = all.filter(doc =>
          doc.title.toLowerCase().includes(kw) ||
          doc.description?.toLowerCase().includes(kw) ||
          doc.content?.toLowerCase().includes(kw) ||
          doc.tags?.toLowerCase().includes(kw)
        );
      }
      if (type) {
        filtered = filtered.filter(doc => doc.type === type);
      }

      // 排序
      if (sortField) {
        filtered.sort((a: any, b: any) => {
          let valA = a[sortField] || '';
          let valB = b[sortField] || '';
          if (sortField === 'uploadDate') {
            valA = new Date(valA).getTime();
            valB = new Date(valB).getTime();
          } else {
            valA = String(valA).toLowerCase();
            valB = String(valB).toLowerCase();
          }
          if (valA < valB) return sortOrder === 'asc' ? -1 : 1;
          if (valA > valB) return sortOrder === 'asc' ? 1 : -1;
          return 0;
        });
      }

      const total = filtered.length;
      const list = filtered.slice((page - 1) * pageSize, page * pageSize);

      return { list, total };
    }));

  ipcMain.handle('knowledge:getDocument', wrap(async (_event, id: string) => {
      const db = getDb();
      const result = await db
        .select()
        .from(schema.knowledgeDocuments)
        .where(eq(schema.knowledgeDocuments.id, id))
        .limit(1);
      return result[0] || null;
    }));

  ipcMain.handle('knowledge:createDocument', wrap(async (_event, data: any) => {
      const db = getDb();
      const id = randomUUID();
      const now = new Date().toISOString();
      // 仅写入白名单字段，防止前端传入额外字段篡改内部列
      await db.insert(schema.knowledgeDocuments).values({
        id,
        categoryId: data.categoryId,
        title: data.title,
        type: data.type,
        filePath: data.filePath,
        content: data.content,
        description: data.description,
        version: data.version,
        tags: data.tags,
        uploadDate: now,
        createdAt: now,
        updatedAt: now,
      });
      return id;
    }));

  ipcMain.handle('knowledge:updateDocument', wrap(async (_event, id: string, data: any) => {
      const db = getDb();
      const now = new Date().toISOString();
      // 仅更新白名单字段，防止覆写 id/createdAt/referenceCount 等内部列
      await db.update(schema.knowledgeDocuments).set({
        categoryId: data.categoryId,
        title: data.title,
        type: data.type,
        filePath: data.filePath,
        content: data.content,
        description: data.description,
        version: data.version,
        tags: data.tags,
        updatedAt: now,
      }).where(eq(schema.knowledgeDocuments.id, id));
    }));

  ipcMain.handle('knowledge:deleteDocument', wrap(async (_event, id: string) => {
      const db = getDb();
      await db.delete(schema.knowledgeDocuments).where(eq(schema.knowledgeDocuments.id, id));
    }));

  ipcMain.handle('knowledge:listCommands', wrap(async (_event, params: {
    keyword?: string;
    os?: string;
    brand?: string;
    deviceType?: string;
    category?: string;
    subCategory?: string;
    // Phase 4 · 任务 30：行业维度筛选
    industry?: string;         // 精确匹配 industry 列（空字符串=通用）
    industryMode?: 'exact' | 'universal' | 'matchOrUniversal' | 'matchOrAll';  // exact=只 industry；universal=只通用；matchOrUniversal=industry + 通用（默认）；matchOrAll=industry + 所有其他
    // 项目级行业匹配（内部使用）：直接传项目 standardId，自动取 standards.industry 再筛选
    projectStandardId?: string;
    page?: number;
    pageSize?: number;
  }) => {
      const db = getDb();
      const {
        keyword, os, brand, deviceType, category, subCategory, industry, industryMode = 'matchOrUniversal',
        projectStandardId, page = 1, pageSize = 20,
      } = params;

      // 项目级行业：projectStandardId → standards.industry
      let resolvedIndustry: string | undefined;
      if (projectStandardId) {
        try {
          const [prow] = await db.select({ industry: schema.standards.industry })
            .from(schema.standards).where(eq(schema.standards.id, projectStandardId)).limit(1);
          if (prow?.industry) resolvedIndustry = prow.industry;
        } catch { /* ignore */ }
      }

      let query = db.select().from(schema.knowledgeCommands).$dynamic();
      const conditions: any[] = [];

      if (keyword) {
        const kw = `%${keyword}%`;
        conditions.push(
          or(
            like(schema.knowledgeCommands.name, kw),
            like(schema.knowledgeCommands.command, kw),
            like(schema.knowledgeCommands.description, kw)
          )
        );
      }
      if (os) conditions.push(like(schema.knowledgeCommands.os, `%${os}%`));
      if (brand) conditions.push(eq(schema.knowledgeCommands.brand, brand));
      if (deviceType) conditions.push(eq(schema.knowledgeCommands.deviceType, deviceType));
      if (category) conditions.push(eq(schema.knowledgeCommands.category, category));
      if (subCategory) conditions.push(eq(schema.knowledgeCommands.subCategory, subCategory));

      // 行业筛选（industry 精确匹配 + 或组合通用/其他）
      // 注意：前端 select 选中「仅通用」会传 industry="" + industryMode=universal，
      // 这时 effectiveIndustry 是 ''，但我们需要根据「模式」来判空，不能只看 truthy。
      const effectiveIndustry: string | undefined = (industry !== undefined && industry !== null)
        ? String(industry)
        : resolvedIndustry;
      const hasIndustryFilter = industryMode === 'universal' || !!effectiveIndustry;

      if (hasIndustryFilter) {
        if (industryMode === 'exact') {
          const target = effectiveIndustry ?? '';
          conditions.push(eq(schema.knowledgeCommands.industry, target));
        } else if (industryMode === 'universal') {
          conditions.push(eq(schema.knowledgeCommands.industry, ''));
        } else if (industryMode === 'matchOrAll') {
          const target = effectiveIndustry ?? '';
          if (target) {
            conditions.push(or(
              eq(schema.knowledgeCommands.industry, target),
              eq(schema.knowledgeCommands.industry, ''),
              like(schema.knowledgeCommands.industry, `%${target}%`),
            ));
          } else {
            // 无行业则回落到「全部」（行业过滤条件不追加）
          }
        } else { // matchOrUniversal：行业专属 + 通用命令
          const target = effectiveIndustry ?? '';
          if (target) {
            conditions.push(or(eq(schema.knowledgeCommands.industry, target), eq(schema.knowledgeCommands.industry, '')));
          } else {
            conditions.push(eq(schema.knowledgeCommands.industry, ''));
          }
        }
      }

      if (conditions.length > 0) {
        query = query.where(and(...conditions));
      }

      const all = await query;

      // 排序：行业匹配优先（和项目行业一致的排前面）> 收藏 > 引用数 > 名称
      // 注意：即使 effectiveIndustry=空字符串（仅通用）也仍要保持排序行为一致，不能把所有行判成“匹配”
      const priorityIndustry = effectiveIndustry ? String(effectiveIndustry) : '';
      const sorted = [...all].sort((a: any, b: any) => {
        const priority = (x: any) => {
          const xi = typeof x.industry === 'string' ? x.industry : '';
          // 匹配当前过滤行业（优先级 0） > 通用命令（1） > 其他行业（2）
          if (priorityIndustry && xi === priorityIndustry) return 0;
          if (xi === '') return 1;
          return 2;
        };
        const aMatch = priority(a);
        const bMatch = priority(b);
        if (aMatch !== bMatch) return aMatch - bMatch;
        const favA = Number(a.isFavorite) || 0;
        const favB = Number(b.isFavorite) || 0;
        if (favA !== favB) return favB - favA; // 收藏=1 在前
        const refA = Number(a.referenceCount) || 0;
        const refB = Number(b.referenceCount) || 0;
        if (refA !== refB) return refB - refA;
        return ((a.name || '') as string).localeCompare((b.name || '') as string, 'zh-Hans-CN');
      });

      const total = sorted.length;
      const safePage = Math.max(1, Number.isFinite(page) ? Number(page) : 1);
      const safeSize = Math.max(1, Math.min(500, Number.isFinite(pageSize) ? Number(pageSize) : 20));
      const start = (safePage - 1) * safeSize;
      const list = sorted.slice(start, start + safeSize);

      // 兼容返回：
      // - 当传的是 projectStandardId 但该标准无 industry 时，matchedIndustry 置空避免前端误显示
      // - 当用户显式传 industry 但不存在任何通用/行业命令时，也保持返回
      let displayMatched: string | null = null;
      if (projectStandardId) {
        displayMatched = resolvedIndustry && String(resolvedIndustry).trim() ? String(resolvedIndustry).trim() : null;
      } else if (industry !== undefined && industry !== null) {
        displayMatched = String(industry);
      }
      return { list, total, matchedIndustry: displayMatched };
    }));

  // Phase 4 · 任务 30：列出命令库存在的行业值（去重，按命令数倒序），用于下拉筛选
  ipcMain.handle('knowledge:listCommandIndustries', wrap(async () => {
    const db = getDb();
    const rows = await db
      .select({ industry: schema.knowledgeCommands.industry, count: sql<number>`count(*)`.mapWith(Number).as('count') })
      .from(schema.knowledgeCommands)
      .groupBy(schema.knowledgeCommands.industry)
      .orderBy(sql`count(*) desc`);
    return rows.map((r: any) => ({
      industry: (r && typeof r.industry === 'string') ? r.industry : '',
      count: Number(r?.count) || 0,
    }));
  }));

  ipcMain.handle('knowledge:createCommand', wrap(async (_event, data: any) => {
      const db = getDb();
      const id = randomUUID();
      const now = new Date().toISOString();
      const industry = typeof data?.industry === 'string' ? data.industry : '';
      // 仅写入白名单字段，防止前端传入额外字段篡改内部列
      const commandData = {
        id,
        name: data.name,
        target: data.target,
        command: data.command,
        description: data.description,
        os: data.os,
        brand: data.brand,
        deviceType: data.deviceType,
        category: data.category,
        subCategory: data.subCategory,
        industry,
        createdAt: now,
        updatedAt: now,
      };
      await db.insert(schema.knowledgeCommands).values(commandData);
      return commandData;
    }));

  ipcMain.handle('knowledge:updateCommand', wrap(async (_event, id: string, data: any) => {
      const db = getDb();
      const now = new Date().toISOString();
      const industry = typeof data?.industry === 'string' ? data.industry : '';
      // 仅更新白名单字段，防止覆写 id/createdAt/referenceCount 等内部列
      const patch = {
        name: data.name,
        target: data.target,
        command: data.command,
        description: data.description,
        os: data.os,
        brand: data.brand,
        deviceType: data.deviceType,
        category: data.category,
        subCategory: data.subCategory,
        industry,
        isFavorite: data.isFavorite,
        updatedAt: now,
      };
      await db.update(schema.knowledgeCommands).set(patch).where(eq(schema.knowledgeCommands.id, id));
      return { id, ...patch };
    }));

  ipcMain.handle('knowledge:deleteCommand', wrap(async (_event, id: string) => {
      const db = getDb();
      await db.delete(schema.knowledgeCommands).where(eq(schema.knowledgeCommands.id, id));
    }));

  ipcMain.handle('knowledge:favoriteCommand', wrap(async (_event, id: string, isFavorite: number) => {
      const db = getDb();
      await db.update(schema.knowledgeCommands)
        .set({ isFavorite })
        .where(eq(schema.knowledgeCommands.id, id));
    }));

  // 导入 Excel
  ipcMain.handle('knowledge:importExcel', wrap(async (_event, filePath: string) => {
      // 先校验路径，防止读取应用数据目录之外的任意文件
      const resolvedPath = await validateDataPath(filePath);
      const errors: string[] = [];
      let imported = 0;

      try {
        if (!fs.existsSync(resolvedPath)) {
          return { imported: 0, errors: ['文件不存在'] };
        }

        const stats = fs.statSync(resolvedPath);
        if (stats.size > MAX_EXCEL_SIZE) {
          return { imported: 0, errors: [`文件大小超过限制 (${MAX_EXCEL_SIZE / 1024 / 1024}MB)`] };
        }

        const XLSX = require('xlsx');
        const workbook = XLSX.readFile(resolvedPath);
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const rows: any[] = XLSX.utils.sheet_to_json(worksheet);

        if (rows.length > MAX_EXCEL_ROWS) {
          return { imported: 0, errors: [`数据行数超过限制 (${MAX_EXCEL_ROWS}行)`] };
        }

        const db = getDb();

        for (const row of rows) {
          try {
            const id = randomUUID();
            const now = new Date().toISOString();
            const industry = row['行业'] || row['industry'] || row['适用行业'] || '';
            await db.insert(schema.knowledgeCommands).values({
              id,
              name: row['名称'] || row['name'] || '',
              target: row['目标'] || row['target'] || row['名称'] || row['name'] || '',
              command: row['命令'] || row['command'] || '',
              description: row['描述'] || row['description'] || '',
              os: row['操作系统'] || row['os'] || '',
              brand: row['品牌'] || row['brand'] || '',
              deviceType: row['设备类型'] || row['deviceType'] || '',
              category: row['分类'] || row['category'] || '',
              subCategory: row['子分类'] || row['subCategory'] || '',
              industry: typeof industry === 'string' ? industry : '',
              isFavorite: 0,
              createdAt: now,
              updatedAt: now,
            });
            imported++;
          } catch (err: any) {
            errors.push(`第 ${imported + errors.length + 1} 行导入失败: ${err.message}`);
          }
        }

        return { imported, errors };
      } catch (err: any) {
        return { imported, errors: [`导入失败: ${err.message}`] };
      }
    }));

  // 上传文件到知识库
  ipcMain.handle('knowledge:uploadFile', wrap(async (_event, fileInfo: { name: string; data: number[] }) => {
      const basePath = await getAppDataPath();
      const uploadDir = path.join(basePath, 'knowledge', 'uploads');
      if (!fs.existsSync(uploadDir)) {
        fs.mkdirSync(uploadDir, { recursive: true });
      }

      // 使用 path.basename 剥离文件名中的路径分隔符，防止前端传入含 '../' 的文件名导致写入 uploadDir 之外的任意位置
      const fileName = `${Date.now()}_${path.basename(fileInfo.name)}`;
      const filePath = path.join(uploadDir, fileName);
      const buffer = Buffer.from(fileInfo.data);
      fs.writeFileSync(filePath, buffer);

      const relativePath = await toRelativePath(filePath);
      return { filePath: relativePath, fileName };
    }));

  // 上传文档（将文件复制到上传目录并创建数据库记录）
  ipcMain.handle('knowledge:uploadDocument', wrap(async (_event, data: {
    categoryId: string;
    title: string;
    type: string;
    description?: string;
    version?: string;
    tags?: string;
    filePath: string;
  }) => {
      const { categoryId, title, type, description, version, tags, filePath: srcPath } = data;

      if (!fs.existsSync(srcPath)) {
        throw new Error('源文件不存在');
      }

      const basePath = await getAppDataPath();
      const uploadDir = path.join(basePath, 'knowledge', 'uploads');
      if (!fs.existsSync(uploadDir)) {
        fs.mkdirSync(uploadDir, { recursive: true });
      }

      const ext = path.extname(srcPath);
      const fileName = `${Date.now()}_${randomUUID().slice(0, 8)}${ext}`;
      const destPath = path.join(uploadDir, fileName);
      fs.copyFileSync(srcPath, destPath);

      const relativePath = await toRelativePath(destPath);

      const db = getDb();
      const id = randomUUID();
      const now = new Date().toISOString();
      await db.insert(schema.knowledgeDocuments).values({
        id,
        categoryId,
        title,
        type: type || 'standard',
        description: description || '',
        version: version || '1.0',
        tags: tags || '',
        filePath: relativePath,
        uploadDate: now,
        createdAt: now,
        updatedAt: now,
      });

      return id;
    }));

  // 读取文件内容
  ipcMain.handle('knowledge:readFile', wrap(async (_event, filePath: string) => {
      const resolvedPath = await validateDataPath(filePath);
      const content = fs.readFileSync(resolvedPath, 'utf-8');
      return { content, fileName: path.basename(resolvedPath) };
    }, { moduleName: 'knowledge', requireSession: true }));

    // 删除上传的文件
    ipcMain.handle('knowledge:deleteFile', wrap(async (_event, filePath: string) => {
        const resolvedPath = await validateDataPath(filePath);
        if (fs.existsSync(resolvedPath)) {
          fs.unlinkSync(resolvedPath);
        }
      }, { moduleName: 'knowledge', requireSession: true }));

  // 获取知识库统计
  ipcMain.handle('knowledge:getStats', wrap(async () => {
      const db = getDb();
      const categories = await db.select().from(schema.knowledgeCategories);
      const documents = await db.select().from(schema.knowledgeDocuments);
      const commands = await db.select().from(schema.knowledgeCommands);

      return {
        categoryCount: categories.length,
        documentCount: documents.length,
        commandCount: commands.length,
      };
    }));

  // 导入知识库（从JSON文件批量导入命令）
  ipcMain.handle('knowledge:importKnowledge', wrap(async (_event, filePath: string) => {
      // 先校验路径，防止读取应用数据目录之外的任意文件
      const resolvedPath = await validateDataPath(filePath);
      if (!fs.existsSync(resolvedPath)) {
        throw new Error('文件不存在');
      }
      const content = fs.readFileSync(resolvedPath, 'utf-8');
      let data: any = null;
      try {
        data = JSON.parse(content);
      } catch (e: any) {
        throw new Error(`JSON 解析失败：${e?.message || '非法 JSON'}`);
      }
      if (!data || typeof data !== 'object') {
        throw new Error('JSON 顶层必须是对象 { commands: [...] }');
      }
      const db = getDb();
      const now = new Date().toISOString();
      let count = 0;
      let skipped = 0;

      if (data.commands && Array.isArray(data.commands)) {
        for (const cmd of data.commands) {
          // 兼容性：旧版本导出 JSON 可能缺 industry、缺失必选字段；缺必填则跳过，不中断整批
          if (!cmd || typeof cmd !== 'object') { skipped++; continue; }
          const name = typeof cmd.name === 'string' ? cmd.name.trim() : '';
          const command = typeof cmd.command === 'string' ? cmd.command : '';
          if (!name || !command) { skipped++; continue; }
          const id = randomUUID();
          const industry = typeof cmd.industry === 'string' ? cmd.industry : '';
          try {
            await db.insert(schema.knowledgeCommands).values({
              id,
              name,
              target: typeof cmd.target === 'string' ? cmd.target : '',
              command,
              description: typeof cmd.description === 'string' ? cmd.description : '',
              os: typeof cmd.os === 'string' ? cmd.os : '',
              brand: typeof cmd.brand === 'string' ? cmd.brand : '',
              deviceType: typeof cmd.deviceType === 'string' ? cmd.deviceType : '',
              category: typeof cmd.category === 'string' ? cmd.category : '',
              subCategory: typeof cmd.subCategory === 'string' ? cmd.subCategory : '',
              industry,
              isFavorite: Number(cmd.isFavorite) === 1 ? 1 : 0,
              createdAt: now,
              updatedAt: now,
            });
            count++;
          } catch (e) {
            skipped++;
          }
        }
      }
      return { count, skipped };
    }));

  // 导出知识库（导出命令到JSON文件）
  ipcMain.handle('knowledge:exportKnowledge', wrap(async () => {
      const db = getDb();
      const commands = await db.select().from(schema.knowledgeCommands);
      return { commands };
    }));

  // 下载文档（获取文档路径）
  ipcMain.handle('knowledge:downloadDocument', wrap(async (_event, id: string) => {
      const db = getDb();
      const result = await db.select().from(schema.knowledgeDocuments)
        .where(eq(schema.knowledgeDocuments.id, id)).limit(1);
      const doc = result[0];
      if (!doc) {
        throw new Error('文档不存在');
      }
      if (!doc.filePath) {
        throw new Error('文档文件路径为空');
      }
      const resolvedPath = await validateDataPath(doc.filePath);
      if (!fs.existsSync(resolvedPath)) {
        throw new Error('文档文件不存在');
      }
      return { path: resolvedPath, title: doc.title };
    }));

    // 下载并保存文档（复制到用户选择的位置）
    ipcMain.handle('knowledge:downloadAndSave', wrap(async (_event, id: string) => {
      const db = getDb();
      const result = await db.select().from(schema.knowledgeDocuments)
        .where(eq(schema.knowledgeDocuments.id, id)).limit(1);
      const doc = result[0];
      if (!doc) {
        throw new Error('文档不存在');
      }
      if (!doc.filePath) {
        return { saved: false };
      }
      const resolvedPath = await validateDataPath(doc.filePath);
      if (!fs.existsSync(resolvedPath)) {
        return { saved: false };
      }
      const { dialog } = await import('electron');
      const ext = path.extname(resolvedPath);
      const defaultName = `${doc.title}${ext}`;
      const result2 = await dialog.showSaveDialog({
        defaultPath: defaultName,
        filters: [{ name: '文档', extensions: [ext.replace('.', '')] }],
      });
      if (result2.canceled || !result2.filePath) {
        return { saved: false };
      }
      fs.copyFileSync(resolvedPath, result2.filePath);
      return { saved: true, path: result2.filePath };
    }));

  // 引用文档
  ipcMain.handle('knowledge:referenceDocument', wrap(async (_event, data: {
    documentId: string;
    targetId: string;
    targetType: string;
  }) => {
      const db = getDb();
      const result = await db.select({ referenceCount: schema.knowledgeDocuments.referenceCount })
        .from(schema.knowledgeDocuments)
        .where(eq(schema.knowledgeDocuments.id, data.documentId))
        .limit(1);
      if (result[0]) {
        await db.update(schema.knowledgeDocuments)
          .set({ referenceCount: (result[0].referenceCount || 0) + 1 })
          .where(eq(schema.knowledgeDocuments.id, data.documentId));
      }
    }));

  // 导入单个文档
  ipcMain.handle('knowledge:importSingleDocument', wrap(async (_event, data: {
    categoryId: string;
    title: string;
    type: string;
    description?: string;
    version?: string;
    tags?: string;
    filePath: string;
  }) => {
      const db = getDb();
      const id = randomUUID();
      const now = new Date().toISOString();
      await db.insert(schema.knowledgeDocuments).values({
        id,
        categoryId: data.categoryId,
        title: data.title,
        type: data.type || 'standard',
        description: data.description || '',
        version: data.version || '1.0',
        tags: data.tags || '',
        filePath: data.filePath,
        uploadDate: now,
        createdAt: now,
        updatedAt: now,
      });
      return { id };
    }));

  // 列出目录文件
  ipcMain.handle('knowledge:listDirectoryFiles', wrap(async (_event, dirPath: string) => {
      // 先校验路径，防止列举应用数据目录之外的任意目录
      const resolvedPath = await validateDataPath(dirPath);
      if (!fs.existsSync(resolvedPath) || !fs.statSync(resolvedPath).isDirectory()) {
        throw new Error('目录不存在');
      }
      const items = fs.readdirSync(resolvedPath);
      return items.map(name => {
        const fullPath = path.join(resolvedPath, name);
        const stat = fs.statSync(fullPath);
        return {
          name,
          path: fullPath,
          size: stat.size,
          isFile: stat.isFile(),
        };
      });
    }));

  // 读取 Excel 文件
  ipcMain.handle('knowledge:readExcelFile', wrap(async (_event, filePath: string, sheetName?: string) => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const XLSX = require('xlsx');
      const resolvedPath = await validateDataPath(filePath);
      const workbook = XLSX.readFile(resolvedPath);
      const sheets = workbook.SheetNames;
      const targetSheet = sheetName || sheets[0];
      const worksheet = workbook.Sheets[targetSheet];
      const data: any[] = XLSX.utils.sheet_to_json(worksheet);
      const columns = data.length > 0 ? Object.keys(data[0]) : [];
      return { sheetNames: sheets, columns, data };
    }, { moduleName: 'knowledge', requireSession: true }));

  // 读取 Word 文件
  ipcMain.handle('knowledge:readWordFile', wrap(async (_event, filePath: string) => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const mammoth = require('mammoth');
      const resolvedPath = await validateDataPath(filePath);
      const result = await mammoth.convertToHtml({ path: resolvedPath });
      return { html: result.value };
    }, { moduleName: 'knowledge', requireSession: true }));
}
