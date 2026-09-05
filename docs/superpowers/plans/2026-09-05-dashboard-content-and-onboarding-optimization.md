# 工作台内容扩展 + 系统引导优化 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复深色模式引导弹窗与全应用主按钮样式 bug；工作台新增「项目创建趋势图 + 系统状态卡」；系统引导从 6 步扩充为 8 步并支持跨页高亮目标，视觉与动效全面走主题变量。

**Architecture:** 三层同步新增 `project:getTrend` IPC 接口（shared/types.ts → preload → project.ipc.ts）；dashboard 复用现有 ECharts 按需引入方式渲染柱+线组合图；系统状态卡复用 `update.getCurrentVersion` / `update.getStatus` / `system.listBackups` 三个既有接口；OnboardingGuide 通过步骤 `route` 字段 + `useRouter` 实现跨页定位，颜色全部替换为 variables.css 既有主题变量（单一样式源适配双主题）。

**Tech Stack:** Electron 29 + Vue 3 `<script setup>` + TypeScript + Element Plus（全量引入）+ vue-echarts/echarts 按需注册 + vue-router（hash 模式）+ drizzle-orm + better-sqlite3。

**依据规格：** `docs/superpowers/specs/2026-09-05-dashboard-content-and-onboarding-optimization-design.md`（已获用户批准）

**执行约束：**

- 所有代码修改使用精确匹配替换（old\_str → new\_str），按任务顺序执行

- **本计划不包含任何 git 提交步骤**（遵守「暂时不提交」约束）

- 无自动化测试框架：以 `npx vue-tsc --noEmit` 类型检查 + 设计文档 §5 手动验证清单作为验收手段

***

### Task 1: global.scss 深色按钮双类选择器修复

**Files:**

- Modify: `src/styles/global.scss`（L275-297 深色块内四个类型变体按钮选择器）

背景：深色块内 `.el-button--primary` 等类型变体（设置主色底）与通用 `.el-button`（L299-310，设置 `--el-button-bg-color: transparent`）优先级相同，后者靠后胜出 → 深色模式全应用主按钮变幽灵按钮。改为双类选择器提权（0-2-0），不依赖源码顺序。is-plain 组（L312-317）**保持不动**。

- [ ] **Step 1.1:** 四个类型变体选择器单类 → 双类（声明内容逐字不变）

old\_str：

```scss
  .el-button--primary {
    --el-button-bg-color: var(--color-primary);
    --el-button-border-color: var(--color-primary);
    --el-button-hover-bg-color: var(--color-primary-hover);
    --el-button-hover-border-color: var(--color-primary-hover);
    --el-button-active-bg-color: var(--color-primary-active);
    --el-button-active-border-color: var(--color-primary-active);
  }

  .el-button--success {
    --el-button-bg-color: var(--color-success, #18A957);
    --el-button-border-color: var(--color-success, #18A957);
  }

  .el-button--warning {
    --el-button-bg-color: var(--color-warning, #D48806);
    --el-button-border-color: var(--color-warning, #D48806);
  }

  .el-button--danger {
    --el-button-bg-color: var(--color-danger, #E53935);
    --el-button-border-color: var(--color-danger, #E53935);
  }
```

new\_str：

```scss
  .el-button.el-button--primary {
    --el-button-bg-color: var(--color-primary);
    --el-button-border-color: var(--color-primary);
    --el-button-hover-bg-color: var(--color-primary-hover);
    --el-button-hover-border-color: var(--color-primary-hover);
    --el-button-active-bg-color: var(--color-primary-active);
    --el-button-active-border-color: var(--color-primary-active);
  }

  .el-button.el-button--success {
    --el-button-bg-color: var(--color-success, #18A957);
    --el-button-border-color: var(--color-success, #18A957);
  }

  .el-button.el-button--warning {
    --el-button-bg-color: var(--color-warning, #D48806);
    --el-button-border-color: var(--color-warning, #D48806);
  }

  .el-button.el-button--danger {
    --el-button-bg-color: var(--color-danger, #E53935);
    --el-button-border-color: var(--color-danger, #E53935);
  }
```

- [ ] **Step 1.2:** 确认修改：`src/styles/global.scss` 中双类选择器 `.el-button.el-button--primary` 等出现 4 处；`--primary`-suffix 的单类选择器仅剩 is-plain 组（L312-315，带 `.is-plain` 后缀）不受影响

***

### Task 2: OnboardingGuide 颜色变量化与阴影适配

**Files:**

