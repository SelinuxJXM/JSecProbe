# Ollama 本地大模型集成方案 — 技术规格说明书

## 一、设计目标

在 JSecProbe 中集成 Ollama 本地大模型支持，使用户无需配置云端 API，即可在本地运行 AI 分析功能。
所有数据完全在本地处理，杜绝数据隐私合规风险。

### 核心约束

| 约束项 | 要求 |
|--------|------|
| 安装包体积 | 不变（Ollama 和模型由用户按需安装） |
| 内存需求 | 8GB 可用 |
| 多模态支持 | 支持图片分析（截图等） |
| 开发周期 | 尽快完成 |
| 兼容性 | 所有现有 AI 功能无缝切换 |

---

## 二、整体架构

```
┌────────────────────────────────────────────────────────────────────┐
│                        JSecProbe 应用                              │
│                                                                    │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │  AI 配置层（新增"接入模式"选择）                              │  │
│  │                                                              │  │
│  │  ┌────────────────────────────────────────────────────────┐  │  │
│  │  │  接入模式: ● 云端服务  ○ 本地 Ollama                    │  │  │
│  │  │                                                       │  │  │
│  │  │  ┌──── 云端模式 ────┐  ┌──── 本地模式 ──────────┐  │  │  │
│  │  │  │ API 地址         │  │ Ollama 状态: ● 运行中   │  │  │  │
│  │  │  │ 密钥             │  │ 已加载模型: Qwen2.5-VL  │  │  │  │
│  │  │  │ 模型 ID          │  │ 内存占用: 4.5GB / 8GB   │  │  │  │
│  │  │  └──────────────────┘  │ 模型管理: [切换/下载]    │  │  │  │
│  │  │                         └────────────────────────┘  │  │  │
│  │  └────────────────────────────────────────────────────────┘  │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                                                    │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │  AI 服务层（electron/ipc/ai.ipc.ts）                         │  │
│  │                                                              │  │
│  │  ┌───────────── 统一调用入口 ─────────────────────────┐     │  │
│  │  │  ai:chat, ai:analyzeAssessment,                     │     │  │
│  │  │  ai:batchAnalyzeScreenshots, ai:analyzeIssue, ...   │     │  │
│  │  └──────────────────────┬────────────────────────────┘     │  │
│  │                         │                                   │  │
│  │         ┌───────────────┴───────────────┐                   │  │
│  │         ▼                               ▼                   │  │
│  │  ┌──────────────┐              ┌──────────────────┐         │  │
│  │  │ 云端 API 调用  │              │ 本地 Ollama 调用  │         │  │
│  │  │ (fetch 远程)  │              │ (fetch localhost) │         │  │
│  │  └──────────────┘              └──────────────────┘         │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                                                    │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │  Ollama 管理模块（新增 electron/services/ollama.service.ts）  │  │
│  │                                                              │  │
│  │  ├── Ollama 检测（进程是否存在 / API 是否可达）              │  │
│  │  ├── 模型列表拉取（ollama list）                             │  │
│  │  ├── 模型拉取引导（ollama pull）                             │  │
│  │  ├── 状态监控（运行中 / 未安装 / 未运行）                    │  │
│  │  └── 安装引导（提供官方下载链接 / 一键安装脚本）            │  │
│  └──────────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────┘
                         │
                         ▼
              ┌──────────────────────┐
              │   Ollama 本地服务     │
              │   localhost:11434     │
              │                      │
              │  ┌──────────────────┐ │
              │  │ Qwen2.5-VL-7B   │ │  ← 主推多模态模型（支持图片）
              │  │ (4-bit, ~4.5GB) │ │
              │  └──────────────────┘ │
              │  ┌──────────────────┐ │
              │  │ Qwen2.5-7B      │ │  ← 备用轻量文本模型（~3.5GB）
              │  └──────────────────┘ │
              └──────────────────────┘
```

---

## 三、数据库 Schema 变更

### 现有表结构（无需改动）

```sql
-- ai_configs 表现有字段
id          TEXT PRIMARY KEY
provider    TEXT DEFAULT 'openai'      -- 暂保留，用于区分
apiKey      TEXT                       -- 云端模式下使用
apiBase     TEXT                       -- 云端 API 地址
model       TEXT DEFAULT 'gpt-4o-mini'
temperature REAL DEFAULT 0.7
ocrProvider TEXT DEFAULT 'tesseract'
ocrApiKey   TEXT
enableAi    INTEGER DEFAULT 0          -- 启用/禁用 AI 功能
privacyMode INTEGER DEFAULT 0
sensitiveWords TEXT
updatedAt   TEXT
createdAt   TEXT
```

