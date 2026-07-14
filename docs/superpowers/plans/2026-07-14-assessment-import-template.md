# 现场核查导入与下载模板功能实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为现场核查模块增加下载导入模板和导入测评结果功能，支持全局层面和按资产两种模式的 Excel 模板生成与数据导入。

**Architecture:** 新增 `assessment:downloadTemplate` IPC 处理程序生成模板（按层面分 sheet，每个 sheet 预填测评项；按资产扩展附加同名资产 sheet 叠加对应测评项）。增强现有 `assessment:importExcel`，能识别 sheet 名中带资产名的格式（`层面_资产名`），自动匹配资产并设置 record.assetId。前端在工具栏添加两个按钮。

**Tech Stack:** ExcelJS, xlsx, Electron IPC, Vue 3, Element Plus

---

## 文件结构

| 文件 | 修改内容 |
|------|----------|
| `electron/ipc/assessment.ipc.ts` | 新增 `assessment:downloadTemplate`，增强 `assessment:importExcel` |
| `electron/preload/index.ts` | 暴露 `assessment.downloadTemplate` 和 `assessment.importExcel`（`importExcel` 已在 && 补充 `downloadTemplate`） |
| `src/views/onsite-verification/index.vue` | 添加两个按钮 && 对应事件处理 && import（主要针对前端UI和TypeScript导入） |

---

## Task 1: 新增 assessment:downloadTemplate IPC 处理程序

**Files:**
- Modify: `electron/ipc/assessment.ipc.ts:979`

- [ ] **Step 1: 在 `assessment:importExcel` 前插入 `downloadTemplate` 处理程序**

在 `assessment:importExcel` 注册代码之前，添加以下 IPC handler：

