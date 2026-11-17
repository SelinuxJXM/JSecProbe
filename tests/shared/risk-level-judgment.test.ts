import { describe, it, expect } from 'vitest';
import { parseRiskLevelJudgment } from '../../shared/risk-level';

const candidates = [
  { id: '6.1.1.1', title: '机房出入口访问控制措施缺失' },
  { id: '6.1.2.1', title: '机房防火措施缺失' },
];

describe('parseRiskLevelJudgment', () => {
  it('解析纯 JSON 定级结论并补全命中的指引标题', () => {
    const result = parseRiskLevelJudgment(JSON.stringify({
      level: 'high', matchedId: '6.1.1.1', reason: '机房出入口无访问控制且无值守，命中高风险场景。',
    }), candidates);
    expect(result).toEqual({
      level: 'high',
      matchedId: '6.1.1.1',
      matchedTitle: '机房出入口访问控制措施缺失',
      reason: '机房出入口无访问控制且无值守，命中高风险场景。',
    });
  });

  it('剥离 Markdown 围栏并接受中文等级', () => {
    const content = '```json\n{"level":"高风险","matchedId":"6.1.2.1","reason":"无有效消防措施。"}\n```';
    const result = parseRiskLevelJudgment(content, candidates);
    expect(result.level).toBe('high');
    expect(result.matchedId).toBe('6.1.2.1');
  });

  it('模型编造的指引 ID 必须被清空', () => {
    const result = parseRiskLevelJudgment('{"level":"high","matchedId":"9.9.9.9","reason":"编造"}', candidates);
    expect(result.matchedId).toBe('');
    expect(result.matchedTitle).toBeUndefined();
  });

  it('未命中指引时允许判中低风险', () => {
    const result = parseRiskLevelJudgment('{"level":"medium","matchedId":"","reason":"影响范围有限"}', candidates);
    expect(result.level).toBe('medium');
    expect(result.matchedId).toBe('');
  });

  it('夹带解释文字时用宽松正则兜底', () => {
    const result = parseRiskLevelJudgment('结论如下：\n"level": "低", "reason": "轻微问题"', candidates);
    expect(result.level).toBe('low');
    expect(result.reason).toBe('轻微问题');
  });

  it('无法识别等级时抛错，避免误写回问题清单', () => {
    expect(() => parseRiskLevelJudgment('我没有给出等级', candidates)).toThrow('AI 定级结果格式无法解析');
  });
});
