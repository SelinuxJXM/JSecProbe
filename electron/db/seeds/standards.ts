// 内置测评标准 Seed 数据源（数据文件请勿手工修改；如需更新请重新导出）
//
// 历史包袱：这一度是仓库里最大的文件（13,932 行 / 563KB 的 TS 数组字面量）。
// 每次 vite 构建都要让 esbuild 完整解析一遍，IDE 打开也明显卡顿，而它其实只是纯数据。
// 现已把数据抽到同目录的 standards.seed.json（JSON.stringify 紧凑格式，468KB），
// 本文件只保留类型、惰性解析与缓存释放——构建期不再解析上万行 TS，源码行数降到百行级。
//
// 用 ?raw 而不是默认 JSON 导入，是为了让 releaseStandardSeeds() 依然真的能释放：
// 默认导入会被编译成模块级对象常量，永远驻留；这里保存的是字符串，只在需要时 parse 一次，
// 用完置空即可回收。（附带好处：JSON.parse 比逐条执行数组字面量更快。）
//
// 数据用途：标准库导入的标准及其测评项，封装为内置 seed，
// 在全新环境 / 升级时自动入驻（按 code 幂等判重，绝不覆盖或删除用户已导入/覆盖导入的标准及其测评项）。
//
// 重新生成方式（改动源数据后执行）：
//   node -e 用 esbuild transformSync 编译旧 TS → require → getStandardSeeds() → JSON.stringify 落盘

import seedJsonRaw from './standards.seed.json?raw';

export interface SeedStandard {
  id: string;
  name: string;
  code: string;
  version: string;
  description: string | null;
  grade: number;
  domainCount: number;
  itemCount: number;
  isDefault: number;
  standardType: string;
  industry: string | null;
  source: string;
  presetTemplate: string | null;
  domainsMeta: string | null;
  presetMethod: string | null;
  columnMap: string | null;
  levelCombo: string;
}

export interface SeedAssessmentItem {
  id: string;
  standardId: string;
  domain: string;
  controlPoint: string;
  controlName: string;
  requirement: string;
  minLevel: number;
  maxLevel: number;
  extensionType: string;
  isHighRisk: number;
  sortOrder: number;
  parentId: string | null;
  presetResult: string | null;
  presetRecord: string | null;
  presetByType: string | null;
}

export interface SeedBundle {
  standards: SeedStandard[];
  items: SeedAssessmentItem[];
}

let seedCache: SeedBundle | null = null;

/**
 * 惰性解析内置 seed。
 *
 * 绝大多数启动都不需要它（标准早已入驻，db/index.ts 先用 BUILTIN_STANDARD_CODES 判重短路），
 * 所以解析成本只在真正首次入驻时付出一次；解析结果缓存，重复调用不再 parse。
 */
export function getStandardSeeds(): SeedBundle {
  if (!seedCache) {
    seedCache = JSON.parse(seedJsonRaw) as SeedBundle;
  }
  return seedCache;
}

/**
 * 释放 seed 缓存。入驻完成后由 db/index.ts 调用，把解析出的数万个小对象交还 GC。
 */
export function releaseStandardSeeds(): void {
  seedCache = null;
}

/**
 * 内置标准的 code 清单（轻量常量）。
 *
 * 用途：启动时先拿它做存在性检查 —— 全部命中且标准数据版本一致，说明这批 seed 已入驻过，
 * 直接跳过 seed 加载，不必为了「按 code 判重」而把整份 JSON parse 出来。
 *
 * 写死而不用 `getStandardSeeds().standards.map(s => s.code)`，正是为了避免为了取几个字符串
 * 而解析整个数据文件。**新增/删除内置标准时必须同步更新此常量。**
 */
export const BUILTIN_STANDARD_CODES: readonly string[] = [
  'GB/T 22239-2019-S2A2G2',
  'DL/T 2614-2023-S2A3G3',
  'GB/T 22239-2019-S3A3G3',
];
