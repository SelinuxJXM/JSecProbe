# 工作台布局重排实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 移除工作台「资产总数」统计卡，并按 16:8 统一分栏重排全部卡片，统一行距、同行等高。

**Architecture:** 仅改动 `src/views/dashboard/index.vue` 一个文件：模板调整 `el-col` 的 `span` 与删除资产总数卡，script 删除随之失效的 `Monitor` 图标导入，scoped 样式补充行距与等高规则。数据层与接口不动。

**Tech Stack:** Vue 3 `<script setup lang="ts">` + Element Plus（el-row/el-col 栅格）+ SCSS scoped 样式 + 主题 CSS 变量。

**约束：** 用户要求「暂时不提交」——本计划**不包含任何 git commit 步骤**。所有任务必须**串行执行**（同一文件多处修改并行会互相覆盖，本会话已有教训）。

---

### Task 1: 模板——删除资产总数卡，统计卡改 span 8

**Files:**
- Modify: `src/views/dashboard/index.vue`（stats-row 区域，约 L8-L53）

- [ ] **Step 1: 删除资产总数卡并将剩余 3 卡改为 span 8**

将整个 stats-row 块替换为：

```html
    <el-row :gutter="16" class="stats-row">
      <el-col :span="8">
        <div class="stat-card">
          <div class="stat-icon project">
            <el-icon><Folder /></el-icon>
          </div>
          <div class="stat-content">
            <div class="stat-value">{{ stats.projectCount }}</div>
            <div class="stat-label">项目总数</div>
          </div>
        </div>
      </el-col>
      <el-col :span="8">
        <div class="stat-card">
          <div class="stat-icon inprogress">
            <el-icon><Loading /></el-icon>
          </div>
          <div class="stat-content">
            <div class="stat-value">{{ stats.inProgressCount }}</div>
            <div class="stat-label">进行中</div>
          </div>
        </div>
      </el-col>
      <el-col :span="8">
        <div class="stat-card">
          <div class="stat-icon completed">
            <el-icon><CircleCheck /></el-icon>
          </div>
          <div class="stat-content">
            <div class="stat-value">{{ stats.completedCount }}</div>
            <div class="stat-label">已完成</div>
          </div>
        </div>
      </el-col>
    </el-row>
```

变化点：删除第 4 张卡（`stat-icon asset` + `Monitor` + `stats.assetCount` + 「资产总数」），三张卡 `:span="6"` → `:span="8"`。

- [ ] **Step 2: 确认资产总数卡已不存在**

Run: 检索 `assetCount|资产总数|Monitor` 在模板中的出现
Expected: 模板区无任何匹配（`assetCount` 仅剩 script 中 `stats.value` 赋值一处，属预期保留）

### Task 2: 模板——第 4 行改为 16:8

**Files:**
- Modify: `src/views/dashboard/index.vue`（最后一个 content-row，约 L132-L166）

- [ ] **Step 1: 等级分布卡 span 12 → 16**

定位特征：`<el-col :span="12">` 且内含「项目等级分布」卡片标题。

```html
      <el-col :span="16">
        <div class="card p-md">
          <div class="card-header">
            <span class="card-title">项目等级分布</span>
          </div>
          <v-chart class="chart" :option="levelChartOption" autoresize />
        </div>
      </el-col>
```

- [ ] **Step 2: 快捷操作卡 span 12 → 8**

定位特征：`<el-col :span="12">` 且内含「快捷操作」卡片标题。

```html
      <el-col :span="8">
        <div class="card p-md">
          <div class="card-header">
            <span class="card-title">快捷操作</span>
          </div>
```

（仅改 `el-col` 开标签的 span，卡片内部内容不变）

### Task 3: script——删除 Monitor 图标导入

**Files:**
- Modify: `src/views/dashboard/index.vue`（icons 导入块，约 L172-L181）

- [ ] **Step 1: 从导入中移除 `Monitor`**

```ts
import {
  Folder,
  Loading,
  CircleCheck,
  FolderAdd,
  Reading,
  MagicStick,
  Setting,
} from '@element-plus/icons-vue';
```

变化点：删除 `  Monitor,` 一行（仅资产总数卡引用，卡片已删）。

### Task 4: 样式——行距统一 + 同行等高

**Files:**
- Modify: `src/views/dashboard/index.vue`（scoped 样式 `.content-row` 块，约 L464-L477）

- [ ] **Step 1: 给 `.content-row` 加行距与等高，末行清零**

```scss
.content-row {
  margin-bottom: var(--spacing-lg);

  .card {
    height: 100%;
  }

  .card-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: var(--spacing-md);

    .card-title {
      font-size: var(--font-size-md);
      font-weight: var(--font-weight-semibold);
      color: var(--color-text-primary);
    }
  }
}

.content-row:last-child {
  margin-bottom: 0;
}
```

原理：`el-row` 是 flex 容器，`el-col` 默认 `align-items: stretch` 拉伸到行高，`.card { height: 100% }` 使同行矮卡补齐到与最高卡一致（底边对齐）；`:last-child` 清掉页面末行多余间距（`.page-container` 自带 `padding: var(--spacing-lg)`）。

### Task 5: 类型检查验证

- [ ] **Step 1: 运行 vue-tsc**

Run: `npx vue-tsc --noEmit`
Expected: 退出码 0，无错误（重点验证 Monitor 删除后无未定义引用、模板无残留）

- [ ] **Step 2: 人工核对清单（dev 热更新生效）**

1. 统计行 3 卡等宽铺满整行，无右侧空白
2. 第 2/3/4 行分割线位置一致（2/3 处），竖直边缘对齐
3. 同行两卡底边对齐
4. 行间距统一 24px，页面底部无多余空隙
5. 深色/浅色模式切换后显示正常
