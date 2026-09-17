# 正式测评报告编制功能 —— 设计文档

> 日期：2026-09-17
> 状态：设计稿（待评审）
> 关联项目：JSecProbe（等级保护现场测评系统）v2.3.2

## 一、需求概述

在**不影响现有报告生成功能**的前提下，为 JSecProbe 新增一个独立的「**正式测评报告编制**」功能模块。该模块生成的报告**严格贴合官方《网络安全等级保护测评报告模板2025版》**的结构（前置页 + 正文8章 + 附录A-I），数据大部分自动从系统现有表提取，少部分通过新增的补充录入界面手工填写。

### 功能定位与边界

| 对比项 | 现有「生成项目报告」 | 新增「正式测评报告编制」 |
|--------|--------------------|------------------------|
| 报告性质 | 分析报告（问题清单+分析+整改建议） | 合规交付报告（官方模板完整结构） |
| 章节结构 | 10个可选章节（简/标/详三档模板） | 前置页+正文8章+附录A-I全量生成 |
| 入口 | 问题汇总页按钮 | 独立页面（项目子页） |
| 数据来源 | 现有 issues/assets/assessmentRecords | 现有表自动提取 + 新增补充录入 |
| 目标形态 | 快速分析查阅 | 正式交付归档（约46页） |

两者**入口独立、服务独立、数据结构独立**，互不影响。

---

## 二、技术路线决策（已与用户确认）

1. **报告形态**：贴合官方2025模板，全量生成前置页+正文+附录。
2. **技术路线**：在现有 docx 硬编码基础上新增**独立服务**，不复用现有分析报告的 buildWordContent（保留原样），新增专门的官方版式渲染。
3. **数据来源**：两者结合——资产/问题/测评记录从系统自动提取；单位信息/正文描述/签署/验证测试等新增补充录入。
4. **入口形态**：**独立页面**（作为项目子页 `:id/report`）。
5. **章节目录**：**全量生成**（前置页+正文8章+附录A-I）。
6. **数据库**：确认新增 `report_metas`（一项目一行）+ `report_history`（生成历史）两张表。

---

## 三、官方模板结构映射（数据源分析）

### 3.1 前置页

| 模板章节 | 数据来源 | 是否需补录 |
|---------|---------|-----------|
| 封面（报告编号+标题+单位+时间） | report_metas.reportNo/reportYear；projects.systemName/assessedUnit | ✅ 补录编号 |
| 网络安全等级测评基本信息表 | report_metas（被测/测评单位+联系人）；projects 基本信息 | ✅ 补录单位信息 |
| 声明 | 固定文本+report_metas.assessmentOrgName | 固定 |
| 等级测评结论 | report_metas.conclusion；符合率自动计算 | ✅ 补录结论 |
| 等级测评结论扩展表（云计算/大数据） | projects.extensionType；标准扩展要求符合情况 | ✅ 补录（若有扩展） |
| 目录 | 自动生成（TOC域） | 自动 |

### 3.2 正文8章

| 章节 | 数据来源 | 是否需补录 |
|------|---------|-----------|
| 1 测评项目概述 | report_metas.assessPurpose/assessmentBasis；projects 起止时间 | ✅ 补录目的/依据 |
| 2.1 被测对象概述 | projects.systemName/levelCombo；report_metas.businessTechDesc/networkStructureDesc/gradeDetail | ✅ 补录业务/网络/定级描述 |
| 2.2 测评指标 | assessmentItems 按 extensionType 分组统计 | 自动 |
| 2.3 测评对象（12类资产表） | assets 按 category 分组，isAssessmentTarget=1 | 自动 |
| 3 单项测评结果分析 | assessmentRecords 按 securityDomain 统计；issues 汇总 | 自动 |
| 4 验证测试 | report_metas.vulnScanResult/pentestResult/waiveVerification | ✅ 补录 |
| 5 安全问题汇总（表3-9） | issues 全量，编号T001-T0XX | 自动 |
| 6 整体测评 | issues 关联控制点/区域聚合 | 自动 |
| 7 安全问题风险分析（表5-1/5-2） | issues 风险等级+关联资产；report_metas.majorRisks | 自动+补录重大风险 |
| 8 总体评价（表6-1） | 按安全类统计符合率，算总符合率 | 自动 |
| 9 等级测评结论（表7-1） | 符合率+重大风险 → 自动判定 | 自动+可改 |
| 10 安全问题整改建议（表8-1/8-2） | issues.rectificationSuggestion；report_metas.majorRisks | 自动+补录 |

### 3.3 附录A-I

