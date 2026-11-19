import { ref, computed, nextTick, type Ref } from 'vue';
import { ElMessage } from 'element-plus';
import { parseAiCompliance } from '../../../../shared/assessment-result';
import { requirementTextMatches } from '../utils/requirement-match';
import { stripVerdictTail } from '../utils/conclusion-clean';

/**
 * 从可能被截断 / 夹杂说明文字的 AI 返回中，救回 {"results":[...]} 里
 * 所有「结构完整、可独立解析」的对象。
 *
 * 背景：批量分析输出长，模型可能因 max_tokens 被截断，或尾随多余文字，
 * 导致整体 JSON.parse 失败。此时丢弃整批太可惜——逐对象扫描能把截断点
 * 之前的完整结果全部保留下来，只是最后一条不完整的会被舍弃。
 */
function rescueBatchResults(content: string): any[] | null {
  if (!content) return null;
  const keyIdx = content.indexOf('"results"');
  if (keyIdx === -1) return null;
  const arrStart = content.indexOf('[', keyIdx);
  if (arrStart === -1) return null;

  const out: any[] = [];
  let i = arrStart + 1;
  while (i < content.length) {
    const ch = content[i];
    if (ch === ']' || ch === undefined) break;
    if (/\s|,/.test(ch)) { i++; continue; }
    if (ch !== '{') { i++; continue; }

    // 括号配对扫描一个对象（跳过字符串内的括号与转义）
    let depth = 0;
    let inStr = false;
    let esc = false;
    let j = i;
    for (; j < content.length; j++) {
      const c = content[j];
      if (inStr) {
        if (esc) esc = false;
        else if (c === '\\') esc = true;
        else if (c === '"') inStr = false;
        continue;
      }
      if (c === '"') inStr = true;
      else if (c === '{') depth++;
      else if (c === '}') {
        depth--;
        if (depth === 0) { j++; break; }
      }
    }

    const objText = content.slice(i, j);
    try {
      out.push(JSON.parse(objText));
      i = j;
    } catch {
      // 对象不完整（截断）或含非法内容：停止扫描，保留已救回的
      break;
    }
  }
  return out.length ? out : null;
}

/**
 * 解析批量 AI 返回的 JSON 内容。
 * 依次尝试：整体解析 → 大括号提取 → 尾随逗号修复 → results 数组提取 → 逐对象救回。
 * 返回结果数组 + 是否走了救回路径 + 最后一次解析错误。
 */