### 新增字段

```sql
-- 在 ai_configs 表中新增以下字段
mode        TEXT DEFAULT 'cloud'        -- 'cloud' | 'ollama' 接入模式
ollamaModel TEXT                       -- 当前使用的 Ollama 模型名称
ollamaUrl   TEXT DEFAULT 'http://localhost:11434'  -- Ollama 服务地址
```

**说明：**
- `mode`：切换云端/本地模式
- `ollamaModel`：Ollama 模式下使用的模型（如 `qwen2.5-vl:7b`）
- `ollamaUrl`：Ollama 服务地址（默认 `http://localhost:11434`，用户可自定义）

---

## 四、新增模块：Ollama 管理服务

### 文件：`electron/services/ollama.service.ts`

#### 功能清单

| 功能 | 方法 | 说明 |
|------|------|------|
| 检测 Ollama 是否安装 | `checkOllamaInstalled()` | 检查进程 / API 端口 |
| 检测 Ollama 是否运行 | `checkOllamaRunning()` | GET `http://localhost:11434/api/tags` |
| 获取已安装模型列表 | `listModels()` | GET `http://localhost:11434/api/tags` |
| 获取模型详细信息 | `getModelInfo(modelName)` | GET `http://localhost:11434/api/show` |
| 拉取模型（引导） | `pullModel(modelName, onProgress)` | POST `http://localhost:11434/api/pull` |
| 删除模型 | `deleteModel(modelName)` | DELETE `http://localhost:11434/api/delete` |
| 获取运行状态 | `getStatus()` | 综合检测安装/运行/模型/内存 |
| 获取推荐模型 | `getRecommendedModels()` | 返回推荐列表 |

#### 推荐模型列表

```typescript
const RECOMMENDED_MODELS = [
  {
    name: 'qwen2.5-vl:7b-instruct-q4_K_M',
    label: 'Qwen2.5-VL 7B（推荐）',
    description: '通义千问多模态版，支持图片+文本分析，中文优秀，8GB内存可用',
    size: '~4.5GB',
    minMemory: 8,
    supportsVision: true,
  },
  {
    name: 'qwen2.5:7b-instruct-q4_K_M',
    label: 'Qwen2.5 7B（轻量备选）',
    description: '通义千问纯文本版，资源占用更低，适合低配机器',
    size: '~3.5GB',
    minMemory: 6,
    supportsVision: false,
  },
  {
    name: 'llama3.2:3b-instruct-q4_K_M',
    label: 'Llama 3.2 3B（极速版）',
    description: 'Meta 轻量模型，运行极快，仅需4GB内存，适合快速测试',
    size: '~2GB',
    minMemory: 4,
    supportsVision: false,
  },
];
```

#### 检测逻辑流程

```
checkOllamaInstalled()
  │
  ├─ 1. 尝试连接 http://localhost:11434/api/tags
  │    ├─ 成功 → 已安装且运行中
  │    └─ 失败 →
  │
  ├─ 2. 检查进程是否存在（Windows）
  │    ├─ tasklist | findstr ollama.exe
  │    └─ 存在 → 已安装，等待服务启动
  │
  ├─ 3. 检查默认安装路径
  │    ├─ %LOCALAPPDATA%\Programs\Ollama\ollama.exe
  │    └─ 存在 → 已安装但未运行
  │
  └─ 4. 均未找到 → 未安装
```

---

## 五、IPC 层变更

### 文件：`electron/ipc/ai.ipc.ts`

#### 新增 IPC 通道

| 通道名 | 方向 | 参数 | 返回值 | 说明 |
|--------|------|------|--------|------|
| `ai:ollama:status` | 主进程→渲染进程 | - | `{ installed, running, models, activeModel, memory }` | 获取 Ollama 状态 |
| `ai:ollama:listModels` | 主进程→渲染进程 | - | `{ name, size, digest, modifiedAt }[]` | 获取已安装模型列表 |
| `ai:ollama:pullModel` | 主进程→渲染进程 | `{ modelName }` | 进度事件流 | 拉取模型（带进度） |
| `ai:ollama:deleteModel` | 主进程→渲染进程 | `{ modelName }` | `{ success }` | 删除模型 |
| `ai:ollama:installGuide` | 主进程→渲染进程 | - | `{ downloadUrl, installPath }` | 获取安装引导信息 |
| `ai:checkOllamaHealth` | 渲染进程→主进程 | - | `{ status, models, error }` | 前端定时轮询健康状态 |

