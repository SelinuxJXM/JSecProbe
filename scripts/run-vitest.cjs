'use strict';
/*
 * Cross-platform `npm test` 入口：在启动 vitest 之前把沙箱兼容 shim 注入 NODE_OPTIONS，
 * 保证主进程与 fork 出的 worker 都加载预加载补丁（Worker 端在模块加载时捕获 fs.readFileSync，
 * 只能在进程启动前注入）。CI 等无 brokered-fs 沙箱的环境里 shim 会自动 no-op，行为不变。
 */
const { spawn } = require('child_process');
const path = require('path');

const shim = path.resolve(__dirname, 'vitest-sandbox-shim.cjs').replace(/\\/g, '/');
const flag = `-r ${shim}`;
// 必须 PREPEND：WorkBuddy 宿主 brokered-fs shim 也在 NODE_OPTIONS 里，且会抢先包裹 fs.promises.writeFile；
// 若本 shim 后加载，vitest 捕获到的 writeFile 引用会绕过本补丁。前置可让 brokered-fs 包裹在本补丁之外。
process.env.NODE_OPTIONS = flag + (process.env.NODE_OPTIONS ? ' ' + process.env.NODE_OPTIONS : '');

const args = ['node_modules/vitest/vitest.mjs', 'run', ...process.argv.slice(2)];
const child = spawn(process.execPath, args, {
  stdio: 'inherit',
  env: process.env,
  shell: false,
});
child.on('exit', (code) => process.exit(code === null ? 1 : code));
