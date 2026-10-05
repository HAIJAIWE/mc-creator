/**
 * Monaco Editor 本地化配置（不走 CDN）。
 *
 * 背景：`@monaco-editor/react` 默认通过 AMD loader 从 jsdelivr CDN 拉取 monaco，
 * 会被渲染进程的 CSP（`script-src 'self'`）拦截导致编辑器不可用。
 *
 * 做法：把 monaco 与各语言 worker 交给 Vite 打包成同源资源，用
 * `loader.config({ monaco })` 让 react 包装层直接使用已打包的实例。
 *
 * 本模块是「副作用模块」，只有两件事：
 *   1. 挂 `MonacoEnvironment.getWorker` —— 把 editor/json/ts 三种 worker 映射到
 *      同源打包产物（否则 worker 会去找 CDN 路径，同样被 CSP 拦掉）；
 *   2. `loader.config({ monaco })` —— 让 react 包装层直接用已打包实例。
 *   （语言贡献 / 主题 / JSON schema 不在这里：它们走各自组件的 `onMount` 回调，
 *     在编辑器实例化之后按需注册，与本模块无关。）
 *
 * ## 引入方式：只能动态 import，且必须在任何 <Editor> 挂载之前
 *
 * 历史写法是在 App.tsx 根部静态 `import './lib/monaco-setup.js'`。那会让
 * monaco（~5MB）连同 3 个 worker 全部进主 chunk，把懒加载彻底抵消。
 * 现在统一由 `lib/lazy-monaco.ts` 的 `withMonacoSetup()` 串在**可能渲染编辑器的
 * 惰性加载器**上（App 的 AgentPanel、MainPanelView 的 CodePreview/MiddlePanel、
 * 面板注册表的 preview 加载器），于是首次打开代码视图时才加载，且配置必定先于使用。
 *
 * 之所以必须动态：`monaco-editor` 的 clipboard contribution 需要
 * `document.queryCommandSupported`，jsdom 没有 —— 本模块一旦被单测 import 到就抛错。
 * 因此它不能成为任何被单测直接 import 的组件的静态依赖。
 */

import * as monaco from 'monaco-editor';
import { loader } from '@monaco-editor/react';
// 版本约束：必须用 0.55.x（package.json 里锁 ^0.55.1）。
// 0.57 起 monaco 做了 API 重构，语言命名空间从 `monaco.languages.json/x` 搬到 `monaco.json/x`，
// 与 @monaco-editor/react 4.x 以及本项目既有代码（mc-json-schemas / monaco-theme）不兼容。
// 0.55.1 正是此前 CDN 默认拉取的版本，本地化后 API 行为与之前完全一致。
// 子路径直接写 `esm/vs/...`（0.55 的 exports 是 `"./*": "./*"`，不做前缀改写）。
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import JsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker';
import TsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker';

/** 只声明用到的字段，避免与 monaco 自带的全局 MonacoEnvironment 声明冲突 */
type MonacoEnvironmentLike = {
  getWorker(workerId: string, label: string): Worker;
};

(self as unknown as { MonacoEnvironment: MonacoEnvironmentLike }).MonacoEnvironment = {
  getWorker(_workerId, label) {
    if (label === 'json') return new JsonWorker();
    if (label === 'typescript' || label === 'javascript') return new TsWorker();
    return new EditorWorker();
  },
};

loader.config({ monaco });
