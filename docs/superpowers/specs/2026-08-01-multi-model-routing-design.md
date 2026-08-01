# 多模型管理与任务路由设计方案 v1.0

> 日期：2026-08-01
> 适用范围：JSecProbe v2.1.7+
> 状态：待用户审阅 → 待实现

---

## 1. 需求背景

当前 AI 设置只能配置**单一云端模型 + 单一本地模型**，通过 `mode` 开关二选一。实际使用中存在以下痛点：

1. **批量 vs 单条质量差异**：批量截图分析（量大、全自动）希望用高质量大模型保证准确度；单条高风险项（人工审核辅助）用适中模型节省时间/成本。当前无法区分。
2. **模型故障容灾**：一个供应商 API 挂了整个 AI 功能不可用，无法自动切换到备用模型。
3. **多模态筛选**：带 OCR 图片的任务如果误用了纯文本模型，会调用失败或返回无效结果。当前靠用户自己记得切换。
4. **多供应商混用**：硅基流动 + DeepSeek + 阿里百炼各有各的 API Key 和 Base URL，切换时要手动改全局配置。
5. **推荐模型管理**：Ollama 已安装的模型无法快速加入「可用模型列表」，必须在下拉框里重新选择。

---

## 2. 设计原则

| 原则 | 说明 |
|------|------|
| **向后兼容** | 零配置、旧配置升级后默认行为不变（每个任务类型默认只有一个模型 = 原来的单一 model/ollamaModel），用户不打开新 Tab 完全感觉不到变化。 |
| **失败静默切换** | 候选第一个模型调用失败 → 自动尝试第二个、第三个… 全部失败才抛错，前端不需要感知重试过程。 |
| **按模式独立管理** | 保留现有 `cloud / local` 模式切换。云端模型池、本地模型池、云端任务路由、本地任务路由，**全部 4 份配置独立**。 |
| **元数据显式声明** | supports_vision（支持多模态）不是靠模型名硬编码猜，而是用户添加时显式勾选。 |
| **不新增第三方依赖** | 拖拽排序用项目已有的 Vue Draggable Plus。 |

---

## 3. 数据库设计

### 3.1 新增表 `ai_models` — 模型池

```typescript
export const aiModels = sqliteTable('ai_models', {
  id: text('id').primaryKey(),                                  // UUID
  mode: text('mode').notNull(),                                 // 'cloud' | 'local'
  name: text('name').notNull(),                                 // 模型名 e.g. sensenova-6.7-flash-lite
  label: text('label'),                                          // 显示名 e.g.「星闪大模型 Flash Lite」
  api_key: text('api_key'),                                     // 云端专属：独立API Key（留空=用全局ai_configs.apiKey）
  api_base: text('api_base'),                                   // 云端专属：独立API Base（留空=用全局ai_configs.apiBase）
  supports_vision: integer('supports_vision').notNull().default(0), // 0/1 是否支持图片多模态
  is_default: integer('is_default').notNull().default(0),       // 0/1 该模式的兜底默认模型
  enabled: integer('enabled').notNull().default(1),             // 0/1 是否启用
  sort_order: integer('sort_order').notNull().default(0),       // 显示顺序
  created_at: text('created_at').notNull(),
  updated_at: text('updated_at').notNull(),
});
```

**索引**：`(mode, enabled)` 组合索引用于路由时快速过滤。

**约束**：同一个 `mode` 下最多 1 条 `is_default = 1`。

---

### 3.2 新增表 `ai_task_routes` — 任务路由

```typescript
export const aiTaskRoutes = sqliteTable('ai_task_routes', {
  id: text('id').primaryKey(),                                    // UUID
  mode: text('mode').notNull(),                                   // 'cloud' | 'local'
  task_type: text('task_type').notNull(),                        // 5 种枚举之一
  model_ids_json: text('model_ids_json').notNull(),              // JSON 数组 e.g. ["uuid1","uuid2"]
  created_at: text('created_at').notNull(),
  updated_at: text('updated_at').notNull(),
});
```

**唯一约束**：`(mode, task_type)` 组合唯一。

**5 种 task_type 枚举**：