#### 现有 IPC 通道变更

**`ai:testConnection` 改造：** 根据 `mode` 参数自动选择测试方式

```typescript
// 现有逻辑（无需改动）
ipcMain.handle('ai:testConnection', async (_event, params) => {
  const config = await getAiConfig();
  if (config.mode === 'ollama') {
    // 直接测试 Ollama API
    return testOllamaConnection(config.ollamaUrl, config.ollamaModel);
  } else {
    // 现有云端测试逻辑
    return testCloudConnection(params.apiBase, params.apiKey, params.model);
  }
});
```

**`ai:chat` / `ai:analyzeAssessment` 等核心通道：** 无需改动

因为当前代码已经使用 `fetch(apiUrl, ...)` 发送请求，并且 `apiUrl` 来自配置中的 `apiBase`。只需在保存配置时，根据 `mode` 自动设置 `apiBase` 即可：

```typescript
// 保存配置时自动处理
function normalizeConfig(config) {
  if (config.mode === 'ollama') {
    config.apiBase = (config.ollamaUrl || 'http://localhost:11434') + '/v1';
    config.apiKey = 'ollama';  // Ollama 不需要密钥，但占位
    config.model = config.ollamaModel;
  }
  return config;
}
```

**核心原理：** Ollama 从 0.1.32 版本开始提供 OpenAI 兼容 API，地址为 `http://localhost:11434/v1/chat/completions`，请求格式与 OpenAI 完全一致，因此当前所有 AI 分析代码无需修改！

---

## 六、前端 UI 变更

### 文件：`src/views/ai-assistant/index.vue`

#### AI 设置弹窗改造

在现有 AI 设置弹窗顶部，新增「接入模式」选择器：

```
┌─────────────────────────────────────────────────────────┐
│  AI 设置                                                 │
│                                                         │
│  ┌──── 接入模式 ──────────────────────────────────────┐ │
│  │  ○ 云端服务（当前方式）                              │ │
│  │  ● 本地 Ollama（数据不离开本机）                    │ │
│  └─────────────────────────────────────────────────────┘ │
│                                                         │
│  ┌──── 本地 Ollama 设置 ──────────────────────────────┐ │
│  │  [状态指示器] ● Ollama 运行中                      │ │
│  │  [模型选择]    Qwen2.5-VL 7B ▼ [下载] [删除]      │ │
│  │  [服务地址]    http://localhost:11434               │ │
│  │  [内存占用]    ████████░░ 4.5GB / 8.0GB           │ │
│  │  [刷新状态]    [打开 Ollama 官网]                  │ │
│  │                                                   │ │
│  │  ┌──── 未安装引导 ─────────────────────────────┐  │ │
│  │  │  ⚠️ 未检测到 Ollama                          │  │ │
│  │  │  1. 访问 https://ollama.com/download 下载    │  │ │
│  │  │  2. 安装后运行 Ollama                        │  │ │
│  │  │  3. 点击下方「下载推荐模型」                  │  │ │
│  │  │  [下载推荐模型] [重新检测]                    │  │ │
│  │  └─────────────────────────────────────────────┘  │ │
│  └─────────────────────────────────────────────────────┘ │
│                                                         │
│  ┌──── 隐私模式 / 敏感词 ────────────────────────────┐ │
│  │  （保持现有内容不变）                               │ │
│  └─────────────────────────────────────────────────────┘ │
│                                                         │
│  ┌──── 测试连接 ──────────────────────────────────────┐ │
│  │  [🔌 测试连接]  ✅ 连接成功！模型：qwen2.5-vl:7b  │ │
│  └─────────────────────────────────────────────────────┘ │
│                                                         │
│              [取消]            [保存]                    │
└─────────────────────────────────────────────────────────┘
```

#### 状态指示器设计

三种状态，用不同颜色指示：

```typescript
type OllamaStatus = 
  | { state: 'running';    models: ModelInfo[]; activeModel: string; memoryUsage: number }
  | { state: 'not_running' }  // 已安装但未运行
  | { state: 'not_installed' } // 未安装
```

