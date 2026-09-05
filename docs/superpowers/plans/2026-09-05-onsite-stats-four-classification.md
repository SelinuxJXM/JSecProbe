# 现场核查统计栏四分类展示 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在现场核查页中间统计栏完整展示四分类判定数量（符合 / 部分符合 / 不符合 / 不适用），采用分组紧凑排布。

**Architecture:** 后端 `getProgress` 新增两条计数查询（部分符合、不符合，均带格内过滤）并扩展返回字段；前端统计栏模板改为 7 项 3 分隔线的分组布局，新增语义色类与深色模式适配，样式紧凑化（gap 16→10px、字号各降 1px）。

**Tech Stack:** Electron 29 + Vue 3 + TypeScript + better-sqlite3 + drizzle-orm；验证用 `npx vue-tsc --noEmit` 与 node:sqlite 只读直查。

**约束（覆盖 skill 默认行为）：**
- 用户要求「暂时不提交」——本计划**不含任何 git commit 步骤**
- 本项目无单元测试框架——用类型检查 + SQL 自洽核对 + 界面目测替代 TDD

**设计依据：** `docs/superpowers/specs/2026-09-05-onsite-stats-four-classification-design.md`

---

### Task 1: 后端 getProgress 新增部分符合 / 不符合计数

**Files:**
- Modify: `electron/ipc/assessment.ipc.ts`（L431-474 区域）

- [ ] **Step 1.1: 在「符合」查询之后插入两条新计数查询**

用精确替换（old_str 为现状代码，已核实）：

old_str:
```ts
      // 不适用
      const naRecords = await db
        .select({ value: count() })
        .from(schema.assessmentRecords)
        .where(and(
          eq(schema.assessmentRecords.projectId, projectId),
          inArray(schema.assessmentRecords.itemId, itemIdsSubquery),
          sql`result = 'not_applicable'`,
          // 只统计格内记录
          gridInFilter
        ));
```

new_str:
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

      // 不符合（覆盖新旧两种历史值写法）
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

      // 不适用
      const naRecords = await db
        .select({ value: count() })
        .from(schema.assessmentRecords)
        .where(and(
          eq(schema.assessmentRecords.projectId, projectId),
          inArray(schema.assessmentRecords.itemId, itemIdsSubquery),
          sql`result = 'not_applicable'`,
          // 只统计格内记录
          gridInFilter
        ));
```

- [ ] **Step 1.2: 扩展返回对象**

old_str:
```ts
      return {
        total,
        tested: safeTested,
        compliant,
        na,
        complianceRate,
        // untested = total - tested（tested 已包含 na，无需再减）
        untested: Math.max(0, total - safeTested),
      };
```

new_str:
```ts
      return {
        total,
        tested: safeTested,
        compliant,
        partial: partialRecords[0]?.value || 0,
        nonCompliant: nonCompliantRecords[0]?.value || 0,
        na,
        complianceRate,
        // untested = total - tested（tested 已包含 na，无需再减）
        untested: Math.max(0, total - safeTested),
      };
```

- [ ] **Step 1.3: grep 验证落盘**

Run: 在 `electron/ipc/assessment.ipc.ts` 中搜索 `partialRecords` 与 `nonCompliantRecords`，各应出现 2 处（声明 + 返回对象引用）。
Expected: `partialRecords` 2 处、`nonCompliantRecords` 2 处。

### Task 2: 前端 progress 初始对象补字段

**Files:**
- Modify: `src/views/onsite-verification/index.vue`（L343-350）

- [ ] **Step 2.1: progress 初始对象新增 partial / nonCompliant**

old_str:
```ts
const progress = ref({
  total: 0,
  tested: 0,
  compliant: 0,
  na: 0,
  complianceRate: 0,
  untested: 0,
});
```

new_str:
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

说明：接口响应赋值点（`progress.value = res.data`）无需改动，Task 1 的新字段随响应自动带入。

### Task 3: 前端统计栏模板改分组布局

**Files:**
- Modify: `src/views/onsite-verification/index.vue`（L48-70）

- [ ] **Step 3.1: 替换 toolbar-center 区块**

old_str:
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
            <span class="stat-label">符合率</span>
            <span class="stat-value rate">{{ Number(progress.complianceRate).toFixed(2) }}%</span>
          </span>
        </div>
      </div>
```

new_str:
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
          <span class="stat-item">
            <span class="stat-label">部分符合</span>
            <span class="stat-value partial">{{ progress.partial }}</span>
          </span>
          <span class="stat-item">
            <span class="stat-label">不符合</span>
            <span class="stat-value nonCompliant">{{ progress.nonCompliant }}</span>
          </span>
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

布局核对点：共 7 个 stat-item、3 个 stat-divider（总项数|已完成、已完成|符合、不适用|符合率），四分类之间无分隔线。

### Task 4: 样式紧凑化 + 新语义色类

**Files:**
- Modify: `src/views/onsite-verification/index.vue`（L1470-1510）

- [ ] **Step 4.1: 替换 .progress-stats 样式块**

old_str:
```scss
  .progress-stats {
    display: flex;
    align-items: center;
    gap: 16px;

    .stat-item {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 2px;

      .stat-label {
        font-size: 11px;
        color: var(--color-text-tertiary, #9CA3AF);
      }

      .stat-value {
        font-size: 14px;
        font-weight: 600;
        color: var(--color-text-primary, #111827);

        &.completed {
          color: #6B7280;
        }

        &.compliant {
          color: #10B981;
        }

        &.rate {
          color: var(--color-primary, #1B5FD9);
        }
      }
    }

    .stat-divider {
      width: 1px;
      height: 24px;
      background: var(--color-border-default, #E5E7EB);
    }
  }
```