| 附录 | 数据来源 |
|------|---------|
| 附录A 被测对象资产 | assets 全量（13类） |
| 附录B 上次测评问题整改情况 | report_metas.lastRectifyList | ✅ 补录 |
| 附录C 单项测评结果汇总 | assessmentRecords 按安全类+对象统计 |
| 附录D 单项测评结果记录 | assessmentRecords 逐设备逐控制点+evidence证据 |
| 附录E 漏洞扫描结果记录 | report_metas.vulnScanResult | ✅ 补录 |
| 附录F 渗透测试结果记录 | report_metas.pentestResult | ✅ 补录 |
| 附录G 重大风险隐患触发项参照表 | 内置常量 |
| 附录I 威胁列表 | 内置常量 |

### 3.4 已确认的资产分类（重要修正）

> 系统 `shared/asset-categories.ts` 已定义 **13 类资产**，官方模板附录A的12类资产**全部已有录入入口**，无需新增资产类别。

系统资产分类与官方模板对照：

| 系统 category | 系统名称 | 官方模板对应 | 备注 |
|--------------|---------|-------------|------|
| machine_room | 管理机房 | 物理机房（表26） | ✅ |
| network_boundary | 区域边界 | —（网络结构） | ✅ |
| network_device | 网络设备 | 网络设备（表27） | ✅ |
| security_device | 安全设备 | 安全设备（表28） | ✅ |
| server_storage | 服务器/存储设备 | 服务器（表29） | ✅ |
| management_platform | 系统管理平台 | 系统管理软件/平台（表212） | ✅ |
| business_app | 业务应用系统 | 业务应用系统/平台（表213） | ✅ |
| terminal | 业务终端/运维终端 | 终端设备（表210） | ✅ |
| other_asset | 其他系统或设备 | 其他系统或设备（表211） | ✅ |
| data_resource | 数据资源 | 数据资源（表214） | ✅ |
| crypto_product | 密码产品 | 密码产品（附录A） | ✅ |
| security_personnel | 安全相关人员 | 安全相关人员（表215） | ✅ |
| sys_doc | 系统管理文档 | 安全管理文档（表216） | ✅ |

**结论：报告资产表直接由 assets 表按 category 分组生成即可，无需新增录入入口。** 报告渲染时需将系统分类名映射为官方模板术语（如"管理机房"→"物理机房"、"系统管理平台"→"系统管理软件/平台"、"业务终端/运维终端"→"终端设备"）。

---

## 四、业务逻辑设计

### 4.1 数据补充模块（report_metas 表）

新增数据库表 `report_metas`，**一项目一行**，承载报告专属补充字段：

| 分组 | 字段 | 类型 | 说明 |
|------|------|------|------|
| 主键/外键 | projectId | text PK | 关联 projects |
| **报告编号** | reportNo | text | 完整报告编号 `XXXXXXXXXXX-XXXXX-XX-XXXX-XX` |
| | reportYear | text | 年度（如 2026） |
| | reportSeq | text | 本年度测评次数（2位） |
| **被测单位** | unitFullName | text | 单位全称 |
| | unitAddress | text | 单位地址 |
| | unitPostalCode | text | 邮政编码 |
| | unitSocialCode | text | 统一社会信用代码 |
| | unitContactName | text | 联系人姓名 |
| | unitContactTitle | text | 联系人职务职称 |
| | unitContactDept | text | 联系人所属部门 |
| | unitContactPhone | text | 联系人办公电话 |
| | unitContactMobile | text | 联系人移动电话 |
| | unitContactEmail | text | 联系人电子邮件 |
| **测评单位** | orgName | text | 测评机构名称 |
| | orgCode | text | 测评机构代码 |
| | orgContactName | text | 联系人姓名 |
| | orgContactTitle | text | 联系人职务职称 |
| | orgContactDept | text | 联系人所属部门 |
| | orgContactPhone | text | 联系人办公电话 |
| | orgContactEmail | text | 联系人电子邮件 |
| **签署批准** | preparedBy | text | 编制人 |
| | preparedDate | text | 编制日期 |
| | reviewedBy | text | 审核人 |
| | reviewedDate | text | 审核日期 |
| | approvedBy | text | 批准人 |
| | approvedDate | text | 批准日期 |
| **正文描述** | assessPurpose | text | 测评目的 |
| | assessmentBasis | text | 测评依据条文 |
| | businessTechDesc | text | 业务和技术描述 |
| | networkStructureDesc | text | 网络结构描述 |
| | gradeDetail | text | 定级结果（S2A2G2各分项说明） |
| **验证测试** | waiveVerification | integer | 是否自愿放弃验证测试(0/1) |
| | vulnScanResult | text | 漏洞扫描结果记录 |
| | pentestResult | text | 渗透测试结果记录 |
| | lastRectifyList | text | 上次测评整改情况（JSON） |
| **重大风险** | majorRisks | text | 重大风险隐患描述（JSON数组） |
| **结论** | conclusion | text | 符合/基本符合/不符合 |
| | conclusionNote | text | 结论补充说明 |
| | updatedAt | text | 更新时间 |