- **运行中**：绿色指示灯 + 模型列表 + 内存占用
- **已安装未运行**：黄色指示灯 + "启动 Ollama" 按钮
- **未安装**：红色指示灯 + 安装引导步骤

### 文件：`src/views/ai-assistant/index.vue` — 脚本变更

新增以下响应式状态：

```typescript
// 接入模式
const aiMode = ref<'cloud' | 'ollama'>('cloud');

// Ollama 状态
const ollamaStatus = ref<OllamaStatus>({ state: 'not_installed' });
const ollamaModels = ref<ModelInfo[]>([]);
const ollamaPulling = ref(false);
const ollamaPullProgress = ref(0);
const ollamaPullModelName = ref('');

// 定时轮询
let ollamaHealthTimer: number | null = null;
```

新增方法：

```typescript
// 初始化：加载配置时检测模式
async function loadSettings() {
  const res = await window.api.ai.getConfig();
  if (res.success && res.data) {
    aiMode.value = res.data.mode || 'cloud';
    // ... 现有加载逻辑
    if (aiMode.value === 'ollama') {
      refreshOllamaStatus();
    }
  }
}

// 刷新 Ollama 状态
async function refreshOllamaStatus() {
  const res = await window.api.ai.ollamaStatus();
  ollamaStatus.value = res.data;
}

// 下载模型
async function pullModel(modelName: string) {
  ollamaPulling.value = true;
  ollamaPullModelName.value = modelName;
  // 通过 IPC 监听下载进度事件
  // 完成后自动刷新模型列表
}

// 保存配置时
async function saveSettings() {
  const config: any = {
    mode: aiMode.value,
    privacyMode: aiSettings.privacyMode ? 1 : 0,
    sensitiveWords: aiSettings.sensitiveWords,
  };
  
  if (aiMode.value === 'ollama') {
    config.ollamaUrl = 'http://localhost:11434';
    config.ollamaModel = selectedOllamaModel.value;
    // 自动填充 apiBase/apiKey/model 使现有代码兼容
    config.apiBase = 'http://localhost:11434/v1';
    config.apiKey = 'ollama';
    config.model = selectedOllamaModel.value;
  } else {
    // 现有云端配置逻辑
    config.apiBase = aiSettings.baseUrl;
    config.apiKey = aiSettings.apiKey;
    config.model = aiSettings.model;
  }
  
  // ... 调用 saveConfig
}
```

---

## 七、完整文件变更清单

| 文件 | 变更类型 | 工作量估算 |
|------|---------|-----------|
| `electron/db/schema.ts` | 新增 3 个字段（mode, ollamaModel, ollamaUrl） | 极小（~10行） |
| `electron/services/ollama.service.ts` | **新增文件** | 中等（~250行） |
| `electron/ipc/ai.ipc.ts` | 新增 6 个 IPC 通道 + 现有通道适配 | 小（~150行） |
| `electron/preload/index.ts` | 新增 Ollama IPC 桥接方法 | 小（~30行） |
| `src/views/ai-assistant/index.vue` | AI 设置弹窗改造 + Ollama 状态管理 | 中等（~300行） |
| `src/views/ai-assistant/index.vue` | 脚本部分新增状态和方法 | 中等（~200行） |
| 数据库迁移脚本 | 新增字段迁移 | 极小（~15行） |
| **总计** | | **~950行** |

---

## 八、Ollama 安装引导流程

```
用户选择"本地 Ollama"模式
         │
         ▼
┌─────────────────────────────┐
│  检测 Ollama 状态            │
│                             │
│  ┌──────────┐ ┌──────────┐  │
│  │ 未安装    │ │ 已安装但   │  │
│  │          │ │ 未运行    │  │
│  └────┬─────┘ └────┬─────┘  │
│       │            │        │
│       ▼            ▼        │
│  ┌──────────┐ ┌──────────┐  │
│  │ 显示安装  │ │ 显示"启  │  │
│  │ 引导步骤  │ │ 动Ollama │  │
│  │ + 下载链接 │ │ 按钮     │  │
│  └──────────┘ └──────────┘  │
│       │            │        │
│       └─────┬──────┘        │
│             ▼               │
│  ┌──────────────────────┐   │
│  │ 运行中               │   │
│  │ 显示已安装模型列表    │   │
│  └──────────┬───────────┘   │
│             │               │
│             ▼               │
│  ┌──────────────────────┐   │
│  │ 选择/下载推荐模型     │   │
│  │ 推荐 Qwen2.5-VL 7B   │   │
│  │ [一键下载] [已有模型]│   │
│  └──────────┬───────────┘   │
│             │               │
│             ▼               │
│  ┌──────────────────────┐   │
│  │ 测试连接              │   │
│  │ 自动测试 / 手动点击    │   │
│  └──────────┬───────────┘   │
│             │               │
│             ▼               │
│  ┌──────────────────────┐   │
│  │ 保存配置              │   │
│  │ 自动填充 apiBase 等   │   │
│  └──────────────────────┘   │
└─────────────────────────────┘
```

