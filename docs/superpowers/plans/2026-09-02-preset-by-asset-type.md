# 预置结果记录 · 按资产类型区分（安全计算环境域）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在安全计算环境（domain=`secure_computing`）域内，使预置结果记录按资产类型（assets.category）区分；其他域与现有逻辑保持不变，老数据向后兼容。

**Architecture:** 标准导入 Excel 新增「安全计算环境-预置明细」子表（录入），落库为 `assessment_items.preset_by_type` JSON 列（存储），`importAssetPresetRecords` 在 secure_computing 域内按 `asset.category` 选取对应预置、缺失时回退默认预置（应用）。仅动 secure_computing 一条链路。

**Tech Stack:** Electron 主进程（TypeScript）、better-sqlite3 + drizzle-orm、ExcelJS（标准导入/导出）、Vue 3 前端（仅引用，不改）。

---

## 文件结构

| 文件 | 改动 |
|------|------|
| `electron/db/schema.ts` | `assessmentItems` 增加 `presetByType` 列定义（drizzle 源，新库生效） |
| `electron/db/index.ts` | 两处 `CREATE TABLE assessment_items` 增加列 + 迁移块补 `preset_by_type` 列（老库兼容） |
| `electron/db/migrations/0003_add_preset_by_type.sql` | 固化迁移（新增文件） |
| `electron/ipc/standard.ipc.ts` | 标准导入解析「预置明细」子表 → 写 `preset_by_type`；导出含该子表 |
| `electron/ipc/asset.ipc.ts` | `importAssetPresetRecords` 按 `domain==='secure_computing'` + `asset.category` 选预置，含回退 |
| 标准导入 Excel 模板 + `scripts/generate-industry-preset-templates.js` | 增加「安全计算环境-预置明细」子表 |

> 资产类型键名映射（落库用键、Excel 用显示名）以 `src/views/system-composition/index.vue:497` 的 `CATEGORY_NAMES` 为准：
> network_device=网络设备, security_device=安全设备, server_storage=服务器/存储设备, management_platform=系统管理平台, business_app=业务应用系统, terminal=业务终端/运维终端, data_resource=数据资源。

---

### Task 1: 数据库 schema 与迁移

**Files:**
- Modify: `electron/db/schema.ts:115-116`
- Modify: `electron/db/index.ts:236-249`（首个 CREATE TABLE）
- Modify: `electron/db/index.ts:681-698`（重建 CREATE TABLE）
- Modify: `electron/db/index.ts:633-643`（迁移块）
- Create: `electron/db/migrations/0003_add_preset_by_type.sql`

- [ ] **Step 1: schema.ts 增加列定义**

在 `presetRecord` 行之后追加：

```ts
  presetResult: text('preset_result'),   // 预置符合情况：符合/不符合/部分符合/不适用/未测评
  presetRecord: text('preset_record'),   // 预置结果记录/证据文本
  presetByType: text('preset_by_type'),  // 安全计算环境按资产类型区分的预置，JSON: { [categoryKey]: { result, record } }
```

- [ ] **Step 2: 首个 CREATE TABLE（db/index.ts:236-249）增加列**

```sql
          parent_id TEXT,
          preset_result TEXT,
          preset_record TEXT,
          preset_by_type TEXT
        )
```

- [ ] **Step 3: 重建 CREATE TABLE（db/index.ts:681-698）增加列**

```sql
          parent_id TEXT,
          preset_result TEXT,
          preset_record TEXT,
          preset_by_type TEXT
        )
```

- [ ] **Step 4: 迁移块（db/index.ts:633-643）增加补列逻辑**

在 `if (!hasPresetRecord) { ... }` 之后追加：

```ts
    const hasPresetByType = tableInfo.some(c => c.name === 'preset_by_type');
    if (!hasPresetByType) {
      sqliteInstance.exec('ALTER TABLE assessment_items ADD COLUMN preset_by_type TEXT');
      log.info('已为 assessment_items 添加 preset_by_type 列');
    }
```

- [ ] **Step 5: 固化迁移文件**

新建 `electron/db/migrations/0003_add_preset_by_type.sql`：

```sql
-- 0003 安全计算环境按资产类型区分的预置记录
ALTER TABLE assessment_items ADD COLUMN preset_by_type TEXT;
```

