# 行标支持开发设计规格

> 日期：2026-08-21
> 状态：待实施
> 关联文档：[2026-08-14-dynamic-standard-library-design.md](./2026-08-14-dynamic-standard-library-design.md)
> 目的：在已抽象的多标准数据库模型基础上，补全行业标准（电力/金融/医疗等）的动态接入能力与行业特色适配。

---

## 一、背景与现状调研

### 1.1 已具备的抽象能力（无需改造）

| 层面 | 现状 | 说明 |
|------|------|------|
| `standards` 表 | 已存在 | `electron/db/schema.ts:79-90` — 字段含 `code`(唯一)、`grade`、`isDefault`，天然支持国标+行标共存 |
| `assessment_items` 表 | 标准无关 | `electron/db/schema.ts:92-108` — 通过 `standardId` 关联，控制点/要求等结构通用 |
| `projects.standardId` | 已绑定标准 | `electron/db/schema.ts:28` — 项目已可绑定具体标准 |
| `assessment_records` | 间接关联 | 通过 `itemId` 间接关联标准，无需改动 |
| 标准管理 IPC | 部分已实现 | `electron/ipc/standard.ipc.ts` — 已有 `list/getDomains/getItems/setDefault/remove` |
| 现场核查加载 | 已按 standardId | `src/views/onsite-verification/index.vue:643` — `getItems(standardId)` 已标准相关 |
| 进度/合规率计算 | 已按 standardId | `calcProjectProgress`（`project.ipc.ts:15-161`）、`assessment:getProgress`（`assessment.ipc.ts:213-411`）均用 standardId 查询，无硬编码 |
| AI 辅助配置 | 无标准硬编码 | `ai.ipc.ts:257-280` 未硬编码国标上下文（但需主动注入，见 8.5） |

### 1.2 仍存在的硬编码与缺口（需改造）

| 问题 | 位置 | 现状 |
|------|------|------|
| 标准选择硬编码 | `electron/ipc/project.ipc.ts:334` | `data.standardId \|\| (level===2 ? 'gb-t-22239-2019-l2' : 'gb-t-22239-2019-l3')` |
| 前端"标准体系"仅文本 | `src/views/projects/index.vue:64` | 固定下拉"新国标-正式版/试行版/旧国标"，未真正绑定 standardId |
| 缺标准导入/创建接口 | `electron/ipc/standard.ipc.ts` | 缺 `standard:import/create/update` |
| 项目级预置模板按 level 选 | `electron/ipc/project.ipc.ts:406-414` | 仅 `S2A2G2.xlsx`/`S3A3G3.xlsx`，无行标模板 |
| **资产级预置模板按 level 选** | `electron/ipc/asset.ipc.ts:128-130` | 同样硬编码 `S2A2G2/S3A3G3`，且 `domainKey='secure_computing'` 硬编码（行标可能无此域） |
| 标准管理域名字典硬编码 | `electron/ipc/standard.ipc.ts:34-45` | `DOMAIN_NAMES` 固定 10 个国标域 |
| **问题清单域映射硬编码** | `electron/ipc/issue.ipc.ts:13-25` | `DOMAIN_ID_TO_NAME` 固定国标 10 域 |
| **问题清单域排序硬编码** | `electron/ipc/issue.ipc.ts:114-132` | `DOMAIN_ORDER`/`ASSET_TYPE_ORDER` 固定 |
| **报告模板硬编码国标** | `electron/services/report.service.ts:766-850` | 报告正文硬编码 `GB/T 22239-2019` 与十个安全域名称；概况用 `project?.standardSystem \|\| 'GB/T 22239-2019'` fallback |
| 多处 fallback 国标 | `src/views/onsite-verification/index.vue:643,741,959` | `\|\| 'gb-t-22239-2019-l3'` 兜底 |
| **标准数据来源单一** | `electron/db/seeds/` | 仅国标种子 `standard-gbt22239.ts`、`standard-gbt22239-l2.ts` |
| **默认标准硬编码** | `electron/db/schema.ts:228`、`system_settings` | `defaultStandard: 'gb-t-22239-2019-l3'` 硬编码 |

### 1.3 与既有设计的关系

项目已有一份《动态标准库设计规格》（`2026-08-14-dynamic-standard-library-design.md`），它规划了**通用多标准管理**（含标准管理界面、import/create/update 接口、项目创建改用 standardId 必填），但**尚未实施**，且为泛化设计，**未针对"行标"的行业特色做适配**，也未覆盖报告/问题清单/资产级预置等下游依赖点的改造。本方案在其基础上专门补全"行标"维度，并补全下游依赖。

---

## 二、设计目标

1. **行标与国标共存**：同一套数据模型，电力/金融/医疗等行业标准可动态接入
2. **零打包接入**：用户通过界面导入 JSON 即可新增行标，无需重新打包发布
3. **行业特色域支持**：行标可在国标 10 域之外增加行业专属安全域（如电力调度自动化、金融支付安全）
4. **预置记录按标准加载**：项目级与资产级预置模板均按标准配套，不再仅按 level 选
5. **下游全链路动态化**：报告、问题清单、域渲染等下游环节均按项目标准动态渲染，不再硬编码国标
6. **行标-国标对照**（可选）：支持行标条款与国标条款的映射，便于交叉引用与报告生成
7. **完全向后兼容**：现有国标项目零影响，平滑升级

---

## 三、数据模型设计

### 3.1 `standards` 表扩展（新增 4 字段）

现有表保留不变，新增行业维度字段：

