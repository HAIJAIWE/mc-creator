import { createWithEqualityFn } from 'zustand/traditional';
import { persist } from 'zustand/middleware';
import {
  ModSpec,
  type Loader,
  type McVersion,
  type FileNode,
  type ItemSpec,
  type BlockSpec,
} from '@mc-creator/shared';
import type { GeneratorType } from '../../../shared/ipc-channels.js';
import { useSpecHistoryStore } from './spec-history-store.js';
import { resolveUiStorage } from './persist-storage.js';
import { mergeGeneratedFiles } from '../lib/mergeGeneratedFiles.js';
import { ipcClient } from '../lib/ipc-client.js';
import { useProjectStore } from './project-store.js';

/** 文件元数据（用于冲突检测，与主进程 FileMeta 对齐） */
export interface FileMeta {
  mtime: number;
  size: number;
  hash: string;
}

/** 文件冲突错误（渲染侧） */
export class FileConflictError extends Error {
  public readonly serverMeta: FileMeta;
  public readonly localMeta: FileMeta | null;
  public readonly path: string;

  constructor(path: string, serverMeta: FileMeta, localMeta: FileMeta | null) {
    const localDesc = localMeta
      ? `local: mtime=${localMeta.mtime}, size=${localMeta.size}, hash=${localMeta.hash.slice(0, 8)}`
      : 'local: (file not found)';
    super(
      `File conflict at "${path}": server: mtime=${serverMeta.mtime}, size=${serverMeta.size}, hash=${serverMeta.hash.slice(0, 8)}; ${localDesc}`,
    );
    this.name = 'FileConflictError';
    this.path = path;
    this.serverMeta = serverMeta;
    this.localMeta = localMeta;
  }
}

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
  // 文件元数据缓存（用于冲突检测，持久化到 localStorage）
  lastKnownMeta: Record<string, FileMeta>;
  // 构建
  buildLog: string;
  buildSuccess: boolean | null;
  jarPath: string | null;
  sha256: string | null;
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
  setBuildResult: (r: {
    success: boolean;
    log: string;
    jarPath: string | null;
    sha256?: string | null;
  }) => void;
  setLoading: (b: boolean) => void;
  setError: (e: string | null) => void;
  clearPreviousFiles: () => void;
  // 文件 CRUD（可编辑 IDE）
  /** 获取当前项目 ID（内部使用） */
  _getProjectId: () => string | null;
  /** 更新文件内容（带冲突检测）：返回 { success: true } 或 { success: false, conflict: FileConflictError } */
  updateFileContent: (
    path: string,
    content: string,
  ) => Promise<{ success: true } | { success: false; conflict: FileConflictError }>;
  /** 创建文件（带冲突检测） */
  createFile: (
    path: string,
    content?: string,
  ) => Promise<{ success: true } | { success: false; conflict: FileConflictError }>;
  /** 强制写入文件（跳过冲突检测，用于用户选择"强制覆盖"后） */
  forceWriteFile: (path: string, content: string) => Promise<void>;
  deleteFile: (path: string) => void;
  renameFile: (oldPath: string, newPath: string) => void;
  markFileClean: (path: string) => void;
  markAllClean: () => void;
  // 文件元数据管理
  /** 刷新指定文件的元数据缓存 */
  refreshFileMeta: (path: string) => Promise<void>;
  /** 获取文件的缓存元数据 */
  getFileMeta: (path: string) => FileMeta | undefined;
  /** 批量加载文件元数据（项目打开时调用） */
  loadFilesMeta: (paths: string[]) => Promise<void>;
  /** 读取服务器版本文件内容（用于冲突差异对比） */
  readServerFileContent: (path: string) => Promise<string | null>;
  // 方块 / 物品编辑器
  addItem: (item: ItemSpec) => void;
  /** 合并补丁到指定物品（id 字段被锁定：改 id 请走 renameItemId，保证配方引用同步） */
  updateItem: (id: string, patch: Partial<ItemSpec>) => void;
  removeItem: (id: string) => void;
  /** 改物品 id，并同步 spec.recipes 的 result/ingredient 引用与 blocks.dropItem */
  renameItemId: (oldId: string, newId: string) => void;
  addBlock: (block: BlockSpec) => void;
  /** 合并补丁到指定方块（id 字段被锁定：改 id 请走 renameBlockId） */
  updateBlock: (id: string, patch: Partial<BlockSpec>) => void;
  removeBlock: (id: string) => void;
  /** 改方块 id，并同步 spec.recipes 的 result/ingredient 引用 */
  renameBlockId: (oldId: string, newId: string) => void;
  // 冲突差异对话框
  conflictDialog: {
    isOpen: boolean;
    filePath: string;
    serverContent: string;
    localContent: string;
  } | null;
  /** 打开冲突差异对话框 */
  openConflictDiff: (path: string, serverContent: string, localContent: string) => void;
  /** 关闭冲突差异对话框 */
  closeConflictDiff: () => void;
}