| 枚举值 | 对应场景 | 调用函数 | 是否必须 supports_vision |
|--------|----------|----------|--------------------------|
| `chat` | AI 智能辅助对话 | `ai:chat` | 否 |
| `assessment_single` | 现场核查页单行测评项分析 | `ai:analyzeAssessment` | 视参数 screenshots 是否非空而定 |
| `assessment_batch` | 现场核查页批量截图分析 | `ai:batchAnalyzeScreenshots` | 是（强制筛选） |
| `issue_single` | 问题库页单条问题建议 | `ai:analyzeIssue`、`ai:analyzeIssueDescription` | 否 |
| `issue_batch` | 问题库页批量问题建议 | `ai:batchAnalyzeIssues` | 否 |

**注**：`assessment_single` 高风险项（is_high_risk = 1）本期**不做差异化处理**，与普通单条共用同一候选列表。后续如需区分时在 `ai_models` 加 `size_tier` 字段即可。

---

### 3.3 旧表 `ai_configs` 不变

原字段 `model`、`ollamaModel`、`apiKey`、`apiBase`、`mode` 全部保留。升级迁移时把其中的值复制到 `ai_models` 作为 is_default=1 的条目。

---

## 4. 数据迁移方案

### 4.1 迁移触发

在 `electron/db/migrate.ts` 中新增一段：如果 `ai_models` / `ai_task_routes` 表不存在 → 创建表 → 执行初始填充。

### 4.2 初始填充逻辑

```
步骤1：读取现有 ai_configs（id='default'）
       model = 现有配置.model（默认 'gpt-4o-mini'）
       ollamaModel = 现有配置.ollamaModel（可能 null）

步骤2：INSERT ai_models（云端）
       name = model, mode = 'cloud', is_default = 1, enabled = 1

步骤3：如果 ollamaModel 不为 null
         INSERT ai_models（本地）
         name = ollamaModel, mode = 'local', is_default = 1, enabled = 1

步骤4：从 RECOMMENDED_MODELS（ollama.service.ts 里的 4 个推荐）
       批量 INSERT ai_models 本地记录
       mode = 'local', enabled = 0, is_default = 0
       （默认关闭，用户在模型池 Tab 勾选启用）

步骤5：为 5 个 task_type × 2 个 mode = 10 条
         INSERT ai_task_routes
         model_ids_json = [步骤2/3 中 is_default=1 那个模型的 id]
```

### 4.3 首次安装（无旧配置）

```
ai_models:
  - 云端预置 2 条（sensenova-6.7-flash-lite + deepseek-chat，enabled=0）
  - 本地预置 RECOMMENDED_MODELS 4 条（enabled=0）
ai_task_routes: 10 条，model_ids_json = []（空 = 自动兜底走旧逻辑）
```

---

## 5. 后端路由逻辑

### 5.1 新增函数 `resolveModelForTask()`

**位置**：`electron/ipc/ai.ipc.ts`

**输入**：
```typescript
{
  taskType: 'chat' | 'assessment_single' | 'assessment_batch' | 'issue_single' | 'issue_batch',
  hasImage: boolean,          // 该次调用是否含图片/截图
  config: AiConfig,           // 当前 ai_configs（含 mode）
}
```

**处理流程**：
```
1. SELECT * FROM ai_task_routes
   WHERE mode = config.mode AND task_type = $taskType
   → 取得 model_ids_json 数组

2. 如果数组非空 → SELECT * FROM ai_models WHERE id IN (...)
   过滤条件：
     a. enabled = 1
     b. mode = config.mode
     c. hasImage = true 或 taskType = assessment_batch → 强制 supports_vision = 1
   → 按 model_ids_json 中原始顺序排序，输出 candidates[]

3. 如果 candidates[] 为空 → 兜底：
     SELECT * FROM ai_models
     WHERE mode = config.mode AND enabled = 1 AND is_default = 1
     LIMIT 1
   → 作为 candidates[]

4. 如果还是空 → 终极兜底：
     用旧 getEffectiveModel(params, config) 返回单一模型
     组装成 candidates[]（只有一条）

5. 返回 candidates[]（按优先级排序的数组，每个元素含 name、apiKey、apiBase、supportsVision）
```

---

### 5.2 AI 调用点改造（5 处）

改造前（示意）：
```typescript
const model = getEffectiveModel(params, config);
const result = await callOpenAI(model, params);
return result;
```