- Modify: `src/components/OnboardingGuide/index.vue`（style 区，现行号 L306-316 / L338-359 / L373-385）

全部硬编码色替换为 variables.css 既有主题变量（浅色 `:root` / 深色 `html[data-theme="dark"]` 均已定义），单一样式源自动适配双主题。阴影用 `--shadow-xl`（浅色 L57 / 深色 L145 均有定义）。

- [ ] **Step 2.1:** 卡片背景 + 阴影变量化

old\_str：

```css
.onboarding-card {
  position: absolute;
  width: 380px;
  background: #fff;
  border-radius: 16px;
  padding: 28px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
```

new\_str：

```css
.onboarding-card {
  position: absolute;
  width: 380px;
  background: var(--color-bg-card);
  border-radius: 16px;
  padding: 28px;
  box-shadow: var(--shadow-xl);
```

- [ ] **Step 2.2:** 未激活进度点 `background: #e5e7eb` → `var(--color-border-base)`

old\_str：

```css
.progress-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #e5e7eb;
  transition: all 0.3s ease;
}
```

new\_str：

```css
.progress-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--color-border-base);
  transition: all 0.3s ease;
}
```

- [ ] **Step 2.3:** 激活进度点 `background: #1B5FD9` → `var(--color-primary)`

old\_str：

```css
.progress-dot.active {
  background: #1B5FD9;
  width: 20px;
  border-radius: 4px;
}
```

new\_str：

```css
.progress-dot.active {
  background: var(--color-primary);
  width: 20px;
  border-radius: 4px;
}
```

- [ ] **Step 2.4:** 已完成进度点 `background: #18A957` → `var(--color-success)`

old\_str：

```css
.progress-dot.completed {
  background: #18A957;
}
```

new\_str：

```css
.progress-dot.completed {
  background: var(--color-success);
}
```

- [ ] **Step 2.5:** 进度文字 `color: #909399` → `var(--color-text-tertiary)`

old\_str：

```css
.progress-text {
  font-size: 12px;
  color: #909399;
}
```

new\_str：

```css
.progress-text {
  font-size: 12px;
  color: var(--color-text-tertiary);
}
```

- [ ] **Step 2.6:** 标题 `color: #1f2937` → `var(--color-text-primary)`

old\_str：

```css
.onboarding-title {
  font-size: 18px;
  font-weight: 600;
  color: #1f2937;
  margin: 0 0 12px;
}
```

new\_str：

```css
.onboarding-title {
  font-size: 18px;
  font-weight: 600;
  color: var(--color-text-primary);
  margin: 0 0 12px;
}
```

- [ ] **Step 2.7:** 正文 `color: #6b7280` → `var(--color-text-secondary)`

old\_str：

```css
.onboarding-content {
  font-size: 14px;
  line-height: 1.7;
  color: #6b7280;
  margin: 0 0 24px;
}
```

new\_str：

```css
.onboarding-content {
  font-size: 14px;
  line-height: 1.7;
  color: var(--color-text-secondary);
  margin: 0 0 24px;
}
```

***

### Task 3: 新增 project:getTrend 接口（类型 → preload → 主进程三层同步）

**Files:**

- Modify: `shared/types.ts`（ApiBridge.project 段，getStatistics 之后、create 之前）

- Modify: `electron/preload/index.ts`（project 对象，getStatistics 之后）

- Modify: `electron/ipc/project.ipc.ts`（getStatistics handler 之后、project:get 之前）

契约：返回 `{ months: string[]; created: number[]; cumulative: number[] }`；`months` 为 'YYYY-MM' 格式升序 6 个；`cumulative` 首月 = 首月新建 + 此前全部历史项目。JS 分桶（`schema.projects.createdAt` TEXT ISO → `new Date()` → YYYY-MM），不新增 SQL 聚合。`wrap` / `getDb` / `schema.projects` 均已在该文件导入；主进程统一用相对路径 `../../db/schema`（**不用** `@shared` 别名，别名仅适用于 renderer 的 Vite 配置）。

- [ ] **Step 3.1:** shared/types.ts 新增 getTrend 类型

old\_str：

```ts
      assetCount: number;
    }>>;
    create: (data: Partial<Project>) => Promise<IpcResponse<Project>>;
```

new\_str：

```ts
      assetCount: number;
    }>>;
    getTrend: () => Promise<IpcResponse<{ months: string[]; created: number[]; cumulative: number[] }>>;
    create: (data: Partial<Project>) => Promise<IpcResponse<Project>>;
```

