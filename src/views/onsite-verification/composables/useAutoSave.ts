import { reactive, type Ref } from 'vue';
import type { RouteLocationNormalizedLoaded } from 'vue-router';
import type { AssessmentRecord } from '../../../../shared/types';
import { formatSaveTime } from '@/utils/format-save-time';
import { useAutoSaveCore, mapLimit } from '@/composables/useAutoSaveCore';

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

  /**
   * 脏行集合：key → 脏版本号。
   *
   * 只保存这里面的行，而不是整张表 —— 此前是全量 `tableRows.map` 并发 IPC，
   * 100+ 行就是 100+ 个并发请求，且未修改的行也被反复写库。
   *
   * 值是版本号而非布尔：保存往返期间用户可能继续敲字，
   * 若保存成功后无条件 delete，这一下改动就被静默抹掉了。
   * 只有版本号与快照一致（说明期间没有新改动）才允许清除。
   */
  const dirtyMap = reactive(new Map<string, number>());

  /**
   * 脏行 key。带上 assetId 是为了切换测评对象后 key 自然失效：
   * 不同资产下同 itemId 的行互不相干，不会互相串味。
   */
  function keyOf(row: TableRow): string {
    return `${currentAsset.value?.id || ''}::${row.itemId}`;
  }

  /** 现场核查的落库实现：定时器/互斥/状态机由 useAutoSaveCore 统一负责 */
  async function persist(): Promise<boolean> {
    if (!currentAsset.value && !currentDomainId.value) return false;
    if (tableRows.value.length === 0) return false;
    if (dirtyMap.size === 0) return false;

    // 快照：保存往返期间用户可能继续改同一行，结束时不该把新改动清掉
    const snapshot = new Map(dirtyMap);
    let failedCount = 0;
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

      // 只保存脏行（此前是整表 map），并用定长并发池限制同时打出的 IPC 数量
      // 单次保存并发上限：一个域动辄上百行，不设限会瞬间打出上百个 IPC
      const SAVE_CONCURRENCY = 6;
      const pending = tableRows.value.filter(row => snapshot.has(keyOf(row)));
      const results = await mapLimit(pending, SAVE_CONCURRENCY, async (row) => {
        const key = keyOf(row);
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
            // 版本号未变说明期间没有新改动，可以清脏；变了就留着等下一轮
            if (dirtyMap.get(key) === snapshot.get(key)) {
              dirtyMap.delete(key);
            }
            return true;
          }
          return false;
        } catch {
          return false;
        }
      });
      // 失败的行仍留在 dirtyMap 里，由周期保存或下一次触发重试，不会被静默吞掉
      failedCount = results.filter(ok => !ok).length;

      if (assetId) {
        updateAssetProgress(assetId, tableRows.value);
      }

      loadProgress().catch(() => {
        // 进度刷新失败不影响保存结果本身
      });

      return failedCount === 0;
    } catch (error) {
      console.error('[现场核查] 保存失败:', error);
      return false;
    }
  }

  const core = useAutoSaveCore({
    hasDirty: () => dirtyMap.size > 0,
    persist,
    debounceDelay,
    periodicInterval,
    busyMessageType: 'warning',
  });

  /** 标脏并启动防抖。版本号自增，用于识别「保存期间的新改动」。 */
  function debounceAutoSave(row: TableRow) {
    const key = keyOf(row);
    dirtyMap.set(key, (dirtyMap.get(key) || 0) + 1);
    core.scheduleSave();
  }

  /** 整张表被重建后调用：脏标记随数据一起失效，避免拿旧 key 去写新行 */
  function markClean() {
    dirtyMap.clear();
    core.saveStatus.value = core.lastSavedTime.value ? 'saved' : 'idle';
  }

  function cleanup() {
    core.cleanup('现场核查');
  }

  return {
    saveStatus: core.saveStatus,
    hasUnsavedChanges: core.hasUnsavedChanges,
    lastSavedTime: core.lastSavedTime,
    saveAllRows: core.runSave,
    debounceAutoSave,
    startPeriodicSave: core.startPeriodicSave,
    stopPeriodicSave: core.stopPeriodicSave,
    triggerManualSave: core.triggerManualSave,
    markClean,
    formatSaveTime,
    cleanup,
  };
}
