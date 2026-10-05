import { contextBridge, ipcRenderer } from 'electron';
import { sandboxedMustacheApi } from './sandboxedMustache.js';
import {
  IPC,
  EXPORT_ZIP,
  SAVE_FILE,
  EXPORT_SPEC,
  IMPORT_SPEC,
  LAUNCHER_LIST_VERSIONS,
  LAUNCHER_DOWNLOAD,
  LAUNCHER_LAUNCH,
  LAUNCHER_INSTALL_LOADER,
  LAUNCHER_LIST_MODS,
  LAUNCHER_INSTALL_MOD,
  LAUNCHER_REMOVE_MOD,
  LAUNCHER_INSTALL_SKIN,
  SAVE_ALL_FILES,
  PREPARE_BUILD_DIR,
  EXPORT_PROJECT,
  IMPORT_PROJECT,
  LOAD_MODEL_CONFIG,
  SAVE_MODEL_CONFIG,
  MODEL_LIST_PROFILES,
  MODEL_SAVE_PROFILES,
  MODEL_TEST_CONNECTION,
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
  BUILD_ABORT,
  BUILD_CHECK_JAVA,
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
  MODPACK_RESOLVE,
  MODPACK_CHECK_CONFLICTS,
  MODPACK_EXPORT_MRPACK,
  MODPACK_EXPORT_PROGRESS,
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
  RAG_SEARCH,
  type GeneratorType,
  type BuildStreamChunkT,
  type RagSearchRes,
  type ProcessLogEventT,
  type ProcessStateEventT,
  NODE_GRAPH_SAVE,
  NODE_GRAPH_LOAD,
  NODE_GRAPH_SHOW_SAVE_DIALOG,
  NODE_GRAPH_SHOW_OPEN_DIALOG,
  PROJECT_CHANGED,
  PROCESS_LIST,
  PROCESS_STATUS,
  PROCESS_LOGS,
  PROCESS_LOG_EVENT,
  PROCESS_STATE_EVENT,
  KERNEL_LIST_KINDS,
  KERNEL_READ,
  KERNEL_EXECUTE,
  KERNEL_CONFIRM_REQUEST,
  KERNEL_CONFIRM_RESPONSE,
  type KernelListKindsRes,
  type KernelTaskResultT,
  type KernelReadReq,
  type KernelExecuteReq,
  type KernelExecuteRes,
  type KernelConfirmReq,
  type KernelConfirmRes,
} from '../shared/ipc-channels.js';
import { AGENT_RUN_LOOP } from '../shared/ipc/agent-loop.js';

/**
 * 流式请求的并发隔离 id（见 shared/ipc/stream.ts）。
 *
 * 分片发在共享通道上，同一时刻若有两个流，双方监听器都会收到彼此的分片。
 * 这里为每个流生成唯一 id 随请求下发，主进程原样回传，接收方据此过滤。
 */
let streamRequestSeq = 0;
function nextStreamRequestId(): string {
  streamRequestSeq += 1;
  return `${Date.now().toString(36)}-${streamRequestSeq.toString(36)}`;
}

