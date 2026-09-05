# 设计文档：工作台内容扩展 + 系统引导优化（含深色模式修复）

- 日期：2026-09-05

- 状态：已获用户批准（趋势图 + 系统状态卡；引导做跨页修复 + 扩充步骤 + 视觉动效升级；深色修复为必修项），待实施

- 范围：工作台页（dashboard）+ OnboardingGuide 组件 + 全局深色样式（global.scss）+ 主进程新增 getTrend 接口

## 1. 背景与目标

用户反馈两件事：

1. **工作台内容偏少**，希望展示更多内容（用户选择：项目趋势图 + 系统状态卡）；
2. **系统引导需优化**（用户选择：跨页步骤修复 + 扩充引导步骤 + 视觉与动效升级），且**引导弹窗在深色模式下显示有问题**（截图：欢迎弹窗白底卡片、「下一步」按钮几乎不可见）。

### 截图问题根因（两层）

- **引导卡片硬编码浅色**：OnboardingGuide 卡片 `#fff`、标题 `#1f2937`、正文 `#6b7280` 等全部写死，深色模式下出现刺眼白卡。

- **全局按钮深色级联 bug**：`global.scss` 深色块中，类型变体 `.el-button--primary`（L275-282，设置主色底）与通用 `.el-button`（L299-310，设置透明底）优先级相同，后者在源码中靠后而胜出 → **深色模式下全应用的主按钮都被渲染成幽灵按钮**。截图中「下一步」不可见正是两者叠加的结果。

### 目标

1. 深色模式下引导弹窗完整可用，全应用深色主按钮恢复正常底色
2. 工作台新增项目趋势图（近 6 个月新建柱 + 累计线）与系统状态卡（版本 / 更新状态 / 最近备份）
3. 引导从 6 步扩充为 8 步，修复跨页目标丢失问题，文案与真实入口一致
4. 引导视觉与动效升级，全部颜色走主题变量

### 非目标（明确不做）

- 不做「测评完成趋势」：projects 表**无 completedAt 字段**（schema.ts L18-40 仅 createdAt/updatedAt/status），拒绝用 updatedAt 造不真实的数据

- 不做跨项目问题风险统计：issue:list 强制要求 projectId（issue.ipc.ts），新增跨项目问题聚合接口超出本期范围

- 现场核查页不纳入引导流程：需项目 id 上下文，从工作台直接跳转无意义

- 不改动自动启动时机（MainLayout onMounted 后 500ms，L403-405）

## 2. 深色模式修复

### 2.1 global.scss：类型变体按钮提权（src/styles/global.scss L275-310）

将深色块内四个类型变体的单类选择器改为**双类选择器**，优先级高于通用 `.el-button`，不依赖源码书写顺序：

```scss
// 修改前
.el-button--primary { ... }
.el-button--success { ... }
.el-button--warning { ... }
.el-button--danger { ... }

// 修改后（其余声明内容不变）
.el-button.el-button--primary { ... }
.el-button.el-button--success { ... }
.el-button.el-button--warning { ... }
.el-button.el-button--danger { ... }
```

此修复使全应用深色模式主按钮恢复正常（登录页、工具栏、对话框等一并受益）。

### 2.2 OnboardingGuide 颜色变量化（src/components/OnboardingGuide/index.vue）

全部硬编码色替换为 variables.css 既有主题变量（浅色 :root / 深色 L101+），**单一样式源自动适配双主题**，不写两套深色覆盖：

| 位置（现行号）   | 现硬编码      | 替换为                           |
| --------- | --------- | ----------------------------- |
| 卡片背景 L309 | `#fff`    | `var(--color-bg-card)`        |
| 标题 L376   | `#1f2937` | `var(--color-text-primary)`   |
| 正文 L383   | `#6b7280` | `var(--color-text-secondary)` |
| 进度点 L342  | `#e5e7eb` | `var(--color-border-base)`    |
| 激活点 L347  | `#1B5FD9` | `var(--color-primary)`        |
| 已完成点 L353 | `#18A957` | `var(--color-success)`        |
| 进度文字 L358 | `#909399` | `var(--color-text-tertiary)`  |

### 2.3 验证点

- 深色模式：欢迎弹窗深色卡片、「下一步」为实色主色按钮；浅色模式回归无变化

