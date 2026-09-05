import { ref, type Ref } from 'vue';
import type { RouteLocationNormalizedLoaded } from 'vue-router';
import { ElMessage } from 'element-plus';
import type { AssessmentRecord } from '../../../../shared/types';

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

interface AutoSaveOptions {
  currentAsset: Ref<any>;
  currentDomainId: Ref<string>;
  tableRows: Ref<TableRow[]>;
  route: RouteLocationNormalizedLoaded;
  updateAssetProgress: (assetId: string, rows: TableRow[]) => void;
  loadProgress: () => Promise<void>;
  debounceDelay?: number;
  periodicInterval?: number;
}

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

  const saveStatus = ref<SaveStatus>('idle');
  const hasUnsavedChanges = ref(false);
  const lastSavedTime = ref<Date | null>(null);

  let autoSaveTimer: number | null = null;
  let periodicSaveTimer: number | null = null;

  // 保存互斥锁：防止防抖/周期/手动保存并发执行导致同一记录被多个协程交错写入
  let saveInProgress = false;

  async function saveAllRows(): Promise<boolean> {
    if (saveInProgress) {
      // 上一次保存仍在进行，跳过本次以避免并发写入同一条记录造成数据竞争
      return false;
    }
    if (!currentAsset.value && !currentDomainId.value) return false;
    if (tableRows.value.length === 0) return false;

    saveInProgress = true;
    saveStatus.value = 'saving';
    let failedCount = 0;
    let hasError = false;
    try {
      const projectId = route.params.id as string;
      const assetId = currentAsset.value?.id || '';

      const complianceMap: Record<string, AssessmentRecord['result']> = {
        'conform': 'compliant',
        'partial': 'partial',
        'nonconform': 'non_compliant',
        'na': 'not_applicable',
        '': 'untested',
      };

      const methodMap: Record<string, string> = {
        '核查': 'check',
        '访谈': 'interview',
        '测试': 'test',
      };

      // 并行保存所有行（各记录相互独立），大幅缩短大列表保存耗时
      const results = await Promise.all(
        tableRows.value.map(async (row) => {
          const saveData = {
            id: row.id || undefined,
            projectId,
            assetId: assetId || undefined,
            itemId: row.itemId,
            result: complianceMap[row.compliance] || 'untested',
            method: (methodMap[row.method] || 'check') as AssessmentRecord['method'],
            commandOutput: row.evidence || '',
            evidence: row.evidence || '',
            findings: row.conclusion || '',
            screenshotPaths: JSON.stringify(row.screenshots || []),
          };

          try {
            const res = await window.api.assessment.saveRecord(saveData);
            if (res.success && res.data) {
              row.id = res.data.id;
              return true;
            }
            return false;
          } catch {
            return false;
          }
        })
      );
      failedCount = results.filter(ok => !ok).length;

      if (assetId) {
        updateAssetProgress(assetId, tableRows.value);
      }

      loadProgress();

      return failedCount === 0;
    } catch (error) {
      console.error('保存失败:', error);
      hasError = true;
      return false;
    } finally {
      saveInProgress = false;
      if (hasError || failedCount > 0) {
        saveStatus.value = 'error';
      } else {
        saveStatus.value = 'saved';
        hasUnsavedChanges.value = false;
        lastSavedTime.value = new Date();
      }
    }
  }

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

  function startPeriodicSave() {
    stopPeriodicSave();
    periodicSaveTimer = window.setInterval(() => {
      if (hasUnsavedChanges.value) {
        saveAllRows();
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
      ElMessage.warning('正在保存中，请稍候');
      return false;
    }
    const success = await saveAllRows();
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
    saveAllRows,
    debounceAutoSave,
    startPeriodicSave,
    stopPeriodicSave,
    triggerManualSave,
    formatSaveTime,
    cleanup,
  };
}
