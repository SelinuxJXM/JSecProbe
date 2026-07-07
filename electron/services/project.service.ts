import { getDb } from '../db';
import * as schema from '../db/schema';
import { eq, like, and, desc, count, sql, not } from 'drizzle-orm';
import { randomUUID } from 'crypto';

export class ProjectService {
  static async list(params: { page?: number; pageSize?: number; keyword?: string; status?: string; level?: number; excludeArchived?: boolean }) {
    const db = getDb();
    const { page = 1, pageSize = 20, keyword, status, level, excludeArchived } = params;

    const conditions = [];
    if (keyword) conditions.push(like(schema.projects.name, `%${keyword}%`));
    if (status) conditions.push(eq(schema.projects.status, status));
    if (level) conditions.push(eq(schema.projects.level, level));
    if (excludeArchived) conditions.push(not(eq(schema.projects.status, 'archived')));

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const totalResult = await db.select({ value: count() }).from(schema.projects).where(whereClause);
    const total = totalResult[0]?.value || 0;

    const list = await db.select().from(schema.projects).where(whereClause)
      .orderBy(desc(schema.projects.createdAt)).limit(pageSize).offset((page - 1) * pageSize);

    return {
      list: list.map(p => ({
        id: p.id, name: p.name, projectNo: p.projectNo || undefined, systemName: p.systemName,
        assessedUnit: p.assessedUnit || undefined, standardSystem: p.standardSystem || undefined,
        levelCombo: p.levelCombo || undefined, extensionType: p.extensionType || undefined,
        level: p.level, standardId: p.standardId, status: p.status, customerName: p.customerName || undefined,
        assessor: p.assessor || undefined, startDate: p.startDate || undefined, endDate: p.endDate || undefined,
        description: p.description || undefined, assetCount: p.assetCount, complianceRate: p.complianceRate || undefined,
        progress: p.progress || 0, createdAt: p.createdAt, updatedAt: p.updatedAt,
      })),
      total,
    };
  }

  static async getById(id: string) {
    const db = getDb();
    return await db.query.projects.findFirst({ where: eq(schema.projects.id, id) });
  }

  static async create(data: any) {
    const db = getDb();
    const now = new Date().toISOString();
    const id = randomUUID();
    
    // 根据等级选择标准库
    let level = data.level;
    if (data.levelCombo && !level) {
      const match = data.levelCombo.match(/S(\d)A(\d)G(\d)/);
      if (match) {
        level = Math.max(parseInt(match[1]), parseInt(match[2]), parseInt(match[3]));
      }
    }
    if (!level) level = 3;
    const standardId = data.standardId || (level === 2 ? 'gb-t-22239-2019-l2' : 'gb-t-22239-2019');
    
    await db.insert(schema.projects).values({
      id, ...data, level, standardId, status: data.status || 'draft',
      progress: data.progress || 0, createdAt: now, updatedAt: now,
    });
    return await db.query.projects.findFirst({ where: eq(schema.projects.id, id) });
  }

  static async update(id: string, data: any) {
    const db = getDb();
    const now = new Date().toISOString();
    await db.update(schema.projects).set({ ...data, updatedAt: now }).where(eq(schema.projects.id, id));
    return await db.query.projects.findFirst({ where: eq(schema.projects.id, id) });
  }

  static async remove(id: string) {
    const db = getDb();
    await db.delete(schema.projects).where(eq(schema.projects.id, id));
  }

  static async calcProgress(projectId: string): Promise<number> {
    try {
      const db = getDb();
      const project = await db.query.projects.findFirst({ where: eq(schema.projects.id, projectId) });
      if (!project) return 0;
      const totalResult = await db.select({ value: count() }).from(schema.assessmentItems).where(eq(schema.assessmentItems.standardId, project.standardId));
      const total = totalResult[0]?.value || 1;
      const doneResult = await db.select({ value: count() }).from(schema.assessmentRecords)
        .where(and(eq(schema.assessmentRecords.projectId, projectId), sql`${schema.assessmentRecords.result} != 'untested'`));
      const done = doneResult[0]?.value || 0;
      const progress = Math.round((done / total) * 100);
      await db.update(schema.projects).set({ progress }).where(eq(schema.projects.id, projectId));
      return progress;
    } catch { return 0; }
  }
}