/**
 * 结论枚举的回归 + 反漂移门禁。
 *
 * 借鉴 Maodun `catalog_integrity_errors()` / `test_iast_report_semantics.py` 的思路：
 * 同一份结论语义散落在表格、AI 分析、统计 SQL、报告、导入导出多处，手抄必然静默漂移。
 * 这里不改动任何运行时 SQL，只把「各处的字面量必须与唯一真相源一致」变成会红的断言。
 *
 * 参考：shared/assessment-result.ts
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  UI_COMPLIANCE,
  DB_RESULT_VALUES,
  TESTED_RESULTS,
  toUiCompliance,
  parseAiCompliance,
  isDbResult,
} from '../../shared/assessment-result';
import { validateComplianceStatus } from '../../electron/utils/validation';

function readSource(relativePath: string): string {
  return fs.readFileSync(path.resolve(process.cwd(), relativePath), 'utf8');
}

/** 提取源码里所有 `result IN ('a', 'b')` 的值列表。 */
function extractInLists(source: string): string[][] {
  const lists: string[][] = [];
  const re = /result\s+IN\s*\(([^)]*)\)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(source)) !== null) {
    lists.push([...match[1].matchAll(/'([^']+)'/g)].map(m => m[1]));
  }
  return lists;
}

/** 提取源码里所有 `result = 'x'` 的值。 */
function extractEqualityValues(source: string): string[] {
  return [...source.matchAll(/result\s*=\s*'([^']+)'/g)].map(m => m[1]);
}

describe('toUiCompliance：DB 值 / 中文标签 → 表格值', () => {
  it.each<[unknown, string]>([
    ['compliant', 'conform'],
    ['conform', 'conform'],
    ['partial', 'partial'],
    ['non_compliant', 'nonconform'],
    ['nonconform', 'nonconform'],
    ['not_applicable', 'na'],
    ['notapplicable', 'na'],
    ['na', 'na'],
    ['untested', ''],
    ['', ''],
    ['符合', 'conform'],
    ['部分符合', 'partial'],
    ['不符合', 'nonconform'],
    ['不适用', 'na'],
    ['待判定', ''],
    ['未知结论', ''],
    [undefined, ''],
    [null, ''],
    [123, ''],
  ])('%s → %s', (input, expected) => {
    expect(toUiCompliance(input)).toBe(expected);
  });

  it('每个 DB 合法值都能映射到受控的 UI 值域', () => {
    for (const value of DB_RESULT_VALUES) {
      const ui = toUiCompliance(value);
      expect(ui === '' || (UI_COMPLIANCE as readonly string[]).includes(ui)).toBe(true);
    }
  });
});

describe('parseAiCompliance：否定优先，写入与显示同源', () => {
  it('「不符合」绝不能被 includes(符合) 判成符合（历史缺陷回归）', () => {
    expect(parseAiCompliance('不符合')).toBe('nonconform');
    expect(parseAiCompliance('该测评项不符合要求')).toBe('nonconform');
    expect(parseAiCompliance('不合规')).toBe('nonconform');
    expect(parseAiCompliance('non_compliant')).toBe('nonconform');
    expect(parseAiCompliance('noncompliant')).toBe('nonconform');
    expect(parseAiCompliance('NOT compliant')).toBe('nonconform');
  });

  it('「部分符合」先于「符合」判断', () => {
    expect(parseAiCompliance('部分符合')).toBe('partial');
    expect(parseAiCompliance('本项部分符合要求')).toBe('partial');
    expect(parseAiCompliance('PARTIALLY compliant')).toBe('partial');
  });

  it('其余常见写法与未知值', () => {
    expect(parseAiCompliance('不适用')).toBe('na');
    expect(parseAiCompliance('not_applicable')).toBe('na');
    expect(parseAiCompliance('符合')).toBe('conform');
    expect(parseAiCompliance('完全符合要求')).toBe('conform');
    expect(parseAiCompliance('compliant')).toBe('conform');
    expect(parseAiCompliance('conform')).toBe('conform');
    expect(parseAiCompliance('待判定')).toBe('');
    expect(parseAiCompliance('无法判断')).toBe('');
    expect(parseAiCompliance('')).toBe('');
    expect(parseAiCompliance(null)).toBe('');
  });

  it('对所有 DB 合法值，两套解析结果必须一致（防止写入与显示各走一套）', () => {
    for (const value of DB_RESULT_VALUES) {
      expect(parseAiCompliance(value)).toBe(toUiCompliance(value));
    }
  });
});

