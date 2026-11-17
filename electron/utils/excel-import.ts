import { inArray } from 'drizzle-orm';
import { getDb } from '../db';
import * as schema from '../db/schema';

/**
 * 按测评项 ID 批量取条款原文（assessment_items.requirement）。
 * 导出 Excel 的「测评项」列用它替代 issues.controlName——后者存的是控制点名，
 * 与「控制点」列重复；真正的测评指标/标准条款在 requirement 里。
 * 返回 id → requirement 映射，取不到（如问题未关联测评项）时由调用方回退 controlName。
 */
export async function loadRequirementMap(itemIds: string[]): Promise<Record<string, string>> {
  const ids = [...new Set(itemIds.filter(Boolean))];
  if (ids.length === 0) return {};
  const db = getDb();
  const rows = await db.select({ id: schema.assessmentItems.id, requirement: schema.assessmentItems.requirement })
    .from(schema.assessmentItems)
    .where(inArray(schema.assessmentItems.id, ids));
  const map: Record<string, string> = {};
  rows.forEach((r: any) => { map[r.id] = r.requirement || ''; });
  return map;
}
