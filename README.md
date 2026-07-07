# 等级保护现场测评系统

本人无代码基础，该项目基于AI大模型深度学习，配合人工匠心调校。
一个更贴合网络安全等级保护（等保2.0）现场测评的桌面工具，支持项目管理、系统构成录入、自动化核查、AI辅助分析等功能。

## ✨ 功能特性

- **项目管理**：创建和管理多个测评项目
- **系统构成**：录入和导出被测系统的资产信息（机房、网络设备、安全设备、服务器、数据库、业务应用等）
- **等保测评**：基于 GB/T 22239-2019 标准的测评项管理
- **自动化核查**：内置核查命令库，支持自动化安全检查
- **AI 集成**：支持接入 AI API（如 DeepSeek、OpenAI）辅助分析
- **报告生成**：自动生成测评报告
- **数据备份**：定时自动备份项目数据
- **知识库**：内置等保相关知识和操作指南

## 🖥️ 技术栈

- **前端**：Vue 3 + TypeScript + Element Plus + Vite
- **后端**：Electron + Node.js
- **数据库**：SQLite (better-sqlite3)
- **ORM**：Drizzle ORM
- **构建**：Vite + Electron Builder

## 📸 界面预览

| 登录页 | 工作台 | 系统构成 |
|:---:|:---:|:---:|
| ![登录页](screenshots/login.png) | ![工作台](screenshots/dashboard.png) | ![系统构成](screenshots/system-composition.png) |

| 现场核查 | AI智能辅助 | 系统设置 |
|:---:|:---:|:---:|
| ![现场核查](screenshots/assessment.png) | ![AI辅助](screenshots/ai-assistant.png) | ![系统设置](screenshots/settings.png) |

> 📷 截图文件存放在 `screenshots/` 目录下，提交代码后会自动展示。

## 🚀 快速开始

### 环境要求

- Node.js >= 18.0.0
- npm >= 9.0.0

### 安装依赖

```bash
npm install
```

### 开发模式

```bash
npm run dev
```

### 构建打包

```bash
# 打包为 Windows 可执行程序
npm run build:win

# 打包为 macOS 可执行程序
npm run build:mac

# 打包为 Linux 可执行程序
npm run build:linux
```

## 📁 项目结构

```
├── electron/              # Electron 后端代码
│   ├── db/               # 数据库相关（Schema、迁移）
│   ├── ipc/              # IPC 进程间通信处理器
│   ├── services/          # 业务逻辑服务
│   └── main/              # 主进程入口
├── src/                   # 前端源码
│   ├── views/             # 页面视图
│   ├── components/        # 公共组件
│   ├── stores/            # Pinia 状态管理
│   ├── router/            # 路由配置
│   └── styles/            # 样式文件
├── shared/                # 前后端共享类型定义
├── resources/             # 资源文件
├── build/                 # 构建配置
└── package.json           # 项目配置
```

## 📝 默认账号

开发模式下默认管理员账号：

- 用户名：`admin`
- 密码：`admin123`

> ⚠️ 生产环境请务必修改默认密码！

## 🤝 贡献指南

1. Fork 本项目
2. 创建您的功能分支 (`git checkout -b feature/AmazingFeature`)
3. 提交您的更改 (`git commit -m 'Add some AmazingFeature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 打开 Pull Request

## 📄 License

本项目基于 [MIT](LICENSE) 许可证开源。

## ⚠️ 免责声明

本工具仅用于合法的安全测评活动。使用本工具进行任何未经授权的安全测试行为，后果由使用者自行承担。