export function parseBatchAiContent(rawContent: string): { results: any[]; partial: boolean; error: any } {
  let analysis: any = null;
  let parseError: any = null;
  let partial = false;

  // 先剥离 markdown 代码围栏：AI 常把 JSON 包在 ```json ... ``` 里。
  // 不剥的话整体 JSON.parse 会因首个 '`' 直接失败，大括号提取又可能被围栏文字里的
  // 花括号干扰，最终整批结果丢失（日志里出现过 "Unexpected token '`' 第5/5批解析失败"）。
  const content = String(rawContent || '')
    .replace(/^\s*```(?:json|text)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();

  try {
    analysis = JSON.parse(content);
  } catch (e1) {
    parseError = e1;
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        analysis = JSON.parse(jsonMatch[0]);
      } catch (e2) {
        parseError = e2;
        try {
          const fixed = jsonMatch[0].replace(/,\s*([}\]])/g, '$1');
          analysis = JSON.parse(fixed);
        } catch (e3) {
          parseError = e3;
          try {
            // 非贪婪匹配到第一个 ]，避免贪婪吞掉 results 数组之后文本里的 ] 撑破 JSON
            const resultsMatch = content.match(/"results"\s*:\s*\[([\s\S]*?)\]/);
            if (resultsMatch) {
              analysis = { results: JSON.parse(`[${resultsMatch[1]}]`) };
            }
          } catch (e4) {
            parseError = e4;
          }
        }
      }
    }
    // 无论上面走哪条路，整体没解析成功就尝试逐对象救回
    if (!analysis) {
      const rescued = rescueBatchResults(content);
      if (rescued && rescued.length) {
        analysis = { results: rescued };
        partial = true;
      }
    }
  }

  return { results: analysis?.results || [], partial, error: parseError };
}

/** 批量分析每批测评项数（弹窗批次清单与分批逻辑共用，保持单一数据源） */
export const BATCH_CHUNK_SIZE = 5;

/**
 * 解析并校验 attachedFiles，返回可信的文件名列表。
 *
 * attachedFiles 兼容两种格式：
 *  - 新：{file, requirement}（requirement 为该附件证明的条款原文）
 *  - 旧：字符串文件名
 * 带 requirement 且与本条结论条款不符的附件判为 AI 串位错配，丢弃（宁缺毋滥）。
 */
export function resolveValidAttachedFiles(
  attachedFiles: any[],
  itemRequirement?: string
): string[] {
  if (!Array.isArray(attachedFiles)) return [];
  const out: string[] = [];
  for (const entry of attachedFiles) {
    const isObj = entry && typeof entry === 'object';
    const name = extractFileNameFromAttached(String(isObj ? (entry.file || '') : (entry || '')));
    if (!name) continue;
    if (isObj) {
      const declared = String(entry.requirement || '').trim();
      if (declared && itemRequirement && !requirementTextMatches(declared, itemRequirement)) continue;
    }
    out.push(name);
  }
  return out;
}

/**
 * 把 AI 判定的关联文件（attachedFiles）并入关键证据点文本。
 *
 * - 幂等：二次分析不会重复堆叠同一批文件名
 * - 去重：数组内重名文件只列一次
 * - 只做文字引用，不写 row.screenshots：批量上传的是用户临时选的文件，
 *   不在项目受管目录，塞进截图列表会导致图片预览坏图。
 */
export function mergeAttachedFilesIntoEvidence(evidence: string, files: string[]): string {
  if (!Array.isArray(files) || files.length === 0) return String(evidence || '');
  const normalize = (s: string) => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();

  const unique: string[] = [];
  const seen = new Set<string>();
  for (const raw of files) {
    const name = String(raw || '').trim();
    if (!name) continue;
    const key = normalize(name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    unique.push(name);
  }
  if (!unique.length) return String(evidence || '');

  const existing = String(evidence || '');
  const existingNorm = normalize(existing);
  const toAdd = unique.filter(name => !existingNorm.includes(normalize(name)));
  if (!toAdd.length) return existing;

  const block = `关联证据文件：${toAdd.join('；')}`;
  return existing.trim() ? `${existing.trimEnd()}\n${block}` : block;
}

/**
 * 从 attachedFiles 的单个条目里提取纯文件名。
 * AI 可能返回 "截图：拓扑图.png"、"文档：审计日志.docx" 或裸文件名。
 */
export function extractFileNameFromAttached(attached: string): string {
  return String(attached || '')
    .replace(/^\s*(?:截图|文档|图片|文件)\s*[:：]\s*/, '')
    .trim()
    .split(/[\\/]/).pop() || '';
}

/**
 * 把 AI 判定的关联文件真正落盘为测评项附件（可点击预览）。
 *
 * 流程：解析 attachedFiles 文件名 → 在本次批量上传的 batchFiles 里按名匹配 →
 * 调用 screenshot.upload / uploadFile 复制进项目受管目录 → 把返回的可预览相对路径
 * 写入 row.screenshots（去重）。失败的文件静默跳过并打日志，不阻断其余回填。
 *
 * @returns 新关联的文件数
 */
async function attachFilesToRow(params: {
  attachedFiles: any[];
  row: any;
  batchFiles: Array<{ id: string; path: string; name: string; fileType: string; dataUrl?: string }>;
  projectId?: string;
  /** 本条结论对应的测评项条款原文，用于校验附件是否错配 */
  itemRequirement?: string;
  /** 外部已校验好的文件名列表，提供则跳过内部解析校验（避免重复） */
  validNames?: string[];
}): Promise<number> {
  const { attachedFiles, row, batchFiles, projectId, itemRequirement, validNames } = params;
  if (!Array.isArray(attachedFiles) || attachedFiles.length === 0) return 0;
  if (!projectId || !row?.itemId) {
    console.warn('[batchAiAnalyze] 关联附件缺少 projectId/itemId，跳过落盘');
    return 0;
  }

  // 解析 + 校验附件（带 requirement 且错配的会被丢弃，如"防火墙特征库"配给"日志审计"）
  const wantedNames = validNames ?? resolveValidAttachedFiles(attachedFiles, itemRequirement);
  if (!wantedNames.length) return 0;

  // 建立文件名索引：精确名 + 原名都指向同一 batchFile
  const byName = new Map<string, typeof batchFiles[number]>();
  for (const f of batchFiles) {
    byName.set(f.name.toLowerCase(), f);
  }

  if (!Array.isArray(row.screenshots)) row.screenshots = [];
  let attachedCount = 0;

  for (const wanted of wantedNames) {
    const file = byName.get(wanted.toLowerCase());
    if (!file) {
      console.warn(`[batchAiAnalyze] 关联文件未在本次上传中找到: ${wanted}`);
      continue;
    }
    try {
      const uploader = file.fileType === 'image'
        ? window.api.screenshot.upload
        : window.api.screenshot.uploadFile;
      const res = await uploader({ projectId, itemId: row.itemId, filePath: file.path });
      if (res.success && res.data?.path) {
        const savedPath = res.data.path;
        if (!row.screenshots.includes(savedPath)) {
          row.screenshots.push(savedPath);
          attachedCount++;
          // 图片缩略图靠 row.screenshotUrls 显示；新落盘的路径必须加载 DataURL，
          // 否则截图区会一直停在"加载中"。文档类无需缩略图（组件显示 DOC/PDF 占位）。
          if (file.fileType === 'image' && window.api?.screenshot?.getBase64) {
            try {
              const b64 = await window.api.screenshot.getBase64({ filePath: savedPath });
              if (b64.success && b64.data?.base64) {
                if (!row.screenshotUrls) row.screenshotUrls = {};
                row.screenshotUrls = {
                  ...row.screenshotUrls,
                  [savedPath]: `data:${b64.data.mimeType || 'image/png'};base64,${b64.data.base64}`,
                };
              }
            } catch (e: any) {
              console.warn('[batchAiAnalyze] 缩略图加载失败:', savedPath, e?.message || e);
            }
          }
        }
      } else {
        console.warn(`[batchAiAnalyze] 关联文件落盘失败: ${wanted}`, res.error?.message);
      }
    } catch (e: any) {
      console.warn(`[batchAiAnalyze] 关联文件落盘异常: ${wanted}`, e?.message || e);
    }
  }
  return attachedCount;
}

/**
 * useAiAnalysis composable 的配置选项
 */
interface UseAiAnalysisOptions {
  /** 测评记录表格数据 */
  tableRows: Ref<any[]>;
  /**
   * 保存 AI 回填的行。必须传入被改动的行：父组件据此标脏并立即同步落库。
   * 不传 / 传空数组表示没有实际改动，无需保存。
   */
  saveAllRows: (rows?: any[]) => Promise<boolean>;
  /** 加载截图 DataURL 的方法 */
  loadScreenshotDataUrl: (row: any, filePath: string) => Promise<string | null>;
  // Phase 4 行标上下文：用于注入 AI prompt
  /** 当前项目 ID，用于从项目推导标准 */
  projectId?: string | undefined;
  /** 当前使用的测评标准 ID（行标/国标均可），用于条款上下文检索 */
  standardId?: string | undefined;
  /** 当前被测评的测评域 ID（secure_xxx 或行业扩展域） */
  domainId?: string | undefined;
  /** 当前选中的测评项 ID（用于从 DB 精准反推标准 + 条款） */
  currentItemId?: string | undefined;
}

/**
 * AI 分析 composable
 * 提取自 onsite-verification/index.vue 的 AI 分析相关逻辑
 */
export function useAiAnalysis(options: UseAiAnalysisOptions) {
  const { tableRows, saveAllRows, projectId, standardId, domainId, currentItemId } = options;
  // projectId 用于把 AI 判定的关联文件落盘到测评项附件目录

  // AI配置（用于获取OCR预处理设置）
  const aiConfig = ref<any>(null);

  // ==================== 单条 AI 分析状态 ====================
  const aiDialogVisible = ref(false);
  const aiLoading = ref(false);
  const aiLoadingText = ref('');
  const aiStep = ref(0);
  const aiCurrentRow = ref<any>(null);
  const aiAnalysisResult = ref<any>(null);
  /** 逐点覆盖校验告警（AI 漏掉测评点时有值） */
  const aiWarning = ref('');

  // 批量AI分析进度弹窗
  const batchAiProgress = ref({
    visible: false, percent: 0, message: '', stage: '', current: 0, total: 0, text: '',
    // 分批进度：当前第几批 / 共几批 / 参与分析的测评项总数（用于弹窗展示）
    currentBatch: 0, totalBatches: 0, totalItems: 0,
  });
  const batchAiMinimized = ref(false);
  const aiDialogMinimized = ref(false);
  // 单条分析等待期的真实报活百分比：主进程每秒上报一次，等待期间进度条才有可见变化。
  // 只增不退、封顶 88%，响应返回后由 aiStep=6 接管到 100%。
  const aiWaitPercent = ref(0);

  // 用户主动取消标记：关闭/最小化对话框后置位，底层请求被中断。
  // 用它区分"取消"与"失败"——取消不是错误，不弹失败提示、不往记录里填脏结果。
  const singleCancelled = ref(false);
  const batchCancelled = ref(false);

  // AI使用合规确认
  const aiConsentGiven = ref(false);
  const showAiConsentDialog = ref(false);
  const aiConsentPendingAction = ref<'single' | 'batch' | null>(null);

  // 批量文件上传状态
  const batchFiles = ref<{ id: string; path: string; name: string; fileType: string; dataUrl?: string }[]>([]);
  const showBatchScreenshots = ref(true);
  const batchAiLoading = ref(false);

  // 内部定时器（用于组件卸载时清理）
  let autoSaveTimer: number | null = null;

  /**
   * 清理内部定时器（应在组件 onBeforeUnmount 时调用）
   */
  function cleanup() {
    if (autoSaveTimer) {
      clearTimeout(autoSaveTimer);
      autoSaveTimer = null;
    }
  }

  /**
   * 主动取消单条 AI 分析：中断底层云端请求，关闭对话框，不把取消当失败提示。
   */
  async function cancelSingleAnalysis(): Promise<void> {
    if (singleCancelled.value) return;
    singleCancelled.value = true;
    try {
      await window.api.ai.cancelSingleAnalysis();
    } catch (e) {
      console.warn('[aiAnalyze] 取消请求失败(可忽略):', e);
    }
    aiDialogVisible.value = false;
    aiDialogMinimized.value = false;
    aiLoading.value = false;
  }

  /**
   * 主动取消批量 AI 分析：中断底层云端请求，关闭进度弹窗。
   */
  async function cancelBatchAnalysis(): Promise<void> {
    if (batchCancelled.value) return;
    batchCancelled.value = true;
    try {
      await window.api.ai.cancelBatchScreenshots();
    } catch (e) {
      console.warn('[batchAiAnalyze] 取消请求失败(可忽略):', e);
    }
    batchAiProgress.value.visible = false;
    batchAiMinimized.value = false;
    batchAiLoading.value = false;
  }

  // ==================== 计算属性 ====================
  const batchAiProgressPercent = computed(() => batchAiProgress.value.percent);
  const batchAiProgressPercentDisplay = computed(() => `${batchAiProgress.value.percent}%`);

  // ==================== 私有方法 ====================

  /**
   * 获取文件类型
   */
  function getFileType(filePath: string): string {
    const lower = filePath.toLowerCase();
    if (lower.endsWith('.png') || lower.endsWith('.jpg') || lower.endsWith('.jpeg') || lower.endsWith('.gif') || lower.endsWith('.bmp')) return 'image';
    if (lower.endsWith('.pdf')) return 'pdf';
    if (lower.endsWith('.doc') || lower.endsWith('.docx')) return 'word';
    if (lower.endsWith('.md') || lower.endsWith('.txt')) return 'text';
    return 'other';
  }

  // ==================== 公有方法 ====================

  /**
   * 确认 AI 使用合规条款
   */
  function confirmAiConsent() {
    aiConsentGiven.value = true;
    showAiConsentDialog.value = false;
    if (aiConsentPendingAction.value === 'single') {
      executeAiAnalyze(aiCurrentRow.value);
    } else if (aiConsentPendingAction.value === 'batch') {
      executeBatchAiAnalyze();
    }
    aiConsentPendingAction.value = null;
  }

  /**
   * 触发单条 AI 分析（先检查合规确认）
   */
  function aiAnalyze(row: any) {
    if (!aiConsentGiven.value) {
      aiCurrentRow.value = row;
      aiConsentPendingAction.value = 'single';
      showAiConsentDialog.value = true;
      return;
    }
    executeAiAnalyze(row);
  }

  /**
   * 执行单条 AI 分析
   */
  async function executeAiAnalyze(row: any) {
    if (!window.api) {
      ElMessage.error('AI功能不可用');
      return;
    }

    const hasScreenshots = row.screenshots && row.screenshots.length > 0;
    const hasEvidence = row.evidence && row.evidence.trim().length > 0;
    if (!hasEvidence && !hasScreenshots) {
      ElMessage.warning('请先在关键证据点中填写内容或上传截图');
      return;
    }

    // 先把弹窗和 loading 亮出来，再去读配置 / 提取文档：这些前置动作是 IPC + 文件 IO，
    // 原先排在弹窗之前，点击后会有一段时间界面毫无反应，容易被当成没点上而重复点击。
    aiCurrentRow.value = row;
    aiAnalysisResult.value = null;
    aiWarning.value = '';
    aiDialogVisible.value = true;
    aiLoading.value = true;
    aiStep.value = 1;
    aiLoadingText.value = '正在准备分析数据...';
    // 新一轮分析开始时重置取消标记（同一行可能被反复分析）
    singleCancelled.value = false;
    aiWaitPercent.value = 0;

    // 订阅主进程等待报活。单条与批量共用 ai:progress 通道，只认 scope=single；
    // 订阅在函数结束时统一退订，避免同一行反复分析时监听器叠加。
    const unsubscribeWait = window.api?.ai?.onAnalysisProgress?.((data: any) => {
      if (data?.scope !== 'single' || !aiLoading.value) return;
      const percent = Number(data.percent) || 0;
      // 只增不退：主进程已保证单调递增，这里再兜一层，防止进度条闪烁回退
      aiWaitPercent.value = Math.max(aiWaitPercent.value, percent);
      if (data.message) aiLoadingText.value = data.message;
    });

    // 加载AI配置（获取OCR预处理设置）- 每次分析都重新加载，避免配置过期
    try {
      const configRes = await window.api.ai.getConfig();
      if (configRes.success && configRes.data) {
        aiConfig.value = configRes.data;
      }
    } catch (e) {
      console.warn('[aiAnalyze] 加载AI配置失败:', e);
    }

    try {
      // 分离图片文件和其他文件
      const imageFiles: string[] = [];
      const docFiles: string[] = [];
      for (const s of (row.screenshots || [])) {
        if (typeof s !== 'string' || s.length === 0) continue;
        const lower = s.toLowerCase();
        if (lower.endsWith('.png') || lower.endsWith('.jpg') || lower.endsWith('.jpeg') || lower.endsWith('.gif') || lower.endsWith('.bmp')) {
          imageFiles.push(s);
        } else if (lower.endsWith('.pdf') || lower.endsWith('.doc') || lower.endsWith('.docx') || lower.endsWith('.md') || lower.endsWith('.txt')) {
          docFiles.push(s);
        }
      }

      // 提取文档文本内容
      let docTextContent = '';
      if (docFiles.length > 0) {
        try {
          const docRes = await window.api.document.extractText({ filePaths: docFiles });
          if (docRes.success && docRes.data) {
            const failedDocs: string[] = [];
            for (const doc of docRes.data) {
              if (doc.error) {
                failedDocs.push(`${doc.name}（${doc.error}）`);
                continue;
              }
              docTextContent += `\n=== 文档：${doc.name} ===\n${doc.content}\n`;
            }
            if (failedDocs.length > 0) {
              ElMessage.warning(`部分文档未能读取，已跳过：${failedDocs.join('；')}`);
            }
          }
        } catch (e) {
          console.warn('[aiAnalyze] 文档文本提取失败:', e);
        }
      }

      const params = {
        controlPoint: row.controlPoint || '',
        requirement: row.requirement || '',
        command: '',
        result: (row.evidence || '') + docTextContent,
        screenshots: imageFiles,
        ocrPreprocess: Boolean(aiConfig.value?.ocrPreprocess),
        // Phase 4：注入标准上下文关联参数
        standardId: row.standardId || standardId,
        itemId: row.itemId || currentItemId,
        domain: row.domainId || domainId,
        // S2：测评点召回——资产类别 + 操作系统共同决定设备键（server_storage 靠 os 分 Linux/Windows）
        assetCategory: row.assetCategory || row.category || undefined,
        assetOs: row.assetOs || undefined,
      };

      // 更新步骤提示
      aiStep.value = 2;
      aiLoadingText.value = hasScreenshots ? 'AI正在识别内容...' : 'AI正在分析关键证据点...';

      let res;
      try {
        const timeoutMs = 120000;
        // 超时定时器必须在 Promise.race 结束后清除：批量分析每行一个，
        // 不清的话跑完 100 行就会有 100 个 120s 的定时器挂着，
        // 期间无法 GC 且会在下一次 tick 集中触发已无意义的 reject。
        let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
        const timeoutPromise = new Promise<never>((_, reject) => {
          timeoutHandle = setTimeout(
            () => reject(new Error('AI分析超时，请检查网络连接或稍后重试')),
            timeoutMs
          );
        });
        try {
          res = await Promise.race([
            window.api.ai.analyzeAssessment(params),
            timeoutPromise,
          ]);
        } finally {
          if (timeoutHandle) clearTimeout(timeoutHandle);
        }
      } catch (ipcError: any) {
        console.error('[aiAnalyze] IPC调用失败:', ipcError.message, ipcError.stack);
        throw ipcError;
      }

      // 步骤推进（P2-9）：原实现从 2 直接跳到 6，中间 3/4/5 从未赋值，
      // 而界面渲染的是 6 步流程条 —— 用户看到进度条从第 2 步瞬间跳到第 6 步，
      // 以为是"AI 已完成"，实际只是跳过了显示。这里按真实阶段逐步推进：
      // 3 拿到返回 → 4 判定合规性 → 5 提取证据点 → 6 生成结论。
      // nextTick 让每步都能被渲染出来，而不是在同一帧内被最后的 6 覆盖。
      aiStep.value = 3;
      aiLoadingText.value = 'AI已返回结果，正在解析...';
      await nextTick();

      if (res.success && res.data) {
        try {
          const content = res.data.content;

          // 尝试多种方式提取JSON
          let analysis: any = null;

          // 方法1: 直接解析整个内容
          try {
            analysis = JSON.parse(content);
          } catch (e1) {
            // 方法2: 使用正则提取JSON对象
            const jsonMatch = content.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
              try {
                analysis = JSON.parse(jsonMatch[0]);
              } catch (e2) {
                // 方法3: 仅修复尾随逗号（不破坏字符串内容）
                // 注意：不能替换换行符，因为 JSON 结构本身允许换行，
                // 字符串值内部的换行符需要更精确的解析器处理，简单正则会破坏合法内容
                try {
                  const fixed = jsonMatch[0].replace(/,\s*([}\]])/g, '$1');
                  analysis = JSON.parse(fixed);
                } catch (e3) {
                  console.warn('[aiAnalyze] JSON解析失败，使用原始内容');
                }
              }
            }
          }

          // 步骤 4：判定合规性
          aiStep.value = 4;
          aiLoadingText.value = '正在判定合规性...';
          await nextTick();

          if (analysis) {
            // 步骤 5：提取关键证据点
            aiStep.value = 5;
            aiLoadingText.value = '正在提取关键证据点...';
            await nextTick();

            // 提示词已不再要求 AI 输出结构化 checkpointResults，逐点核查结果直接写进
            // conclusion 正文，因此无法再做"覆盖 X/N 点"的量化校验。这里只保留中性提示，
            // 让用户知道知识库确实参与了本次分析，不产生"AI 未返回逐点结果"的误报。
            const recalledCount = Number(res.data?.recalledCount || 0);
            if (recalledCount > 0) {
              aiWarning.value = `本次分析参考了知识库中的 ${recalledCount} 个测评点，请核对结论是否逐项覆盖`;
            }
            aiAnalysisResult.value = {
              controlPoint: row.controlPoint || '',
              requirement: row.requirement || '',
              evidence: row.evidence || '',
              actualOutput: analysis.actualOutput || row.evidence || '',
              keyEvidencePoints: analysis.keyEvidencePoints || [],
              compliance: analysis.compliance || '待判定',
              conclusion: analysis.conclusion || '',
            };
            // 步骤 6：生成测评结论
            aiStep.value = 6;
            aiLoadingText.value = '已生成测评结论';
            aiLoading.value = false;
          } else {
            aiStep.value = 5;
            aiLoadingText.value = '正在提取关键证据点...';
            await nextTick();
            aiAnalysisResult.value = {
              controlPoint: row.controlPoint || '',
              requirement: row.requirement || '',
              evidence: row.evidence || '',
              actualOutput: row.evidence || '',
              keyEvidencePoints: [],
              compliance: '待判定',
              conclusion: content,
            };
            aiStep.value = 6;
            aiLoadingText.value = '已生成测评结论';
            aiLoading.value = false;
          }
        } catch {
          aiAnalysisResult.value = {
            controlPoint: row.controlPoint || '',
            requirement: row.requirement || '',
            evidence: row.evidence || '',
            actualOutput: row.evidence || '',
            keyEvidencePoints: [],
            compliance: '待判定',
            conclusion: res.data.content,
          };
          aiLoading.value = false;
        }
      } else {
        // 用户取消：主进程 abort 后返回成功:fase，这里不弹失败，静默结束
        if (singleCancelled.value) {
          aiLoading.value = false;
          aiDialogVisible.value = false;
        } else {
          aiLoading.value = false;
          ElMessage.error(res.error?.message || 'AI分析失败');
        }
      }
    } catch (error: any) {
      aiLoading.value = false;
      // 取消不等于失败：中断后不把「用户已取消」当错误弹出来
      if (!singleCancelled.value) {
        ElMessage.error('AI分析失败：' + (error.message || error));
      }
    } finally {
      // 无论成功 / 失败 / 取消，都必须退订并归零，避免监听器叠加或残留进度
      unsubscribeWait?.();
      aiWaitPercent.value = 0;
    }
  }

  /**
   * 应用 AI 分析结果到当前行
   */
  async function applyAiResult() {
    if (!aiCurrentRow.value || !aiAnalysisResult.value) return;

    const row = aiCurrentRow.value;
    const result = aiAnalysisResult.value;

    // 与 ai-analysis.vue 的标签样式共用 parseAiCompliance：否定优先，且支持 AI 返回的英文别名
    row.compliance = parseAiCompliance(result.compliance);
    // 测评结论只取 AI 正文。历史版本会把「逐点核查」结果附在结论末尾，
    // 该内容用户不需要，且会随结论进入报告；AI 若自行输出了【逐点核查】段也一并剥离。
    // 再剥除句尾"判定为符合/部分符合/不符合"等判定复述（判定已由 compliance 字段承载）。
    row.conclusion = stripVerdictTail(String(result.conclusion || '').split('\n【逐点核查】')[0].trim());

    if (result.keyEvidencePoints && result.keyEvidencePoints.length > 0) {
      const normalize = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();
      const existingLines = (row.evidence || '')
        .split('\n')
        .map((l: string) => l.trim())
        .filter(Boolean)
        .map(normalize);
      const existingSet = new Set(existingLines);
      const newPoints = result.keyEvidencePoints
        .filter((p: string) => {
          const np = normalize(p);
          if (!np) return false;
          if (existingSet.has(np)) return false;
          for (const e of existingSet) {
            if ((e as string).includes(np) || np.includes(e as string)) return false;
          }
          return true;
        })
        .map((p: string) => p.trim())
        .filter(Boolean);
      if (newPoints.length > 0) {
        const existing = row.evidence && row.evidence.trim() ? row.evidence.trimEnd() + '\n' : '';
        row.evidence = existing + newPoints.join('\n');
      }
    }

    // L12：AI 提取的「实际输出」此前只算不用。并入证据（互斥去重），
    // 让分析结果里的实际输出情况真正回填到记录，而不是算完即丢。
    if (result.actualOutput && result.actualOutput.trim()) {
      const normalize = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();
      const actual = result.actualOutput.trim();
      if (!normalize(row.evidence || '').includes(normalize(actual))) {
        const existing = row.evidence && row.evidence.trim() ? row.evidence.trimEnd() + '\n' : '';
        row.evidence = existing + `实际输出：${actual}`;
      }
    }

    // 把改动行交给父组件标脏并立即同步落库。
    // 旧实现在这里绕开自动保存、直接调底层记录接口兜底，却漏了必填的
    // projectId / assetId / method / screenshotPaths：后端 validateNotEmpty(projectId)
    // 会直接拒掉，兜底从未真正生效；即便成功也会把资产级记录写成项目级，切回资产视图照样看不到。
    // 统一走 autoSave.persist 才能保证字段完整、口径一致。
    try {
      const saved = await saveAllRows([row]);
      if (saved) {
        ElMessage.success('AI分析结果已填入记录表并保存');
      } else {
        console.error('[applyAiResult] 回填保存失败，脏数据已保留');
        ElMessage.error('回填内容已保留在表格中，但保存失败，请点击「保存」重试后再切换页面');
      }
    } catch (err: any) {
      console.error('[applyAiResult] 保存异常:', err);
      ElMessage.error('保存失败：' + (err.message || '未知错误'));
    }

    aiDialogVisible.value = false;
  }

  /**
   * 处理批量文件上传
   */
  async function handleBatchUpload() {
    if (!window.api) {
      ElMessage.error('文件上传功能不可用');
      return;
    }
    try {
      const res = await window.api.dialog.showOpenDialog({
        title: '选择文件',
        filters: [{ name: '支持的文件', extensions: ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'pdf', 'doc', 'docx', 'md', 'txt'] }],
        properties: ['openFile', 'multiSelections'],
      });
      if (!res.success || res.data?.canceled || !res.data?.filePaths) return;
      for (const filePath of res.data.filePaths) {
        const fileName = filePath.split('\\').pop()?.split('/').pop() || filePath;
        const fileType = getFileType(filePath);
        const id = `batch-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        let dataUrl = '';
        if (fileType === 'image') {
          const imgRes = await window.api.screenshot.getBase64({ filePath });
          if (imgRes.success && imgRes.data) {
            dataUrl = `data:${imgRes.data.mimeType};base64,${imgRes.data.base64}`;
          }
        }
        // 直接使用用户挑选的原始路径，**不拷贝**：
        // dialog:showOpenDialog 返回时主进程已把该文件登记为「本次会话授权」，
        // document:extractText 据此放行（见 utils/path-resolver 的 authorizeUserFiles）。
        // 这样分析附件不会被复制进数据目录——批量分析是一次性输入，不该占用归档空间。
        batchFiles.value.push({ id, path: filePath, name: fileName, fileType, dataUrl });
      }
    } catch (error) {
      ElMessage.error('上传文件失败');
    }
  }

  /**
   * 移除批量文件
   */
  function removeBatchFile(id: string) {
    const index = batchFiles.value.findIndex(s => s.id === id);
    if (index > -1) {
      batchFiles.value.splice(index, 1);
    }
  }

  /**
   * 清空批量文件
   */
  function clearBatchFiles() {
    batchFiles.value = [];
  }

  /**
   * 触发批量 AI 分析（先检查合规确认）
   */
  function batchAiAnalyze() {
    if (!aiConsentGiven.value) {
      aiConsentPendingAction.value = 'batch';
      showAiConsentDialog.value = true;
      return;
    }
    return executeBatchAiAnalyze();
  }

  /**
   * 执行批量 AI 分析
   * 返回 Promise 以便调用方可以 await 或链式处理
   */
  async function executeBatchAiAnalyze(): Promise<void> {
    if (!window.api) {
      ElMessage.error('AI功能不可用');
      return;
    }
    if (batchFiles.value.length === 0) {
      ElMessage.warning('请先上传文件');
      return;
    }
    if (tableRows.value.length === 0) {
      ElMessage.warning('没有可分析的测评项');
      return;
    }
    // 并发守卫：避免多个批量任务同时执行导致进度互相覆盖
    if (batchAiLoading.value) {
      ElMessage.warning('已有批量分析任务正在进行，请等待完成');
      return;
    }

    batchAiLoading.value = true;
    batchCancelled.value = false;
    batchAiProgress.value = {
      visible: true, percent: 2, message: '正在准备分析数据...', stage: 'init',
      current: 0, total: tableRows.value.length, text: '准备中...',
      currentBatch: 0, totalBatches: 0, totalItems: tableRows.value.length,
    };

    // 主进程只在收到 IPC 之后才开始推送进度；此前前端还得读配置、提取文档文本，
    // 这段空白原先一直停在「准备中...」，容易被当成卡死。这里按阶段主动更新文案，
    // 百分比压在 5 以下 —— 主进程首个进度就是 5%，衔接时不会倒退。
    const stageHint = (message: string, percent: number) => {
      batchAiProgress.value = { ...batchAiProgress.value, message, percent, stage: 'init' };
    };

    // 注册进度监听器，实时更新批量分析进度
    let unsubscribeProgress: (() => void) | null = window.api.ai.onAnalysisProgress((data) => {
      // 单条分析共用 ai:progress 通道但带 scope=single；并发触发时不要覆盖批量进度
      if ((data as any)?.scope === 'single') return;
      batchAiProgress.value = { ...batchAiProgress.value, ...data };
    });

    try {
      // 加载AI配置（获取OCR预处理设置）
      if (!aiConfig.value) {
        stageHint('正在读取AI配置...', 3);
        try {
          const configRes = await window.api.ai.getConfig();
          if (configRes.success && configRes.data) {
            aiConfig.value = configRes.data;
          }
        } catch (e) {
          console.warn('[batchAiAnalyze] 加载AI配置失败:', e);
        }
      }
      const items = tableRows.value
        .filter(row => row.compliance !== 'na')
        .map(row => ({
          id: row.itemId,
          controlPoint: row.controlPoint || '',
          requirement: row.requirement || '',
          // S2/S3：批量也要带齐召回三要素，否则批量召回永远走模糊
          domain: row.domainId || domainId || undefined,
          assetCategory: row.assetCategory || row.category || undefined,
          assetOs: row.assetOs || undefined,
        }));
      const imagePaths = batchFiles.value.filter(f => f.fileType === 'image').map(s => s.path);
      const docFiles = batchFiles.value.filter(f => f.fileType === 'pdf' || f.fileType === 'word');
      const textFiles = batchFiles.value.filter(f => f.fileType === 'text');
      let docContents: { name: string; content: string }[] = [];
      if (docFiles.length > 0) {
        stageHint(`正在提取 ${docFiles.length} 个文档的文本...`, 4);
        const docRes = await window.api.document.extractText({ filePaths: docFiles.map(d => d.path) });
        if (docRes.success && docRes.data) {
          const failedDocs: string[] = [];
          docContents = [];
          for (const doc of docRes.data) {
            if (doc.error) {
              failedDocs.push(`${doc.name}（${doc.error}）`);
              continue;
            }
            docContents.push({ name: doc.name, content: doc.content });
          }
          if (failedDocs.length > 0) {
            ElMessage.warning(`部分文档未能读取，已跳过：${failedDocs.join('；')}`);
          }
        }
      }
      if (textFiles.length > 0) {
        for (let i = 0; i < textFiles.length; i++) {
          const textFile = textFiles[i];
          stageHint(`正在读取文本文件 (${i + 1}/${textFiles.length})...`, 4);
          try {
            const res = await window.api.screenshot.readText({ filePath: textFile.path });
            if (res.success && res.data) {
              docContents.push({ name: textFile.name, content: res.data.content });
            }
          } catch (e) {
            console.warn('[batchAiAnalyze] 读取文本文件失败:', textFile.path, e);
          }
        }
      }

      // 分批提交：单次输出随测评项数线性增长，过长会被模型截断导致 JSON 解析失败。
      // 每批固定条数逐批调用，合并结果；任一批失败不影响已拿到的批次。
      // 批越小，AI 把相邻相似测评项（如都讲账户/权限）的结论与 itemId 写反的概率越低；
      // 5 项/批是在调用次数与错配风险之间的平衡（常量在模块顶部导出供弹窗显示批次）。
      const chunks: typeof items[] = [];
      for (let i = 0; i < items.length; i += BATCH_CHUNK_SIZE) {
        chunks.push(items.slice(i, i + BATCH_CHUNK_SIZE));
      }
      const mergedResults: any[] = [];
      let anyPartial = false;
      let lastBatchError: any = null;
      let lastBatchMessage = '';
      // 批次元数据写入进度状态，供弹窗显示"第 X/Y 批 · 共 N 项"
      batchAiProgress.value = {
        ...batchAiProgress.value,
        currentBatch: 0,
        totalBatches: chunks.length,
        totalItems: items.length,
      };

      for (let ci = 0; ci < chunks.length; ci++) {
        if (batchCancelled.value) break;
        batchAiProgress.value = {
          ...batchAiProgress.value,
          currentBatch: ci + 1,
          current: ci * BATCH_CHUNK_SIZE,
          total: items.length,
        };
        stageHint(`正在提交给AI分析（${chunks[ci].length} 项 / ${imagePaths.length} 张截图）...`, 5);
        const batchRes = await window.api.ai.batchAnalyzeScreenshots({
          items: chunks[ci],
          screenshots: imagePaths,
          documents: docContents,
          ocrPreprocess: Boolean(aiConfig.value?.ocrPreprocess),
        });
        if (!batchRes.success || !batchRes.data) {
          lastBatchError = batchRes.error || null;
          lastBatchMessage = batchRes.error?.message || 'AI分析失败';
          break;
        }
        const parsed = parseBatchAiContent(batchRes.data.content);
        if (parsed.results.length > 0) {
          mergedResults.push(...parsed.results);
          if (parsed.partial) anyPartial = true;
        } else if (parsed.error) {
          lastBatchError = parsed.error;
          console.error(`[batchAiAnalyze] 第 ${ci + 1}/${chunks.length} 批 JSON解析失败:`, parsed.error);
          console.error('[batchAiAnalyze] AI返回诊断:', {
            length: batchRes.data.content.length,
            head: batchRes.data.content.slice(0, 200),
            tail: batchRes.data.content.slice(-300),
          });
        }
      }

      if (mergedResults.length > 0) {
        const results = mergedResults;
        if (anyPartial) {
          ElMessage.warning(`AI 输出不完整（疑似被截断），已保留可解析的 ${results.length} 条结果；其余测评项未回填，请重试或减少单次批量条数`);
        }
        // 用 Set 去重：AI 可能对同一 itemId 返回多条结果
        const changedRows = new Set<any>();
        let totalAttached = 0; // 本次真正落盘成附件的文件总数

        // 错配纠正：AI 批量生成长 JSON 时偶尔把相邻相似测评项的结论与 itemId 写反。
        // 提示词已要求回显 requirement 原文；若按 itemId 找到的行与回显条款不符，
        // 而另一行与回显条款高度吻合，则以回显为准改判目标行，避免结论张冠李戴。
        const correctedItems = new Set<string>();
        for (const result of results) {
          const echoedReq = String(result.requirement || '').trim();
          let row = tableRows.value.find(r => r.itemId === result.itemId);
          if (echoedReq && row) {
            const idMatches = requirementTextMatches(echoedReq, row.requirement || '');
            if (!idMatches) {
              const better = tableRows.value.find(
                r => r.itemId !== result.itemId && requirementTextMatches(echoedReq, r.requirement || '')
              );
              if (better) {
                console.warn(
                  `[batchAiAnalyze] 检测到错配并纠正：AI 标记 itemId=${result.itemId}，但结论对应条款="${echoedReq.slice(0, 30)}..."，改判为 ${better.itemId}`
                );
                row = better;
                correctedItems.add(result.itemId);
              }
            }
          }
          if (!row) continue;
          let changed = false;
          const complianceValue = parseAiCompliance(result.compliance);
          if (complianceValue) {
            row.compliance = complianceValue;
            changed = true;
          }
          let conclusion = stripVerdictTail(String(result.conclusion || '').split('\n【逐点核查】')[0].trim());
          // 逐点核查结果不再拼进结论（用户不需要该内容）；覆盖率仅在前端作提示，不落库
          // 句尾判定复述一并剥除（判定已由 compliance 字段承载）
          if (conclusion) {
            row.conclusion = conclusion;
            changed = true;
          }
          // AI 按提示词返回与本测评项相关的截图/文档文件：
          // 先用条款原文校验附件是否错配（如"防火墙特征库"配给"日志审计"就丢弃），
          // 再用校验后的文件名做两件事：① 作为可读引用并入关键证据点；② 真正落盘为可预览附件。
          const itemReq = String(row.requirement || echoedReq || '');
          const validFileNames = resolveValidAttachedFiles(result.attachedFiles, itemReq);
          const nextEvidence = mergeAttachedFilesIntoEvidence(row.evidence || '', validFileNames);
          if (nextEvidence !== (row.evidence || '')) {
            row.evidence = nextEvidence;
            changed = true;
          }
          const attachedCount = await attachFilesToRow({
            attachedFiles: result.attachedFiles,
            row,
            batchFiles: batchFiles.value,
            projectId,
            itemRequirement: itemReq,
            validNames: validFileNames,
          });
          if (attachedCount > 0) {
            totalAttached += attachedCount;
            changed = true; // screenshots 变化也要落库
          }
          if (changed) changedRows.add(row);
        }

        // 回填只改内存行对象，必须把改动行交给父组件标脏并立即落库。
        // 历史 bug：直接 await saveAllRows() 且不传行 → dirtyMap 为空 → runSave 空跑返回 false，
        // 而这里连返回值都丢掉了，界面提示「已自动填入」，切页整表重建后内容全部消失。
        let saved = false;
        try {
          saved = await saveAllRows(Array.from(changedRows));
        } catch (err: any) {
          console.error('[batchAiAnalyze] saveAllRows threw:', err);
        }
        if (saved) {
          const correctedHint = correctedItems.size > 0
            ? `（已自动纠正 ${correctedItems.size} 条条款错配，请留意核对）`
            : '';
          const attachedHint = totalAttached > 0 ? `，关联 ${totalAttached} 个附件` : '';
          ElMessage.success(`AI分析完成，已自动填入并保存 ${changedRows.size} 条测评记录${attachedHint}${correctedHint}`);
        } else {
          console.error('[batchAiAnalyze] 回填保存失败，脏数据已保留');
          ElMessage.error(`已填入 ${changedRows.size} 条测评记录，但保存失败；内容仍在表格中，请点击「保存」重试后再切换页面`);
        }
        // 全部批次处理 + 回填 + 落库都完成后，才置 done 并关弹窗。
        // 关弹窗由这里统一负责（不再依赖 index.vue 监听 IPC 的 done），
        // 保证"弹窗关闭"与 finally 里的 batchAiLoading=false（按钮恢复）时序一致。
        batchAiProgress.value = {
          ...batchAiProgress.value,
          stage: 'done',
          percent: 100,
          currentBatch: batchAiProgress.value.totalBatches,
          current: batchAiProgress.value.totalItems,
          message: saved ? '分析完成并已保存' : '填入完成但保存失败',
        };
        setTimeout(() => {
          if (!batchCancelled.value) {
            batchAiProgress.value = { ...batchAiProgress.value, visible: false };
            batchAiMinimized.value = false;
          }
        }, 1000);
      } else {
        if (batchCancelled.value) {
          batchAiProgress.value.visible = false;
          batchAiMinimized.value = false;
        } else {
          console.error('[batchAiAnalyze] JSON解析失败:', lastBatchError);
          ElMessage.warning(lastBatchMessage || 'AI返回结果解析失败，请查看控制台或重试');
          batchAiProgress.value = { ...batchAiProgress.value, stage: 'error', message: '解析失败' };
        }
      }
    } catch (error: any) {
      // 取消不等于失败：中断后不把「用户已取消」当错误弹出来
      if (!batchCancelled.value) {
        ElMessage.error('AI分析失败：' + (error.message || error));
        batchAiProgress.value = { ...batchAiProgress.value, stage: 'error', message: error.message || '分析失败' };
      }
    } finally {
      if (unsubscribeProgress) {
        unsubscribeProgress();
        unsubscribeProgress = null;
      }
      batchAiLoading.value = false;
    }
  }

  // ==================== 返回所有状态和方法 ====================
  return {
    // 单条 AI 分析状态
    aiDialogVisible,
    aiLoading,
    aiLoadingText,
    aiStep,
    aiWaitPercent,
    aiCurrentRow,
    aiAnalysisResult,
    aiWarning,

    // 批量 AI 分析状态
    batchAiProgress,
    batchAiMinimized,
    aiDialogMinimized,

    // 合规确认状态
    aiConsentGiven,
    showAiConsentDialog,
    aiConsentPendingAction,

    // 批量文件状态
    batchFiles,
    showBatchScreenshots,
    batchAiLoading,

    // 计算属性
    batchAiProgressPercent,
    batchAiProgressPercentDisplay,

    // 方法
    confirmAiConsent,
    aiAnalyze,
    executeAiAnalyze,
    applyAiResult,
    cancelSingleAnalysis,
    cancelBatchAnalysis,
    handleBatchUpload,
    removeBatchFile,
    clearBatchFiles,
    batchAiAnalyze,
    executeBatchAiAnalyze,
    getFileType,
    cleanup,
  };
}
