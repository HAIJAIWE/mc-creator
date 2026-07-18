import { useState } from 'react';
import { McIcon } from '../../assets/mc-ui/McIcon';
import { TabBar } from '../TabBar.js';
import { CodePreview } from '../CodePreview.js';
import { ServerPreviewPanel } from './ServerPreviewPanel.js';
import { ModPreviewPanel } from './ModPreviewPanel.js';
import { DatapackPreviewPanel } from './DatapackPreviewPanel.js';
import { ModpackPreviewPanel } from './ModpackPreviewPanel.js';
import { LauncherPreviewPanel } from './LauncherPreviewPanel.js';
import { ResourcePackPreviewPanel } from './ResourcePackPreviewPanel.js';
import { SkinPreviewPanel } from './SkinPreviewPanel.js';
import { KubejsPreviewPanel } from './KubejsPreviewPanel.js';
import { CraftTweakerPreviewPanel } from './CraftTweakerPreviewPanel.js';
import { useModStore } from '../../store/mod-store.js';
import type { GeneratorType } from '@mc-creator/shared';

type MiddleTab = 'preview' | 'code';

/**
 * 中间面板调度器：顶部 tab 切换（预览/代码），预览 tab 按 generatorType 分发到对应面板。
 * 阶段 4 已实现全部 7 种类型（server/mod/datapack/modpack/resource_pack/skin/launcher）+ KubeJS。
 */
export function MiddlePanel() {
  const [activeTab, setActiveTab] = useState<MiddleTab>('preview');
  const generatorType = useModStore((s) => s.generatorType);

  const renderPreviewPanel = () => {
    switch (generatorType) {
      case 'server':
        return <ServerPreviewPanel />;
      case 'mod':
        return <ModPreviewPanel />;
      case 'datapack':
        return <DatapackPreviewPanel />;
      case 'modpack':
        return <ModpackPreviewPanel />;
      case 'launcher':
        return <LauncherPreviewPanel />;
      case 'resource_pack':
        return <ResourcePackPreviewPanel />;
      case 'skin':
        return <SkinPreviewPanel />;
      case 'kubejs':
        return <KubejsPreviewPanel />;
      case 'crafttweaker':
        return <CraftTweakerPreviewPanel />;
      default:
        return <PlaceholderPanel type={generatorType} />;
    }
  };

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Tab 切换栏 */}
      <div
        role="tablist"
        aria-label="中间面板视图切换"
        className="flex items-center border-b border-mc-border bg-mc-surface px-2 py-1"
      >
        <button
          role="tab"
          aria-selected={activeTab === 'preview'}
          tabIndex={activeTab === 'preview' ? 0 : -1}
          onClick={() => setActiveTab('preview')}
          className={`flex items-center gap-1.5 rounded-mc px-3 py-1 text-xs font-medium transition-colors ${
            activeTab === 'preview'
              ? 'bg-mc-surface-2 text-mc-text border-b-2 border-mc-accent'
              : 'text-mc-dim hover:bg-mc-surface-2/60 hover:text-mc-text'
          }`}
        >
          <McIcon scope="pixel" name="star" size={12} />
          预览
        </button>
        <button
          role="tab"
          aria-selected={activeTab === 'code'}
          tabIndex={activeTab === 'code' ? 0 : -1}
          onClick={() => setActiveTab('code')}
          className={`flex items-center gap-1.5 rounded-mc px-3 py-1 text-xs font-medium transition-colors ${
            activeTab === 'code'
              ? 'bg-mc-surface-2 text-mc-text border-b-2 border-mc-accent'
              : 'text-mc-dim hover:bg-mc-surface-2/60 hover:text-mc-text'
          }`}
        >
          <McIcon scope="pixel" name="terminal" size={12} />
          代码
        </button>
      </div>

      {/* Tab 内容 */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {activeTab === 'preview' ? (
          renderPreviewPanel()
        ) : (
          <>
            <TabBar />
            <div className="flex-1 overflow-hidden">
              <CodePreview />
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** 占位面板：default 分支兜底，正常不会触发 */
function PlaceholderPanel({ type }: { type: GeneratorType }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 bg-mc-bg">
      <div className="flex h-16 w-16 items-center justify-center rounded-mc-lg border border-mc-border bg-mc-surface-2">
        <McIcon scope="pixel" name="box" size={32} className="text-mc-mute" />
      </div>
      <div className="text-sm font-medium text-mc-dim">{type} 预览面板开发中</div>
      <div className="text-xs text-mc-mute">
        阶段 2-4 实现该类型，当前可切换到「代码」tab 查看文件
      </div>
    </div>
  );
}
