import { useEffect, useState, useMemo } from 'react';
import { useProjectStore } from '../store/project-store.js';
import { useModStore } from '../store/mod-store.js';
import { useToast } from './ToastProvider.js';
import type { Project, GeneratorType } from '../../../shared/ipc-channels.js';
import {
  Plus,
  FolderInput,
  FolderOutput,
  Package,
  Database,
  Layers,
  Server,
  Image,
  User,
  FolderArchive,
  FileText,
  type LucideIcon,
} from 'lucide-react';

/** 类型 → 图标映射 */
const TYPE_ICON: Record<GeneratorType, LucideIcon> = {
  mod: Package,
  datapack: Database,
  modpack: Layers,
  server: Server,
  texture: Image,
  skin: User,
  resource_pack: FolderArchive,
};

/** 类型 → 中文标签 */
const TYPE_LABEL: Record<GeneratorType, string> = {
  mod: 'Mod',
  datapack: '数据包',
  modpack: '整合包',
  server: '服务器',
  texture: '材质',
  skin: '皮肤',
  resource_pack: '资源包',
};

/** Loader → 标签 */
const LOADER_LABEL: Record<string, string> = {
  fabric: 'Fabric',
  neoforge: 'NeoForge',
  quilt: 'Quilt',
  legacy_fabric: 'Legacy Fabric',
};

