/**
 * 按资产/全局层面导出 Excel 时，判断某个域是否应生成「XX_全局层面」sheet。
 *
 * 背景：导出弹窗把勾选拆成 assetIds 与 domainIds 两组。只勾选资产时 domainIds
 * 是**显式空数组**，含义是「一个全局层面都没选」。旧实现把 `length === 0`
 * 当成「不限制、全部导出」，于是每个域都多出一张全局层面表，里面还装着
 * 用户未勾选的全局测评记录（结论与证据引用），既超出选择范围也不适合外发。
 *
 * 因此这里只把「参数根本没传」视为兼容旧调用的全量语义；只要传了数组，
 * 哪怕是空的，也严格按数组内容精确匹配。
 */
export function shouldIncludeGlobalSheet(
  domainIds: string[] | null | undefined,
  domainKey: string,
): boolean {
  // 旧调用可能只传 (projectId, assetIds)，第三个参数缺失时才回落为全量
  if (domainIds == null) return true;
  return domainIds.includes(domainKey);
}
