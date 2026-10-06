import { lazy, Suspense } from 'react';
import { useModStore } from '../store/mod-store.js';
import { useProjectStore } from '../store/project-store.js';
import { useDomainStore, selectDomain } from '../store/domain-store.js';
import { emptyStateHintOfDomain } from '../shell/domains.js';
import { McIcon } from '../assets/mc-ui/McIcon.js';
import { withMonacoSetup } from '../lib/lazy-monaco.js';

// 下面两个面板的静态依赖里带 <Editor>（MiddlePanel → CodePreview / SplitCodeEditor /
// LowcodeWorkspace / PurecodeWorkspace），所以加载器必须先完成 Monaco 本地化配置，
// 否则 loader.init() 会永久走 CDN 分支被 CSP 拦掉。见 lib/lazy-monaco.ts。
const PreviewPanel = lazy(
  withMonacoSetup(() =>
    import('./middle/MiddlePanel.js').then((m) => ({ default: m.MiddlePanel })),
  ),
);
const CodeEditor = lazy(
  withMonacoSetup(() => import('./CodePreview.js').then((m) => ({ default: m.CodePreview }))),
);
const ResourcePackPreview = lazy(() =>
  import('./ResourcePackPreview.js').then((m) => ({ default: m.ResourcePackPreview })),
);
const NbtEditor = lazy(() => import('./NbtEditor.js').then((m) => ({ default: m.NbtEditor })));
const SearchPanel = lazy(() =>
  import('./SearchPanel.js').then((m) => ({ default: m.SearchPanel })),
);
const GitPanel = lazy(() => import('./GitPanel.js').then((m) => ({ default: m.GitPanel })));
const PackagesPanel = lazy(() =>
  import('./PackagesPanel.js').then((m) => ({ default: m.PackagesPanel })),
);
const SettingsPanel = lazy(() =>
  import('./SettingsPanel.js').then((m) => ({ default: m.SettingsPanel })),
);
const ItemRecipeEditor = lazy(() =>
  import('./ItemRecipeEditor.js').then((m) => ({ default: m.ItemRecipeEditor })),
);
const BlockEditor = lazy(() =>
  import('./BlockEditor.js').then((m) => ({ default: m.BlockEditor })),
);
const EntityAiEditor = lazy(() =>
  import('./EntityAiEditor.js').then((m) => ({ default: m.EntityAiEditor })),
);
const SkinPreviewPanel = lazy(() =>
  import('./middle/SkinPreviewPanel.js').then((m) => ({ default: m.SkinPreviewPanel })),
);
const AudioPanel = lazy(() => import('./AudioPanel.js').then((m) => ({ default: m.AudioPanel })));
const CiCdPanel = lazy(() => import('./CiCdPanel.js').then((m) => ({ default: m.CiCdPanel })));
const GameLauncherPanel = lazy(() =>
  import('./GameLauncherPanel.js').then((m) => ({ default: m.GameLauncherPanel })),
);
// 内核只读链路验证屏（§18 阶段 10）
const KernelPanel = lazy(() =>
  import('./KernelPanel.js').then((m) => ({ default: m.KernelPanel })),
);

function PanelLoading() {
  return (
    <div className="flex h-full items-center justify-center text-sm text-mc-mute">加载面板中…</div>
  );
}

function EmptyPanel({ message }: { message: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-mc-lg border border-mc-border bg-mc-surface-2">
        <McIcon scope="pixel" name="box" size={24} className="text-mc-mute" />
      </div>
      <div className="text-sm font-medium text-mc-dim">{message}</div>
    </div>
  );
}

/**
 * 中间主面板视图
 * 根据左侧激活的面板 ID 渲染对应的内容
 */
export function MainPanelView({ activePanel }: { activePanel: string }) {
  const currentProjectId = useProjectStore((s) => s.currentProjectId);
  const selectedFile = useModStore((s) => s.selectedFile);
  const domain = useDomainStore(selectDomain);

  // 如果没有项目，显示空状态。
  // 文案按域给：§0.2 里三个域的「还没有东西」含义不同 —— launcher 是没选实例、server 是没建服务端、
  // dev 才是没打开项目。用同一句话会误导（例如在服务器域提示「打开或新建项目」）。
  // 注意这里早于下面的 switch：域感知只影响空态文案，不改动任何既有面板分支。
  if (!currentProjectId) {
    return <EmptyPanel message={emptyStateHintOfDomain(domain)} />;
  }

  // 根据面板 ID 渲染对应内容
  switch (activePanel) {
    case 'explorer':
      // 资源管理器：显示文件树或文件内容
      if (selectedFile) {
        return (
          <Suspense fallback={<PanelLoading />}>
            <CodeEditor />
          </Suspense>
        );
      }
      return <EmptyPanel message="选择文件以查看内容" />;

    case 'search':
      return (
        <Suspense fallback={<PanelLoading />}>
          <SearchPanel />
        </Suspense>
      );

    case 'git':
      return (
        <Suspense fallback={<PanelLoading />}>
          <GitPanel />
        </Suspense>
      );

    case 'packages':
      return (
        <Suspense fallback={<PanelLoading />}>
          <PackagesPanel />
        </Suspense>
      );

    case 'settings':
      return (
        <Suspense fallback={<PanelLoading />}>
          <SettingsPanel />
        </Suspense>
      );

    case 'items':
      return (
        <Suspense fallback={<PanelLoading />}>
          <ItemRecipeEditor />
        </Suspense>
      );

    case 'blocks':
      return (
        <Suspense fallback={<PanelLoading />}>
          <BlockEditor />
        </Suspense>
      );

    case 'entity':
      return (
        <Suspense fallback={<PanelLoading />}>
          <EntityAiEditor />
        </Suspense>
      );

    case 'skin':
      return (
        <Suspense fallback={<PanelLoading />}>
          <SkinPreviewPanel />
        </Suspense>
      );

    case 'audio':
      return (
        <Suspense fallback={<PanelLoading />}>
          <AudioPanel />
        </Suspense>
      );

    case 'cicd':
      return (
        <Suspense fallback={<PanelLoading />}>
          <CiCdPanel />
        </Suspense>
      );

    case 'game':
      return (
        <Suspense fallback={<PanelLoading />}>
          <GameLauncherPanel />
        </Suspense>
      );

    case 'preview':
      return (
        <Suspense fallback={<PanelLoading />}>
          <PreviewPanel />
        </Suspense>
      );

    case 'resources':
      return (
        <Suspense fallback={<PanelLoading />}>
          <ResourcePackPreview />
        </Suspense>
      );

    case 'nbt':
      return (
        <Suspense fallback={<PanelLoading />}>
          <NbtEditor />
        </Suspense>
      );

    case 'kernel':
      return (
        <Suspense fallback={<PanelLoading />}>
          <KernelPanel />
        </Suspense>
      );

    default:
      return <EmptyPanel message={`未知面板: ${activePanel}`} />;
  }
}
