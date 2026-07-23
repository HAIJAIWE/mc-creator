import type { FileNode } from '@mc-creator/shared';
import type { McApi, NodeGraphApi } from './index.js';

declare global {
  interface Window {
    /** 主进程 IPC 桥接（mod 生成/构建/聊天/git/终端 等） */
    mcApi: McApi;
    /**
     * 节点图持久化命名空间。
     *
     * 独立于 mcApi，专门承载节点图相关的 fs 桥接（save/load）与文件对话框。
     * 渲染层通过 `window.api.nodeGraph.*` 调用，不直接 require('fs')。
     *
     * 注：类型上为可选（`?`），反映 jsdom 测试环境可能未注入 preload 的现实；
     * 调用方需做运行时存在性检查（与原 `window as unknown as { api?... }` 等价）。
     */
    api?: {
      nodeGraph: NodeGraphApi;
    };
    /**
     * CodeNode 提升到 Purecode 时暂存的文件列表。
     *
     * 由 CodeNodeEditor 在提升后写入，原本供 PurecodeWorkspace 读取；
     * 目前 PurecodeWorkspace 改为从 useModStore 读取，此字段仅作兼容性兜底。
     * 显式声明避免各处 `window as unknown as { __promotedFiles?... }` 断言。
     */
    __promotedFiles?: FileNode[];
  }
}

export {};
