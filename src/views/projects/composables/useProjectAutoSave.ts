import { ref, type Ref } from 'vue';
import { ElMessage } from 'element-plus';
import { formatSaveTime } from '@/utils/format-save-time';

interface ProjectRow {
  id: number;
  projectNo: string;
  name: string;
  systemName: string;
  assessedUnit: string;
  standardSystem: string;
  standardId?: string;
  levelCombo: string;
  level: number;
  extensionTypes: string[];
  status: string;
  [key: string]: any;
}

interface ProjectAutoSaveOptions {
  projectList: Ref<ProjectRow[]>;
  editedRows: Ref<string[]>;
  deletedIds: Ref<string[]>;
  loadProjects: () => Promise<void>;
  debounceDelay?: number;
  periodicInterval?: number;
}

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error' | 'unsaved';

export function useProjectAutoSave(options: ProjectAutoSaveOptions) {
  const {
    projectList,
    editedRows,
    deletedIds,
    loadProjects,
    debounceDelay = 45000,
    periodicInterval = 45000,
  } = options;

  const saveStatus = ref<SaveStatus>('idle');
  const hasUnsavedChanges = ref(false);
  const lastSavedTime = ref<Date | null>(null);

  let autoSaveTimer: number | null = null;
  let periodicSaveTimer: number | null = null;
  // 并发互斥：防抖触发 / 周期触发 / 手动保存三条路径可能同时进入 saveAllChanges。
  // 不加锁时，await loadProjects() 返回前临时行仍在列表中且改动标记未清，
  // 第二次进入会对同一临时行重复 create，产生重复项目。
  let saveInProgress = false;

  async function saveAllChanges(): Promise<boolean> {
    if (saveInProgress) {
      return false;
    }
    if (editedRows.value.length === 0 && deletedIds.value.length === 0) {
      return false;
    }

    saveInProgress = true;
    saveStatus.value = 'saving';
    let created = 0,
      updated = 0,
      deleted = 0;
    try {
      for (const id of deletedIds.value) {
        const res = await window.api.project.remove(id);
        if (res.success) deleted++;
      }
      deletedIds.value = [];

      for (const row of projectList.value) {
        const isEdited = editedRows.value.includes(String(row.id));
        if (!isEdited && row.id > 0) continue;

        if (row.id < 0) {
          if (!row.name?.trim()) continue;
          const res = await window.api.project.create({
            projectNo: row.projectNo || undefined,
            name: row.name.trim(),
            systemName: row.systemName,
            assessedUnit: row.assessedUnit,
            // 传递 standardId（项目创建后不可更改，避免 records 孤儿）
            standardId: row.standardId,
            standardSystem: row.standardSystem,
            levelCombo: row.levelCombo,
            extensionType:
              row.extensionTypes && row.extensionTypes.length > 0
                ? row.extensionTypes.join(',')
                : undefined,
            level: Number(row.level) || 3,
          });
          if (res.success) created++;
        } else {
          const res = await window.api.project.update(String(row.id), {
            projectNo: row.projectNo,
            name: row.name,
            systemName: row.systemName,
            assessedUnit: row.assessedUnit,
            standardSystem: row.standardSystem,
            levelCombo: row.levelCombo,
            extensionType:
              row.extensionTypes && row.extensionTypes.length > 0
                ? row.extensionTypes.join(',')
                : '',
            level: Number(row.level) || 3,
            status: row.status as any,
          });
          if (res.success) updated++;
        }
      }

      editedRows.value = [];
      saveStatus.value = 'saved';
      hasUnsavedChanges.value = false;
      lastSavedTime.value = new Date();

      await loadProjects();
      return true;
    } catch (error) {
      console.error('保存失败:', error);
      saveStatus.value = 'error';
      return false;
    } finally {
      saveInProgress = false;
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

  // formatSaveTime 已提升到 @/utils/format-save-time（三个自动保存 composable 共用同一份）

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
