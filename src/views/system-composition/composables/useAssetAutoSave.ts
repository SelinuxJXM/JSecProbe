import { ref, type Ref } from 'vue';
import { ElMessage } from 'element-plus';
import type { Asset } from '@shared/types';
import { formatSaveTime } from '@/utils/format-save-time';

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

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error' | 'unsaved';

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

  const saveStatus = ref<SaveStatus>('idle');
  const hasUnsavedChanges = ref(false);
  const lastSavedTime = ref<Date | null>(null);

  let autoSaveTimer: number | null = null;
  let periodicSaveTimer: number | null = null;
  // 并发互斥：防抖触发 / 周期触发 / 手动保存三条路径可能同时进入 saveAllChanges。
  // 不加锁时，await loadAssets() 返回前 temp_ 临时行仍在列表中且 modifiedRows 未清，
  // 第二次进入会对同一临时行重复 asset.create，产生重复资产。
  let saveInProgress = false;

  /**
   * 只回写服务端维护的时间戳类字段。
   * 名称/用途/备注等用户正在输入的字段以浏览器里的值为准 ——
   * 否则保存往返期间继续敲的字会被服务端回显覆盖掉。
   */
  function patchSavedMeta(row: Asset, saved: any) {
    if (!saved) return;
    if (saved.updatedAt) (row as any).updatedAt = saved.updatedAt;
  }

  async function saveAllChanges(): Promise<boolean> {
    if (saveInProgress) {
      return false;
    }
    if (modifiedRows.size === 0 && deletedIds.size === 0) {
      return false;
    }

    saveInProgress = true;
    const projectId = route.params.id as string;
    saveStatus.value = 'saving';
    // 快照：保存过程中用户可能继续改动，结束时不该把新改动标记抹掉
    const dirtySnapshot = [...modifiedRows];
    const succeeded = new Set<string>();
    let needsReload = false;
    let created = 0;
    let updated = 0;
    let deleted = 0;
    let failed = 0;
    try {
      for (const id of deletedIds) {
        const res = await window.api.asset.remove(id);
        if (res.success) deleted++;
        else failed++;
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
          created++;
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
          updated++;
          succeeded.add(key);
          patchSavedMeta(row, res.data);
        }
      }

      // 只清掉本次成功落库的行，失败的行留着等下一次触发重试（周期保存兜底）
      for (const id of succeeded) {
        modifiedRows.delete(id);
      }

      if (modifiedRows.size === 0 && deletedIds.size === 0) {
        saveStatus.value = 'saved';
        hasUnsavedChanges.value = false;
      } else {
        saveStatus.value = failed > 0 ? 'error' : 'unsaved';
        hasUnsavedChanges.value = true;
      }
      lastSavedTime.value = new Date();

      if (needsReload) {
        await loadAssets();
      } else {
        await loadStats?.();
      }
      return failed === 0;
    } catch (error) {
      console.error('保存失败:', error);
      saveStatus.value = 'error';
      return false;
    } finally {
      saveInProgress = false;
    }
  }

  /**
   * 触发防抖保存。
   * @param delay 不传用默认延迟（文本输入）；勾选项/下拉这类离散操作传短延迟。
   */
  function debounceAutoSave(delay?: number) {
    hasUnsavedChanges.value = true;
    saveStatus.value = 'unsaved';
    if (autoSaveTimer) {
      clearTimeout(autoSaveTimer);
    }
    autoSaveTimer = window.setTimeout(() => {
      saveAllChanges();
    }, delay ?? debounceDelay);
  }

  function startPeriodicSave() {
    stopPeriodicSave();
    periodicSaveTimer = window.setInterval(() => {
      if (hasUnsavedChanges.value) {
        saveAllChanges();
      }
    }, periodicInterval);
  }

  function stopPeriodicSave() {
    if (periodicSaveTimer) {
      clearInterval(periodicSaveTimer);
      periodicSaveTimer = null;
    }
  }

  async function triggerManualSave(): Promise<boolean> {
    if (saveInProgress) {
      ElMessage.info('正在保存中，请稍候');
      return false;
    }
    const success = await saveAllChanges();
    if (success) {
      ElMessage.success('保存成功');
    } else {
      ElMessage.error('保存失败，请重试');
    }
    return success;
  }

  /** 列表被整表重建后调用：脏标记随数据一起失效 */
  function markClean() {
    modifiedRows.clear();
    deletedIds.clear();
    hasUnsavedChanges.value = false;
    saveStatus.value = lastSavedTime.value ? 'saved' : 'idle';
  }

  // formatSaveTime 已提升到 @/utils/format-save-time（三个自动保存 composable 共用同一份）

  function cleanup() {
    if (autoSaveTimer) {
      clearTimeout(autoSaveTimer);
      autoSaveTimer = null;
    }
    stopPeriodicSave();
    // 卸载/离开前把待保存的资产编辑落盘，不再静默丢弃
    if (hasUnsavedChanges.value && !saveInProgress) {
      saveAllChanges().catch(() => {
        console.warn('[资产台账] 离开页面时自动保存失败');
      });
    }
  }

  return {
    saveStatus,
    hasUnsavedChanges,
    lastSavedTime,
    saveAllChanges,
    debounceAutoSave,
    startPeriodicSave,
    stopPeriodicSave,
    triggerManualSave,
    markClean,
    formatSaveTime,
    cleanup,
  };
}