- 深色模式全应用抽查：工具栏主按钮、对话框确认按钮底色恢复

## 3. 工作台扩展（src/views/dashboard/index.vue）

### 3.1 布局

现有结构保留（4 统计卡 / 最近项目表 / 状态饼图 + 等级柱图 / 快捷操作），在「最近项目」区域下方新增一行：

- **左：项目趋势图**（el-col :span="16"）

- **右：系统状态卡**（el-col :span="8"）

### 3.2 项目趋势图

近 6 个月「每月新建项目数」柱状 + 「累计项目数」折线组合图，复用现有 ECharts 引入方式。

#### 3.2.1 新增后端接口 `project:getTrend`（electron/ipc/project.ipc.ts）

- handler 内直接查询 `schema.projects.createdAt`，按月 JS 分桶（不新增 SQL 聚合函数，与文件内其他 handler 风格一致）

- 返回结构：

```ts
{
  months: string[],      // 如 '2026-04'，升序 6 个
  created: number[],     // 每月新建数
  cumulative: number[]   // 截至每月末的累计总数（历史项目全部计入首月前的基数）
}
```

- 累计口径：首月值 = 首月新建 + 此前所有历史项目数，完全准确，不估算

- preload（electron/preload/index.ts projectService 内）同步新增 `getTrend: ipc<...>('project:getTrend')`

#### 3.2.2 前端渲染（dashboard/index.vue）

- loadData（L235-271）追加 `project.getTrend()` 调用

- ECharts option：柱 series（新建）+ 折线 series（累计，双轴可选：柱左轴、线右轴），tooltip axis 触发

- 空数据（全新安装）显示「暂无数据」占位，与现有图表处理一致

### 3.3 系统状态卡

三行信息，全部复用**现有接口**（已逐一核实）：

| 信息   | 接口（均已存在于 preload）                                                         | 返回                                                                                                                                                                                |
| ---- | ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 当前版本 | `window.api.update.getCurrentVersion()`（preload L11 → `app.getVersion()`） | string                                                                                                                                                                            |
| 更新状态 | `window.api.update.getStatus()`（preload L10）                              | `UpdateStatus`（update.service.ts L21-31：`status: 'idle' \| 'checking' \| 'downloading' \| 'available' \| 'notavailable' \| 'downloaded' \| 'error'`，可能含 version/downloadProgress） |
| 备份信息 | `window.api.system.listBackups()`（preload L187）                           | `Array<{ name, path, size, timestamp }>`（backup.service.ts L508-543），按文件名倒序 → **`backups[0]`** **即最近一次备份**；`timestamp` 取自压缩包内 manifest.json，**可能为空串**，需容错                         |

状态文案映射：`idle/notavailable` → 已是最新；`checking` → 检查中；`downloading` → 下载中 x%；`available` → 有新版本 vx.x.x；`downloaded` → 待安装；`error` → 更新异常。

展示要点：

- 最近备份时间格式化展示；`backups` 为空数组或 `timestamp === ''` 时显示「暂无备份」

- 同时展示备份总份数（`backups.length`）

- 卡片整体可点击，跳转 `/settings`（router/index.ts 已有该路由），hover 有卡片反馈

- 深浅色均用主题变量

### 3.4 状态饼图深色修复（dashboard/index.vue L174）

饼图 itemStyle `borderColor: '#fff'` 硬编码 → 改为按当前主题取卡片底色：检测 `html` 的 `dark` class（main.ts 主题机制下 dark class 与 data-theme 属性同时切换，检测任一即可），深色取 `#1E293B`（variables.css 深色 `--color-bg-card` 值）、浅色保持 `#fff`，避免深色模式下出现白色描边圈。

## 4. 系统引导重构（src/components/OnboardingGuide/index.vue）

### 4.1 跨页步骤机制

现问题：第 4 步目标 `.toolbar` 在项目列表页，而引导从工作台启动 → 找不到目标、聚光灯丢失。

方案：步骤定义增加 `route?: string` 字段：

1. 进入带 `route` 的步骤时，若当前路由不同则 `useRouter().push(route)`
2. 等待约 **400ms**（路由切换 + 页面首屏渲染）后重新执行 calculatePosition（现 L140-211）
3. 定位时先查询目标元素：**找不到则卡片居中显示兜底**，不中断流程
4. 组件卸载 / 完成时若发生过路由跳转，引导结束后保持用户所在页面（不强制跳回），由用户自行导航

