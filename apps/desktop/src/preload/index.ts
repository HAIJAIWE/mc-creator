import { contextBridge, ipcRenderer } from 'electron';
import {
  IPC,
  EXPORT_ZIP,
  SAVE_FILE,
  SAVE_ALL_FILES,
  PREPARE_BUILD_DIR,
  EXPORT_PROJECT,
  IMPORT_PROJECT,
  LOAD_MODEL_CONFIG,
  SAVE_MODEL_CONFIG,
  CHAT,
  CHAT_STREAM,
  CHAT_STREAM_CHUNK,
  EXPLAIN_CODE,
  EXPLAIN_CODE_CHUNK,
  COMPARE_MODELS,
  COMPARE_MODELS_CHUNK,
  BUILD_WITH_FIX,
  AI_FIX_SUGGEST,
  AI_FIX_SUGGEST_CHUNK,
  BUILD_STREAM,
  BUILD_STREAM_CHUNK,
  LIST_PROJECTS,
  GET_PROJECT,
  SAVE_PROJECT,
  DELETE_PROJECT,
  MODRINTH_SEARCH,
  MODRINTH_VERSIONS,
  CURSEFORGE_SEARCH,
  CURSEFORGE_FILES,
  LOAD_CURSEFORGE_CONFIG,
  SAVE_CURSEFORGE_CONFIG,
  GIT_CHOOSE_REPO,
  GIT_STATUS,
  GIT_LOG,
  GIT_COMMIT,
  GIT_PULL,
  GIT_PUSH,
  GIT_BRANCH_LIST,
  GIT_BRANCH_CREATE,
  GIT_BRANCH_SWITCH,
  GIT_ADD,
  GIT_RESET,
  GIT_DIFF,
  TERMINAL_SPAWN,
  TERMINAL_DATA,
  TERMINAL_EXIT,
  TERMINAL_WRITE,
  TERMINAL_RESIZE,
  TERMINAL_KILL,
  LOCATE_MC,
  MC_CHOOSE_DIR,
  INSTALL_MOD,
  LAUNCH_MC,
  IMPORT_RESOURCE_FILES,
  NODE_GRAPH_SAVE,
  NODE_GRAPH_LOAD,
  NODE_GRAPH_SHOW_SAVE_DIALOG,
  NODE_GRAPH_SHOW_OPEN_DIALOG,
  type GeneratorType,
  type BuildStreamChunkT,
} from '../shared/ipc-channels.js';

