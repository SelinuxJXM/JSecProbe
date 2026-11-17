import { describe, it, expect, vi } from 'vitest';

// seed 模块用 ?raw 导入 JSON，vitest(node) 不认识该后缀；用 alias 映射到纯文本读取
vi.mock('./major-risk-catalog.seed.json?raw', () => {
  const fs = require('fs');
  const path = require('path');
  const p = path.resolve(__dirname, '../../electron/db/seeds/major-risk-catalog.seed.json');
  return { default: fs.readFileSync(p, 'utf-8') };
});

describe('重大风险隐患清单内置种子', () => {
  it('恰好 32 条，编号唯一，字段齐全', async () => {
    const { getMajorRiskCatalogSeeds } = await import('../../electron/db/seeds/major-risk-catalog');
    const seeds = getMajorRiskCatalogSeeds();
    expect(seeds).toHaveLength(32);
    const codes = seeds.map(s => s.code);
    expect(new Set(codes).size).toBe(32);
    for (const s of seeds) {
      expect(s.id).toBeTruthy();
      expect(s.title).toBeTruthy();
      expect(s.category).toBeTruthy();
      expect(s.criteria).toBeTruthy();
      expect(s.keywords).toBeTruthy();
      expect(s.sortOrder).toBeGreaterThanOrEqual(0);
    }
  });

  it('判定原则原文含三要素关键词', async () => {
    const { getMajorRiskPrinciple } = await import('../../electron/db/seeds/major-risk-catalog');
    const principle = getMajorRiskPrinciple();
    expect(principle).toContain('相关性原则');
    expect(principle).toContain('严重性原则');
    expect(principle).toContain('高发性原则');
    expect(principle).toContain('缓解措施');
  });

  it('含综合类条目与典型触发项', async () => {
    const { getMajorRiskCatalogSeeds } = await import('../../electron/db/seeds/major-risk-catalog');
    const seeds = getMajorRiskCatalogSeeds();
    expect(seeds.some(s => s.title.includes('空口令') || s.title.includes('弱口令'))).toBe(true);
    expect(seeds.some(s => s.category === '综合类' && s.title.includes('互联网暴露面'))).toBe(true);
  });
});
