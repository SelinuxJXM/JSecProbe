// WorkBuddy 沙箱兼容 ESM loader：在模块加载期把 vitest 的 SSR 转换缓存写盘关掉。
//
// 背景：vitest 的 createMethodsRPC(project, { cacheFs: true }) 会把模块转换结果持久化到
// os.tmpdir()/<nanoid>/ssr/<40位无扩展名哈希>，WorkBuddy brokered-fs 沙箱会 EPERM 拦截
// （仅放行 mkdtemp 目录、且禁止无扩展名长哈希/子目录文件）。由于 vitest 从 node:fs/promises
// 解构 writeFile（ESM 绑定在加载时即冻结为 brokered-fs 包裹器），无法从预加载层重定向路径，
// 因此这里直接改源码：把 cacheFs: true 改为 cacheFs: false，使 fetch 直接返回内存中的转换结果
// （不走磁盘），既不产生 EPERM，也不影响任何测试正确性；CI 等无沙箱环境同样受益（少一次磁盘写）。
//
// 命中目标文件（resolveConfig 分块）才改写，其余模块原样透传。
export async function load(url, context, nextLoad) {
  if (url.includes('resolveConfig') && url.endsWith('.js')) {
    const result = await nextLoad(url, context);
    let source = result.source;
    if (source instanceof Uint8Array) source = Buffer.from(source).toString('utf8');
    if (typeof source === 'string' && /cacheFs:\s*true/.test(source)) {
      const before = (source.match(/cacheFs:\s*true/g) || []).length;
      source = source.replace(/cacheFs:\s*true/g, 'cacheFs: false');
      try {
        console.error('[vitest-sandbox] loader rewrote cacheFs:true x' + before + ' in ' + url);
      } catch (_) {}
    }
    return { ...result, source, shortCircuit: true };
  }
  return nextLoad(url, context);
}