describe('校验层与唯一真相源一致', () => {
  it('validation 接受的集合恰好是 DB_RESULT_VALUES', () => {
    for (const value of DB_RESULT_VALUES) {
      expect(() => validateComplianceStatus(value)).not.toThrow();
      expect(isDbResult(value)).toBe(true);
    }
    expect(() => validateComplianceStatus('符合')).toThrow();
    expect(() => validateComplianceStatus('na')).toThrow();
    expect(() => validateComplianceStatus('nope')).toThrow();
    expect(isDbResult('na')).toBe(false);
  });

  it('已知例外：notapplicable 可入库但不计入统计（统一前必须先迁移历史数据）', () => {
    expect(DB_RESULT_VALUES).toContain('notapplicable');
    expect(TESTED_RESULTS).not.toContain('notapplicable');
  });
});

describe('反漂移：统计与报表里的 result 字面量', () => {
  const statSources = [
    'electron/services/assessment-progress.ts',
    'electron/services/report.service.ts',
    'electron/ipc/project.ipc.ts',
    'electron/ipc/issue.ipc.ts',
  ];

  it('SQL 里出现的每个 result 值都在合法白名单内（否则会被静默跳过）', () => {
    const allowed = DB_RESULT_VALUES as readonly string[];
    for (const file of statSources) {
      const source = readSource(file);
      const values = [...extractInLists(source).flat(), ...extractEqualityValues(source)];
      expect(values.length, `${file} 未提取到任何 result 字面量，检查正则是否失效`).toBeGreaterThan(0);
      for (const value of values) {
        expect(allowed, `${file} 出现未登记的 result 值: ${value}`).toContain(value);
      }
    }
  });

  it('完整「已判定」口径的三处 SQL 必须与 TESTED_RESULTS 完全一致（不许多也不许少）', () => {
    for (const file of [
      'electron/services/assessment-progress.ts',
      'electron/services/report.service.ts',
      'electron/ipc/project.ipc.ts',
    ]) {
      const lists = extractInLists(readSource(file));
      const tested = lists.find(list => list.length >= TESTED_RESULTS.length);
      expect(tested, `${file} 未找到完整的 tested IN 列表`).toBeDefined();
      expect(new Set(tested)).toEqual(new Set(TESTED_RESULTS));
    }
  });

  it('compliance-stats 的最不利排序集合必须与 TESTED_RESULTS 一致', () => {
    const source = readSource('electron/services/compliance-stats.ts');
    const match = source.match(/const ITEM_RESULT_ORDER\s*=\s*\[([^\]]*)\]/);
    expect(match, '未找到 ITEM_RESULT_ORDER 定义').not.toBeNull();
    const values = [...match![1].matchAll(/'([^']+)'/g)].map(m => m[1]);
    expect(new Set(values)).toEqual(new Set(TESTED_RESULTS));
  });

  it('UI→DB 落库映射只能产出合法 DB 值，且 AI 回填不得另起旁路', () => {
    // 唯一落库映射在 useAutoSave.persist()：AI 单条 / 批量回填现在也统一走它。
    const saveSource = readSource('src/views/onsite-verification/composables/useAutoSave.ts');
    const match = saveSource.match(/const complianceMap: Record<string, AssessmentRecord\['result'\]>\s*=\s*\{([^}]*)\}/);
    expect(match, '未找到 UI→DB 落库映射').not.toBeNull();
    const values = [...match![1].matchAll(/:\s*'([^']+)'/g)].map(m => m[1]);
    expect(values.length).toBeGreaterThan(0);
    for (const value of values) {
      expect(DB_RESULT_VALUES as readonly string[]).toContain(value);
    }

    // 历史 bug：AI 回填曾自己硬编码一份映射直接调 saveRecord，漏传后端必填的
    // projectId / assetId，兜底从未生效；回填还绕过 dirtyMap 导致切页全丢。
    // 这条旁路必须保持移除，避免日后有人「顺手加回来」把数据写歪。
    const aiSource = readSource('src/views/onsite-verification/composables/useAiAnalysis.ts');
    expect(aiSource).not.toMatch(/const complianceMap/);
    expect(aiSource).not.toMatch(/assessment\.saveRecord/);
  });
});