```sql
ALTER TABLE standards ADD COLUMN standard_type TEXT NOT NULL DEFAULT 'national';
-- national(国标) | industry(行标) | local(地标) | enterprise(企标)
ALTER TABLE standards ADD COLUMN industry TEXT DEFAULT '';
-- 电力/金融/医疗/电信/政务...（standard_type='industry' 时填）
ALTER TABLE standards ADD COLUMN source TEXT DEFAULT 'builtin';
-- builtin(内置) | imported(用户导入) | custom(手动创建)
ALTER TABLE standards ADD COLUMN preset_template TEXT DEFAULT '';
-- 该标准配套的预置模板相对路径，如 'presets/dl-t-36572-2018-l3/S3A3G3.xlsx'
```

### 3.2 新增"行标-国标对照关系表"（可选，Phase 3）

```sql
CREATE TABLE standard_mapping (
  id TEXT PRIMARY KEY,
  industry_standard_id TEXT NOT NULL,  -- 行标 ID
  national_item_id TEXT NOT NULL,      -- 国标 assessment_item ID
  industry_item_id TEXT NOT NULL,     -- 行标 assessment_item ID
  relation TEXT NOT NULL DEFAULT 'equivalent',  -- equivalent/extends/refines
  note TEXT,
  created_at TEXT NOT NULL
);
```

### 3.3 预置记录模板存储方案

**方案 A（推荐，Phase 1 采用）**：每标准一套 Excel 模板，放 `resources/standards/presets/{standardId}/`，路径记入 `standards.preset_template`。例如：
- `gb-t-22239-2019-l3` → `presets/gb-t-22239-2019-l3/S3A3G3.xlsx`（迁移现有）
- `dl-t-36572-2018-l3` → `presets/dl-t-36572-2018-l3/S3A3G3.xlsx`

**方案 B（Phase 2 后切换）**：预置记录直接写入标准 JSON（`domains[].items[].presetResult`），省去 Excel 依赖，统一格式。

### 3.4 迁移机制与版本控制（关键）

项目使用 drizzle-orm 迁移机制（`electron/db/index.ts:46-115`）：
- 迁移文件位于 `electron/db/migrations/`，由 `drizzle-kit generate:sqlite` 生成（`npm run db:generate`）
- 运行时 `migrate(db, { migrationsFolder })` 执行；失败回退到 `autoCreateTables()` 兼容建表
- `standards` 表加字段必须生成正式迁移文件（0001_xxx.sql），**不可裸 ALTER**，否则新装机环境无法建表
- 兼容建表语句 `electron/db/index.ts:192-203` 需同步新增 4 列

**标准数据版本控制**：`initStandardLibrary()`（`electron/db/index.ts:478`）用 `STANDARD_DATA_VERSION`（当前=7）判断是否需重导入国标。新增行标内置数据需：
- 提升 `STANDARD_DATA_VERSION` 至 8
- 在初始化逻辑中按 `standard_type='industry' AND code` 判断行标是否已存在，已存在则跳过，避免重复插入覆盖用户改动

---

## 四、标准数据格式与来源

### 4.1 两条数据路径（需澄清）

| 路径 | 来源 | 用途 | 加载方式 |
|------|------|------|----------|
| 内置标准 | `electron/db/seeds/standard-*.ts`（TS 种子） | 随安装包分发，启动时由 `initStandardLibrary()` 注入 | 版本检测，幂等加载 |
| 用户导入 | `resources/standards/*.json` 或用户本地文件 | 用户自行接入行标，通过 `standard:import` 接口 | 手动触发，一次性导入 |

> **修正说明**：现有国标内置数据来自 `seeds/standard-gbt22239.ts` 与 `seeds/standard-gbt22239-l2.ts`（TS 种子），`resources/standards/gb-t-22239-2019-l3.json` 仅作格式参考。行标内置需新增 `seeds/standard-dlt36572.ts` 等种子文件；用户导入则用 JSON 格式。

### 4.2 行标 JSON Schema（用户导入格式）

沿用 `resources/standards/gb-t-22239-2019-l3.json` 结构，新增 `standardType/industry` 元信息，并支持行业特色域：

```json
{
  "id": "dl-t-36572-2018-l3",
  "name": "DL/T 36572-2018 电力行业网络安全等级保护三级",
  "code": "DL/T 36572-2018-L3",
  "version": "2018",
  "standardType": "industry",
  "industry": "电力",
  "grade": 3,
  "description": "电力行业网络安全等级保护基本要求",
  "presetTemplate": "presets/dl-t-36572-2018-l3/S3A3G3.xlsx",
  "domains": [
    {
      "id": "secure_physical",
      "name": "安全物理环境",
      "icon": "OfficeBuilding",
      "domainType": "national",
      "sheetName": "安全物理环境",
      "items": [ ]
    },
    {
      "id": "power_dispatch",
      "name": "电力监控系统安全",
      "icon": "Lightning",
      "domainType": "industry",
      "sheetName": "电力监控系统安全",
      "items": [
        {
          "id": "pd-1.1",
          "controlPoint": "调度自动化系统边界防护",
          "controlName": "电力监控安全边界",
          "requirement": "电力监控系统与管理办法...",
          "minLevel": 3, "maxLevel": 4,
          "extensionType": "general",
          "isHighRisk": true,
          "sortOrder": 1
        }
      ]
    }
  ]
}
```

> 关键点：
> - `domainType: national|industry` 区分通用域与行业特色域，前端可选择性高亮行业域
> - `domains[].sheetName`（可选）用于预置 Excel 导入时的 sheet 映射，替代硬编码 `SHEET_TO_DOMAIN`
> - 测评项 `id` 必须全局唯一，行标用行业前缀（如 `pd-` 电力调度、`fin-` 金融）避免与国标 `sp-/sc-` 冲突

---

## 五、后端接口设计

