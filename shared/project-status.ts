/**
 * 项目（分组）状态与系统状态的推导规则。
 *
 * 分组不再手工维护业务状态，由名下系统（projects 行）的状态推导：
 * - 任一系统「进行中」 → 进行中
 * - 系统全为「草稿」   → 草稿
 * - 系统全为「已完成」 → 已完成
 * - 草稿/已完成混合且无进行中 → 进行中（还有未完成的系统）
 * - 系统全部已归档（视为已退出，不参与计算）→ 已完成
 */

export type ProjectBusinessStatus = 'draft' | 'in_progress' | 'completed';

export function deriveGroupStatus(systemStatuses: string[]): ProjectBusinessStatus {
  const active = systemStatuses.filter(s => s !== 'archived');
  if (active.length === 0) return 'completed';
  if (active.some(s => s === 'in_progress')) return 'in_progress';
  if (active.every(s => s === 'draft')) return 'draft';
  if (active.every(s => s === 'completed')) return 'completed';
  return 'in_progress';
}
