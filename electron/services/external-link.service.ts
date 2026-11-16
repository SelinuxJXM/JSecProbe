/**
 * 内置 / 自定义外链：IO 层。
 *
 * 分层（纯逻辑在 external-link-core.ts）：
 *   只读层 = 本地打包 seed（导航站本身即其中一条外链，不做任何远程同步/缓存）
 *   用户层 = external_links 表（自定义行 + 对内置项的覆盖行）
 *   统一出口 = 本文件的 openLink() → normalizeExternalUrl() → shell.openExternal()
 *
 * 想导航站里的链接也能在应用内搜到，用「导入 sites.txt」手动搬一次即可：
 * 用户主动选文件、无网络依赖、导入前可审查，比后台自动同步更简单也更可靠。
 */
import { shell } from 'electron';
import { randomUUID } from 'crypto';
import { eq, and } from 'drizzle-orm';
import log from 'electron-log';
import { getDb } from '../db';
import * as schema from '../db/schema';
import { normalizeExternalUrl, externalUrlHost } from '../utils/external-url';
import { BUILTIN_LINKS } from './external-link.seed';
import { RECOMMENDED_SITES_GROUPS } from '../../shared/types';
import {
  applyLinkContext,
  inferNetworkZone,
  mergeLinks,
  parseBookmarkHtml,
  parseImportJson,
  parseLinkId,
  parseSitesTxt,
  type ExternalLinkItem,
  type LinkOpenContext,
  type LinkRow,
  type LinkSeed,
  type NetworkZone,
} from './external-link-core';

export interface LinkPatch {
  title?: string;
  url?: string;
  groupName?: string;
  description?: string;
  iconText?: string;
  networkZone?: NetworkZone;
  isHidden?: boolean;
  isFavorite?: boolean;
  isStale?: boolean;
  sortOrder?: number;
  lastOpenedAt?: string | null;
}

export interface ImportResult {
  imported: number;
  skipped: number;
  errors: string[];
}

/** 内置 seed 的 key 索引：纯内存，不查库、不联网 */
const BUILTIN_INDEX = new Map<string, LinkSeed>(BUILTIN_LINKS.map((s) => [s.key, s]));

function now(): string {
  return new Date().toISOString();
}

function toLinkRow(r: any): LinkRow {
  return {
    id: String(r.id),
    linkKey: r.linkKey ?? null,
    title: String(r.title),
    url: String(r.url),
    groupName: String(r.groupName || '自定义'),
    description: String(r.description || ''),
    iconText: r.iconText ?? null,
    networkZone: (r.networkZone === 'intranet' ? 'intranet' : 'internet') as NetworkZone,
    isBuiltin: Number(r.isBuiltin) || 0,
    isHidden: Number(r.isHidden) || 0,
    isFavorite: Number(r.isFavorite) || 0,
    isStale: Number(r.isStale) || 0,
    sortOrder: Number(r.sortOrder) || 0,
    scope: String(r.scope || 'global'),
    ownerId: r.ownerId ?? null,
    lastOpenedAt: r.lastOpenedAt ?? null,
  };
}

export async function listLinks(): Promise<ExternalLinkItem[]> {
  const db = getDb();
  const rows = (await db.select().from(schema.externalLinks)).map(toLinkRow);
  return mergeLinks({ builtin: BUILTIN_LINKS, rows });
}

/** 找到某条内置项的用户覆盖行（找不到返回 null） */
async function findOverrideRow(key: string): Promise<any | null> {
  const db = getDb();
  const rows = await db.select().from(schema.externalLinks).where(
    and(
      eq(schema.externalLinks.linkKey, key),
      eq(schema.externalLinks.isBuiltin, 1),
      eq(schema.externalLinks.scope, 'global')
    )
  );
  return rows[0] ?? null;
}