### 5.1 补全标准管理 IPC（`electron/ipc/standard.ipc.ts`）

| 接口 | 参数 | 说明 | 状态 |
|------|------|------|------|
| `standard:import` | `{filePath}` 或 `{jsonData}` | 校验 JSON 结构 → 写 standards + assessment_items；按 `standardType` 标记来源 | **新增** |
| `standard:create` | `{name,code,version,grade,industry}` | 手动创建空标准，后续逐条添加测评项 | **新增** |
| `standard:update` | `{id,fields}` | 更新标准元信息（不含测评项，避免误删记录） | **新增** |
| `standard:export` | `standardId` | 导出为 JSON，便于备份/迁移 | **新增** |
| `standard:getDomains` | `standardId` | 返回值新增 `domainType` 与 `industry` 标注；域名优先从标准 JSON `domains[].name` 读取，硬编码字典仅 fallback | 改造 |
| `standard:getItems` | `standardId, domain?` | 已有，无需改 | 已有 |
| `standard:list` | — | 返回值新增 `standardType/industry/source` | 改造 |

`standard:import` 校验规则：
- 必须含 `id/name/code/version/grade/domains`
- `code` 唯一，已存在则报错或提示"覆盖/取消"
- 测评项 `controlPoint/requirement` 必填
- 校验失败返回明确的字段级错误

### 5.2 改造项目创建（`electron/ipc/project.ipc.ts:318`）

```ts
// 改造前：硬编码
const standardId = data.standardId || (level === 2 ? 'gb-t-22239-2019-l2' : 'gb-t-22239-2019-l3');

// 改造后：standardId 必填，前端必须选择标准
const standardId = data.standardId;
if (!standardId) throw new Error('请选择测评标准');
const standard = await db.query.standards.findFirst({ where: eq(schema.standards.id, standardId) });
if (!standard) throw new Error('所选标准不存在');

// 预置记录导入：改用标准配套模板，而非按 level 选
importPresetRecords(id, standardId).catch(...);  // 参数从 level 改为 standardId
```

### 5.3 改造项目级预置记录导入（`electron/ipc/project.ipc.ts:402-587`）

`importPresetRecords(projectId, standardId)` 改造要点：
- 模板路径从 `standards.preset_template` 字段读取，而非按 level 硬编码 `S2A2G2/S3A3G3`
- 查找路径前缀改为 `resources/standards/presets/{standardId}/`
- `SHEET_TO_DOMAIN` 字典改为**从标准的 domains 配置动态构建**（用 `domains[].sheetName` 映射）
- 测评项匹配逻辑（`domain||controlPoint||requirement`）保持不变——已是标准无关
- 未匹配项输出告警日志，不阻断流程（沿用现有容忍逻辑）

### 5.4 改造资产级预置记录导入（`electron/ipc/asset.ipc.ts:119-207`）

> **原方案遗漏，本次补充**。资产级预置当前同样按 level 选模板且硬编码域。

改造要点：
- `templateFileName` 从项目 `standard.preset_template` 读取（同 5.3）
- `domainKey = 'secure_computing'`（`asset.ipc.ts:169`）改为**从标准 domains 中 `domainType='national' AND id='secure_computing'` 动态获取**，或按资产类型映射到标准的对应域；行标若无 `secure_computing` 则用其等价计算环境域
- 查询测评项已用 `project.standardId`（好，无需改），仅 domainKey 需动态化

### 5.5 改造标准库初始化（`electron/db/index.ts:478 initStandardLibrary`）

> **原方案遗漏，本次补充**。该函数当前只加载国标。

改造要点：
1. 提升 `STANDARD_DATA_VERSION` 至 8（触发已装机用户重新初始化）
2. 抽出 `loadBuiltinStandard(seedModule)` 通用函数：按 `code` 判断是否已存在，已存在则跳过，否则插入 standards + assessment_items
3. 在 `initStandardLibrary()` 末尾循环加载 `seeds/` 下所有行标种子：
   ```ts
   const industrySeeds = [dlt36572Seed, jrt0068Seed, ...]; // 按 industry 排序
   for (const seed of industrySeeds) {
     await loadBuiltinStandard(seed);
   }
   ```
4. 行标种子 TS 文件结构对齐国标种子，增加 `standardType='industry'`、`industry` 字段

### 5.6 现场核查页 fallback 清理（`src/views/onsite-verification/index.vue`）

将 643/741/959 行的 `|| 'gb-t-22239-2019-l3'` 兜底改为：项目无 standardId 时抛错或提示重新选择标准，避免误用国标。

---

## 六、前端设计

### 6.1 标准库管理界面（扩展现有设置页标签页）

> **修正**：设置页**已有"标准库管理"标签页**（`src/views/settings/index.vue:329-375`，含列表/搜索/刷新/设默认/预置不可删），无需新增独立页面，在现有标签页扩展即可。

在现有标签页（`settings/index.vue` 的 `standards` tab）扩展功能：

1. **列表表格加列**：类型(国标/行标)、行业、来源(内置/导入) — 现有列缺这几项
2. **筛选加维度**：按类型（国标/行标）、行业（电力/金融/医疗）筛选 — 现有仅按名称/代号搜索
3. **导入按钮**（新增）：选择 JSON 文件 → 调 `standard:import` → 校验预览（显示将导入的域数/项数）→ 确认
4. **新建/编辑对话框**（新增）：手动维护标准元信息
5. **导出** / **删除**（新增，删除前检查 `projects.standardId` 引用）— 现有仅"设为默认"和"预置不可删"
6. **预置模板管理**（新增）：每个标准可上传/替换配套 Excel 预置模板

### 6.2 项目创建/编辑表单（`src/views/projects/index.vue`）

