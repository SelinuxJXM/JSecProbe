/**
 * 单测配置（只覆盖三条"坏了就丢数据、而且不会报错"的纯逻辑链路）。
 *
 * 默认 environment 为 node：backup-crypto 与 seed 加载都是纯 node 侧逻辑。
 * 需要 DOM 的用例（useAutoSaveCore 依赖 window.setTimeout / window.setInterval）在文件首行
 * 用 `// @vitest-environment happy-dom` 单独切换 —— 不为一个文件把全局环境换成 happy-dom，
 * 以免给 node 侧用例引入非必要的 window 全局污染。
 *
 * 刻意不复用 vite.config.ts：三条链路都不涉及 .vue 组件、静态资源与路径别名，
 * 复用会把 electron 插件链一起拖进来，让单测启动变慢并引入无关的失败面。
 */
import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// ── WorkBuddy 沙箱兼容 ──
// vitest 把模块转换结果持久化到 os.tmpdir()/<nanoid>/ssr/<40位无扩展名哈希>，
// WorkBuddy 宿主 brokered-fs 沙箱只放行 fs.mkdtempSync 创建的临时目录，
// 且拦截「无扩展名长哈希文件 / 子目录文件」的写盘（EPERM），导致退出码非 0、并随机跳过命中 EPERM 的测试文件。
// 修复在 scripts/vitest-sandbox-shim.cjs（NODE_OPTIONS 预加载）：用 Node ESM loader 在模块加载期把 vitest 源码里的
// `cacheFs: true` 改写为 `cacheFs: false`，使 fetch 直接返回内存中的转换结果（不走磁盘），从源头消除 EPERM。
// 为什么走 loader 而非 patch fs：vitest 从 `node:fs/promises` 解构 writeFile（ESM 绑定在加载时即冻结为
// brokered-fs 包裹器），预加载层对 fs.promises.writeFile 的赋值/defineProperty 都拦不到 vitest 实际调用的引用。
// 预加载是必须的：① 写发生在 fork 出的 worker 内；② worker 在模块加载时 `const { readFileSync } = fs` 捕获引用。
//   - 主进程：由 `npm test`（scripts/run-vitest.cjs）通过 NODE_OPTIONS 注入；
//   - fork 出的 worker：vitest 仅透传 poolOptions.forks.execArgv，故在此注入（NODE_OPTIONS 不会传给 worker）。
// 无沙箱环境（CI 等）loader 自动 no-op，行为不变。
const shim = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'scripts', 'vitest-sandbox-shim.cjs').replace(/\\/g, '/');

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    // 备份加解密要跑 scrypt(N=16384)，比普通单测慢一个量级，默认 5s 偏紧
    testTimeout: 20000,
    hookTimeout: 20000,
    restoreMocks: true,
    poolOptions: {
      forks: {
        // 把沙箱兼容 shim 注入到 fork 出的 worker（NODE_OPTIONS 不会透传给 worker，只能走 execArgv）
        execArgv: ['-r', shim],
      },
    },
  },
});