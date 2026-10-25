import { useState } from 'react';
import { shallow } from 'zustand/shallow';
import { Loader2 } from 'lucide-react';
import { McIcon } from '../assets/mc-ui/McIcon';
import { useModStore } from '../store/mod-store.js';
import { useModelConfigStore } from '../store/model-config-store.js';
import { useProjectStore } from '../store/project-store.js';
import { LanguageSwitcher } from './LanguageSwitcher.js';
import { useTranslation } from '../hooks/useTranslation.js';

interface TopToolbarProps {
  /** 点击 API 状态指示时跳转到 settings activity */
  onOpenSettings: () => void;
  /**
   * 是否展示「构建」入口。由 App 按当前工作域决定 —— `build` 面板只归属 `dev` 域，
   * 在别的域里点它会被 App.tsx 的域纠偏 effect 弹回默认面板，按钮就成了假入口。
   * 阶段 4 的 DomainTabs 落地后，域面板会有常驻 tab 条；本按钮届时可评估是否保留
   * （VS Code 标题栏 / IntelliJ 菜单栏同样保留常驻 build 动作，故倾向于保留）。
   */
  canOpenBuild?: boolean;
  /** 跳转到 build 面板（本地编译 .jar / 装进 mods / 启动游戏） */
  onOpenBuild?: () => void;
}