- 原"标准体系"文本下拉改为**标准库选择器**：
  - 选项 `GB/T 22239-2019 三级（393项）` / `DL/T 36572-2018 三级（电力）` 等
  - 数据来源：调 `standard:list`，按 `standardType` 分组
  - 支持搜索
  - 选中后展示标准描述与域分布概览
- 默认选中项从 `systemSettings.defaultStandard` 读取，而非硬编码
- `levelCombo/extensionType` 保留（部分行标沿用等保等级体系）
- 项目列表"标准体系"列改为显示实际标准名称

### 6.3 现场核查页动态域渲染（`src/views/onsite-verification/index.vue`）

- 域标签从 `standard:getDomains` 动态获取（已支持），不再依赖硬编码 `DOMAIN_NAMES`
- 行业特色域可加行业标识（如电力域加⚡图标）便于区分
- 域分组按 `domainType` 排序：通用域在前，行业域在后

---

## 七、行业特色处理

### 7.1 域字典动态化

将 `electron/ipc/standard.ipc.ts:34-45` 的 `DOMAIN_NAMES` 硬编码改为：优先从 `standards` 表关联的标准 JSON 的 `domains[].name/icon` 读取，硬编码字典仅作 fallback。同逻辑需应用到 `issue.ipc.ts:13-25` 的 `DOMAIN_ID_TO_NAME`（见 8.2）。

### 7.2 行业标识与配色

行标项目在 UI 各处加行业标签：项目卡片、现场核查页头、报告封面。可用行业色：电力=橙、金融=深蓝、医疗=青。

### 7.3 等级体系兼容

多数行标沿用等保 2.0 等级（2/3/4），现有 `minLevel/maxLevel` 字段够用。个别行业有额外分级（如金融 JR/T 档案级），通过 `extensionType` 或新增 `industryLevel` 字段扩展（Phase 3 评估）。

### 7.4 扩展类型扩展

现有 `extensionType` 取值：`general/cloud/mobile/iot/industrial/bigdata`。行标可能引入新扩展（如电力调度 `power_dispatch`、金融支付 `fintech`）。导入时按标准 JSON 原值存储，前端下拉选项动态从 `SELECT DISTINCT extension_type` 获取，不再硬编码。

---

## 八、其他依赖点改造（补充调研发现）

> 本节为补充调研后新增，覆盖原方案未涉及的下游硬编码依赖。

### 8.1 报告生成改造（`electron/services/report.service.ts`）

**问题**：报告正文（`report.service.ts:766-850`）硬编码 `GB/T 22239-2019` 与十个国标安全域名称；项目概况用 `project?.standardSystem || 'GB/T 22239-2019'` fallback。

**改造**：
- 报告生成入口 `generateReport()` 已按 `project.standardId` 查询测评统计（`gatherReportData`，好）
- 报告模板的"测评标准"行改为读取项目关联 `standards` 表的 `name/code`，删除 `|| 'GB/T 22239-2019'` fallback
- 报告正文中安全域名称列表改为调 `standard:getDomains(standardId)` 动态获取，按 `domainType` 分组（通用域 + 行业域）
- 报告封面增加行业标注（行标项目显示行业色徽标）

### 8.2 问题清单改造（`electron/ipc/issue.ipc.ts`）

**问题**：
- `DOMAIN_ID_TO_NAME`（`issue.ipc.ts:13-25`）硬编码国标 10 域
- `DOMAIN_ORDER`（`issue.ipc.ts:114-119`）硬编码域排序
- 前端 `src/views/issues/index.vue:123-127` 安全域下拉来自固定 `domainList`

**改造**：
- `DOMAIN_ID_TO_NAME` 改为运行时从项目 `standardId` 调 `standard:getDomains` 构建映射
- `DOMAIN_ORDER` 改为按 `standard:getDomains` 返回顺序（通用域在前、行业域在后、按 `sortOrder`）
- 前端 `domainList` 改为从项目标准动态获取
- `ASSET_TYPE_ORDER` 保留（资产类型与标准无关，通用）

### 8.3 资产级预置改造

见 5.4。

### 8.4 命令库行业维度（可选，Phase 4）

**现状**：`knowledge_commands` 按设备类型/品牌/OS 分类（`knowledge-base/index.vue:158-207`），不按标准/行业。

**可选改造**：新增 `industry` 字段，行标特有核查命令可按行业筛选。优先级低，仅在行标项目需要行业专属命令时启用。

### 8.5 AI 上下文注入（可选，Phase 4）

**现状**：`ai.ipc.ts` 未硬编码国标（好），但也未注入项目标准信息。

**可选改造**：AI 辅助时将项目 `standardId` 关联的标准代号、行业特色域注入 prompt 上下文，使 AI 回答贴合行业标准。优先级中。

### 8.6 默认标准动态化

**问题**：`systemSettings.defaultStandard` 默认值硬编码 `'gb-t-22239-2019-l3'`（`schema.ts:228`）。

**改造**：
- `system_settings.default_standard` 改为可由 `standard:setDefault` 更新（已有接口）
- 项目创建表单默认选中项从 `systemSettings.defaultStandard` 读取，而非硬编码
- 初始化时若默认标准被删除，回退到 `isDefault=1` 的标准或第一个国标

### 8.7 数据完整性与级联保护（关键）

> **原方案遗漏，本次补充**。这是最严重的数据完整性风险。

