# 设计文档：现场核查导入 Excel 时可视化选择 Sheet

- 日期：2026-09-08
- 状态：设计已获用户批准（方案 A），待实施
- 涉及页面：现场核查（onsite-verification）导入弹窗

## 1. 背景与问题

现状导入流程是「盲选」：

1. 前端弹窗展示**理论树**（props.treeData，来自项目数据库），用户勾选层面/资产（`domain:` / `asset:` 前缀语义）；
2. 用户选择 Excel 文件后，主进程 `assessment:importExcel`（assessment.ipc.ts L1362）**遍历工作簿全部 sheet**；
3. sheet 名按命名约定 `{层面名}_{全局层面|资产名}` 解析，**匹配不上的 sheet 静默跳过**（L1444 `continue`）；
4. 前端勾选仅作为后端过滤条件，用户无法知道文件里实际有哪些 sheet、哪些被导入、哪些被丢弃。

用户需求：导入时应先读取 Excel 文件，弹窗展示文件中**实际存在**的 sheet，由用户自定义勾选导入哪些——「看得见的导入」。

## 2. 方案（已确认：方案 A 替换式）

```
点击「导入」 → 选 Excel 文件 → 主进程解析 sheet 信息
  → 弹窗展示该文件实际的 sheet（树形，默认全选可导入项）
  → 用户勾选 → 确认 → 仅导入勾选的 sheet → 现有结果反馈
```

树形展示示意：

```
☑ 安全物理环境（层面）
   ☑ 全局层面            ← 该文件存在此 sheet
   ☑ Web服务器 (资产)     ← sheet 名匹配到资产
☐ 数据库服务器 (资产)      ← 用户可取消勾选
⚠ 未知Sheet1              ← 灰色禁用，标注「无法识别，将跳过」
```

- 勾选只决定「导入哪些 sheet」，旧 `domain:` / `asset:` 前缀勾选机制随本改造**整体移除**（导入部分；导出弹窗不动）；
- 无法识别的 sheet 灰色展示但**可见**——「不静默跳过」的落地；
- 全部不可导入时确认按钮禁用并提示；
- 弹窗打开前显示解析 loading；用户取消选文件则不开弹窗。

## 3. 关键事实（源码核实结论）

| 事实 | 位置 | 对设计的影响 |
|---|---|---|
| 导入侧 sheet 名→域映射是**动态**的：`loadProjectDomainSheets(projectId)` 优先取行标 `standards.domainsMeta` 自定义 sheetName，fallback 国标十域 `FALLBACK_DOMAIN_SHEETS` | assessment.ipc.ts L20-55、L1380-1383 | 共享解析函数必须基于该动态映射，**不能**硬编码十域，否则行标项目预览全部识别失败 |
| 解析规则：`sheetName.startsWith(层面名 + '_')` → 后缀 `全局层面` 为全局 sheet；否则为资产名 → 资产精确匹配 → LIKE 模糊兜底（limit 1，含 `%_\` 转义） | L1408-1443 | 共享函数需原样保留该行为（含 31 字符截断靠 LIKE 兜底兼容的现状） |
| **现状怪癖**：资产 sheet 的资产名匹配不上时 `assetId` 为 null，会被当作全局层面落库（`assetId=null`），用户无感知 | L1444-1467 | 设计决策见 §7 |
| `assessment:importExcel` 全项目唯一调用方是 import-export.vue L485 | 全仓 grep 确认 | 改签名无兼容负担；knowledge/asset/issue 的 `importExcel` 是独立 IPC，不受影响 |
| 类型声明在 shared/types.ts L514（assessment 命名空间） | shared/types.ts | 同步改签名 + 新增声明 |
| IPC 均在 assessment.ipc.ts 内 `ipcMain.handle` 注册 | L110 起 | 新增 handler 无需改 index.ts |

## 4. 后端设计

### 4.1 共享解析函数（assessment.ipc.ts 内新增，不新建文件）

```ts
interface ResolvedSheet {
  domainKey: string | null;   // 域 ID，null = 层面未识别
  domainName: string;         // 层面中文名（即匹配用的 sheetName 前缀）
  assetId: string | null;     // null = 全局层面 或 资产未匹配
  assetName: string | null;
  isGlobal: boolean;
}

