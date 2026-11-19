// @vitest-environment happy-dom
/**
 * 测评结论判定尾清洗测试。
 *
 * AI 常在 conclusion 句尾追加"判定为符合/部分符合/不符合"复述，
 * 而判定已由 compliance 字段承载，正文不该重复。这里守住：
 * 只剥除句尾判定分句、保留客观事实；无判定时绝不改动正文（避免误伤占位文本）。
 */
import { describe, it, expect } from 'vitest';
import { stripVerdictTail } from '../../src/views/onsite-verification/utils/conclusion-clean';

describe('stripVerdictTail 剥除句尾判定复述', () => {
  it('剥除"因此判定为X"并补句号', () => {
    expect(stripVerdictTail('经核查，完整性校验存在漏洞，因此判定为部分符合。'))
      .toBe('经核查，完整性校验存在漏洞。');
  });

  it('剥除"判定为X"（无"因此"）', () => {
    expect(stripVerdictTail('经核查，权限分离机制缺失，判定为不符合。'))
      .toBe('经核查，权限分离机制缺失。');
  });

  it('剥除后保留事实验述中的"不符合…要求"评价', () => {
    const text = '经核查，未安装审计插件，不符合安全审计功能启用要求，判定为不符合。';
    expect(stripVerdictTail(text)).toBe('经核查，未安装审计插件，不符合安全审计功能启用要求。');
  });

  it('无判定尾时原样返回（占位/测试数据不受影响）', () => {
    expect(stripVerdictTail('11111')).toBe('11111');
    expect(stripVerdictTail('经核查，配置正常。')).toBe('经核查，配置正常。');
    expect(stripVerdictTail('判定依据见附件')).toBe('判定依据见附件');
  });

  it('剥除后为空则保留原文', () => {
    expect(stripVerdictTail('判定为符合。')).toBe('判定为符合。');
  });
});
