import type { GenerateSpecRes, GenerateFilesRes, BuildRes, BuildWithFixRes, ExportZipRes, PrepareBuildDirRes, GeneratorType, Project, BuildStreamChunkT, ModrinthSearchRes, ModrinthVersionsRes } from '../../../shared/ipc-channels.js';

/** 封装 window.mcApi，提供类型安全调用 */
export const ipcClient = {
  generateSpec: (description: string, generatorType: GeneratorType): Promise<GenerateSpecRes> =>
    window.mcApi.generateSpec(description, generatorType),
  generateFiles: (req: { loader: string; mcVersion: string; spec: unknown; generatorType: GeneratorType }): Promise<GenerateFilesRes> =>
    window.mcApi.generateFiles(req),
  build: (projectPath: string): Promise<BuildRes> =>
    window.mcApi.build(projectPath),
  loadModelConfig: () => window.mcApi.loadModelConfig(),
  saveModelConfig: (config: { name: string; modelId: string; baseURL: string; apiKey: string }) =>
    window.mcApi.saveModelConfig(config),
  chat: (message: string) => window.mcApi.chat(message),
  chatStream: (message: string, onChunk: (delta: string, done: boolean) => void) =>
    window.mcApi.chatStream(message, onChunk),
  buildWithFix: (projectPath: string): Promise<BuildWithFixRes> =>
    window.mcApi.buildWithFix(projectPath),
  buildStream: (projectPath: string, onChunk: (chunk: BuildStreamChunkT) => void) =>
    window.mcApi.buildStream(projectPath, onChunk),
  exportZip: (req: { files: { path: string; content: string }[]; defaultName: string }): Promise<ExportZipRes> =>
    window.mcApi.exportZip(req),
  prepareBuildDir: (files: { path: string; content: string }[]): Promise<PrepareBuildDirRes> =>
    window.mcApi.prepareBuildDir(files),
  listProjects: (): Promise<Project[]> => window.mcApi.listProjects(),
  getProject: (id: string): Promise<Project | null> => window.mcApi.getProject(id),
  saveProject: (project: Project): Promise<{ ok: true }> => window.mcApi.saveProject(project),
  deleteProject: (id: string): Promise<{ ok: true }> => window.mcApi.deleteProject(id),
  modrinthSearch: (req: { query: string; loader?: string; mcVersion?: string; limit?: number }): Promise<ModrinthSearchRes> =>
    window.mcApi.modrinthSearch(req),
  modrinthVersions: (req: { projectId: string; loader?: string; mcVersion?: string }): Promise<ModrinthVersionsRes> =>
    window.mcApi.modrinthVersions(req),
};
