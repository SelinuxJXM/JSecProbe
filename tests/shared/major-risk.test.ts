import { describe, it, expect } from 'vitest';
import {
  matchCatalogCandidates,
  formatCatalogCandidates,
  formatRecordSnippets,
  parseMajorRiskDraft,
  countMitigationHits,
  MITIGATION_TERMS,
} from '../../shared/major-risk';
import type { MajorRiskCatalogItem } from '../../shared/types';

function item(partial: Partial<MajorRiskCatalogItem> & { id: string; title: string }): MajorRiskCatalogItem {
  return {
    id: partial.id,
    title: partial.title,
    code: partial.code,
    category: partial.category,
    criteria: partial.criteria,
    keywords: partial.keywords,
    source: partial.source,
    sortOrder: partial.sortOrder ?? 0,
    enabled: partial.enabled ?? true,
    createdAt: partial.createdAt ?? '',
    updatedAt: partial.updatedAt ?? '',
  };
}

const catalog: MajorRiskCatalogItem[] = [
  item({
    id: '1', code: '6.1.1.1', title: '机房出入口访问控制措施缺失',
    category: '安全物理环境', criteria: '机房出入口未配置电子门禁或专人值守，可任意进入。',
    keywords: '机房,出入口,门禁,访问控制',
  }),
  item({
    id: '2', code: '6.1.4.1', title: '服务器未启用身份鉴别',
    category: '安全计算环境', criteria: '服务器存在空口令或弱口令账户。',
    keywords: '服务器,弱口令,空口令,身份鉴别',
  }),
  item({ id: '3', code: 'X', title: '无关条目', category: '安全管理制度', keywords: '制度,流程' }),
  item({ id: '4', code: 'D', title: '停用的门禁条目', category: '安全物理环境', keywords: '机房,门禁', enabled: false }),
];

describe('重大风险隐患清单候选召回', () => {
  it('按关键词与场景召回对应条目并排在首位', () => {
    const result = matchCatalogCandidates({
      issueTitle: '机房出入口访问控制措施缺失',
      issueDescription: '机房出入口没有任何访问控制措施，未安装电子门禁，门口无专人值守。',
      securityDomain: 'secure_physical',
      controlPoint: '物理访问控制',
    }, catalog);
    expect(result.length).toBeGreaterThan(0);
    expect(result[0].id).toBe('1');
  });

  it('不召回停用条目', () => {
    const result = matchCatalogCandidates({
      issueTitle: '机房门禁',
      issueDescription: '机房出入口门禁失效',
      securityDomain: 'secure_physical',
    }, catalog);
    expect(result.some(r => r.id === '4')).toBe(false);
  });

  it('清单全为空或全停用时返回空数组', () => {
    expect(matchCatalogCandidates({ issueDescription: '任意问题' }, [])).toEqual([]);
    expect(matchCatalogCandidates({ issueDescription: '机房门禁' }, [catalog[3]])).toEqual([]);
  });

  it('弱相关时按同安全域兜底，且不超过 limit', () => {
    const result = matchCatalogCandidates({
      issueTitle: '其他物理问题',
      issueDescription: '无关描述',
      securityDomain: 'secure_physical',
    }, catalog, 2);
    expect(result.length).toBeLessThanOrEqual(2);
  });
});

describe('提示词格式化', () => {
  it('空清单/空记录给出显式占位，防止模型编造', () => {
    expect(formatCatalogCandidates([])).toContain('不得编造');
    expect(formatRecordSnippets([])).toContain('未检索到');
  });

  it('清单条目格式化带编号与判定要点', () => {
    const text = formatCatalogCandidates([catalog[0]]);
    expect(text).toContain('6.1.1.1');
    expect(text).toContain('机房出入口访问控制措施缺失');
    expect(text).toContain('判定要点');
  });
});

describe('重大风险隐患 AI 草稿解析', () => {
  it('解析标准 JSON：三要素各一段 + verdict', () => {
    const draft = parseMajorRiskDraft(JSON.stringify({
      catalogId: '6.1.1.1',
      catalogTitle: '机房出入口访问控制措施缺失',
      relevance: '问题与清单6.1.1.1判定要点实质吻合。',
      severity: '可导致未授权人员进入机房。',
      frequency: '现场多次出现门禁失效。',
      verdict: 'major',
      conclusion: '三要素均成立，判定为重大风险隐患。',
    }));
    expect(draft.catalogId).toBe('6.1.1.1');
    expect(draft.verdict).toBe('major');
    expect(draft.relevance).toContain('6.1.1.1');
    expect(draft.severity).toContain('未授权');
    expect(draft.frequency).toContain('多次');
  });

  it('容错 Markdown 围栏', () => {
    const draft = parseMajorRiskDraft('```json\n{"verdict":"non_major","relevance":"r","severity":"s","frequency":"f"}\n```');
    expect(draft.verdict).toBe('non_major');
    expect(draft.relevance).toBe('r');
  });

  it('verdict 非法或缺失回落 pending，不抛错', () => {
    expect(parseMajorRiskDraft('{"verdict":"重大"}').verdict).toBe('pending');
    expect(parseMajorRiskDraft('不是 JSON').verdict).toBe('pending');
    expect(parseMajorRiskDraft('').catalogId).toBe('');
  });

  it('嵌套大括号不破坏 JSON 提取', () => {
    const draft = parseMajorRiskDraft('{"relevance":"含 { 括号 } 的说明","verdict":"major"}');
    expect(draft.relevance).toBe('含 { 括号 } 的说明');
    expect(draft.verdict).toBe('major');
  });

  it('catalogId 不在召回白名单时清空编号与标题（防编造）', () => {
    const json = JSON.stringify({
      catalogId: '9.9.9.9', catalogTitle: '模型编造的条目',
      relevance: 'r', severity: 's', frequency: 'f', verdict: 'major',
    });
    const draft = parseMajorRiskDraft(json, ['6.1.1.1', '6.2.1.4']);
    expect(draft.catalogId).toBe('');
    expect(draft.catalogTitle).toBe('');
    const ok = parseMajorRiskDraft(json, ['9.9.9.9']);
    expect(ok.catalogId).toBe('9.9.9.9');
    expect(ok.catalogTitle).toBe('模型编造的条目');
  });
});

describe('防护措施/系统环境关键词命中', () => {
  it('覆盖高发性判定所需的典型防护证据词', () => {
    // 真实分析场景：防火墙严格策略、WAF、专网隔离、专人专用账号
    for (const term of ['防火墙', 'WAF', '访问控制策略', '专网', '不连外网', '专人专用', '堡垒机', '日志审计']) {
      expect(MITIGATION_TERMS).toContain(term.toLowerCase());
    }
  });

  it('防护措施记录计次命中，含标点/大小写干扰也能匹配', () => {
    const text = '网络边界已部署防火墙和WAF，防火墙配置了严格访问控制策略，仅放行必要业务端口。';
    expect(countMitigationHits(text)).toBeGreaterThanOrEqual(3);
  });

  it('不连外网、专人专用等环境描述可命中', () => {
    expect(countMitigationHits('该系统属于内部网络不连外网，各系统账号专人专用。')).toBeGreaterThanOrEqual(2);
  });

  it('无防护内容的普通记录为 0，空文本为 0', () => {
    expect(countMitigationHits('今日现场访谈了机房管理员。')).toBe(0);
    expect(countMitigationHits('')).toBe(0);
  });
});
