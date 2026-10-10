/**
 * 内置标准 seed 关键链路测试
 *
 * 为什么值得测：seed 入驻有一条"静默跳过"的短路 —— 启动时只要
 * system_settings.standardDataVersion === STANDARD_DATA_VERSION(=9) 且 BUILTIN_STANDARD_CODES
 * 里的 code 都已在库，就直接跳过整段 seed 加载（见 electron/db/index.ts:1080）。
 *
 * 于是"往 seed JSON 里加了新标准，但忘了把它的 code 写进 BUILTIN_STANDARD_CODES"这种改动
 * 不会报任何错，只是那批标准永远入驻不了；反过来常量里多写一个不存在的 code，
 * 则每次启动都白跑一遍 468KB 全量加载。这里把这份隐式契约变成断言。
 */
import { describe, it, expect, beforeEach } from 'vitest';

import {
  getStandardSeeds,
  releaseStandardSeeds,
  BUILTIN_STANDARD_CODES,
} from '../../electron/db/seeds/standards';

beforeEach(() => {
  // 每个用例从"冷缓存"开始，避免用例之间靠执行顺序互相影响
  releaseStandardSeeds();
});

describe('BUILTIN_STANDARD_CODES 与 seed 数据的一致性（最关键）', () => {
  it('常量集合与 seed 实际 code 集合完全相等（双向）', () => {
    const seedCodes = new Set(getStandardSeeds().standards.map(s => s.code));
    const declared = new Set(BUILTIN_STANDARD_CODES);

    // 少写 → 短路判断放行，新标准永远不会入驻，且不报错
    const missingInConstant = [...seedCodes].filter(code => !declared.has(code));
    // 多写 → 短路判断永远不成立，每次启动都白跑一遍全量 seed 加载
    const extraInConstant = [...declared].filter(code => !seedCodes.has(code));

    expect(missingInConstant).toEqual([]);
    expect(extraInConstant).toEqual([]);
  });

  it('常量非空且无重复项', () => {
    expect(BUILTIN_STANDARD_CODES.length).toBeGreaterThan(0);
    expect(new Set(BUILTIN_STANDARD_CODES).size).toBe(BUILTIN_STANDARD_CODES.length);
  });
});

describe('seed 数据自洽性', () => {
  it('能解析出非空的标准与测评项（?raw + 惰性 JSON.parse 链路可用）', () => {
    const seed = getStandardSeeds();

    expect(Array.isArray(seed.standards)).toBe(true);
    expect(Array.isArray(seed.items)).toBe(true);
    expect(seed.standards.length).toBeGreaterThan(0);
    expect(seed.items.length).toBeGreaterThan(0);
  });

  it('标准 id / code 唯一、测评项 id 唯一（按 code 幂等入驻依赖此前提）', () => {
    const { standards, items } = getStandardSeeds();

    expect(new Set(standards.map(s => s.id)).size).toBe(standards.length);
    expect(new Set(standards.map(s => s.code)).size).toBe(standards.length);
    expect(new Set(items.map(i => i.id)).size).toBe(items.length);
  });

  it('测评项的 standardId 全部能对上标准，无孤儿行', () => {
    const { standards, items } = getStandardSeeds();
    const standardIds = new Set(standards.map(s => s.id));

    expect(items.filter(i => !standardIds.has(i.standardId)).map(i => i.id)).toEqual([]);
  });

  it('标准上冗余的 itemCount / domainCount 与实际测评项一致（否则界面统计对不上）', () => {
    const { standards, items } = getStandardSeeds();

    for (const standard of standards) {
      const own = items.filter(i => i.standardId === standard.id);
      expect(own.length, `${standard.code} 的 itemCount`).toBe(standard.itemCount);
      expect(new Set(own.map(i => i.domain)).size, `${standard.code} 的 domainCount`).toBe(
        standard.domainCount
      );
    }
  });

  it('标准字段无缺失、无空串', () => {
    for (const standard of getStandardSeeds().standards) {
      expect(standard.id, standard.code).toBeTruthy();
      expect(standard.name, standard.code).toBeTruthy();
      expect(standard.code).toBeTruthy();
      expect(standard.version, standard.code).toBeTruthy();
      expect(standard.levelCombo, standard.code).toBeTruthy();
    }
  });

  it('测评项关键字段无缺失、无空串（空 requirement 会让测评项变成一张空表）', () => {
    const blanks = getStandardSeeds().items.filter(
      i => !i.id || !i.standardId || !i.domain || !i.controlPoint || !i.requirement
    );

    expect(blanks.map(i => i.id)).toEqual([]);
  });

  it('每条测评项的等级区间不颠倒（minLevel <= maxLevel）', () => {
    const bad = getStandardSeeds().items.filter(i => i.minLevel > i.maxLevel);

    expect(bad.map(i => i.id)).toEqual([]);
  });
});

describe('惰性解析与缓存释放', () => {
  it('重复调用返回同一份缓存对象，不重复 parse', () => {
    expect(getStandardSeeds()).toBe(getStandardSeeds());
  });

  it('release 之后确实重新解析（引用变了）且内容完全一致', () => {
    const first = getStandardSeeds();
    const snapshot = JSON.stringify(first);

    releaseStandardSeeds();
    const second = getStandardSeeds();

    expect(second).not.toBe(first);
    expect(JSON.stringify(second)).toBe(snapshot);
  });
});