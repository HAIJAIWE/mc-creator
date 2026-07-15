import { useEffect, useState } from 'react';
import { useProjectStore } from '../store/project-store.js';
import { useModStore } from '../store/mod-store.js';
import { useToast } from './ToastProvider.js';
import type { Project } from '../../../shared/ipc-channels.js';
import { Plus, FolderInput, FolderOutput } from 'lucide-react';

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
  // P30：导入/导出进行中状态（按钮 disabled + 视觉反馈）
  const [importing, setImporting] = useState(false);
  const [exportingId, setExportingId] = useState<string | null>(null);

  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  const handleNew = () => {
    // 清空当前编辑状态
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
      // 用户取消（error='已取消'）不提示
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
      // 用户取消（canceled=true）不提示
    } finally {
      setExportingId(null);
    }
  };

  return (
    <div className="flex h-screen flex-col bg-zinc-950 text-zinc-100">
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
      <main className="flex-1 overflow-y-auto p-6">
        {loading && projects.length === 0 ? (
          <div className="text-sm text-zinc-500">加载中…</div>
        ) : projects.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center text-zinc-500">
            <div className="text-lg">还没有项目，点击新建开始创作</div>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {projects.map((p) => (
              <div
                key={p.id}
                className="flex flex-col rounded-lg border border-zinc-800 bg-zinc-800 p-4"
              >
                <div className="mb-2 truncate text-base font-semibold">{p.name}</div>
                <div className="mb-1 text-xs text-zinc-400">
                  类型：{p.generatorType} · Loader：{p.loader}
                </div>
                <div className="mb-3 text-xs text-zinc-400">MC 版本：{p.mcVersion}</div>
                <div className="mb-3 text-xs text-zinc-500">
                  更新于：{new Date(p.updatedAt).toLocaleString()}
                </div>
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
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
