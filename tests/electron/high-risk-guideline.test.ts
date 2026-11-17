import { describe, it, expect } from 'vitest';
import {
  formatGuidelineCandidates,
  guidelineItems,
  searchGuidelineCandidates,
} from '../../electron/services/high-risk-guideline.service';

describe('等保高风险判定指引快照', () => {
  it('完整收录网页版 81 条判定项且字段齐全', () => {
    expect(guidelineItems).toHaveLength(81);
    for (const item of guidelineItems) {
      expect(item.id).toBeTruthy();
      expect(item.category).toBeTruthy();
      expect(item.riskScenario).toBeTruthy();
      expect(item.evaluation).toBeTruthy();
    }
  });

  it('按机房出入口场景召回对应条目并排在第一位', () => {
    const result = searchGuidelineCandidates({
      issueTitle: '机房出入口访问控制措施缺失',
      issueDescription: '机房出入口无任何访问控制措施，未安装电子门禁，门口无专人值守。',
      securityDomain: 'secure_physical',
      controlPoint: '物理访问控制',
      controlName: '物理访问控制',
    });
    expect(result.length).toBeGreaterThan(0);
    expect(result[0].id).toBe('6.1.1.1');
    expect(result[0].category).toBe('安全物理环境');
  });

  it('安全域 ID 与中文名都能映射到指引分类', () => {
    const byId = searchGuidelineCandidates({
      issueTitle: '防火墙策略未限制访问',
      issueDescription: '区域边界未配置访问控制策略',
      securityDomain: 'secure_boundary',
      controlPoint: '访问控制',
    });
    const byName = searchGuidelineCandidates({
      issueTitle: '防火墙策略未限制访问',
      issueDescription: '区域边界未配置访问控制策略',
      securityDomain: '安全区域边界',
      controlPoint: '访问控制',
    });
    expect(byId.length).toBeGreaterThan(0);
    expect(byName.map(x => x.id)).toEqual(byId.map(x => x.id));
  });

  it('无相关文本时只回退同域条目，不返回空泛的全库结果', () => {
    const result = searchGuidelineCandidates({
      issueTitle: '升级流程未留痕',
      issueDescription: '变更管理记录不完整',
      securityDomain: 'security_construction',
      controlPoint: '变更管理',
    });
    expect(result.length).toBeGreaterThan(0);
    expect(result.every(x => x.category === '安全建设管理')).toBe(true);
  });

  it('提示词候选文本保留标准要求、问题场景、缓解措施与风险评价', () => {
    const text = formatGuidelineCandidates([guidelineItems[0]]);
    expect(text).toContain('6.1.1.1');
    expect(text).toContain('标准要求：');
    expect(text).toContain('问题场景：');
    expect(text).toContain('可能缓解措施：');
    expect(text).toContain('风险评价：');
  });
});
