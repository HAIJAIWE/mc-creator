import type { GenerateSpecRes, GenerateFilesRes, BuildRes } from '../../../shared/ipc-channels.js';

/** 封装 window.mcApi，提供类型安全调用 */
export const ipcClient = {
  generateSpec: (description: string): Promise<GenerateSpecRes> =>
    window.mcApi.generateSpec(description),
  generateFiles: (req: { loader: string; mcVersion: string; spec: unknown }): Promise<GenerateFilesRes> =>
    window.mcApi.generateFiles(req),
  build: (projectPath: string): Promise<BuildRes> =>
    window.mcApi.build(projectPath),
};