/**
 * 把补丁合并到条目：undefined 表示清空（仅限 clearable 列出的可选键，其余忽略），
 * 避免 exactOptionalPropertyTypes 下显式 undefined 污染必填字段。
 */
function applySpecPatch<T extends object>(
  entry: T,
  patch: Partial<T>,
  clearable: readonly string[],
): T {
  const next: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(entry)) next[k] = v;
  for (const [key, value] of Object.entries(patch)) {
    if (key === 'id') continue; // id 锁定，改名走 rename*Id
    if (value === undefined) {
      if (clearable.includes(key)) delete next[key];
    } else {
      next[key] = value;
    }
  }
  return next as T;
}

/** 物品/方块中允许清空的可选键（传 undefined 即删除该字段） */
const CLEARABLE_ITEM_KEYS = ['food', 'tool', 'armor', 'texturePath', 'customModelData'] as const;
const CLEARABLE_BLOCK_KEYS = ['texturePath', 'texturePaths', 'modelType'] as const;

/**
 * 改名时同步配方引用：output / inputs[].item / base / addition / ingredientItem，
 * 以及与旧 id 同名的 recipeId。无引用时原样返回，避免无意义的 spec 替换。
 */
function renameRecipeRefs(
  recipes: ModSpec['recipes'],
  oldId: string,
  newId: string,
): ModSpec['recipes'] {
  let changed = false;
  const next = recipes.map((r) => {
    let entryChanged = false;
    const inputs = r.inputs.map((inp) => {
      if (inp.item === oldId) {
        entryChanged = true;
        return { ...inp, item: newId };
      }
      return inp;
    });
    const patched = { ...r, inputs };
    if (r.output === oldId) {
      patched.output = newId;
      entryChanged = true;
    }
    if (r.base === oldId) {
      patched.base = newId;
      entryChanged = true;
    }
    if (r.addition === oldId) {
      patched.addition = newId;
      entryChanged = true;
    }
    if (r.ingredientItem === oldId) {
      patched.ingredientItem = newId;
      entryChanged = true;
    }
    if (r.recipeId === oldId) {
      patched.recipeId = newId;
      entryChanged = true;
    }
    if (entryChanged) changed = true;
    return entryChanged ? patched : r;
  });
  return changed ? next : recipes;
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
      lastKnownMeta: {},
      buildLog: '',
      buildSuccess: null,
      jarPath: null,
      sha256: null,
      loading: false,
      error: null,
      fixLog: [],
      setFixLog: (logs) => set({ fixLog: logs }),
      conflictDialog: null,
      openConflictDiff: (path, serverContent, localContent) =>
        set({
          conflictDialog: { isOpen: true, filePath: path, serverContent, localContent },
        }),
      closeConflictDiff: () => set({ conflictDialog: null }),

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
            lastKnownMeta: {},
            buildLog: '',
            buildSuccess: null,
            jarPath: null,
            sha256: null,
            error: null,
            loading: false,
            conflictDialog: null,
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
          // 清理不再存在的文件的元数据缓存
          const lastKnownMeta: Record<string, FileMeta> = {};
          for (const file of f) {
            if (state.lastKnownMeta[file.path]) {
              lastKnownMeta[file.path] = state.lastKnownMeta[file.path];
            }
          }
          return {
            previousFiles: state.files.length > 0 ? [...state.files] : state.previousFiles,
            files: f,
            selectedFile,
            openTabs,
            dirtyFiles: new Set<string>(),
            lastKnownMeta,
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
          // 保留元数据缓存（文件可能仍存在于磁盘）
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
      setBuildResult: (r) =>
        set({
          buildSuccess: r.success,
          buildLog: r.log,
          jarPath: r.jarPath,
          sha256: r.sha256 ?? null,
        }),
      setLoading: (b) => set({ loading: b }),
      setError: (e) => set({ error: e }),
      clearPreviousFiles: () => set({ previousFiles: [] }),
      // === 文件 CRUD（可编辑 IDE）===
      // 获取当前项目 ID（用于项目感知文件操作）
      _getProjectId: () => useProjectStore.getState().currentProjectId,

      // === 文件元数据管理 ===
      /** 刷新指定文件的元数据缓存（从磁盘读取） */
      refreshFileMeta: async (path: string) => {
        const projectId = useProjectStore.getState().currentProjectId;
        if (!projectId) return;
        try {
          const meta = await ipcClient.fileProjectGetFileMeta(projectId, path);
          if (meta) {
            set((state) => ({
              lastKnownMeta: { ...state.lastKnownMeta, [path]: meta },
            }));
          }
        } catch (e) {
          console.warn('[mod-store] Failed to refresh file meta:', e);
        }
      },
      /** 获取文件的缓存元数据 */
      getFileMeta: (path: string) => get().lastKnownMeta[path],

      /** 批量加载文件元数据（项目打开时调用） */
      loadFilesMeta: async (paths: string[]) => {
        const projectId = useProjectStore.getState().currentProjectId;
        if (!projectId) return;
        const newMeta: Record<string, FileMeta> = {};
        for (const path of paths) {
          try {
            const meta = await ipcClient.fileProjectGetFileMeta(projectId, path);
            if (meta) {
              newMeta[path] = meta;
            }
          } catch (e) {
            console.warn(`[mod-store] Failed to load meta for ${path}:`, e);
          }
        }
        if (Object.keys(newMeta).length > 0) {
          set((state) => ({
            lastKnownMeta: { ...state.lastKnownMeta, ...newMeta },
          }));
        }
      },

      /** 读取服务器版本文件内容（用于冲突差异对比） */
      readServerFileContent: async (path: string): Promise<string | null> => {
        const projectId = useProjectStore.getState().currentProjectId;
        if (!projectId) return null;
        try {
          return await ipcClient.fileProjectReadText(projectId, path);
        } catch (e) {
          console.warn(`[mod-store] Failed to read server file content for ${path}:`, e);
          return null;
        }
      },

      // === 文件 CRUD（可编辑 IDE，带冲突检测）===
      /** 更新文件内容（带冲突检测）：返回 { success: true } 或 { success: false, conflict: FileConflictError } */
      updateFileContent: async (path, content) => {
        const state = get();
        const projectId = state._getProjectId();
        if (!projectId) {
          // 无项目时仅更新本地状态
          set((s) => {
            const files = s.files.map((f) => (f.path === path ? { ...f, content } : f));
            const dirtyFiles = new Set(s.dirtyFiles);
            dirtyFiles.add(path);
            return { files, dirtyFiles };
          });
          return { success: true as const };
        }

        // 获取当前缓存的元数据作为预期值
        const expectedMeta = state.lastKnownMeta[path];

        try {
          // 使用带元数据校验的写入
          const newMeta = await ipcClient.fileProjectWriteTextWithMeta(
            projectId,
            path,
            content,
            expectedMeta,
          );
          // 写入成功，更新本地状态和元数据缓存
          set((s) => {
            const files = s.files.map((f) => (f.path === path ? { ...f, content } : f));
            const dirtyFiles = new Set(s.dirtyFiles);
            dirtyFiles.add(path);
            const lastKnownMeta = { ...s.lastKnownMeta, [path]: newMeta };
            return { files, dirtyFiles, lastKnownMeta };
          });
          return { success: true as const };
        } catch (raw) {
          const e = raw as { conflict?: true; serverMeta: FileMeta; localMeta?: FileMeta | null };
          // 处理冲突错误
          if (e?.conflict && e?.serverMeta) {
            const conflict = new FileConflictError(
              path,
              e.serverMeta,
              e.localMeta ?? expectedMeta ?? null,
            );
            // 更新缓存为服务端最新元数据（便于后续强制覆盖）
            set((s) => ({
              lastKnownMeta: { ...s.lastKnownMeta, [path]: e.serverMeta },
            }));
            return { success: false as const, conflict };
          }
          // 其他错误
          console.warn('[mod-store] Failed to update file:', e);
          return {
            success: false as const,
            conflict: new FileConflictError(path, { mtime: 0, size: 0, hash: '' }, null),
          };
        }
      },

      /** 创建文件（带冲突检测） */
      createFile: async (path, content = '') => {
        const state = get();
        // 已存在则忽略
        if (state.files.some((f) => f.path === path)) return { success: true as const };

        const projectId = state._getProjectId();
        if (!projectId) {
          // 无项目时仅更新本地状态
          set((s) => {
            const newFile: FileNode = { path, content };
            const files = [...s.files, newFile];
            const dirtyFiles = new Set(s.dirtyFiles);
            dirtyFiles.add(path);
            const openTabs = [...s.openTabs, path];
            return { files, dirtyFiles, selectedFile: path, openTabs };
          });
          return { success: true as const };
        }

        // 新文件预期不存在，传入空文件 meta 作为预期
        const expectedMeta: FileMeta = {
          mtime: 0,
          size: 0,
          hash: 'd41d8cd98f00b204e9800998ecf8427e',
        };

        try {
          const newMeta = await ipcClient.fileProjectWriteTextWithMeta(
            projectId,
            path,
            content,
            expectedMeta,
          );
          set((s) => {
            const newFile: FileNode = { path, content };
            const files = [...s.files, newFile];
            const dirtyFiles = new Set(s.dirtyFiles);
            dirtyFiles.add(path);
            const openTabs = [...s.openTabs, path];
            const lastKnownMeta = { ...s.lastKnownMeta, [path]: newMeta };
            return { files, dirtyFiles, selectedFile: path, openTabs, lastKnownMeta };
          });
          return { success: true as const };
        } catch (raw) {
          const e = raw as { conflict?: true; serverMeta: FileMeta; localMeta?: FileMeta | null };
          if (e?.conflict && e?.serverMeta) {
            const conflict = new FileConflictError(path, e.serverMeta, e.localMeta ?? expectedMeta);
            set((s) => ({
              lastKnownMeta: { ...s.lastKnownMeta, [path]: e.serverMeta },
            }));
            return { success: false as const, conflict };
          }
          console.warn('[mod-store] Failed to create file:', e);
          return {
            success: false as const,
            conflict: new FileConflictError(path, { mtime: 0, size: 0, hash: '' }, null),
          };
        }
      },

      /** 强制写入文件（跳过冲突检测，用于用户选择"强制覆盖"后） */
      forceWriteFile: async (path, content) => {
        const state = get();
        const projectId = state._getProjectId();
        if (!projectId) {
          set((s) => {
            const files = s.files.map((f) => (f.path === path ? { ...f, content } : f));
            const dirtyFiles = new Set(s.dirtyFiles);
            dirtyFiles.add(path);
            return { files, dirtyFiles };
          });
          return;
        }

        try {
          // 不传 expectedMeta，跳过冲突检测
          const newMeta = await ipcClient.fileProjectWriteTextWithMeta(
            projectId,
            path,
            content,
            undefined,
          );
          set((s) => {
            const files = s.files.map((f) => (f.path === path ? { ...f, content } : f));
            const dirtyFiles = new Set(s.dirtyFiles);
            dirtyFiles.add(path);
            const lastKnownMeta = { ...s.lastKnownMeta, [path]: newMeta };
            return { files, dirtyFiles, lastKnownMeta };
          });
        } catch (e) {
          console.warn('[mod-store] Force write failed:', e);
          throw e;
        }
      },

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
          const lastKnownMeta = { ...state.lastKnownMeta };
          delete lastKnownMeta[path];
          // 持久化删除
          const projectId = useProjectStore.getState().currentProjectId;
          if (projectId) {
            ipcClient.fileProjectDeleteItem(projectId, path).catch((e: unknown) => {
              console.warn('[mod-store] Failed to delete file:', e);
            });
          }
          return { files, dirtyFiles, openTabs, selectedFile, lastKnownMeta };
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
          // 更新元数据缓存键
          const lastKnownMeta = { ...state.lastKnownMeta };
          if (lastKnownMeta[oldPath]) {
            lastKnownMeta[newPath] = lastKnownMeta[oldPath];
            delete lastKnownMeta[oldPath];
          }
          // 持久化重命名（先写新文件，再删旧文件）
          const projectId = useProjectStore.getState().currentProjectId;
          if (projectId) {
            const oldFile = state.files.find((f) => f.path === oldPath);
            if (oldFile) {
              ipcClient
                .fileProjectWriteText(projectId, newPath, oldFile.content)
                .catch((e: unknown) => {
                  console.warn('[mod-store] Failed to write renamed file:', e);
                });
            }
            ipcClient.fileProjectDeleteItem(projectId, oldPath).catch((e: unknown) => {
              console.warn('[mod-store] Failed to delete old file after rename:', e);
            });
          }
          return { files, dirtyFiles, openTabs, selectedFile, splitFile, lastKnownMeta };
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
      updateItem: (id, patch) =>
        set((state) => {
          const base = state.spec;
          if (!base || !base.items.some((i) => i.id === id)) return {};
          const items = base.items.map((i) =>
            i.id === id ? applySpecPatch(i, patch, CLEARABLE_ITEM_KEYS) : i,
          );
          return { spec: { ...base, items } };
        }),
      removeItem: (id) =>
        set((state) => {
          if (!state.spec) return {};
          return { spec: { ...state.spec, items: state.spec.items.filter((i) => i.id !== id) } };
        }),
      renameItemId: (oldId, newId) =>
        set((state) => {
          const base = state.spec;
          if (!base || oldId === newId) return {};
          if (!base.items.some((i) => i.id === oldId)) return {};
          if (base.items.some((i) => i.id === newId)) return {}; // 目标已存在：拒绝，调用方负责行内报错
          const items = base.items.map((i) => (i.id === oldId ? { ...i, id: newId } : i));
          const recipes = renameRecipeRefs(base.recipes ?? [], oldId, newId);
          const blocks = (base.blocks ?? []).map((b) =>
            b.dropItem === oldId ? { ...b, dropItem: newId } : b,
          );
          return { spec: { ...base, items, recipes, blocks } };
        }),
      addBlock: (block) =>
        set((state) => {
          const base = state.spec ?? ModSpec.parse({ modId: 'mc_creator', name: 'My Mod' });
          const blocks = [...base.blocks.filter((b) => b.id !== block.id), block];
          return { spec: { ...base, blocks } };
        }),
      updateBlock: (id, patch) =>
        set((state) => {
          const base = state.spec;
          if (!base || !base.blocks.some((b) => b.id === id)) return {};
          const blocks = base.blocks.map((b) =>
            b.id === id ? applySpecPatch(b, patch, CLEARABLE_BLOCK_KEYS) : b,
          );
          return { spec: { ...base, blocks } };
        }),
      removeBlock: (id) =>
        set((state) => {
          if (!state.spec) return {};
          return { spec: { ...state.spec, blocks: state.spec.blocks.filter((b) => b.id !== id) } };
        }),
      renameBlockId: (oldId, newId) =>
        set((state) => {
          const base = state.spec;
          if (!base || oldId === newId) return {};
          if (!base.blocks.some((b) => b.id === oldId)) return {};
          if (base.blocks.some((b) => b.id === newId)) return {}; // 目标已存在：拒绝，调用方负责行内报错
          const blocks = base.blocks.map((b) => (b.id === oldId ? { ...b, id: newId } : b));
          const recipes = renameRecipeRefs(base.recipes ?? [], oldId, newId);
          return { spec: { ...base, blocks, recipes } };
        }),
    }),
    {
      name: 'mc-creator-ui-state',
      version: 2, // version bump for lastKnownMeta persistence
      storage: resolveUiStorage(),
      // 持久化输入偏好 + 文件元数据缓存（用于冲突检测）
      partialize: (s) => ({
        generatorType: s.generatorType,
        loader: s.loader,
        mcVersion: s.mcVersion,
        lastKnownMeta: s.lastKnownMeta,
      }),
    },
  ),
);
