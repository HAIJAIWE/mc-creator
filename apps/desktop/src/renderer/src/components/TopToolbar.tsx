import { useState } from 'react';
import { shallow } from 'zustand/shallow';
import { FolderOpen, Loader2 } from 'lucide-react';
import type { Loader, McVersion } from '@mc-creator/shared';
import { MC_VERSIONS } from '@mc-creator/shared';
import type { GeneratorType } from '../../../shared/ipc-channels.js';
import { McIcon } from '../assets/mc-ui/McIcon';
import { useModStore } from '../store/mod-store.js';
import { useModelConfigStore } from '../store/model-config-store.js';
import { useProjectStore } from '../store/project-store.js';

interface TopToolbarProps {
  /** 点击 API 状态指示时跳转到 settings activity */
  onOpenSettings: () => void;
}

const TYPE_LABELS: Record<GeneratorType, string> = {
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
  behavior_entity: '行为包实体',
};

export function TopToolbar({ onOpenSettings }: TopToolbarProps) {
  // 全局设置：类型 / Loader / 版本
  const { generatorType, loader, mcVersion, loading, setGeneratorType, setLoader, setMcVersion } =
    useModStore(
      (s) => ({
        generatorType: s.generatorType,
        loader: s.loader,
        mcVersion: s.mcVersion,
        loading: s.loading,
        setGeneratorType: s.setGeneratorType,
        setLoader: s.setLoader,
        setMcVersion: s.setMcVersion,
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
            <span className="max-w-24 truncate text-xs">{currentProject?.name || '项目'}</span>
          </button>
          {showProjectMenu && (
            <div className="mc-pop absolute left-0 top-full mt-1 z-50 w-56 overflow-hidden animate-mc-panel-in">
              <div className="flex items-center gap-2 border-b border-mc-border px-2 py-1.5">
                <McIcon scope="pixel" name="folder" size={12} />
                <span className="text-xs font-bold text-mc-dim">项目管理</span>
              </div>
              <div className="space-y-0.5 p-1">
                <button
                  onClick={handleNew}
                  className="flex w-full items-center gap-2 rounded-mc px-2 py-1.5 text-left text-xs text-mc-dim transition-colors hover:bg-mc-surface-2 hover:text-mc-text"
                >
                  <FolderOpen className="h-3 w-3 text-mc-accent" />
                  新建项目
                </button>
                <button
                  onClick={handleImport}
                  disabled={importing}
                  className="flex w-full items-center gap-2 rounded-mc px-2 py-1.5 text-left text-xs text-mc-dim transition-colors hover:bg-mc-surface-2 hover:text-mc-text disabled:opacity-50"
                >
                  <FolderOpen className="h-3 w-3 text-mc-gold" />
                  {importing ? '导入中…' : '导入项目'}
                </button>
                <button
                  onClick={handleSave}
                  disabled={!spec || files.length === 0}
                  className="flex w-full items-center gap-2 rounded-mc px-2 py-1.5 text-left text-xs text-mc-dim transition-colors hover:bg-mc-surface-2 hover:text-mc-text disabled:opacity-50"
                >
                  <McIcon scope="pixel" name="save" size={12} />
                  保存项目
                </button>
              </div>
              {projects.length > 0 && (
                <div className="border-t border-mc-border">
                  <div className="px-2 py-1 text-xs text-mc-mute">已有项目</div>
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

      {/* 中间：全局设置 类型 / Loader / 版本 */}
      <div className="flex items-center gap-2">
        <select
          value={generatorType}
          onChange={(e) => setGeneratorType(e.target.value as GeneratorType)}
          disabled={loading}
          className="mc-select"
        >
          {Object.entries(TYPE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <select
          value={loader}
          onChange={(e) => setLoader(e.target.value as Loader)}
          disabled={loading}
          className="mc-select"
        >
          <option value="fabric">Fabric</option>
          <option value="neoforge">NeoForge</option>
          <option value="quilt">Quilt</option>
          <option value="legacy_fabric">Legacy Fabric</option>
        </select>
        <select
          value={mcVersion}
          onChange={(e) => setMcVersion(e.target.value as McVersion)}
          disabled={loading}
          className="mc-select"
        >
          {MC_VERSIONS.map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
        {mcVersion === '26.2' && (
          <span
            className="text-[10px] text-mc-gold"
            title="26.2 的 NeoForge 版本为 beta，构建配置可能需手动调整"
          >
            实验性
          </span>
        )}
        {loading && <Loader2 className="h-3 w-3 animate-spin text-mc-mute" />}
      </div>

      {/* 右侧：API Key 状态指示 */}
      <button
        onClick={onOpenSettings}
        className="mc-btn-ghost !px-2 !py-1"
        title={apiKey ? 'API Key 已配置' : '未配置 API Key，点击设置'}
      >
        <span className={`h-2 w-2 rounded-full ${apiKey ? 'bg-mc-accent' : 'bg-mc-redstone'}`} />
        <span className="text-xs text-mc-dim">{apiKey ? '已配置' : '未配置'}</span>
      </button>
    </div>
  );
}
