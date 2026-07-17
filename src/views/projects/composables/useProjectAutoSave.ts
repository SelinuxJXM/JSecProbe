import { ref, type Ref } from 'vue';
import { ElMessage } from 'element-plus';

interface ProjectRow {
  id: number;
  projectNo: string;
  name: string;
  systemName: string;
  assessedUnit: string;
  standardSystem: string;
  levelCombo: string;
  extensionTypes: string[];
  status: string;
  [key: string]: any;
}

interface ProjectAutoSaveOptions {
  projectList: Ref<ProjectRow[]>;
  editedRows: Ref<string[]>;
  deletedIds: Ref<string[]>;
  parseLevelFromCombo: (combo: string) => number;
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
    parseLevelFromCombo,
    loadProjects,
    debounceDelay = 45000,
    periodicInterval = 45000,
  } = options;

  const saveStatus = ref<SaveStatus>('idle');
  const hasUnsavedChanges = ref(false);
  const lastSavedTime = ref<Date | null>(null);

  let autoSaveTimer: number | null = null;
  let periodicSaveTimer: number | null = null;

  async function saveAllChanges(): Promise<boolean> {
    if (editedRows.value.length === 0 && deletedIds.value.length === 0) {
      return false;
    }

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
            standardSystem: row.standardSystem,
            levelCombo: row.levelCombo,
            extensionType:
              row.extensionTypes && row.extensionTypes.length > 0
                ? row.extensionTypes.join(',')
                : undefined,
            level: parseLevelFromCombo(row.levelCombo),
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
                : undefined,
            level: parseLevelFromCombo(row.levelCombo),
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
