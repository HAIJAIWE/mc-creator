import { useEffect, useState, useMemo } from 'react';
import { useProjectStore } from '../store/project-store.js';
import { useToast } from './useToast.js';
import { useTranslation } from '../hooks/useTranslation.js';
import type { Project, GeneratorType } from '../../../shared/ipc-channels.js';
import { GENERATOR_DESCRIPTORS, pickLocalized } from '../../../shared/generator-descriptors.js';
import { FolderInput, FolderOutput } from 'lucide-react';
import { McMark } from './McMark.js';
import { McIcon } from '../assets/mc-ui/McIcon';
import { ipcClient } from '../lib/ipc-client.js';
import { ProjectCreateDialog } from './ProjectCreateDialog.js';
import type { CreateProjectData } from './ProjectCreateDialog.js';
import { loaderLabel } from '../../../shared/generator-descriptors.js';

/** 空态「内容类型」按创作方向分组，替代一锅端平铺 */
const TYPE_GROUPS: { title: string; hint: string; types: GeneratorType[] }[] = [
  {
    title: 'Java 版模组',
    hint: 'Fabric / NeoForge / Quilt 生态',
    types: ['mod', 'datapack', 'modpack', 'resource_pack'],
  },
  {
    title: '脚本与增强',
    hint: '数据驱动与脚本化内容',
    types: ['kubejs', 'crafttweaker', 'enchantment'],
  },
  {
    title: '服务器与外观',
    hint: '服务器配置、启动器与皮肤',
    types: ['server', 'launcher', 'skin'],
  },
  {
    title: '基岩版 Add-on',
    hint: 'Bedrock 行为包、物品与实体',
    types: ['behavior_pack', 'behavior_item', 'behavior_entity'],
  },
];

