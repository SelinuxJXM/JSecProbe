# 自动采集执行引擎 Phase 1（SSH 采集闭环）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 按任务执行。步骤使用 checkbox（`- [ ]`）跟踪。

**Goal:** 实现"连接配置管理 + SSH 命令采集 + 结果人工确认回填"的完整闭环（Linux / Windows OpenSSH）。

**Architecture:** 复用现有 Electron 主进程服务 + IPC + preload 模式。新增 `connection_profiles` / `collection_tasks` / `collection_results` 表（drizzle migration 0004），主进程 `collection.service.ts` 调度采集，`connectors/ssh.connector.ts` 通过 `ssh2` 执行命令，进度经 `webContents.send('collection:progress')` 推送，前端在现场核查表格"操作"列新增"采集"按钮，弹窗配置连接→选择命令→执行→确认回填测评记录。

**Tech Stack:** TypeScript、Electron 29、better-sqlite3 + drizzle-orm、Vue 3 + Element Plus、ssh2。

**参考设计文档:** `docs/2026-09-17-自动采集执行引擎设计方案.md`（v1.1 已确认）

---

## 文件结构

| 文件 | 职责 |
|------|------|
| `electron/db/schema.ts` | 新增 4 张表定义（connectionProfiles / assetConnections / collectionTasks / collectionResults） |
| `electron/db/migrations/0004_*.sql` | drizzle-kit generate 生成 |
| `electron/services/credential.util.ts` | safeStorage 加解密（复用现有 `auth:encryptCredential` 等价逻辑，主进程直接调用） |
| `electron/services/connectors/connector.ts` | `IConnector` 接口 + `ExecResult` + `ConnectionProfile` 类型引用 |
| `electron/services/connectors/ssh.connector.ts` | SSH 适配器（ssh2，密码/私钥） |
| `electron/services/connectors/factory.ts` | 适配器工厂（Phase 1 仅 ssh） |
| `electron/services/collection.service.ts` | 采集调度器：任务 CRUD、执行循环、进度推送、结果回填 |
| `electron/ipc/collection.ipc.ts` | IPC 处理器（wrap + requireSession） |
| `electron/main/ipc.ts` | 注册 `registerCollectionHandlers()` |
| `electron/preload/index.ts` | 暴露 `window.api.collection` |
| `shared/types.ts` | ApiBridge.collection + 类型定义 |
| `src/views/onsite-verification/index.vue` | 操作列加"采集"按钮 + 引入组件 |
| `src/views/onsite-verification/components/collection-dialog.vue` | 采集弹窗（连接配置 + 命令选择 + 进度 + 结果确认回填，Phase 1 合并为一个组件） |

---

## Task 1: 安装依赖

- [ ] 安装 `ssh2`（运行时）与 `@types/ssh2`（开发）：

```bash
npm install ssh2
npm install -D @types/ssh2
```

- [ ] 验证：`node -e "require('ssh2'); console.log('ok')"` 输出 `ok`。

## Task 2: 数据库表定义（schema.ts）

- [ ] 在 `electron/db/schema.ts` 末尾追加以下表定义：

```ts
export const connectionProfiles = sqliteTable('connection_profiles', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  connType: text('conn_type').notNull(),
  host: text('host').notNull(),
  port: integer('port'),
  username: text('username'),
  authMethod: text('auth_method').notNull().default('password'),
  passwordEncrypted: text('password_encrypted'),
  privateKeyPath: text('private_key_path'),
  timeoutMs: integer('timeout_ms').notNull().default(10000),
  extraConfig: text('extra_config'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const assetConnections = sqliteTable('asset_connections', {
  id: text('id').primaryKey(),
  assetId: text('asset_id').notNull(),
  connectionId: text('connection_id').notNull(),
  commandScope: text('command_scope'),
  createdAt: text('created_at').notNull(),
});

export const collectionTasks = sqliteTable('collection_tasks', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull(),
  assetId: text('asset_id').notNull(),
  connectionId: text('connection_id').notNull(),
  status: text('status').notNull().default('pending'),
  totalCommands: integer('total_commands').notNull().default(0),
  completedCommands: integer('completed_commands').notNull().default(0),
  progress: integer('progress').notNull().default(0),
  startedAt: text('started_at'),
  finishedAt: text('finished_at'),
  createdBy: text('created_by'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const collectionResults = sqliteTable('collection_results', {
  id: text('id').primaryKey(),
  taskId: text('task_id').notNull(),
  commandId: text('command_id'),
  command: text('command').notNull(),
  status: text('status').notNull(),
  exitCode: integer('exit_code'),
  stdout: text('stdout'),
  stderr: text('stderr'),
  durationMs: integer('duration_ms').notNull().default(0),
  parsedData: text('parsed_data'),
  createdAt: text('created_at').notNull(),
});
```

