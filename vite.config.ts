import { defineConfig, type Plugin } from 'vite';
import vue from '@vitejs/plugin-vue';
import electron from 'vite-plugin-electron';
import renderer from 'vite-plugin-electron-renderer';
import { resolve, join } from 'path';
import { copyFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';

/**
 * 把 drizzle 迁移 SQL 复制进主进程产物目录。
 *
 * 运行时 electron/db/index.ts 以 `join(__dirname, 'migrations')` 定位迁移文件，
 * 但 vite 只把 TS 编译结果写进 dist-electron/main，静态 SQL 与 _journal.json 不会自动跟随。
 * 不复制的后果：打包版永远找不到 _journal.json，只能走 autoCreateTables 兼容路径，
 * 0000~0004 迁移文件成为死代码，此后新增的迁移也无法在正式版生效。
 *
 * 目标目录位于 build.files 已包含的 dist-electron 之内，无需改 package.json。
 */
/**
 * 逐文件递归复制。
 * 不用 fs.cpSync：实测该 API 在本机会让 Node 进程静默以 127 退出（连带 vite build 一起失败），
 * 改用 copyFileSync 逐项写入则完全正常。
 */
function copyDirSync(src: string, dest: string): void {
  mkdirSync(dest, { recursive: true });
  for (const entry of readdirSync(src, { withFileTypes: true })) {
    const from = join(src, entry.name);
    const to = join(dest, entry.name);
    if (entry.isDirectory()) copyDirSync(from, to);
    else copyFileSync(from, to);
  }
}

function copyDbMigrations(): Plugin {
  return {
    name: 'copy-db-migrations',
    apply: 'build',
    closeBundle() {
      // 中文路径下 __dirname 可能被截断到上级目录，构建时统一以 cwd（项目根）为准
      const root = process.cwd();
      const src = resolve(root, 'electron/db/migrations');
      const dest = resolve(root, 'dist-electron/main/migrations');
      if (!existsSync(src)) throw new Error(`[copy-db-migrations] 源目录不存在: ${src}`);
      copyDirSync(src, dest);
      if (!existsSync(join(dest, 'meta', '_journal.json'))) {
        throw new Error(`[copy-db-migrations] 复制后缺少 meta/_journal.json: ${dest}`);
      }
      console.log(`[copy-db-migrations] 已复制 ${readdirSync(dest).length} 项到 ${dest}`);
    },
  };
}

export default defineConfig({
  plugins: [
    vue(),
    electron([
      {
        entry: 'electron/main/index.ts',
        vite: {
          plugins: [copyDbMigrations()],
          build: {
            outDir: 'dist-electron/main',
            rollupOptions: {
              external: [
                'better-sqlite3',
                /^drizzle-orm($|\/)/,
                'electron',
                'electron-log',
                'electron-updater',
                'bcryptjs',
                'exceljs',
                'docx',
                'tesseract.js',
                'compressing',
                'adm-zip',
                'mammoth',
                'marked',
                'dompurify',
                'sharp','ssh2',
                'mysql2',
                // 采集连接器已改为动态 import（懒加载），这里必须显式外置子路径，
                // 否则 rollup 会把 mysql2/promise 打进主进程包里，懒加载就白做了
                'mysql2/promise',
                'pg',
                'pg-native',
                'mssql',
                'tedious',
                'ioredis',
                'winrm-client',
                'oracledb',
                'pdf-parse',
                'pdfjs-dist',
                'echarts',
                'vue-echarts',
              ],
            },
          },
        },
      },
      {
        entry: 'electron/preload/index.ts',
        onstart(args) {
          args.reload();
        },
        vite: {
          build: {
            outDir: 'dist-electron/preload',
            rollupOptions: {
              external: ['electron'],
            },
          },
        },
      },
    ]),
    renderer(),
  ],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
      '@shared': resolve(__dirname, 'shared'),
    },
  },
  base: './',
  build: {
    outDir: 'dist-renderer',
    emptyOutDir: true,
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-vue': ['vue', 'vue-router', 'pinia'],
          'vendor-element': ['element-plus'],
          'vendor-charts': ['echarts', 'vue-echarts'],
          // 注意：不要在此写入未声明的依赖（此前误列了已移除的 xlsx），
          // 否则列了却装不上会让 manualChunks 静默失效。
          'vendor-docs': ['docx', 'exceljs', 'pdf-parse', 'mammoth'],
          'vendor-utils': ['marked', 'dompurify'],
        },
      },
    },
  },
  css: {
    preprocessorOptions: {
      scss: {
        additionalData: `@use "@/styles/variables.scss" as *;`,
      },
    },
  },
  server: {
    // 固定绑 IPv4：默认绑 localhost 在部分环境会落到 IPv6 ::1，
    // 而 Electron/Chromium 用 IPv4 连 localhost 导致白屏（停在 about:blank）。
    host: '127.0.0.1',
    port: 5173,
    watch: {
      // Windows 下 .tools/ 目录可能有被占用的 sql.zip/dll，避免 chokidar watch 失败
      ignored: ['**/.tools/**', '**/node_modules/**', '**/JSecProbeData/**'],
    },
  },
});
