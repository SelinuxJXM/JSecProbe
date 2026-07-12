# JSecProbe

JSecProbe（等级保护现场测评系统）是一个用于网络安全等级保护（等保2.0）现场测评的桌面工具。

支持项目管理、系统构成录入、自动化核查、AI辅助分析等功能。

支持AI分析文件、命令执行结果、截图等自动生成测评结果记录。

## ✨ 功能特性

- **项目管理**：创建和管理多个测评项目
- **系统构成**：录入和导出被测系统的资产信息（机房、网络设备、安全设备、服务器、数据库、业务应用等）
- **等保测评**：基于 GB/T 22239-2019 标准的测评项管理
- **自动化核查**：内置核查命令库，支持自动化安全检查
- **AI 集成**：支持接入 AI API（如 DeepSeek、OpenAI）辅助分析
- **报告生成**：自动生成测评总结分析报告
- **数据备份**：定时自动备份项目数据
- **知识库**：内置等保相关知识和操作指南
- **注意事项**：卸载前一定要进行数据备份或保留根目录下的JSecProbeData目录

## 🖥️ 技术栈

- **前端**：Vue 3 + TypeScript + Element Plus + Vite
- **后端**：Electron + Node.js
- **数据库**：SQLite (better-sqlite3)
- **ORM**：Drizzle ORM
- **构建**：Vite + Electron Builder

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

## 🖼️ 界面展示

| 登录页 | 主界面 | 项目列表 |
| :--- | :--- | :--- |
| ![登录页](https://raw.githubusercontent.com/SelinuxJXM/JSecProbe/main/screenshots/01-登录页.png) | ![主界面](https://raw.githubusercontent.com/SelinuxJXM/JSecProbe/main/screenshots/02-主界面.png) | ![项目列表](https://raw.githubusercontent.com/SelinuxJXM/JSecProbe/main/screenshots/03-项目列表.png) |

| 系统构成 | 现场核查 | 问题清单 |
| :--- | :--- | :--- |
| ![系统构成](https://raw.githubusercontent.com/SelinuxJXM/JSecProbe/main/screenshots/04-系统构成.png) | ![现场核查](https://raw.githubusercontent.com/SelinuxJXM/JSecProbe/main/screenshots/05-现场核查.png) | ![问题清单](https://raw.githubusercontent.com/SelinuxJXM/JSecProbe/main/screenshots/06-问题清单.png) |

| AI分析 | 知识库 | 系统设置 |
| :--- | :--- | :--- |
| ![AI分析](https://raw.githubusercontent.com/SelinuxJXM/JSecProbe/main/screenshots/07-AI分析.png) | ![知识库](https://raw.githubusercontent.com/SelinuxJXM/JSecProbe/main/screenshots/08-知识库.png) | ![系统设置](https://raw.githubusercontent.com/SelinuxJXM/JSecProbe/main/screenshots/09-系统设置.png) |

## 📝 默认账号

开发模式下默认管理员账号：

- 用户名：`admin`
- 密码：`admin123`

> ⚠️ 生产环境请务必修改默认密码！

## 🤝 联系方式

- **技术支持邮箱**: SelinuxJ@163.com
- **书签导航**: https://www.soer.ccwu.cc/Nav/

<div align="center">

### 微信扫码联系

<img src="https://raw.githubusercontent.com/SelinuxJXM/JSecProbe/main/screenshots/wechat-qrcode.png" alt="微信二维码" width="200"/>

</div>

---

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
