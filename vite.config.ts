import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import electron from 'vite-plugin-electron';
import renderer from 'vite-plugin-electron-renderer';
import { resolve } from 'path';

export default defineConfig({
  plugins: [
    vue(),
    electron([
      {
        entry: 'electron/main/index.ts',
        vite: {
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
    port: 5173,
    watch: {
      // Windows 下 .tools/ 目录可能有被占用的 sql.zip/dll，避免 chokidar watch 失败
      ignored: ['**/.tools/**', '**/node_modules/**', '**/JSecProbeData/**'],
    },
  },
});
