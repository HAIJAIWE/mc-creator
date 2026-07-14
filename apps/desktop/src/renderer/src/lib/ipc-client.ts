import type { GenerateSpecRes, GenerateFilesRes, BuildRes, BuildWithFixRes, GeneratorType } from '../../../shared/ipc-channels.js';

/** 封装 window.mcApi，提供类型安全调用 */
export const ipcClient = {
  generateSpec: (description: string): Promise<GenerateSpecRes> =>
    window.mcApi.generateSpec(description),
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
};
