import { resolve } from 'path';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react-swc';

/**
 * 需要**打进 bundle**（而非留成运行时 require）的 workspace 包。
 *
 * 这些包都是「源码直出」包：package.json 的 main/exports 指向 `src/*.ts`，
 * 没有构建产物。electron-vite 默认把 dependencies 全部 externalize，
 * 于是产物里留下 `require("@mc-creator/shell")`；运行时 Node 顺着
 * workspace 软链找到 `packages/shell/src/index.ts`，再解析它内部的
 * `export * from './errors.js'` —— 没有 `errors.js` 这个文件，
 * 直接 ERR_MODULE_NOT_FOUND，**应用启动即崩**（E2E 首次拉起就撞上了这个）。
 * 所以凡是「TS 源码包」都必须列进 exclude 并配 alias，让 rollup 内联。
 *
 * 三个 kernel 包（kernel-java / kernel-server / kernel-bedrock）与 contract 同理：
 * 它们的 package.json 也是 `main: ./src/index.ts`，所以由 desktop 直接依赖它们时
 * 必须一起内联 —— 否则打包产物会留 `require("@mc-creator/kernel-java")`，
 * 运行时同样 ERR_MODULE_NOT_FOUND（同一类崩法）。
 *
 * kernel-* 的**传递依赖**（devkit / engine / generator-bedrock / pako 等）不必在这里列：
 * 它们不是 desktop 的 dependencies，`externalizeDepsPlugin` 不会 externalize 它们，
 * rollup 会顺着各 kernel 包自己的 node_modules 解析并一并内联。
 * preload 与 renderer 两侧**不需要**新增 alias：它们只 import `shared`（通道常量与
 * zod schema），内核实现只出现在 main 侧。
 */
const workspacePkgs = [
  '@mc-creator/contract',
  '@mc-creator/core',
  '@mc-creator/kernel-bedrock',
  '@mc-creator/kernel-java',
  '@mc-creator/kernel-server',
  '@mc-creator/shared',
  '@mc-creator/shell',
];

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: workspacePkgs })],
    resolve: {
      alias: {
        '@mc-creator/contract': resolve(__dirname, '../../packages/contract/src'),
        '@mc-creator/core': resolve(__dirname, '../../packages/core/src'),
        '@mc-creator/kernel-bedrock': resolve(__dirname, '../../packages/kernel-bedrock/src'),
        '@mc-creator/kernel-java': resolve(__dirname, '../../packages/kernel-java/src'),
        '@mc-creator/kernel-server': resolve(__dirname, '../../packages/kernel-server/src'),
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
    // 原先这里挂着一句 `@ts-expect-error`（理由是 electron-vite 的类型引用根
    // vite 的 @types/node@26，而本包用 @types/node@20）。接内核（§18 阶段 10）时
    // desktop 必须依赖 kernel-java / kernel-server / kernel-bedrock，它们的传递依赖
    // devkit 是按 @types/node@26 的签名写的（`packages/devkit/src/artifact.ts` 的
    // ReadStream 'data' 监听器在 v20 下会报 TS2345）。同一个 program 只能有一套
    // node 类型，所以 desktop 的 @types/node 已对齐到 ^26 —— 版本冲突随之消失，
    // 这句 `@ts-expect-error` 也就不再需要（留着反而会因「未使用」而报错）。
    plugins: [react()],
  },
});