- [ ] **Step 3.2:** preload project 对象新增 getTrend

old\_str：

```ts
    getStatistics: ipc<any>('project:getStatistics'),
    create: ipc<any>('project:create'),
```

new\_str：

```ts
    getStatistics: ipc<any>('project:getStatistics'),
    getTrend: ipc<any>('project:getTrend'),
    create: ipc<any>('project:create'),
```

- [ ] **Step 3.3:** project.ipc.ts 新增 handler

old\_str：

```ts
  );

  ipcMain.handle('project:get', wrap(async (_event, id: string) => {
```

new\_str：

```ts
  );

  ipcMain.handle('project:getTrend', wrap(async () => {
    const db = getDb();
    const rows = await db
      .select({ createdAt: schema.projects.createdAt })
      .from(schema.projects);

    const now = new Date();
    const months: string[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    }

    const createdMap: Record<string, number> = Object.fromEntries(months.map((m) => [m, 0]));
    let beforeBase = 0;
    for (const row of rows) {
      if (!row.createdAt) continue;
      const d = new Date(row.createdAt);
      if (Number.isNaN(d.getTime())) continue;
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      if (key in createdMap) {
        createdMap[key] += 1;
      } else if ((months[0] ?? '') > key) {
        beforeBase += 1;
      }
    }

    const created = months.map((m) => createdMap[m]);
    const cumulative: number[] = [];
    let running = beforeBase;
    for (const c of created) {
      running += c;
      cumulative.push(running);
    }

    return { months, created, cumulative };
  })
  );

  ipcMain.handle('project:get', wrap(async (_event, id: string) => {
```

***

### Task 4: 工作台脚本扩展（LineChart 注册 + 趋势/状态数据流）

**Files:**

- Modify: `src/views/dashboard/index.vue`（script 区，现行号 L147 / L149-166 / L188-209 / L236-272）

- [ ] **Step 4.1:** echarts/charts 引入 LineChart

old\_str：

```ts
import { PieChart, BarChart } from 'echarts/charts';
```

new\_str：

```ts
import { PieChart, BarChart, LineChart } from 'echarts/charts';
```

- [ ] **Step 4.2:** use() 注册 LineChart

old\_str：

```ts
use([PieChart, BarChart, TitleComponent, TooltipComponent, LegendComponent, GridComponent, CanvasRenderer]);
```

new\_str：

```ts
use([PieChart, BarChart, LineChart, TitleComponent, TooltipComponent, LegendComponent, GridComponent, CanvasRenderer]);
```

- [ ] **Step 4.3:** 引入 UpdateStatus 类型（沿用 settings/index.vue 的同一相对路径写法 `'../../../shared/types'`）

old\_str：

```ts
import { CanvasRenderer } from 'echarts/renderers';
```

new\_str：

```ts
import { CanvasRenderer } from 'echarts/renderers';
import type { UpdateStatus } from '../../../shared/types';
```

- [ ] **Step 4.4:** stats 初始化之后新增趋势/状态数据 ref

old\_str：

```ts
  otherLevelCount: 0,
  assetCount: 0,
});
```

new\_str：

```ts
  otherLevelCount: 0,
  assetCount: 0,
});

const trendData = ref<{ months: string[]; created: number[]; cumulative: number[] }>({
  months: [],
  created: [],
  cumulative: [],
});
const currentVersion = ref('');
const updateStatus = ref<UpdateStatus | null>(null);
const backups = ref<Array<{ name: string; path: string; size: number; timestamp: string }>>([]);
```

- [ ] **Step 4.5:** levelChartOption 之后新增趋势图 option、状态卡文案计算属性（`formatDate` 为已声明函数，可用）

old\_str：

```ts
      barWidth: '50%',
      itemStyle: { borderRadius: [4, 4, 0, 0] },
    }],
  };
});

function statusType(status: string) {
```

new\_str：

