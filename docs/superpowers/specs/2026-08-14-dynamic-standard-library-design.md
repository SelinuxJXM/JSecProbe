# 动态标准库管理设计规格

## 一、背景与目标

### 1.1 现状问题
- 当前"标准体系"选择仅用于文本显示，无实际功能
- 项目创建时标准ID硬编码，无法选择其他标准
- 新增行业标准需要修改代码并重新打包

### 1.2 设计目标
- 支持多种标准库（国标、电力、金融等）动态管理
- 项目创建时可选择实际使用的标准库
- 用户可通过界面导入/编辑/删除标准库
- 不影响现有国标数据，平滑升级

## 二、数据模型

### 2.1 standards 表（已有）
| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT PRIMARY KEY | 标准ID，如 'gb-t-22239-2019-l3' |
| name | TEXT NOT NULL | 标准名称，如 'GB/T 22239-2019 三级' |
| code | TEXT UNIQUE NOT NULL | 标准代号 |
| version | TEXT NOT NULL | 版本号 |
| description | TEXT | 描述 |
| grade | INTEGER | 等级（2/3/4） |
| domainCount | INTEGER | 安全域数量 |
| itemCount | INTEGER | 测评项数量 |
| isDefault | INTEGER | 是否默认标准 |
| createdAt | TEXT | 创建时间 |

### 2.2 assessment_items 表（已有）
| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT PRIMARY KEY | 测评项ID |
| standardId | TEXT NOT NULL | 关联标准ID |
| domain | TEXT NOT NULL | 安全域 |
| controlPoint | TEXT NOT NULL | 控制点 |
| controlName | TEXT NOT NULL | 控制名称 |
| requirement | TEXT NOT NULL | 具体要求 |
| minLevel | INTEGER | 最低适用等级 |
| maxLevel | INTEGER | 最高适用等级 |
| extensionType | TEXT | 扩展类型（general/cloud/mobile等） |
| isHighRisk | INTEGER | 是否高风险 |
| sortOrder | INTEGER | 排序号 |
| parentId | TEXT | 父项ID（子项关联） |

### 2.3 projects 表变更
新增字段：
```sql
ALTER TABLE projects ADD COLUMN standard_id TEXT;
UPDATE projects SET standard_id = 'gb-t-22239-2019-l3' WHERE standard_id IS NULL;
-- 保留 standardSystem 字段用于向后兼容
```

## 三、接口设计

### 3.1 标准库管理接口（standard.ipc.ts）

| 接口 | 方法 | 参数 | 说明 |
|------|------|------|------|
| standard:list | handle | - | 获取所有标准列表 |
| standard:getItems | handle | standardId, domain? | 获取标准下的测评项 |
| standard:getDomains | handle | standardId | 获取标准的域分布 |
| standard:setDefault | handle | standardId | 设置默认标准 |
| standard:remove | handle | standardId | 删除标准及其测评项 |
| standard:import | handle | standardData | 导入标准（JSON/Excel） |
| standard:create | handle | standardInfo | 手动创建标准 |
| standard:update | handle | standardInfo | 更新标准信息 |

### 3.2 项目接口变更（project.ipc.ts）

| 接口 | 变更内容 |
|------|----------|
| project:create | standardId 参数必填，不再根据等级自动选择 |
| project:update | 支持更新 standardId |
| project:list | 返回时包含标准名称 |

## 四、前端设计

### 4.1 标准库管理界面

**路径**: 系统设置 → 标准库管理

**功能模块**:
1. **标准列表** - 表格展示所有标准，显示名称、版本、测评项数量
2. **导入标准** - 支持 JSON/Excel 文件导入
3. **新建标准** - 表单手动创建
4. **编辑标准** - 修改标准信息
5. **删除标准** - 删除标准及其所有测评项（需确认）
6. **设为默认** - 设置应用启动时的默认标准

**导入文件格式**:
```json
{
  "standard": {
    "id": "dl-t-36572-2018-l3",
    "name": "GB/T 36572-2018 电力三级",
    "version": "2018",
    "grade": 3,
    "description": "电力行业网络安全等级保护基本要求"
  },
  "items": [
    {
      "domain": "secure_physical",
      "controlPoint": "物理位置选择",
      "controlName": "机房场地应选择在具有防震...",
      "requirement": "a）机房场地应选择在...",
      "minLevel": 3,
      "maxLevel": 4,
      "extensionType": "general",
      "isHighRisk": 0,
      "sortOrder": 1
    }
  ]
}
```

### 4.2 项目创建/编辑界面

**表单变更**:
- 原"标准体系"下拉框改为"标准库"选择器
- 选项格式：`GB/T 22239-2019 三级（393项）`
- 支持搜索过滤

**布局调整**:
```
┌─────────────────────────────────────┐
│ 项目名称: [_______________________] │
│ 系统名称: [_______________________] │
│ 被测单位: [_______________________] │
│ 标准库:   [GB/T 22239-2019 三级 ▼] │ ← 新增
│ 等级组合: [S3A3G3_________________] │
│ 扩展类型: [☑ 通用 ☑ 云计算 □ 移动] │
└─────────────────────────────────────┘
```

### 4.3 项目列表界面

**列变更**:
- 原"标准体系"列改为显示实际标准名称
- 格式：`GB/T 22239-2019 L3`

## 五、实现步骤

### Phase 1: 后端接口（约2天）
1. [ ] 新增 standard:import 接口
2. [ ] 新增 standard:create 接口
3. [ ] 新增 standard:update 接口
4. [ ] 修改 project:create 验证 standardId
5. [ ] 修改 project:update 支持更新 standardId

### Phase 2: 前端组件（约2天）
6. [ ] 创建 StandardManager.vue 组件
7. [ ] 创建标准导入对话框
8. [ ] 创建标准编辑对话框
9. [ ] 修改项目创建/编辑表单
10. [ ] 修改项目列表显示

### Phase 3: 测试与集成（约1天）
11. [ ] 单元测试标准导入功能
12. [ ] 集成测试项目标准选择
13. [ ] 性能测试大数据量标准
14. [ ] 兼容性测试（现有项目）

## 六、向后兼容

- 现有项目的 standardSystem 字段保持不变
- 迁移脚本自动填充 standard_id 为默认国标
- 标准库管理界面不显示已删除的标准（软删除）
- 提供标准导出功能，便于备份和迁移

## 七、安全考虑

- 导入标准前校验 JSON 结构
- 删除标准前检查是否有项目引用
- 敏感操作记录操作日志
- 标准数据备份机制

## 八、验收标准

1. 能够导入 JSON 格式的标准库
2. 能够手动创建标准库
3. 项目创建时可选择不同标准库
4. 现场核查页面根据项目标准加载对应测评项
5. 删除标准后，引用该标准的项目提示标准不存在
6. 所有原有功能不受影响
