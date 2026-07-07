import { ipcMain, dialog } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import log from 'electron-log';
import { getDb } from '../db';
import * as schema from '../db/schema';
import { eq, and, desc, like, or, asc, sql } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { getAppDataPath } from '../main/paths';

async function getAllowedBasePaths(): Promise<string[]> {
  const dataPath = await getAppDataPath();
  return [
    dataPath,
    path.join(dataPath, 'screenshots'),
    path.join(dataPath, 'evidence'),
    path.join(dataPath, 'knowledge'),
    path.join(dataPath, 'temp'),
    path.join(dataPath, 'backups'),
  ];
}

async function validatePath(inputPath: string): Promise<string> {
  const resolved = path.resolve(inputPath);
  const allowedPaths = await getAllowedBasePaths();
  const isAllowed = allowedPaths.some(base => {
    const resolvedBase = path.resolve(base);
    return resolved === resolvedBase || resolved.startsWith(resolvedBase + path.sep);
  });
  if (!isAllowed) {
    throw new Error(`路径访问被拒绝: ${inputPath} (仅允许访问应用数据目录)`);
  }
  return resolved;
}

const MAX_EXCEL_SIZE = 50 * 1024 * 1024;
const MAX_EXCEL_ROWS = 10000;

function wrap<T>(fn: () => T | Promise<T>): Promise<any> {
  return Promise.resolve()
    .then(fn)
    .then((data) => ({ success: true, data }))
    .catch((error) => {
      log.error('Knowledge IPC Error:', error);
      return {
        success: false,
        error: {
          code: error.code || 'INTERNAL_ERROR',
          message: error.message || '操作失败',
        },
      };
    });
}