```ts
      barWidth: '50%',
      itemStyle: { borderRadius: [4, 4, 0, 0] },
    }],
  };
});

const trendChartOption = computed(() => ({
  tooltip: { trigger: 'axis' },
  legend: { bottom: '0%', left: 'center' },
  grid: { left: 60, right: 60, bottom: 60, top: 20 },
  xAxis: { type: 'category', data: trendData.value.months },
  yAxis: [
    { type: 'value', minInterval: 1, name: '新建' },
    { type: 'value', minInterval: 1, name: '累计', splitLine: { show: false } },
  ],
  series: [
    {
      name: '每月新建',
      type: 'bar',
      data: trendData.value.created,
      barWidth: '40%',
      itemStyle: { color: '#1B5FD9', borderRadius: [4, 4, 0, 0] },
    },
    {
      name: '累计项目',
      type: 'line',
      yAxisIndex: 1,
      data: trendData.value.cumulative,
      smooth: true,
      itemStyle: { color: '#18A957' },
    },
  ],
}));

const hasTrendData = computed(() => trendData.value.cumulative.some((v) => v > 0));

const updateStatusText = computed(() => {
  const s = updateStatus.value;
  if (!s) return '-';
  switch (s.status) {
    case 'checking':
      return '检查中';
    case 'downloading':
      return `下载中 ${Math.round(s.downloadProgress || 0)}%`;
    case 'available':
      return s.version ? `有新版本 v${s.version}` : '有新版本';
    case 'downloaded':
      return '待安装';
    case 'error':
      return '更新异常';
    case 'idle':
    case 'notavailable':
    default:
      return '已是最新';
  }
});

const lastBackupText = computed(() => {
  const first = backups.value[0];
  if (!first?.timestamp) return '暂无备份';
  const d = new Date(first.timestamp);
  if (Number.isNaN(d.getTime())) return '暂无备份';
  return formatDate(first.timestamp);
});

const backupCount = computed(() => backups.value.length);

function statusType(status: string) {
```

- [ ] **Step 4.6:** loadData 的 Promise.all 追加三个接口

old\_str：

```ts
    const [listRes, statsRes] = await Promise.all([
      window.api.project.list({ page: 1, pageSize: 5 }),
      window.api.project.getStatistics(),
    ]);
```

new\_str：

```ts
    const [listRes, statsRes, trendRes, versionRes, statusRes, backupsRes] = await Promise.all([
      window.api.project.list({ page: 1, pageSize: 5 }),
      window.api.project.getStatistics(),
      window.api.project.getTrend(),
      window.api.update.getCurrentVersion(),
      window.api.update.getStatus(),
      window.api.system.listBackups(),
    ]);
```

- [ ] **Step 4.7:** loadData 结果解包（沿用文件内既有 `if (res.success && res.data)` 模式）

old\_str：

```ts
        otherLevelCount: statsRes.data.otherLevelCount,
        assetCount: statsRes.data.assetCount,
      };
    }
  } catch (err) {
```

new\_str：

```ts
        otherLevelCount: statsRes.data.otherLevelCount,
        assetCount: statsRes.data.assetCount,
      };
    }

    if (trendRes.success && trendRes.data) {
      trendData.value = trendRes.data;
    }

    if (versionRes.success && versionRes.data) {
      currentVersion.value = versionRes.data;
    }

    if (statusRes.success && statusRes.data) {
      updateStatus.value = statusRes.data;
    }

    if (backupsRes.success && backupsRes.data) {
      backups.value = backupsRes.data;
    }
  } catch (err) {
```

***

### Task 5: 工作台新行（趋势图左列 + 系统状态卡右列）模板与样式

**Files:**

- Modify: `src/views/dashboard/index.vue`（模板 L90-96 之间插入新行；style 区 `.quick-actions` 之前插入新样式）

- [ ] **Step 5.1:** 在「最近项目/状态饼图」行与「等级分布/快捷操作」行之间插入新行（左 span16 趋势图 + 右 span8 状态卡；`$router` 模板用法与现有快捷操作一致）

old\_str：

```html
          <v-chart class="chart" :option="statusChartOption" autoresize />
        </div>
      </el-col>
    </el-row>

    <el-row :gutter="16" class="content-row">
      <el-col :span="12">
```

new\_str：

```html
          <v-chart class="chart" :option="statusChartOption" autoresize />
        </div>
      </el-col>
    </el-row>

    <el-row :gutter="16" class="content-row">
      <el-col :span="16">
        <div class="card p-md">
          <div class="card-header">
            <span class="card-title">项目创建趋势（近 6 个月）</span>
          </div>
          <v-chart v-if="hasTrendData" class="chart" :option="trendChartOption" autoresize />
          <el-empty v-else description="暂无数据" :image-size="80" />
        </div>
      </el-col>
      <el-col :span="8">
        <div class="card p-md system-status-card" @click="$router.push('/settings')">
          <div class="card-header">
            <span class="card-title">系统状态</span>
          </div>
          <div class="status-list">
            <div class="status-item">
              <span class="status-label">当前版本</span>
              <span class="status-value">{{ currentVersion || '-' }}</span>
            </div>
            <div class="status-item">
              <span class="status-label">更新状态</span>
              <span class="status-value">{{ updateStatusText }}</span>
            </div>
            <div class="status-item">
              <span class="status-label">最近备份</span>
              <span class="status-value">{{ lastBackupText }}</span>
            </div>
            <div class="status-item">
              <span class="status-label">备份份数</span>
              <span class="status-value">{{ backupCount }} 份</span>
            </div>
          </div>
        </div>
      </el-col>
    </el-row>

    <el-row :gutter="16" class="content-row">
      <el-col :span="12">
```

