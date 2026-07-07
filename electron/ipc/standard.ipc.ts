import { ipcMain } from 'electron';
import log from 'electron-log';
import { getDb } from '../db';
import * as schema from '../db/schema';
import { eq, sql, count, and } from 'drizzle-orm';

function wrap<T>(fn: () => T | Promise<T>): Promise<any> {
  return Promise.resolve()
    .then(fn)
    .then((data) => ({ success: true, data }))
    .catch((error) => {
      log.error('Standard IPC Error:', error);
      return {
        success: false,
        error: {
          code: error.code || 'INTERNAL_ERROR',
          message: error.message || '操作失败',
        },
      };
    });
}

export function registerStandardHandlers(): void {
  ipcMain.handle('standard:list', () =>
    wrap(async () => {
      const db = getDb();
      const standards = await db.select().from(schema.standards).orderBy(schema.standards.name);
      return standards.map(s => ({
        id: s.id,
        name: s.name,
        code: s.code,
        version: s.version,
        description: s.description || undefined,
        level: s.grade,
        domainCount: s.domainCount,
        itemCount: s.itemCount,
        isDefault: !!s.isDefault,
        createdAt: s.createdAt,
      }));
    })
  );

  ipcMain.handle('standard:getDomains', (_event, standardId: string) =>
    wrap(async () => {
      const db = getDb();
      const items = await db
        .select({ domain: schema.assessmentItems.domain, count: count() })
        .from(schema.assessmentItems)
        .where(eq(schema.assessmentItems.standardId, standardId))
        .groupBy(schema.assessmentItems.domain)
        .orderBy(schema.assessmentItems.domain);

      const DOMAIN_NAMES: Record<string, { name: string; icon: string }> = {
        secure_physical: { name: '安全物理环境', icon: 'OfficeBuilding' },
        secure_communication: { name: '安全通信网络', icon: 'Connection' },
        secure_boundary: { name: '安全区域边界', icon: 'Grid' },
        secure_computing: { name: '安全计算环境', icon: 'Monitor' },
        secure_management: { name: '安全管理中心', icon: 'Setting' },
        security_management: { name: '安全管理制度', icon: 'Document' },
        security_organization: { name: '安全管理机构', icon: 'Briefcase' },
        security_personnel: { name: '安全管理人员', icon: 'User' },
        security_construction: { name: '安全建设管理', icon: 'Tools' },
        security_maintenance: { name: '安全运维管理', icon: 'Box' },
      };

      return items.map(item => ({
        id: item.domain,
        name: DOMAIN_NAMES[item.domain]?.name || item.domain,
        icon: DOMAIN_NAMES[item.domain]?.icon || 'Document',
        count: item.count,
      }));
    })
  );

  ipcMain.handle('standard:getItems', (_event, standardId: string, domain?: string) =>
    wrap(async () => {
      const db = getDb();
      const conditions = [eq(schema.assessmentItems.standardId, standardId)];
      if (domain) {
        conditions.push(eq(schema.assessmentItems.domain, domain));
      }

      const items = await db
        .select()
        .from(schema.assessmentItems)
        .where(and(...conditions))
        .orderBy(schema.assessmentItems.sortOrder);

      return items.map(item => ({
        id: item.id,
        standardId: item.standardId,
        domain: item.domain,
        controlPoint: item.controlPoint,
        controlName: item.controlName,
        requirement: item.requirement,
        minLevel: item.minLevel,
        maxLevel: item.maxLevel,
        extensionType: item.extensionType,
        isHighRisk: !!item.isHighRisk,
        sortOrder: item.sortOrder,
        parentId: item.parentId || undefined,
      }));
    })
  );

  ipcMain.handle('standard:setDefault', (_event, standardId: string) =>
    wrap<void>(async () => {
      const db = getDb();
      await db.update(schema.standards)
        .set({ isDefault: 0 })
        .where(sql`1=1`);
      await db.update(schema.standards)
        .set({ isDefault: 1 })
        .where(eq(schema.standards.id, standardId));
    })
  );

  ipcMain.handle('standard:remove', (_event, standardId: string) =>
    wrap<void>(async () => {
      const db = getDb();
      await db.delete(schema.standards).where(eq(schema.standards.id, standardId));
    })
  );
}