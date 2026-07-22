import { ipcMain } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { getDb } from '../db';
import * as schema from '../db/schema';
import { eq, and, like, or } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { getAppDataPath } from '../main/paths';
import { wrap } from '../utils/ipc-wrapper';

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

  ipcMain.handle('knowledge:deleteCategory', wrap(async (_event, id: string) => {
      const db = getDb();
      const allIds: string[] = [];
      const queue: string[] = [id];
      while (queue.length > 0) {
        const currentId = queue.shift()!;
        allIds.push(currentId);
        const children = await db.select({ id: schema.knowledgeCategories.id })
          .from(schema.knowledgeCategories)
          .where(eq(schema.knowledgeCategories.parentId, currentId));
        queue.push(...children.map(c => c.id));
      }
      await db.transaction(async (tx) => {
        for (const cid of allIds) {
          await tx.update(schema.knowledgeDocuments)
            .set({ categoryId: '' })
            .where(eq(schema.knowledgeDocuments.categoryId, cid));
          await tx.delete(schema.knowledgeCategories).where(eq(schema.knowledgeCategories.id, cid));
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
      await db.insert(schema.knowledgeDocuments).values({
        ...data,
        id,
        uploadDate: now,
        createdAt: now,
        updatedAt: now,
      });
      return id;
    }));

  ipcMain.handle('knowledge:updateDocument', wrap(async (_event, id: string, data: any) => {
      const db = getDb();
      const now = new Date().toISOString();
      await db.update(schema.knowledgeDocuments).set({
        ...data,
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
    page?: number;
    pageSize?: number;
  }) => {
      const db = getDb();
      const { keyword, os, brand, deviceType, category, subCategory, page = 1, pageSize = 20 } = params;

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
      if (os) {
        conditions.push(like(schema.knowledgeCommands.os, `%${os}%`));
      }
      if (brand) {
        conditions.push(eq(schema.knowledgeCommands.brand, brand));
      }
      if (deviceType) {
        conditions.push(eq(schema.knowledgeCommands.deviceType, deviceType));
      }
      if (category) {
        conditions.push(eq(schema.knowledgeCommands.category, category));
      }
      if (subCategory) {
        conditions.push(eq(schema.knowledgeCommands.subCategory, subCategory));
      }

      if (conditions.length > 0) {
        query = query.where(and(...conditions));
      }

      const all = await query;

      // 排序：常用命令优先
      const sorted = [...all].sort((a, b) => {
        if (a.isFavorite && !b.isFavorite) return -1;
        if (!a.isFavorite && b.isFavorite) return 1;
        return 0;
      });

      const total = sorted.length;
      const list = sorted.slice((page - 1) * pageSize, page * pageSize);

      return { list, total };
    }));

  ipcMain.handle('knowledge:createCommand', wrap(async (_event, data: any) => {
      const db = getDb();
      const id = randomUUID();
      const now = new Date().toISOString();
      await db.insert(schema.knowledgeCommands).values({
        ...data,
        id,
        createdAt: now,
        updatedAt: now,
      });
      return { id, ...data };
    }));

  ipcMain.handle('knowledge:updateCommand', wrap(async (_event, id: string, data: any) => {
      const db = getDb();
      const now = new Date().toISOString();
      await db.update(schema.knowledgeCommands).set({
        ...data,
        updatedAt: now,
      }).where(eq(schema.knowledgeCommands.id, id));
      return { id, ...data };
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
      const errors: string[] = [];
      let imported = 0;

      try {
        if (!fs.existsSync(filePath)) {
          return { imported: 0, errors: ['文件不存在'] };
        }

        const stats = fs.statSync(filePath);
        if (stats.size > MAX_EXCEL_SIZE) {
          return { imported: 0, errors: [`文件大小超过限制 (${MAX_EXCEL_SIZE / 1024 / 1024}MB)`] };
        }

        const XLSX = require('xlsx');
        const workbook = XLSX.readFile(filePath);
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

      const fileName = `${Date.now()}_${fileInfo.name}`;
      const filePath = path.join(uploadDir, fileName);
      const buffer = Buffer.from(fileInfo.data);
      fs.writeFileSync(filePath, buffer);

      return { filePath, fileName };
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
        filePath: destPath,
        uploadDate: now,
        createdAt: now,
        updatedAt: now,
      });

      return id;
    }));

  // 读取文件内容
  ipcMain.handle('knowledge:readFile', wrap(async (_event, filePath: string) => {
      const content = fs.readFileSync(filePath, 'utf-8');
      return { content, fileName: path.basename(filePath) };
    }));

  // 删除上传的文件
  ipcMain.handle('knowledge:deleteFile', wrap(async (_event, filePath: string) => {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    }));

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
      if (!fs.existsSync(filePath)) {
        throw new Error('文件不存在');
      }
      const content = fs.readFileSync(filePath, 'utf-8');
      const data = JSON.parse(content);
      const db = getDb();
      const now = new Date().toISOString();
      let count = 0;

      if (data.commands && Array.isArray(data.commands)) {
        for (const cmd of data.commands) {
          const id = randomUUID();
          await db.insert(schema.knowledgeCommands).values({
            id,
            name: cmd.name || '',
            target: cmd.target || '',
            command: cmd.command || '',
            description: cmd.description || '',
            os: cmd.os || '',
            brand: cmd.brand || '',
            deviceType: cmd.deviceType || '',
            category: cmd.category || '',
            subCategory: cmd.subCategory || '',
            isFavorite: 0,
            createdAt: now,
            updatedAt: now,
          });
          count++;
        }
      }
      return { count };
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
      if (!doc.filePath || !fs.existsSync(doc.filePath)) {
        throw new Error('文档文件不存在');
      }
      return { path: doc.filePath, title: doc.title };
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
      if (!doc.filePath || !fs.existsSync(doc.filePath)) {
        return { saved: false };
      }
      const { dialog } = await import('electron');
      const ext = path.extname(doc.filePath);
      const defaultName = `${doc.title}${ext}`;
      const result2 = await dialog.showSaveDialog({
        defaultPath: defaultName,
        filters: [{ name: '文档', extensions: [ext.replace('.', '')] }],
      });
      if (result2.canceled || !result2.filePath) {
        return { saved: false };
      }
      fs.copyFileSync(doc.filePath, result2.filePath);
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
      if (!fs.existsSync(dirPath) || !fs.statSync(dirPath).isDirectory()) {
        throw new Error('目录不存在');
      }
      const items = fs.readdirSync(dirPath);
      return items.map(name => {
        const fullPath = path.join(dirPath, name);
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
      const workbook = XLSX.readFile(filePath);
      const sheets = workbook.SheetNames;
      const targetSheet = sheetName || sheets[0];
      const worksheet = workbook.Sheets[targetSheet];
      const data: any[] = XLSX.utils.sheet_to_json(worksheet);
      const columns = data.length > 0 ? Object.keys(data[0]) : [];
      return { sheetNames: sheets, columns, data };
    }));

  // 读取 Word 文件
  ipcMain.handle('knowledge:readWordFile', wrap(async (_event, filePath: string) => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const mammoth = require('mammoth');
      const result = await mammoth.convertToHtml({ path: filePath });
      return { html: result.value };
    }));
}
