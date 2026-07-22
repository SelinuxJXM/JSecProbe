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
                'xlsx',
                'docx',
                'tesseract.js',
                'compressing',
                'adm-zip',
                'mammoth',
                'marked',
                'dompurify',
                'sharp',
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
          'vendor-docs': ['docx', 'exceljs', 'xlsx', 'pdf-parse', 'pdfjs-dist', 'mammoth'],
          'vendor-utils': ['marked', 'dompurify', 'dayjs'],
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
  },
});
