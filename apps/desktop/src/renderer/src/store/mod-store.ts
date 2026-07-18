import { create } from 'zustand';
import {
  ModSpec,
  type Loader,
  type McVersion,
  type FileNode,
  type ItemSpec,
} from '@mc-creator/shared';
import type { GeneratorType } from '../../../shared/ipc-channels.js';

interface ModState {
  // 输入
  loader: Loader;
  mcVersion: McVersion;
  description: string;
  generatorType: GeneratorType;
  // 产出
  spec: ModSpec | null;
  files: FileNode[];
  selectedFile: string | null;
  // 构建
  buildLog: string;
  buildSuccess: boolean | null;
  jarPath: string | null;
  loading: boolean;
  error: string | null;
  fixLog: string[];
  setFixLog: (logs: string[]) => void;

  setLoader: (l: Loader) => void;
  setMcVersion: (v: McVersion) => void;
  setGeneratorType: (t: GeneratorType) => void;
  setDescription: (d: string) => void;
  setSpec: (s: ModSpec | null) => void;
  setFiles: (f: FileNode[]) => void;
  selectFile: (p: string) => void;
  closeFile: (p: string) => void;
  setBuildResult: (r: { success: boolean; log: string; jarPath: string | null }) => void;
  setLoading: (b: boolean) => void;
  setError: (e: string | null) => void;
  // 方块 / 物品编辑器
  addItem: (item: ItemSpec) => void;
  removeItem: (id: string) => void;
}

export const useModStore = create<ModState>((set) => ({
  loader: 'fabric',
  mcVersion: '1.21.11',
  description: '',
  generatorType: 'mod',
  spec: null,
  files: [],
  selectedFile: null,
  buildLog: '',
  buildSuccess: null,
  jarPath: null,
  loading: false,
  error: null,
  fixLog: [],
  setFixLog: (logs) => set({ fixLog: logs }),

  setLoader: (l) => set({ loader: l }),
  setMcVersion: (v) => set({ mcVersion: v }),
  setGeneratorType: (t) => set({ generatorType: t }),
  setDescription: (d) => set({ description: d }),
  setSpec: (s) => set({ spec: s }),
  setFiles: (f) => set({ files: f, selectedFile: f[0]?.path ?? null }),
  selectFile: (p) => set({ selectedFile: p }),
  closeFile: (p) =>
    set((state) => ({
      files: state.files.filter((f) => f.path !== p),
      selectedFile:
        state.selectedFile === p
          ? (state.files.find((f) => f.path !== p)?.path ?? null)
          : state.selectedFile,
    })),
  setBuildResult: (r) => set({ buildSuccess: r.success, buildLog: r.log, jarPath: r.jarPath }),
  setLoading: (b) => set({ loading: b }),
  setError: (e) => set({ error: e }),
  addItem: (item) =>
    set((state) => {
      const base = state.spec ?? ModSpec.parse({ modId: 'mc_creator', name: 'My Mod' });
      const items = [...base.items.filter((i) => i.id !== item.id), item];
      return { spec: { ...base, items } };
    }),
  removeItem: (id) =>
    set((state) => {
      if (!state.spec) return {};
      return { spec: { ...state.spec, items: state.spec.items.filter((i) => i.id !== id) } };
    }),
}));
