/**
 * 核查命令库种子数据
 * 涵盖网络设备、安全设备、服务器、数据库、中间件等类型
 * 包含各品牌、各系统的准确核查命令
 *
 * 与 standards.ts 同样的处理：原本是 4,063 行的 TS 数组字面量，纯数据却要 esbuild 每次构建
 * 完整解析一遍。现把 319 条命令抽到同目录 commands.seed.json（100KB），本文件只留类型和加载逻辑。
 *
 * 注意 createdAt / updatedAt 不进 JSON：它们用的是"入驻那一刻"的时间戳，
 * 固化进数据文件会让所有环境拿到同一个日期。这里在解析时统一补 now，语义与原实现一致。
 */

import commandsJsonRaw from './commands.seed.json?raw';

export interface SeedCommand {
  id: string;
  name: string;
  target: string;
  command: string;
  description: string;
  os: string;
  brand: string;
  deviceType: string;
  category: string;
  subCategory: string;
  createdAt?: string;
  updatedAt?: string;
}

/** JSON 里只存静态字段，时间戳在加载时补齐 */
type SeedCommandStatic = Omit<SeedCommand, 'createdAt' | 'updatedAt'>;

export function getCommandSeeds(): SeedCommand[] {
  const now = new Date().toISOString();
  const raw = JSON.parse(commandsJsonRaw) as SeedCommandStatic[];
  return raw.map((c) => ({ ...c, createdAt: now, updatedAt: now }));
}
