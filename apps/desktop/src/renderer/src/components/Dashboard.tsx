import { useEffect, useState, useMemo } from 'react';
import { useProjectStore } from '../store/project-store.js';
import { useModStore } from '../store/mod-store.js';
import { useToast } from './useToast.js';
import type { Project, GeneratorType } from '../../../shared/ipc-channels.js';
import { GENERATOR_TYPES } from '../../../shared/ipc-channels.js';
import { FolderInput, FolderOutput } from 'lucide-react';
import { McMark } from './McMark.js';
import { McIcon } from '../assets/mc-ui/McIcon';

const TYPE_ICON: Record<GeneratorType, { scope: 'pixel'; name: string }> = {
  mod: { scope: 'pixel', name: 'package' },
  datapack: { scope: 'pixel', name: 'database' },
  modpack: { scope: 'pixel', name: 'box' },
  server: { scope: 'pixel', name: 'server' },
  resource_pack: { scope: 'pixel', name: 'folder' },
  skin: { scope: 'pixel', name: 'user' },
  launcher: { scope: 'pixel', name: 'rocket' },
  kubejs: { scope: 'pixel', name: 'zap' },
  crafttweaker: { scope: 'pixel', name: 'code' },
  behavior_pack: { scope: 'pixel', name: 'box' },
  enchantment: { scope: 'pixel', name: 'star' },
  behavior_item: { scope: 'pixel', name: 'tool-case' },
};

const TYPE_LABEL: Record<GeneratorType, string> = {
  mod: 'Mod',
  datapack: '数据包',
  modpack: '整合包',
  server: '服务器',
  resource_pack: '资源包',
  skin: '皮肤',
  launcher: '启动器',
  kubejs: 'KubeJS',
  crafttweaker: 'CraftTweaker',
  behavior_pack: '行为包',
  enchantment: '附魔',
  behavior_item: '行为包物品',
};

