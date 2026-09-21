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
  /**
   * 脏行标记（数据真的改了的行）。
   *
   * 注意：这个数组**不等于**「正在编辑的行」。此前页面把两者混用，
   * 一进编辑态就标脏并启动 4 秒防抖，导致保存发生在用户填到一半的时候；
   * 而保存后又整表重载把编辑态清空，用户被迫重新点一次编辑。
   * 现在编辑态由页面侧单独维护，这里只负责「哪些行需要落库」。
   */
  editedRows: Ref<string[]>;
  deletedIds: Ref<string[]>;
  loadProjects: () => Promise<void>;
  /**
   * 轻量刷新：只更新统计数字与总数，不重建列表。
   * 常规保存走这条路，避免把用户踢出编辑态。
   */
  loadStats?: () => Promise<void>;
  /**
   * 临时行（id < 0）落库成功后的回写钩子。
   * 由页面负责把 row.id 换成真实 id 并同步自己的编辑态列表，
   * composable 不关心页面怎么管 UI 状态。
   */
  onRowCreated?: (row: ProjectRow, created: any) => void;
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
    loadStats,
    onRowCreated,
    // 8 秒而非 4 秒：计时口径已从「进入编辑态」改为「最后一次修改」，
    // 填一行（名称/系统/单位）要几十秒，4 秒的窗会在用户手还没停时就落库。
    // 数据不会丢：切页/搜索/离开组件前都有 flush 兜底。
    debounceDelay = 8000,
    periodicInterval = 45000,
  } = options;

  const saveStatus = ref<SaveStatus>('idle');
  const hasUnsavedChanges = ref(false);
  const lastSavedTime = ref<Date | null>(null);

  let autoSaveTimer: number | null = null;
  let periodicSaveTimer: number | null = null;
  // 并发互斥：防抖触发 / 周期触发 / 手动保存三条路径可能同时进入 saveAllChanges。
  // 不加锁时，(tmp 行) 会被两条路径同时 create，产生重复项目。
  let saveInProgress = false;

  /**
   * 只回写用户不会正在输入的字段。
   *
   * 名称类字段以浏览器里的值为准 —— 保存往返期间用户继续敲的字
   * 会被服务端的回显结果覆盖掉（表现为「字打着打着自己退回去」）。
   */
  function patchSavedMeta(row: ProjectRow, saved: any) {
    if (!saved) return;
    if (saved.updatedAt) row.updatedAt = saved.updatedAt;
    if (typeof saved.progress === 'number') row.progress = saved.progress;
  }

  async function saveAllChanges(): Promise<boolean> {
    if (saveInProgress) {
      return false;
    }
    if (editedRows.value.length === 0 && deletedIds.value.length === 0) {
      return false;
    }

    saveInProgress = true;
    saveStatus.value = 'saving';
    // 快照：保存过程中用户可能继续改动，结束时不该把新改动标记抹掉
    const dirtySnapshot = [...editedRows.value];
    const succeeded = new Set<string>();
    let needsReload = false;
    let created = 0,
      updated = 0,
      deleted = 0;
    let failed = 0;
    try {
      for (const id of deletedIds.value) {
        const res = await window.api.project.remove(id);
        if (res.success) deleted++;
      }
      deletedIds.value = [];

      for (const row of projectList.value) {
        const key = String(row.id);
        if (!dirtySnapshot.includes(key)) continue;

        if (row.id < 0) {
          // 没填名称的草稿行：不落库也不算失败，留在页面上继续填
          if (!row.name?.trim()) {
            succeeded.add(key);
            continue;
          }
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
          if (!res.success) {
            failed++;
            continue;
          }
          created++;
          succeeded.add(key);
          if (res.data?.id) {
            // 临时行 → 真实行；页面侧同步替换 id 与编辑态
            succeeded.add(String(res.data.id));
            onRowCreated?.(row, res.data);
          } else {
            // 拿不到新 id 就无法就地改写，退回整表重载
            needsReload = true;
          }
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
      editedRows.value = editedRows.value.filter(id => !succeeded.has(id));

      if (editedRows.value.length === 0 && deletedIds.value.length === 0) {
        saveStatus.value = 'saved';
        hasUnsavedChanges.value = false;
      } else {
        // 还有没成功的：保持「未保存」，让用户看得见
        saveStatus.value = failed > 0 ? 'error' : 'unsaved';
        hasUnsavedChanges.value = true;
      }
      lastSavedTime.value = new Date();

      // 常规保存不再热加载整张表 —— 之前每次保存都会把表格 DOM 连同编辑态一起重建，
      // 用户填到一半被迫重新点编辑。只在确实拿不到新 id 时才重载。
      if (needsReload) {
        await loadProjects();
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
   * @param delay 不传用默认延迟（文本输入）；离散操作传 quickDelay。
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
    editedRows.value = [];
    deletedIds.value = [];
    hasUnsavedChanges.value = false;
    saveStatus.value = lastSavedTime.value ? 'saved' : 'idle';
  }

  // formatSaveTime 已提升到 @/utils/format-save-time（三个自动保存 composable 共用同一份）

  /**
   * 组件卸载时的收尾。
   *
   * 原先只 clearTimeout —— 防抖窗口内的改动被直接丢弃，用户改完切页就白改了。
   * 现在先尝试把待保存的改动落盘；此处不 await（卸载钩子无法等待），
   * IPC 本身在主进程执行，不依赖组件实例存活。
   */
  function cleanup() {
    if (autoSaveTimer) {
      clearTimeout(autoSaveTimer);
      autoSaveTimer = null;
    }
    stopPeriodicSave();
    if (hasUnsavedChanges.value && !saveInProgress) {
      saveAllChanges().catch(() => {
        // 卸载阶段保存失败不打扰用户，仅记录；改动标记仍保留在 editedRows 中
        console.warn('[项目列表] 离开页面时自动保存失败');
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