### 4.2 新 8 步流程

| # | 标题    | 目标选择器           | route            | 位置     |
| - | ----- | --------------- | ---------------- | ------ |
| 1 | 欢迎    | —（居中）           | —                | center |
| 2 | 导航菜单  | `.sidebar-menu` | `/dashboard`     | right  |
| 3 | 数据概览  | `.stats-row`    | —（已在此页）          | bottom |
| 4 | 项目管理  | `.toolbar`      | `/projects/list` | bottom |
| 5 | AI 助手 | `.ai-container` | `/ai-assistant`  | left   |
| 6 | 知识库   | `.kb-card`      | `/knowledge`     | left   |
| 7 | 功能入口  | `.header-right` | —（顶栏常驻）          | left   |
| 8 | 完成    | —（居中）           | —                | center |

选择器已逐一核实存在：projects 页 `.toolbar`（L25）、ai-assistant `.ai-container`（L2）、knowledge-base `.kb-card`（L10）、MainLayout `.sidebar-menu` / `.header-right`。

**文案修正**：末步原文案「可以在个人中心中重新触发」与实际入口不符 → 改为「随时可点击右上角头像菜单 → 查看引导 重新观看」（真实入口：MainLayout L117 下拉项 → `onboardingRef?.restart()`）。各步描述文案随扩充同步重写，突出「这是什么 / 能做什么」。

### 4.3 不变量

- localStorage 完成标记键 **`jsecprobe_onboarding_completed`** **不变**（老用户不会被重复打扰）

- 组件对外接口 `defineExpose { start, restart }` 不变（MainLayout 调用点零改动）

- Teleport to body + 聚光灯实现方式不变

### 4.4 视觉与动效升级

1. **步骤切换**：卡片内容 fade + 上移 8px，0.2s ease
2. **首次出现**：卡片 scale 0.96 → 1，与 fade 同步
3. **欢迎图标**：轻微上下浮动动画（CSS keyframes，尊重系统 reduced-motion 时禁用）
4. **进度点**：颜色全部走 2.2 的变量映射；已完成点用 success 色、当前点用 primary 色
5. 聚光灯与卡片阴影在深色下用变量适配，避免浅色阴影突兀

## 5. 验证方案

1. **类型检查**：`npx vue-tsc --noEmit` 零错误
2. **深色模式**：

   - 引导弹窗（含全部 8 步）深色卡片、按钮实色、进度点可见

   - 全应用主按钮抽查（工具栏 / 对话框 / 登录页）底色恢复主色

   - 工作台饼图无白色描边圈
3. **引导流程**：清 localStorage 后首次进入自动开始；逐步「下一步」可跨页高亮 `.toolbar` / `.ai-container` / `.kb-card`；「跳过」与最后一步「完成」正常写标记；顶栏下拉「查看引导」可重新开始
4. **趋势图**：数字与项目列表实际月份分布一致（抽查 1-2 个月份）；全新环境无数据不报错
5. **系统状态卡**：版本号与 `package.json` 一致；备份行在有备份 / 无备份两种状态下展示正确；点击跳转系统设置
6. **浅色回归**：全流程浅色模式过一遍，与改动前无差异

## 6. 风险与权衡

- **跨页等待时长**：400ms 为经验值，慢机器上目标元素可能未就绪——已用「找不到目标居中兜底」覆盖该风险，最坏表现为该步居中而非高亮，流程不中断

- **累计趋势口径**：以 createdAt 为准的「项目数趋势」，不含「完成趋势」（无 completedAt），文案明确写「项目创建趋势」避免误导

- **getStatus 未登录更新流程时的值**：默认 `idle`，映射为「已是最新」合理（从未检查过也无需打扰）；后续如需展示「未检查过」可迭代

- **备份 timestamp 空串**：manifest 缺失的历史备份包会落到「暂无备份」文案旁的份数统计仍正确（按文件数计），计划阶段可决定是否回退用文件名解析时间

- **路由跳转打断**：引导中用户手动点击侧边栏切换页面 → 当前步目标丢失，走居中兜底；不强制回跳，属可接受行为