export function TopToolbar({ onOpenSettings, canOpenBuild = false, onOpenBuild }: TopToolbarProps) {
  const { t, tCommon } = useTranslation();
  // 只剩 loading（全局忙碌反馈）与三项的**值**——值用于「另存为项目」时写入项目文件，
  // 以及 26.2 实验版提示条。它们的**编辑入口**已迁至 SettingsPanel「项目」分组。
  const { generatorType, loader, mcVersion, loading } = useModStore(
    (s) => ({
      generatorType: s.generatorType,
      loader: s.loader,
      mcVersion: s.mcVersion,
      loading: s.loading,
    }),
    shallow,
  );

  // 项目菜单
  const {
    projects,
    loadProjects,
    loadProject,
    importProject,
    saveCurrentAsProject,
    currentProjectId,
  } = useProjectStore(
    (s) => ({
      projects: s.projects,
      loadProjects: s.loadProjects,
      loadProject: s.loadProject,
      importProject: s.importProject,
      saveCurrentAsProject: s.saveCurrentAsProject,
      currentProjectId: s.currentProjectId,
    }),
    shallow,
  );

  // 保存项目需要 spec/files/description/generatorType/loader/mcVersion
  const { spec, files, description, setError } = useModStore(
    (s) => ({
      spec: s.spec,
      files: s.files,
      description: s.description,
      setError: s.setError,
    }),
    shallow,
  );

  // API Key 状态指示
  const { apiKey } = useModelConfigStore();

  const [showProjectMenu, setShowProjectMenu] = useState(false);
  const [importing, setImporting] = useState(false);

  const currentProject = projects.find((p) => p.id === currentProjectId);

  const handleLoadProjects = async () => {
    await loadProjects();
    setShowProjectMenu(true);
  };

  const handleSelectProject = async (id: string) => {
    await loadProject(id);
    setShowProjectMenu(false);
  };

  const handleImport = async () => {
    setImporting(true);
    try {
      await importProject();
      await loadProjects();
    } finally {
      setImporting(false);
    }
  };

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
      generatorType: 'mod',
    });
    setShowProjectMenu(false);
  };

  const handleSave = async () => {
    if (!spec || files.length === 0) return;
    try {
      const name = currentProject?.name || `project-${Date.now()}`;
      await saveCurrentAsProject(name, {
        generatorType,
        loader,
        mcVersion,
        description,
        spec,
        files,
      });
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="flex h-12 items-center justify-between border-b border-mc-border bg-mc-surface px-3">
      {/* 左侧：项目菜单 */}
      <div className="flex items-center gap-2">
        <div className="relative">
          <button onClick={handleLoadProjects} className="mc-btn-ghost !px-2 !py-1">
            <McIcon scope="pixel" name="folder" size={14} />
            <span className="max-w-24 truncate text-xs">
              {currentProject?.name || tCommon('project')}
            </span>
          </button>
          {showProjectMenu && (
            <div className="mc-pop absolute left-0 top-full mt-1 z-50 w-56 overflow-hidden animate-mc-panel-in">
              <div className="flex items-center gap-2 border-b border-mc-border px-2 py-1.5">
                <McIcon scope="pixel" name="folder" size={12} />
                <span className="text-xs font-bold text-mc-dim">
                  {t('topToolbar.projectManagement')}
                </span>
              </div>
              <div className="space-y-0.5 p-1">
                <button
                  onClick={handleNew}
                  className="flex w-full items-center gap-2 rounded-mc px-2 py-1.5 text-left text-xs text-mc-dim transition-colors hover:bg-mc-surface-2 hover:text-mc-text"
                >
                  <McIcon scope="pixel" name="folder" size={12} className="text-mc-accent" />
                  {tCommon('new_project')}
                </button>
                <button
                  onClick={handleImport}
                  disabled={importing}
                  className="flex w-full items-center gap-2 rounded-mc px-2 py-1.5 text-left text-xs text-mc-dim transition-colors hover:bg-mc-surface-2 hover:text-mc-text disabled:opacity-50"
                >
                  <McIcon scope="pixel" name="folder" size={12} className="text-mc-gold" />
                  {importing ? tCommon('importing') : tCommon('import')}
                </button>
                <button
                  onClick={handleSave}
                  disabled={!spec || files.length === 0}
                  className="flex w-full items-center gap-2 rounded-mc px-2 py-1.5 text-left text-xs text-mc-dim transition-colors hover:bg-mc-surface-2 hover:text-mc-text disabled:opacity-50"
                >
                  <McIcon scope="pixel" name="save" size={12} />
                  {t('topToolbar.saveProject')}
                </button>
              </div>
              {projects.length > 0 && (
                <div className="border-t border-mc-border">
                  <div className="px-2 py-1 text-xs text-mc-mute">
                    {t('topToolbar.existingProjects')}
                  </div>
                  <div className="max-h-32 overflow-y-auto">
                    {projects.map((p) => (
                      <button
                        key={p.id}
                        onClick={() => handleSelectProject(p.id)}
                        className={`flex w-full items-center gap-2 px-2 py-1 text-left text-xs transition-colors hover:bg-mc-surface-2 ${
                          currentProjectId === p.id
                            ? 'bg-mc-surface-2/60 text-mc-text'
                            : 'text-mc-dim'
                        }`}
                      >
                        <McIcon scope="pixel" name="folder" size={12} />
                        <span className="truncate">{p.name}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/*
       * 中间：原为「内容类型 / Loader / MC 版本」三个下拉框，现已移除。
       *
       * 依据 VS Code 与 IntelliJ 的官方文档：两者的顶部都**不放项目配置**。
       * - VS Code 官方列出的六个区域（Editor / Primary Side Bar / Secondary Side Bar /
       *   Status Bar / Activity Bar / Panel）里没有「工具栏」；标题栏只有
       *   菜单 + Command Center（项目名）+ 布局控制按钮。
       * - IntelliJ 主工具栏是运行/调试动作按钮，同样不含项目配置。
       *
       * 且项目上下文（VS Code 显示语言/缩进/行列，IntelliJ 显示编码/行号）一律在**底部状态栏**。
       *
       * 三个字段的去处：
       * - 只读值 → 底部 `StatusBar`（见 components/StatusBar.tsx）
       * - 编辑入口 → `SettingsPanel` 的「项目」分组（唯一编辑入口）
       *
       * 保留 loading 指示器：它是全局忙碌反馈，不属于项目配置。
       */}
      <div className="flex items-center gap-2">
        {mcVersion === '26.2' && (
          <span className="text-[10px] text-mc-gold" title={t('topToolbar.experimentalTooltip')}>
            {t('topToolbar.experimental')}
          </span>
        )}
        {loading && <Loader2 className="h-3 w-3 animate-spin text-mc-mute" />}
      </div>

      {/* 右侧：构建入口 + 语言切换 + API Key 状态指示 */}
      <div className="flex items-center gap-2">
        {canOpenBuild && onOpenBuild && (
          <button
            onClick={onOpenBuild}
            className="mc-btn-ghost !px-2 !py-1"
            title={t('activityBar.build')}
          >
            <McIcon scope="pixel" name="anvil" size={14} />
            <span className="text-xs text-mc-dim">{t('topToolbar.build')}</span>
          </button>
        )}
        <LanguageSwitcher variant="compact" showLabel={false} />
        <button
          onClick={onOpenSettings}
          className="mc-btn-ghost !px-2 !py-1"
          title={apiKey ? t('topToolbar.apiKeyConfigured') : t('topToolbar.apiKeyNotConfigured')}
        >
          <span className={`h-2 w-2 rounded-full ${apiKey ? 'bg-mc-accent' : 'bg-mc-redstone'}`} />
          <span className="text-xs text-mc-dim">
            {apiKey ? tCommon('configured') : tCommon('notConfigured')}
          </span>
        </button>
      </div>
    </div>
  );
}