```typescript
ipcMain.handle('assessment:downloadTemplate', wrap(async (_event, projectId: string) => {
  try {
    const db = getDb();

    const project = await db.query.projects.findFirst({ where: eq(schema.projects.id, projectId) });
    if (!project) return { success: false, error: { message: '项目不存在' } };

    const DOMAIN_SHEETS = [
      { domain: 'secure_physical', sheetName: '安全物理环境' },
      { domain: 'secure_communication', sheetName: '安全通信网络' },
      { domain: 'secure_boundary', sheetName: '安全区域边界' },
      { domain: 'secure_computing', sheetName: '安全计算环境' },
      { domain: 'secure_management', sheetName: '安全管理中心' },
      { domain: 'security_management', sheetName: '安全管理制度' },
      { domain: 'security_organization', sheetName: '安全管理机构' },
      { domain: 'security_personnel', sheetName: '安全管理人员' },
      { domain: 'security_construction', sheetName: '安全建设管理' },
      { domain: 'security_maintenance', sheetName: '安全运维管理' },
    ];

    const EXTENSION_GROUPS = [
      { key: 'general', label: '安全通用要求' },
      { key: 'cloud', label: '云计算安全扩展要求' },
      { key: 'mobile', label: '移动互联安全扩展要求' },
      { key: 'iot', label: '物联网安全扩展要求' },
      { key: 'industrial', label: '工业控制系统安全扩展要求' },
      { key: 'bigdata', label: '大数据安全扩展要求（国标附录）' },
    ];

    const CATEGORY_TO_DOMAIN: Record<string, string> = {
      server_storage: 'secure_computing', dbms: 'secure_computing',
      network_device: 'secure_computing', security_device: 'secure_computing',
      business_app: 'secure_computing', terminal: 'secure_computing',
      management_platform: 'secure_computing', data_resource: 'secure_computing',
      machine_room: 'secure_physical', network_boundary: 'secure_boundary',
      data_category: 'secure_computing',
    };

    const EXT_TYPE_MAP: Record<string, string> = {
      '安全通用要求': 'general', '云计算安全扩展要求': 'cloud',
      '移动互联安全扩展要求': 'mobile', '物联网安全扩展要求': 'iot',
      '工业控制系统安全扩展要求': 'industrial',
      '大数据安全扩展要求': 'bigdata',
      '大数据安全扩展要求（国标附录）': 'bigdata',
      '关键信息基础设施安全扩展要求': 'cii',
    };

    const projectExtCodes: string[] = [];
    if (project.extensionType) {
      for (const t of project.extensionType.split(',').filter(Boolean)) {
        const code = EXT_TYPE_MAP[t.trim()] || t.trim();
        if (!projectExtCodes.includes(code)) projectExtCodes.push(code);
      }
    }
    const activeExtGroups = EXTENSION_GROUPS.filter(g => g.key === 'general' || projectExtCodes.includes(g.key));

    // 按类别分组资产
    const allAssets = await db.query.assets.findMany({ where: eq(schema.assets.projectId, projectId) });

    const workbook = new ExcelJS.Workbook();

    for (const { domain: domainKey, sheetName } of DOMAIN_SHEETS) {
      const extOrConditions = [eq(schema.assessmentItems.extensionType, 'general')];
      for (const ext of projectExtCodes) extOrConditions.push(eq(schema.assessmentItems.extensionType, ext));
      const extOr = or(...extOrConditions);

      const items = await db.query.assessmentItems.findMany({
        where: and(
          eq(schema.assessmentItems.domain, domainKey),
          eq(schema.assessmentItems.standardId, project.standardId),
          extOr ? extOr : undefined as any,
        ),
        orderBy: schema.assessmentItems.sortOrder,
      });
      if (items.length === 0) continue;

      const sortedItems = [...items.filter(i => i.extensionType === 'general'), ...items.filter(i => i.extensionType !== 'general')];

      // --- 全局层面 sheet ---
      const ws = workbook.addWorksheet(sheetName.substring(0, 31));
      ws.columns = [
        { key: 'seq', width: 7 },
        { key: 'controlPoint', width: 20 },
        { key: 'requirement', width: 50 },
        { key: 'result', width: 80 },
        { key: 'compliance', width: 12 },
        { key: 'evidence', width: 25 },
      ];
      const header = ws.addRow(['序号', '控制点', '控制项', '结果记录', '符合情况', '证据文件']);
      header.eachCell((cell) => {
        styleCell(cell, { bold: true, fontSize: 12, fontColor: 'FFFFFFFF', bgColor: 'FF409EFF', alignH: 'center', alignV: 'middle', border: 'medium' });
      });
      header.height = 28;

      let seq = 0;
      let dataRowIdx = 0;
      for (const extGroup of activeExtGroups) {
        const extItems = sortedItems.filter(i => i.extensionType === extGroup.key);
        if (extItems.length === 0) continue;

        const extRow = ws.addRow([extGroup.label, '', '', '', '', '']);
        ws.mergeCells(`A${extRow.number}:F${extRow.number}`);
        extRow.eachCell((cell) => {
          styleCell(cell, { bold: true, fontSize: 11, fontColor: 'FF2E7D32', bgColor: 'FFE8F5E9', alignH: 'center', alignV: 'middle', border: 'thin' });
        });
        extRow.height = 22;

        for (const item of extItems) {
          seq++;
          const row = ws.addRow([seq, item.controlPoint, item.requirement, '', '', '']);
          const isZebra = dataRowIdx % 2 === 1;
          row.eachCell((cell, colNumber) => {
            styleCell(cell, {
              bgColor: isZebra ? 'FFF7F9FC' : undefined,
              alignH: colNumber === 1 ? 'center' : 'left',
              alignV: 'middle',
              border: 'thin',
            });
          });
          row.height = 22;
          dataRowIdx++;
        }
      }

      // --- 按资产生成 sheet ---
      const domainCats = Object.entries(CATEGORY_TO_DOMAIN).filter(([, d]) => d === domainKey).map(([c]) => c);
      const domainAssets = allAssets.filter(a => domainCats.includes(a.category));
      for (const asset of domainAssets) {
        const assetSheetName = sanitizeSheetName(`${sheetName}_${asset.name}`.substring(0, 31));
        // 避免重名
        if (workbook.worksheets.some(w => w.name === assetSheetName)) continue;
        const aws = workbook.addWorksheet(assetSheetName);
        aws.columns = ws.columns;
        const ah = aws.addRow(['序号', '控制点', '控制项', '结果记录', '符合情况', '证据文件']);
        ah.eachCell((cell) => {
          styleCell(cell, { bold: true, fontSize: 12, fontColor: 'FFFFFFFF', bgColor: 'FF409EFF', alignH: 'center', alignV: 'middle', border: 'medium' });
        });
        ah.height = 28;

        let aseq = 0;
        let adRowIdx = 0;
        for (const extGroup of activeExtGroups) {
          const extItems = sortedItems.filter(i => i.extensionType === extGroup.key);
          if (extItems.length === 0) continue;
          const extRow = aws.addRow([extGroup.label, '', '', '', '', '']);
          aws.mergeCells(`A${extRow.number}:F${extRow.number}`);
          extRow.eachCell((cell) => {
            styleCell(cell, { bold: true, fontSize: 11, fontColor: 'FF2E7D32', bgColor: 'FFE8F5E9', alignH: 'center', alignV: 'middle', border: 'thin' });
          });
          extRow.height = 22;
          for (const item of extItems) {
            aseq++;
            const row = aws.addRow([aseq, item.controlPoint, item.requirement, '', '', '']);
            const isZebra = adRowIdx % 2 === 1;
            row.eachCell((cell, colNumber) => {
              styleCell(cell, {
                bgColor: isZebra ? 'FFF7F9FC' : undefined,
                alignH: colNumber === 1 ? 'center' : 'left',
                alignV: 'middle',
                border: 'thin',
              });
            });
            row.height = 22;
            adRowIdx++;
          }
        }
      }
    }

    if (workbook.worksheets.length === 0) {
      return { success: false, error: { message: '没有可用的测评项数据' } };
    }

    const timestamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const result = await dialog.showSaveDialog({
      title: '保存导入模板',
      defaultPath: `现场核查导入模板_${project.name || '项目'}_${timestamp}.xlsx`,
      filters: [{ name: 'Excel 文件', extensions: ['xlsx'] }],
    });
    if (result.canceled || !result.filePath) return { success: false, error: { message: '用户取消' } };

    await workbook.xlsx.writeFile(result.filePath);
    return { success: true, data: result.filePath };
  } catch (error: any) {
    log.error('生成测评导入模板失败:', error);
    return { success: false, error: { message: error.message || '生成模板失败' } };
  }
})
```