function toDbPatch(patch: LinkPatch): Record<string, unknown> {
  const out: Record<string, unknown> = { updatedAt: now() };
  const stringFields: Array<keyof LinkPatch> = ['title', 'groupName', 'description', 'iconText', 'networkZone'];
  for (const field of stringFields) {
    if (patch[field] !== undefined) out[field] = patch[field];
  }
  const boolFields: Array<keyof LinkPatch> = ['isHidden', 'isFavorite', 'isStale'];
  for (const field of boolFields) {
    if (patch[field] !== undefined) out[field] = patch[field] ? 1 : 0;
  }
  if (patch.sortOrder !== undefined) out.sortOrder = Number(patch.sortOrder) || 0;
  if (patch.lastOpenedAt !== undefined) out.lastOpenedAt = patch.lastOpenedAt;
  if (patch.url !== undefined) out.url = normalizeExternalUrl(patch.url);
  return out;
}

/** 内置项的覆盖行：不存在时按 seed 原值复制一份完整行再打补丁 */
async function upsertOverride(seed: LinkSeed, patch: LinkPatch): Promise<void> {
  const db = getDb();
  const existing = await findOverrideRow(seed.key);
  const dbPatch = toDbPatch(patch);
  if (existing) {
    await db.update(schema.externalLinks).set(dbPatch).where(eq(schema.externalLinks.id, existing.id));
    return;
  }
  const stamp = now();
  await db.insert(schema.externalLinks).values({
    id: randomUUID(),
    linkKey: seed.key,
    title: seed.title,
    url: normalizeExternalUrl(seed.url),
    groupName: seed.groupName,
    description: seed.description || '',
    iconText: seed.iconText || '',
    networkZone: seed.networkZone || 'internet',
    isBuiltin: 1,
    isHidden: 0,
    isFavorite: 0,
    isStale: 0,
    sortOrder: seed.sortOrder ?? 0,
    scope: 'global',
    ownerId: null,
    lastOpenedAt: null,
    createdAt: stamp,
    updatedAt: stamp,
    ...dbPatch,
  } as typeof schema.externalLinks.$inferInsert);
}

export async function createLink(data: LinkPatch & { title: string; url: string }): Promise<string> {
  const db = getDb();
  const title = String(data.title || '').trim();
  if (!title) throw new Error('链接名称不能为空');
  const url = normalizeExternalUrl(data.url);
  const id = randomUUID();
  const stamp = now();
  await db.insert(schema.externalLinks).values({
    id,
    linkKey: null,
    title,
    url,
    groupName: String(data.groupName || '自定义').trim() || '自定义',
    description: String(data.description || '').trim(),
    iconText: String(data.iconText || '').trim(),
    networkZone: data.networkZone || inferNetworkZone(url),
    isBuiltin: 0,
    isHidden: data.isHidden ? 1 : 0,
    isFavorite: data.isFavorite ? 1 : 0,
    isStale: 0,
    sortOrder: Number(data.sortOrder) || 0,
    scope: 'global',
    ownerId: null,
    lastOpenedAt: null,
    createdAt: stamp,
    updatedAt: stamp,
  });
  return id;
}

export async function updateLink(id: string, patch: LinkPatch): Promise<ExternalLinkItem> {
  const db = getDb();
  const parsed = parseLinkId(id);
  if (parsed) {
    const seed = BUILTIN_INDEX.get(parsed.key);
    if (!seed) throw new Error('该内置链接已下线，可作为自定义链接重新添加');
    await upsertOverride(seed, patch);
  } else {
    if (patch.url !== undefined) patch = { ...patch, url: normalizeExternalUrl(patch.url) };
    await db.update(schema.externalLinks).set(toDbPatch(patch)).where(eq(schema.externalLinks.id, id));
  }
  const item = (await listLinks()).find((l) => l.id === id);
  if (!item) throw new Error('保存后未能读回该链接，请重试');
  return item;
}

/** 内置项不允许真删（否则升级后会被 seed 重新加回来），统一降级为隐藏 */
export async function deleteLink(id: string): Promise<void> {
  const db = getDb();
  const parsed = parseLinkId(id);
  if (!parsed) {
    await db.delete(schema.externalLinks).where(eq(schema.externalLinks.id, id));
    return;
  }
  const seed = BUILTIN_INDEX.get(parsed.key);
  if (seed) await upsertOverride(seed, { isHidden: true });
}

