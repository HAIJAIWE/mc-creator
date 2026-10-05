import { resolve } from 'path';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react-swc';

/**
 * 需要**打进 bundle**（而非留成运行时 require）的 workspace 包。
 *
 * 这三个包都是「源码直出」包：package.json 的 main/exports 指向 `src/*.ts`，
 * 没有构建产物。electron-vite 默认把 dependencies 全部 externalize，
 * 于是产物里留下 `require("@mc-creator/shell")`；运行时 Node 顺着
 * workspace 软链找到 `packages/shell/src/index.ts`，再解析它内部的
 * `export * from './errors.js'` —— 没有 `errors.js` 这个文件，
 * 直接 ERR_MODULE_NOT_FOUND，**应用启动即崩**（E2E 首次拉起就撞上了这个）。
 * 所以凡是「TS 源码包」都必须列进 exclude 并配 alias，让 rollup 内联。
 */
const workspacePkgs = ['@mc-creator/core', '@mc-creator/shared', '@mc-creator/shell'];

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: workspacePkgs })],
    resolve: {
      alias: {
        '@mc-creator/core': resolve(__dirname, '../../packages/core/src'),
        '@mc-creator/shared': resolve(__dirname, '../../packages/shared/src'),
        '@mc-creator/shell': resolve(__dirname, '../../packages/shell/src'),
      },
    },
    build: {
      rollupOptions: { input: { index: resolve(__dirname, 'src/main/index.ts') } },
    },
  },
  preload: {
    plugins: [
      externalizeDepsPlugin({
        exclude: [...workspacePkgs, 'zod'],
      }),
    ],
    resolve: {
      alias: {
        '@mc-creator/shared': resolve(__dirname, '../../packages/shared/src'),
      },
    },
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/preload/index.ts') },
        external: ['electron'],
      },
    },
  },
  renderer: {
    root: 'src/renderer',
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/renderer/index.html') },
        output: {
          // 把重型第三方库拆成独立 vendor chunk，避免单包过大、利于缓存
          manualChunks: {
            'vendor-monaco': ['@monaco-editor/react'],
            'vendor-xyflow': ['@xyflow/react'],
            'vendor-skinview3d': ['skinview3d'],
            'vendor-xterm': ['@xterm/xterm', '@xterm/addon-fit'],
            'vendor-react': ['react', 'react-dom', 'zustand'],
          },
        },
      },
    },
    resolve: {
      alias: {
        '@renderer': resolve(__dirname, 'src/renderer/src'),
        '@mc-creator/shared': resolve(__dirname, '../../packages/shared/src'),
      },
    },
    // @ts-expect-error: electron-vite types reference root vite (@types/node@26), this package uses @types/node@20
    plugins: [react()],
  },
});