---

## 九、图片处理适配

### 现状分析

当前代码中，图片处理流程是：

```
截图 → [encodeImageToBase64] → base64编码 → 以 image_url 格式发送给 AI
```

Qwen2.5-VL 7B 多模态模型支持 `image_url` 格式，格式与 OpenAI Vision API 完全兼容，因此 **无需修改图片处理代码**。

### 唯一需要确认的配置

`temperature` 参数在当前代码中已支持，Qwen2.5-VL 同样支持该参数，无需改动。

---

## 十、实现优先级

### 第一阶段：核心功能（可独立使用）

| 步骤 | 内容 | 说明 |
|------|------|------|
| 1 | 数据库 Schema 新增字段 | mode、ollamaModel、ollamaUrl |
| 2 | 创建 `ollama.service.ts` | 检测、状态、模型列表、引导信息 |
| 3 | `ai.ipc.ts` 新增 Ollama IPC 通道 | 6 个新增通道 |
| 4 | `preload/index.ts` 桥接 | 暴露到渲染进程 |
| 5 | AI 设置弹窗改造 | 接入模式切换 + Ollama 状态面板 |
| 6 | 保存配置时自动适配 | 云端/本地自动填充 apiBase |

### 第二阶段：完善体验

| 步骤 | 内容 | 说明 |
|------|------|------|
| 7 | 模型下载进度条 | 监听 pull 进度事件 |
| 8 | 定时健康检查 | 前端轮询 Ollama 状态 |
| 9 | 安装引导界面 | 分步引导用户安装 |
| 10 | 首次使用提示 | 检测到未安装时的引导弹窗 |

### 第三阶段：优化

| 步骤 | 内容 | 说明 |
|------|------|------|
| 11 | 模型内存占用监控 | 显示当前内存使用 |
| 12 | 模型切换热重载 | 切换模型无需重启应用 |
| 13 | 一键安装 Ollama 脚本 | 直接下载安装包并启动 |

---

## 十一、关键代码示例

### 1. Ollama 服务检测

```typescript
// electron/services/ollama.service.ts
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import log from 'electron-log';

const OLLAMA_DEFAULT_URL = 'http://localhost:11434';
const OLLAMA_API_TAGS = '/api/tags';
const OLLAMA_API_PULL = '/api/pull';
const OLLAMA_API_SHOW = '/api/show';

export interface OllamaModel {
  name: string;
  size: number;
  digest: string;
  modifiedAt: string;
  details?: {
    parameterSize: string;
    quantization: string;
    family: string;
  };
}

export interface OllamaStatus {
  state: 'running' | 'not_running' | 'not_installed';
  models?: OllamaModel[];
  error?: string;
}

async function fetchOllama(url: string, endpoint: string, options?: RequestInit) {
  const response = await fetch(`${url}${endpoint}`, {
    ...options,
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) {
    throw new Error(`Ollama API error: ${response.status}`);
  }
  return response.json();
}

export async function checkOllamaInstalled(): Promise<boolean> {
  try {
    // 方式1：检查默认安装路径
    const localAppData = process.env.LOCALAPPDATA || '';
    const ollamaExe = path.join(localAppData, 'Programs', 'Ollama', 'ollama.exe');
    if (fs.existsSync(ollamaExe)) {
      return true;
    }
    // 方式2：检查进程
    execSync('tasklist /fi "imagename eq ollama.exe"', { stdio: 'pipe', timeout: 3000 });
    return true;
  } catch {
    return false;
  }
}

export async function checkOllamaRunning(url: string = OLLAMA_DEFAULT_URL): Promise<boolean> {
  try {
    await fetchOllama(url, OLLAMA_API_TAGS);
    return true;
  } catch {
    return false;
  }
}

export async function getOllamaStatus(): Promise<OllamaStatus> {
  try {
    const running = await checkOllamaRunning();
    if (running) {
      const models = await listModels();
      return { state: 'running', models };
    }
    const installed = await checkOllamaInstalled();
    return { state: installed ? 'not_running' : 'not_installed' };
  } catch (err: any) {
    log.error('[Ollama] 状态检查失败:', err.message);
    return { state: 'not_installed', error: err.message };
  }
}

export async function listModels(url: string = OLLAMA_DEFAULT_URL): Promise<OllamaModel[]> {
  const data = await fetchOllama(url, OLLAMA_API_TAGS);
  return (data.models || []).map((m: any) => ({
    name: m.name,
    size: m.size,
    digest: m.digest,
    modifiedAt: m.modified_at,
  }));
}
```