const TYPE_DESC: Record<GeneratorType, string> = {
  mod: '创建 Fabric/NeoForge 模组',
  datapack: '创建自定义数据包',
  modpack: '创建整合包配置',
  server: '创建服务器配置',
  resource_pack: '创建资源包',
  skin: '创建玩家皮肤',
  launcher: '创建启动器配置',
  kubejs: '创建 KubeJS 脚本',
  crafttweaker: '创建 ZenScript 脚本',
  behavior_pack: '创建基岩版行为包',
  enchantment: '创建数据驱动附魔（1.21+）',
  behavior_item: '创建基岩版自定义物品',
};

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

  const typeStats = useMemo(() => {
    const counts = new Map<GeneratorType, number>();
    for (const p of projects) {
      counts.set(p.generatorType, (counts.get(p.generatorType) ?? 0) + 1);
    }
    return [...counts.entries()]
      .map(([type, count]) => ({ type, count }))
      .sort((a, b) => b.count - a.count);
  }, [projects]);

  const totalFiles = useMemo(
    () => projects.reduce((sum, p) => sum + p.files.length, 0),
    [projects],
  );

  const handleNew = (type?: GeneratorType) => {
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
      generatorType: type ?? 'mod',
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
    <div className="flex h-screen flex-col bg-mc-bg text-mc-text font-sans">
      {/* 顶部草绿细条 */}
      <div className="h-[3px] w-full bg-mc-accent shadow-[0_1px_0_0_rgb(0_0_0/0.4)]" />

      <header className="flex items-center justify-between border-b border-mc-border bg-mc-surface px-6 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-mc-lg border border-mc-border bg-mc-surface-2">
            <McMark className="h-6 w-6 text-mc-accent" />
          </div>
          <div>
            <h1 className="font-display text-xl font-bold tracking-tight">MC Creator</h1>
            <div className="text-xs text-mc-mute">AI 驱动的 Minecraft 内容创作工具</div>
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={() => handleNew()} className="mc-btn-primary">
            <McIcon scope="pixel" name="plus" size={16} /> 新建项目
          </button>
          <button onClick={handleImport} disabled={importing} className="mc-btn-ghost">
            {importing ? (
              '导入中…'
            ) : (
              <>
                <FolderInput className="h-4 w-4" /> 导入项目
              </>
            )}
          </button>
        </div>
      </header>

      {projects.length > 0 && (
        <div className="flex items-center gap-4 border-b border-mc-border bg-mc-surface/60 px-6 py-3">
          <div className="flex items-baseline gap-1.5">
            <span className="font-display text-2xl font-bold text-mc-text">{projects.length}</span>
            <span className="text-xs text-mc-mute">个项目</span>
          </div>
          <div className="h-6 w-px bg-mc-border" />
          <div className="flex items-baseline gap-1.5">
            <span className="font-display text-2xl font-bold text-mc-text">{totalFiles}</span>
            <span className="text-xs text-mc-mute">个文件</span>
          </div>
          <div className="h-6 w-px bg-mc-border" />
          <div className="flex flex-wrap gap-1.5">
            {typeStats.map(({ type, count }) => {
              const icon = TYPE_ICON[type];
              return (
                <span key={type} className="mc-tag">
                  <McIcon scope={icon.scope} name={icon.name} size={12} />
                  {TYPE_LABEL[type]}: {count}
                </span>
              );
            })}
          </div>
        </div>
      )}

      <main className="flex-1 overflow-y-auto p-6">
        {loading && projects.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-mc-mute">
            加载中…
          </div>
        ) : projects.length === 0 ? (
          <div className="mx-auto max-w-4xl">
            <div className="mb-8 text-center">
              <div className="mx-auto mb-4 inline-flex h-16 w-16 items-center justify-center rounded-mc-lg border border-mc-border bg-mc-surface-2">
                <McMark className="h-9 w-9 text-mc-accent" />
              </div>
              <h2 className="mb-2 font-display text-xl font-bold">选择你要创建的内容类型</h2>
              <p className="text-sm text-mc-mute">
                让 AI 帮你生成 Mod、数据包、整合包等 Minecraft 内容
              </p>
            </div>
            <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
              {(GENERATOR_TYPES as readonly GeneratorType[]).map((type) => {
                const icon = TYPE_ICON[type];
                return (
                  <button
                    key={type}
                    onClick={() => handleNew(type)}
                    className="mc-card group flex flex-col items-center gap-3 p-5 transition-colors hover:border-mc-accent"
                  >
                    <div className="flex h-12 w-12 items-center justify-center rounded-mc-lg bg-mc-surface-3 transition-colors group-hover:bg-mc-accent/20">
                      <McIcon scope={icon.scope} name={icon.name} size={24} />
                    </div>
                    <div className="text-sm font-medium text-mc-text">{TYPE_LABEL[type]}</div>
                    <div className="text-center text-xs text-mc-mute">{TYPE_DESC[type]}</div>
                  </button>
                );
              })}
            </div>
          </div>
        ) : (
          <div>
            <div className="mb-6">
              <h2 className="mb-2 font-display text-lg font-bold">我的项目</h2>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {projects.map((p) => {
                  const icon = TYPE_ICON[p.generatorType];
                  return (
                    <div
                      key={p.id}
                      className="mc-card flex flex-col p-4 transition-colors hover:border-mc-accent"
                    >
                      <div className="mb-3 flex items-start gap-3">
                        <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-mc-lg bg-mc-surface-3">
                          <McIcon scope={icon.scope} name={icon.name} size={20} />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-base font-semibold text-mc-text">
                            {p.name}
                          </div>
                          <div className="text-xs text-mc-mute">{TYPE_LABEL[p.generatorType]}</div>
                        </div>
                      </div>
                      {p.description && (
                        <p className="mb-3 line-clamp-2 text-xs text-mc-dim">{p.description}</p>
                      )}
                      <div className="mb-3 flex flex-wrap items-center gap-1.5 text-xs text-mc-mute">
                        <span className="mc-tag">{LOADER_LABEL[p.loader] ?? p.loader}</span>
                        <span>·</span>
                        <span>{p.mcVersion}</span>
                        <span>·</span>
                        <span className="flex items-center gap-0.5">
                          <McIcon scope="pixel" name="file-text" size={12} />
                          {p.files.length}
                        </span>
                        {/* 依赖摘要（mod 项目） */}
                        {p.generatorType === 'mod' &&
                          Array.isArray((p.spec as Record<string, unknown>)?.dependencies) &&
                          (
                            (p.spec as Record<string, unknown>).dependencies as Array<{
                              modId?: string;
                            }>
                          ).length > 0 && (
                            <>
                              <span>·</span>
                              <span className="mc-tag" title="项目依赖">
                                {(
                                  (p.spec as Record<string, unknown>).dependencies as Array<{
                                    modId?: string;
                                  }>
                                )
                                  .map((d) => d.modId ?? '?')
                                  .join(', ')}
                              </span>
                            </>
                          )}
                      </div>
                      <div className="mb-3 text-xs text-mc-mute">
                        更新于 {new Date(p.updatedAt).toLocaleDateString()}
                      </div>
                      <div className="mt-auto flex gap-2">
                        <button onClick={() => loadProject(p.id)} className="mc-btn-primary">
                          打开
                        </button>
                        <button
                          onClick={() => handleExport(p)}
                          disabled={exportingId === p.id}
                          className="mc-btn-ghost"
                        >
                          {exportingId === p.id ? (
                            '导出中…'
                          ) : (
                            <>
                              <FolderOutput className="h-4 w-4" /> 导出
                            </>
                          )}
                        </button>
                        <button
                          onClick={() => {
                            if (window.confirm(`确定删除项目「${p.name}」？此操作不可撤销。`)) {
                              deleteProject(p.id);
                            }
                          }}
                          className="mc-btn-danger"
                        >
                          删除
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
