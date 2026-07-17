# 现场核查页面重构计划

## 目标
将 `src/views/onsite-verification/index.vue`（5189行）拆分为多个职责清晰的子组件，主组件降至 800-1200 行。

## 拆分方案

### 目录结构
```
src/views/onsite-verification/
├── index.vue                       ← 主组件（编排 + 共享状态）
├── components/
│   ├── ai-analysis.vue             ← AI 单条+批量分析（含进度条、同意书）
│   ├── knowledge-panel.vue         ← 知识库面板（命令+文档）
│   ├── import-export.vue           ← 导入/导出系统（含树选择）
│   ├── screenshot-manager.vue      ← 截图上传/预览/删除
│   └── file-preview.vue            ← 文件预览对话框
├── composables/
│   ├── useAutoSave.ts              ← 自动保存 composable
│   └── useAiAnalysis.ts            ← AI 分析 composable
└── utils/
    ├── table-cell-selection.ts     ← 单元格选区逻辑（纯函数）
    └── clipboard-handler.ts        ← 粘贴解析逻辑（纯函数）
```

### 各模块职责与提取内容

#### 1. `useAutoSave.ts`（~60行）
- `saveStatus`, `hasUnsavedChanges`, `lastSavedTime`
- `saveAllRows()`, `debounceAutoSave()`, `startPeriodicSave()`, `stopPeriodicSave()`, `triggerManualSave()`, `formatSaveTime()`

#### 2. `useAiAnalysis.ts`（~400行）
- `aiDialogVisible`, `aiLoading`, `aiLoadingText`, `aiStep`, `aiCurrentRow`, `aiAnalysisResult`
- `batchAiProgress`, `batchAiMinimized`, `aiDialogMinimized`, `aiConsentGiven`, `showAiConsentDialog`, `aiConsentPendingAction`
- `confirmAiConsent()`, `aiAnalyze()`, `executeAiAnalyze()`, `applyAiResult()`
- `batchFiles`, `showBatchScreenshots`, `batchAiLoading`
- `handleBatchUpload()`, `removeBatchFile()`, `clearBatchFiles()`, `batchAiAnalyze()`, `executeBatchAiAnalyze()`

#### 3. `table-cell-selection.ts`（~120行）
- `selectedCells`, `selectionAnchor`
- `cellKey()`, `isCellSelected()`, `isSelectionAnchor()`
- `handleCellMouseDown()`, `handleCellClick()`, `clearSelectedCells()`, `handleTableContainerClick()`

#### 4. `clipboard-handler.ts`（~150行）
- `COMPLIANCE_TEXT_MAP`, `parseComplianceText()`
- `handleConclusionPaste()`, `handleCompliancePaste()`
- `parseExcelTableHTML()`, `parsePlainText()`
- `setupGlobalPasteHandler()`, `saveClipboardImage()`

#### 5. `ai-analysis.vue`（~450行）
- 模板：AI 对话框、批量进度条、迷你进度条、同意书对话框
- 脚本：从 useAiAnalysis 导入状态和方法

#### 6. `knowledge-panel.vue`（~120行）
- 模板：知识库 Tab、命令卡片、文档列表
- 脚本：`knowledgeTab`, `knowledgeSearch`, `commandList`, `documentList`, `filteredCommands`, `filteredDocuments`, `loadKnowledgeBase()`, `toggleExpand()`, `copyCommand()`, `viewDocument()`, `quoteCommand()`

#### 7. `import-export.vue`（~350行）
- 模板：导出对话框、导入对话框、树形选择
- 脚本：所有导入导出相关的 ref、computed、方法

#### 8. `screenshot-manager.vue`（~180行）
- 模板：截图缩略图、上传按钮
- 脚本：`uploadScreenshot()`, `loadScreenshotDataUrl()`, `getScreenshotSrc()`, `getScreenshotState()`, `previewScreenshot()`, `removeScreenshot()`, `openFilePreview()`, `openFileExternal()`

#### 9. `file-preview.vue`（~70行）
- 模板：预览对话框
- 脚本：`previewDialogVisible`, `previewFile`, `previewFileSrc`, `previewLoading`, `previewError`, `previewTextContent`, `openFilePreview()`

### 主组件保留内容
- 共享状态：`project`, `treeData`, `filteredTreeData`, `currentAsset`, `currentDomainId`, `tableRows`, `progress`, `currentRowIndex`, `sectionTitle`
- 布局骨架：迷你进度条、项目上下文栏、顶部工具栏、三栏布局、左栏树、中栏表格、右栏知识库
- 核心逻辑：`selectGlobalDomain()`, `selectAsset()`, `toggleDomain()`, `calculateControlPointRowSpans()`, `loadProject()`, `loadAssetTree()`, `loadProgress()`, `updateAssetProgress()`, `syncIssues()`, `isExtensionDivider()`
- 表格单元格渲染（保留在 index.vue 中，因为与表格行数据紧密耦合）

### 通信方式
- **props/emits**：子组件通过 props 接收数据，通过 emits 通知父组件
- **provide/inject**：主组件 provide 共享状态（`project`, `tableRows`, `currentRowIndex` 等），子组件 inject 使用
- **composable**：`useAutoSave`, `useAiAnalysis` 在主组件中 setup，通过 provide 注入

### 样式处理
- 每个子组件有自己的 `<style>` 块
- 主组件保留全局布局样式
- 提取的子组件样式从原文件中对应移除

## 执行步骤

### Phase 1：提取纯工具函数（无依赖）
1. 创建 `utils/table-cell-selection.ts`
2. 创建 `utils/clipboard-handler.ts`

### Phase 2：提取 composable
3. 创建 `composables/useAutoSave.ts`
4. 创建 `composables/useAiAnalysis.ts`

### Phase 3：提取子组件
5. 创建 `components/file-preview.vue`
6. 创建 `components/screenshot-manager.vue`
7. 创建 `components/knowledge-panel.vue`
8. 创建 `components/import-export.vue`
9. 创建 `components/ai-analysis.vue`

### Phase 4：精简主组件
10. 移除已提取的模板代码，替换为子组件引用
11. 移除已提取的脚本代码，替换为 composable 和子组件 imports
12. 移除已提取的样式代码

### Phase 5：验证
13. 运行 `npx vue-tsc --noEmit` 确保类型检查通过
14. 启动应用手动验证所有功能正常
