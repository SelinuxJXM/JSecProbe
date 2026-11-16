/**
 * 外链模块的纯逻辑层：解析、合并、上下文变量、内网判定。
 *
 * 刻意不 import electron / drizzle / fs，这样单测可以直接覆盖「坏了会静默丢数据」
 * 的合并与解析链路，也不用拉起整个主进程。
 */
import { externalUrlHost } from '../utils/external-url';

export type NetworkZone = 'internet' | 'intranet';
export type LinkSource = 'builtin' | 'custom';

/** 只读层的一条链接（内置 seed 或远程 sites.txt 解析结果） */
export interface LinkSeed {
  key: string;
  title: string;
  url: string;
  groupName: string;
  description?: string;
  iconText?: string;
  networkZone?: NetworkZone;
  sortOrder?: number;
}

/** 用户层 external_links 表的一行（数字列保持 0/1，便于直接映射 drizzle 结果） */
export interface LinkRow {
  id: string;
  linkKey: string | null;
  title: string;
  url: string;
  groupName: string;
  description: string;
  iconText: string | null;
  networkZone: NetworkZone;
  isBuiltin: number;
  isHidden: number;
  isFavorite: number;
  isStale: number;
  sortOrder: number;
  scope: string;
  ownerId: string | null;
  lastOpenedAt: string | null;
}

/** 前端实际拿到的统一结构 */
export interface ExternalLinkItem {
  id: string;
  key: string;
  title: string;
  url: string;
  groupName: string;
  description: string;
  iconText: string;
  networkZone: NetworkZone;
  source: LinkSource;
  isHidden: boolean;
  isFavorite: boolean;
  isStale: boolean;
  sortOrder: number;
  lastOpenedAt: string | null;
  /** 内置/远程项是否已有用户覆盖行（管理页据此显示「已自定义」） */
  hasOverride: boolean;
  scope: string;
}

export interface LinkOpenContext {
  projectName?: string;
  assetIp?: string;
  standardCode?: string;
}

/** 稳定短哈希（FNV-1a），用于给远程/导入条目生成不随路径微调而漂移的 key */
function stableHash(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

function makeKey(prefix: string, title: string, url: string, used: Set<string>): string {
  const host = externalUrlHost(url);
  const base = `${prefix}:${stableHash(`${title}|${host}`)}`;
  let key = base;
  let n = 2;
  while (used.has(key)) key = `${base}-${n++}`;
  used.add(key);
  return key;
}

/** 内网判定只用于打标，不用于拦截（见 external-url.ts 的说明） */
export function inferNetworkZone(url: string): NetworkZone {
  const host = externalUrlHost(url).toLowerCase();
  if (!host) return 'internet';
  if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.localhost')) return 'intranet';
  if (host.endsWith('.intra') || host.endsWith('.internal') || host.endsWith('.lan')) return 'intranet';
  if (!host.includes('.') && !host.includes(':')) return 'intranet';
  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const a = Number(ipv4[1]);
    const b = Number(ipv4[2]);
    if (a === 10 || a === 127 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31) || (a === 169 && b === 254)) {
      return 'intranet';
    }
  }
  return 'internet';
}

