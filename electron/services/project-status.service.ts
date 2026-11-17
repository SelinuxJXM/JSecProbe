import { getDb } from '../db';
import * as schema from '../db/schema';
import { eq } from 'drizzle-orm';
import log from 'electron-log';
import { writeOperationLog } from '../utils/operation-log';
import { deriveGroupStatus } from '../../shared/project-status';

export { deriveGroupStatus };

/**
 * 按名下系统状态刷新分组状态并落库（带变更留痕）。
 * - 分组不存在 / 已被手动归档 / 名下还没有系统：不动作
 * - 状态没变化：不写库
 */
export async function syncGroupStatusFromSystems(groupId: string | null | undefined): Promise<void> {
  if (!groupId) return;
  try {
    const db = getDb();
    const group = await db.query.projectGroups.findFirst({ where: eq(schema.projectGroups.id, groupId) });
    // 手动归档的分组保持归档态，不受系统状态影响
    if (!group || group.status === 'archived') return;
    const systems = await db
      .select({ status: schema.projects.status })
      .from(schema.projects)
      .where(eq(schema.projects.groupId, groupId));
    if (systems.length === 0) return; // 新建空分组保持草稿

    const next = deriveGroupStatus(systems.map(s => s.status));
    if (next === group.status) return;

    await db.update(schema.projectGroups)
      .set({ status: next, updatedAt: new Date().toISOString() })
      .where(eq(schema.projectGroups.id, groupId));

    await writeOperationLog({
      action: 'update',
      module: 'projectGroup',
      targetId: groupId,
      targetName: group.name,
      description: `项目状态随系统状态自动更新: ${group.status} → ${next}`,
    });
  } catch (error: any) {
    log.error('[项目状态同步] 失败:', groupId, error?.message || error);
  }
}