- [ ] **Step 5.2:** 状态卡样式（scss 嵌套，与文件内既有风格一致；全部走主题变量）

old\_str：

```scss
.quick-actions {
  display: grid;
```

new\_str：

```scss
.system-status-card {
  cursor: pointer;
  transition: all 0.2s;

  &:hover {
    border-color: var(--color-primary);
    transform: translateY(-2px);
  }
}

.status-list {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-md);

  .status-item {
    display: flex;
    justify-content: space-between;
    align-items: center;

    .status-label {
      font-size: var(--font-size-sm);
      color: var(--color-text-tertiary);
    }

    .status-value {
      font-size: var(--font-size-sm);
      color: var(--color-text-primary);
      font-weight: var(--font-weight-semibold);
    }
  }
}

.quick-actions {
  display: grid;
```

***

### Task 6: 状态饼图描边深色适配

**Files:**

- Modify: `src/views/dashboard/index.vue`（script 区 statusChartOption，现行号 L168-175）

检测 `html` 的 `dark` class（主题机制下 dark class 与 data-theme 属性同时切换）：深色取 `#1E293B`（variables.css 深色 `--color-bg-card` 值）、浅色保持 `#fff`。

- [ ] **Step 6.1:** borderColor 主题化

old\_str：

```ts
const statusChartOption = computed(() => ({
  tooltip: { trigger: 'item', formatter: '{b}: {c} ({d}%)' },
  legend: { bottom: '0%', left: 'center' },
  series: [{
    type: 'pie',
    radius: ['40%', '70%'],
    avoidLabelOverlap: false,
    itemStyle: { borderRadius: 8, borderColor: '#fff', borderWidth: 2 },
```

new\_str：

```ts
const isDark = computed(() => document.documentElement.classList.contains('dark'));

const statusChartOption = computed(() => ({
  tooltip: { trigger: 'item', formatter: '{b}: {c} ({d}%)' },
  legend: { bottom: '0%', left: 'center' },
  series: [{
    type: 'pie',
    radius: ['40%', '70%'],
    avoidLabelOverlap: false,
    itemStyle: { borderRadius: 8, borderColor: isDark.value ? '#1E293B' : '#fff', borderWidth: 2 },
```

***

### Task 7: OnboardingGuide 8 步重构 + 跨页路由 + 动效升级

**Files:**

- Modify: `src/components/OnboardingGuide/index.vue`（模板 L12-54；script L61/L69-87/L94-135/L213-231；style 区追加）

不变量：localStorage 键 `jsecprobe_onboarding_completed` 不变；`defineExpose({ start, restart })` 不变；Teleport + 聚光灯实现不变；resize 监听不变；MainLayout 调用点零改动。

- [ ] **Step 7.1:** 引入 vue-router（该文件现无 router 导入）

old\_str：

```ts
import { ref, computed, onMounted, onBeforeUnmount, nextTick } from 'vue';
```

new\_str：

```ts
import { ref, computed, onMounted, onBeforeUnmount, nextTick } from 'vue';
import { useRouter } from 'vue-router';
```

- [ ] **Step 7.2:** 创建 router 实例（置于 icons 导入之后）

old\_str：

```ts
  Bell,
  Pointer,
} from '@element-plus/icons-vue';
```

new\_str：

```ts
  Bell,
  Pointer,
} from '@element-plus/icons-vue';

const router = useRouter();
```

- [ ] **Step 7.3:** OnboardingStep 接口新增 route 字段

old\_str：

```ts
interface OnboardingStep {
  target?: string; // CSS 选择器
  icon?: string;
```

new\_str：

```ts
interface OnboardingStep {
  target?: string; // CSS 选择器
  route?: string;
  icon?: string;
```

