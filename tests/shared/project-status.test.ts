import { describe, it, expect } from 'vitest';
import { deriveGroupStatus } from '../../shared/project-status';

describe('deriveGroupStatus（项目状态随系统状态推导）', () => {
  it('任一系统进行中 → 进行中', () => {
    expect(deriveGroupStatus(['draft', 'in_progress'])).toBe('in_progress');
    expect(deriveGroupStatus(['in_progress'])).toBe('in_progress');
    expect(deriveGroupStatus(['completed', 'in_progress', 'draft'])).toBe('in_progress');
  });

  it('系统全为草稿 → 草稿', () => {
    expect(deriveGroupStatus(['draft'])).toBe('draft');
    expect(deriveGroupStatus(['draft', 'draft', 'draft'])).toBe('draft');
  });

  it('系统全为已完成 → 已完成', () => {
    expect(deriveGroupStatus(['completed'])).toBe('completed');
    expect(deriveGroupStatus(['completed', 'completed'])).toBe('completed');
  });

  it('草稿/已完成混合且无进行中 → 进行中（还有未完成的系统）', () => {
    expect(deriveGroupStatus(['draft', 'completed'])).toBe('in_progress');
  });

  it('归档系统不参与计算', () => {
    expect(deriveGroupStatus(['archived', 'draft'])).toBe('draft');
    expect(deriveGroupStatus(['archived', 'completed'])).toBe('completed');
    expect(deriveGroupStatus(['archived', 'in_progress'])).toBe('in_progress');
  });

  it('系统全部归档 → 已完成', () => {
    expect(deriveGroupStatus(['archived'])).toBe('completed');
    expect(deriveGroupStatus(['archived', 'archived'])).toBe('completed');
  });

  it('空列表（无系统）→ 已完成（sync 层会跳过空分组，不会真正落库）', () => {
    expect(deriveGroupStatus([])).toBe('completed');
  });
});