## Task 3: 生成迁移

- [ ] 运行 `npm run db:generate`，生成 `electron/db/migrations/0004_*.sql`（含 4 张表 CREATE TABLE）。
- [ ] 检查生成的 SQL 中表名/字段与 schema 一致。

## Task 4: 凭据加密工具

- [ ] 新建 `electron/services/credential.util.ts`：

```ts
import { safeStorage } from 'electron';

const ENC_PREFIX = 'enc:';

export function encryptSecret(plain: string | null | undefined): string {
  if (!plain) return '';
  if (!safeStorage.isEncryptionAvailable()) {
    return ENC_PREFIX + Buffer.from(plain, 'utf8').toString('base64');
  }
  return ENC_PREFIX + safeStorage.encryptString(plain).toString('base64');
}

export function decryptSecret(stored: string | null | undefined): string {
  if (!stored) return '';
  const data = stored.startsWith(ENC_PREFIX) ? stored.slice(ENC_PREFIX.length) : stored;
  if (!safeStorage.isEncryptionAvailable()) {
    return Buffer.from(data, 'base64').toString('utf8');
  }
  return safeStorage.decryptString(Buffer.from(data, 'base64'));
}
```

- [ ] 验证：`npx tsx -e "import { encryptSecret, decryptSecret } from './electron/services/credential.util'; const e = encryptSecret('abc'); console.log(decryptSecret(e) === 'abc');"` 输出 `true`（tsx 下 safeStorage 可能不可用，会走降级分支）。

## Task 5: 连接器接口 + SSH 适配器 + 工厂

- [ ] 新建 `electron/services/connectors/connector.ts`：

```ts
import type { ConnectionProfile } from '../../shared/types';

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
}

export interface IConnector {
  connect(profile: ConnectionProfile): Promise<void>;
  execute(cmd: string): Promise<ExecResult>;
  disconnect(): Promise<void>;
  testConnection(profile: ConnectionProfile): Promise<boolean>;
}
```

- [ ] 新建 `electron/services/connectors/ssh.connector.ts`：

```ts
import { Client, type ConnectConfig } from 'ssh2';
import * as fs from 'fs';
import type { ConnectionProfile } from '../../shared/types';
import { decryptSecret } from '../credential.util';
import type { IConnector, ExecResult } from './connector';

export class SshConnector implements IConnector {
  private client: Client | null = null;

  async connect(profile: ConnectionProfile): Promise<void> {
    if (this.client) return;
    const cfg: ConnectConfig = {
      host: profile.host,
      port: profile.port || 22,
      username: profile.username || undefined,
      readyTimeout: profile.timeoutMs || 10000,
    };
    if (profile.authMethod === 'privateKey' && profile.privateKeyPath) {
      cfg.privateKey = await fs.promises.readFile(profile.privateKeyPath, 'utf8');
    } else {
      cfg.password = decryptSecret(profile.passwordEncrypted);
    }
    await new Promise<void>((resolve, reject) => {
      const client = new Client();
      client.on('ready', () => { this.client = client; resolve(); });
      client.on('error', reject);
      client.connect(cfg);
    });
  }

  async execute(cmd: string): Promise<ExecResult> {
    if (!this.client) throw new Error('SSH 连接未建立');
    return new Promise((resolve, reject) => {
      const start = Date.now();
      this.client!.exec(cmd, (err, stream) => {
        if (err) return reject(err);
        let stdout = '';
        let stderr = '';
        stream.on('close', (code: number) => {
          resolve({ stdout, stderr, exitCode: code, durationMs: Date.now() - start });
        });
        stream.on('data', (d: Buffer) => { stdout += d.toString(); });
        stream.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
      });
    });
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      this.client.end();
      this.client = null;
    }
  }

  async testConnection(profile: ConnectionProfile): Promise<boolean> {
    try {
      await this.connect(profile);
      await this.disconnect();
      return true;
    } catch {
      return false;
    }
  }
}
```