- [ ] **Step 7.4:** steps 数组 6 步 → 8 步（选择器均已核实：projects 页 `.toolbar`、ai-assistant `.ai-container`、knowledge 页 `.kb-card`、MainLayout `.sidebar-menu` / `.header-right`；末步文案按设计文档修正为「随时可点击右上角头像菜单 → 查看引导 重新观看」）

old\_str：

```ts
const steps: OnboardingStep[] = [
  {
    icon: 'Pointer',
    title: '欢迎使用 JSecProbe',
    content: '等级保护现场测评系统，支持等保2.0标准，提供智能AI辅助测评、一键生成分析报告等功能。接下来带您快速了解系统的主要功能。',
    position: 'center',
  },
  {
    target: '.sidebar-menu',
    icon: 'DataLine',
    title: '导航菜单',
    content: '通过左侧导航栏可以快速切换各个功能模块：工作台查看数据概览、项目管理测评项目、AI助手辅助分析、知识库查阅标准文档。',
    position: 'right',
  },
  {
    target: '.stats-row',
    icon: 'DataLine',
    title: '数据概览',
    content: '工作台展示项目统计数据和趋势图表，包括项目总数、进行中、已完成等状态分布，帮助您快速掌握整体测评进度。',
    position: 'bottom',
  },
  {
    target: '.toolbar',
    icon: 'Folder',
    title: '项目管理',
    content: '在项目列表中创建、导入、导出项目。支持批量操作和自定义字段，方便管理多个测评项目。',
    position: 'bottom',
  },
  {
    target: '.header-right',
    icon: 'Bell',
    title: '功能入口',
    content: '顶部栏提供系统通知、帮助文档和个人中心入口。个人中心可以修改密码和查看账户信息。',
    position: 'left',
  },
  {
    icon: 'MagicStick',
    title: '开始您的测评之旅',
    content: '现在您已经了解了系统的基本功能，可以开始创建您的第一个测评项目了！如需再次查看引导，可以在个人中心中重新触发。',
    position: 'center',
  },
];
```

new\_str：

```ts
const steps: OnboardingStep[] = [
  {
    icon: 'Pointer',
    title: '欢迎使用 JSecProbe',
    content: '等级保护现场测评系统，支持等保2.0标准，提供智能AI辅助测评、一键生成分析报告等功能。接下来带您快速了解系统的主要功能。',
    position: 'center',
  },
  {
    target: '.sidebar-menu',
    route: '/dashboard',
    icon: 'DataLine',
    title: '导航菜单',
    content: '通过左侧导航栏可以快速切换各个功能模块，接下来带您逐一了解每个模块的作用。',
    position: 'right',
  },
  {
    target: '.stats-row',
    icon: 'DataLine',
    title: '数据概览',
    content: '工作台集中展示项目统计、创建趋势和状态分布，帮助您快速掌握整体测评进度。',
    position: 'bottom',
  },
  {
    target: '.toolbar',
    route: '/projects/list',
    icon: 'Folder',
    title: '项目管理',
    content: '在项目列表中创建、导入、导出测评项目，支持批量操作和自定义字段，方便管理多个测评项目。',
    position: 'bottom',
  },
  {
    target: '.ai-container',
    route: '/ai-assistant',
    icon: 'MagicStick',
    title: 'AI 助手',
    content: '智能 AI 辅助分析测评结果，自动生成风险建议，大幅提升现场测评效率。',
    position: 'left',
  },
  {
    target: '.kb-card',
    route: '/knowledge',
    icon: 'Reading',
    title: '知识库',
    content: '内置等保 2.0 标准文档与测评知识，测评过程中可随时查阅相关标准要求。',
    position: 'left',
  },
  {
    target: '.header-right',
    icon: 'Bell',
    title: '功能入口',
    content: '顶部栏提供系统通知、帮助文档和个人中心入口。个人中心可以修改密码和查看账户信息。',
    position: 'left',
  },
  {
    icon: 'MagicStick',
    title: '开始您的测评之旅',
    content: '现在您已经了解了系统的基本功能，可以开始创建您的第一个测评项目了！如需再次查看引导，随时可点击右上角头像菜单 → 查看引导 重新观看。',
    position: 'center',
  },
];
```

- [ ] **Step 7.5:** Template 卡片容器补全 class（为卡片进入动效挂类；`:class` 现为 `currentStep?.target ? 'with-target' : 'welcome'`）

old\_str：

```html
        <div
          class="onboarding-card"
          :class="currentStep?.target ? 'with-target' : 'welcome'"
          :style="cardStyle"
        >
```