改造后：
```typescript
const hasImage = (params.screenshots && params.screenshots.length > 0)
              || (params.documents && ...); // 每个调用点略有不同
const candidates = await resolveModelForTask(taskType, hasImage, config);

let lastError: Error | null = null;
for (const model of candidates) {
  try {
    // 用该模型的独立 apiKey / apiBase（如果有），否则用全局
    const effectiveKey = model.apiKey || config.apiKey;
    const effectiveBase = model.apiBase || getEffectiveApiBase(config);
    const result = await callOpenAI(model.name, { ...params, apiKey: effectiveKey, apiBase: effectiveBase });
    if (candidates.length > 1) {
      log.info(`[模型路由] 任务 ${taskType} 命中模型 ${model.name}（候选 ${candidates.length} 个）`);
    }
    return result;
  } catch (err) {
    lastError = err;
    log.warn(`[模型路由] 模型 ${model.name} 失败，尝试下一个:`, err.message);
    continue;
  }
}
log.error(`[模型路由] 所有候选模型均失败，共 ${candidates.length} 个`);
throw lastError || new Error('没有可用的模型，请检查模型池配置');
```

**5 个改造点**：
1. `ai:chat` → `taskType = 'chat'`
2. `ai:analyzeAssessment` → `taskType = 'assessment_single'`，`hasImage = screenshots?.length > 0`
3. `ai:batchAnalyzeScreenshots` → `taskType = 'assessment_batch'`，`hasImage = true`（强制筛选多模态）
4. `ai:analyzeIssue` + `ai:analyzeIssueDescription` → `taskType = 'issue_single'`
5. `ai:batchAnalyzeIssues` → `taskType = 'issue_batch'`

---

## 6. 前端 UI 改造

**位置**：`src/views/ai-assistant/index.vue`

现有 AI 设置页面结构不变，在「推荐模型列表」下方新增**两个 Tab 卡片**。

---

### 6.1 Tab1：模型池管理（Model Pool）

顶部有「云端模型池 / 本地模型池」子 Tab 切换。

**操作区**：
- `[+ 添加自定义模型]` 按钮 → 弹出表单：
  - 云端：模型名(input)、显示名(input)、支持图片?(switch)、独立API Key(input, 选填)、独立API Base(input, 选填)
  - 本地：模型名(**select + input 组合**，下拉列出 ollama已安装模型；也可手动输入任意字符串)、显示名(input)、支持图片?(switch，默认按推荐库中对应项的 supportsVision 自动预填)
- `[从推荐列表快速添加]` 按钮 → 多选对话框，勾选 RECOMMENDED_MODELS 中 4 个，批量写入本地 ai_models（enabled=1）

**模型表格**（Excel 行内编辑风格，遵循项目现有约定）：

| 启用 (el-switch) | 显示名 (el-input 行内) | 模型名 (el-input 行内) | 支持图片 (图标✅/❌) | 独立Key/Base (图标) | 兜底 (radio) | 操作 (删除按钮) |
|---|---|---|---|---|---|---|
| ✓ | 星闪 Flash Lite | sensenova-6.7-flash-lite | ❌ | ❌ 未设置 | ● | 🗑️ |

- 表头 sticky 定位（遵循项目硬约束）
- 任意单元格修改 → 触发修改检测，底部保存按钮亮起（符合项目"所有输入组件必须触发保存检测"规范）
- 兜底 radio：同 mode 内互斥，选中即写 `is_default = 1`

---

### 6.2 Tab2：任务路由配置（Task Routes）

顶部同样有「云端路由 / 本地路由」子 Tab 切换。

下方排列 5 张卡片，每张对应一个 task_type：

```
┌─ 🤖 AI 对话 ──────────────────────────────────────────┐
│  候选模型优先级（拖拽调整顺序）                          │
│ ┌──────────────────────────────────────────────────┐  │
│ │ 1  ☰  sensenova-6.7-flash-lite  [显示名]    🗑️ │  │
│ │ 2  ☰  deepseek-chat                [显示名]    🗑️ │  │
│ │ 3  ☰  qwen3-vl:8b                  [显示名]    🗑️ │  │
│ └──────────────────────────────────────────────────┘  │
│ [+ 添加候选模型]                                       │
└───────────────────────────────────────────────────────┘
```