- [ ] **Step 2: 需要时在文件顶部是否已经有 `styleCell` 引用**

确认 `import { styleCell, getRowMaxHeight } from '../utils/excel-helper'` 已在文件顶部存在（已在第12行）。无需新增。

确认 `import { sanitizeSheetName } from '../utils/excel-config'` 需要添加到顶部。当前 `excel-config.ts` 已有该函数。

- [ ] **Step 3: 添加 sanitizeSheetName 导入**

修改 `electron/ipc/assessment.ipc.ts` 文件顶部，添加一行：

```typescript
import { sanitizeSheetName } from '../utils/excel-config';
```

紧接在 `import { styleCell, getRowMaxHeight } from '../utils/excel-helper'` 之后。

---

## Task 2: 增强 assessment:importExcel — 支持资产 sheet 识别

**Files:**
- Modify: `electron/ipc/assessment.ipc.ts:1038`

- [ ] **Step 1: 在导入循环前增加资产名称解析逻辑**

在 `for (const sheetName of workbook.SheetNames) {` 这行的 `const domainKey = SHEET_TO_DOMAIN[sheetName];` 之后，查找资产名称：

```typescript
        const domainKey = SHEET_TO_DOMAIN[sheetName];
        if (!domainKey) continue;

        // 解析资产名称（格式：层面名称_资产名称）
        let assetId: string | null = null;
        const domainInfo = DOMAIN_SHEETS.find(d => d.domain === domainKey);
        if (domainInfo) {
          const prefix = domainInfo.sheetName + '_';
          if (sheetName.startsWith(prefix)) {
            const assetName = sheetName.substring(prefix.length).trim();
            const asset = await db.query.assets.findFirst({
              where: and(
                eq(schema.assets.projectId, projectId),
                eq(schema.assets.name, assetName)
              ),
            });
            if (asset) {
              assetId = asset.id;
            } else {
              // 模糊匹配
              const fuzzyAssets = await db.query.assets.findMany({
                where: and(
                  eq(schema.assets.projectId, projectId),
                  like(schema.assets.name, `%${assetName}%`)
                ),
                limit: 1,
              });
              if (fuzzyAssets.length > 0) {
                assetId = fuzzyAssets[0].id;
              }
            }
          }
        }
```

- [ ] **Step 2: 在 recordData 构建中加入 assetId**

修改 `const recordData = { ... }` 部分（约第1088-1098行），在 `projectId,` 之后添加 `assetId,`：

```typescript
          const recordData = {
            projectId,
            assetId,
            itemId: item.id,
            result: resultValue,
            method: 'check',
            commandOutput: '',
            evidence: resultRecord,
            findings: resultRecord,
            assessor: '',
            assessmentDate: now,
          };
```

- [ ] **Step 3: 需要在文件顶部引入 `like`**

确认 `import { eq, and, desc, count, sql, inArray, lte, or } from 'drizzle-orm'` 改为包含 `like`：

```typescript
import { eq, and, desc, count, sql, inArray, lte, or, like } from 'drizzle-orm';
```

---

## Task 3: 暴露 downloadTemplate 到 preload

**Files:**
- Modify: `electron/preload/index.ts:82-88`

