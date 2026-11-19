// @vitest-environment happy-dom
/**
 * 批量 AI 返回 JSON 容错解析测试。
 *
 * 回归点：AI 常把结果包在 ```json ... ``` 代码围栏里，此前前端直接 JSON.parse
 * 会因首个反引号失败，兜底提取又可能被干扰，导致整批结果丢失（日志出现过
 * "第5/5批 Unexpected token '`' 解析失败"）。这里守住围栏能被正确剥离。
 */
import { describe, it, expect, vi } from 'vitest';

const { ElMessage } = vi.hoisted(() => ({
  ElMessage: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
}));
vi.mock('element-plus', () => ({ ElMessage }));

import { parseBatchAiContent } from '../../src/views/onsite-verification/composables/useAiAnalysis';

describe('parseBatchAiContent 容错解析', () => {
  it('解析纯 JSON', () => {
    const r = parseBatchAiContent('{"results":[{"itemId":"a","conclusion":"ok"}]}');
    expect(r.results).toHaveLength(1);
    expect(r.results[0].itemId).toBe('a');
  });

  it('剥离 ```json 代码围栏后解析（回归点）', () => {
    const fenced = '```json\n{"results":[{"itemId":"b","conclusion":"经核查，配置正常。"}]}\n```';
    const r = parseBatchAiContent(fenced);
    expect(r.results).toHaveLength(1);
    expect(r.results[0].itemId).toBe('b');
  });

  it('剥离 ``` 无语言标记围栏', () => {
    const fenced = '```\n{"results":[{"itemId":"c"}]}\n```';
    expect(parseBatchAiContent(fenced).results[0].itemId).toBe('c');
  });

  it('围栏外有前后说明文字仍能提取大括号对象', () => {
    const fenced = '分析结果如下：\n```json\n{"results":[{"itemId":"d"}]}\n```\n以上。';
    const r = parseBatchAiContent(fenced);
    expect(r.results.some((x: any) => x.itemId === 'd')).toBe(true);
  });
});