### 4.2 报告历史表（report_history 表）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | text PK | |
| projectId | text | 关联项目 |
| reportTitle | text | 报告标题 |
| reportNo | text | 报告编号 |
| format | text | docx/pdf |
| sections | text | 生成章节 JSON |
| filePath | text | 生成文件路径 |
| fileSize | integer | 文件大小 |
| conclusion | text | 结论 |
| status | text | success/failed |
| errorMsg | text | 失败原因 |
| aiEnhanced | integer | 是否AI增强 |
| generatedBy | text | 生成人 |
| createdAt | text | 生成时间 |

### 4.3 数据装配核心逻辑（ReportCompilerService.assemble）

```
输入：projectId + 配置
流程：
1. 读取 projects / standards / report_metas（若空则创建草稿）
2. 统计 assessmentItems：按 extensionType 分组适用测评项
   - 通用要求：extensionType='general' 且 minLevel<=项目level<=maxLevel
   - 扩展要求：按项目 extensionType 匹配（cloud/mobile/iot/industrial/bigdata）
   - 其他/不适用：按 records 中 result 为 notApplicable 汇总
3. 统计 assessmentRecords：按 securityDomain + result 四档计数
4. 聚合 issues：编号 T001-T0XX（按 风险等级高>中>低 → 安全类 → 创建时间 排序）
5. 按资产分类分组 assets（用于 2.3 节与附录A）
6. 逐设备聚合 records（用于附录D，含 evidence/screenshotPaths）
7. 计算符合率 = 符合总项数 / (适用总项数 - 不适用项数) × 100%
8. 判定结论：符合率>90%且无重大风险→符合；60%~90%或有重大风险→基本符合；<60%→不符合
9. 合并 report_metas 补充字段，输出 ReportData
```

### 4.4 问题编号规则

与官方实际报告一致：多条测评项问题合并为一个编号。规则：
- 按 `风险等级(高>中>低) → 安全类(3.1-3.11) → 创建时间` 排序
- 同一 securityDomain + controlPoint 下的多条记录合并编号
- 编号格式 `T001`、`T002`…`T051`
- 若系统 issues 已有独立编号则沿用

---

## 五、UI 设计

### 5.1 入口

**独立页面**，作为项目子路由挂载：

```
路由：/projects/:id/report（name: ProjectReport，requiresProject: true）
侧边栏：项目下的「报告编制」菜单项
```

### 5.2 页面结构（ReportStudio 报告编制）

采用**分步向导（3步）** + 顶部项目上下文栏 + 阶段指示器（沿用 issues 页风格）。

**步骤1：补充信息录入**
```
┌────────────────────────────────────────────────┐
│ 报告编制 · 补充信息                      [保存草稿] │
├────────────────────────────────────────────────┤
│ 📋 报告信息                                     │
│   报告编号[____] 年度[____] 序号[__] 报告时间[__]│
│ 🏢 被测单位                        [基本信息表]  │
│   单位全称[____] 地址[____] 邮编[__] 信用代码[__]│
│   联系人 姓名[__]职务[__]部门[__]电话[__]手机[__]│
│              邮箱[____]                         │
│ 🏛 测评单位                        [基本信息表]  │
│   机构名称[____] 代码[____] 联系人[...]          │
│ ✍️ 签署批准                                      │
│   编制 人[__]日期[__] 审核 人[__]日期[__]        │
│   批准 人[__]日期[__]                            │
│ 📝 正文描述        [折叠面板，各章节一个]         │
│   测评目的[富文本] 测评依据[富文本]               │
│   业务和技术[富文本] 网络结构[富文本]            │
│   定级结果[下拉 S2A2G2/S3A3G3...]                │
│ 🔬 验证测试        [折叠面板]                     │
│   自愿放弃[开关] 漏洞扫描[富文本] 渗透测试[富文本]│
│   ⚠️ 若放弃，报告自动标注且相关测评项判"不符合"   │
│ ⚠️ 重大风险隐患    [表格: 新增行/删除]             │
│   安全类|触发项|后果分析|安全问题|关联资产         │
│ ✅ 等级测评结论                                  │
│   结论[下拉 符合/基本符合/不符合] 自动计算[按钮]  │
├────────────────────────────────────────────────┤
│            [上一步]  [下一步: 报告编排]           │
└────────────────────────────────────────────────┘
```

