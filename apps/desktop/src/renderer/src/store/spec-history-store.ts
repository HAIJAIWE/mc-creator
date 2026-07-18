import { create } from 'zustand';

export interface SpecVersion {
  id: string; // 唯一 ID（用 timestamp + random）
  timestamp: number; // 创建时间戳
  label: string; // 显示标签（如 "v3 · 14:32:05"）
  spec: unknown; // Spec 快照（任意类型的 Spec）
  description: string; // 当时的用户描述（用于区分版本）
  generatorType: string; // 当时的生成器类型
}

interface SpecHistoryState {
  versions: SpecVersion[];
  currentIndex: number; // 当前激活的版本索引（-1 表示不在历史中）
  maxHistory: number; // 最多保留版本数（默认 20）

  /** 记录一个新版本（在 setSpec 时调用） */
  pushVersion: (version: Omit<SpecVersion, 'id' | 'timestamp' | 'label'>) => void;
  /** 回滚到指定版本（返回该版本的 spec） */
  rollbackTo: (id: string) => unknown | null;
  /** 清空所有历史 */
  clearHistory: () => void;
  /** 删除指定版本 */
  removeVersion: (id: string) => void;
}

export const useSpecHistoryStore = create<SpecHistoryState>((set, get) => ({
  versions: [],
  currentIndex: -1,
  maxHistory: 20,

  pushVersion: (version) =>
    set((state) => {
      const now = Date.now();
      const date = new Date(now);
      const label = `v${state.versions.length + 1} · ${date
        .getHours()
        .toString()
        .padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}:${date
        .getSeconds()
        .toString()
        .padStart(2, '0')}`;
      const newVersion: SpecVersion = {
        ...version,
        id: `${now}-${Math.random().toString(36).slice(2, 8)}`,
        timestamp: now,
        label,
      };
      const versions = [...state.versions, newVersion].slice(-state.maxHistory);
      return { versions, currentIndex: versions.length - 1 };
    }),

  rollbackTo: (id) => {
    const { versions } = get();
    const idx = versions.findIndex((v) => v.id === id);
    if (idx === -1) return null;
    set({ currentIndex: idx });
    return versions[idx].spec;
  },

  clearHistory: () => set({ versions: [], currentIndex: -1 }),

  removeVersion: (id) =>
    set((state) => {
      const versions = state.versions.filter((v) => v.id !== id);
      return { versions, currentIndex: Math.min(state.currentIndex, versions.length - 1) };
    }),
}));
