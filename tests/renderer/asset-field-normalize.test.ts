// @vitest-environment happy-dom
/**
 * AI 资产识别结果字段语义纠正测试。
 *
 * 回归点：表格里 sys_doc 的 os 列显示名是"文档主要内容"，description 列是"备注"。
 * 旧提示词让 AI 把"主要内容"填进 description，导致内容跑到备注列。
 * 这里守住：os 空而 description 有内容时搬到 os；os 已有内容时不误伤真实备注。
 */
import { describe, it, expect } from 'vitest';
import { normalizeIdentifiedAsset } from '../../src/views/system-composition/utils/asset-field-normalize';

describe('normalizeIdentifiedAsset 字段语义纠正', () => {
  it('sys_doc：主要内容错填进 description → 搬到 os，备注清空', () => {
    const a = { category: 'sys_doc', name: '日志安全管理规范', os: '', description: '日志管理中涉及的岗位职责以及日志记录、日志管理和日志保护方面。' };
    const out = normalizeIdentifiedAsset(a);
    expect(out.os).toBe('日志管理中涉及的岗位职责以及日志记录、日志管理和日志保护方面。');
    expect(out.description).toBe('');
  });

  it('sys_doc：os 已有内容时不改动真实备注', () => {
    const a = { category: 'sys_doc', name: 'X', os: '主要内容A', description: '这是补充说明' };
    const out = normalizeIdentifiedAsset(a);
    expect(out.os).toBe('主要内容A');
    expect(out.description).toBe('这是补充说明');
  });

  it('sys_doc：两者都空保持不变', () => {
    expect(normalizeIdentifiedAsset({ category: 'sys_doc', name: 'X', os: '', description: '' }))
      .toMatchObject({ os: '', description: '' });
  });

  it('非 sys_doc 类别完全不改动', () => {
    const a = { category: 'network_device', name: '核心交换机', os: 'CentOS', description: '机房A' };
    expect(normalizeIdentifiedAsset(a)).toEqual(a);
  });

  it('不修改原对象（纯函数）', () => {
    const a = { category: 'sys_doc', name: 'X', os: '', description: '主要内容' };
    normalizeIdentifiedAsset(a);
    expect(a.description).toBe('主要内容');
  });
});
