import { ref, type Ref } from 'vue';
import type { RouteLocationNormalizedLoaded } from 'vue-router';
import { ElMessage } from 'element-plus';
import type { AssessmentRecord } from '../../../../shared/types';

// 表格行类型
interface TableRow {
  id?: string;
  itemId: string;
  compliance: string;
  method: string;
  evidence: string;
  conclusion: string;
  screenshots?: string[];
  [key: string]: any;
}

// 自动保存配置选项
interface AutoSaveOptions {
  currentAsset: Ref<any>;
  currentDomainId: Ref<string>;
  tableRows: Ref<TableRow[]>;
  route: RouteLocationNormalizedLoaded;
  updateAssetProgress: (assetId: string, rows: TableRow[]) => void;
  loadProgress: () => Promise<void>;
  // 防抖延迟时间（毫秒），默认 1500
  debounceDelay?: number;
  // 周期保存间隔（毫秒），默认 30000
  periodicInterval?: number;
}

// 保存状态类型
type SaveStatus = 'idle' | 'saving' | 'saved' | 'error' | 'unsaved';

export function useAutoSave(options: AutoSaveOptions) {
  const {
    currentAsset,
    currentDomainId,
    tableRows,
    route,
    updateAssetProgress,
    loadProgress,
    debounceDelay = 1500,
    periodicInterval = 30000,
  } = options;

  // 保存状态
  const saveStatus = ref<SaveStatus>('idle');
  const hasUnsavedChanges = ref(false);
  const lastSavedTime = ref<Date | null>(null);

  // 定时器
  let autoSaveTimer: number | null = null;
  let periodicSaveTimer: number | null = null;

  // 统一的保存逻辑：保存所有行
  async function saveAllRows(): Promise<boolean> {
    if (!currentAsset.value && !currentDomainId.value) return false;
    if (tableRows.value.length === 0) return false;

    saveStatus.value = 'saving';
    try {
      const projectId = route.params.id as string;
      const assetId = currentAsset.value?.id || '';

      const complianceMap: Record<string, string> = {
        'conform': 'conform',
        'partial': 'partial',
        'nonconform': 'nonconform',
        'na': 'notapplicable',
        '': 'untested',
      };

      const methodMap: Record<string, string> = {
        '核查': 'check',
        '访谈': 'interview',
        '测试': 'test',
      };

      for (const row of tableRows.value) {
        const saveData = {
          id: row.id || undefined,
          projectId,
          assetId: assetId || undefined,
          itemId: row.itemId,
          result: (complianceMap[row.compliance] || 'untested') as AssessmentRecord['result'],
          method: (methodMap[row.method] || 'check') as AssessmentRecord['method'],
          commandOutput: row.evidence || '',
          evidence: row.evidence || '',
          findings: row.conclusion || '',
          screenshotPaths: row.screenshots && row.screenshots.length > 0 ? JSON.stringify(row.screenshots) : undefined,
        };
        console.log(`[saveAllRows] 保存行: itemId=${row.itemId}, id=${row.id || 'new'}, compliance=${row.compliance}, evidence.length=${(row.evidence||'').length}, conclusion.length=${(row.conclusion||'').length}`);

        const res = await window.api.assessment.saveRecord(saveData);
        if (res.success && res.data) {
          row.id = res.data.id;
          console.log(`[saveAllRows] 保存成功: itemId=${row.itemId}, newId=${res.data.id}`);
        } else {
          console.error(`[saveAllRows] 保存失败: itemId=${row.itemId}, res=`, JSON.stringify(res));
        }
      }

      if (assetId) {
        updateAssetProgress(assetId, tableRows.value);
      }
      await loadProgress();

      saveStatus.value = 'saved';
      hasUnsavedChanges.value = false;
      lastSavedTime.value = new Date();
      return true;
    } catch (error) {
      console.error('保存失败:', error);
      saveStatus.value = 'error';
      return false;
    }
  }

  // 防抖自动保存（输入时触发）
  function debounceAutoSave(_row: TableRow) {
    hasUnsavedChanges.value = true;
    saveStatus.value = 'unsaved';
    if (autoSaveTimer) {
      clearTimeout(autoSaveTimer);
    }
    autoSaveTimer = window.setTimeout(() => {
      saveAllRows();
    }, debounceDelay);
  }

  // 启动周期性备份保存
  function startPeriodicSave() {
    stopPeriodicSave();
    periodicSaveTimer = window.setInterval(() => {
      if (hasUnsavedChanges.value) {
        saveAllRows();
      }
    }, periodicInterval);
  }

  // 停止周期性保存
  function stopPeriodicSave() {
    if (periodicSaveTimer) {
      clearInterval(periodicSaveTimer);
      periodicSaveTimer = null;
    }
  }

  // 手动保存
  async function triggerManualSave(): Promise<boolean> {
    const success = await saveAllRows();
    if (success) {
      ElMessage.success('保存成功');
    } else {
      ElMessage.error('保存失败，请重试');
    }
    return success;
  }

  // 格式化保存时间
  function formatSaveTime(date: Date): string {
    const now = new Date();
    const diff = Math.floor((now.getTime() - date.getTime()) / 1000);
    if (diff < 5) return '刚刚';
    if (diff < 60) return `${diff}秒前`;
    if (diff < 3600) return `${Math.floor(diff / 60)}分钟前`;
    return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  }

  // 清理所有定时器（组件卸载时调用）
  function cleanup() {
    if (autoSaveTimer) {
      clearTimeout(autoSaveTimer);
      autoSaveTimer = null;
    }
    stopPeriodicSave();
  }

  return {
    // 状态
    saveStatus,
    hasUnsavedChanges,
    lastSavedTime,
    // 方法
    saveAllRows,
    debounceAutoSave,
    startPeriodicSave,
    stopPeriodicSave,
    triggerManualSave,
    formatSaveTime,
    cleanup,
  };
}