- [ ] **Step 6: 类型检查**

Run: `npx vue-tsc --noEmit`
Expected: 0 错误（仅增列，不影响现有类型）

- [ ] **Step 7: 提交（按项目约定）**

```bash
git add electron/db/schema.ts electron/db/index.ts electron/db/migrations/0003_add_preset_by_type.sql
git commit -m "feat(db): 为 assessment_items 增加 preset_by_type 列及迁移"
```

---

### Task 2: standard.ipc.ts 导入解析「预置明细」子表

**Files:**
- Modify: `electron/ipc/standard.ipc.ts:461`（worksheet 循环）
- Modify: `electron/ipc/standard.ipc.ts:569-571`（循环后、组装 standardData 前）

- [ ] **Step 1: 在 worksheet 循环前声明收集器与映射常量**

在 `for (let si = 1; si < sheets.length; si++) {` 之前插入：

```ts
    // 安全计算环境「预置明细」子表收集器：{ 控制点, 资产类型显示名, 符合情况, 结果记录 }
    const presetDetailRows: Array<{ controlPoint: string; assetTypeLabel: string; result: string; record: string }> = [];

    // 资产类型显示名 -> 落库键名（与 system-composition.vue CATEGORY_NAMES 对齐）
    const ASSET_TYPE_LABEL_TO_KEY: Record<string, string> = {
      '网络设备': 'network_device',
      '安全设备': 'security_device',
      '服务器/存储设备': 'server_storage',
      '服务器': 'server_storage',
      '系统管理平台': 'management_platform',
      '系统管理平台（数据库）': 'management_platform',
      '业务应用系统': 'business_app',
      '应用系统': 'business_app',
      '业务终端/运维终端': 'terminal',
      '终端': 'terminal',
      '数据资源': 'data_resource',
    };
```

- [ ] **Step 2: 在循环顶部识别并解析「预置明细」子表**

在 `const sheetName = ws.name;` 之后、`if (sheetName.includes('列序映射') ...)` 附近插入：

```ts
      // 解析「安全计算环境-预置明细」子表（按名称含「预置明细」命中），收集后统一挂到 secure_computing 测评项
      if (sheetName.includes('预置明细')) {
        let hdr = -1;
        const cmap: Record<string, number> = {};
        ws.eachRow((row, r) => {
          if (hdr !== -1) return;
          const vals = Array.from({ length: row.cellCount }, (_, i) => String(row.getCell(i + 1).value || '').trim());
          if (!vals.some(v => v.includes('控制点'))) return;
          if (!vals.some(v => v.includes('资产类型'))) return;
          hdr = r;
          vals.forEach((v, i) => {
            if (v.includes('控制点') || v.includes('控制点编号')) cmap.controlPoint = i;
            else if (v.includes('资产类型')) cmap.assetType = i;
            else if (v.includes('符合情况') || v.includes('合规结果') || v.includes('合规')) cmap.result = i;
            else if (v.includes('结果记录') || v.includes('记录')) cmap.record = i;
          });
        });
        if (hdr !== -1) {
          for (let r = hdr + 1; r <= ws.rowCount; r++) {
            const row = ws.getRow(r);
            const get = (k: string) => cmap[k] !== undefined ? String(row.getCell(cmap[k] + 1).value || '').trim() : '';
            const cp = get('controlPoint');
            if (!cp) continue;
            presetDetailRows.push({ controlPoint: cp, assetTypeLabel: get('assetType'), result: get('result'), record: get('record') });
          }
        }
        continue;
      }
```

- [ ] **Step 3: 循环后，将明细挂到 secure_computing 测评项**

在 `if (domains.length === 0) throw new Error(...)` 之后、`const standardData = {` 之前插入：

```ts
    // 将「预置明细」按控制点聚合为 { [categoryKey]: { result, record } }，仅挂到安全计算环境域
    const presetByTypeMap = new Map<string, Record<string, { result: string; record: string }>>();
    for (const row of presetDetailRows) {
      const key = ASSET_TYPE_LABEL_TO_KEY[row.assetTypeLabel.trim()];
      if (!key) { log.warn(`[标准导入] 未知资产类型「${row.assetTypeLabel}」，跳过该预置明细`); continue; }
      if (!presetByTypeMap.has(row.controlPoint)) presetByTypeMap.set(row.controlPoint, {});
      presetByTypeMap.get(row.controlPoint)![key] = { result: row.result, record: row.record };
    }
    for (const domain of domains) {
      if (domain.id !== 'secure_computing') continue;
      for (const item of domain.items) {
        const byType = presetByTypeMap.get(item.controlPoint);
        if (byType && Object.keys(byType).length > 0) {
          item.presetByType = JSON.stringify(byType);
        }
      }
    }
```

