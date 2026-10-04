/**
 * Monaco Editor 本地化配置（不走 CDN）。
 *
 * 背景：`@monaco-editor/react` 默认通过 AMD loader 从 jsdelivr CDN 拉取 monaco，
 * 会被渲染进程的 CSP（`script-src 'self'`）拦截导致编辑器不可用。
 *
 * 做法：把 monaco 与各语言 worker 交给 Vite 打包成同源资源，用
 * `loader.config({ monaco })` 让 react 包装层直接使用已打包的实例。
 *
 * 本模块是「副作用模块」：应用侧通过动态 import 引入（见 App.tsx 的惰性面板加载），
 * 因此 monaco 及其 worker 不会被塞进主包，只在首次打开代码视图时才加载。
 * 单元测试直接引入面板组件、不经过该入口，故不会在 jsdom 中求值 monaco。
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
