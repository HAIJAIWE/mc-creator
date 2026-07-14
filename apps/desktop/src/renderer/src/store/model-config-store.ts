import { create } from 'zustand';

interface ModelConfigState {
  name: string;
  modelId: string;
  baseURL: string;
  apiKey: string;
  loaded: boolean;

  setConfig: (c: { name: string; modelId: string; baseURL: string; apiKey: string }) => void;
  setLoaded: (b: boolean) => void;
}

export const useModelConfigStore = create<ModelConfigState>((set) => ({
  name: '',
  modelId: '',
  baseURL: '',
  apiKey: '',
  loaded: false,

  setConfig: (c) => set({ ...c, loaded: true }),
  setLoaded: (b) => set({ loaded: b }),
}));
