# 项目配置规则

## GitHub 推送流程
当用户要求"推送到 GitHub 仓库"时，按以下标准执行：

### 推送步骤
1. `git status` 查看当前变更状态
2. **排除敏感文件**：检查并排除含 Token/密钥/密码的文件（如 `*.ps1`、`*.env`、`*.key` 等）
3. `git add` 暂存所有合适的文件
4. 生成规范的 conventional commit 信息（格式：`type: 简短描述`，正文列出主要更新点）
5. `git commit` 提交变更
6. `git push origin main` 推送到远程仓库

### 敏感文件清单（禁止提交）
- `upload.ps1` / `upload-release.ps1`（含 GitHub Token）
- `*.env` / `*.env.local`（环境变量文件）
- `*.key` / `*.pem`（密钥文件）

### Commit 信息规范
- 使用 conventional commit 类型：`feat:`、`fix:`、`refactor:`、`docs:`、`style:`、`chore:` 等
- 标题简短明了（不超过 72 字符）
- 正文列出主要更新点，每行以 `-` 开头

### 仓库信息
- 仓库：`SelinuxJXM/JSecProbe`
- 分支：`main`

## Windows 打包流程
当用户要求"重新打包"或"编译打包"时，统一执行完整打包（包含图标修复）：

```bash
npm run build:win:full
```
- 构建前端 + Electron 代码
- 使用 `rcedit` 强制替换主程序 exe 图标
- 从修改后的打包目录重新构建 NSIS 安装包和便携版
- 自动整理输出到 `dist/` 目录

### 图标文件
- `build/icon.ico` — 主程序图标（8个尺寸：16~256px，使用 ico-endec 编码）
- `resources/icon.ico` — 运行时资源图标（与 build 同步）
- `src/assets/Logo.png` — 软件内显示的 Logo（侧边栏、登录页）
- 替换后执行 `npm run build:win:full` 自动应用

## 版本号更新流程
当用户要求更新系统版本号时，按以下标准执行：

### 需要修改的文件
| 文件 | 修改内容 | 说明 |
|------|----------|------|
| `package.json` | `"version": "x.x.x"` | 项目版本号定义 |
| `package-lock.json` | `"version": "x.x.x"`（2 处） | 锁定文件版本号 |
| `src/layout/MainLayout.vue` | `vx.x.x` | 软件界面显示的版本号 |
| `upload-release.ps1` | `$tag = "vx.x.x"` | GitHub Release 标签 |
| `scripts/build-win.js` | `1.x.x`（2 处） | 打包输出文件名日志 |

### 不需要修改
- `white book/` 目录下的项目文档保持不动
- `README.md` 如无明确要求不修改

### 修改后验证
```bash
npx vue-tsc --noEmit
```
确保 TypeScript 类型检查通过，零错误。

## 自动更新发布流程
当用户要求在应用中实现版本自动更新时：

### 工作原理
- 使用 `electron-updater` 读取 GitHub Releases 上的 `latest.yml` 文件
- 用户点击 [系统设置 → 系统信息 → 检查更新] 即可检测到新版本
- 支持：检测更新 → 下载进度显示 → 安装并重启

### 发布新版本步骤
1. **按照「版本号更新流程」修改版本号**
2. **完整打包：** `npm run build:win:full`
3. **上传到 GitHub Releases：**
   - 手动方式：上传 `dist/` 目录下以下 3 个文件到 GitHub Releases：
     - `JSecProbe Setup x.x.x.exe`（安装包）
     - `JSecProbe Setup x.x.x.exe.blockmap`（差异更新映射）
     - `latest.yml`（更新元数据）
   - 一键方式：`npm run build:win:full -- --publish`（自动调用 upload-release.ps1）
4. **用户侧：** 打开应用 → 系统设置 → 系统信息 → 点击「检查更新」

### 关键配置
- `package.json` 中的 `publish` 配置指向 GitHub 仓库
- `latest.yml` 包含版本号、文件校验和（sha512）、文件大小等信息
- `electron-updater` 自动对比本地版本与 latest.yml 的版本号