**步骤2：报告编排配置**
```
┌────────────────────────────────────────────────┐
│ 报告编排                                      │
│ 格式  [ docx ]  [ pdf ]                        │
│ 前置页  封面/声明/基本信息表/结论  [固定包含]    │
│ 正文章节(勾选)  全部8章 默认全选                │
│ 附录(勾选)  A-I 默认全选                        │
│ AI增强  [总体评价] [整改建议] 开关              │
│ 保存位置 [________________________] [选择]     │
├────────────────────────────────────────────────┤
│            [上一步]          [生成报告]           │
└────────────────────────────────────────────────┘
```

**步骤3：生成与结果**
- 生成进度条（数据装配→渲染→写文件）
- 成功后：打开文件 / 打开所在文件夹 / 返回编排 / 重新生成
- 生成历史列表（分页展示 report_history）

### 5.3 系统构成页

无需改动（13类资产已齐全）。仅当用户报告需用官方术语名时，在报告渲染层做名称映射，不动录入 UI。

---

## 六、UI 排版与 Word 版式

贴合官方模板排版规范（docx 库实现，常量参照现有 report.service.ts 的 SIZE_*）：

| 元素 | 规范 |
|------|------|
| 正文 | 华文仿宋 + Times New Roman，小四(12pt)，1.5倍行距 |
| 一级标题 | 三号黑体加粗 |
| 其他标题 | 四号黑体加粗 |
| 表格正文 | 五号(10.5pt) 单倍行距，表头行加粗深色35%底纹 |
| 题注 | 黑体加粗五号（表 21、表 3-9…自动编号） |
| 页眉 | 华文仿宋加粗小五，`报告编号：XXXXXXXXXXX-XXXXX-XX-XXXX-XX【2025版】` |
| 页脚 | 分三区独立页码：前置页罗马数字(I/XIV)；正文`正文第X页 共Y页`；附录`附录第X页 共Y页` |
| 封面 | 主标题+被测/测评单位+报告时间，底部报告编号规则说明 |
| 目录 | TOC 域字段自动生成 |
| 表号 | 官方模板表号错漏需在生成时自动校正（如附录I威胁列表表头应为"附录I 表-I"） |

### 表号自动编号规则
- 正文表：`表 21`…`表 82`（章节.序号 两级）
- 附录表：`附录A 表A-1`…（附录字母.序号）

---

## 七、技术实现方案

### 7.1 新增/改动文件清单

| 层 | 文件 | 操作 | 职责 |
|----|------|------|------|
| **共享** | `shared/types.ts` | 修改 | 新增 ReportMeta / ReportHistory / OfficialReportOptions 类型 |
| **共享** | `shared/asset-categories.ts` | 修改 | 新增资产分类→官方模板术语映射表 REPORT_ASSET_NAME_MAP |
| **DB** | `electron/db/schema.ts` | 修改 | 新增 report_metas、report_history 表定义 |
| **DB** | `electron/db/migrations/0004_add_report_tables.sql` | 新增 | 两张表迁移 |
| **DB** | `electron/db/migrate.ts` | 修改 | 纳入新迁移 |
| **服务** | `electron/services/report-compiler.service.ts` | 新增 | 数据装配（assemble）+ 结论判定 + 编号 |
| **服务** | `electron/services/report-official.service.ts` | 新增 | docx 渲染官方版式（可并入 compiler） |
| **IPC** | `electron/ipc/report-official.ipc.ts` | 新增 | `report-official:getMeta/saveMeta/generate/listHistory` |
| **IPC** | `electron/main/ipc.ts` | 修改 | 注册新 IPC |
| **Preload** | `electron/preload/index.ts` | 修改 | 暴露 window.api.reportOfficial 系列方法 |
| **前端** | `src/views/report/` | 新增目录 | 报告编制3步向导页面 + 步骤组件 |
| **前端** | `src/router/index.ts` | 修改 | 新增项目子路由 `:id/report` |
| **前端** | `src/layout/MainLayout.vue` | 修改 | 项目下新增「报告编制」菜单项 |

### 7.2 与现有代码隔离策略

- **复用**：`docx` 库、`better-sqlite3`、数据提取公共函数（gatherReportData 中可抽离的部分）、AI 提示词机制（ai-prompt.service 的 report_overview/report_rectification）
- **不复用**：现有 report.service.ts 的 `buildWordContent()`（分析报告版式，保留原样）
- **新增独立服务**：report-compiler + report-official，避免污染现有逻辑

