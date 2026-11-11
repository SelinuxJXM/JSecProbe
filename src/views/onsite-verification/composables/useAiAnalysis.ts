import { ref, computed, nextTick, type Ref } from 'vue';
import { ElMessage } from 'element-plus';
import { parseAiCompliance } from '../../../../shared/assessment-result';

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
  const { tableRows, saveAllRows, projectId: _projectId, standardId, domainId, currentItemId } = options;
  // projectId 保留给后续扩展，解构显式命名以消除 TS6133

  // AI配置（用于获取OCR预处理设置）
  const aiConfig = ref<any>(null);

  // ==================== 单条 AI 分析状态 ====================
  const aiDialogVisible = ref(false);
  const aiLoading = ref(false);
  const aiLoadingText = ref('');
  const aiStep = ref(0);
  const aiCurrentRow = ref<any>(null);
  const aiAnalysisResult = ref<any>(null);

  // 批量AI分析进度弹窗
  const batchAiProgress = ref({ visible: false, percent: 0, message: '', stage: '', current: 0, total: 0, text: '' });
  const batchAiMinimized = ref(false);
  const aiDialogMinimized = ref(false);

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
    aiDialogVisible.value = true;
    aiLoading.value = true;
    aiStep.value = 1;
    aiLoadingText.value = '正在准备分析数据...';
    // 新一轮分析开始时重置取消标记（同一行可能被反复分析）
    singleCancelled.value = false;

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
            for (const doc of docRes.data) {
              docTextContent += `\n=== 文档：${doc.name} ===\n${doc.content}\n`;
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
    row.conclusion = result.conclusion || '';

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
    batchAiProgress.value = { visible: true, percent: 2, message: '正在准备分析数据...', stage: 'init', current: 0, total: tableRows.value.length, text: '准备中...' };

    // 主进程只在收到 IPC 之后才开始推送进度；此前前端还得读配置、提取文档文本，
    // 这段空白原先一直停在「准备中...」，容易被当成卡死。这里按阶段主动更新文案，
    // 百分比压在 5 以下 —— 主进程首个进度就是 5%，衔接时不会倒退。
    const stageHint = (message: string, percent: number) => {
      batchAiProgress.value = { ...batchAiProgress.value, message, percent, stage: 'init' };
    };

    // 注册进度监听器，实时更新批量分析进度
    let unsubscribeProgress: (() => void) | null = window.api.ai.onAnalysisProgress((data) => {
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
        }));
      const imagePaths = batchFiles.value.filter(f => f.fileType === 'image').map(s => s.path);
      const docFiles = batchFiles.value.filter(f => f.fileType === 'pdf' || f.fileType === 'word');
      const textFiles = batchFiles.value.filter(f => f.fileType === 'text');
      let docContents: { name: string; content: string }[] = [];
      if (docFiles.length > 0) {
        stageHint(`正在提取 ${docFiles.length} 个文档的文本...`, 4);
        const docRes = await window.api.document.extractText({ filePaths: docFiles.map(d => d.path) });
        if (docRes.success && docRes.data) {
          docContents = docRes.data;
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

      stageHint(`正在提交给AI分析（${items.length} 个测评项 / ${imagePaths.length} 张截图）...`, 5);
      const res = await window.api.ai.batchAnalyzeScreenshots({
        items,
        screenshots: imagePaths,
        documents: docContents,
        ocrPreprocess: Boolean(aiConfig.value?.ocrPreprocess),
      });

      if (res.success && res.data) {
        const content = res.data.content;

        // 尝试多种方式提取JSON
        let analysis: any = null;
        let parseError: any = null;

        // 方法1: 直接解析整个内容
        try {
          analysis = JSON.parse(content);
        } catch (e1) {
          parseError = e1;
          // 方法2: 使用正则提取JSON对象（贪婪匹配最外层大括号）
          const jsonMatch = content.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            try {
              analysis = JSON.parse(jsonMatch[0]);
            } catch (e2) {
              parseError = e2;
              // 方法3: 仅修复尾随逗号（不破坏字符串内容）
              // 注意：不能替换换行符或转义引号，会破坏合法 JSON 内容
              try {
                const fixed = jsonMatch[0].replace(/,\s*([}\]])/g, '$1');
                analysis = JSON.parse(fixed);
              } catch (e3) {
                parseError = e3;
                // 方法4: 尝试提取results数组部分
                try {
                  const resultsMatch = content.match(/"results"\s*:\s*\[([\s\S]*)\]/);
                  if (resultsMatch) {
                    const resultsArray = JSON.parse(`[${resultsMatch[1]}]`);
                    analysis = { results: resultsArray };
                  }
                } catch (e4) {
                  parseError = e4;
                }
              }
            }
          }
        }

        if (analysis) {
          const results = analysis.results || [];
          // 用 Set 去重：AI 可能对同一 itemId 返回多条结果
          const changedRows = new Set<any>();

          for (const result of results) {
            const row = tableRows.value.find(r => r.itemId === result.itemId);
            if (!row) continue;
            let changed = false;
            const complianceValue = parseAiCompliance(result.compliance);
            if (complianceValue) {
              row.compliance = complianceValue;
              changed = true;
            }
            if (result.conclusion) {
              row.conclusion = result.conclusion;
              changed = true;
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
            ElMessage.success(`AI分析完成，已自动填入并保存 ${changedRows.size} 条测评记录`);
          } else {
            console.error('[batchAiAnalyze] 回填保存失败，脏数据已保留');
            ElMessage.error(`已填入 ${changedRows.size} 条测评记录，但保存失败；内容仍在表格中，请点击「保存」重试后再切换页面`);
          }
          // 更新进度状态为完成
          batchAiProgress.value = {
            ...batchAiProgress.value,
            stage: 'done',
            percent: 100,
            message: saved ? '分析完成并已保存' : '填入完成但保存失败',
          };
        } else {
          console.error('[batchAiAnalyze] JSON解析失败:', parseError);
          ElMessage.warning('AI返回结果解析失败，请查看控制台或重试');
          batchAiProgress.value = { ...batchAiProgress.value, stage: 'error', message: '解析失败' };
        }
      } else {
        if (batchCancelled.value) {
          batchAiProgress.value.visible = false;
          batchAiMinimized.value = false;
        } else {
          ElMessage.error(res.error?.message || 'AI分析失败');
          batchAiProgress.value = { ...batchAiProgress.value, stage: 'error', message: res.error?.message || '分析失败' };
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
    aiCurrentRow,
    aiAnalysisResult,

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