new\_str：

```html
        <div
          class="onboarding-card"
          :class="[currentStep?.target ? 'with-target' : 'welcome', { 'is-entering': isEntering }]"
          :style="cardStyle"
        >
```

- [ ] **Step 7.6:** script 新增 isEntering 状态 + 步骤路由切换逻辑

old\_str：

```ts
const visible = ref(false);
const currentStepIndex = ref(0);
const spotlightStyle = ref<Record<string, string>>({});
const cardStyle = ref<Record<string, string>>({});
```

new\_str：

```ts
const visible = ref(false);
const currentStepIndex = ref(0);
const isEntering = ref(false);
const spotlightStyle = ref<Record<string, string>>({});
const cardStyle = ref<Record<string, string>>({});

async function ensureRoute(step: OnboardingStep) {
  if (!step.route) return;
  if (router.currentRoute.value.path === step.route) return;
  await router.push(step.route);
  // 等待路由切换 + 页面首屏渲染
  await new Promise((resolve) => setTimeout(resolve, 400));
}
```

- [ ] **Step 7.7:** nextStep / prevStep 改为异步，跨页时先跳路由再定位（同一步骤内路由不变则跳过 push）

old\_str：

```ts
function nextStep() {
  if (currentStepIndex.value < steps.length - 1) {
    currentStepIndex.value++;
    nextTick(() => {
      calculatePosition();
    });
  } else {
    completeGuide();
  }
}

function prevStep() {
  if (currentStepIndex.value > 0) {
    currentStepIndex.value--;
    nextTick(() => {
      calculatePosition();
    });
  }
}
```

new\_str：

```ts
function nextStep() {
  if (currentStepIndex.value < steps.length - 1) {
    currentStepIndex.value++;
    enterStep();
  } else {
    completeGuide();
  }
}

function prevStep() {
  if (currentStepIndex.value > 0) {
    currentStepIndex.value--;
    enterStep();
  }
}

async function enterStep() {
  const step = currentStep.value;
  isEntering.value = false;
  await nextTick();
  if (step) {
    await ensureRoute(step);
  }
  isEntering.value = true;
  calculatePosition();
}
```

- [ ] **Step 7.8:** startGuide / restartGuide 复用 enterStep（保持不变量：startGuide 仍检查 localStorage 标记）

old\_str：

```ts
function startGuide() {
  if (localStorage.getItem('jsecprobe_onboarding_completed') === 'true') {
    return;
  }
  visible.value = true;
  currentStepIndex.value = 0;
  nextTick(() => {
    calculatePosition();
  });
}

function restartGuide() {
  visible.value = true;
  currentStepIndex.value = 0;
  nextTick(() => {
    calculatePosition();
  });
}
```

new\_str：

```ts
function startGuide() {
  if (localStorage.getItem('jsecprobe_onboarding_completed') === 'true') {
    return;
  }
  visible.value = true;
  currentStepIndex.value = 0;
  enterStep();
}

function restartGuide() {
  visible.value = true;
  currentStepIndex.value = 0;
  enterStep();
}
```

- [ ] **Step 7.9:** style 区追加动效（普通 `<style scoped>`，**禁止嵌套**；结合 prefers-reduced-motion 尊重系统设置）

old\_str：

```css
/* 过渡动画 */
.onboarding-fade-enter-active,
.onboarding-fade-leave-active {
  transition: opacity 0.3s ease;
}

.onboarding-fade-enter-from,
.onboarding-fade-leave-to {
  opacity: 0;
}
```

new\_str：

```css
/* 过渡动画 */
.onboarding-fade-enter-active,
.onboarding-fade-leave-active {
  transition: opacity 0.3s ease;
}

.onboarding-fade-enter-from,
.onboarding-fade-leave-to {
  opacity: 0;
}

/* 步骤内容进入动效：fade + 上移 8px + 轻微缩放 */
.onboarding-card.is-entering {
  animation: onboarding-card-in 0.2s ease;
}

@keyframes onboarding-card-in {
  from {
    opacity: 0;
    transform: translateY(8px) scale(0.96);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

/* 欢迎图标上下浮动 */
.onboarding-card.welcome .onboarding-icon {
  animation: onboarding-icon-float 2.4s ease-in-out infinite;
}

@keyframes onboarding-icon-float {
  0%,
  100% {
    transform: translateY(0);
  }
  50% {
    transform: translateY(-6px);
  }
}

/* 尊重系统减弱动效偏好 */
@media (prefers-reduced-motion: reduce) {
  .onboarding-card.is-entering {
    animation: none;
  }
  .onboarding-card.welcome .onboarding-icon {
    animation: none;
  }
}
```