**现状**：
- `standard:remove`（`electron/ipc/standard.ipc.ts:94-97`）只执行 `db.delete(schema.standards)`，**不级联删除 `assessment_items`，也不检查 `projects/assessment_records/issues` 对 standardId/itemId 的引用**
- 虽然 `PRAGMA foreign_keys = ON` 已启用（`electron/db/index.ts:55-60`），但 `assessment_items.standard_id`、`assessment_records.item_id`、`issues.item_id` **均未定义 SQLite `REFERENCES` 外键约束**（仅业务字段 + 索引，见 `schema.ts:92-156`），数据库层不保护引用完整性
- 删除标准 → `assessment_items` 变孤儿（standardId 指向不存在的标准）→ 关联的 `records/issues` 的 itemId 指向不存在的测评项

**改造**：
- `standard:remove` 改为事务级联，**效仿 `project:remove`（`project.ipc.ts:637-646`）的模式**：
  ```ts
  db.transaction((tx) => {
    // 1. 检查 projects.standardId 引用，有则拒绝并返回引用项目列表
    // 2. 无引用则级联：assessment_records（按 itemId in 该标准测评项）、issues、assessment_items、standard_mapping、standards
  });
  ```
- `standard:update` **仅更新元信息，不改动 `assessment_items`**（避免 records.itemId 失效）；测评项更新走"导出旧→编辑→重新导入为新版本 ID（如 `dl-t-36572-2023-l3`）"
- 删除前前端二次确认，显示将级联清理的测评项数与记录数
- 可选（成本评估）：迁移期为 `assessment_items.standard_id` 补 SQLite 外键约束，但 SQLite 难以直接 ALTER 加外键，需重建表，优先用应用层保障

### 8.8 preload API 与共享类型同步（关键）

> **原方案遗漏，本次补充**。新增 IPC 接口必须同步 preload 与 shared 类型，否则前端无法调用、TS 报错。

**现状**：
- `electron/preload/index.ts:75-81` 暴露 `window.api.standard`，仅 `list/getDomains/getItems/setDefault/remove`
- `shared/types.ts:365-371` 为前后端共享的 API 契约类型，同样缺新接口
- `shared/` 目录是前后端共享类型层，TS 编译依赖

**改造**：
- `preload/index.ts` 同步注册 `standard:import/create/update/export`，否则渲染进程调不到
- `shared/types.ts` 更新：
  - `Standard` 类型加 `standardType/industry/source/presetTemplate` 字段
  - `StandardDomain` 类型加 `domainType/industry/sheetName`
  - `standard` API 契约加 `import/create/update/export` 方法签名
- 验收：`npx vue-tsc --noEmit` 零错误

### 8.9 项目成员域分配

**现状**：`project_members.assignedDomains`（`schema.ts:47`）以 JSON 数组存储分配的域 ID。

**改造**：assignedDomains 存域 ID 数组，已标准无关（支持任意域 ID）。仅需确认前端"项目成员分配"UI 从 `standard:getDomains(project.standardId)` 动态获取可分配域列表（含行业域），不再硬编码国标域。行标项目的行业特色域可正常分配给成员。

### 8.10 资产分类与 sheet 映射动态化

**现状**：
- `electron/ipc/asset.ipc.ts:44-50` `ASSET_CATEGORY_SHEET_MAP` 硬编码资产类别→sheet 映射（如 `network_device: ['安全计算环境-XX网络设备', '安全计算环境-网络设备']`），sheet 名为国标特有
- `asset.ipc.ts:305-307+` 资产 `category` 取值硬编码（`network_device/security_device/server_storage/terminal/data_resource` 等）
- `issue.ipc.ts:122-132` `ASSET_TYPE_ORDER` 硬编码资产类型排序

**改造**：
- `ASSET_CATEGORY_SHEET_MAP` 改为按标准 `domains[].sheetName` 动态构建（行标 sheet 名可能不同）
- 资产 `category` 取值保留（设备分类通用，与标准无关）；行标若有行业专属设备类别，通过 `extensionType` 或新增字段扩展（Phase 3 评估）
- `ASSET_TYPE_ORDER` 保留（资产类型排序通用，不依赖标准）

### 8.11 Excel 列映射、method 默认值、操作日志

**现状**：
- `project.ipc.ts:481-565` 硬编码列映射：A=序号 B=控制点 C=要求 D=记录 E=合规；预置导入 `method` 硬编码 `'check'`（`:559`）
- `shared/types.ts:108-123` `method` 取值 `'interview' | 'check' | 'test'`
- `electron/utils/operation-log.ts` 有日志机制，`project:create/update/remove` 均记录，但 `standard:*` 操作未记录

**改造**：
- Excel 列映射改为按标准 JSON `domains[].columnMap` 配置（可选字段，缺省沿用 A/B/C/D/E），适配行标模板列结构差异
- 预置导入的 `method` 默认值改为按标准配置（标准 JSON 可指定 `presetMethod`，缺省 `'check'`）
- `standard:import/create/update/remove/setDefault` 均调用 `writeOperationLog` 记录操作日志（action/module=targetId/description）

### 8.12 项目导出/导入的标准依赖（关键）

> **原方案遗漏，本次补充**。项目导入导出当前丢失标准信息，行标项目跨机器迁移会失效。

**现状**：
- `project:export`（`electron/ipc/project.ipc.ts:657-712`）导出 Excel，字段白名单**不含 `standardId`**，也未导出 `assessment_items/records`
- `project:import`（`project.ipc.ts:767-804`）导入时 `standardId` **硬编码为 `'gb-t-22239-2019-l3'`**（`:803`），行标项目导入后标准信息丢失，预置记录无法正确匹配

**改造**：
- `project:export` 字段白名单加 `standardId`（导出标准 ID 列）
- `project:import` 从 Excel 读取 `standardId`，插入前校验目标库是否存在该标准；不存在则报错"请先导入标准：{code}"，或回退默认标准并提示
- 跨机器恢复行标项目流程：目标机器先 `standard:import` 接入对应行标 → 再 `project:import`
- 整库备份恢复（`backup.service.ts`）是 SQLite 整库恢复，含标准数据，无此问题

