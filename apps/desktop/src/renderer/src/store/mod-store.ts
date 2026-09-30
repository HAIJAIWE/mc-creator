import { createWithEqualityFn } from 'zustand/traditional';
import { persist } from 'zustand/middleware';
import {
  ModSpec,
  type Loader,
  type McVersion,
  type FileNode,
  type ItemSpec,
} from '@mc-creator/shared';
import type { GeneratorType } from '../../../shared/ipc-channels.js';
import { useSpecHistoryStore } from './spec-history-store.js';
import { resolveUiStorage } from './persist-storage.js';
import { mergeGeneratedFiles } from '../lib/mergeGeneratedFiles.js';

interface ModState {
  // 输入
  loader: Loader;
  mcVersion: McVersion;
  description: string;
  generatorType: GeneratorType;
  // 产出
  spec: ModSpec | null;
  files: FileNode[];
  previousFiles: FileNode[];
  selectedFile: string | null;
  /** 未实现清单（Task 1.1：产物含 MC-Creator unsupported 占位时由 generate 写入，预览横幅+导出清单消费） */
  unimplemented: Array<{ kind: string; type: string; id: string; reason: string }>;
  setUnimplemented: (u: Array<{ kind: string; type: string; id: string; reason: string }>) => void;
  /** 增量构建缓存统计（Phase 3.2：GENERATE_FILES 透传 buildStats，前端展示命中情况） */
  buildStats: {
    total: number;
    cached: number;
    regenerated: number;
    filesTotal: number;
    filesUnchanged: number;
  } | null;
  setBuildStats: (s: ModState['buildStats']) => void;
  // 已打开的标签页路径列表（有序，去重）
  openTabs: string[];
  // 分栏编辑：右侧面板选中的文件路径（null 表示未分栏）
  splitFile: string | null;
  // 脏文件路径集合（已修改未保存）
  dirtyFiles: Set<string>;
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
  /** 应用生成文件（节点图「编译并应用」）：与现有 files 合并、保护手改，返回被保留的手改 path */
  applyGeneratedFiles: (generated: FileNode[]) => string[];
  selectFile: (p: string) => void;
  closeFile: (p: string) => void;
  closeTab: (p: string) => void;
  closeOtherTabs: (keepPath: string) => void;
  closeAllTabs: () => void;
  setSplitFile: (path: string | null) => void;
  setBuildResult: (r: { success: boolean; log: string; jarPath: string | null }) => void;
  setLoading: (b: boolean) => void;
  setError: (e: string | null) => void;
  clearPreviousFiles: () => void;
  // 文件 CRUD（可编辑 IDE）
  updateFileContent: (path: string, content: string) => void;
  createFile: (path: string, content?: string) => void;
  deleteFile: (path: string) => void;
  renameFile: (oldPath: string, newPath: string) => void;
  markFileClean: (path: string) => void;
  markAllClean: () => void;
  // 方块 / 物品编辑器
  addItem: (item: ItemSpec) => void;
  removeItem: (id: string) => void;
}