### 7.3 错误处理与健壮性

| 场景 | 处理 |
|------|------|
| 补充信息不完整 | 生成前校验，高亮缺失项；可"跳过生成"但报告标注占位 |
| AI 失败 | 自动回退内置模板（沿用现有机制） |
| 资产/记录为空 | 生成空表并提示"无数据" |
| 图片缺失 | 附录D截图路径失效时跳过并记录日志 |
| 结论自动判定 | 提供"自动计算"按钮+可手动覆盖 |
| 生成失败 | 写 report_history(status=failed)，可重试 |

---

## 八、AI 增强设计

沿用现有 AI 机制，扩展到官方报告的相关章节：

| 章节 | AI 生成内容 | 提示词键 |
|------|------------|---------|
| 8 总体评价 | 总体分析评价（基于符合率/风险统计） | report_overview |
| 10 整改建议 | 整改建议及规划 | report_rectification |
| 3 单项分析 | 各安全类主要问题描述（可选） | 新增 report_domain_analysis |
| 7 风险分析 | 危害分析结果（可选） | 新增 report_risk_analysis |

所有 AI 章节均有内置模板兜底，失败不影响生成。

---

## 九、数据流程

```
前端 ReportStudio
  ├─ 步骤1 补充信息 → reportOfficial.saveMeta(projectId, meta)
  ├─ 步骤2 编排配置 → reportOfficial.getMeta / 前端组装 options
  └─ 生成 → reportOfficial.generate(projectId, options)
       → ReportCompilerService.assemble()   // 提取+合并
       → ReportOfficialService.render()      // docx 渲染
       → 写文件 + report_history 入库
       → 返回 {filePath} → 前端打开
```

---

## 十、实施分期建议

### 一期（MVP，核心交付）
- 新增 report_metas / report_history 表
- 补充信息录入页（单位/签署/编号/正文描述/结论）
- 报告编排配置
- docx 渲染：前置页 + 正文8章 + 附录A/C/D
- 结论自动判定 + 表号自动编号

### 二期（补全附录与增强）
- 附录B/E/F（验证测试、上次整改）
- 附录G/I 内置参照表
- 附录D 截图/证据图片嵌入
- 生成历史记录页
- 结构化数据预览

### 三期（智能化与扩展）
- 模板版本管理（官方模板升级版本字段）
- 报告编号规则引擎（自动生成/校验）
- AI 覆盖全章节
- PDF 三区页码分节完善

---

## 十一、用户未考虑到的方面（补充建议）

1. **报告编号规则引擎**：官方编号 `XXXXXXXXXXX-XXXXX-XX-XXXX-XX` 有明确编码规则（备案表16位/年份2位/机构4位/年度次数2位），内置生成/校验逻辑，避免手填出错。
2. **附件图片嵌入**：附录D证据截图从 assessmentRecords.screenshotPaths 读取嵌入 Word，需路径解析与图片压缩（sharp 已有）。
3. **三区独立页码**：前置/正文/附录页码分别计数，docx 分节（section）实现，较现有 report.service 复杂。
4. **目录自动生成**：需用 TOC 域或预计算页码。
5. **报告版本管理**：官方模板含"2025版"标识，未来可能升级，report_metas 加 templateVersion 字段便于切换。
6. **敏感信息脱敏**：报告含 IP/资产/联系人，生成前确认提示，遵循隐私规范。
7. **等级联动过滤**：不同 level（二/三级）适用测评指标不同，生成时按项目 level 过滤 assessmentItems。
8. **报告预览**：生成前提供结构化数据预览（问题数/资产数/符合率/结论），减少返工。
9. **合规性自动判定**：结论按官方标准（符合率+重大风险）自动计算，并附判定依据文本（表7-1）。
10. **草稿自动保存**：补充信息录入支持草稿自动保存（沿用 useAutoSave 模式），防止丢失。

---

## 十二、验收标准（草稿）

- [ ] 可从项目进入独立「报告编制」页面
- [ ] 可录入补充信息并保存草稿
- [ ] 可编排章节/附录/格式
- [ ] 可一键生成 docx 报告，结构贴合官方模板（前置页+正文8章+附录A-I）
- [ ] 问题自动编号 T001-T0XX，按风险等级排序
- [ ] 结论按符合率+重大风险自动判定
- [ ] 资产表按13类分类自动生成，系统分类名映射为官方术语
- [ ] 生成历史可查询、失败可重试
- [ ] 原有「生成项目报告」功能完全不受影响