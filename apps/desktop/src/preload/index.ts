import { contextBridge, ipcRenderer } from 'electron';
import { IPC, EXPORT_ZIP, PREPARE_BUILD_DIR, LOAD_MODEL_CONFIG, SAVE_MODEL_CONFIG, CHAT, CHAT_STREAM, CHAT_STREAM_CHUNK, BUILD_WITH_FIX, BUILD_STREAM, BUILD_STREAM_CHUNK, LIST_PROJECTS, GET_PROJECT, SAVE_PROJECT, DELETE_PROJECT, MODRINTH_SEARCH, MODRINTH_VERSIONS, type GeneratorType, type BuildStreamChunkT } from '../shared/ipc-channels.js';

const api = {
  generateSpec: (description: string, generatorType: GeneratorType) =>
    ipcRenderer.invoke(IPC.GENERATE_SPEC, { description, generatorType }),
  generateFiles: (req: { loader: string; mcVersion: string; spec: unknown; generatorType: GeneratorType }) =>
    ipcRenderer.invoke(IPC.GENERATE_FILES, req),
  build: (projectPath: string) => ipcRenderer.invoke(IPC.BUILD, { projectPath }),
  loadModelConfig: () => ipcRenderer.invoke(LOAD_MODEL_CONFIG),
  saveModelConfig: (config: unknown) => ipcRenderer.invoke(SAVE_MODEL_CONFIG, config),
  chat: (message: string) => ipcRenderer.invoke(CHAT, { message }),
  chatStream: (message: string, onChunk: (delta: string, done: boolean) => void) => {
    const handler = (_e: unknown, data: { delta: string; done: boolean }) => onChunk(data.delta, data.done);
    ipcRenderer.on(CHAT_STREAM_CHUNK, handler);
    ipcRenderer.invoke(CHAT_STREAM, { message }).then(() => {
      ipcRenderer.removeListener(CHAT_STREAM_CHUNK, handler);
    });
  },
  buildWithFix: (projectPath: string) => ipcRenderer.invoke(BUILD_WITH_FIX, { projectPath }),
  buildStream: (
    projectPath: string,
    onChunk: (chunk: BuildStreamChunkT) => void,
  ) => {
    const handler = (_e: unknown, data: BuildStreamChunkT) => onChunk(data);
    ipcRenderer.on(BUILD_STREAM_CHUNK, handler);
    ipcRenderer.invoke(BUILD_STREAM, { projectPath }).then(() => {
      ipcRenderer.removeListener(BUILD_STREAM_CHUNK, handler);
    });
  },
  exportZip: (req: { files: { path: string; content: string }[]; defaultName: string }) =>
    ipcRenderer.invoke(EXPORT_ZIP, req),
  prepareBuildDir: (files: { path: string; content: string }[]) =>
    ipcRenderer.invoke(PREPARE_BUILD_DIR, { files }),
  listProjects: () => ipcRenderer.invoke(LIST_PROJECTS),
  getProject: (id: string) => ipcRenderer.invoke(GET_PROJECT, { id }),
  saveProject: (project: unknown) => ipcRenderer.invoke(SAVE_PROJECT, project),
  deleteProject: (id: string) => ipcRenderer.invoke(DELETE_PROJECT, { id }),
  modrinthSearch: (req: { query: string; loader?: string; mcVersion?: string; limit?: number }) =>
    ipcRenderer.invoke(MODRINTH_SEARCH, req),
  modrinthVersions: (req: { projectId: string; loader?: string; mcVersion?: string }) =>
    ipcRenderer.invoke(MODRINTH_VERSIONS, req),
};

try {
  contextBridge.exposeInMainWorld('mcApi', api);
} catch {
  // 测试环境无 contextBridge，挂到 globalThis
  (globalThis as any).mcApi = api;
}

export type McApi = typeof api;