**卡片细节**：
- 卡片标题右侧标注：「含图时自动过滤」或「仅显示支持图片模型」（对 `assessment_single` 和 `assessment_batch`）
- 拖拽排序：使用 Vue Draggable Plus（项目已有组件），拖拽手柄 `☰`
- 点击 `[+ 添加候选模型]` → 弹出多选对话框：
  - 列出当前 mode 下所有 enabled=1 的 ai_models
  - 对 `assessment_batch` → **只列 supports_vision = 1 的**，其余灰色禁用并 tooltip 提示「该任务必须使用支持图片的多模态模型」
  - 已在候选列表中的模型 → 复选框勾上且禁用（不重复添加）
- 每条候选右侧「删除」按钮 → 从列表移除（不删除 ai_models 本身）

---

### 6.3 保存策略

两个 Tab 共享一个保存按钮。修改检测：
- 模型池 Tab：行内编辑任意单元格、增删模型 → modified = true
- 路由 Tab：拖拽排序、增删候选 → modified = true
- 保存按钮统一走一个 `ai:savePoolAndRoutes` IPC，一次提交所有变更（避免竞态）。

---

## 7. IPC 接口变更

**位置**：`shared/types.ts` + `electron/preload/index.ts` + `electron/main/ipc.ts` + `electron/ipc/ai.ipc.ts`

### 7.1 新增接口

| 接口名 | 入参 | 返回 | 说明 |
|--------|------|------|------|
| `ai:getModels` | `{ mode?: 'cloud'\|'local' }` | `AiModel[]` | 查询模型池列表 |
| `ai:saveModels` | `{ mode, create: AiModel[], update: AiModel[], delete: string[] }` | `void` | 批量增改删 ai_models（一个事务） |
| `ai:getRoutes` | `{ mode?: 'cloud'\|'local' }` | `{ [taskType]: string[] }` | 查询每个任务类型的候选模型ID数组 |
| `ai:saveRoutes` | `{ mode, routes: { [taskType]: string[] } }` | `void` | 批量 upsert 5 条 ai_task_routes |
| `ai:setDefaultModel` | `{ mode, modelId }` | `void` | 把同 mode 下所有其他模型 is_default=0，该模型=1 |

### 7.2 现有接口改造

`ai:chat`、`ai:analyzeAssessment`、`ai:batchAnalyzeScreenshots`、`ai:analyzeIssue`、`ai:analyzeIssueDescription`、`ai:batchAnalyzeIssues` **接口签名不变**，内部走 `resolveModelForTask()` + for 循环重试。

---

## 8. 错误处理 & 日志

### 8.1 路由失败日志

```
[模型路由] 任务 assessment_batch：候选 3 个，已过滤非多模态 1 个
[模型路由] 模型 qcwind/qwen3-vl-8B-Q4_K_M 失败：连接超时，尝试下一个
[模型路由] 模型 qwen2.5vl:7b 成功，返回结果
```

- 每次模型切换都用 `log.warn` 记录
- 全部失败用 `log.error`，提示用户去「任务路由配置」检查候选列表

### 8.2 前端错误提示

- 单个模型失败 → 用户无感知（后端静默切）
- 全部模型失败 → 前端显示统一错误消息：
  ```
  AI 调用失败：所有候选模型均不可用（共 N 个）。
  请前往 AI 设置 → 任务路由配置，检查候选模型是否启用或增加备用模型。
  ```

### 8.3 网络/超时保护

- 每个模型尝试独立拥有超时控制（沿用现有 AbortController 15s/30min 机制）
- 一个模型超时不影响后续候选

---

## 9. TypeScript 类型定义

```typescript
// shared/types.ts 新增

export type TaskType = 'chat' | 'assessment_single' | 'assessment_batch' | 'issue_single' | 'issue_batch';

export interface AiModel {
  id: string;
  mode: 'cloud' | 'local';
  name: string;
  label: string | null;
  apiKey?: string | null;     // 云端专属
  apiBase?: string | null;    // 云端专属
  supportsVision: 0 | 1;
  isDefault: 0 | 1;
  enabled: 0 | 1;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface AiTaskRoute {
  id: string;
  mode: 'cloud' | 'local';
  taskType: TaskType;
  modelIds: string[];         // 解析 model_ids_json 后
  createdAt: string;
  updatedAt: string;
}

// ApiBridge.ai 扩展
saveModels: (payload: {
  mode: 'cloud' | 'local';
  create: Omit<AiModel, 'id' | 'createdAt' | 'updatedAt'>[];
  update: Partial<AiModel> & { id: string }[];
  delete: string[];
}) => Promise<IpcResponse<void>>;

getModels: (filter?: { mode?: 'cloud' | 'local' }) => Promise<IpcResponse<AiModel[]>>;

getRoutes: (filter?: { mode?: 'cloud' | 'local' }) => Promise<IpcResponse<Record<TaskType, string[]>>>;

saveRoutes: (payload: {
  mode: 'cloud' | 'local';
  routes: Record<TaskType, string[]>;
}) => Promise<IpcResponse<void>>;

setDefaultModel: (payload: {
  mode: 'cloud' | 'local';
  modelId: string;
}) => Promise<IpcResponse<void>>;
```

