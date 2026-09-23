import { contextBridge, ipcRenderer } from 'electron';

/**
 * 沙箱化 Mustache 渲染 API
 *
 * 使用 isolated-vm 在主进程中创建隔离沙箱，渲染用户提供的 Mustache 模板。
 * 防止恶意模板执行任意代码、原型污染、ReDoS 等攻击。
 */

export interface SandboxedMustacheApi {
  renderMustache: (
    template: string,
    fields: Record<string, unknown>,
  ) => Promise<
    | {
        ok: true;
        result: string;
      }
    | {
        ok: false;
        error: string;
      }
  >;
}

const sandboxedMustacheApi: SandboxedMustacheApi = {
  async renderMustache(template: string, fields: Record<string, unknown>) {
    return ipcRenderer.invoke('SANDBOXED_MUSTACHE_RENDER', { template, fields });
  },
};

try {
  contextBridge.exposeInMainWorld('sandboxedMustache', sandboxedMustacheApi);
} catch {
  // 测试环境无 contextBridge
  (globalThis as { sandboxedMustache?: typeof sandboxedMustacheApi }).sandboxedMustache =
    sandboxedMustacheApi;
}

export { sandboxedMustacheApi };
export type SandboxedMustacheApiType = typeof sandboxedMustacheApi;