const api = {
  sandboxedMustache: sandboxedMustacheApi,
  generateSpec: (description: string, generatorType: GeneratorType) =>
    ipcRenderer.invoke(IPC.GENERATE_SPEC, { description, generatorType }),
  generateFiles: (req: {
    loader: string;
    mcVersion: string;
    spec: unknown;
    generatorType: GeneratorType;
    /** 当前项目 id（可选）：主进程据此隔离并持久化增量构建缓存 */
    projectId?: string;
  }) => ipcRenderer.invoke(IPC.GENERATE_FILES, req),
  build: (projectPath: string) => ipcRenderer.invoke(IPC.BUILD, { projectPath }),
  loadModelConfig: () => ipcRenderer.invoke(LOAD_MODEL_CONFIG),
  saveModelConfig: (config: unknown) => ipcRenderer.invoke(SAVE_MODEL_CONFIG, config),
  listModelProfiles: <T = unknown>() => ipcRenderer.invoke(MODEL_LIST_PROFILES) as Promise<T>,
  saveModelProfiles: (req: unknown) => ipcRenderer.invoke(MODEL_SAVE_PROFILES, req),
  testModelConnection: (req: unknown) => ipcRenderer.invoke(MODEL_TEST_CONNECTION, req),
  chat: (message: string) => ipcRenderer.invoke(CHAT, { message }),
  /**
   * RAG 知识库检索（主进程 TF-IDF + 内存 LRU）。
   * UI“引用来源”与智能体 search_knowledge 工具经此查询。
   */
  ragSearch: (req: { query: string; generatorType?: string; topK?: number }) =>
    ipcRenderer.invoke(RAG_SEARCH, req) as Promise<RagSearchRes>,
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
    const requestId = nextStreamRequestId();
    const handler = (_e: unknown, data: { delta: string; done: boolean; requestId?: string }) => {
      // 只处理本次流的分片；无 requestId 的分片放行（兼容旧主进程）
      if (data.requestId && data.requestId !== requestId) return;
      onChunk(data.delta, data.done);
      // 收到 done 后立即移除监听，避免残留监听器接收后续流的 chunk
      if (data.done) ipcRenderer.removeListener(CHAT_STREAM_CHUNK, handler);
    };
    ipcRenderer.on(CHAT_STREAM_CHUNK, handler);
    // P0 修复：invoke 失败时也要移除监听，否则内存泄漏
    ipcRenderer.invoke(CHAT_STREAM, { message, context, requestId }).finally(() => {
      ipcRenderer.removeListener(CHAT_STREAM_CHUNK, handler);
    });
  },
  explainCode: (
    fileName: string,
    code: string,
    generatorType: string | undefined,
    onChunk: (delta: string, done: boolean) => void,
  ) => {
    const requestId = nextStreamRequestId();
    const handler = (_e: unknown, data: { delta: string; done: boolean; requestId?: string }) => {
      if (data.requestId && data.requestId !== requestId) return;
      onChunk(data.delta, data.done);
      if (data.done) ipcRenderer.removeListener(EXPLAIN_CODE_CHUNK, handler);
    };
    ipcRenderer.on(EXPLAIN_CODE_CHUNK, handler);
    ipcRenderer.invoke(EXPLAIN_CODE, { fileName, code, generatorType, requestId }).finally(() => {
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
    const requestId = nextStreamRequestId();
    const handler = (
      _e: unknown,
      data: { modelName: string; delta: string; done: boolean; requestId?: string },
    ) => {
      if (data.requestId && data.requestId !== requestId) return;
      onChunk(data);
      if (data.done) ipcRenderer.removeListener(COMPARE_MODELS_CHUNK, handler);
    };
    ipcRenderer.on(COMPARE_MODELS_CHUNK, handler);
    ipcRenderer.invoke(COMPARE_MODELS, { ...req, requestId }).finally(() => {
      ipcRenderer.removeListener(COMPARE_MODELS_CHUNK, handler);
    });
  },
  fixSuggest: (
    buildLog: string,
    files: { path: string; content: string }[],
    onChunk: (delta: string, done: boolean) => void,
  ) => {
    const requestId = nextStreamRequestId();
    const handler = (_e: unknown, data: { delta: string; done: boolean; requestId?: string }) => {
      if (data.requestId && data.requestId !== requestId) return;
      onChunk(data.delta, data.done);
      if (data.done) ipcRenderer.removeListener(AI_FIX_SUGGEST_CHUNK, handler);
    };
    ipcRenderer.on(AI_FIX_SUGGEST_CHUNK, handler);
    ipcRenderer.invoke(AI_FIX_SUGGEST, { buildLog, files, requestId }).finally(() => {
      ipcRenderer.removeListener(AI_FIX_SUGGEST_CHUNK, handler);
    });
  },
  buildWithFix: (projectPath: string) => ipcRenderer.invoke(BUILD_WITH_FIX, { projectPath }),
  // Phase 3.2：取消构建（kill 流式构建子进程）+ JDK 预检
  abortBuild: () => ipcRenderer.invoke(BUILD_ABORT),
  checkJava: (mcVersion?: string) => ipcRenderer.invoke(BUILD_CHECK_JAVA, { mcVersion }),
  buildStream: (projectPath: string, onChunk: (chunk: BuildStreamChunkT) => void) => {
    const requestId = nextStreamRequestId();
    const handler = (_e: unknown, data: BuildStreamChunkT) => {
      if (data.requestId && data.requestId !== requestId) return;
      onChunk(data);
      if (data.done) ipcRenderer.removeListener(BUILD_STREAM_CHUNK, handler);
    };
    ipcRenderer.on(BUILD_STREAM_CHUNK, handler);
    // P0 修复：invoke 失败时也要移除监听，否则内存泄漏
    ipcRenderer.invoke(BUILD_STREAM, { projectPath, requestId }).finally(() => {
      ipcRenderer.removeListener(BUILD_STREAM_CHUNK, handler);
    });
  },
  exportZip: (req: { files: { path: string; content: string }[]; defaultName: string }) =>
    ipcRenderer.invoke(EXPORT_ZIP, req),
  saveFile: (req: { path: string; content: string; defaultName?: string }) =>
    ipcRenderer.invoke(SAVE_FILE, req),
  exportSpec: (req: { spec: unknown; generatorType: string; description?: string }) =>
    ipcRenderer.invoke(EXPORT_SPEC, req),
  importSpec: () => ipcRenderer.invoke(IMPORT_SPEC),
  launcherListVersions: () => ipcRenderer.invoke(LAUNCHER_LIST_VERSIONS),
  launcherDownload: (req: { version: string }) => ipcRenderer.invoke(LAUNCHER_DOWNLOAD, req),
  launcherLaunch: (req: { version: string; username: string; memory: string; gameDir?: string }) =>
    ipcRenderer.invoke(LAUNCHER_LAUNCH, req),
  launcherInstallLoader: (req: { version: string; loader: 'fabric' | 'neoforge' }) =>
    ipcRenderer.invoke(LAUNCHER_INSTALL_LOADER, req),
  launcherListMods: (version: string) => ipcRenderer.invoke(LAUNCHER_LIST_MODS, { version }),
  launcherInstallMod: (req: { version: string; name: string; url: string }) =>
    ipcRenderer.invoke(LAUNCHER_INSTALL_MOD, req),
  launcherRemoveMod: (req: { version: string; name: string }) =>
    ipcRenderer.invoke(LAUNCHER_REMOVE_MOD, req),
  launcherInstallSkin: (req: { version: string; skinApiUrl?: string }) =>
    ipcRenderer.invoke(LAUNCHER_INSTALL_SKIN, req),
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
  // === 整合包：依赖解析 + 冲突检测 + mrpack 导出 ===
  modpackResolve: (req: {
    mods: { projectId: string; name?: string }[];
    mcVersion: string;
    loader: string;
    allowCache?: boolean;
  }) => ipcRenderer.invoke(MODPACK_RESOLVE, req),
  modpackCheckConflicts: (req: { mods: unknown[]; mcVersion: string; loader: string }) =>
    ipcRenderer.invoke(MODPACK_CHECK_CONFLICTS, req),
  modpackExportMrpack: (req: { spec: unknown; projectId?: string; defaultName?: string }) =>
    ipcRenderer.invoke(MODPACK_EXPORT_MRPACK, req),
  onModpackExportProgress: (
    handler: (data: {
      requestId: string;
      loaded: number;
      total: number;
      percentage: number;
      currentFile: string;
      done: boolean;
    }) => void,
  ) => {
    const wrapped = (
      _e: unknown,
      data: {
        requestId: string;
        loaded: number;
        total: number;
        percentage: number;
        currentFile: string;
        done: boolean;
      },
    ) => handler(data);
    ipcRenderer.on(MODPACK_EXPORT_PROGRESS, wrapped);
    return () => ipcRenderer.removeListener(MODPACK_EXPORT_PROGRESS, wrapped);
  },
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

  // === 项目感知文件操作 ===
  fileProjectListDir: (projectId: string, path?: string) =>
    ipcRenderer.invoke(IPC.FILE_PROJECT_LIST_DIR, { projectId, path: path ?? '' }),
  fileProjectListTree: (projectId: string, path?: string, maxDepth?: number) =>
    ipcRenderer.invoke(IPC.FILE_PROJECT_LIST_TREE, {
      projectId,
      path: path ?? '',
      maxDepth: maxDepth ?? -1,
    }),
  fileProjectReadText: (projectId: string, path: string, encoding?: string) =>
    ipcRenderer.invoke(IPC.FILE_PROJECT_READ_TEXT, { projectId, path, encoding }),
  fileProjectWriteText: (projectId: string, path: string, content: string, encoding?: string) =>
    ipcRenderer.invoke(IPC.FILE_PROJECT_WRITE_TEXT, { projectId, path, content, encoding }),
  fileProjectMakeDir: (projectId: string, path: string) =>
    ipcRenderer.invoke(IPC.FILE_PROJECT_MAKE_DIR, { projectId, path }),
  fileProjectDeleteItem: (projectId: string, path: string) =>
    ipcRenderer.invoke(IPC.FILE_PROJECT_DELETE_ITEM, { projectId, path }),
  fileProjectGetWorkspace: (projectId: string) =>
    ipcRenderer.invoke(IPC.FILE_PROJECT_GET_WORKSPACE, { projectId }),
  fileProjectGetOutputDir: (projectId: string) =>
    ipcRenderer.invoke(IPC.FILE_PROJECT_GET_OUTPUT_DIR, { projectId }),
  fileProjectGetBuildCacheDir: (projectId: string) =>
    ipcRenderer.invoke(IPC.FILE_PROJECT_GET_BUILD_CACHE_DIR, { projectId }),
  fileProjectGetTempDir: (projectId: string) =>
    ipcRenderer.invoke(IPC.FILE_PROJECT_GET_TEMP_DIR, { projectId }),
  fileProjectGetResourcePacksDir: (projectId: string) =>
    ipcRenderer.invoke(IPC.FILE_PROJECT_GET_RESOURCE_PACKS_DIR, { projectId }),
  fileProjectGetModsDir: (projectId: string) =>
    ipcRenderer.invoke(IPC.FILE_PROJECT_GET_MODS_DIR, { projectId }),
  fileProjectGetExportsDir: (projectId: string) =>
    ipcRenderer.invoke(IPC.FILE_PROJECT_GET_EXPORTS_DIR, { projectId }),
  fileProjectEnsureDirs: (projectId: string) =>
    ipcRenderer.invoke(IPC.FILE_PROJECT_ENSURE_DIRS, { projectId }),
  // 文件元数据与冲突检测
  fileProjectGetFileMeta: (projectId: string, path: string) =>
    ipcRenderer.invoke(IPC.FILE_PROJECT_GET_FILE_META, { projectId, path }),
  fileProjectWriteTextWithMeta: (
    projectId: string,
    path: string,
    content: string,
    expectedMeta?: { mtime: number; size: number; hash: string },
    encoding?: string,
  ) =>
    ipcRenderer.invoke(IPC.FILE_PROJECT_WRITE_TEXT_WITH_META, {
      projectId,
      path,
      content,
      expectedMeta,
      encoding,
    }),

  // === 项目变更监听 ===
  onProjectChanged: (
    handler: (payload: { type: 'created' | 'updated' | 'deleted'; projectId: string }) => void,
  ) => {
    const handlerWrapper = (
      _e: unknown,
      payload: { type: 'created' | 'updated' | 'deleted'; projectId: string },
    ) => handler(payload);
    ipcRenderer.on(PROJECT_CHANGED, handlerWrapper);
    return () => ipcRenderer.removeListener(PROJECT_CHANGED, handlerWrapper);
  },

  // === 进程托管（外壳层只读，§7.1 / §10.2）===
  // 白名单里**只有只读查询**：列被托管进程 / 读状态 / 读日志尾部。
  // 故意不暴露 start/stop —— 启动服务端必须先弹窗确认（§10.6），
  // 那条路必须经内核的确认闸门，不能由渲染进程直接 spawn（§4.3 白名单原则）。
  processList: () => ipcRenderer.invoke(PROCESS_LIST),
  processStatus: (serverId: string) => ipcRenderer.invoke(PROCESS_STATUS, { serverId }),
  processLogs: (serverId: string, limit?: number) =>
    ipcRenderer.invoke(PROCESS_LOGS, limit === undefined ? { serverId } : { serverId, limit }),
  onProcessLog: (handler: (e: ProcessLogEventT) => void) => {
    const wrapper = (_e: unknown, payload: ProcessLogEventT) => handler(payload);
    ipcRenderer.on(PROCESS_LOG_EVENT, wrapper);
    return () => ipcRenderer.removeListener(PROCESS_LOG_EVENT, wrapper);
  },
  /**
   * 订阅进程状态变更（含自动重启事件）。
   *
   * 这是**通知**不是命令：渲染层收到 `auto-restart-exhausted` 该弹告警、
   * 提供一个走正常启动流程的按钮，而不是自己去点火 —— 点火权在主进程
   * 的 confirm 闸门（§10.6）。返回值是取消订阅函数（React effect 清理用）。
   */
  onProcessState: (handler: (e: ProcessStateEventT) => void) => {
    const wrapper = (_e: unknown, payload: ProcessStateEventT) => handler(payload);
    ipcRenderer.on(PROCESS_STATE_EVENT, wrapper);
    return () => ipcRenderer.removeListener(PROCESS_STATE_EVENT, wrapper);
  },

  // === 内核（外壳 ↔ 内核，§4.2 / §10）===
  // 白名单含只读（R 类）通道 + 执行（W/X 类）通道 + UI 确认两通道。
  // KERNEL_EXECUTE 曾刻意不暴露（确认弹窗与错误呈现在 UI 上没验证过）；
  // 现按用户决策开放（W/X 可点），安全由三道缓解兜底，缺一不可：
  //  1. 超时拒绝：主进程侧计时（默认 60s），无应答一律拒绝（fail-closed）；
  //  2. id 关联：并发请求按 id 归位，对不上 id 的应答静默丢弃；
  //  3. 审计：每次确认请求都记 confirmLog（主进程内存，渲染层够不着）。
  // 渲染层仍然只有 invoke/on，没有任何 fs/进程能力；执行入参仍先过 zod
  // 白名单 kind 校验（KernelExecuteRequest.parse），非法 kind 到不了内核。
  // 这里给渲染层的是 `window.mcApi.kernel.*` + 确认两通道。
  kernelListKinds: () => ipcRenderer.invoke(KERNEL_LIST_KINDS) as Promise<KernelListKindsRes>,
  /** AI 规格闭环（L2：prompt→真模型→spec JSON→校验→修复→合法 spec）。 */
  agentRunLoop: (req: {
    prompt: string;
    kind?: string;
    mcVersion?: string;
    maxAttempts?: number;
  }) => ipcRenderer.invoke(AGENT_RUN_LOOP, req),
  kernelRead: (req: KernelReadReq) =>
    ipcRenderer.invoke(KERNEL_READ, req) as Promise<KernelTaskResultT>,
  kernelExecute: (req: KernelExecuteReq) =>
    ipcRenderer.invoke(KERNEL_EXECUTE, req) as Promise<KernelExecuteRes>,
  // 确认请求是主进程 send 方向（渲染层只有应答权、没有发起权）；
  // 应答走 invoke 回 KERNEL_CONFIRM_RESPONSE，由主进程侧 parse + id 关联。
  onKernelConfirmRequest: (cb: (req: KernelConfirmReq) => void) => {
    const wrapper = (_e: unknown, payload: KernelConfirmReq) => cb(payload);
    ipcRenderer.on(KERNEL_CONFIRM_REQUEST, wrapper);
    return () => ipcRenderer.removeListener(KERNEL_CONFIRM_REQUEST, wrapper);
  },
  respondKernelConfirm: (res: KernelConfirmRes) => ipcRenderer.invoke(KERNEL_CONFIRM_RESPONSE, res),

  // === 大文件流式传输 ===

  /**
   * 流式写入大文件（分片上传）
   * 使用模式：调用方分片发送，主进程流式写入磁盘
   * @param projectId 项目 ID
   * @param path 相对路径
   * @param data Uint8Array 或 AsyncIterable<Uint8Array>
   * @param options onProgress 进度回调，expectedHash 预期 MD5
   * @returns 写入结果
   */
  fileProjectWriteStream: async (
    projectId: string,
    path: string,
    data: Uint8Array | AsyncIterable<Uint8Array>,
    options?: {
      onProgress?: (progress: { loaded: number; total: number; percentage: number }) => void;
      expectedHash?: string;
    },
  ): Promise<{
    success: boolean;
    meta?: { size: number; mtime: number; hash: string };
    error?: string;
  }> => {
    const requestId = nextStreamRequestId();
    let totalSize = 0;

    // 计算总大小（如果是 Uint8Array 直接获取；如果是迭代器需要预计算或由调用方传入）
    if (data instanceof Uint8Array) {
      totalSize = data.byteLength;
    } else {
      // 对于迭代器，要求调用方传入 totalSize（通过 options 隐式传递，这里简化处理）
      // 实际使用时建议显式传入 totalSize
      throw new Error('AsyncIterable 模式暂不支持，请传入 Uint8Array 或显式提供 totalSize');
    }

    // 发起流式写入会话
    const startResult = await ipcRenderer.invoke(IPC.FILE_PROJECT_WRITE_STREAM, {
      projectId,
      path,
      totalSize,
      expectedHash: options?.expectedHash,
      requestId,
    });

    if (!startResult.success) {
      return { success: false, error: startResult.error };
    }

    let loaded = 0;
    let chunkIndex = 0;

    try {
      if (data instanceof Uint8Array) {
        // 分片发送
        const chunkSize = 1024 * 1024; // 1MB
        for (let offset = 0; offset < data.byteLength; offset += chunkSize) {
          const chunk = data.slice(offset, offset + chunkSize);
          const isLast = offset + chunkSize >= data.byteLength;

          const chunkResult = await ipcRenderer.invoke(IPC.FILE_PROJECT_WRITE_STREAM_CHUNK, {
            requestId,
            chunkIndex: chunkIndex++,
            data: Buffer.from(chunk).toString('base64'),
            isLast,
          });

          if (!chunkResult.success) {
            return { success: false, error: chunkResult.error };
          }

          loaded += chunk.byteLength;
          if (options?.onProgress) {
            options.onProgress({
              loaded,
              total: totalSize,
              percentage: Math.round((loaded / totalSize) * 100),
            });
          }
        }
      }

      return startResult.meta ? { success: true, meta: startResult.meta } : { success: true };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  },

  /**
   * 流式读取大文件（分片下载）
   * 使用模式：主进程分片发送，渲染侧接收拼装
   * @param projectId 项目 ID
   * @param path 相对路径
   * @param onChunk 分片回调
   * @param options chunkSize 分片大小
   * @returns 读取结果
   */
  fileProjectReadStream: (
    projectId: string,
    path: string,
    onChunk: (data: {
      chunk: Uint8Array;
      isLast: boolean;
      progress: { loaded: number; total: number; percentage: number };
    }) => void,
    options?: { chunkSize?: number },
  ): Promise<{ success: boolean; error?: string }> => {
    const requestId = nextStreamRequestId();
    const handler = (
      _e: unknown,
      data: {
        requestId: string;
        chunkIndex: number;
        data: string;
        isLast: boolean;
        progress: { loaded: number; total: number; percentage: number };
      },
    ) => {
      if (data.requestId !== requestId) return;
      onChunk({
        chunk: Buffer.from(data.data, 'base64'),
        isLast: data.isLast,
        progress: data.progress,
      });
      if (data.isLast) {
        ipcRenderer.removeListener(IPC.FILE_PROJECT_READ_STREAM_CHUNK, handler);
      }
    };
    ipcRenderer.on(IPC.FILE_PROJECT_READ_STREAM_CHUNK, handler);
    return ipcRenderer
      .invoke(IPC.FILE_PROJECT_READ_STREAM, {
        projectId,
        path,
        chunkSize: options?.chunkSize,
        requestId,
      })
      .finally(() => {
        ipcRenderer.removeListener(IPC.FILE_PROJECT_READ_STREAM_CHUNK, handler);
      });
  },
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