export function Dashboard() {
  const projects = useProjectStore((s) => s.projects);
  const loading = useProjectStore((s) => s.loading);
  const loadProjects = useProjectStore((s) => s.loadProjects);
  const loadProject = useProjectStore((s) => s.loadProject);
  const deleteProject = useProjectStore((s) => s.deleteProject);
  const exportProject = useProjectStore((s) => s.exportProject);
  const importProject = useProjectStore((s) => s.importProject);
  const setView = useProjectStore((s) => s.setView);
  const toast = useToast();
  const [importing, setImporting] = useState(false);
  const [exportingId, setExportingId] = useState<string | null>(null);

  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  /** P33：统计各类型项目数 */
  const typeStats = useMemo(() => {
    const counts = new Map<GeneratorType, number>();
    for (const p of projects) {
      counts.set(p.generatorType, (counts.get(p.generatorType) ?? 0) + 1);
    }
    return [...counts.entries()]
      .map(([type, count]) => ({ type, count }))
      .sort((a, b) => b.count - a.count);
  }, [projects]);

  /** 总文件数 */
  const totalFiles = useMemo(
    () => projects.reduce((sum, p) => sum + p.files.length, 0),
    [projects],
  );

  const handleNew = () => {
    useModStore.setState({
      description: '',
      spec: null,
      files: [],
      selectedFile: null,
      buildLog: '',
      buildSuccess: null,
      jarPath: null,
      fixLog: [],
      error: null,
      loading: false,
    });
    setView('editor');
  };

  const handleImport = async () => {
    setImporting(true);
    try {
      const res = await importProject();
      if (res.success) {
        toast.success('导入成功');
      } else if (res.error && res.error !== '已取消') {
        toast.error(`导入失败：${res.error}`);
      }
    } finally {
      setImporting(false);
    }
  };

  const handleExport = async (p: Project) => {
    setExportingId(p.id);
    try {
      const res = await exportProject(p);
      if (res.ok && res.savedPath) {
        toast.success(`已导出到 ${res.savedPath}`);
      } else if (!res.ok && !res.canceled) {
        toast.error('导出失败');
      }
    } finally {
      setExportingId(null);
    }
  };

  return (
    <div className="flex h-screen flex-col bg-zinc-950 text-zinc-100">
      {/* 顶栏 */}
      <header className="flex items-center justify-between border-b border-zinc-800 bg-zinc-900 px-6 py-4">
        <h1 className="text-xl font-bold">项目仪表盘</h1>
        <div className="flex gap-2">
          <button
            onClick={handleNew}
            className="flex items-center gap-1.5 rounded bg-blue-600 px-4 py-1.5 text-sm text-white hover:bg-blue-500"
          >
            <Plus className="h-4 w-4" /> 新建项目
          </button>
          <button
            onClick={handleImport}
            disabled={importing}
            className="flex items-center gap-1.5 rounded bg-zinc-700 px-4 py-1.5 text-sm text-white hover:bg-zinc-600 disabled:opacity-50"
          >
            {importing ? '导入中…' : <><FolderInput className="h-4 w-4" /> 导入项目</>}
          </button>
        </div>
      </header>

      {/* P33：统计栏 */}
      {projects.length > 0 && (
        <div className="flex items-center gap-4 border-b border-zinc-800 bg-zinc-900/50 px-6 py-3">
          <div className="flex items-baseline gap-1.5">
            <span className="text-2xl font-bold text-zinc-100">{projects.length}</span>
            <span className="text-xs text-zinc-400">个项目</span>
          </div>
          <div className="h-6 w-px bg-zinc-700" />
          <div className="flex items-baseline gap-1.5">
            <span className="text-2xl font-bold text-zinc-100">{totalFiles}</span>
            <span className="text-xs text-zinc-400">个文件</span>
          </div>
          <div className="h-6 w-px bg-zinc-700" />
          <div className="flex flex-wrap gap-1.5">
            {typeStats.map(({ type, count }) => {
              const Icon = TYPE_ICON[type];
              return (
                <span
                  key={type}
                  className="flex items-center gap-1 rounded bg-zinc-800 px-2 py-0.5 text-xs text-zinc-300"
                >
                  <Icon className="h-3 w-3" />
                  {TYPE_LABEL[type]}: {count}
                </span>
              );
            })}
          </div>
        </div>
      )}

      <main className="flex-1 overflow-y-auto p-6">
        {loading && projects.length === 0 ? (
          <div className="text-sm text-zinc-500">加载中…</div>
        ) : projects.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center text-zinc-500">
            <Package className="mb-4 h-16 w-16 opacity-30" />
            <div className="text-lg">还没有项目，点击新建开始创作</div>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {projects.map((p) => {
              const TypeIcon = TYPE_ICON[p.generatorType] ?? Package;
              return (
                <div
                  key={p.id}
                  className="flex flex-col rounded-lg border border-zinc-800 bg-zinc-800/50 p-4 transition hover:border-zinc-600"
                >
                  {/* 顶部：类型图标 + 名称 */}
                  <div className="mb-3 flex items-start gap-3">
                    <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-zinc-700/50">
                      <TypeIcon className="h-5 w-5 text-blue-400" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-base font-semibold">{p.name}</div>
                      <div className="text-xs text-zinc-400">{TYPE_LABEL[p.generatorType]}</div>
                    </div>
                  </div>

                  {/* 描述 */}
                  {p.description && (
                    <p className="mb-3 line-clamp-2 text-xs text-zinc-400">{p.description}</p>
                  )}

                  {/* 元信息 */}
                  <div className="mb-3 flex flex-wrap items-center gap-1.5 text-xs text-zinc-500">
                    <span className="rounded bg-zinc-700/50 px-1.5 py-0.5">{LOADER_LABEL[p.loader] ?? p.loader}</span>
                    <span>·</span>
                    <span>{p.mcVersion}</span>
                    <span>·</span>
                    <span className="flex items-center gap-0.5">
                      <FileText className="h-3 w-3" />
                      {p.files.length}
                    </span>
                  </div>

                  {/* 时间 */}
                  <div className="mb-3 text-xs text-zinc-500">
                    更新于 {new Date(p.updatedAt).toLocaleDateString()}
                  </div>

                  {/* 操作按钮 */}
                  <div className="mt-auto flex gap-2">
                    <button
                      onClick={() => loadProject(p.id)}
                      className="rounded bg-blue-600 px-3 py-1 text-xs text-white hover:bg-blue-500"
                    >
                      打开
                    </button>
                    <button
                      onClick={() => handleExport(p)}
                      disabled={exportingId === p.id}
                      className="flex items-center gap-1.5 rounded bg-zinc-700 px-3 py-1 text-xs text-white hover:bg-zinc-600 disabled:opacity-50"
                    >
                      {exportingId === p.id ? '导出中…' : <><FolderOutput className="h-4 w-4" /> 导出</>}
                    </button>
                    <button
                      onClick={() => {
                        if (window.confirm(`确定删除项目「${p.name}」？此操作不可撤销。`)) {
                          deleteProject(p.id);
                        }
                      }}
                      className="rounded bg-red-700 px-3 py-1 text-xs text-white hover:bg-red-600"
                    >
                      删除
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