---

## 10. 实现顺序（建议）

| 阶段 | 子任务 | 优先级 | 预计文件 |
|------|--------|--------|----------|
| 1 | DB schema + 类型定义 | P0 | schema.ts、shared/types.ts |
| 2 | 迁移 & 初始填充逻辑 | P0 | migrate.ts、ai.ipc.ts 内迁移块 |
| 3 | IPC 新接口（get/save Models & Routes） | P0 | ai.ipc.ts、preload/index.ts、shared/types.ts |
| 4 | resolveModelForTask() + 5 处调用点改造 | P0 | ai.ipc.ts |
| 5 | 前端 Tab1 模型池 UI | P1 | index.vue |
| 6 | 前端 Tab2 任务路由 UI + 拖拽排序 | P1 | index.vue |
| 7 | 前端失败统一错误提示优化 | P2 | index.vue、useAiAnalysis.ts、issue-ai-analysis.vue |
| 8 | 单元测试 & 手工验证 | P2 | 测试文档 |

---

## 11. 非目标（本期不做）

| 项 | 原因 |
|----|------|
| 自动评分（效果分+速度分加权选最优） | 效果好坏无法自动量化，硬做反而误选。改为用户手动排序优先级更可控。 |
| 高风险单条模型差异化（size_tier） | 用户反馈先不做，后续有真实场景再加字段。 |
| 模型调用成本统计 / token 计费展示 | 本期容灾 + 任务匹配为主，计费统计后续单独规划。 |
| 跨 cloud/local 统一模型池 | 用户明确要求保留模式切换，分开管理更清晰。 |
| 模型基准测试自动排序 | 需构造标准评测集，复杂度高，暂不做。 |

---

## 12. 风险清单

| 风险 | 缓解措施 |
|------|----------|
| 批量分析切模型时上下文 token 丢失 | 每次重试都传入完整相同的 params，不做增量拼接。 |
| 模型循环重试耗尽 API 额度 | 最大候选数建议 3-5 个，前端 UI 添加候选时软提示但不强制限制。 |
| 本地 Ollama 没启动导致候选全部是本地模型时卡死 | resolveModelForTask 返回候选前，本地模型先做一次 `checkOllamaRunning()`，若未运行则剔出候选。 |
| 拖拽排序后数据不同步 | 前端存 draft routes，保存时一次性 push 到后端，不用 watch 实时写。 |
| 旧配置升级后用户看不到变化 | 兜底兼容确保无变化，如需使用新功能用户主动打开 Tab。 |

---

## 13. 验收标准

实现后手工验证以下用例：

1. ✅ 旧用户升级，不改任何配置 → 所有 AI 功能行为与升级前完全一致（模型名一致、结果一致）。
2. ✅ 添加 2 个云端模型 + 配置 assessment_single 候选为两者，第一个故意填错 Key → 自动切第二个成功。
3. ✅ assessment_batch 任务候选里误加了纯文本模型 → 路由时自动剔除。
4. ✅ 切换 cloud / local 模式 → 模型池列表、路由列表各自独立，互不影响。
5. ✅ 本地模式 Ollama 没启动 → 候选中的本地模型自动跳过，不阻塞。
6. ✅ 所有 TypeScript 类型检查 `npx vue-tsc --noEmit` 零错误。
7. ✅ 模型池 Excel 行内编辑、删除、排序、兜底 radio 交互正常。
8. ✅ 路由卡片拖拽排序、添加/删除候选交互正常，assessment_batch 多选框纯文本模型灰色禁用。
