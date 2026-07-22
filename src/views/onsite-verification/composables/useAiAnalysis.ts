import { ref, computed, type Ref } from 'vue';
import { ElMessage } from 'element-plus';

/**
 * useAiAnalysis composable 的配置选项
 */
interface UseAiAnalysisOptions {
  /** 测评记录表格数据 */
  tableRows: Ref<any[]>;
  /** 保存所有行的方法 */
  saveAllRows: () => Promise<boolean>;
  /** 加载截图 DataURL 的方法 */
  loadScreenshotDataUrl: (row: any, filePath: string) => Promise<string | null>;
}

/**
 * AI 分析 composable
 * 提取自 onsite-verification/index.vue 的 AI 分析相关逻辑
 */
export function useAiAnalysis(options: UseAiAnalysisOptions) {
  const { tableRows, saveAllRows } = options;

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

    aiCurrentRow.value = row;
    aiAnalysisResult.value = null;
    aiDialogVisible.value = true;
    aiLoading.value = true;
    aiStep.value = 1;
    aiLoadingText.value = '正在准备分析数据...';

    try {
      await new Promise(resolve => setTimeout(resolve, 400));
      aiStep.value = 2;
      aiLoadingText.value = hasScreenshots ? 'AI正在识别截图内容...' : 'AI正在分析关键证据点...';

      await new Promise(resolve => setTimeout(resolve, 400));
      aiStep.value = 3;
      aiLoadingText.value = 'AI正在提取关键证据点...';

      await new Promise(resolve => setTimeout(resolve, 400));
      aiStep.value = 4;
      aiLoadingText.value = 'AI正在判定合规性...';

      await new Promise(resolve => setTimeout(resolve, 400));
      aiStep.value = 5;
      aiLoadingText.value = 'AI正在生成详实测评结论...';

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
        result: row.evidence + docTextContent || '',
        screenshots: imageFiles,
      };
      console.log('[aiAnalyze] 准备调用, params:', JSON.stringify({
        ...params,
        screenshots: params.screenshots.length + ' items',
        docFiles: docFiles.length + ' items',
      }));

      let res;
      try {
        const timeoutMs = 120000;
        const timeoutPromise = new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error('AI分析超时，请检查网络连接或稍后重试')), timeoutMs);
        });
        res = await Promise.race([
          window.api.ai.analyzeAssessment(params),
          timeoutPromise,
        ]);
      } catch (ipcError: any) {
        console.error('[aiAnalyze] IPC调用失败:', ipcError.message, ipcError.stack);
        throw ipcError;
      }

      console.log('[aiAnalyze] IPC调用成功, success:', res?.success, 'hasData:', !!res?.data);

      aiStep.value = 6;

      if (res.success && res.data) {
        try {
          const content = res.data.content;
          console.log('[aiAnalyze] AI返回内容长度:', content.length);

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
                // 方法3: 尝试修复常见的JSON格式问题
                try {
                  let fixed = jsonMatch[0]
                    .replace(/,\s*}/g, '}')
                    .replace(/,\s*]/g, ']')
                    .replace(/[\r\n]+/g, '\\n');
                  analysis = JSON.parse(fixed);
                } catch (e3) {
                  console.warn('[aiAnalyze] JSON解析失败，使用原始内容');
                }
              }
            }
          }

          if (analysis) {
            aiAnalysisResult.value = {
              controlPoint: row.controlPoint || '',
              requirement: row.requirement || '',
              evidence: row.evidence || '',
              actualOutput: analysis.actualOutput || row.evidence || '',
              keyEvidencePoints: analysis.keyEvidencePoints || [],
              compliance: analysis.compliance || '待判定',
              conclusion: analysis.conclusion || '',
            };
            aiLoading.value = false;
          } else {
            aiAnalysisResult.value = {
              controlPoint: row.controlPoint || '',
              requirement: row.requirement || '',
              evidence: row.evidence || '',
              actualOutput: row.evidence || '',
              keyEvidencePoints: [],
              compliance: '待判定',
              conclusion: content,
            };
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
        aiLoading.value = false;
        ElMessage.error(res.error?.message || 'AI分析失败');
      }
    } catch (error: any) {
      aiLoading.value = false;
      ElMessage.error('AI分析失败：' + (error.message || error));
    }
  }

  /**
   * 应用 AI 分析结果到当前行
   */
  async function applyAiResult() {
    if (!aiCurrentRow.value || !aiAnalysisResult.value) return;

    const row = aiCurrentRow.value;
    const result = aiAnalysisResult.value;

    const resultMap: Record<string, string> = {
      '符合': 'conform',
      '部分符合': 'partial',
      '不符合': 'nonconform',
      '不适用': 'na',
    };

    row.compliance = resultMap[result.compliance] || '';
    row.conclusion = result.conclusion || '';

    if (result.keyEvidencePoints && result.keyEvidencePoints.length > 0) {
      const existingEvidence = row.evidence ? row.evidence + '\n' : '';
      const newPoints = result.keyEvidencePoints
        .filter((p: string) => !row.evidence?.includes(p))
        .join('\n');
      if (newPoints) {
        row.evidence = existingEvidence + newPoints;
      }
    }

    try {
      const saveRes = await saveAllRows();
      if (saveRes) {
        ElMessage.success('AI分析结果已填入记录表并保存');
      } else {
        console.error('[applyAiResult] saveAllRows returned false');
        if (window.api?.assessment?.saveRecord) {
          const complianceMap: Record<string, string> = {
            'conform': 'conform',
            'partial': 'partial',
            'nonconform': 'nonconform',
            'na': 'notapplicable',
            '': 'untested',
          };
          const directRes = await window.api.assessment.saveRecord({
            id: row.id || undefined,
            itemId: row.itemId,
            result: (complianceMap[row.compliance] || 'untested') as 'compliant' | 'partial' | 'non_compliant' | 'not_applicable' | 'untested',
            findings: row.conclusion || '',
            evidence: row.evidence || '',
            commandOutput: row.evidence || '',
          });
          console.log('[applyAiResult] 直接saveRecord结果:', JSON.stringify(directRes));
          if (directRes.success && directRes.data) {
            row.id = directRes.data.id;
            ElMessage.success('AI分析结果已填入记录表并保存');
          } else {
            ElMessage.error('保存失败，请手动点击保存按钮');
          }
        } else {
          ElMessage.error('保存失败，请手动点击保存按钮');
        }
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
    executeBatchAiAnalyze();
  }

  /**
   * 执行批量 AI 分析
   */
  function executeBatchAiAnalyze() {
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

    batchAiLoading.value = true;
    batchAiProgress.value = { visible: true, percent: 0, message: '准备中...', stage: 'init', current: 0, total: tableRows.value.length, text: '准备中...' };

    (async () => {
      try {
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
          const docRes = await window.api.document.extractText({ filePaths: docFiles.map(d => d.path) });
          if (docRes.success && docRes.data) {
            docContents = docRes.data;
          }
        }
        if (textFiles.length > 0) {
          for (const textFile of textFiles) {
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

        const res = await window.api.ai.batchAnalyzeScreenshots({
          items,
          screenshots: imagePaths,
          documents: docContents,
        });

        if (res.success && res.data) {
          const content = res.data.content;
          console.log('[batchAiAnalyze] AI返回内容长度:', content.length);
          console.log('[batchAiAnalyze] AI返回内容前500字符:', content.substring(0, 500));

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
                // 方法3: 尝试修复常见的JSON格式问题
                try {
                  let fixed = jsonMatch[0]
                    .replace(/,\s*}/g, '}')  // 移除尾随逗号
                    .replace(/,\s*]/g, ']')  // 移除尾随逗号
                    .replace(/[\r\n]+/g, '\\n')  // 转义换行符
                    .replace(/(?<!\\)\\"/g, '"')  // 修复转义引号
                    .replace(/(["\]}])\s*\n\s*([{\["])/g, '$1,$2');  // 添加缺失的逗号
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
            let appliedCount = 0;

            for (const result of results) {
              const row = tableRows.value.find(r => r.itemId === result.itemId);
              if (row) {
                const resultMap: Record<string, string> = {
                  '符合': 'conform',
                  '部分符合': 'partial',
                  '不符合': 'nonconform',
                  '不适用': 'na',
                };
                const complianceValue = resultMap[result.compliance] || '';
                if (complianceValue) {
                  row.compliance = complianceValue;
                }
                if (result.conclusion) {
                  row.conclusion = result.conclusion;
                }
                appliedCount++;
              }
            }

            ElMessage.success(`AI分析完成，已自动填入 ${appliedCount} 条测评记录`);
            try {
              await saveAllRows();
            } catch (err: any) {
              console.error('[batchAiAnalyze] saveAllRows threw:', err);
            }
          } else {
            console.error('[batchAiAnalyze] JSON解析失败，所有方法都失败:', parseError);
            console.error('[batchAiAnalyze] AI返回内容:', content);
            ElMessage.warning('AI返回结果解析失败，请查看控制台或重试');
          }
        } else {
          ElMessage.error(res.error?.message || 'AI分析失败');
        }
      } catch (error: any) {
        ElMessage.error('AI分析失败：' + (error.message || error));
      } finally {
        batchAiLoading.value = false;
      }
    })();
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
    handleBatchUpload,
    removeBatchFile,
    clearBatchFiles,
    batchAiAnalyze,
    executeBatchAiAnalyze,
    getFileType,
    cleanup,
  };
}
