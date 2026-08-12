# 网络拓扑结构图分析 - 设计文档

## 1. 需求背景

等保测评现场核查中，网络拓扑结构图是核心核查对象。当前项目已支持截图上传和 AI 分析，但缺少专门针对拓扑图的：
- 多张拓扑图的统一管理
- 基于多模态 AI 的结构化描述生成
- 多张图关联性理解（如核心层/汇聚层/接入层分别出图时，AI 能串联完整拓扑）
- 报告导出为 Word

## 2. 设计原则

- **独立功能模块**：不绑定具体核查项，在侧边栏新增「网络拓扑分析」入口
- **混合模型路由**：默认本地模型，复杂场景（设备密集、小字多）自动降级到云端视觉模型
- **渐进式分析**：单张图分析 → 多张图关联分析 → 综合报告
- **报告在线编辑**：AI 生成的结构化报告直接在应用内在线编辑（增删改区域/设备/链路等），所见即所得，保存后标记为已编辑

## 3. 数据模型

### 3.1 topology_images 表（拓扑图）

```sql
CREATE TABLE topology_images (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,          -- 关联项目 ID
  name TEXT NOT NULL,                -- 图片名称（如"核心层拓扑"）
  file_path TEXT NOT NULL,           -- 相对项目数据目录的路径
  file_size INTEGER NOT NULL,        -- 字节
  width INTEGER,                     -- 图片宽度（px）
  height INTEGER,                    -- 图片高度（px）
  group_id TEXT,                    -- 分组 ID（关联分析分组）
  sort_order INTEGER DEFAULT 0,       -- 组内排序
  description TEXT,                  -- 用户备注
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

### 3.2 topology_reports 表（分析报告）

```sql
CREATE TABLE topology_reports (
  id TEXT PRIMARY KEY,
  image_id TEXT NOT NULL,            -- 关联拓扑图 ID
  group_id TEXT,                     -- 关联分组 ID（多图综合分析时使用）
  model_name TEXT NOT NULL,           -- 使用的模型名
  model_mode TEXT NOT NULL,           -- 'local' | 'cloud'
  report_json TEXT NOT NULL,         -- 结构化报告 JSON
  confidence REAL,                   -- AI 自评置信度 0-1
  is_edited INTEGER DEFAULT 0,      -- 用户是否手动编辑过
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

### 3.3 报告 JSON 结构

```typescript
interface TopologyReport {
  network_areas: NetworkArea[];        // 网络区域
  links: LinkInfo[];                   // 链路情况
  boundaries: BoundaryInfo[];          // 边界信息
  management: ManagementInfo;          // 管理方式
  backup: BackupInfo;                  // 备份情况
  summary: string;                     // 综合概述
  confidence: number;                  // AI 自评置信度
  warnings: string[];                  // AI 不确定的项
}

interface NetworkArea {
  name: string;                        // 区域名称（如"核心交换区"）
  area_type: string;                   // 区域类型：core（核心区）/ server（服务器区）/ operation（运维区）/ office（办公区）/ internet（互联网区）/ dmz（DMZ）/ other
  function: string;                    // 功能/作用
  devices: Device[];                   // 部署设备
  security_level?: string;             // 安全等级
  external_connections?: ExternalLink[]; // 与外部网络的连接
}

interface ExternalLink {
  isp: string;                         // 运营商
  bandwidth: string;                    // 出口带宽
  line_type: string;                   // 种类（SDH/MSTP/互联网宽带/VPN等）
  connected_unit: string;               // 连接单位/对端
  purpose: string;                      // 用途（生产/备份/互联网接入等）
}

interface Device {
  name: string;                        // 设备名称
  device_type: string;                 // 类型：network（网络设备）/ security（安全设备）/ server（服务器）/ terminal（终端）
  brand_model: string;                 // 品牌型号
  deployment: string;                 // 部署方式
  function: string;                    // 功能/作用
  software: string;                    // 安装的软件
  ip_address?: string;                 // IP 地址
  ip_note?: string;                    // IP 无法识别时的原因说明
  location?: string;                   // 物理/逻辑位置
  is_outsourced?: boolean;             // 是否为外包运维终端
}

interface LinkInfo {
  from: string;                        // 源设备/区域
  to: string;                          // 目标设备/区域
  link_type: string;                   // 链路类型（光纤/网线/VPN等）
  bandwidth?: string;                  // 带宽（如可识别）
}

interface BoundaryInfo {
  location: string;                    // 边界位置
  boundary_type: string;               // 边界类型（内网/外网/DMZ）
  security_measures: string;           // 安全防护措施
}

interface ManagementInfo {
  tools: string;                       // 管理工具
  methods: string;                     // 管理方式
  description?: string;                // 补充描述
}

interface BackupInfo {
  local: string;                       // 本地备份
  remote: string;                      // 异地备份
  disaster_recovery: string;            // 灾备情况
  description?: string;                // 补充描述
}
```

## 4. 后端架构

### 4.1 混合模型路由

```
analyzeTopology(imageIds, mode, config):
  1. 根据 mode 选择模型池
  2. 优先本地模型（需 Ollama 运行 + 视觉模型）
  3. 本地失败或 confidence < 0.5 → 降级到云端视觉模型
  4. 返回 { report, modelUsed, confidence }
```

### 4.2 多图关联分析策略

**方案：分步分析 + 关联综合**

1. **第一轮**：每张图独立分析，生成单图报告
2. **第二轮**：将所有图片 + 单图报告作为输入，生成关联分析报告
3. **合并输出**：5 个部分中，network_areas / links / boundaries 以关联分析为准，management / backup 取并集

### 4.3 IPC 接口

| 接口 | 参数 | 返回 |
|---|---|---|
| `topology:upload` | `{ projectId, filePath, name, groupId? }` | `{ image: TopologyImage }` |
| `topology:delete` | `{ imageId }` | `{ success: boolean }` |
| `topology:list` | `{ projectId, groupId? }` | `{ images: TopologyImage[] }` |
| `topology:analyze` | `{ imageIds, forceModel?, fallbackToCloud? }` | `{ report, modelUsed, confidence }` |
| `topology:saveReport` | `{ imageId, groupId, report }` | `{ report: TopologyReportRow }` |
| `topology:getReport` | `{ imageId }` | `{ report: TopologyReportRow }` |
| `topology:exportWord` | `{ imageId, outputPath }` | `{ filePath }` |
| `topology:createGroup` | `{ projectId, name }` | `{ groupId }` |
| `topology:deleteGroup` | `{ groupId }` | `{ success: boolean }` |

### 4.4 AI Prompt 设计

**单图 Prompt（设备识别专项）**：
```
你是一个网络安全等级保护测评专家。请分析这张网络拓扑结构图，按以下要求逐项识别，输出 JSON 格式报告。

识别要求：
1. 设备识别：标识出网络设备（交换机/路由器等）、安全设备（防火墙/IDS/IPS/审计等）、服务器设备、主要终端设备，并标注设备名称
2. IP 地址：标识各设备的 IP 地址；拓扑图中无法识别的，在 ip_note 字段说明原因
3. 网络区域划分：标识核心区、运维区、服务器区、办公区、互联网区等区域划分
4. 外部连接：标识网络与外部的连接情况，如运营商名称、出口带宽、线路种类、连接单位等
5. 终端位置：标识终端实际位置（安全运维管理区、办公区、互联网区等）；存在外包运维人员时，运维终端位置需单独明确
6. 设备详情：品牌型号、部署方式、功能/作用、安装软件
7. 链路信息：设备间连接关系、链路类型（光纤/网线/VPN等）、带宽
8. 安全防护：边界位置及防护措施
9. 管理方式：管理工具和管理方法
10. 备份情况：本地备份、异地备份、灾备情况
11. 图中文字：如有文字标注请准确提取
12. 不确定项：无法确认的信息在 warnings 中列出，不要编造

输出格式：严格的 JSON，符合 TopologyReport 接口定义。
```

**多图关联 Prompt**：
```
以下是同一项目的多张网络拓扑图的分析结果。请综合这些分析，生成一份关联报告：
1. 识别各图之间的关联关系（如核心层-汇聚层-接入层的层级关系）
2. 合并去重所有网络区域
3. 补全跨图的链路连接
4. 综合描述整体网络架构

单图分析结果：
{previousReports}

输出格式：严格的 JSON，符合 TopologyReport 接口定义。
```

## 5. 前端 UI 设计

### 5.1 侧边栏入口

在侧边栏「工具」分组下新增「网络拓扑分析」菜单项。

### 5.2 主界面布局

```
┌─────────────────────────────────────────────────────────┐
│ 顶部工具栏：[上传拓扑图] [新建分组] [导出Word] [分析]    │
├──────────────┬────────────────────┬───────────────────┤
│  图列表      │   图片预览         │   报告面板        │
│  - 分组1     │                    │                   │
│    - 图1 ✓   │   [拓扑图预览]     │  网络区域        │
│    - 图2     │   支持缩放拖拽     │   链路情况        │
│  - 分组2     │                    │   边界信息        │
│    - 图3     │                    │   管理方式        │
│              │                    │   备份情况        │
│              │                    │                   │
│              │                    │  [重新分析]       │
│              │                    │  [切换模型]       │
└──────────────┴────────────────────┴───────────────────┘
```

### 5.3 交互流程

1. **上传**：点击「上传拓扑图」→ 选择图片 → 填写名称/分组 → 保存
2. **分析**：选中一张或多张图 → 点击「分析」→ 显示进度 → 报告渲染到右侧
3. **在线编辑**：每个报告分区右上角有「编辑」按钮 → 点击进入行内编辑模式（可增删改设备、链路、区域等）→ 保存/取消 → 保存后标记 is_edited=1
4. **导出**：点击「导出 Word」→ 选择保存路径 → 生成 .docx
5. **重新分析**：切换模型（本地/云端）→ 重新分析

### 5.4 多图选中逻辑

- 单击选中单张
- Ctrl+Click 多选
- 选中分组标题 = 选中全部分组内图片
- 分析时按 sort_order 排序

## 6. Word 导出

### 6.1 依赖

新增 npm 包：`docx`（生成 Word 文档）

### 6.2 导出模板

```
# 网络拓扑分析报告

## 一、综合概述
{summary}

## 二、网络区域
### 2.1 {area.name}
- 区域类型：{area.area_type}
- 功能/作用：{area.function}
- 安全等级：{area.security_level}
- 部署设备：
  | 设备名称 | 类型 | 品牌型号 | IP地址 | IP备注 | 部署方式 | 功能/作用 | 安装软件 | 位置 | 外包终端 |
  | ... | ... | ... | ... | ... | ... | ... | ... | ... | ... |

- 外部连接：
  | 运营商 | 带宽 | 线路种类 | 连接单位 | 用途 |
  | ... | ... | ... | ... | ... |

## 三、链路情况
| 源 | 目标 | 链路类型 | 带宽 |
| ... | ... | ... | ... |

## 四、边界信息
| 边界位置 | 边界类型 | 安全防护措施 |
| ... | ... | ... |

## 五、网络管理
- 管理工具：{management.tools}
- 管理方式：{management.methods}

## 六、备份情况
- 本地备份：{backup.local}
- 异地备份：{backup.remote}
- 灾备情况：{backup.disaster_recovery}

## 七、AI 分析说明
- 使用模型：{model_name}
- 分析时间：{created_at}
- AI 自评置信度：{confidence}
- 不确定项：{warnings}
```

## 7. 混合模型路由详细设计

### 7.1 路由逻辑

```typescript
async function resolveTopologyModel(
  imageCount: number,
  config: AiConfig
): Promise<{ model: string; mode: 'local' | 'cloud'; apiKey?: string; apiBase?: string }> {
  // 1. 本地模式优先
  if (config.mode === 'local') {
    const running = await checkOllamaRunning(config.ollamaUrl);
    if (running) {
      // 单张图 → 本地视觉模型
      if (imageCount === 1) {
        return { model: config.ollamaModel, mode: 'local' };
      }
      // 多张图 → 检查本地模型是否支持多图（当前 qwen3-vl:8b 不支持多图）
      // 降级到云端
    }
  }

  // 2. 云端模式或本地降级
  const cloudModel = await resolveModelForTask('chat', config); // 复用任务路由
  if (cloudModel.length > 0) {
    return {
      model: cloudModel[0].name,
      mode: 'cloud',
      apiKey: cloudModel[0].apiKey,
      apiBase: cloudModel[0].apiBase,
    };
  }

  // 3. 兜底
  throw new Error('没有可用的视觉模型，请检查 AI 设置中的模型池配置');
}
```

### 7.2 降级策略

| 场景 | 降级路径 |
|---|---|
| 本地模型未运行 | 直接走云端 |
| 本地模型分析失败 | 重试一次 → 仍失败则走云端 |
| 本地模型 confidence < 0.5 | 提示用户"识别置信度较低，是否使用云端模型重新分析？" |
| 多张图（>1） | 本地 8B 模型不支持多图输入，直接走云端 |

## 8. 文件存储

```
project_data/
  └── {project_id}/
      └── topology/              # 拓扑图目录
          ├── images/           # 原始图片
          │   ├── {image_id}.png
          │   └── ...
          └── reports/           # 导出的 Word
              └── {report_id}.docx
```

## 9. 数据库迁移

在 `migrateAiModelsAndRoutes` 后追加：

```sql
CREATE TABLE IF NOT EXISTS topology_images (...);
CREATE TABLE IF NOT EXISTS topology_reports (...);
CREATE INDEX IF NOT EXISTS idx_topology_images_project ON topology_images(project_id);
CREATE INDEX IF NOT EXISTS idx_topology_images_group ON topology_images(group_id);
CREATE INDEX IF NOT EXISTS idx_topology_reports_image ON topology_reports(image_id);
```

## 10. 实现顺序

| 阶段 | 内容 | 预估工作量 |
|---|---|---|
| Phase 1 | DB 迁移 + 基础 CRUD（上传/删除/列表） | 1 个 Task |
| Phase 2 | 单图 AI 分析 + 报告存储 | 1 个 Task |
| Phase 3 | 多图关联分析 | 1 个 Task |
| Phase 4 | 前端 UI（三栏布局 + 交互） | 1-2 个 Task |
| Phase 5 | Word 导出 | 1 个 Task |
| Phase 6 | 混合模型路由 + 降级策略 | 1 个 Task |

## 11. 非目标（不做）

- 不在拓扑图中自动标注设备（仅识别）
- 不生成新的拓扑图（仅分析现有图）
- 不与核查项自动关联（独立模块）
- 不实现实时协作编辑

## 12. 风险清单

| 风险 | 影响 | 缓解措施 |
|---|---|---|
| 本地 8B 模型对复杂拓扑细节识别不准 | 报告中出现错误信息 | 混合路由自动降级 + 用户可手动编辑 |
| 多张图时上下文超长超出模型限制 | 分析失败或截断 | 分步分析（单图→关联），控制每轮输入量 |
| 拓扑图设备密集、文字小 | OCR 识别率低 | 提示用户上传高清图片，云端模型优先 |
| Word 导出格式错乱 | 文档不可读 | 使用 docx 库而非字符串拼接 |

## 13. 验收标准

- [ ] 可上传多张 PNG/JPG 拓扑图到指定项目
- [ ] 可创建分组管理拓扑图
- [ ] 单张图 AI 分析生成结构化报告（5 个部分）
- [ ] 多张图关联分析生成综合报告
- [ ] 报告可在线编辑（行内编辑设备/链路/区域等），保存后标记已编辑状态
- [ ] 可切换本地/云端模型重新分析
- [ ] 本地模型失败时自动降级到云端
- [ ] 可导出 Word 文档
- [ ] 升级后旧数据不受影响
