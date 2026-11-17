/**
 * 重大风险隐患清单种子数据（用户提供）。
 *
 * 数据从桌面 xlsx 抽取，共 32 条，含安全域/控制点(并入关键词)/测评项原文(判定标准)/
 * 触发项(隐患名称)/判定情形(危害场景)。作为内置参考清单，首次启动入驻 major_risk_catalog 表。
 * 用户可在页面上导入自己的清单全量替换，或逐条编辑；种子只在版本升级时补新条目，
 * 不覆盖用户已改动的同名条目。
 */
import seedJsonRaw from './major-risk-catalog.seed.json?raw';

/** 种子版本：清单内容变更时 +1，触发一次补种 */
export const MAJOR_RISK_SEED_VERSION = 1;

export interface MajorRiskSeedItem {
  code: string;
  title: string;
  category: string;
  criteria: string;
  keywords: string;
  source: string;
}

interface SeedFile {
  source: string;
  count: number;
  principle: string;
  items: MajorRiskSeedItem[];
}

/** 判定原则原文（三要素定义），供提示词/说明引用 */
export function getMajorRiskPrinciple(): string {
  const data = JSON.parse(seedJsonRaw) as SeedFile;
  return data.principle || '';
}

/** 读取种子条目；id 稳定由 code 派生，便于版本升级时判重 */
export function getMajorRiskCatalogSeeds(): Array<MajorRiskSeedItem & { id: string; sortOrder: number }> {
  const data = JSON.parse(seedJsonRaw) as SeedFile;
  return (data.items || []).map((item, i) => ({
    ...item,
    id: `builtin-major-risk-${String(item.code || i + 1).padStart(3, '0')}`,
    sortOrder: i,
  }));
}