### 8.13 测评 Excel 导出动态化

**现状**：`assessment:exportExcel`（`assessment.ipc.ts:485-564`）sheet 名来自 `DOMAIN_SHEETS` 硬编码映射，不按项目标准动态。

**改造**：sheet 名从 `standard:getDomains(project.standardId)` 动态获取（用 `domains[].name` 或 `sheetName`），行标项目的行业域可正确导出为独立 sheet。

### 8.14 getItemsByCategory 动态化

> **原方案遗漏，本次补充**。按资产类别查测评项硬编码国标域。

**现状**：`assessment:getItemsByCategory`（`assessment.ipc.ts:443-482`）的 `categoryDomainMap`（`:455-466`）几乎所有资产类别都映射到 `secure_computing`，机房映射 `secure_physical`，边界映射 `secure_boundary`——均为国标域 ID。行标若无 `secure_computing` 域，该接口返回空。

**改造**：
- `categoryDomainMap` 改为按标准动态构建：从 `standard:getDomains` 中按 `domainType='national'` 找等价域（计算环境域/物理域/边界域）
- 或在标准 JSON `domains[].equivalentCategory` 标注该域对应哪类资产
- 兜底：若标准无对应域，返回空并提示"该标准未定义 {类别} 适用域"

### 8.15 设置页默认标准入口（已存在，需修正一致性）

> **修正**：原方案误判"设置页无默认标准配置"。实际 `src/views/settings/index.vue:329-375, 961-974` **已有"标准库管理"标签页 + `handleSetDefault` 入口**，调 `standard:setDefault`。

**现状**：
- 设置页已有"标准库管理"标签页（列表/搜索/设默认/预置不可删）
- `standard:setDefault`（`standard.ipc.ts:84-92`）只更新 `standards.isDefault`，**不同步更新 `systemSettings.defaultStandard`**
- 项目创建表单若读 `systemSettings.defaultStandard`，与 `isDefault` 标记可能不一致

**改造**：
- `standard:setDefault` 同时更新 `systemSettings.defaultStandard = id`（保持两者一致）
- 项目创建表单默认选中项统一从 `standards where isDefault=1` 查询，或从同步后的 `systemSettings.defaultStandard` 读取
- 现有标签页扩展导入/新建/编辑/导出/删除按钮（见 6.1）

### 8.16 standard:import 事务与安全 + 行标种子数据量

**现状**：
- 现有 IPC 未用 `db.transaction`；行标导入可能数百条测评项，部分失败会导致脏数据
- 现有二级国标种子 190 项（`seeds/standard-gbt22239-l2.ts:3-7`），三级更多；行标种子 TS 文件过大影响打包体积

**改造**：
- `standard:import` 用 `db.transaction` 包裹整批插入，部分失败回滚不留残
- 文件大小限制（如 10MB）、字段长度校验、`requirement` 等文本字段截断保护；drizzle 参数化查询天然防 SQL 注入
- **种子格式策略**：项数 ≤500 用 TS 种子（`seeds/standard-*.ts`）；项数 >500 改用 JSON 文件（`resources/standards/*.json`）由 `initStandardLibrary` 读取，避免 TS 文件过大；统一加载入口 `loadBuiltinStandard` 兼容两种来源

### 8.17 截图/证据文件孤儿清理（关键）

> **原方案遗漏，本次补充**。级联删除 records 时物理截图文件会变磁盘孤儿。

**现状**：
- `screenshot:deleteFile`（`screenshot.ipc.ts:339-345`）仅删单个文件，无按 `projectId/itemId` 批量清理
- `asset:remove`（`asset.ipc.ts:440-466`）级联删 `assessment_records`，但**不清理 `screenshotPaths` 物理文件**
- `standard:remove` 级联删 records（见 8.7）同样会遗留截图孤儿
- `assessment_records.screenshotPaths` 无外键约束到文件系统

**改造**：
- `standard:remove` / `asset:remove` 级联删 records 前，遍历 `screenshotPaths` 删除物理文件（best-effort，失败不阻断）
- 可选：增加"孤儿截图清理"维护任务（扫描 `screenshots/` 目录与 records 比对）
- 删除项目（`project:remove`）同样应清理 `screenshots/{projectId}/` 整目录

### 8.18 应用升级与标准数据增量迁移

> **原方案遗漏，本次补充**。明确升级后行标种子的加载时机。

**现状**：
- `update.service.ts:97-100` 仅注册 `update-available/not-available/error` 事件，**升级完成后不直接触发 `initStandardLibrary`**
- 标准库加载只在 `initDatabase()`（`db/index.ts:46-85`）启动路径执行
- `STANDARD_DATA_VERSION`（当前=7）控制是否重新初始化

**改造**（依赖现有机制，无需新增升级钩子）：
- 应用升级流程：下载安装 → 重启 → `initDatabase()` → `migrate()` 执行新迁移 → `initStandardLibrary()` 检测 `STANDARD_DATA_VERSION` 提升至 8 → 加载新行标种子
- 升级提示文案明确"重启后生效"
- 无需在 `update.service` 注入迁移钩子，依赖重启 + 版本号机制即可（幂等）
- 验证：升级后 `system_settings.standard_data_version` 正确更新

### 8.19 打包配置确认

