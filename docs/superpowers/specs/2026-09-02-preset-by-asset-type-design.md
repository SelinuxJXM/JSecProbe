# 预置结果记录 · 按资产类型区分（安全计算环境域）设计文档

- 日期：2026-09-02

- 状态：已确认（用户批准）

- 范围：仅影响「安全计算环境」域（domain = `secure_computing`）的预置记录；其他域保持现有单一预置不变。

***

## 1. 背景与目标

用户期望的预置结果记录行为（三点）：

1. **标准库导入即带入预置**：导入标准库时，预置记录一并写入标准库。
2. **按标准自动获取预置**：创建项目并选择某标准后，录入资产即可自动获得该标准对应的内置预置记录。
3. **安全计算环境按资产类型区分**：在安全计算环境层面，不同「资产类型」的预置记录内容不同。

### 现状核对

| 需求               | 现状                                                                                              | 结论       |
| ---------------- | ----------------------------------------------------------------------------------------------- | -------- |
| 1. 标准库导入带入预置     | `standard.ipc.ts` 读 Excel 列 `预置符合情况`/`预置结果记录` → 写入 `assessment_items.presetResult/presetRecord` | 已实现 ✅    |
| 2. 按标准自动获取预置     | `asset.ipc.ts` `importAssetPresetRecords` 按 `standardId` 读 `assessment_items` 预置，录入资产时灌入测评记录    | 已实现 ✅    |
| 3. 安全计算环境按资产类型区分 | `presetResult/presetRecord` 为「每控制点单一值」，对所有资产类型统一套用                                              | **缺口 ❌** |

### 本次目标

补齐需求 3：在 `secure_computing` 域内，预置记录按 `assets.category`（资产类型）区分。其他域与现有逻辑完全不变。

***

## 2. 资产类型分类定义

安全计算环境的预置按以下 **7 类资产类型**区分。键值沿用系统既有 `CATEGORY_NAMES` 映射（`src/views/system-composition/index.vue:496`）：

| 用户表述        | 分类键（JSON key）         | 显示名         |
| ----------- | --------------------- | ----------- |
| 网络设备        | `network_device`      | 网络设备        |
| 安全设备        | `security_device`     | 安全设备        |
| 服务器         | `server_storage`      | 服务器/存储设备    |
| 系统管理平台（数据库） | `management_platform` | 系统管理平台（数据库） |
| 应用系统        | `business_app`        | 业务应用系统      |
| 终端          | `terminal`            | 业务终端/运维终端   |
| 数据资源        | `data_resource`       | 数据资源        |

> 导入/导出 Excel 的「资产类型」列使用**显示名**；落库 JSON 使用**分类键**。导入器通过 `CATEGORY_NAMES` 做反向映射。

***

## 3. 方案概述

- **录入**：标准导入 Excel 为**每种资产类型各新增一张**「安全计算环境-预置明细-<类型>」子表（共 7 张，如 `…-服务器、存储设备`、`…-网络设备`），表内**行=控制点、列=符合情况/结果记录**——即一份该类型的完整底稿，按块维护。主 sheet 原有两列作为「通用默认预置」保留。

- **存储**：`assessment_items` 新增 `preset_by_type TEXT`（JSON），结构为 `{ [categoryKey]: { result, record } }`，仅 `secure_computing` 域填充。与最初"单网格子表"方案的存储模型完全一致。

- **应用**：`importAssetPresetRecords` 在 `secure_computing` 域内优先取 `preset_by_type[asset.category]`；缺失时回退到默认 `presetResult/presetRecord`。

- **兜底/兼容**：类型无专属预置、或 JSON 解析失败时，一律回退默认预置，不报错、不漏填。

> **方案变更说明**：初版设计为「单张（控制点 × 资产类型）网格子表」，`资产类型` 作为子表的一列。经用户反馈（"按资产类型整批套用"更顺手），重构为**按资产类型分表**：维护单位从"控制点网格"变为"每种类型一套底稿"，更贴合等保实际工作流。存储模型与应用逻辑不变，仅 Excel 呈现方式改变。

***

## 4. Excel 模板设计

### 4.1 主 sheet（每安全域一张，结构不变）

列：`序号 | 控制点 | 要求 | 记录 | 合规结果 | 预置符合情况 | 预置结果记录`