const api = {
  generateSpec: (description: string, generatorType: GeneratorType) =>
    ipcRenderer.invoke(IPC.GENERATE_SPEC, { description, generatorType }),
  generateFiles: (req: {
    loader: string;
    mcVersion: string;
    spec: unknown;
    generatorType: GeneratorType;
  }) => ipcRenderer.invoke(IPC.GENERATE_FILES, req),
  build: (projectPath: string) => ipcRenderer.invoke(IPC.BUILD, { projectPath }),
  loadModelConfig: () => ipcRenderer.invoke(LOAD_MODEL_CONFIG),
  saveModelConfig: (config: unknown) => ipcRenderer.invoke(SAVE_MODEL_CONFIG, config),
  chat: (message: string) => ipcRenderer.invoke(CHAT, { message }),
  /**
   * P12 chat 模式工具调用增强：chatStream 添加可选 context 参数。
   * context 包含项目类型/用户描述/spec 摘要，由 main 进程拼接到 system message。
   * 不传 context 时保持向后兼容（agent-runtime 不需要项目上下文）。
   */
  chatStream: (
    message: string,
    onChunk: (delta: string, done: boolean) => void,
    context?: { generatorType?: string; description?: string; specSummary?: string },
  ) => {
    const handler = (_e: unknown, data: { delta: string; done: boolean }) => {
      onChunk(data.delta, data.done);
      // 收到 done 后立即移除监听，避免残留监听器接收后续流的 chunk
      if (data.done) ipcRenderer.removeListener(CHAT_STREAM_CHUNK, handler);
    };
    ipcRenderer.on(CHAT_STREAM_CHUNK, handler);
    // P0 修复：invoke 失败时也要移除监听，否则内存泄漏
    ipcRenderer.invoke(CHAT_STREAM, { message, context }).finally(() => {
      ipcRenderer.removeListener(CHAT_STREAM_CHUNK, handler);
    });
  },
  explainCode: (
    fileName: string,
    code: string,
    generatorType: string | undefined,
    onChunk: (delta: string, done: boolean) => void,
  ) => {
    const handler = (_e: unknown, data: { delta: string; done: boolean }) => {
      onChunk(data.delta, data.done);
      if (data.done) ipcRenderer.removeListener(EXPLAIN_CODE_CHUNK, handler);
    };
    ipcRenderer.on(EXPLAIN_CODE_CHUNK, handler);
    ipcRenderer.invoke(EXPLAIN_CODE, { fileName, code, generatorType }).finally(() => {
      ipcRenderer.removeListener(EXPLAIN_CODE_CHUNK, handler);
    });
  },
  compareModels: (
    req: {
      description: string;
      generatorType: string;
      models: { name: string; modelId: string; baseURL: string; apiKey: string }[];
    },
    onChunk: (data: { modelName: string; delta: string; done: boolean }) => void,
  ) => {
    const handler = (_e: unknown, data: { modelName: string; delta: string; done: boolean }) => {
      onChunk(data);
      if (data.done) ipcRenderer.removeListener(COMPARE_MODELS_CHUNK, handler);
    };
    ipcRenderer.on(COMPARE_MODELS_CHUNK, handler);
    ipcRenderer.invoke(COMPARE_MODELS, req).finally(() => {
      ipcRenderer.removeListener(COMPARE_MODELS_CHUNK, handler);
    });
  },
  fixSuggest: (
    buildLog: string,
    files: { path: string; content: string }[],
    onChunk: (delta: string, done: boolean) => void,
  ) => {
    const handler = (_e: unknown, data: { delta: string; done: boolean }) => {
      onChunk(data.delta, data.done);
      if (data.done) ipcRenderer.removeListener(AI_FIX_SUGGEST_CHUNK, handler);
    };
    ipcRenderer.on(AI_FIX_SUGGEST_CHUNK, handler);
    ipcRenderer.invoke(AI_FIX_SUGGEST, { buildLog, files }).finally(() => {
      ipcRenderer.removeListener(AI_FIX_SUGGEST_CHUNK, handler);
    });
  },
  buildWithFix: (projectPath: string) => ipcRenderer.invoke(BUILD_WITH_FIX, { projectPath }),
  buildStream: (projectPath: string, onChunk: (chunk: BuildStreamChunkT) => void) => {
    const handler = (_e: unknown, data: BuildStreamChunkT) => {
      onChunk(data);
      if (data.done) ipcRenderer.removeListener(BUILD_STREAM_CHUNK, handler);
    };
    ipcRenderer.on(BUILD_STREAM_CHUNK, handler);
    // P0 修复：invoke 失败时也要移除监听，否则内存泄漏
    ipcRenderer.invoke(BUILD_STREAM, { projectPath }).finally(() => {
      ipcRenderer.removeListener(BUILD_STREAM_CHUNK, handler);
    });
  },
  exportZip: (req: { files: { path: string; content: string }[]; defaultName: string }) =>
    ipcRenderer.invoke(EXPORT_ZIP, req),
  saveFile: (req: { path: string; content: string; defaultName?: string }) =>
    ipcRenderer.invoke(SAVE_FILE, req),
  saveAllFiles: (req: { files: { path: string; content: string }[] }) =>
    ipcRenderer.invoke(SAVE_ALL_FILES, req),
  prepareBuildDir: (files: { path: string; content: string }[]) =>
    ipcRenderer.invoke(PREPARE_BUILD_DIR, { files }),
  listProjects: () => ipcRenderer.invoke(LIST_PROJECTS),
  getProject: (id: string) => ipcRenderer.invoke(GET_PROJECT, { id }),
  saveProject: (project: unknown) => ipcRenderer.invoke(SAVE_PROJECT, project),
  deleteProject: (id: string) => ipcRenderer.invoke(DELETE_PROJECT, { id }),
  exportProject: (project: unknown) => ipcRenderer.invoke(EXPORT_PROJECT, { project }),
  importProject: () => ipcRenderer.invoke(IMPORT_PROJECT),
  modrinthSearch: (req: { query: string; loader?: string; mcVersion?: string; limit?: number }) =>
    ipcRenderer.invoke(MODRINTH_SEARCH, req),
  modrinthVersions: (req: { projectId: string; loader?: string; mcVersion?: string }) =>
    ipcRenderer.invoke(MODRINTH_VERSIONS, req),
  curseforgeSearch: (req: { query: string; loader?: string; mcVersion?: string; limit?: number }) =>
    ipcRenderer.invoke(CURSEFORGE_SEARCH, req),
  curseforgeFiles: (req: { modId: number; loader?: string; mcVersion?: string }) =>
    ipcRenderer.invoke(CURSEFORGE_FILES, req),
  loadCurseForgeConfig: () => ipcRenderer.invoke(LOAD_CURSEFORGE_CONFIG),
  saveCurseForgeConfig: (config: { apiKey: string }) =>
    ipcRenderer.invoke(SAVE_CURSEFORGE_CONFIG, config),
  // 源代码管理
  gitChooseRepo: () => ipcRenderer.invoke(GIT_CHOOSE_REPO),
  gitStatus: (repoPath: string) => ipcRenderer.invoke(GIT_STATUS, { repoPath }),
  gitLog: (repoPath: string, limit: number) => ipcRenderer.invoke(GIT_LOG, { repoPath, limit }),
  gitCommit: (repoPath: string, message: string, all: boolean) =>
    ipcRenderer.invoke(GIT_COMMIT, { repoPath, message, all }),
  gitPull: (repoPath: string) => ipcRenderer.invoke(GIT_PULL, { repoPath }),
  gitPush: (repoPath: string) => ipcRenderer.invoke(GIT_PUSH, { repoPath }),
  // Git 增强
  gitBranchList: (repoPath: string) => ipcRenderer.invoke(GIT_BRANCH_LIST, { repoPath }),
  gitBranchCreate: (repoPath: string, name: string) =>
    ipcRenderer.invoke(GIT_BRANCH_CREATE, { repoPath, name }),
  gitBranchSwitch: (repoPath: string, name: string) =>
    ipcRenderer.invoke(GIT_BRANCH_SWITCH, { repoPath, name }),
  gitAdd: (repoPath: string, paths: string[]) => ipcRenderer.invoke(GIT_ADD, { repoPath, paths }),
  gitReset: (repoPath: string, paths: string[]) =>
    ipcRenderer.invoke(GIT_RESET, { repoPath, paths }),
  gitDiff: (repoPath: string, path: string, staged?: boolean) =>
    ipcRenderer.invoke(GIT_DIFF, { repoPath, path, staged }),
  // 终端（PTY 桥接）
  terminalSpawn: (req: { shell?: string; cwd?: string; cols?: number; rows?: number }) =>
    ipcRenderer.invoke(TERMINAL_SPAWN, req),
  terminalWrite: (pid: number, data: string) => ipcRenderer.invoke(TERMINAL_WRITE, { pid, data }),
  terminalResize: (pid: number, cols: number, rows: number) =>
    ipcRenderer.invoke(TERMINAL_RESIZE, { pid, cols, rows }),
  terminalKill: (pid: number) => ipcRenderer.invoke(TERMINAL_KILL, { pid }),
  onTerminalData: (handler: (_e: unknown, data: { pid: number; data: string }) => void) => {
    ipcRenderer.on(TERMINAL_DATA, handler);
    return () => ipcRenderer.removeListener(TERMINAL_DATA, handler);
  },
  onTerminalExit: (handler: (_e: unknown, data: { pid: number; exitCode: number }) => void) => {
    ipcRenderer.on(TERMINAL_EXIT, handler);
    return () => ipcRenderer.removeListener(TERMINAL_EXIT, handler);
  },
  // Minecraft 启动器（离线）
  locateMc: () => ipcRenderer.invoke(LOCATE_MC),
  chooseMcDir: () => ipcRenderer.invoke(MC_CHOOSE_DIR),
  installMod: (jarPath: string, mcDir?: string) =>
    ipcRenderer.invoke(INSTALL_MOD, { jarPath, mcDir }),
  launchMc: (mcDir?: string) => ipcRenderer.invoke(LAUNCH_MC, { mcDir }),
  // 资源文件导入
  importResourceFiles: (req: { title?: string; extensions?: string[]; multiSelect?: boolean }) =>
    ipcRenderer.invoke(IMPORT_RESOURCE_FILES, req),
};