export const useModStore = createWithEqualityFn<ModState>()(
  persist(
    (set, get) => ({
      loader: 'fabric',
      mcVersion: '1.21.11',
      description: '',
      generatorType: 'mod',
      spec: null,
      files: [],
      previousFiles: [],
      selectedFile: null,
      unimplemented: [],
      setUnimplemented: (u) => set({ unimplemented: u }),
      buildStats: null,
      setBuildStats: (s) => set({ buildStats: s }),
      openTabs: [],
      splitFile: null,
      dirtyFiles: new Set<string>(),
      buildLog: '',
      buildSuccess: null,
      jarPath: null,
      loading: false,
      error: null,
      fixLog: [],
      setFixLog: (logs) => set({ fixLog: logs }),

      setLoader: (l) => set({ loader: l }),
      setMcVersion: (v) => set({ mcVersion: v }),
      setGeneratorType: (t) =>
        set((state) => {
          // 切换生成器类型 = 开启新任务：清空旧类型的描述/spec/文件等残留，
          // 避免中间面板按新类型渲染旧结构 spec 导致崩溃或错误数据
          if (state.generatorType === t) return {};
          return {
            generatorType: t,
            description: '',
            spec: null,
            files: [],
            previousFiles: [],
            selectedFile: null,
            unimplemented: [],
            buildStats: null,
            openTabs: [],
            splitFile: null,
            dirtyFiles: new Set<string>(),
            buildLog: '',
            buildSuccess: null,
            jarPath: null,
            error: null,
            loading: false,
          };
        }),
      setDescription: (d) => set({ description: d }),
      setSpec: (s) => {
        set({ spec: s });
        // 非 null 时记录到历史（用 getState 避免循环依赖；null 表示清空，不记录）
        if (s !== null) {
          const state = get();
          useSpecHistoryStore.getState().pushVersion({
            spec: s,
            description: state.description,
            generatorType: state.generatorType,
          });
        }
      },
      setFiles: (f) =>
        // 新文件列表意味着所有内容都是干净的（来自生成器，未修改）
        // 保留仍在文件列表中的旧 tab，追加新增文件的 tab（避免重新生成时丢失用户手动关闭的 tab）
        set((state) => {
          const newPaths = new Set(f.map((file) => file.path));
          const preservedTabs = state.openTabs.filter((t) => newPaths.has(t));
          const addedPaths = f
            .filter((file) => !state.openTabs.includes(file.path))
            .map((file) => file.path);
          const openTabs = [...preservedTabs, ...addedPaths];
          const selectedFile =
            state.selectedFile && newPaths.has(state.selectedFile)
              ? state.selectedFile
              : (f[0]?.path ?? null);
          return {
            previousFiles: state.files.length > 0 ? [...state.files] : state.previousFiles,
            files: f,
            selectedFile,
            openTabs,
            dirtyFiles: new Set<string>(),
          };
        }),
      // 节点图「编译并应用」：新生成文件与现有 files 合并（保护 dirty 手改），
      // 复用 setFiles 的 tab/selectedFile 保留逻辑；返回被保留的手改 path 供 UI 提示
      applyGeneratedFiles: (generated) => {
        const state = get();
        const { files, preserved } = mergeGeneratedFiles(generated, state.files, state.dirtyFiles);
        get().setFiles(files);
        return preserved;
      },
      selectFile: (p) =>
        set((state) => {
          // 如果该文件尚未在 openTabs 中，追加到末尾
          if (!state.openTabs.includes(p)) {
            return { selectedFile: p, openTabs: [...state.openTabs, p] };
          }
          return { selectedFile: p };
        }),
      closeFile: (p) =>
        set((state) => {
          const files = state.files.filter((f) => f.path !== p);
          const openTabs = state.openTabs.filter((t) => t !== p);
          let selectedFile = state.selectedFile;
          if (selectedFile === p) {
            // 切换到相邻标签页
            const idx = state.openTabs.indexOf(p);
            selectedFile = openTabs[Math.min(idx, openTabs.length - 1)] ?? null;
          }
          return { files, openTabs, selectedFile };
        }),
      // 关闭标签页（不删除文件本身，仅从 tab 栏移除）
      closeTab: (p) =>
        set((state) => {
          const openTabs = state.openTabs.filter((t) => t !== p);
          let selectedFile = state.selectedFile;
          if (selectedFile === p) {
            const idx = state.openTabs.indexOf(p);
            selectedFile = openTabs[Math.min(idx, openTabs.length - 1)] ?? null;
          }
          return { openTabs, selectedFile };
        }),
      // 关闭除指定文件外的所有标签页
      closeOtherTabs: (keepPath) =>
        set((_state) => ({
          openTabs: [keepPath],
          selectedFile: keepPath,
        })),
      // 关闭所有标签页
      closeAllTabs: () => set({ openTabs: [], selectedFile: null }),
      // 分栏编辑：设置右侧面板文件
      setSplitFile: (path) => set({ splitFile: path }),
      setBuildResult: (r) => set({ buildSuccess: r.success, buildLog: r.log, jarPath: r.jarPath }),
      setLoading: (b) => set({ loading: b }),
      setError: (e) => set({ error: e }),
      clearPreviousFiles: () => set({ previousFiles: [] }),
      // === 文件 CRUD（可编辑 IDE） ===
      updateFileContent: (path, content) =>
        set((state) => {
          const files = state.files.map((f) => (f.path === path ? { ...f, content } : f));
          // 用 new Set 重建保证引用变化，让 shallow 选择器感知
          const dirtyFiles = new Set(state.dirtyFiles);
          dirtyFiles.add(path);
          return { files, dirtyFiles };
        }),
      createFile: (path, content = '') =>
        set((state) => {
          // 已存在则忽略
          if (state.files.some((f) => f.path === path)) return {};
          const newFile: FileNode = { path, content };
          const files = [...state.files, newFile];
          const dirtyFiles = new Set(state.dirtyFiles);
          dirtyFiles.add(path);
          // 新文件自动打开标签页
          const openTabs = [...state.openTabs, path];
          return { files, dirtyFiles, selectedFile: path, openTabs };
        }),
      deleteFile: (path) =>
        set((state) => {
          const files = state.files.filter((f) => f.path !== path);
          const dirtyFiles = new Set(state.dirtyFiles);
          dirtyFiles.delete(path);
          const openTabs = state.openTabs.filter((t) => t !== path);
          let selectedFile = state.selectedFile;
          if (selectedFile === path) {
            const idx = state.openTabs.indexOf(path);
            selectedFile = openTabs[Math.min(idx, openTabs.length - 1)] ?? null;
          }
          return { files, dirtyFiles, openTabs, selectedFile };
        }),
      renameFile: (oldPath, newPath) =>
        set((state) => {
          if (!state.files.some((f) => f.path === oldPath)) return {};
          const files = state.files.map((f) => (f.path === oldPath ? { ...f, path: newPath } : f));
          const dirtyFiles = new Set(state.dirtyFiles);
          if (dirtyFiles.has(oldPath)) {
            dirtyFiles.delete(oldPath);
            dirtyFiles.add(newPath);
          }
          const openTabs = state.openTabs.map((t) => (t === oldPath ? newPath : t));
          const selectedFile = state.selectedFile === oldPath ? newPath : state.selectedFile;
          // L-8 修复：同步更新分栏路径，避免右侧分栏编辑器指向已失效的旧路径
          const splitFile = state.splitFile === oldPath ? newPath : state.splitFile;
          return { files, dirtyFiles, openTabs, selectedFile, splitFile };
        }),
      markFileClean: (path) =>
        set((state) => {
          if (!state.dirtyFiles.has(path)) return {};
          const dirtyFiles = new Set(state.dirtyFiles);
          dirtyFiles.delete(path);
          return { dirtyFiles };
        }),
      markAllClean: () => set({ dirtyFiles: new Set<string>() }),
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
    }),
    {
      name: 'mc-creator-ui-state',
      version: 1,
      storage: resolveUiStorage(),
      // 只持久化输入偏好；产出（spec/files）不持久化，避免旧类型数据在启动时被恢复
      partialize: (s) => ({
        generatorType: s.generatorType,
        loader: s.loader,
        mcVersion: s.mcVersion,
      }),
    },
  ),
);