- `预置符合情况` / `预置结果记录` → 作为该域内**通用默认预置**（写入 `presetResult` / `presetRecord`）。

### 4.2 新增子表：每种资产类型一张「安全计算环境-预置明细-<类型>」

共 7 张（对应第 2 节 7 类资产），每张列：`控制点 | 测评项（控制名称） | 符合情况 | 结果记录`

- **每张子表即「该资产类型的完整预置底稿」**：行 = (控制点, 测评项) 组合——一个控制点（如"身份鉴别"）下通常有 a/b/c/d 多个测评项，每个测评项在子表里是一行，须与主 sheet「安全计算环境」中对应行的「控制点 + 控制名称」一致。

- 无需在子表里写 `资产类型` 列——表名已决定类型。维护时按类型分块填写，录入该类资产时按「控制点 + 测评项」整批套用。

- **测评项列为空**时，该行预置套用该控制点下**全部**测评项（控制点级兜底）；填写具体测评项时则精确覆盖该测评项。

- 仅当该标准/域存在某类型的类型化预置时才需填写；某类型不填则回退默认。

- **Excel 工作表名约束**：表名禁用 `\ / ? * [ ] :` 等字符，故显示名中的 `/` 在表名中改写为 `、`（如 `服务器/存储设备` → 表名后缀 `服务器、存储设备`）。导入解析时再将 `、` 还原映射回分类键。

- 子表识别：`standard.ipc.ts` 在解析时按 **sheet 名称包含「预置明细」** 命中；取「预置明细」之后的部分作为资产类型显示名（表名安全写法），经 `ASSET_SHEET_LABEL_TO_KEY` 映射为分类键。

***

## 5. 数据模型

### 5.1 `assessment_items` 表（schema.ts）

新增列（与现有 `preset_result`/`preset_record` 并列）：

```ts
presetResult: text('preset_result'),   // 预置符合情况（默认/其他域）
presetRecord: text('preset_record'),   // 预置结果记录（默认/其他域）
presetByType: text('preset_by_type'), // 安全计算环境按资产类型区分的预置，JSON：{ [categoryKey]: { result, record } }
```

### 5.2 迁移（db/index.ts）

初始化自动迁移补列（与现有 `preset_result`/`preset_record` 补列逻辑一致）：

```ts
if (!hasPresetByType) {
  sqliteInstance.exec('ALTER TABLE assessment_items ADD COLUMN preset_by_type TEXT');
  log.info('已为 assessment_items 添加 preset_by_type 列');
}
```

同时追加 `migrations/0003_add_preset_by_type.sql` 固化迁移。

### 5.3 JSON 结构示例

```json
{
  "network_device":   { "result": "符合", "record": "已启用 SSH 密钥登录并禁用口令..." },
  "security_device":  { "result": "符合", "record": "防火墙策略已最小化..." },
  "server_storage":   { "result": "部分符合", "record": "审计策略待补充..." },
  "management_platform": { "result": "符合", "record": "数据库已开启审计日志..." },
  "business_app":     { "result": "符合", "record": "应用已做输入校验..." },
  "terminal":         { "result": "不适用", "record": "不适用" },
  "data_resource":    { "result": "符合", "record": "已做分级分类..." }
}
```

***

## 6. 导入逻辑（standard.ipc.ts）

在现有标准导入流程中扩展：

1. 解析主 sheet 行 → 写 `presetResult` / `presetRecord`（默认预置），逻辑不变。

2. 解析所有 `安全计算环境-预置明细-<类型>` 子表：

   - 子表识别：sheet 名包含「预置明细」即命中；取「预置明细」之后的部分作为资产类型显示名（表名安全写法，如 `服务器、存储设备`），经模块级 `ASSET_SHEET_LABEL_TO_KEY` 映射为分类键；无法识别则 `log.warn` 并跳过该表。

   - 逐行读取 `控制点 / 测评项 / 符合情况 / 结果记录`；按「(控制点, 测评项)」双键累积到 `presetByType[{控制点, 测评项}][分类键] = { result, record }`。`测评项` 为空时按控制点级累积，套用该控制点下全部测评项。

3. 循环结束后，将各 `secure_computing` 测评项的 `presetByType` 聚合为 JSON 字符串，写入 `preset_by_type` 列（形如 `{ "network_device": {...}, "server_storage": {...} }`）。