/**
 * 节点图持久化 API（独立命名空间 window.api.nodeGraph）。
 *
 * 设计要点：
 * - save/load 只做文件读写，不弹对话框（职责单一，便于测试与组合）
 * - showSaveDialog/showOpenDialog 单独暴露，由渲染层决定何时弹框
 * - 类型与 shared/ipc-channels.ts 中的 zod schema 对齐
 */
const nodeGraphApi = {
  /**
   * 将已序列化的节点图 JSON 字符串写入指定路径。
   * 不弹对话框，调用方需先通过 showSaveDialog 取得路径或直接传入已知路径。
   */
  save: (filePath: string, json: string): Promise<{ ok: true } | { ok: false; error: string }> =>
    ipcRenderer.invoke(NODE_GRAPH_SAVE, { filePath, json }),
  /**
   * 读取指定路径的节点图 JSON 字符串。
   * 不弹对话框，调用方需先通过 showOpenDialog 取得路径或直接传入已知路径。
   */
  load: (filePath: string): Promise<{ ok: true; json: string } | { ok: false; error: string }> =>
    ipcRenderer.invoke(NODE_GRAPH_LOAD, { filePath }),
  /**
   * 弹出保存对话框，让用户选择 .json 路径。
   * 用户取消时返回 { ok: false }，不抛错。
   * @param defaultName 默认文件名（如 'my_mod-node-graph.json'）
   */
  showSaveDialog: (defaultName: string): Promise<{ ok: true; filePath: string } | { ok: false }> =>
    ipcRenderer.invoke(NODE_GRAPH_SHOW_SAVE_DIALOG, { defaultName }),
  /**
   * 弹出打开对话框，让用户选择 .json 文件。
   * 用户取消时返回 { ok: false }，不抛错。
   */
  showOpenDialog: (): Promise<{ ok: true; filePath: string } | { ok: false }> =>
    ipcRenderer.invoke(NODE_GRAPH_SHOW_OPEN_DIALOG),
};

/** window.api 命名空间：聚合独立子模块（当前仅 nodeGraph） */
const apiNamespace = {
  nodeGraph: nodeGraphApi,
};

try {
  contextBridge.exposeInMainWorld('mcApi', api);
  // 节点图持久化使用独立 window.api 命名空间（与 mcApi 解耦，便于后续扩展）
  contextBridge.exposeInMainWorld('api', apiNamespace);
} catch {
  // 测试环境无 contextBridge，挂到 globalThis
  (globalThis as { mcApi?: typeof api }).mcApi = api;
  (globalThis as { api?: typeof apiNamespace }).api = apiNamespace;
}

export type McApi = typeof api;
export type NodeGraphApi = typeof nodeGraphApi;
