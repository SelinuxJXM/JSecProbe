import { ref, type Ref } from 'vue';
import { ElMessage } from 'element-plus';
import type { Asset } from '@shared/types';

interface AssetAutoSaveOptions {
  assetList: Ref<Asset[]>;
  modifiedRows: Set<string>;
  deletedIds: Set<string>;
  currentCategory: Ref<string>;
  route: any;
  loadAssets: () => Promise<void>;
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
    debounceDelay = 45000,
    periodicInterval = 45000,
  } = options;

  const saveStatus = ref<SaveStatus>('idle');
  const hasUnsavedChanges = ref(false);
  const lastSavedTime = ref<Date | null>(null);

  let autoSaveTimer: number | null = null;
  let periodicSaveTimer: number | null = null;

  async function saveAllChanges(): Promise<boolean> {
    if (modifiedRows.size === 0 && deletedIds.size === 0) {
      return false;
    }

    const projectId = route.params.id as string;
    saveStatus.value = 'saving';
    let created = 0;
    let updated = 0;
    let deleted = 0;
    try {
      for (const id of deletedIds) {
        const res = await window.api.asset.remove(id);
        if (res.success) deleted++;
      }
      deletedIds.clear();

      for (const row of assetList.value) {
        const modified = modifiedRows.has(String(row.id));
        const isNewRow = String(row.id).startsWith('temp_');
        if (!modified && !isNewRow) continue;

        if (isNewRow) {
          if (!row.name.trim()) continue;
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
          if (res.success) created++;
        } else {
          const res = await window.api.asset.update(String(row.id), {
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
          if (res.success) updated++;
        }
      }

      modifiedRows.clear();
      saveStatus.value = 'saved';
      hasUnsavedChanges.value = false;
      lastSavedTime.value = new Date();

      await loadAssets();
      return true;
    } catch (error) {
      console.error('保存失败:', error);
      saveStatus.value = 'error';
      return false;
    }
  }

  function debounceAutoSave() {
    hasUnsavedChanges.value = true;
    saveStatus.value = 'unsaved';
    if (autoSaveTimer) {
      clearTimeout(autoSaveTimer);
    }
    autoSaveTimer = window.setTimeout(() => {
      saveAllChanges();
    }, debounceDelay);
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
    const success = await saveAllChanges();
    if (success) {
      ElMessage.success('保存成功');
    } else {
      ElMessage.error('保存失败，请重试');
    }
    return success;
  }

  function formatSaveTime(date: Date): string {
    const now = new Date();
    const diff = Math.floor((now.getTime() - date.getTime()) / 1000);
    if (diff < 5) return '刚刚';
    if (diff < 60) return `${diff}秒前`;
    if (diff < 3600) return `${Math.floor(diff / 60)}分钟前`;
    return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  }

  function cleanup() {
    if (autoSaveTimer) {
      clearTimeout(autoSaveTimer);
      autoSaveTimer = null;
    }
    stopPeriodicSave();
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
    formatSaveTime,
    cleanup,
  };
}
