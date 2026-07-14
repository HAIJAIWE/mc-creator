import { create } from 'zustand';
import type { ModSpec, Loader, McVersion } from '@mc-creator/shared';
import { ipcClient } from '../lib/ipc-client.js';
import { useModStore } from './mod-store.js';
import type { GeneratorType, Project } from '../../../shared/ipc-channels.js';

interface SaveProjectData {
  generatorType: GeneratorType;
  loader: 'fabric' | 'neoforge';
  mcVersion: string;
  description: string;
  spec: unknown;
  files: { path: string; content: string }[];
}

interface ProjectState {
  projects: Project[];
  loading: boolean;
  error: string | null;
  /** 视图状态：'dashboard' | 'editor' */
  view: 'dashboard' | 'editor';
  currentProjectId: string | null;

  loadProjects: () => Promise<void>;
  saveCurrentAsProject: (name: string, data: SaveProjectData) => Promise<void>;
  loadProject: (id: string) => Promise<void>;
  deleteProject: (id: string) => Promise<void>;
  setView: (v: 'dashboard' | 'editor') => void;
  backToDashboard: () => void;
}

/** 生成 UUID（优先用 crypto.randomUUID，否则 fallback） */
function genId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch {
    // fallback
  }
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  projects: [],
  loading: false,
  error: null,
  view: 'dashboard',
  currentProjectId: null,

  loadProjects: async () => {
    set({ loading: true, error: null });
    try {
      const projects = await ipcClient.listProjects();
      set({ projects, loading: false });
    } catch (e) {
      set({ error: (e as Error).message, loading: false });
    }
  },

  saveCurrentAsProject: async (name, data) => {
    set({ loading: true, error: null });
    try {
      const now = new Date().toISOString();
      const project: Project = {
        id: genId(),
        name,
        generatorType: data.generatorType,
        loader: data.loader,
        mcVersion: data.mcVersion,
        description: data.description,
        spec: data.spec as Record<string, unknown>,
        files: data.files,
        createdAt: now,
        updatedAt: now,
      };
      await ipcClient.saveProject(project);
      await get().loadProjects();
    } catch (e) {
      set({ error: (e as Error).message, loading: false });
    }
  },

  loadProject: async (id) => {
    set({ loading: true, error: null });
    try {
      const project = await ipcClient.getProject(id);
      if (!project) {
        set({ error: '项目不存在', loading: false });
        return;
      }
      // 把项目数据填入 mod-store
      const mod = useModStore.getState();
      mod.setGeneratorType(project.generatorType);
      mod.setLoader(project.loader as Loader);
      mod.setMcVersion(project.mcVersion as McVersion);
      mod.setDescription(project.description);
      mod.setSpec(project.spec as unknown as ModSpec);
      mod.setFiles(project.files);
      set({ currentProjectId: id, view: 'editor', loading: false });
    } catch (e) {
      set({ error: (e as Error).message, loading: false });
    }
  },

  deleteProject: async (id) => {
    set({ loading: true, error: null });
    try {
      await ipcClient.deleteProject(id);
      await get().loadProjects();
    } catch (e) {
      set({ error: (e as Error).message, loading: false });
    }
  },

  setView: (v) => set({ view: v }),

  backToDashboard: () => set({ view: 'dashboard', currentProjectId: null }),
}));