4. 子表缺失或为空 → `preset_by_type` 置 `NULL`，安全计算环境回退默认。

> 仅 `secure_computing` 域相关的测评项需要/允许填充 `preset_by_type`；其他域忽略该子表。

***

## 7. 应用逻辑（asset.ipc.ts · importAssetPresetRecords）

现有逻辑（读取 `item.presetResult/presetRecord` 并映射 `RESULT_MAP`）扩展如下：

```ts
for (const item of allItems) {
  let resultValue, presetRecord;

  if (item.domain === 'secure_computing' && item.presetByType) {
    const byType = safeParse(item.presetByType);          // 解析失败回退默认
    const typePreset = byType?.[asset.category];
    if (typePreset) {
      presetRecord = typePreset.record || '';
      resultValue = RESULT_MAP[typePreset.result] || 'untested';
    }
  }

  // 兜底：未命中类型化预置时使用默认
  if (!presetRecord) {
    presetRecord = item.presetRecord || '';
    resultValue = RESULT_MAP[item.presetResult] || 'untested';
  }
  if (resultValue === 'untested' && presetRecord.includes('不适用')) {
    resultValue = 'not_applicable';
  }

  // 组装 assessmentRecords：result / method / evidence / findings 不变
}
```

- 其他域（`domain !== 'secure_computing'`）：完全走现有默认预置路径，行为零变化。

- `safeParse`：解析 `preset_by_type` 失败时返回 `null`，触发回退，不抛错。

***

## 8. 兜底与兼容性

- **老数据兼容**：`preset_by_type` 为 `NULL`/空/解析失败 → 安全计算环境表现 = 现有「统一预置」，**向后兼容无破坏**。

- **缺类型预置**：某资产类型在明细子表无对应行 → 回退该域默认预置，保证不漏填。

- **导出闭环**：标准导出/模板同步为每种资产类型生成「安全计算环境-预置明细-<类型>」子表（仅输出有数据的类型；无类型化预置时输出一张「说明」子表，重新导入时自动忽略），确保导出 → 编辑 → 再导入不丢类型化预置。

***

## 9. 测试要点

1. 标准导入含「预置明细」子表 → `assessment_items.preset_by_type` 正确写入 7 类 JSON。
2. 创建项目（如 `gb-t-22239-2019-l3`）→ 录入 `network_device` 资产 → 其安全计算环境测评项取网络设备的类型化预置。
3. 录入 `terminal` 资产 → 取终端类型化预置（与服务器不同）。
4. 某类型缺失明细 → 回退默认预置，不报错。
5. 老库（无 `preset_by_type` 列）启动 → 自动迁移补列成功，现有预置仍生效。
6. 其他域（如安全管理制度）预置行为与改动前完全一致。

***

## 10. 非目标（YAGNI）

- 不做其他安全域（安全通信网络、安全区域边界等）的类型化预置。

- 不改动「项目级预置模板」（`project.ipc.ts` 的 `importPresetRecords` 与 `resources/standards/presets/*` 模板文件）机制——本次仅增强「资产级预置」链路。

- 不引入新的 UI 编辑界面；类型化预置仍通过标准导入 Excel 维护。

***

## 11. 影响文件

| 文件                                                   | 改动                                                                                                                                 |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `electron/db/schema.ts`                              | `assessmentItems` 增加 `presetByType` 列定义                                                                                            |
| `electron/db/index.ts`                               | 初始化自动迁移补 `preset_by_type` 列                                                                                                        |
| `electron/db/migrations/0003_add_preset_by_type.sql` | 固化迁移（新增）                                                                                                                           |
| `electron/ipc/standard.ipc.ts`                       | 模块级 `ASSET_TYPE_DEFS`/`ASSET_SHEET_LABEL_TO_KEY`/`CATEGORY_KEY_TO_LABEL`；标准导入按资产类型分表解析「预置明细-<类型>」→ 写 `preset_by_type`；模板/导出按类型生成子表 |
| `electron/ipc/asset.ipc.ts`                          | `importAssetPresetRecords` 按 `domain==='secure_computing'` + `asset.category` 选预置，含回退（逻辑未变）                                        |
| 标准导入 Excel 模板/导出（`standard.ipc.ts`）                  | 每种资产类型一张「安全计算环境-预置明细-<类型>」子表（表名含 `、` 代替 `/`）                                                                                       |

