import { contextBridge, ipcRenderer } from 'electron';
import { IPC, LOAD_MODEL_CONFIG, SAVE_MODEL_CONFIG, CHAT } from '../shared/ipc-channels.js';

const api = {
  generateSpec: (description: string) => ipcRenderer.invoke(IPC.GENERATE_SPEC, { description }),
  generateFiles: (req: { loader: string; mcVersion: string; spec: unknown }) =>
    ipcRenderer.invoke(IPC.GENERATE_FILES, req),
  build: (projectPath: string) => ipcRenderer.invoke(IPC.BUILD, { projectPath }),
  loadModelConfig: () => ipcRenderer.invoke(LOAD_MODEL_CONFIG),
  saveModelConfig: (config: unknown) => ipcRenderer.invoke(SAVE_MODEL_CONFIG, config),
  chat: (message: string) => ipcRenderer.invoke(CHAT, { message }),
};

try {
  contextBridge.exposeInMainWorld('mcApi', api);
} catch {
  // 测试环境无 contextBridge，挂到 globalThis
  (globalThis as any).mcApi = api;
}

export type McApi = typeof api;
