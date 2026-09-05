# 设计文档：现场核查页统计栏四分类展示

- 日期：2026-09-05

- 状态：已获用户批准（方案 A · 分组紧凑排布），待实施

- 范围：现场核查页顶部统计栏 + 后端 getProgress 统计接口

## 1. 背景与目标

现场核查页中间统计栏目前仅展示 4 项：`总项数 | 已完成 | 符合 | 符合率`。测评结果实际有四类判定（符合 / 部分符合 / 不符合 / 不适用），用户希望把「部分符合」「不适用」也展示出来，并确认「不符合」一并加上，做到四分类齐全。

用户明确要求：新增项会导致顶栏拥挤，**布局需要紧凑**。

### 目标

1. 统计栏完整展示四分类判定数量：符合、部分符合、不符合、不适用
2. 新增项配色与格内结果徽标语义一致，视觉可对应
3. 紧凑排布，避免顶栏换行或溢出
4. 符合率算法不变

### 非目标（明确不做）

- 不改动项目概览页等其他页面的统计展示

- 不改动符合率口径（仍为 `符合 ÷ (已完成 − 不适用)`，等保惯例剔除不适用）

- 不改动「已完成」的判定范围（仍含四类结果）

## 2. 后端改动：`electron/ipc/assessment.ipc.ts`

### 2.1 现状

`getProgress`（约 L420-476）现有三条计数查询（已测评 / 符合 / 不适用），返回对象为：

```ts
{ total, tested: safeTested, compliant, na, complianceRate, untested }
```

缺少 `partial`（部分符合）与 `nonCompliant`（不符合）两个计数。

### 2.2 新增两条计数查询

在「符合」查询（L432-441）之后、「不适用」查询（L444-453）之前，插入两条查询，**完全沿用既有 SQL 模式**（同条件三件套 + 格内过滤）：

```ts
// 部分符合
const partialRecords = await db
  .select({ value: count() })
  .from(schema.assessmentRecords)
  .where(and(
    eq(schema.assessmentRecords.projectId, projectId),
    inArray(schema.assessmentRecords.itemId, itemIdsSubquery),
    sql`result = 'partial'`,
    // 只统计格内记录
    gridInFilter
  ));

// 不符合
const nonCompliantRecords = await db
  .select({ value: count() })
  .from(schema.assessmentRecords)
  .where(and(
    eq(schema.assessmentRecords.projectId, projectId),
    inArray(schema.assessmentRecords.itemId, itemIdsSubquery),
    sql`result IN ('non_compliant', 'nonconform')`,
    // 只统计格内记录
    gridInFilter
  ));
```

说明：结果值命名存在新旧两种写法（历史数据 `nonconform`，部分数据 `non_compliant`），与「已测评」查询（L427）中枚举的两写法保持一致，两种都计入。

### 2.3 返回对象扩展（L466-474）

```ts
return {
  total,
  tested: safeTested,
  compliant,
  partial: partialRecords[0]?.value || 0,
  nonCompliant: nonCompliantRecords[0]?.value || 0,
  na,
  complianceRate,
  untested: Math.max(0, total - safeTested),
};
```

`complianceRate` 计算逻辑（L458-461）**不动**。

### 2.4 共享类型同步：`shared/types.ts`

`AssessmentProgress` 接口（L218-225）同步新增 `partial: number;` 与 `nonCompliant: number;`，与 IPC 返回对象字段一致。（实施阶段 `vue-tsc` 发现的类型缺口，已补齐）

## 3. 前端改动：`src/views/onsite-verification/index.vue`

### 3.1 progress 初始对象（L343-350）

新增两个字段，保证首次渲染前模板访问不报错：

```ts
const progress = ref({
  total: 0,
  tested: 0,
  compliant: 0,
  partial: 0,
  nonCompliant: 0,
  na: 0,
  complianceRate: 0,
  untested: 0,
});
```

接口响应赋值点（约 L1049 `progress.value = res.data`）无需改动，新字段随响应自动带入。

### 3.2 模板改造（L48-70）：方案 A 分组紧凑排布

布局结构（用户复核后调整）：`总项数 | 已完成 | 符合 | 部分符合 | 不符合 | 不适用 | 符合率`

- 分隔线共 **6 条**，**每两项之间都有分隔线**（用户明确要求「每项之间都应该有 |」）

