'use strict';
/*
 * WorkBuddy 沙箱兼容（最小修复）：让 Vitest 的 SSR 转换缓存不再写盘。
 *
 * 根因
 * ----
 * vitest 的 `createMethodsRPC(project, { cacheFs: true })` 会把转换后的模块持久化到
 *     os.tmpdir()/<nanoid>/ssr/<40位无扩展名哈希>
 * WorkBuddy 宿主 brokered-fs 沙箱只放行 fs.mkdtempSync 创建的临时目录，且拦截「无扩展名长哈希
 * / 子目录文件」的写盘（EPERM），导致 vitest 退出码非 0、并随机跳过命中 EPERM 的测试文件
 * （破坏「改坏即红」）。
 *
 * 为什么不能靠预加载层 patch fs：
 *   vitest 从 `node:fs/promises` 解构 `writeFile`（`import { writeFile } from 'node:fs/promises'`），
 *   ESM 绑定在模块加载时即被冻结为 brokered-fs 包裹器；预加载层对 fs.promises.writeFile 的赋值/
 *   defineProperty 都拦不到 vitest 实际调用的引用。worker 端 `const { readFileSync } = fs` 同理。
 *
 * 真正的修复（本 shim 做的事）
 * ----------------------------
 * 用 Node ESM loader hook 在模块加载期把 vitest 源码里的 `cacheFs: true` 改写为 `cacheFs: false`，
 * 使 fetch 直接返回内存中的转换结果（不走磁盘），既不产生 EPERM，也不影响任何测试正确性。
 *   - 源码侧：同目录 `vitest-sandbox-loader.mjs` 的 load 钩子对 resolveConfig.*.js 做正则替换。
 *   - 注入侧：本 shim 用 module.register 注册该 loader；主进程经 NODE_OPTIONS -r 加载
 *     （见同目录 run-vitest.cjs），fork 出的 worker 经 vitest.config.ts 的
 *     poolOptions.forks.execArgv 加载，两端都生效。
 *
 * 无沙箱环境（CI 等）：行为等价（少一次磁盘写），完全安全。
 */
if (globalThis.__JSECPROBE_VITEST_SHIM__) return; // 防止同一进程重复加载
globalThis.__JSECPROBE_VITEST_SHIM__ = true;

try {
  const { register } = require('node:module');
  const { pathToFileURL } = require('node:url');
  const loaderUrl = pathToFileURL(require('path').resolve(__dirname, 'vitest-sandbox-loader.mjs')).href;
  register(loaderUrl, { parentURL: pathToFileURL(__filename).href });
} catch (err) {
  // loader 注册失败不应让 vitest 整体崩溃；沙箱外也无关紧要（cacheFs 写盘本就合法）
  try { console.error('[vitest-sandbox] loader register FAILED:', err && err.message); } catch (_) {}
}
