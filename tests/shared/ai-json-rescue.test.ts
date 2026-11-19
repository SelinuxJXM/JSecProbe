// @vitest-environment happy-dom
/**
 * AI 资产识别 JSON 容错解析测试。
 *
 * 回归点：多附件资产识别输出很长，max_tokens 不足会在 assets 数组中途截断，
 * 形如 '...,"name":"X"（此处断开' —— 整体 JSON.parse 失败，此前整批资产丢失。
 * 这里守住：完整对象能被逐个救回，截断的不完整对象被丢弃，不误收。
 */
import { describe, it, expect } from 'vitest';
import { parseAssetsJson, rescueAssetsArray } from '../../shared/ai-json-rescue';

const a1 = { category: 'sys_doc', name: '制度A', evidence: '依据A' };
const a2 = { category: 'sys_doc', name: '制度B', evidence: '依据B' };
const a3 = { category: 'sys_doc', name: '制度C', evidence: '依据C' };

describe('parseAssetsJson 容错解析', () => {
  it('完整 JSON 正常解析，partial=false', () => {
    const text = JSON.stringify({ assets: [a1, a2] });
    const r = parseAssetsJson(text);
    expect(r.assets).toHaveLength(2);
    expect(r.partial).toBe(false);
  });

  it('剥离 ```json 围栏后解析', () => {
    const text = '```json\n{"assets":[{"category":"sys_doc","name":"制度A","evidence":"依据A"}]}\n```';
    expect(parseAssetsJson(text).assets).toHaveLength(1);
  });

  it('数组中途截断：救回前面的完整对象，partial=true', () => {
    // 模拟 position 9294 那种"数组元素未完成"的截断
    const text = '{"assets":[' + JSON.stringify(a1) + ',' + JSON.stringify(a2) + ',{"category":"sys_doc","name":"制度C"';
    const r = parseAssetsJson(text);
    expect(r.assets).toHaveLength(2);
    expect(r.assets[0].name).toBe('制度A');
    expect(r.partial).toBe(true);
  });

  it('字符串值里含括号/逗号不误判对象边界', () => {
    const tricky = { category: 'sys_doc', name: '含括号的制度（一）,二', evidence: '原文 {内有括号} 与 ] 符号' };
    const text = '{"assets":[' + JSON.stringify(tricky) + ',{"name":"被截断';
    expect(parseAssetsJson(text).assets[0].name).toBe('含括号的制度（一）,二');
  });

  it('完全无有效对象时返回空，不抛错', () => {
    const r = parseAssetsJson('{"assets":[{"name":"未闭合"');
    expect(r.assets).toEqual([]);
  });

  it('无 assets 键时返回空', () => {
    expect(parseAssetsJson('{"foo":1}').assets).toEqual([]);
  });
});

describe('rescueAssetsArray 边界', () => {
  it('无 assets 键返回 null', () => {
    expect(rescueAssetsArray('随便一段文字')).toBeNull();
  });
});
