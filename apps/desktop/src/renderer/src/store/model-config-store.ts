import { createWithEqualityFn } from 'zustand/traditional';
import type { ModelProfile } from '../../../shared/ipc-channels.js';

interface ModelConfigState {
  /** 当前生效配置（active profile 的展开） */
  name: string;
  modelId: string;
  baseURL: string;
  apiKey: string;
  loaded: boolean;
  /** 全部配置（多套并存） */
  profiles: ModelProfile[];
  activeId: string | null;

  setConfig: (c: { name: string; modelId: string; baseURL: string; apiKey: string }) => void;
  setLoaded: (b: boolean) => void;
  /** 同步多配置列表，并刷新当前生效配置 */
  setProfiles: (profiles: ModelProfile[], activeId: string | null) => void;
}

export const useModelConfigStore = createWithEqualityFn<ModelConfigState>((set, get) => ({
  name: '',
  modelId: '',
  baseURL: '',
  apiKey: '',
  loaded: false,
  profiles: [],
  activeId: null,

  setConfig: (c) => set({ ...c, loaded: true }),
  setLoaded: (b) => set({ loaded: b }),
  setProfiles: (profiles, activeId) => {
    const active = profiles.find((p) => p.id === activeId) ?? profiles[0] ?? null;
    set({
      profiles,
      activeId: active ? active.id : null,
      name: active?.name ?? '',
      modelId: active?.modelId ?? '',
      baseURL: active?.baseURL ?? '',
      apiKey: active?.apiKey ?? '',
      loaded: true,
    });
  },
}));