new_str:
```scss
  .progress-stats {
    display: flex;
    align-items: center;
    gap: 10px;

    .stat-item {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 2px;

      .stat-label {
        font-size: 10px;
        color: var(--color-text-tertiary, #9CA3AF);
      }

      .stat-value {
        font-size: 13px;
        font-weight: 600;
        color: var(--color-text-primary, #111827);

        &.completed {
          color: #6B7280;
        }

        &.compliant {
          color: #10B981;
        }

        &.partial {
          color: #F59E0B;
        }

        &.nonCompliant {
          color: #DC2626;
        }

        &.na {
          color: #6B7280;
        }

        &.rate {
          color: var(--color-primary, #1B5FD9);
        }
      }
    }

    .stat-divider {
      width: 1px;
      height: 24px;
      background: var(--color-border-default, #E5E7EB);
    }
  }
```

### Task 5: 深色模式适配

**Files:**
- Modify: `src/views/onsite-verification/index.vue`（L2208-2215）

- [ ] **Step 5.1: 深色模式 .stat-value 覆盖块补充三个新类**

old_str:
```scss
  .stat-value {
    &.completed {
      color: var(--color-text-tertiary);
    }
    &.compliant {
      color: #34D399;
    }
  }
```

new_str:
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

注意：此 old_str 必须在深色模式区域（原 L2208 附近、位于 `border-color: rgba(212, 136, 6, 0.3);` 之后）。若替换时命中其他同名块，需确认上下文再操作。

### Task 6: 验证

**Files:**
- Create (临时): `_tmp_verify_stats.mjs`（验证后删除）
- Modify: 无

- [ ] **Step 6.1: TypeScript 类型检查**

Run: `npx vue-tsc --noEmit`
Expected: 无错误输出，退出码 0。

- [ ] **Step 6.2: SQL 自洽核对**

创建临时脚本 `_tmp_verify_stats.mjs`（node:sqlite 只读打开 `JSecProbeData/data/mlps.db`），按项目分组统计各 result 分类并核对恒等式：

```js
import { DatabaseSync } from 'node:sqlite';

const db = new DatabaseSync('JSecProbeData/data/mlps.db', { readOnly: true });

const rows = db.prepare(`
  SELECT
    project_id,
    SUM(CASE WHEN result IN ('compliant','conform') THEN 1 ELSE 0 END) AS compliant,
    SUM(CASE WHEN result = 'partial' THEN 1 ELSE 0 END) AS partial,
    SUM(CASE WHEN result IN ('non_compliant','nonconform') THEN 1 ELSE 0 END) AS nonCompliant,
    SUM(CASE WHEN result = 'not_applicable' THEN 1 ELSE 0 END) AS na,
    SUM(CASE WHEN result IN ('compliant','conform','partial','non_compliant','nonconform','not_applicable') THEN 1 ELSE 0 END) AS tested
  FROM assessment_records
  GROUP BY project_id
`).all();

let allOk = true;
for (const r of rows) {
  const ok = r.tested === r.compliant + r.partial + r.nonCompliant + r.na;
  if (!ok) allOk = false;
  console.log(r.project_id, JSON.stringify(r), ok ? 'OK' : 'MISMATCH');
}

const distinct = db.prepare(`SELECT DISTINCT result FROM assessment_records`).all();
console.log('distinct results:', distinct.map(d => d.result).join(', '));
console.log(allOk ? 'ALL OK' : 'HAS MISMATCH');
```

Run: `node _tmp_verify_stats.mjs`
Expected:
1. 每个项目行输出 OK（`tested = compliant + partial + nonCompliant + na` 恒等式成立，证明枚举无遗漏）
2. `distinct results` 只含 6 个已知值，无第五种判定值
3. 当前项目行满足 `partial + nonCompliant = tested − compliant − na`（getProgress 口径预期为 66；若直查全表口径与 66 有偏差，属格内过滤差异，以恒等式 OK 为准）

验证完成后删除临时脚本。

- [ ] **Step 6.3: 界面目测（需重启 Electron 主进程）**

用户操作：重启应用 → 进入现场核查页 → 确认：
1. 统计栏显示 7 项：总项数 | 已完成 ‖ 符合 部分符合 不符合 不适用 ‖ 符合率
2. 四分类数值与格内徽标颜色语义一致（部分符合橙、不符合红、不适用灰）
3. 符合率数值与改动前一致（算法未动）
4. 切换深色模式，四分类颜色可读
5. 默认窗口宽度下不换行、不与左右工具栏重叠

---

## Self-Review 记录

> **执行补充（2026-09-05）**：实施时 `vue-tsc` 暴露类型缺口——IPC 响应类型 `AssessmentProgress`（`shared/types.ts` L218-225）需同步新增 `partial` / `nonCompliant` 字段，已补齐后类型检查通过。该文件已加入改动清单。
>
> **执行补充 2（2026-09-05，用户复核反馈）**：用户要求「每项之间都应该有 |」，Task 3 模板已调整为 7 项 + **6 条分隔线**（四分类之间也加分隔线），实际代码与设计文档 §3.2 为准，本计划 Task 3 的 3 分隔线模板不再适用。

1. **Spec 覆盖**：设计文档 §2.2→Task 1；§2.3→Task 1；§3.1→Task 2；§3.2→Task 3；§3.3→Task 4；§3.4→Task 5；§5→Task 6。无缺口。
2. **占位符扫描**：所有代码步骤含完整 old_str/new_str，无 TBD/TODO。
3. **类型一致性**：`partial` / `nonCompliant` 在 Task 1 返回对象、Task 2 初始对象、Task 3 模板绑定、Task 4/5 样式类名（`&.partial` / `&.nonCompliant`）逐处一致；`na` 类名与既有格内徽标命名一致。
