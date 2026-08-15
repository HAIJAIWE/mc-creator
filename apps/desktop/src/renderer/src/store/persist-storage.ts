import { createJSONStorage, type PersistStorage, type StorageValue } from 'zustand/middleware';

/**
 * 持久化存储：浏览器用 localStorage；无 localStorage 的环境（node 测试、
 * SSR 等）回退到进程内内存存储，避免 createJSONStorage 在模块加载时抛错。
 * 供各 zustand store 的 persist 中间件复用。
 */
export function resolveUiStorage(): PersistStorage<unknown> {
  try {
    const storage = (globalThis as { localStorage?: Storage }).localStorage;
    if (storage) {
      const json = createJSONStorage(() => storage);
      if (json) return json;
    }
  } catch {
    // fallthrough
  }
  const mem = new Map<string, StorageValue<unknown>>();
  return {
    getItem: (name) => mem.get(name) ?? null,
    setItem: (name, value) => void mem.set(name, value),
    removeItem: (name) => void mem.delete(name),
  } satisfies PersistStorage<unknown>;
}