function stripTags(text: string): string {
  return text
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

export interface SitesTxtParseResult {
  sites: LinkSeed[];
  /** 文件中出现的全部分组（未经过滤），供设置页勾选白名单 */
  availableGroups: string[];
}

/**
 * 解析 soer.ccwu.cc/Nav/sites.txt：
 *   `# 一级分类` / `## 二级分类` / `名称, URL, 描述`
 * 描述里可能含英文逗号，所以只切前两个逗号，剩余部分整体作为描述。
 */
export function parseSitesTxt(content: string, allowedGroups?: string[]): SitesTxtParseResult {
  const lines = String(content || '').split(/\r?\n/);
  const all: LinkSeed[] = [];
  const availableGroups: string[] = [];
  const used = new Set<string>();
  let l1 = '';
  let l2 = '';

  for (const line of lines) {
    const text = line.trim();
    if (!text) continue; // 空行只是排版分隔；遇到下一个 # / ## 时才切换分组
    if (/^##\s+/.test(text)) {
      l2 = text.replace(/^##\s+/, '').trim();
      continue;
    }
    if (/^#\s+/.test(text)) {
      l1 = text.replace(/^#\s+/, '').trim();
      l2 = '';
      continue;
    }
    if (text.startsWith('#') || text.startsWith('//')) continue;

    const first = text.indexOf(',');
    if (first < 0) continue;
    const title = text.slice(0, first).trim();
    const rest = text.slice(first + 1);
    const second = rest.indexOf(',');
    const url = (second < 0 ? rest : rest.slice(0, second)).trim();
    const description = second < 0 ? '' : rest.slice(second + 1).trim();
    if (!title || !url) continue;

    const groupName = [l1, l2].filter(Boolean).join(' / ') || '导航站';
    if (!availableGroups.includes(groupName)) availableGroups.push(groupName);
    all.push({
      key: makeKey('nav', title, url, used),
      title,
      url,
      groupName,
      description,
      networkZone: inferNetworkZone(url),
    });
  }

  const filter = allowedGroups && allowedGroups.length ? new Set(allowedGroups) : null;
  const sites = filter ? all.filter((s) => filter.has(s.groupName)) : all;
  return { sites, availableGroups };
}

/** 解析 Netscape 书签 HTML（Chrome / Edge / Firefox 导出的标准格式） */
export function parseBookmarkHtml(content: string, fallbackGroup = '导入书签'): LinkSeed[] {
  const re = /<H3[^>]*>([\s\S]*?)<\/H3>|<A\s[^>]*?HREF\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/A>/gi;
  const sites: LinkSeed[] = [];
  const used = new Set<string>();
  let groupName = fallbackGroup;
  let m: RegExpExecArray | null;
  while ((m = re.exec(String(content || ''))) !== null) {
    if (m[1] !== undefined) {
      const name = stripTags(m[1]);
      if (name) groupName = name;
      continue;
    }
    const url = (m[2] || '').trim();
    const title = stripTags(m[3] || '') || url;
    if (!url) continue;
    sites.push({
      key: makeKey('bookmark', title, url, used),
      title,
      url,
      groupName,
      networkZone: inferNetworkZone(url),
    });
  }
  return sites;
}

/** 解析本模块导出的 JSON（也兼容直接传数组） */
export function parseImportJson(content: string): LinkSeed[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(String(content || ''));
  } catch {
    throw new Error('JSON 格式不正确');
  }
  const raw = Array.isArray(parsed)
    ? parsed
    : (parsed as { links?: unknown })?.links;
  if (!Array.isArray(raw)) throw new Error('JSON 中未找到 links 数组');

  const sites: LinkSeed[] = [];
  const used = new Set<string>();
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const e = entry as Record<string, unknown>;
    const title = String(e.title ?? e.name ?? '').trim();
    const url = String(e.url ?? '').trim();
    if (!title || !url) continue;
    sites.push({
      key: makeKey('import', title, url, used),
      title,
      url,
      groupName: String(e.groupName ?? e.group ?? '导入链接').trim() || '导入链接',
      description: String(e.description ?? '').trim(),
      iconText: String(e.iconText ?? '').trim(),
      networkZone: (e.networkZone === 'intranet' ? 'intranet' : inferNetworkZone(url)),
      sortOrder: Number(e.sortOrder) || 0,
    });
  }
  return sites;
}

/**
 * 上下文变量替换。变量值做 URL 编码，适合拼在 query 里；
 * 未提供值的变量替换为空串并记入 missing，前端可提示「当前无项目/资产上下文」。
 */
export function applyLinkContext(rawUrl: string, context: LinkOpenContext = {}): { url: string; missing: string[] } {
  const missing: string[] = [];
  const url = rawUrl.replace(/\{(projectName|assetIp|standardCode)\}/gi, (_match, name: string) => {
    const key = (['projectName', 'assetIp', 'standardCode'] as const)
      .find((k) => k.toLowerCase() === name.toLowerCase());
    if (!key) return '';
    const value = context[key];
    if (value === undefined || value === null || value === '') {
      if (!missing.includes(key)) missing.push(key);
      return '';
    }
    return encodeURIComponent(String(value));
  });
  return { url, missing };
}

/**
 * 两层合并：本地只读 seed + 用户层（覆盖行 / 自定义行）。
 * 优先级：用户覆盖 > seed；用户自定义行独立存在。
 * 内置项被官方删除时不会连带删掉用户的覆盖行或自定义行（升级安全）。
 */
export function mergeLinks(input: { builtin: LinkSeed[]; rows: LinkRow[] }): ExternalLinkItem[] {
  const overrides = new Map<string, LinkRow>();
  const items: ExternalLinkItem[] = [];

  for (const row of input.rows) {
    if (row.isBuiltin === 1 && row.linkKey) overrides.set(row.linkKey, row);
  }

  const pushSeed = (seed: LinkSeed): void => {
    const o = overrides.get(seed.key);
    items.push({
      id: `builtin:${seed.key}`,
      key: seed.key,
      title: o?.title || seed.title,
      url: o?.url || seed.url,
      groupName: o?.groupName || seed.groupName,
      description: o?.description ?? seed.description ?? '',
      iconText: o?.iconText ?? seed.iconText ?? '',
      networkZone: (o?.networkZone || seed.networkZone || 'internet') as NetworkZone,
      source: 'builtin' as LinkSource,
      isHidden: o ? o.isHidden === 1 : false,
      isFavorite: o ? o.isFavorite === 1 : false,
      isStale: o ? o.isStale === 1 : false,
      sortOrder: o ? o.sortOrder : (seed.sortOrder ?? 0),
      lastOpenedAt: o?.lastOpenedAt ?? null,
      hasOverride: Boolean(o),
      scope: o?.scope || 'global',
    });
  };

  for (const seed of input.builtin) pushSeed(seed);

  for (const row of input.rows) {
    if (row.isBuiltin === 1) continue;
    items.push({
      id: row.id,
      key: row.linkKey || row.id,
      title: row.title,
      url: row.url,
      groupName: row.groupName,
      description: row.description,
      iconText: row.iconText || '',
      networkZone: row.networkZone,
      source: 'custom',
      isHidden: row.isHidden === 1,
      isFavorite: row.isFavorite === 1,
      isStale: row.isStale === 1,
      sortOrder: row.sortOrder,
      lastOpenedAt: row.lastOpenedAt,
      hasOverride: true,
      scope: row.scope,
    });
  }

  items.sort((a, b) =>
    (Number(b.isFavorite) - Number(a.isFavorite)) ||
    (a.sortOrder - b.sortOrder) ||
    a.title.localeCompare(b.title, 'zh-CN')
  );
  return items;
}

/** 从统一 id 反解来源与 key；自定义项的 id 就是数据库主键 */
export function parseLinkId(id: string): { source: LinkSource; key: string } | null {
  if (id.startsWith('builtin:')) return { source: 'builtin', key: id.slice('builtin:'.length) };
  return null;
}
