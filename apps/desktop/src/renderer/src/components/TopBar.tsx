import { useState } from 'react';
import { FolderOpen } from 'lucide-react';
import { useModStore } from '../store/mod-store.js';
import { useProjectStore } from '../store/project-store.js';
import { MC_VERSIONS } from '@mc-creator/shared';
import type { Loader, McVersion } from '@mc-creator/shared';
import type { GeneratorType } from '../../../shared/ipc-channels.js';
import { SettingsPanel } from './SettingsPanel.js';
import { McIcon } from '../assets/mc-ui/McIcon';

interface TopBarProps {
  onSaveProject?: () => void;
  canSaveProject?: boolean;
}

export function TopBar({ onSaveProject, canSaveProject }: TopBarProps) {
  const { loader, mcVersion, setLoader, setMcVersion, loading, generatorType, setGeneratorType, spec } = useModStore();
  const { projects, loadProjects, loadProject, importProject, currentProjectId } = useProjectStore();
  const [showSettings, setShowSettings] = useState(false);
  const [showProjectList, setShowProjectList] = useState(false);
  const [importing, setImporting] = useState(false);

  const currentProject = projects.find((p) => p.id === currentProjectId);
  const projectName = currentProject?.name || '未命名项目';

  const handleLoadProjects = async () => {
    await loadProjects();
    setShowProjectList(true);
  };

  const handleSelectProject = async (id: string) => {
    await loadProject(id);
    setShowProjectList(false);
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
    setShowProjectList(false);
  };

  const TYPE_LABELS: Record<GeneratorType, string> = {
    mod: 'Mod',
    datapack: '数据包',
    modpack: '整合包',
    server: '服务器',
    texture: '材质',
    skin: '皮肤',
    resource_pack: '资源包',
  };

  return (
    <header className="flex items-center gap-4 border-b border-mc-border bg-mc-surface px-4 py-2.5">
      <div className="relative">
        <button
          onClick={handleLoadProjects}
          className="flex items-center gap-1.5 rounded-mc px-2 py-1 text-sm text-mc-text-dim hover:bg-mc-surface-2 hover:text-mc-text transition-colors"
        >
          <McIcon scope="pixel" name="folder" size={16} />
          <span className="max-w-24 truncate">项目</span>
        </button>
        {showProjectList && (
          <div className="absolute left-0 top-full mt-1 w-72 overflow-hidden rounded-mc border border-mc-border-strong bg-mc-surface shadow-mc-pop z-50">
            <div className="flex items-center gap-2 border-b border-mc-border px-3 py-2">
              <McIcon scope="pixel" name="folder" size={16} />
              <span className="text-xs font-semibold text-mc-text">项目管理</span>
            </div>
            <div className="p-2 border-b border-mc-border space-y-1">
              <button
                onClick={handleNew}
                className="w-full flex items-center gap-2 rounded-mc px-3 py-2 text-left text-xs text-mc-text hover:bg-mc-surface-2 transition-colors"
              >
                <FolderOpen className="h-4 w-4 text-mc-accent" />
                <span>新建项目</span>
              </button>
              <button
                onClick={handleImport}
                disabled={importing}
                className="w-full flex items-center gap-2 rounded-mc px-3 py-2 text-left text-xs text-mc-text hover:bg-mc-surface-2 disabled:opacity-50 transition-colors"
              >
                <FolderOpen className="h-4 w-4 text-mc-accent" />
                {importing ? '导入中…' : '导入项目'}
              </button>
            </div>
            {projects.length === 0 ? (
              <div className="p-6 text-center">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-mc-surface-2 mx-auto mb-2">
                  <McIcon scope="pixel" name="folder" size={16} />
                </div>
                <div className="text-xs text-mc-text-dim">暂无项目</div>
              </div>
            ) : (
              <div className="max-h-64 overflow-y-auto">
                {projects.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => handleSelectProject(p.id)}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-mc-surface-2 transition-colors ${
                      currentProjectId === p.id ? 'bg-mc-surface-2/50' : ''
                    }`}
                  >
                    <div className="flex h-7 w-7 items-center justify-center rounded-mc bg-mc-surface-2">
                      <McIcon scope="pixel" name="folder" size={14} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-xs text-mc-text font-medium">{p.name}</div>
                      <div className="truncate text-xs text-mc-text-dim">{TYPE_LABELS[p.generatorType]} · {p.loader}</div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="h-6 w-px bg-mc-surface-3" />

      <div className="flex items-center gap-2">
        <McIcon scope="game" name="cubes" size={16} />
        <span className="text-sm font-bold text-mc-text">MC Creator</span>
      </div>

      <div className="flex items-center gap-1.5 rounded-mc bg-mc-surface-2/50 px-3 py-1.5">
        <span className="text-xs text-mc-text-dim">{projectName}</span>
      </div>

      <div className="h-6 w-px bg-mc-surface-3" />

      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1.5">
          <label className="text-xs text-mc-text-dim">类型</label>
          <select
            value={generatorType}
            onChange={(e) => setGeneratorType(e.target.value as GeneratorType)}
            disabled={loading}
            className="mc-select"
          >
            {Object.entries(TYPE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-1.5">
          <label className="text-xs text-mc-text-dim">Loader</label>
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
        </div>
        <div className="flex items-center gap-1.5">
          <label className="text-xs text-mc-text-dim">MC 版本</label>
          <select
            value={mcVersion}
            onChange={(e) => setMcVersion(e.target.value as McVersion)}
            disabled={loading}
            className="mc-select"
          >
            {MC_VERSIONS.map((v) => (
              <option key={v} value={v}>{v}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="ml-auto flex items-center gap-2">
        {onSaveProject && canSaveProject && (
          <button
            onClick={onSaveProject}
            className="mc-btn-primary"
          >
            <McIcon scope="pixel" name="save" size={14} />
            保存项目
          </button>
        )}
        {spec && (
          <div className="flex items-center gap-1 rounded-full bg-mc-accent/20 px-2.5 py-1 text-xs text-mc-accent">
            <McIcon scope="pixel" name="star" size={12} />
            Spec 已生成
          </div>
        )}
        <button
          onClick={() => setShowSettings(true)}
          className="flex items-center gap-1.5 rounded-mc px-3 py-1.5 text-xs text-mc-text-dim hover:bg-mc-surface-2 hover:text-mc-text transition-colors"
        >
          <McIcon scope="pixel" name="settings-cog" size={14} />
          设置
        </button>
      </div>

      {showSettings && <SettingsPanel onClose={() => setShowSettings(false)} />}
    </header>
  );
}