export function registerKnowledgeHandlers(): void {
  ipcMain.handle('knowledge:listCategories', () =>
    wrap<any[]>(async () => {
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
    })
  );

  ipcMain.handle('knowledge:createCategory', (_event, data: any) =>
    wrap<any>(async () => {
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
    })
  );

  ipcMain.handle('knowledge:updateCategory', (_event, id: string, data: any) =>
    wrap<void>(async () => {
      const db = getDb();
      const now = new Date().toISOString();
      await db.update(schema.knowledgeCategories).set({
        ...data,
        updatedAt: now,
      }).where(eq(schema.knowledgeCategories.id, id));
    })
  );

  ipcMain.handle('knowledge:deleteCategory', (_event, id: string) =>
    wrap<void>(async () => {
      const db = getDb();
      const getAllChildren = async (parentId: string): Promise<string[]> => {
        const children = await db.select({ id: schema.knowledgeCategories.id })
          .from(schema.knowledgeCategories)
          .where(eq(schema.knowledgeCategories.parentId, parentId));
        let result = children.map(c => c.id);
        for (const childId of result) {
          result = result.concat(await getAllChildren(childId));
        }
        return result;
      };
      const allIds = [id, ...await getAllChildren(id)];
      for (const cid of allIds) {
        await db.update(schema.knowledgeDocuments)
          .set({ categoryId: '' })
          .where(eq(schema.knowledgeDocuments.categoryId, cid));
        await db.delete(schema.knowledgeCategories).where(eq(schema.knowledgeCategories.id, cid));
      }
    })
  );

  ipcMain.handle('knowledge:listDocuments', (_event, params: {
    categoryId?: string;
    keyword?: string;
    type?: string;
    sortField?: string;
    sortOrder?: string;
    page?: number;
    pageSize?: number;
  }) =>
    wrap<{ list: any[]; total: number }>(async () => {
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
    })
  );

  ipcMain.handle('knowledge:getDocument', (_event, id: string) =>
    wrap<any>(async () => {
      const db = getDb();
      const result = await db
        .select()
        .from(schema.knowledgeDocuments)
        .where(eq(schema.knowledgeDocuments.id, id))
        .limit(1);
      return result[0] || null;
    })
  );

  ipcMain.handle('knowledge:createDocument', (_event, data: any) =>
    wrap<string>(async () => {
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
    })
  );

  ipcMain.handle('knowledge:updateDocument', (_event, id: string, data: any) =>
    wrap<void>(async () => {
      const db = getDb();
      const now = new Date().toISOString();
      await db.update(schema.knowledgeDocuments).set({
        ...data,
        updatedAt: now,
      }).where(eq(schema.knowledgeDocuments.id, id));
    })
  );

  ipcMain.handle('knowledge:deleteDocument', (_event, id: string) =>
    wrap<void>(async () => {
      const db = getDb();
      await db.delete(schema.knowledgeDocuments).where(eq(schema.knowledgeDocuments.id, id));
    })
  );

  ipcMain.handle('knowledge:listCommands', (_event, params: {
    keyword?: string;
    os?: string;
    brand?: string;
    deviceType?: string;
    category?: string;
    subCategory?: string;
    page?: number;
    pageSize?: number;
  }) =>
    wrap<{ list: any[]; total: number }>(async () => {
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

      query = query.orderBy(desc(schema.knowledgeCommands.isFavorite), asc(schema.knowledgeCommands.createdAt));

      const all = await query;
      const total = all.length;
      const list = all.slice((page - 1) * pageSize, page * pageSize);

      return { list, total };
    })
  );

  ipcMain.handle('knowledge:createCommand', (_event, data: any) =>
    wrap<string>(async () => {
      const db = getDb();
      const id = data.id || randomUUID();
      const now = new Date().toISOString();
      await db.insert(schema.knowledgeCommands).values({
        ...data,
        id,
        createdAt: now,
        updatedAt: now,
      });
      return id;
    })
  );

  ipcMain.handle('knowledge:updateCommand', (_event, id: string, data: any) =>
    wrap<void>(async () => {
      const db = getDb();
      const now = new Date().toISOString();
      await db.update(schema.knowledgeCommands).set({
        ...data,
        updatedAt: now,
      }).where(eq(schema.knowledgeCommands.id, id));
    })
  );

  ipcMain.handle('knowledge:deleteCommand', (_event, id: string) =>
    wrap<void>(async () => {
      const db = getDb();
      await db.delete(schema.knowledgeCommands).where(eq(schema.knowledgeCommands.id, id));
    })
  );

  ipcMain.handle('knowledge:favoriteCommand', (_event, id: string, isFavorite: number) =>
    wrap<void>(async () => {
      const db = getDb();
      await db.update(schema.knowledgeCommands).set({
        isFavorite,
        updatedAt: new Date().toISOString(),
      }).where(eq(schema.knowledgeCommands.id, id));
    })
  );

  ipcMain.handle('knowledge:importKnowledge', async (_event, filePath: string) => {
    try {
      const XLSX = require('xlsx');
      const db = getDb();
      const safePath = await validatePath(filePath);
      
      const stats = fs.statSync(safePath);
      if (stats.size > MAX_EXCEL_SIZE) {
        return { success: false, error: { code: 'FILE_TOO_LARGE', message: `Excel文件过大 (最大${MAX_EXCEL_SIZE / 1024 / 1024}MB)` } };
      }
      
      const workbook = XLSX.readFile(safePath);
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows: any[] = XLSX.utils.sheet_to_json(sheet, { defval: '' });

      if (rows.length > MAX_EXCEL_ROWS) {
        return { success: false, error: { code: 'TOO_MANY_ROWS', message: `Excel行数过多 (最大${MAX_EXCEL_ROWS}行)` } };
      }

      let count = 0;
      const now = new Date().toISOString();
      const errors: string[] = [];

      await db.transaction(async (tx) => {
        for (let i = 0; i < rows.length; i++) {
          try {
            const row = rows[i];
            const title = row['标题'] || row['title'] || row['文档名称'] || row['name'];
            if (!title) continue;

            const categoryName = row['分类'] || row['category'] || '';
            let categoryId = '';
            if (categoryName) {
              const cats = await tx.select().from(schema.knowledgeCategories)
                .where(eq(schema.knowledgeCategories.name, categoryName))
                .limit(1);
              if (cats.length > 0) {
                categoryId = cats[0].id;
              }
            }

            await tx.insert(schema.knowledgeDocuments).values({
              id: randomUUID(),
              categoryId: categoryId || 'uncategorized',
              title,
              type: row['类型'] || row['type'] || 'guide',
              description: row['描述'] || row['description'] || '',
              content: row['内容'] || row['content'] || '',
              version: row['版本'] || row['version'] || '1.0',
              tags: row['标签'] || row['tags'] || '',
              uploadDate: now,
              createdAt: now,
              updatedAt: now,
            });
            count++;
          } catch (rowError: any) {
            errors.push(`第${i + 2}行: ${rowError.message}`);
          }
        }
      });

      if (errors.length > 0) {
        log.warn(`知识库导入部分失败: ${errors.join('; ')}`);
      }

      return { success: true, data: { count, errors } };
    } catch (error: any) {
      log.error('Import knowledge error:', error);
      return { success: false, error: { code: 'IMPORT_ERROR', message: error.message } };
    }
  });

  ipcMain.handle('knowledge:exportKnowledge', async () => {
    try {
      const XLSX = require('xlsx');
      const db = getDb();
      const docs = await db.select().from(schema.knowledgeDocuments);

      const data = docs.map((doc, i) => ({
        '序号': i + 1,
        '标题': doc.title,
        '类型': doc.type,
        '描述': doc.description || '',
        '版本': doc.version || '',
        '标签': doc.tags || '',
        '上传日期': doc.uploadDate,
        '内容': doc.content || '',
      }));

      const ws = XLSX.utils.json_to_sheet(data);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, '知识库');

      const result = await dialog.showSaveDialog({
        title: '导出知识库',
        defaultPath: `知识库导出_${new Date().toISOString().slice(0, 10)}.xlsx`,
        filters: [{ name: 'Excel', extensions: ['xlsx'] }],
      });

      if (result.canceled || !result.filePath) {
        return { success: true, data: { path: '' } };
      }

      XLSX.writeFile(wb, result.filePath);
      return { success: true, data: { path: result.filePath } };
    } catch (error: any) {
      log.error('Export knowledge error:', error);
      return { success: false, error: { code: 'EXPORT_ERROR', message: error.message } };
    }
  });

  ipcMain.handle('knowledge:downloadDocument', async (_event, id: string) => {
    try {
      const db = getDb();
      const result = await db
        .select()
        .from(schema.knowledgeDocuments)
        .where(eq(schema.knowledgeDocuments.id, id))
        .limit(1);

      if (!result[0] || !result[0].filePath) {
        return { success: false, error: { code: 'NOT_FOUND', message: '文档文件不存在' } };
      }

      const fs = require('fs');
      if (!fs.existsSync(result[0].filePath)) {
        return { success: false, error: { code: 'FILE_NOT_FOUND', message: '文件已被删除' } };
      }

      return { success: true, data: { path: result[0].filePath, title: result[0].title } };
    } catch (error: any) {
      log.error('Download document error:', error);
      return { success: false, error: { code: 'DOWNLOAD_ERROR', message: error.message } };
    }
  });

  ipcMain.handle('knowledge:downloadAndSave', async (_event, id: string) => {
    try {
      const db = getDb();
      const result = await db
        .select()
        .from(schema.knowledgeDocuments)
        .where(eq(schema.knowledgeDocuments.id, id))
        .limit(1);

      if (!result[0]) {
        return { success: false, error: { code: 'NOT_FOUND', message: '文档不存在' } };
      }

      const doc = result[0];
      const path = require('path');
      const fs = require('fs');

      // 如果有文件路径，则复制文件
      if (doc.filePath && fs.existsSync(doc.filePath)) {
        const fileName = path.basename(doc.filePath);
        const saveResult = await dialog.showSaveDialog({
          title: '保存文档',
          defaultPath: fileName,
          filters: [
            { name: 'PDF', extensions: ['pdf'] },
            { name: 'Word', extensions: ['doc', 'docx'] },
            { name: 'Excel', extensions: ['xlsx', 'xls'] },
            { name: '所有文件', extensions: ['*'] },
          ],
        });

        if (saveResult.canceled || !saveResult.filePath) {
          return { success: true, data: { saved: false } };
        }

        fs.copyFileSync(doc.filePath, saveResult.filePath);
        return { success: true, data: { saved: true, path: saveResult.filePath } };
      }

      // 如果是内置文档（只有content），则导出为Markdown文件
      if (doc.content) {
        const fileName = `${doc.title}.md`;
        const saveResult = await dialog.showSaveDialog({
          title: '保存文档',
          defaultPath: fileName,
          filters: [
            { name: 'Markdown', extensions: ['md'] },
            { name: '所有文件', extensions: ['*'] },
          ],
        });

        if (saveResult.canceled || !saveResult.filePath) {
          return { success: true, data: { saved: false } };
        }

        fs.writeFileSync(saveResult.filePath, doc.content, 'utf8');
        return { success: true, data: { saved: true, path: saveResult.filePath } };
      }

      return { success: false, error: { code: 'NO_CONTENT', message: '文档没有内容可下载' } };
    } catch (error: any) {
      log.error('Download and save error:', error);
      return { success: false, error: { code: 'SAVE_ERROR', message: error.message } };
    }
  });

  ipcMain.handle('knowledge:uploadDocument', async (_event, data: { categoryId: string; title: string; type: string; description: string; version: string; tags: string; filePath: string }) => {
    try {
      const db = getDb();
      const id = randomUUID();
      const now = new Date().toISOString();

      await db.insert(schema.knowledgeDocuments).values({
        id,
        categoryId: data.categoryId,
        title: data.title,
        type: data.type,
        description: data.description || '',
        content: '',
        version: data.version || '1.0',
        tags: data.tags || '',
        filePath: data.filePath,
        uploadDate: now,
        referenceCount: 0,
        createdAt: now,
        updatedAt: now,
      });

      return { success: true, data: { id } };
    } catch (error: any) {
      log.error('Upload document error:', error);
      return { success: false, error: { code: 'UPLOAD_ERROR', message: error.message } };
    }
  });

  ipcMain.handle('knowledge:referenceDocument', async (_event, data: { documentId: string; targetId: string; targetType: string }) => {
    try {
      const db = getDb();
      await db.update(schema.knowledgeDocuments).set({
        referenceCount: sql`referenceCount + 1`,
        updatedAt: new Date().toISOString(),
      }).where(eq(schema.knowledgeDocuments.id, data.documentId));

      return { success: true, data: {} };
    } catch (error: any) {
      log.error('Reference document error:', error);
      return { success: false, error: { code: 'REFERENCE_ERROR', message: error.message } };
    }
  });

  ipcMain.handle('knowledge:importSingleDocument', async (_event, data: { categoryId: string; title: string; type: string; description: string; version: string; tags: string; filePath: string }) => {
    try {
      const db = getDb();
      const id = randomUUID();
      const now = new Date().toISOString();

      await db.insert(schema.knowledgeDocuments).values({
        id,
        categoryId: data.categoryId,
        title: data.title,
        type: data.type,
        description: data.description || '',
        content: '',
        version: data.version || '1.0',
        tags: data.tags || '',
        filePath: data.filePath,
        uploadDate: now,
        referenceCount: 0,
        createdAt: now,
        updatedAt: now,
      });

      return { success: true, data: { id } };
    } catch (error: any) {
      log.error('Import single document error:', error);
      return { success: false, error: { code: 'IMPORT_ERROR', message: error.message } };
    }
  });

  ipcMain.handle('knowledge:listDirectoryFiles', async (_event, dirPath: string) => {
    try {
      const safePath = await validatePath(dirPath);
      const files = fs.readdirSync(safePath);
      const result = files.map(file => {
        const fullPath = path.join(safePath, file);
        const stat = fs.statSync(fullPath);
        return {
          name: file,
          path: fullPath,
          size: stat.size,
          isFile: stat.isFile(),
        };
      });
      return { success: true, data: result };
    } catch (error: any) {
      log.error('List directory files error:', error);
      return { success: false, error: { code: 'LIST_ERROR', message: error.message } };
    }
  });
}