export async function reorderLinks(orderedIds: string[]): Promise<void> {
  const db = getDb();
  for (let i = 0; i < orderedIds.length; i++) {
    const id = orderedIds[i];
    const sortOrder = (i + 1) * 10;
    const parsed = parseLinkId(id);
    if (parsed) {
      const seed = BUILTIN_INDEX.get(parsed.key);
      if (seed) await upsertOverride(seed, { sortOrder });
    } else {
      await db.update(schema.externalLinks).set({ sortOrder, updatedAt: now() }).where(eq(schema.externalLinks.id, id));
    }
  }
}

/** 统一出口：变量替换 → 校验 → 系统浏览器；内置项与自定义项都走这里 */
export async function openLink(
  id: string,
  context: LinkOpenContext = {}
): Promise<{ url: string; missing: string[]; source: string }> {
  const item = (await listLinks()).find((l) => l.id === id);
  if (!item) throw new Error('链接不存在或已下线');
  const { url: withContext, missing } = applyLinkContext(item.url, context);
  const url = normalizeExternalUrl(withContext);

  await shell.openExternal(url);

  // 记录最近打开时间属于锦上添花：链接已经打开成功，这一步失败不能反过来报「打开失败」
  try {
    const stamp = now();
    const parsed = parseLinkId(id);
    if (parsed) {
      const seed = BUILTIN_INDEX.get(parsed.key);
      if (seed) await upsertOverride(seed, { lastOpenedAt: stamp });
    } else {
      const db = getDb();
      await db.update(schema.externalLinks)
        .set({ lastOpenedAt: stamp, updatedAt: stamp })
        .where(eq(schema.externalLinks.id, id));
    }
  } catch (e) {
    log.warn('[外链] 记录最近打开时间失败:', e);
  }
  // 日志只记主机与来源，绝不记录带 token / 凭据的完整 URL
  log.info('[外链] 已打开', { host: externalUrlHost(url), source: item.source });
  return { url, missing, source: item.source };
}

export async function importLinks(payload: {
  format: 'sites' | 'bookmarks' | 'json';
  content: string;
  groups?: string[];
}): Promise<ImportResult> {
  let seeds: LinkSeed[] = [];
  if (payload.format === 'sites') {
    // groups=undefined 表示用户明确要「导入全部」；
    // groups=[] 表示勾了「仅测评相关」但没选分类，回退推荐分类而不是放行全量。
    const groups = payload.groups === undefined
      ? undefined
      : (payload.groups.length ? payload.groups : RECOMMENDED_SITES_GROUPS);
    seeds = parseSitesTxt(payload.content, groups).sites;
  } else if (payload.format === 'bookmarks') {
    seeds = parseBookmarkHtml(payload.content);
  } else {
    seeds = parseImportJson(payload.content);
  }

  // 历史数据里可能存在早期未规范化的 URL，逐条容错，不能因一条脏数据让整批导入失败
  const existing = new Set<string>();
  for (const link of await listLinks()) {
    try {
      existing.add(normalizeExternalUrl(link.url));
    } catch {
      existing.add(link.url);
    }
  }
  const errors: string[] = [];
  let imported = 0;
  let skipped = 0;
  for (const seed of seeds) {
    let url: string;
    try {
      url = normalizeExternalUrl(seed.url);
    } catch (e: any) {
      errors.push(`${seed.title}: ${e?.message || 'URL 不合法'}`);
      continue;
    }
    if (existing.has(url)) {
      skipped++;
      continue;
    }
    existing.add(url);
    await createLink({
      title: seed.title,
      url,
      groupName: seed.groupName,
      description: seed.description,
      iconText: seed.iconText,
      networkZone: seed.networkZone,
      sortOrder: seed.sortOrder,
    });
    imported++;
  }
  return { imported, skipped, errors: errors.slice(0, 20) };
}

/** 只导出用户自定义项；内置项随版本自带，不进团队共享文件 */
export async function exportLinks(): Promise<string> {
  const db = getDb();
  const rows = (await db.select().from(schema.externalLinks)).map(toLinkRow);
  const links = rows
    .filter((r) => r.isBuiltin === 0)
    .map((r) => ({
      title: r.title,
      url: r.url,
      groupName: r.groupName,
      description: r.description,
      iconText: r.iconText || '',
      networkZone: r.networkZone,
      isFavorite: r.isFavorite === 1,
      sortOrder: r.sortOrder,
    }));
  return JSON.stringify({ version: 1, exportedAt: now(), links }, null, 2);
}