- [ ] **Step 4: 类型检查**

Run: `npx vue-tsc --noEmit`
Expected: 0 错误

- [ ] **Step 5: 提交**

```bash
git add electron/ipc/standard.ipc.ts
git commit -m "feat(standard): 标准导入解析安全计算环境预置明细子表"
```

---

### Task 3: asset.ipc.ts 按资产类型应用预置

**Files:**
- Modify: `electron/ipc/asset.ipc.ts:90-128`（`importAssetPresetRecords` 内 for 循环）

- [ ] **Step 1: 替换循环体内的预置选取逻辑**

将现有：

```ts
    for (const item of allItems) {
      const presetResult = item.presetResult;
      const presetRecord = item.presetRecord;
      if (!presetResult && !presetRecord) continue;

      let resultValue: AssessmentResult = 'untested';
      const mapEntry = RESULT_MAP[(presetResult || '').trim() as keyof typeof RESULT_MAP];
      if (mapEntry !== undefined) {
        resultValue = mapEntry;
      }

      if (resultValue === 'untested' && presetRecord.includes('不适用')) {
        resultValue = 'not_applicable';
      }
```

替换为：

```ts
    for (const item of allItems) {
      const isSecureComputing = item.domain === 'secure_computing';
      let presetResult = item.presetResult;
      let presetRecord = item.presetRecord;

      // 安全计算环境：优先取按资产类型区分的预置；解析失败或缺失则回退默认
      if (isSecureComputing && item.presetByType) {
        try {
          const byType = JSON.parse(item.presetByType) as Record<string, { result: string; record: string }>;
          const typePreset = byType[asset.category];
          if (typePreset) {
            presetResult = typePreset.result;
            presetRecord = typePreset.record;
          }
        } catch {
          log.warn(`[预置] assessment_item ${item.itemId} 的 preset_by_type 解析失败，回退默认预置`);
        }
      }

      if (!presetResult && !presetRecord) continue;

      let resultValue: AssessmentResult = 'untested';
      const mapEntry = RESULT_MAP[(presetResult || '').trim() as keyof typeof RESULT_MAP];
      if (mapEntry !== undefined) {
        resultValue = mapEntry;
      }

      if (resultValue === 'untested' && presetRecord && presetRecord.includes('不适用')) {
        resultValue = 'not_applicable';
      }
```

其余插入 `assessmentRecords.insert({...})` 逻辑不变。

- [ ] **Step 2: 类型检查**

Run: `npx vue-tsc --noEmit`
Expected: 0 错误（`item.domain` 来自 `assessment_items.domain` 字段，findMany 默认返回全部列；`presetByType` 同）

- [ ] **Step 3: 启动应用冒烟（手动）**

Run: `npm run dev`（已在运行则热重载）
Expected: 主进程无报错；数据库自动迁移补 `preset_by_type` 列成功（日志 `已为 assessment_items 添加 preset_by_type 列`，仅老库首次出现）

- [ ] **Step 4: 提交**

```bash
git add electron/ipc/asset.ipc.ts
git commit -m "feat(asset): 安全计算环境按资产类型应用预置记录"
```

---

### Task 4: 标准导入 Excel 模板增加「预置明细」子表

**Files:**
- Modify: 标准导入 Excel 模板（如 `resources/standards/...` 内置模板或生成脚本产出的 xlsx）
- Modify: `scripts/generate-industry-preset-templates.js`（若用脚本生成）

- [ ] **Step 1: 在模板中新增子表**

新增一张 sheet，命名为 `安全计算环境-预置明细`，表头行：`控制点 | 资产类型 | 符合情况 | 结果记录`。