async function resolveSheetName(
  sheetName: string,
  projectId: string,
  domainSheetMap: Record<string, string>  // 由 loadProjectDomainSheets 构建的 {层面中文名: 域ID}
): Promise<ResolvedSheet>
```

- 逻辑**原样搬移** L1408-1443（前缀匹配、`全局层面` 判断、资产精确+LIKE 查找、`break` 语义），唯一权威来源；
- `importExcel` 与新 IPC 均调用它，预览与导入行为**保证一致**（预览说能导的就一定能导）；
- 域映射在调用方**构建一次、循环复用**，避免逐 sheet 重复查询 standards 表。

### 4.2 新增 IPC：`assessment:getExcelSheetInfo`

**入参**：`projectId, filePath`
**返回**：

```ts
{
  ok: boolean; error?: string;
  sheets: Array<{
    sheetName: string;        // 原始 sheet 名
    domainKey: string | null; // 域 ID，null=未识别
    domainName: string;       // 层面中文名（未识别时回退 sheetName 原文）
    assetId: string | null;   // 匹配到的资产 id
    assetName: string | null;
    isGlobal: boolean;        // 是否「_全局层面」
    importable: boolean;      // domainKey 非空即可导入
    assetMatched: boolean;    // 资产 sheet 是否真的匹配上了资产
    rowCount: number;         // 数据行数估算（sheet_to_json(header:1).length-1，下限 0）
  }>
}
```

- 实现：校验文件存在 → `XLSX.readFile` → 构建 `loadProjectDomainSheets` 映射 → 逐 sheet 调 `resolveSheetName` + 统计 rowCount；
- rowCount 仅展示参考，不参与导入逻辑；
- 错误结构化返回：文件不存在 / 读取失败（损坏、加密）/ 项目不存在，`wrap` 包装统一错误通道。

### 4.3 `importExcel` 签名调整

```ts
// 旧
(projectId, filePath, domainIds?: string[], assetIds?: string[])
// 新
(projectId, filePath, sheetNames?: string[])   // 空/缺省 = 导入全部可识别 sheet
```

- 移除 `domainIds` / `assetIds` 及其过滤块（L1397-1399、L1446-1467）——旧机制整体退役；
- sheet 过滤**前置**到解析之前：`if (sheetNames?.length && !sheetNames.includes(name)) continue;`——未勾选的 sheet 连解析和资产查询都不发生，行为等价且更快；
- 对勾选的 sheet 调共享 `resolveSheetName`，其余解析（横幅跳过、B 列继承、中文结果映射、key=`域ID||assetId||控制点||控制项全文`）与落库 upsert 逻辑**零改动**。

## 5. 前端设计（import-export.vue）

- **状态替换**：删除 `importTreeData`（props 理论树浅拷贝）→ 新增 `importFilePath`、`importSheets`（IPC 返回列表）、`checkedSheetNames`（Set/数组）、`importAnalyzing`（loading）、`importParseError`；
- **handleImportExcel 重排**：`system.selectFile`（.xlsx/.xls 过滤）→ 置 loading → `getExcelSheetInfo` → 成功存状态并开弹窗 / 失败 `ElMessage.error` 不开弹窗；
- **弹窗树形渲染**（保持现有自研树形结构与样式类，复用导出弹窗已修复的深色模式变量体系）：
  - 第一层：按 `domainName` 分组（层面），头部带全选/全不选；未识别 sheet 归入底部「无法识别」分组，灰色禁用 + 原因标注；
  - 第二层：sheet 叶子，显示「全局层面」或资产名 + 行数；`assetMatched=false` 的资产 sheet 带警示标注（见 §7）；
- **confirmImport 重写**：收集勾选 sheetName → `importExcel(projectId, importFilePath, names)` → 沿用现有导入结果反馈；无勾选时确认按钮禁用，文案显示「导入 N 个表」；
- **重新选择文件**：弹窗内提供按钮，回到选文件步骤（同一弹窗刷新数据，不嵌套开关）。

## 6. 类型与 preload

- `shared/types.ts`：assessment 命名空间 `importExcel` 改为 `(projectId, filePath, sheetNames?: string[])`；新增 `getExcelSheetInfo` 声明及 `ExcelSheetInfo` 相关返回类型；
- `electron/preload/index.ts`：`getExcelSheetInfo: ipc('assessment:getExcelSheetInfo')`；`importExcel` 透传参数同步。

## 7. 边界与决策记录

| 场景 | 处理 | 理由 |
|---|---|---|
| 资产 sheet 匹配不上资产（现状怪癖：静默当全局层面落库） | 树上**可勾选** + 警示「未匹配到资产，将按全局层面导入」，落库行为与现状一致 | 禁用会丢数据；静默会误导；「可见的旧行为」优于两者 |
| 文件内无任何可识别 sheet | 弹窗提示「未找到可导入的表（需由本系统导出）」，确认禁用 | 明确引导 |
| 文件损坏/加密/非 xlsx | IPC 返回结构化错误，前端 ElMessage 提示，不开弹窗 | 主进程读文件统一兜底 |
| 后端收到不存在的 sheetNames | 前置过滤自然跳过（仅导入存在的） | 防御性 |
| 行标项目自定义 sheetName | 共享函数基于 `loadProjectDomainSheets` 动态映射 | 避免硬编码十域导致行标识别失败（自审修正点） |
| 导入中途失败 | 沿用现有错误反馈，不新增机制 | 最小改动 |

**不做**：落库 upsert 逻辑、Excel 导出端、单元格解析规则、导出弹窗的任何改动。

## 8. 实施步骤（同文件多修改严格串行）

1. `shared/types.ts`：类型声明（一次编辑完成：改 importExcel 签名 + 新增 getExcelSheetInfo/ExcelSheetInfo）；
2. `electron/ipc/assessment.ipc.ts`（三处串行编辑）：
   a. 新增 `resolveSheetName` 共享函数 + `getExcelSheetInfo` handler（放在 importExcel 之前）；
   b. importExcel 签名改为 sheetNames + 删除旧过滤变量与过滤块 + 解析循环改调共享函数；
3. `electron/preload/index.ts`：暴露 getExcelSheetInfo、importExcel 透传同步；
4. `src/views/onsite-verification/components/import-export.vue`：脚本状态与流程 → 模板树形 → 样式（复用变量）；
5. `npx vue-tsc --noEmit` 验证零错误。

## 9. 验证清单

- [ ] vue-tsc 零错误；
- [ ] 用本系统导出的真实 Excel：默认全选导入，结果与旧流程一致；
- [ ] 取消部分勾选：仅勾选的 sheet 落库；
- [ ] 含改名/未知 sheet 的文件：灰色可见、导入不报错、结果如实；
- [ ] 损坏/非 xlsx 文件：友好报错不崩溃；
- [ ] 深色模式下新弹窗显示正常（复用已修复的变量体系）。