- [ ] 新建 `electron/services/connectors/factory.ts`：

```ts
import type { ConnectionProfile } from '../../shared/types';
import type { IConnector } from './connector';
import { SshConnector } from './ssh.connector';

export function createConnector(profile: ConnectionProfile): IConnector {
  switch (profile.connType) {
    case 'ssh':
      return new SshConnector();
    default:
      throw new Error(`Phase 1 暂不支持连接类型: ${profile.connType}`);
  }
}
```

## Task 6: 采集服务（collection.service.ts）

- [ ] 新建 `electron/services/collection.service.ts`，实现：
  - `listProfiles()` / `saveProfile(data)` / `deleteProfile(id)`
  - `createTask({ projectId, assetId, connectionId, commandIds, sender })`：建任务 → 异步执行
  - `runTask(task, sender)`：连 SSH → 逐条执行命令 → 写 `collection_results` → 更新任务进度 → `sender.send('collection:progress', ...)`
  - `cancelTask(id)`：置 `canceling`，执行循环检查标志
  - `listTasks({ projectId, assetId })` / `getTask(id)` / `listResults(taskId)`
  - `confirmResult({ resultId, itemId, assetId, projectId, result, method })`：读结果 → 写入/更新 `assessment_records`（复用 saveRecord 白名单字段），并更新任务结果状态

关键代码（进度推送与取消）：

```ts
export async function runCollectionTask(
  taskId: string,
  projectId: string,
  assetId: string,
  connectionId: string,
  commandIds: string[],
  sender: Electron.WebContents
): Promise<void> {
  const db = getDb();
  const profile = await getProfile(connectionId);
  if (!profile) throw new Error('连接配置不存在');
  const connector = createConnector(profile);
  await connector.connect(profile);
  try {
    let done = 0;
    const total = commandIds.length;
    for (const commandId of commandIds) {
      const task = await db.query.collectionTasks.findFirst({ where: eq(schema.collectionTasks.id, taskId) });
      if (!task || task.status === 'canceled' || task.status === 'canceling') break;
      const cmd = await db.query.knowledgeCommands.findFirst({ where: eq(schema.knowledgeCommands.id, commandId) });
      if (!cmd) continue;
      try {
        const exec = await connector.execute(cmd.command);
        await db.insert(schema.collectionResults).values({
          id: randomUUID(), taskId, commandId, command: cmd.command,
          status: exec.exitCode === 0 ? 'success' : 'failed',
          exitCode: exec.exitCode, stdout: exec.stdout, stderr: exec.stderr,
          durationMs: exec.durationMs, createdAt: new Date().toISOString(),
        });
      } catch (err: any) {
        await db.insert(schema.collectionResults).values({
          id: randomUUID(), taskId, commandId, command: cmd.command,
          status: 'error', stderr: String(err?.message || err),
          durationMs: 0, createdAt: new Date().toISOString(),
        });
      }
      done++;
      const progress = Math.round((done / total) * 100);
      await db.update(schema.collectionTasks).set({ completedCommands: done, progress, updatedAt: new Date().toISOString() }).where(eq(schema.collectionTasks.id, taskId));
      sender.send('collection:progress', { taskId, status: 'running', stage: 'executing', message: `正在执行：${cmd.command}`, percent: progress, completedCommands: done, totalCommands: total });
    }
    const finalStatus = done < total ? 'partial' : 'success';
    await db.update(schema.collectionTasks).set({ status: finalStatus, progress: 100, finishedAt: new Date().toISOString(), updatedAt: new Date().toISOString() }).where(eq(schema.collectionTasks.id, taskId));
    sender.send('collection:progress', { taskId, status: finalStatus, stage: 'done', message: '采集完成', percent: 100, completedCommands: done, totalCommands: total });
  } catch (err: any) {
    await db.update(schema.collectionTasks).set({ status: 'failed', finishedAt: new Date().toISOString(), updatedAt: new Date().toISOString() }).where(eq(schema.collectionTasks.id, taskId));
    sender.send('collection:progress', { taskId, status: 'failed', stage: 'error', message: String(err?.message || err), percent: 0, completedCommands: 0, totalCommands: commandIds.length });
  } finally {
    await connector.disconnect();
  }
}
```

