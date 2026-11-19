/**
 * 库内编辑决策核心 resolveCheckpointUpdate 测试（纯函数，无 DB）。
 *
 * 为什么值得测：这三条都是"坏了就静默出错"的路径——
 *  1) 测评项为空会入库成无法召回的脏键；
 *  2) 测评点清空会让该条款失去逐点核查内容；
 *  3) 语义键必须由服务端按新文本重算，否则 AI 现场分析召不到这条记录。
 */
import { describe, it, expect } from 'vitest';
import {
  resolveCheckpointUpdate, buildSemanticKey, batchCheckpointBudget,
} from '../../electron/services/checkpoint-core';

const existing = {
  id: 'A',
  semanticKey: buildSemanticKey('安全计算环境', '身份鉴别', 'b) 应具有登录失败处理功能'),
  deviceKey: 'linux',
  domain: '安全计算环境',
  controlPoint: '身份鉴别',
  requirement: 'b) 应具有登录失败处理功能',
  checkpoints: JSON.stringify(['1) 核查是否启用登录失败处理']),
  interpretation: null,
  resultTemplate: null,
  catalogNo: null,
};

describe('resolveCheckpointUpdate 编辑决策', () => {
  it('改文本后语义键随新测评项重算', () => {
    const d = resolveCheckpointUpdate(existing, {
      id: 'A',
      requirement: 'c) 应采用两种以上组合的鉴别技术',
      checkpoints: ['1) 核查双因素'],
    });
    expect(d.ok).toBe(true);
    if (!d.ok) return;
    expect(d.semanticKey).toBe(buildSemanticKey('安全计算环境', '身份鉴别', 'c) 应采用两种以上组合的鉴别技术'));
    expect(d.values.requirement).toContain('两种以上组合');
    expect(JSON.parse(d.values.checkpoints)).toEqual(['1) 核查双因素']);
  });

  it('未传 checkpoints 时保留原值（不回填空）', () => {
    const d = resolveCheckpointUpdate(existing, { id: 'A', resultTemplate: '通过示例' });
    expect(d.ok).toBe(true);
    if (!d.ok) return;
    expect(JSON.parse(d.values.checkpoints)).toEqual(['1) 核查是否启用登录失败处理']);
    expect(d.values.resultTemplate).toBe('通过示例');
    // 语义键不变（requirement 未变）
    expect(d.semanticKey).toBe(existing.semanticKey);
  });

  it('测评项为空 → empty_requirement', () => {
    const d = resolveCheckpointUpdate(existing, { id: 'A', requirement: '   ', checkpoints: ['1) x'] });
    expect(d.ok).toBe(false);
    if (d.ok) return;
    expect(d.reason).toBe('empty_requirement');
  });

  it('测评点清空 → empty_checkpoints', () => {
    const d = resolveCheckpointUpdate(existing, { id: 'A', checkpoints: [] });
    expect(d.ok).toBe(false);
    if (d.ok) return;
    expect(d.reason).toBe('empty_checkpoints');
  });

  it('字段缺省沿用现有值（null/undefined 语义区分正确）', () => {
    const d = resolveCheckpointUpdate(existing, { id: 'A', interpretation: '含义说明' });
    expect(d.ok).toBe(true);
    if (!d.ok) return;
    expect(d.values.domain).toBe('安全计算环境');
    expect(d.values.deviceKey).toBe('linux');
    expect(d.values.interpretation).toBe('含义说明');
    // 显式传空串应置 null（区分于「不传」）
    const d2 = resolveCheckpointUpdate(existing, { id: 'A', catalogNo: '' });
    expect(d2.ok && d2.values.catalogNo).toBeNull();
  });
});

describe('batchCheckpointBudget 批量自适应预算', () => {
  it('条数越少每项额度越大，条数越多自动收窄', () => {
    const few = batchCheckpointBudget(2);
    const many = batchCheckpointBudget(50);
    expect(few.maxChars).toBeGreaterThan(many.maxChars);
    expect(few.maxPoints).toBeGreaterThanOrEqual(many.maxPoints);
  });

  it('有上下限：单条给足但不超上限，极端多也不低于下限', () => {
    expect(batchCheckpointBudget(1)).toEqual({ maxPoints: 8, maxChars: 6000 });
    expect(batchCheckpointBudget(10000)).toEqual({ maxPoints: 1, maxChars: 400 });
  });

  it('总量随条数增长受控（不线性膨胀到无限）', () => {
    for (const n of [1, 2, 5, 10, 25, 50, 100]) {
      const b = batchCheckpointBudget(n);
      expect(b.maxChars).toBeGreaterThanOrEqual(400);
      expect(b.maxChars).toBeLessThanOrEqual(6000);
      expect(b.maxPoints).toBeGreaterThanOrEqual(1);
      expect(b.maxPoints).toBeLessThanOrEqual(8);
      // 真实语义：每项额度 = clamp(ceil(24000/n), 400, 6000)
      // 因此总量 = 每项额度 × n，n 小时因封顶而小于总预算，n 大时趋近 24000
      const expected = Math.min(6000, Math.max(400, Math.round(24000 / n)));
      expect(b.maxChars).toBe(expected);
    }
  });

  it('非法输入按 1 处理，不产生 NaN/0', () => {
    expect(batchCheckpointBudget(0)).toEqual({ maxPoints: 8, maxChars: 6000 });
    expect(batchCheckpointBudget(NaN)).toEqual({ maxPoints: 8, maxChars: 6000 });
    expect(batchCheckpointBudget(-5)).toEqual({ maxPoints: 8, maxChars: 6000 });
  });
});
