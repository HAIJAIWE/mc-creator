import { create } from 'zustand';
import type { ModSpec, Loader, McVersion, FileNode } from '@mc-creator/shared';

interface ModState {
  // 输入
  loader: Loader;
  mcVersion: McVersion;
  description: string;
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

  setLoader: (l: Loader) => void;
  setMcVersion: (v: McVersion) => void;
  setDescription: (d: string) => void;
  setSpec: (s: ModSpec | null) => void;
  setFiles: (f: FileNode[]) => void;
  selectFile: (p: string) => void;
  setBuildResult: (r: { success: boolean; log: string; jarPath: string | null }) => void;
  setLoading: (b: boolean) => void;
  setError: (e: string | null) => void;
}

export const useModStore = create<ModState>((set) => ({
  loader: 'fabric',
  mcVersion: '1.21.11',
  description: '',
  spec: null,
  files: [],
  selectedFile: null,
  buildLog: '',
  buildSuccess: null,
  jarPath: null,
  loading: false,
  error: null,

  setLoader: (l) => set({ loader: l }),
  setMcVersion: (v) => set({ mcVersion: v }),
  setDescription: (d) => set({ description: d }),
  setSpec: (s) => set({ spec: s }),
  setFiles: (f) => set({ files: f, selectedFile: f[0]?.path ?? null }),
  selectFile: (p) => set({ selectedFile: p }),
  setBuildResult: (r) => set({ buildSuccess: r.success, buildLog: r.log, jarPath: r.jarPath }),
  setLoading: (b) => set({ loading: b }),
  setError: (e) => set({ error: e }),
}));