```html
<div class="toolbar-center">
  <div class="progress-stats">
    <span class="stat-item">
      <span class="stat-label">总项数</span>
      <span class="stat-value">{{ progress.total }}</span>
    </span>
    <span class="stat-divider" />
    <span class="stat-item">
      <span class="stat-label">已完成</span>
      <span class="stat-value completed">{{ progress.tested }}</span>
    </span>
    <span class="stat-divider" />
    <span class="stat-item">
      <span class="stat-label">符合</span>
      <span class="stat-value compliant">{{ progress.compliant }}</span>
    </span>
    <span class="stat-divider" />
    <span class="stat-item">
      <span class="stat-label">部分符合</span>
      <span class="stat-value partial">{{ progress.partial }}</span>
    </span>
    <span class="stat-divider" />
    <span class="stat-item">
      <span class="stat-label">不符合</span>
      <span class="stat-value nonCompliant">{{ progress.nonCompliant }}</span>
    </span>
    <span class="stat-divider" />
    <span class="stat-item">
      <span class="stat-label">不适用</span>
      <span class="stat-value na">{{ progress.na }}</span>
    </span>
    <span class="stat-divider" />
    <span class="stat-item">
      <span class="stat-label">符合率</span>
      <span class="stat-value rate">{{ Number(progress.complianceRate).toFixed(2) }}%</span>
    </span>
  </div>
</div>
```

### 3.3 样式改造（L1470-1510）：紧凑化

1. `.progress-stats` 间距 `gap: 16px` → `gap: 10px`
2. `.stat-label` 字号 `11px` → `10px`
3. `.stat-value` 字号 `14px` → `13px`
4. `.stat-value` 新增三个语义色类（取色与格内结果徽标一致）：

```scss
&.partial {
  color: #F59E0B;
}

&.nonCompliant {
  color: #DC2626;
}

&.na {
  color: #6B7280;
}
```

### 3.4 深色模式适配（L2208-2215）

现有深色覆盖块仅有 `.completed` 与 `.compliant`（#34D399）。同步补充三个新类的深色适配：

```scss
.stat-value {
  &.completed {
    color: var(--color-text-tertiary);
  }
  &.compliant {
    color: #34D399;
  }
  &.partial {
    color: #FBBF24;
  }
  &.nonCompliant {
    color: #F87171;
  }
  &.na {
    color: #9CA3AF;
  }
}
```

深色取色原则：与亮色同色相、提高明度以保证对比度（参考既有 `.compliant` 从 #10B981 → #34D399 的处理方式）。

### 3.5 配色对照表

| 分类   | 亮色（统计值）       | 深色（统计值）       | 与格内徽标关系                   |
| ---- | ------------- | ------------- | ------------------------- |
| 符合   | #10B981（现状不变） | #34D399（现状不变） | 徽标为 #16A34A，统计值沿用现有更亮的既定色 |
| 部分符合 | #F59E0B       | #FBBF24       | 与徽标 .partial 同色           |
| 不符合  | #DC2626       | #F87171       | 与徽标 .nonconform 同色        |
| 不适用  | #6B7280       | #9CA3AF       | 与徽标 .na 同色                |

## 4. 不变量（验证时必须确认未变）

1. `complianceRate = compliant ÷ max(0, tested − na)` 算法不动
2. `tested`（已完成）口径不动：已含四类判定结果
3. 项目概览页等其他页面不受影响
4. 四分类与已完成的自洽关系：`符合 + 部分符合 + 不符合 + 不适用 = 已完成`（仅当 tested 未被防御性截断时成立）

## 5. 验证方案

1. **类型检查**：`npx vue-tsc --noEmit` 零错误
2. **数据自洽核对**（node:sqlite 只读直查 `JSecProbeData/data/mlps.db`）：

   - 分别按 `result = 'partial'`、`result IN ('non_compliant','nonconform')` 计数

   - 预期：`部分符合 + 不符合 = 已完成(551) − 符合(191) − 不适用(294) = 66`

   - 若不等于 66，说明存在历史脏数据或格内外口径差异，需回到查询条件排查
3. **界面验证**（需重启 Electron 主进程生效）：保存任意一条「部分符合」或「不符合」记录后，对应统计值 +1；「不适用」数量与原页面记录数一致
4. **紧凑性目测**：7 项统计在默认窗口宽度下不换行、不与左右工具栏重叠

## 6. 风险与权衡

- **顶栏宽度**：方案 A 已通过紧凑样式（gap 10px、字号降 1px、组内无分隔线）压缩宽度；若在极窄窗口仍拥挤，后续可考虑用短标签（如「符合/部分/不符/不适用」）——本期不做

- **命名兼容**：不符合的两种历史值写法（`non_compliant` / `nonconform`）已同时覆盖，与「已测评」枚举一致，无遗漏风险

- **响应式数据**：progress 初始对象与接口返回字段一一对应，无类型缺口

