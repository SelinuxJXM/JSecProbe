# 现场核查导入与下载模板功能设计

**日期**: 2026-07-14  
**状态**: 待实现  
**版本**: v1.2.9+

## 1. 背景

现场核查（onsite-verification）模块已有完整的 Excel 导出功能（`exportExcel` 和 `exportExcelByAssets`）和基础导入功能（`importExcel`），但缺少：

1. **下载模板** — 用户无法获取空白模板离线填写
2. **资产级导入** — 现有导入仅支持全局层面记录（assetId 为空），不支持按资产匹配

本设计补充这两个能力，使现场核查的数据录入流程完整：下载模板 → 离线填写 → 导入系统。

## 2. 模板结构

### 2.1 Sheet 命名约定

| 类型 | Sheet 名格式 | 示例 | 导入行为 |
|------|-------------|------|----------|
| 全局层面 | `{层面名称}` | `安全计算环境` | assetId = null |
| 按资产 | `{层面名称}_{资产名称}` | `安全计算环境_服务器A` | 查找资产并设置 assetId |

### 2.2 列结构（所有 sheet 统一）

| 列 | 字段 | 宽度 | 说明 |
|----|------|------|------|
| A | 序号 | 7 | 自动编号 |
| B | 控制点 | 20 | 预填（只读参考） |
| C | 控制项 | 50 | 预填（只读参考） |
| D | 结果记录 | 80 | **用户填写** |
| E | 符合情况 | 12 | **用户填写**（符合/部分符合/不符合/不适用） |
| F | 证据文件 | 25 | 用户填写（可选） |

### 2.3 模板生成逻辑

```
1. 读取项目信息（standardId、extensionType、项目等级）
2. 按 DOMAIN_SHEETS 顺序遍历每个层面：
   a. 按项目扩展类型过滤 assessmentItems
   b. 生成全局层面 sheet，包含所有测评项（控制点+控制项预填，结果列空）
   c. 按资产类别查找该层面下的所有项目资产
   d. 为每个资产生成一个 sheet（仅包含适用于该资产类别的测评项）
3. 每个 sheet 添加表头行（蓝底白字）
4. 扩展分组行（安全通用要求 / 云计算扩展等）作为分隔
5. 保存对话框 → 写入 xlsx 文件
```

## 3. IPC 处理程序

### 3.1 assessment:downloadTemplate（新增）

```typescript
ipcMain.handle('assessment:downloadTemplate', wrap(async (_event, projectId: string) => {
  // 1. 查询项目 → standardId, extensionType, level
  // 2. 按层面遍历，查询适用的 assessmentItems
  // 3. 查询项目所有资产，按 category 分组
  // 4. 构建 workbook（先全局 sheet，后资产 sheet）
  // 5. 打开保存对话框
  // 6. 写入文件 → 返回 filePath
}));
```

### 3.2 assessment:importExcel（增强）

现有逻辑按 sheet 前缀匹配 domain，需要增加资产识别：

```
对于每个 sheetName:
  1. 解析前缀匹配 domain（沿用现有逻辑，支持"安全计算环境_服务器A"）
  2. 解析剩余部分作为候选资产名称
  3. 在项目资产中查找（精确匹配 → 模糊匹配）
  4. 找到 → 设置 assetId；未找到 → assetId = null（全局记录）
  5. 其余匹配逻辑不变（controlPoint + requirement → itemId）
  6. upsert assessmentRecords
```

## 4. 前端变更

### 4.1 工具栏按钮

文件：[src/views/onsite-verification/index.vue](file:///f:/4-编程项目/1-现场测评工具/开发源代码/src/views/onsite-verification/index.vue)

在导出按钮旁新增两个按钮：

```html
<el-button :icon="Download" @click="handleDownloadTemplate">下载导入模板</el-button>
<el-button :icon="Upload" @click="handleImportExcel">导入测评结果</el-button>
```

### 4.2 事件处理

```typescript
// 下载模板
async function handleDownloadTemplate() {
  const res = await window.api.assessment.downloadTemplate(projectId.value);
  if (res.success) ElMessage.success(`模板已保存到: ${res.data}`);
  else if (res.error?.message !== '用户取消') ElMessage.error(res.error?.message || '下载失败');
}

// 导入测评结果
async function handleImportExcel() {
  const res = await window.api.assessment.importExcel(projectId.value, filePath);
  if (res.success) {
    ElMessage.success(`成功导入 ${res.data.count} 条记录`);
    // 刷新当前页面数据
  } else {
    ElMessage.error(res.error?.message || '导入失败');
  }
}
```

## 5. 数据流

```
[用户点击下载模板]
    → IPC: assessment:downloadTemplate(projectId)
    → 服务端查询 assessmentItems + assets
    → 生成 xlsx（全局sheets + 资产sheets）
    → 保存对话框 → 用户选择路径
    → 返回 { success, data: filePath }

[用户填写模板后点击导入]
    → 文件选择对话框
    → IPC: assessment:importExcel(projectId, filePath)
    → 服务端解析 xlsx
    → 按 sheet 识别 domain + asset
    → 匹配 assessmentItems（controlPoint + requirement）
    → upsert assessmentRecords（带 assetId）
    → 返回 { success, data: { count } }
    → 前端刷新数据
```

## 6. 错误处理

| 场景 | 处理方式 |
|------|----------|
| 文件不存在 | 返回 `{ success: false, error: { message: '文件不存在' } }` |
| sheet 名无法匹配 domain | 跳过该 sheet |
| 控制项在项目中找不到 | 跳过该行，计入跳过计数 |
| 资产名称无法匹配 | 当作全局记录处理 |
| 用户取消文件选择 | 返回 `{ success: false, error: { message: '用户取消' } }` |

## 7. 影响范围

| 文件 | 修改类型 |
|------|----------|
| `electron/ipc/assessment.ipc.ts` | 增强 `importExcel`，新增 `downloadTemplate` |
| `src/views/onsite-verification/index.vue` | 新增按钮和事件处理 |
| `shared/types.ts` | 如有需要，更新 IPC 返回类型 |

## 8. 验收标准

- [ ] 下载模板生成正确的 sheet 结构（全局 + 按资产）
- [ ] 模板中所有项目的测评项已预填（控制点+控制项）
- [ ] 导入时全局 sheet 创建 assetId=null 的记录
- [ ] 导入时资产 sheet 正确匹配并设置 assetId
- [ ] 导入时符合情况文本正确映射到枚举值
- [ ] 重复导入时 upsert 更新而非重复插入
- [ ] 用户取消时优雅处理不报错
- [ ] 前端按钮正常工作，导入后数据自动刷新