- [ ] **Step 1: 在 assessment.bridge 中添加 downloadTemplate**

在现有的 `importExcel:` 行之后添加：

```typescript
    downloadTemplate: (projectId) =>
      ipcRenderer.invoke('assessment:downloadTemplate', projectId),
```

确保 `importExcel:` 行末尾的逗号正确。

---

## Task 4: 在前端 onsite-verification/index.vue 添加按钮和事件

**Files:**
- Modify: `src/views/onsite-verification/index.vue`

- [ ] **Step 1: 在 toolbar-center 区域（同步问题按钮旁）增加两个按钮**

在 `[Omitted long matching line]` 中找到同步问题按钮 `@click="syncIssues"` 之后，保存按钮之前，添加：

```html
        <el-dropdown @command="handleImportCommand">
          <el-button class="toolbar-btn">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            <span>导入/导出</span>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="6 9 12 15 18 9"/></svg>
          </el-button>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item command="downloadTemplate">下载导入模板</el-dropdown-item>
              <el-dropdown-item command="importExcel">导入测评结果</el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
```

（该位置应在 `@click="syncIssues"` 按钮之后、`triggerManualSave` 按钮之前）

- [ ] **Step 2: 添加导入/导出命令处理函数**

在 `confirmExport` 函数之后添加：

```typescript
// 导入/导出下拉菜单命令处理
async function handleImportCommand(command: string) {
  if (command === 'downloadTemplate') {
    await handleDownloadTemplate();
  } else if (command === 'importExcel') {
    await handleImportExcel();
  }
}

// 下载导入模板
async function handleDownloadTemplate() {
  const projectId = route.params.id as string;
  if (!projectId || !window.api) return;
  const res = await window.api.assessment.downloadTemplate(projectId);
  if (res.success && res.data) {
    ElMessage.success(`模板已保存到: ${res.data}`);
  } else if (res.error?.message !== '用户取消') {
    ElMessage.error(res.error?.message || '下载模板失败');
  }
}

// 导入测评结果
async function handleImportExcel() {
  const projectId = route.params.id as string;
  if (!projectId || !window.api) return;
  const fileRes = await window.api.system.selectFile([
    { name: 'Excel文件', extensions: ['xlsx', 'xls'] },
  ]);
  if (!fileRes) return;
  const res = await window.api.assessment.importExcel(projectId, fileRes);
  if (res.success && res.data) {
    ElMessage.success(`成功导入 ${res.data.count} 条记录`);
    await loadData();
  } else {
    ElMessage.error(res.error?.message || '导入失败');
  }
}
```

注意：`loadData()` 是页面主数据加载函数（已存在）。如果没有该函数，替换为 `location.reload()` 或合适的数据刷新逻辑。

---

## Task 5: 前端 TypeScript 类型定义更新

**Files:**
- Modify: `shared/types.ts`（如有 ApiBridge 类型定义）

- [ ] **Step 1: 确认 assessment 类型是否包含 downloadTemplate**

打开 `shared/types.ts` 找到 `ApiBridge` 类型。如果没有针对 `downloadTemplate` 的类型，在 assessment 接口中增加：

```typescript
downloadTemplate: (projectId: string) => Promise<IpcResponse<string>>;
```

如果该文件中 ApiBridge 采用了泛型推断模式（如 `type ApiBridge = { assessment: { ... } }`），则继续使用 `typeof` 类型推导。

---

## 验证步骤

1. 运行 `npx vue-tsc --noEmit` 确保无类型错误
2. `npm run dev` 启动开发版
3. 进入现场核查页面，应出现「导入/导出」下拉按钮
4. 点击「下载导入模板」→ 选择保存位置 → 验证 Excel 文件结构和内容
5. 在模板中填写几行「结果记录」和「符合情况」
6. 点击「导入测评结果」→ 选择刚填好的文件 → 验证 `assessmentRecords` 表记录正确插入
7. 验证资产 sheet 导入的记录包含正确的 assetId

---

## 注意事项

- `sanitizeSheetName` 从 `excel-config.ts` 导入，已处理特殊字符和 31 字符限制
- 模板资产 sheet 使用 `substring(0, 31)` 确保 sheet 名不超过 Excel 31 字符限制
- 模板会跳过已存在的资产 sheet 名称（资产名相同时通过 `workbook.worksheets.some` 去重）
- 导入时如资产名未精确匹配，尝试模糊匹配（`LIKE %name%`）
- `downloadTemplate` 返回类型与 `asset:downloadTemplate` 保持一致（`IpcResponse<string>`）
