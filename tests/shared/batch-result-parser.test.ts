// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { parseBatchResultsById } from '../../shared/batch-result-parser';

interface R { issueId: string; description?: string }
const valid = (r: R) => !!r.description;

describe('parseBatchResultsById 批量结果解析', () => {
  it('正常 JSON 按 issueId 建索引', () => {
    const raw = JSON.stringify({ results: [
      { issueId: 'a', description: '描述A' },
      { issueId: 'b', description: '描述B' },
    ] });
    const r = parseBatchResultsById<R>(raw, valid);
    expect(r.byId.get('a')?.description).toBe('描述A');
    expect(r.byId.get('b')?.description).toBe('描述B');
    expect(r.partial).toBe(false);
  });

  it('剥离代码围栏', () => {
    const raw = '```json\n{"results":[{"issueId":"x","description":"说明"}]}\n```';
    expect(parseBatchResultsById<R>(raw, valid).byId.get('x')?.description).toBe('说明');
  });

  it('截断时逐对象救回完整项，partial=true', () => {
    const raw = '{"results":[{"issueId":"a","description":"A"},{"issueId":"b","description":"B未写完';
    const r = parseBatchResultsById<R>(raw, valid);
    expect(r.byId.size).toBe(1);
    expect(r.byId.has('a')).toBe(true);
    expect(r.partial).toBe(true);
  });

  it('丢弃空 issueId 与无有效字段的项', () => {
    const raw = JSON.stringify({ results: [
      { issueId: '', description: '无id' },
      { issueId: 'b', description: '' },
      { issueId: 'c', description: '有效' },
    ] });
    const r = parseBatchResultsById<R>(raw, valid);
    expect(r.byId.size).toBe(1);
    expect(r.byId.has('c')).toBe(true);
  });

  it('围栏外有说明文字时提取大括号', () => {
    const raw = '好的，结果如下：\n{"results":[{"issueId":"k","description":"内容"}]}\n以上。';
    expect(parseBatchResultsById<R>(raw, valid).byId.get('k')?.description).toBe('内容');
  });

  it('无 results 返回空索引', () => {
    expect(parseBatchResultsById<R>('{}', valid).byId.size).toBe(0);
    expect(parseBatchResultsById<R>('随便文字', valid).byId.size).toBe(0);
  });
});
