import type {
  GenerateSpecRes,
  GenerateFilesRes,
  BuildRes,
  BuildWithFixRes,
  ExportZipRes,
  SaveFileRes,
  SaveAllFilesRes,
  PrepareBuildDirRes,
  ExportProjectRes,
  ImportProjectRes,
  GeneratorType,
  Project,
  BuildStreamChunkT,
  ModrinthSearchRes,
  ModrinthVersionsRes,
  CurseForgeSearchRes,
  CurseForgeFilesRes,
  CurseForgeConfig,
  GitChooseRepoRes,
  GitStatusRes,
  GitLogRes,
  GitCommitRes,
  GitSyncRes,
  GitBranchListRes,
  GitBranchCreateRes,
  GitBranchSwitchRes,
  GitDiffRes,
  LocateMcRes,
  McChooseDirRes,
  InstallModRes,
  LaunchMcRes,
  ImportResourceFilesRes,
} from '../../../shared/ipc-channels.js';

/** 封装 window.mcApi，提供类型安全调用 */
export const ipcClient = {
  generateSpec: (description: string, generatorType: GeneratorType): Promise<GenerateSpecRes> =>
    window.mcApi.generateSpec(description, generatorType),
  generateFiles: (req: {
    loader: string;
    mcVersion: string;
    spec: unknown;
    generatorType: GeneratorType;
  }): Promise<GenerateFilesRes> => window.mcApi.generateFiles(req),
  build: (projectPath: string): Promise<BuildRes> => window.mcApi.build(projectPath),
  loadModelConfig: () => window.mcApi.loadModelConfig(),
  saveModelConfig: (config: { name: string; modelId: string; baseURL: string; apiKey: string }) =>
    window.mcApi.saveModelConfig(config),
  chat: (message: string) => window.mcApi.chat(message),
  /**
   * P12 chat 模式工具调用增强：chatStream 添加可选 context 参数。
   * context 由调用方（如 ChatPanel）从项目 store 提取并传入，
   * main 进程会据此构建增强 system message。
   */
  chatStream: (
    message: string,
    onChunk: (delta: string, done: boolean) => void,
    context?: { generatorType?: string; description?: string; specSummary?: string },
  ) => window.mcApi.chatStream(message, onChunk, context),
  explainCode: (
    fileName: string,
    code: string,
    generatorType: string | undefined,
    onChunk: (delta: string, done: boolean) => void,
  ) => window.mcApi.explainCode(fileName, code, generatorType, onChunk),
  compareModels: (
    req: {
      description: string;
      generatorType: string;
      models: { name: string; modelId: string; baseURL: string; apiKey: string }[];
    },
    onChunk: (data: { modelName: string; delta: string; done: boolean }) => void,
  ) => window.mcApi.compareModels(req, onChunk),
  fixSuggest: (
    buildLog: string,
    files: { path: string; content: string }[],
    onChunk: (delta: string, done: boolean) => void,
  ) => window.mcApi.fixSuggest(buildLog, files, onChunk),
  buildWithFix: (projectPath: string): Promise<BuildWithFixRes> =>
    window.mcApi.buildWithFix(projectPath),
  buildStream: (projectPath: string, onChunk: (chunk: BuildStreamChunkT) => void) =>
    window.mcApi.buildStream(projectPath, onChunk),
  exportZip: (req: {
    files: { path: string; content: string }[];
    defaultName: string;
  }): Promise<ExportZipRes> => window.mcApi.exportZip(req),
  saveFile: (req: { path: string; content: string; defaultName?: string }): Promise<SaveFileRes> =>
    window.mcApi.saveFile(req),
  saveAllFiles: (req: { files: { path: string; content: string }[] }): Promise<SaveAllFilesRes> =>
    window.mcApi.saveAllFiles(req),
  prepareBuildDir: (files: { path: string; content: string }[]): Promise<PrepareBuildDirRes> =>
    window.mcApi.prepareBuildDir(files),
  listProjects: (): Promise<Project[]> => window.mcApi.listProjects(),
  getProject: (id: string): Promise<Project | null> => window.mcApi.getProject(id),
  saveProject: (project: Project): Promise<{ ok: true }> => window.mcApi.saveProject(project),
  deleteProject: (id: string): Promise<{ ok: true }> => window.mcApi.deleteProject(id),
  exportProject: (project: Project): Promise<ExportProjectRes> =>
    window.mcApi.exportProject(project),
  importProject: (): Promise<ImportProjectRes> => window.mcApi.importProject(),
  modrinthSearch: (req: {
    query: string;
    loader?: string;
    mcVersion?: string;
    limit?: number;
  }): Promise<ModrinthSearchRes> => window.mcApi.modrinthSearch(req),
  modrinthVersions: (req: {
    projectId: string;
    loader?: string;
    mcVersion?: string;
  }): Promise<ModrinthVersionsRes> => window.mcApi.modrinthVersions(req),
  curseforgeSearch: (req: {
    query: string;
    loader?: string;
    mcVersion?: string;
    limit?: number;
  }): Promise<CurseForgeSearchRes> => window.mcApi.curseforgeSearch(req),
  curseforgeFiles: (req: {
    modId: number;
    loader?: string;
    mcVersion?: string;
  }): Promise<CurseForgeFilesRes> => window.mcApi.curseforgeFiles(req),
  loadCurseForgeConfig: (): Promise<CurseForgeConfig> => window.mcApi.loadCurseForgeConfig(),
  saveCurseForgeConfig: (config: CurseForgeConfig): Promise<{ ok: true }> =>
    window.mcApi.saveCurseForgeConfig(config),
  // 源代码管理
  gitChooseRepo: (): Promise<GitChooseRepoRes> => window.mcApi.gitChooseRepo(),
  gitStatus: (repoPath: string): Promise<GitStatusRes> => window.mcApi.gitStatus(repoPath),
  gitLog: (repoPath: string, limit: number): Promise<GitLogRes> =>
    window.mcApi.gitLog(repoPath, limit),
  gitCommit: (repoPath: string, message: string, all: boolean): Promise<GitCommitRes> =>
    window.mcApi.gitCommit(repoPath, message, all),
  gitPull: (repoPath: string): Promise<GitSyncRes> => window.mcApi.gitPull(repoPath),
  gitPush: (repoPath: string): Promise<GitSyncRes> => window.mcApi.gitPush(repoPath),
  // Git 增强
  gitBranchList: (repoPath: string): Promise<GitBranchListRes> =>
    window.mcApi.gitBranchList(repoPath),
  gitBranchCreate: (repoPath: string, name: string): Promise<GitBranchCreateRes> =>
    window.mcApi.gitBranchCreate(repoPath, name),
  gitBranchSwitch: (repoPath: string, name: string): Promise<GitBranchSwitchRes> =>
    window.mcApi.gitBranchSwitch(repoPath, name),
  gitAdd: (repoPath: string, paths: string[]): Promise<{ ok: boolean; error?: string }> =>
    window.mcApi.gitAdd(repoPath, paths),
  gitReset: (repoPath: string, paths: string[]): Promise<{ ok: boolean; error?: string }> =>
    window.mcApi.gitReset(repoPath, paths),
  gitDiff: (repoPath: string, path: string, staged?: boolean): Promise<GitDiffRes> =>
    window.mcApi.gitDiff(repoPath, path, staged),
  // Minecraft 启动器（离线）
  locateMc: (): Promise<LocateMcRes> => window.mcApi.locateMc(),
  chooseMcDir: (): Promise<McChooseDirRes> => window.mcApi.chooseMcDir(),
  installMod: (jarPath: string, mcDir?: string): Promise<InstallModRes> =>
    window.mcApi.installMod(jarPath, mcDir),
  launchMc: (mcDir?: string): Promise<LaunchMcRes> => window.mcApi.launchMc(mcDir),
  // 终端（PTY 桥接）
  terminalSpawn: (req: {
    shell?: string;
    cwd?: string;
    cols?: number;
    rows?: number;
  }): Promise<{ pid: number }> => window.mcApi.terminalSpawn(req),
  terminalWrite: (pid: number, data: string): Promise<void> =>
    window.mcApi.terminalWrite(pid, data),
  terminalResize: (pid: number, cols: number, rows: number): Promise<void> =>
    window.mcApi.terminalResize(pid, cols, rows),
  terminalKill: (pid: number): Promise<void> => window.mcApi.terminalKill(pid),
  // 资源文件导入
  importResourceFiles: (req?: {
    title?: string;
    extensions?: string[];
    multiSelect?: boolean;
  }): Promise<ImportResourceFilesRes> => window.mcApi.importResourceFiles(req ?? {}),
};