> 注：`.onboarding-card.is-entering` 动画定义在 scoped 内，`keyframes` 名称须在全局唯一；此处命名 `onboarding-card-in` / `onboarding-icon-float` 无冲突。

***

### Task 8: 类型检查与手动验证

**Files:**

- None（仅验证）

- [ ] **Step 8.1:** 运行 TypeScript 类型检查

Run: `npx vue-tsc --noEmit`
Expected: 退出码 0，无错误输出

- [ ] **Step 8.2:** 按设计文档 §5 手动验证清单回归
  1. **深色模式**：引导弹窗（含全部 8 步）深色卡片、主按钮实色、进度点可见；全应用主按钮抽查（工具栏 / 对话框 / 登录页）底色恢复主色；工作台饼图无白色描边圈
  2. **引导流程**：清 localStorage 后首次进入自动开始；逐步「下一步」可跨页高亮 `.toolbar` / `.ai-container` / `.kb-card`；「跳过」与最后一步「完整」正常写标记；顶栏下拉「查看引导」可重新开始
  3. **趋势图**：数字与项目列表实际月份分布一致（抽查 1-2 个月份）；全新环境无数据不报错（显示「暂无数据」）
  4. **系统状态卡**：版本号与 `package.json` 一致；备份行在有备份 / 无备份两种状态下展示正确；点击卡片跳转 `/settings`
  5. **浅色回归**：全流程浅色模式过一遍，与改动前无差异

***

## Self-Review（写入时执行）

**1. Spec coverage — 规格 §1→§6 逐条对任务：**

- §2.1 global.scss 双类选择器 → Task 1 ✅

- §2.2 引导七色变量化 → Task 2（Step 2.1-2.7）✅

- §3.2.1 getTrend 接口三层同步 → Task 3（Step 3.1-3.3）✅

- §3.2.2 趋势图渲染 + 空数据「暂无数据」→ Task 4（Step 4.1/4.2/4.5）+ Task 5（Step 5.1）✅

- §3.3 系统状态卡三接口集成 + 文案映射 + 备份要点 + 卡片可点击 → Task 4（Step 4.3-4.7）+ Task 5 ✅

- §3.4 饼图描边深色适配 → Task 6 ✅

- §4.1 跨页机制（route/400ms/居中兜底/不强制跳回）→ Task 7（Step 7.6/7.7；居中兜底已在 calculatePosition L154-161 既有实现，复用）✅

- §4.2 8 步流程 + 末步文案修正 → Task 7（Step 7.4）✅

- §4.4 动效 5 项 → Task 7（Step 7.5/7.6/7.7/7.9 + Task 2 进度点变量色）✅

- §5 验证 → Task 8 ✅

**2. Placeholder scan:** 无 TBD/TODO/"similar to"；所有代码步骤均含完整代码；无引用未定义类型（`UpdateStatus` 在 Step 4.3 导入、`isEntering`/`ensureRoute`/`enterStep` 在 Step 7.6-7.7 定义后有使用）。

**3. Type consistency:**

- `getTrend` 返回类型 `{ months: string[]; created: number[]; cumulative: number[] }` 在 Step 3.1（types.ts）、Step 3.2（preload）、Step 3.3（handler）、Step 4.4（trendData ref）四处一致 ✅

- `UpdateStatus` import 路径 `'../../../shared/types'`（Step 4.3）与其他 src/views 页面一致 ✅

- `currentVersion` / `updateStatus` / `backups` / `updateStatusText` / `lastBackupText` / `backupCount` / `hasTrendData` / `trendChartOption` / `isDark` 命名在模板（Step 5.1）与 script（Step 4) 中用名一致 ✅

- 模板 `$router.push('/settings')`（Step 5.1）与既有快捷操作 `$router.push` 用法一致 ✅

- 引导 `route` 字段名在接口（Step 7.3）与 steps（Step 7.4）及 `ensureRoute`（Step 7.6）中一致 ✅

***

## Execution Handoff

计划已写入 `docs/superpowers/plans/2026-09-05-dashboard-content-and-onboarding-optimization.md`。两种执行方式：

1. **Subagent-Driven（推荐）** — 每个 Task 派发独立子代理，任务间 review，快速迭代
2. **Inline Execution** — 在本次会话内用 executing-plans 批量执行，带检查点 review

