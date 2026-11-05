/**
 * 测评记录的证据文件引用读写工具。
 *
 * 「关键证据点」上传的文件本体落在 appData/screenshots|evidence 下，
 * 数据库 assessment_records.screenshot_paths 只存 JSON 路径数组。
 * 现场核查页每次切换测评对象 / 全局层面都会整表重建行，重建时必须把这份引用读回来：
 * 否则界面上看不到文件，而随后任意一次自动保存又会把空数组写回库，引用被抹掉，
 * 设置页的孤儿文件清理还会据此删掉磁盘原件（不可逆）。
 *
 * 因此全局视图与资产视图必须共用同一个读回函数，不允许某一处硬编码 []。
 */

/** 安全解析 screenshot_paths：历史脏数据可能不是合法 JSON 或不是数组 */
export function safeParseScreenshots(raw?: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((p): p is string => typeof p === 'string' && p.length > 0);
  } catch {
    return [];
  }
}

/** 从一条测评记录（项目级 assetId=null 或资产级）还原证据文件路径列表 */
export function screenshotsFromRecord(
  record?: { screenshotPaths?: string | null } | null,
): string[] {
  return safeParseScreenshots(record?.screenshotPaths);
}