export function Dashboard() {
  const projects = useProjectStore((s) => s.projects);
  const loading = useProjectStore((s) => s.loading);
  const loadProjects = useProjectStore((s) => s.loadProjects);
  const loadProject = useProjectStore((s) => s.loadProject);
  const deleteProject = useProjectStore((s) => s.deleteProject);
  const exportProject = useProjectStore((s) => s.exportProject);
  const importProject = useProjectStore((s) => s.importProject);
  const saveCurrentAsProject = useProjectStore((s) => s.saveCurrentAsProject);
  const toast = useToast();
  const { t, tCommon, locale } = useTranslation();
  const [importing, setImporting] = useState(false);
  const [exportingId, setExportingId] = useState<string | null>(null);

  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  // 监听项目变更，自动刷新列表
  useEffect(() => {
    const unsubscribe = ipcClient.onProjectChanged?.((payload) => {
      console.log('[Dashboard] Project changed:', payload);
      loadProjects();
    });
    return () => {
      unsubscribe?.();
    };
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

  const handleCreateProject = async (data: CreateProjectData) => {
    // 先保存项目到项目存储
    const projectId = await saveCurrentAsProject(data.name.trim(), {
      generatorType: data.generatorType,
      loader: data.loader,
      mcVersion: data.mcVersion,
      description: data.description,
      spec: null,
      files: [],
    });

    // 保存成功后加载项目
    await loadProject(projectId);
  };

  const [showCreateDialog, setShowCreateDialog] = useState(false);

  const handleImport = async () => {
    setImporting(true);
    try {
      const res = await importProject();
      if (res.success) {
        toast.success(tCommon('success'));
      } else if (res.error && res.error !== tCommon('cancel')) {
        toast.error(`${tCommon('import_failed')}: ${res.error}`);
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
        toast.success(`${tCommon('exported_to')} ${res.savedPath}`);
      } else if (!res.ok && !res.canceled) {
        toast.error(tCommon('export_failed'));
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
            <h1 className="font-display text-xl font-bold tracking-tight">
              MC 创作器
              <span className="ml-2 align-middle text-xs font-normal text-mc-mute">MC Creator</span>
            </h1>
            <div className="text-xs text-mc-mute">AI 驱动的 Minecraft 内容创作工具</div>
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setShowCreateDialog(true)} className="mc-btn-primary">
            <McIcon scope="pixel" name="plus" size={16} /> {tCommon('new_project')}
          </button>
          <button onClick={handleImport} disabled={importing} className="mc-btn-ghost">
            {importing ? (
              tCommon('importing')
            ) : (
              <>
                <FolderInput className="h-4 w-4" /> {tCommon('import')}
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
              const descriptor = GENERATOR_DESCRIPTORS[type];
              return (
                <span key={type} className="mc-tag">
                  <McIcon scope={descriptor.icon.scope} name={descriptor.icon.name} size={12} />
                  {pickLocalized(descriptor.label, locale)}: {count}
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
          <div className="mx-auto max-w-5xl px-2">
            <div className="mb-10 text-center">
              <div className="mx-auto mb-5 inline-flex h-20 w-20 items-center justify-center rounded-mc-lg border border-mc-border-strong bg-mc-surface-2 shadow-[var(--mc-sheen),var(--mc-shadow-block)]">
                <McMark className="h-11 w-11 text-mc-accent" />
              </div>
              <h2 className="mb-2 font-display text-2xl font-bold">
                {t('dashboard.selectContentType')}
              </h2>
              <p className="text-sm text-mc-mute">{t('dashboard.selectContentTypeHint')}</p>
            </div>

            <div className="space-y-9 pb-8">
              {TYPE_GROUPS.map((group) => (
                <section key={group.title} aria-label={group.title}>
                  <header className="mb-3 flex items-baseline gap-3">
                    <h3 className="font-display text-xs font-bold uppercase tracking-wider text-mc-dim">
                      {group.title}
                    </h3>
                    <span className="hidden text-xs text-mc-mute sm:inline">{group.hint}</span>
                    <span className="h-px flex-1 bg-mc-border" aria-hidden="true" />
                  </header>
                  <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
                    {group.types.map((type) => {
                      const descriptor = GENERATOR_DESCRIPTORS[type];
                      return (
                        <button
                          key={type}
                          onClick={() => setShowCreateDialog(true)}
                          className="mc-card group relative flex min-h-[150px] flex-col items-center gap-2.5 p-5 transition-all hover:-translate-y-0.5 hover:border-mc-accent hover:shadow-[var(--mc-shadow-block)]"
                        >
                          {/* hover 顶部草绿高光线 */}
                          <span
                            aria-hidden="true"
                            className="absolute inset-x-1.5 top-1.5 h-[3px] rounded-full bg-mc-accent opacity-0 transition-opacity group-hover:opacity-100"
                          />
                          <div className="flex h-12 w-12 items-center justify-center rounded-mc-lg bg-mc-surface-3 shadow-[var(--mc-sheen)] transition-all group-hover:scale-110 group-hover:bg-mc-accent/15">
                            <McIcon
                              scope={descriptor.icon.scope}
                              name={descriptor.icon.name}
                              size={26}
                            />
                          </div>
                          <div className="text-sm font-semibold text-mc-text">
                            {pickLocalized(descriptor.label, locale)}
                          </div>
                          <div className="text-center text-xs leading-relaxed text-mc-mute">
                            {pickLocalized(descriptor.description, locale)}
                          </div>
                          <span
                            aria-hidden="true"
                            className="pointer-events-none absolute bottom-3 right-3 flex items-center gap-1 text-xs font-bold text-mc-accent opacity-0 transition-opacity group-hover:opacity-100"
                          >
                            创建
                            <McIcon scope="pixel" name="arrow-right" size={12} />
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </section>
              ))}
            </div>
          </div>
        ) : (
          <div>
            <div className="mb-6">
              <h2 className="mb-2 font-display text-lg font-bold">{t('dashboard.myProjects')}</h2>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {projects.map((p) => {
                  const descriptor = GENERATOR_DESCRIPTORS[p.generatorType];
                  return (
                    <div
                      key={p.id}
                      className="mc-card flex flex-col p-4 transition-all hover:-translate-y-0.5 hover:border-mc-accent"
                    >
                      <div className="mb-3 flex items-start gap-3">
                        <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-mc-lg bg-mc-surface-3">
                          <McIcon
                            scope={descriptor.icon.scope}
                            name={descriptor.icon.name}
                            size={20}
                          />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-base font-semibold text-mc-text">
                            {p.name}
                          </div>
                          <div className="text-xs text-mc-mute">
                            {pickLocalized(descriptor.label, locale)}
                          </div>
                        </div>
                      </div>
                      {p.description && (
                        <p className="mb-3 line-clamp-2 text-xs text-mc-dim">{p.description}</p>
                      )}
                      <div className="mb-3 flex flex-wrap items-center gap-1.5 text-xs text-mc-mute">
                        <span className="mc-tag">{loaderLabel(p.loader)}</span>
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
                        {t('dashboard.updatedAt', {
                          date: new Date(p.updatedAt).toLocaleDateString(),
                        })}
                      </div>
                      <div className="mt-auto flex gap-2">
                        <button onClick={() => loadProject(p.id)} className="mc-btn-primary">
                          {tCommon('open')}
                        </button>
                        <button
                          onClick={() => handleExport(p)}
                          disabled={exportingId === p.id}
                          className="mc-btn-ghost"
                        >
                          {exportingId === p.id ? (
                            t('dashboard.exporting')
                          ) : (
                            <>
                              <FolderOutput className="h-4 w-4" /> {tCommon('export')}
                            </>
                          )}
                        </button>
                        <button
                          onClick={() => {
                            if (window.confirm(t('dashboard.deleteConfirm', { name: p.name }))) {
                              deleteProject(p.id);
                            }
                          }}
                          className="mc-btn-danger"
                        >
                          {tCommon('delete')}
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
      {showCreateDialog && (
        <ProjectCreateDialog
          onClose={() => setShowCreateDialog(false)}
          onCreate={handleCreateProject}
        />
      )}
    </div>
  );
}
