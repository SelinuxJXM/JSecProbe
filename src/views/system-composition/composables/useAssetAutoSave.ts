import { type Ref } from 'vue';
import type { Asset } from '@shared/types';
import { formatSaveTime } from '@/utils/format-save-time';
import { useAutoSaveCore } from '@/composables/useAutoSaveCore';

interface AssetAutoSaveOptions {
  assetList: Ref<Asset[]>;
  modifiedRows: Set<string>;
  deletedIds: Set<string>;
  currentCategory: Ref<string>;
  route: any;
  loadAssets: () => Promise<void>;
  /**
   * 轻量刷新：只更新总数与分类计数，不重建列表 DOM。
   * 常规保存走这条路——此前每次自动保存都 `await loadAssets()` 重建整张表，
   * 行对象换新、表格重排，正在填写的单元格会被打断。
   */
  loadStats?: () => Promise<void>;
  /** 临时行（temp_）落库成功后的回写钩子，由页面负责把 row.id 换成真实 id */
  onRowCreated?: (row: Asset, created: any) => void;
  debounceDelay?: number;
  periodicInterval?: number;
}

export function useAssetAutoSave(options: AssetAutoSaveOptions) {
  const {
    assetList,
    modifiedRows,
    deletedIds,
    currentCategory,
    route,
    loadAssets,
    loadStats,
    onRowCreated,
    // 8 秒：与项目列表统一口径。计时由 markModified 在每次真正改动时重置，
    // 这里的含义是「停手多久算填完」，不是「多久强制存一次」。
    // 数据不丢：切分类/翻页/离开组件前都有 flush 兜底。
    debounceDelay = 8000,
    periodicInterval = 45000,
  } = options;

  /**
   * 只回写服务端维护的时间戳类字段。
   * 名称/用途/备注等用户正在输入的字段以浏览器里的值为准 ——
   * 否则保存往返期间继续敲的字会被服务端回显覆盖掉。
   */
  function patchSavedMeta(row: Asset, saved: any) {
    if (!saved) return;
    if (saved.updatedAt) (row as any).updatedAt = saved.updatedAt;
  }

  /** 资产台账的落库实现：定时器/互斥/状态机由 useAutoSaveCore 统一负责 */
  async function persist(): Promise<boolean> {
    const projectId = route.params.id as string;
    // 快照：保存过程中用户可能继续改动，结束时不该把新改动标记抹掉
    const dirtySnapshot = [...modifiedRows];
    const succeeded = new Set<string>();
    let needsReload = false;
    let failed = 0;
    try {
      for (const id of deletedIds) {
        const res = await window.api.asset.remove(id);
        if (!res.success) failed++;
      }
      deletedIds.clear();

      for (const row of assetList.value) {
        const key = String(row.id);
        const isNewRow = key.startsWith('temp_');
        if (!dirtySnapshot.includes(key) && !isNewRow) continue;

        if (isNewRow) {
          // 没填名称的草稿行：不落库也不算失败，留在页面上继续填
          if (!row.name?.trim()) {
            succeeded.add(key);
            continue;
          }
          const res = await window.api.asset.create({
            projectId: row.projectId || projectId,
            category: row.category || currentCategory.value,
            name: row.name.trim(),
            os: row.os,
            version: row.version,
            deviceUsage: row.deviceUsage,
            description: row.description,
            quantity: row.quantity,
            ip: row.ip,
            importance: row.importance,
            isVirtual: row.isVirtual,
            dbSystem: row.dbSystem || undefined,
            middleware: row.middleware || undefined,
            isAssessmentTarget: row.isAssessmentTarget,
          });
          if (!res.success) {
            failed++;
            continue;
          }
          succeeded.add(key);
          if (res.data?.id) {
            // 临时行 → 真实行
            succeeded.add(String(res.data.id));
            onRowCreated?.(row, res.data);
          } else {
            // 拿不到新 id 就无法就地改写，退回整表重载
            needsReload = true;
          }
        } else {
          const res = await window.api.asset.update(key, {
            name: row.name,
            os: row.os,
            version: row.version,
            deviceUsage: row.deviceUsage,
            description: row.description,
            quantity: row.quantity,
            ip: row.ip,
            importance: row.importance,
            isVirtual: row.isVirtual,
            dbSystem: row.dbSystem || undefined,
            middleware: row.middleware || undefined,
            isAssessmentTarget: row.isAssessmentTarget,
          });
          if (!res.success) {
            failed++;
            continue;
          }
          succeeded.add(key);
          patchSavedMeta(row, res.data);
        }
      }

      // 只清掉本次成功落库的行，失败的行留着等下一次触发重试（周期保存兜底）
      for (const id of succeeded) {
        modifiedRows.delete(id);
      }

      if (needsReload) {
        await loadAssets();
      } else {
        await loadStats?.();
      }
      return failed === 0;
    } catch (error) {
      console.error('[资产台账] 保存失败:', error);
      return false;
    }
  }

  const core = useAutoSaveCore({
    hasDirty: () => modifiedRows.size > 0 || deletedIds.size > 0,
    persist,
    debounceDelay,
    periodicInterval,
    busyMessageType: 'info',
  });

  /** 列表被整表重建后调用：脏标记随数据一起失效 */
  function markClean() {
    modifiedRows.clear();
    deletedIds.clear();
    core.saveStatus.value = core.lastSavedTime.value ? 'saved' : 'idle';
  }

  function cleanup() {
    core.cleanup('资产台账');
  }

  return {
    saveStatus: core.saveStatus,
    hasUnsavedChanges: core.hasUnsavedChanges,
    lastSavedTime: core.lastSavedTime,
    saveAllChanges: core.runSave,
    debounceAutoSave: core.scheduleSave,
    startPeriodicSave: core.startPeriodicSave,
    stopPeriodicSave: core.stopPeriodicSave,
    triggerManualSave: core.triggerManualSave,
    markClean,
    formatSaveTime,
    cleanup,
  };
}
