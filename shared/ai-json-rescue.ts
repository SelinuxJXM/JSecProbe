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
  const text = String(content || '');
  // 定位 assets 数组的左括号
  const keyMatch = /"assets"\s*:\s*\[/.exec(text);
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
      break; // 非法对象，停止
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