- 每行 = 一个（控制点 × 资产类型）组合。
- `控制点` 与主 sheet（安全计算环境域）的「控制点」名称一致。
- `资产类型` 取 7 类显示名之一（网络设备 / 安全设备 / 服务器/存储设备 / 系统管理平台（数据库）/ 业务应用系统 / 业务终端/运维终端 / 数据资源）。
- `符合情况` 取值同主 sheet（符合/不符合/部分符合/不适用/未测评）；`结果记录` 为该类型对应的证据文本。

- [ ] **Step 2: 若用脚本生成，扩展 generate-industry-preset-templates.js**

在复制 BASE 模板后，对 `secure_computing` 对应 sheet 追加名为 `安全计算环境-预置明细` 的子表（可留空表头，供后续填充）。

- [ ] **Step 3: 提交**

```bash
git add <改动后的模板文件> scripts/generate-industry-preset-templates.js
git commit -m "docs(standard): 标准导入模板增加安全计算环境预置明细子表"
```

---

### Task 5: 标准导出包含「预置明细」子表（闭环）

**Files:**
- Modify: `electron/ipc/standard.ipc.ts`（导出函数，写 xlsx 处）

- [ ] **Step 1: 导出时生成子表**

在导出 Excel 的写入逻辑中，对 `secure_computing` 域：除原有域 sheet 外，额外写出 `安全计算环境-预置明细` 子表，列为 `控制点 | 资产类型 | 符合情况 | 结果记录`，数据来自 `assessment_items.preset_by_type` JSON（遍历 7 类键名展开）。

- [ ] **Step 2: 类型检查**

Run: `npx vue-tsc --noEmit`
Expected: 0 错误

- [ ] **Step 3: 提交**

```bash
git add electron/ipc/standard.ipc.ts
git commit -m "feat(standard): 导出标准时包含安全计算环境预置明细子表"
```

---

### Task 6: 验证（端到端）

**Files:** 无代码改动，使用样例 xlsx + 运行中的应用。

- [ ] **Step 1: 准备含预置明细的标准导入 xlsx**

安全计算环境域 sheet 的 `预置符合情况`/`预置结果记录` 填通用默认值；新增 `安全计算环境-预置明细` 子表，至少包含：

| 控制点（示例） | 资产类型 | 符合情况 | 结果记录 |
|---|---|---|---|
| 身份鉴别 | 网络设备 | 符合 | 网络设备已启用 AAA 认证… |
| 身份鉴别 | 服务器/存储设备 | 部分符合 | 服务器口令策略待加固… |
| 身份鉴别 | 业务终端/运维终端 | 不适用 | 不适用 |

- [ ] **Step 2: 导入该标准**

Run: 应用内 系统设置 → 标准库 → 导入标准，选择该 xlsx
Expected: 导入成功；日志无 `未知资产类型` 警告（若有，检查显示名拼写）。

- [ ] **Step 3: 校验库内 JSON**

用 SQLite 客户端（或应用内调试）查询：

```sql
SELECT control_point, preset_by_type FROM assessment_items
WHERE domain='secure_computing' AND control_point='身份鉴别' AND preset_by_type IS NOT NULL;
```

Expected: `preset_by_type` 含 `{"network_device":{...},"server_storage":{...},"terminal":{...}}` 三类。

- [ ] **Step 4: 创建项目并录入不同资产类型**

1. 新建项目，标准选刚导入的标准。
2. 录入一台 **网络设备** 资产 → 查看其安全计算环境「身份鉴别」测评项记录：应符合情况=符合、证据=网络设备文本。
3. 录入一台 **服务器** 资产 → 同一控制点：应符合情况=部分符合、证据=服务器文本（与网络设备不同）。
4. 录入一台 **终端** 资产 → 同一控制点：应=不适用。

Expected: 三类资产在安全计算环境同一控制点的预置记录各不相同，印证按资产类型区分生效。

- [ ] **Step 5: 回退与兼容校验**

1. 某资产类型在明细子表无对应行 → 该资产在该控制点回退到通用默认预置（不漏填、不报错）。
2. 老库（无 `preset_by_type` 列）启动 → 自动迁移补列，现有预置行为不变。
3. 其他域（如安全管理制度）预置行为与改动前完全一致。

- [ ] **Step 6: 提交验证结论（可选）**

若项目要求记录验证结果，可提交一份验证说明；否则此步跳过。
