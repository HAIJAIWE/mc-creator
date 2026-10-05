import { lazy } from 'react';

/**
 * Monaco Editor 懒加载 + 本地化配置的门控。
 *
 * ## 为什么必须有这个门控
 *
 * `@monaco-editor/react` 的 `loader.init()` 是**一次性**的（见
 * `@monaco-editor/loader/lib/es/loader/index.js`）：
 *
 * ```js
 * if (!state.isInitialized) {
 *   setState({ isInitialized: true });
 *   if (state.monaco) { state.resolve(state.monaco); return; }        // 走本地打包实例
 *   if (window.monaco?.editor) { ...; return; }                        // 走 window.monaco
 *   compose(injectScripts, getMonacoLoaderScript)(configureLoader);    // 往 body 注入 CDN <script>
 * }
 * ```
 *
 * 首次调用时若 `loader.config({ monaco })` 还没生效，就**永久**走上 CDN 那条路，
 * 而渲染进程 CSP（`script-src 'self'`）会拦掉它 —— 表现是「编辑器能打开但高亮/
 * 补全/TS 诊断全没了」，不报错，极难排查。
 *
 * 所以铁律是：**任何 `<Editor>` / `<DiffEditor>` 挂载之前，monaco-setup.ts 必须已求值完。**
 *
 * ## 为什么必须动态引入 monaco-setup
 *
 * `monaco-setup.ts` 静态 `import * as monaco from 'monaco-editor'`（~5MB）。
 * 只要在 App 根部静态副作用引入（历史写法），monaco + 3 个 worker 就会全部进主
 * chunk，`lazy()` 的懒加载被彻底抵消。改成动态 import 后，配置与编辑器加载绑成
 * 同一条异步链：**首次打开代码视图时才发生**，且配置必定先于使用。
 *
 * 另外 monaco-setup.ts **不能在 jsdom 单测里求值**：真实 monaco 的 clipboard
 * contribution 需要 `document.queryCommandSupported`，jsdom 没有，会直接抛错。
 * 所以它只能走动态 import；不要把它改成任何被单测直接 import 的组件的静态依赖。
 */

/** monaco-setup 的求值结果；模块本身只会被求值一次，这里只做并发去重 */
let setupPromise: Promise<unknown> | null = null;

/**
 * 幂等地加载 Monaco 本地化配置（设置 `MonacoEnvironment` 的 worker 映射 +
 * `loader.config({ monaco })`）。
 */
export function ensureMonacoSetup(): Promise<unknown> {
  if (!setupPromise) setupPromise = import('./monaco-setup.js');
  return setupPromise;
}

/**
 * 把「先完成 Monaco 本地化配置」串到任意动态 import 之前。
 *
 * 用在**可能渲染 Monaco 编辑器**的惰性加载器上：配置先于模块图求值，
 * 因此先于该 chunk 里任何 `<Editor>` 的挂载。
 */
export function withMonacoSetup<T>(load: () => Promise<T>): () => Promise<T> {
  return async () => {
    await ensureMonacoSetup();
    return load();
  };
}

/**
 * Monaco Editor 懒加载包装。
 *
 * Monaco 是 ~5MB 的大依赖，首次打开代码视图前不需要加载。
 * 用 React.lazy 延迟到首次渲染 <Editor> / <DiffEditor> 时才动态 import；
 * 配置（worker 映射 + 本地 monaco 实例）与 editor 加载串成同一条异步链。
 *
 * 调用方需用 <Suspense> 包裹，fallback 推荐用 <Loader2 className="animate-spin" />。
 */
export const LazyEditor = lazy(
  withMonacoSetup(() => import('@monaco-editor/react').then((m) => ({ default: m.Editor }))),
);

export const LazyDiffEditor = lazy(
  withMonacoSetup(() => import('@monaco-editor/react').then((m) => ({ default: m.DiffEditor }))),
);
