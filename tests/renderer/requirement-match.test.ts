// @vitest-environment happy-dom
/**
 * 批量 AI 回填错配纠正的比对原语测试。
 *
 * 背景：AI 批量分析把相邻相似测评项的结论与 itemId 写反（如 c/d 两项都讲账户权限）。
 * 提示词要求回显 requirement 原文，前端据此校验 itemId 与结论是否错位。
 * 这里守住：标点/空白差异不影响比对；相似但不相同的条款不误判为匹配。
 */
import { describe, it, expect } from 'vitest';
import {
  normalizeRequirementText,
  requirementTextMatches,
} from '../../src/views/onsite-verification/utils/requirement-match';

describe('normalizeRequirementText 归一化', () => {
  it('去除空白与中英文标点，统一小写', () => {
    expect(normalizeRequirementText('a）应对登录的用户，进行身份鉴别；\n b)  abc')).toBe(
      'a应对登录的用户进行身份鉴别babc'
    );
  });
});

describe('requirementTextMatches 实质相同判定', () => {
  const reqC = '应及时删除或停用多余的、过期的账户，避免共享账户的存在';
  const reqD = '应授予管理用户所需的最小权限，实现管理用户的权限分离';

  it('标点/空白/编号差异仍判为相同', () => {
    expect(requirementTextMatches(reqC, 'c）应及时删除或停用多余的 过期的账户 避免共享账户的存在；')).toBe(true);
  });

  it('主题相近但内容不同的两项判为不匹配（错配检测的核心）', () => {
    expect(requirementTextMatches(reqC, reqD)).toBe(false);
  });

  it('回显对了 C 条款、却标成 D 的 itemId 时，与 C 行匹配、与 D 行不匹配', () => {
    const echoed = '应及时删除或停用多余的过期的账户避免共享账户的存在';
    expect(requirementTextMatches(echoed, reqC)).toBe(true);
    expect(requirementTextMatches(echoed, reqD)).toBe(false);
  });

  it('空文本一律不匹配', () => {
    expect(requirementTextMatches('', reqC)).toBe(false);
    expect(requirementTextMatches(reqC, '')).toBe(false);
  });

  it('过短的短语不作包含匹配，避免误判', () => {
    expect(requirementTextMatches('应符合', '应符合本标准要求')).toBe(false);
  });
});
