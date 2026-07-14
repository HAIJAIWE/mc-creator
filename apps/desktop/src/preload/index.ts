import { contextBridge, ipcRenderer } from 'electron';
import { IPC, LOAD_MODEL_CONFIG, SAVE_MODEL_CONFIG, CHAT, CHAT_STREAM, CHAT_STREAM_CHUNK, BUILD_WITH_FIX } from '../shared/ipc-channels.js';

const api = {
  generateSpec: (description: string) => ipcRenderer.invoke(IPC.GENERATE_SPEC, { description }),
  generateFiles: (req: { loader: string; mcVersion: string; spec: unknown; generatorType: 'mod' | 'datapack' | 'modpack' }) =>
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
};

try {
  contextBridge.exposeInMainWorld('mcApi', api);
} catch {
  // 测试环境无 contextBridge，挂到 globalThis
  (globalThis as any).mcApi = api;
}

export type McApi = typeof api;
