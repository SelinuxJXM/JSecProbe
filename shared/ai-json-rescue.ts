/**
 * AI 返回 JSON 的容错救回（针对 {"assets":[...]} 这类数组结构）。
 *
 * 背景：资产识别等功能的输出随附件数量线性增长，模型 max_tokens 不足会在数组
 * 中途截断，导致整体 JSON.parse 失败、整批资产丢失。这里在整体解析失败后，
 * 扫描 "assets": [ 后的对象，逐个做括号配对（字符串/转义感知），只收集结构完整的
 * 对象，碰到截断的不完整对象即停止——保留能救回的，而不是全丢。
 */

/**
 * 从可能被截断的内容里救回 assets 数组中所有结构完整的对象。
 * @returns 成功救回的对象数组；一个都救不回时返回 null。
 */
export function rescueAssetsArray(content: string): any[] | null {
  return rescueArrayByKey(content, 'assets');
}

/**
 * 按指定 key 从可能被截断的 JSON 中救回数组里所有结构完整的对象。
 * 用于 topology_analyze 的 domains 等同类数组结构。
 */
export function rescueArrayByKey(content: string, key: string): any[] | null {
  const text = String(content || '');
  const keyMatch = new RegExp(`"${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"\\s*:\\s*\\[`).exec(text);
  if (!keyMatch) return null;
  let i = keyMatch.index + keyMatch[0].length;
  const out: any[] = [];

  while (i < text.length) {
    // 跳空白与逗号
    while (i < text.length && /[\s,]/.test(text[i])) i++;
    if (i >= text.length || text[i] === ']') break;
    if (text[i] !== '{') {
      // 遇到非对象字符（说明结构已乱），停止
      break;
    }
    // 括号配对扫描，跳过字符串内的括号与转义
    let depth = 0;
    let inStr = false;
    let esc = false;
    let j = i;
    for (; j < text.length; j++) {
      const ch = text[j];
      if (inStr) {
        if (esc) { esc = false; continue; }
        if (ch === '\\') { esc = true; continue; }
        if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') { inStr = true; continue; }
      if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) { j++; break; }
      }
    }
    if (depth !== 0) break; // 对象未闭合（截断），停止
    const objText = text.slice(i, j);
    try {
      const obj = JSON.parse(objText);
      if (obj && typeof obj === 'object') out.push(obj);
      i = j;
    } catch {
      // 括号平衡但内容非法（如尾逗号/单引号）：跳过这一个，继续救回后面的完整对象。
      // 必须先推进 i=j（j>i，不会死循环），否则会在同一个 `{` 上无限重试。
      i = j;
      continue;
    }
  }
  return out.length ? out : null;
}

/**
 * 解析资产识别的 JSON：整体解析优先，失败后剥离围栏重试，再失败则逐对象救回。
 * @returns { assets, partial } partial=true 表示走了救回路径（输出可能被截断）
 */
export function parseAssetsJson(rawContent: string): { assets: any[]; partial: boolean; error: any } {
  let error: any = null;
  let text = String(rawContent || '').trim();
  text = text.replace(/^\s*```(?:json|text)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();

  try {
    const parsed = JSON.parse(text);
    return { assets: Array.isArray(parsed?.assets) ? parsed.assets : [], partial: false, error: null };
  } catch (e) { error = e; }

  // 大括号提取后再试一次（应对围栏外有说明文字）
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try {
      const parsed = JSON.parse(text.slice(start, end + 1));
      return { assets: Array.isArray(parsed?.assets) ? parsed.assets : [], partial: false, error: null };
    } catch (e) { error = e; }
  }

  // 逐对象救回
  const rescued = rescueAssetsArray(text);
  if (rescued) return { assets: rescued, partial: true, error };
  return { assets: [], partial: false, error };
}

/**
 * 解析拓扑分区分域识别结果：{domains:[{name,description}]}。
 * 与资产解析同样的容错策略：整体解析 → 剥围栏 → 大括号提取 → 逐对象救回。
 * 额外做字段清洗：只保留有 name/description 的段，去空白与长度上限。
 */
export function parseDomainsJson(rawContent: string): { domains: Array<{ name: string; description: string }>; overview: string; partial: boolean; rawCount: number } {
  let text = String(rawContent || '').trim();
  text = text.replace(/^\s*```(?:json|text)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
  let raw: any[] = [];
  let overview = '';
  let partial = false;

  try {
    const parsed = JSON.parse(text);
    raw = Array.isArray(parsed?.domains) ? parsed.domains : [];
    overview = typeof parsed?.overview === 'string' ? parsed.overview.trim() : '';
  } catch {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        const parsed = JSON.parse(text.slice(start, end + 1));
        raw = Array.isArray(parsed?.domains) ? parsed.domains : [];
        overview = typeof parsed?.overview === 'string' ? parsed.overview.trim() : '';
      } catch {
        raw = [];
      }
    }
    if (!raw.length) {
      const rescued = rescueArrayByKey(text, 'domains');
      if (rescued) { raw = rescued; partial = true; }
    }
  }

  const domains: Array<{ name: string; description: string }> = [];
  for (const d of raw) {
    if (!d || typeof d !== 'object') continue;
    const name = String(d.name || '').trim().slice(0, 40);
    const description = String(d.description || '').trim().slice(0, 4000);
    if (!name || !description) continue;
    domains.push({ name, description });
  }
  return { domains, overview, partial, rawCount: raw.length };
}