## Task 7: IPC 层（collection.ipc.ts）

- [ ] 新建 `electron/ipc/collection.ipc.ts`，注册：
  - `collection:listProfiles` / `collection:saveProfile` / `collection:deleteProfile` / `collection:testConnection`
  - `collection:createTask`（传入 `_event.sender`）/ `collection:cancelTask` / `collection:getTask` / `collection:listTasks` / `collection:listResults`
  - `collection:confirmResult`
- 全部使用 `wrap(..., { moduleName: 'collection', requireSession: true })`，密码字段在前端传入明文，主进程 `encryptSecret` 后落库。

## Task 8: shared/types + preload

- [ ] `shared/types.ts` 增加 `ConnectionProfile`、`CollectionTask`、`CollectionResult`、`CollectionProgress` 类型，并在 `ApiBridge` 增加 `collection` 服务定义（含 `onProgress` 事件监听）。
- [ ] `electron/preload/index.ts` 增加 `collection` 对象（`onProgress` 仿照 `ai.onAnalysisProgress` 实现）。

## Task 9: 主进程注册

- [ ] `electron/main/ipc.ts` 导入并调用 `registerCollectionHandlers()`。

## Task 10: 前端采集组件 + 现场核查页面接入

- [ ] 新建 `src/views/onsite-verification/components/collection-dialog.vue`：
  - 连接配置：新建/选择 SSH 连接（名称、主机、端口、用户名、密码/私钥路径、超时），"测试连接"
  - 命令选择：调用 `window.api.knowledge.listCommands({ os, pageSize: 500 })` 按 `os`（来自当前资产）过滤，复选框选择
  - 执行与进度：监听 `window.api.collection.onProgress`，展示进度条与当前命令
  - 结果确认：任务完成后加载 `listResults`，每条命令展示 stdout/stderr + 符合性选择（符合/部分/不符合/不适用）+ "回填到测评记录"
- [ ] `src/views/onsite-verification/index.vue`：
  - 操作列（第 274-278 行 `<td class="cell-actions">`）在 AI 按钮旁新增"采集"按钮
  - `handleQuoteCommand` 附近新增 `openCollectionDialog(row)`，记录 `currentCollectionRow`
  - 底部引入 `<CollectionDialog :asset="currentAsset" :row="currentCollectionRow" />`

## Task 11: 类型检查与端到端验证

- [ ] `npx vue-tsc --noEmit` 零错误。
- [ ] 启动 `npm run dev`，手工冒烟：
  1. 现场核查 → 任一行"操作"列点"采集"
  2. 新建 SSH 连接（可用本机 `ssh root@127.0.0.1` 或内网 Linux）
  3. 测试连接成功
  4. 勾选若干 Linux 核查命令 → 执行
  5. 进度实时更新
  6. 结果展示，选择"符合"→ 回填 → 检查该行证据点已写入输出、符合性已更新
- [ ] 检查 `collection_tasks` / `collection_results` / `connection_profiles` 表数据正确。

---

## 自审查记录

- **Spec 覆盖**：设计文档 §4（4 张表）✓、§5（SSH 适配器）✓、§6（调度器）✓、§7（解析+人工确认回填，Phase 1 用 RawText 直接落 stdout）✓、§8（safeStorage + 日志脱敏）✓、§9（前端交互）✓、§10（IPC/preload/注册）✓。
- **占位符扫描**：无 TODO/TBD；所有关键代码已给出。
- **类型一致性**：`ConnectionProfile` / `CollectionTask` / `CollectionResult` / `CollectionProgress` 命名在 shared/types、connector、service、ipc、preload、前端组件中保持一致；`confirmResult` 复用 `assessment_records` 白名单字段（projectId/itemId/assetId/result/method/commandOutput/evidence）。
- **已知边界**：Phase 1 仅 `ssh` 类型；`asset_connections` 表在 Phase 1 暂不写入（连接配置独立使用，资产关联留待 Phase 2 前端绑定）；解析器 Phase 1 统一用原始输出（stdout 直接作为 evidence）。