**现状**：
- `package.json:82-90` `extraResources` 配置 `resources/**/*`，**会打包 `resources/standards/`**（行标 JSON 模板）
- `electron/db/seeds/*.ts` 编译后随 Electron main bundle 打包（行标 TS 种子）
- 运行时 `process.resourcesPath` 可找到 `resources/standards/`，`asset.ipc.ts:128-139`、`project.ipc.ts:420-430` 已枚举该路径查找模板

**改造**：无需改打包配置。确认：
- 行标 JSON 放 `resources/standards/`（随包分发，用户可参考/重新导入）
- 行标 TS 种子放 `electron/db/seeds/`（编译进 bundle，启动加载）
- 预置 Excel 模板放 `resources/standards/presets/{standardId}/`（随包分发）

### 8.20 standardId 命名规范与校验

**改造**：
- `standard:import/create` 校验 `standardId` 格式：`^[a-z]+-t-\d{4,}-l\d$`（如 `dl-t-36572-2018-l3`）或自定义前缀，避免与国标 `gb-t-22239-*` 冲突
- `code` 唯一性校验（已有 `standards.code` 唯一索引）
- 测评项 `id` 全局唯一：行标用行业前缀（`pd-`/`fin-`），导入时检测重复并报错

---

## 九、实施阶段划分

### Phase 1：后端动态标准库（基础设施）
1. `standards` 表迁移加 4 字段（`npm run db:generate` 生成 0001 迁移文件）+ 兼容建表语句同步
2. 实现 `standard:import/create/update/export` 接口（**`import` 用 `db.transaction` + 文件大小/字段长度校验**）
3. 改造 `project:create` 强制传 standardId
4. 改造项目级 `importPresetRecords(standardId)` 按标准选模板
5. 改造资产级 `importAssetPresetRecords` 按标准选模板 + 动态域
6. 清理现场核查页国标 fallback
7. 改造 `initStandardLibrary` 支持加载多个内置标准（提升 STANDARD_DATA_VERSION）
8. **preload 同步注册 `standard:import/create/update/export` + `shared/types.ts` 类型更新**
9. **改造 `standard:remove` 为事务级联 + projects 引用检查 + 截图孤儿清理**
10. **`standard:*` 操作记录 operationLogs**

### Phase 2：前端标准管理 + 下游动态化
11. 开发标准库管理界面（列表/导入/新建/编辑/删除/默认）
12. 改造项目创建表单"标准库"选择器（默认从 systemSettings 读取）
13. 项目列表显示实际标准名
14. 现场核查页动态域渲染 + 行业标识
15. **报告生成动态化**（`report.service.ts` 模板按标准渲染）
16. **问题清单域映射动态化**（`issue.ipc.ts` DOMAIN_ID_TO_NAME/ORDER）
17. **项目成员分配 UI 从 `standard:getDomains` 动态获取域列表**
18. **资产 sheet 映射动态化**（`asset.ipc.ts` ASSET_CATEGORY_SHEET_MAP 按标准 sheetName 构建）
19. **Excel 列映射 + method 默认值按标准配置**（`project.ipc.ts` 预置导入）
20. **项目导出/导入 standardId 传递**（`project:export` 加字段、`project:import` 读 standardId + 存在性校验）
21. **测评 Excel 导出动态化**（`assessment:exportExcel` sheet 名按标准）
22. **`getItemsByCategory` 动态化**（`categoryDomainMap` 按标准等价域）
23. **设置页"标准库管理"标签页扩展**（导入/新建/编辑/导出/删除 + setDefault 同步 systemSettings）

### Phase 3：首批行标数据接入
24. 制作电力行标种子 `seeds/standard-dlt36572.ts`（或 JSON）+ 配套预置模板
25. 制作金融行标种子 `seeds/standard-jrt0068.ts`（或 JSON）+ 配套预置模板
26. 内置首批行标到 `seeds/` 或 `resources/standards/`，随安装包分发
27. 行标-国标对照关系表（可选，按需启用）

### Phase 4：增强与打磨
28. 行标项目报告模板适配（报告页头部标注行业标准 + 行业色徽标）
29. AI 辅助按标准上下文检索（行标条款注入 prompt）
30. 命令库行业维度（可选，按需启用）
31. 标准导出/导入的完整校验与日志
32. 多标准对照视图（同一控制点在国标/行标的要求差异）

---

## 十、兼容性与迁移

- **现有项目**：迁移脚本 `UPDATE standards SET standard_type='national' WHERE standard_type IS NULL` + 回填现有项目 `standard_id` 已是国标，零影响
- **`standardSystem` 文本字段保留**：仅作显示兼容，不再作为选择依据
- **种子数据**：现有 `seeds/standard-gbt22239-l2.ts` 种子标记 `standardType='national'`
- **删除保护**：删除标准前检查 `projects.standardId` 引用，有项目引用则禁止或提示替换
- **迁移幂等**：`initStandardLibrary` 按 `code` 判断已存在，重复启动不重复插入，保护用户对测评项的改动

---

## 十一、风险与应对