### 2. IPC 通道注册

```typescript
// electron/ipc/ai.ipc.ts 新增
import { getOllamaStatus, listModels, checkOllamaInstalled, checkOllamaRunning } from '../services/ollama.service';

// 新增 Ollama IPC 通道
ipcMain.handle('ai:ollama:status', async () =>
  wrap(async () => {
    return getOllamaStatus();
  })
);

ipcMain.handle('ai:ollama:listModels', async () =>
  wrap(async () => {
    return listModels();
  })
);

ipcMain.handle('ai:ollama:installGuide', async () =>
  wrap(async () => {
    return {
      downloadUrl: 'https://ollama.com/download',
      installPath: path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Ollama'),
      docsUrl: 'https://github.com/ollama/ollama',
    };
  })
);
```

### 3. 配置保存时自动适配模式

```typescript
// 在 ai.ipc.ts 的 ai:saveConfig handler 中
ipcMain.handle('ai:saveConfig', async (_event, config: any) =>
  wrap(async () => {
    const db = getDb();
    const now = new Date().toISOString();
    
    // 根据模式自动填充
    let saveData: any = {
      mode: config.mode || 'cloud',
      privacyMode: config.privacyMode ?? 0,
      sensitiveWords: config.sensitiveWords || '',
      updatedAt: now,
    };
    
    if (config.mode === 'ollama') {
      saveData.ollamaUrl = config.ollamaUrl || 'http://localhost:11434';
      saveData.ollamaModel = config.ollamaModel || 'qwen2.5-vl:7b';
      saveData.apiBase = `${saveData.ollamaUrl}/v1`;
      saveData.apiKey = 'ollama';
      saveData.model = saveData.ollamaModel;
      saveData.provider = 'ollama';
    } else {
      saveData.apiBase = config.apiBase;
      saveData.apiKey = config.apiKey;
      saveData.model = config.model;
      saveData.temperature = config.temperature ?? 0.3;
      saveData.provider = config.provider || 'openai';
      saveData.ollamaUrl = null;
      saveData.ollamaModel = null;
    }
    
    // ... 现有的 upsert 逻辑
  })
);
```

---

## 十二、风险与注意事项

| 风险 | 影响 | 应对措施 |
|------|------|---------|
| Ollama 安装包较大（~200MB） | 用户下载安装有心理门槛 | 提供分步安装引导，清晰说明必要性 |
| 模型下载需要网络（~4.5GB） | 首次使用等待时间长 | 显示下载进度，支持断点续传 |
| 8GB 内存运行 7B 模型可能较慢 | 用户体验下降 | 推荐 3B 模型作为备选，显示内存占用 |
| Qwen2.5-VL 多模态能力有限 | 复杂截图分析效果不佳 | 结合 OCR 作为备选方案 |
| Ollama 服务可能因系统休眠等异常退出 | AI 功能不可用 | 定时健康检查 + 自动重连提示 |

---

## 十三、总结

| 维度 | 评估 |
|------|------|
| 安装包体积 | ✅ 不变 |
| 数据隐私 | ✅ 完全本地，不离开本机 |
| 多模态支持 | ✅ Qwen2.5-VL 7B 支持图片分析 |
| 8GB内存 | ✅ 量化后 4.5GB，可运行 |
| 代码改动量 | ~950行，主要集中在 UI 和 Ollama 管理服务 |
| 现有代码兼容性 | ✅ 无需修改核心 AI 分析逻辑 |
| 用户体验 | 分步安装引导 + 状态监控 + 一键下载 |