| 风险 | 应对 |
|------|------|
| 行标条款版权 | 仅录入公开标准条款，导入需用户自行提供文件；内置仅放官方公开版 |
| 预置模板与行标条款不匹配 | 导入时按 `domain\|\|controlPoint\|\|requirement` 索引匹配，未匹配项告警并跳过（现有逻辑已容忍） |
| 行业特色域 sheet 名不固定 | `SHEET_TO_DOMAIN` 改为从标准 JSON `domains[].sheetName` 动态构建 |
| 测评项 ID 冲突 | 行标用行业前缀（`pd-`/`fin-`），国标保持 `sp-`/`sc-`，全局唯一 |
| 大数据量标准性能 | 现有 `assessment_items` 已有 `standard_domain_idx`/`standard_idx` 索引，需验证数千项行标的查询性能 |
| 标准升级（行标换版） | `standard:update` 仅更新元信息；测评项更新走"导出旧→改→重新导入"或新增版本 ID（如 `dl-t-36572-2023-l3`） |
| 报告/问题清单遗漏硬编码 | Phase 2 统一改造下游，验收时全文搜索 `GB/T 22239`/`22239`/国标域名确保无残留 |
| 迁移失败回退 | 沿用 `initStandardLibrary` 的 `VACUUM INTO` 备份 + `autoCreateTables` 兜底机制 |
| **标准删除导致孤儿数据** | `standard:remove` 改事务级联 + 引用检查；外键未定义靠应用层保障；删除前显示将清理的项数 |
| **标准更新导致 itemId 失效** | `standard:update` 仅改元信息不动测评项；换版用新版本 ID 重新导入 |
| **preload/类型未同步** | 新增 IPC 必须同步 `preload/index.ts` + `shared/types.ts`，否则前端无法调用、TS 报错 |
| **资产 sheet 名行业差异** | `ASSET_CATEGORY_SHEET_MAP` 按标准 `domains[].sheetName` 动态构建 |
| **项目导入丢失标准** | `project:import` 改读 standardId + 存在性校验；跨机器恢复需先导入标准 |
| **getItemsByCategory 失效** | `categoryDomainMap` 按标准等价域动态构建，无对应域则提示 |
| **行标种子文件过大** | 项数 >500 用 JSON 文件而非 TS 种子；统一 `loadBuiltinStandard` 兼容两来源 |
| **standard:import 部分失败** | 用 `db.transaction` 包裹，失败回滚不留残；文件大小+字段校验 |

---

## 十二、验收标准

1. 能够导入 JSON 格式的行标标准库（含行业特色域）
2. 项目创建时可选择国标或行标，默认项从 systemSettings 读取
3. 项目级与资产级预置记录均按所选标准正确加载
4. 现场核查页面根据项目标准加载对应测评项与域，行业域正确渲染
5. 行标项目报告头部正确标注行业标准代号，域名动态渲染（无国标残留）
6. 问题清单的安全域映射与排序按项目标准动态化
7. 删除标准后，引用该标准的项目给出明确提示
8. 现有国标项目所有功能不受影响
9. 标准库管理界面支持筛选、导入、导出、设为默认
10. 行标-国标对照关系（若启用）能正确展示条款映射
11. **全文搜索 `GB/T 22239`、`22239`、国标域名常量在 src/ 与 electron/ 下无业务逻辑残留**（仅 schema 默认值与 seeds 保留）

---

## 十三、关键改动文件清单

| 文件 | 改动类型 | 说明 |
|------|----------|------|
| `electron/db/schema.ts` | 修改 | `standards` 表加 4 字段，新增 `standard_mapping` 表 |
| `electron/db/index.ts` | 修改 | 兼容建表语句同步加列；改造 `initStandardLibrary` 支持多标准加载 |
| `electron/db/migrations/0001_*.sql` | 新增 | 由 `db:generate` 生成，加 4 列的迁移文件 |
| `electron/db/seeds/standard-gbt22239-l2.ts` | 修改 | 种子标记 `standardType='national'` |
| `electron/db/seeds/standard-dlt36572.ts` | 新增 | 电力行标种子 |
| `electron/db/seeds/standard-jrt0068.ts` | 新增 | 金融行标种子 |
| `electron/ipc/standard.ipc.ts` | 修改 | 新增 import/create/update/export，改造 getDomains/list 动态域名；**standard:remove 事务级联+引用检查** |
| `electron/ipc/project.ipc.ts` | 修改 | `project:create` 强制 standardId，`importPresetRecords` 改用 standardId + 动态列映射 |
| `electron/ipc/asset.ipc.ts` | 修改 | `importAssetPresetRecords` 按标准选模板 + 动态域；`ASSET_CATEGORY_SHEET_MAP` 动态化 |
| `electron/ipc/issue.ipc.ts` | 修改 | `DOMAIN_ID_TO_NAME`/`DOMAIN_ORDER` 动态化 |
| `electron/ipc/assessment.ipc.ts` | 修改 | **`getItemsByCategory` categoryDomainMap 动态化；`exportExcel` sheet 名动态化** |
| `electron/services/report.service.ts` | 修改 | 报告模板标准代号/域名动态化 |
| `electron/preload/index.ts` | 修改 | **同步注册 `standard:import/create/update/export`** |
| `shared/types.ts` | 修改 | **`Standard`/`StandardDomain` 类型加字段；`standard` API 契约加新接口** |
| `electron/utils/operation-log.ts` | 不变 | 已有日志机制，由 `standard:*` 调用方记录 |
| `electron/ipc/screenshot.ipc.ts` | 修改 | **新增按 itemId/projectId 批量清理截图文件**（级联删除孤儿） |
| `electron/services/update.service.ts` | 不变 | 依赖重启+版本号机制加载新行标，无需改升级钩子 |
| `src/views/settings/index.vue` | 修改 | **扩展现有"标准库管理"标签页**（加列/筛选/导入/新建/编辑/导出/删除） |
| `src/views/projects/index.vue` | 修改 | 标准库选择器替代文本下拉，默认从 isDefault 标准读取 |
| `src/views/onsite-verification/index.vue` | 修改 | 清理国标 fallback，动态域渲染 |
| `src/views/issues/index.vue` | 修改 | 安全域下拉动态获取 |
| `src/router/index.ts` | 不变 | 标准库管理复用现有设置页路由，无需新增 |
| `resources/standards/presets/` | 新增 | 各标准配套预置模板目录结构 |
| `electron/main/ipc.ts` | 不变 | 已注册 standard 服务 |
