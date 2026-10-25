/**
 * 中间主面板视图
 *
 * ## 为什么从 17 个 lazy + switch 收敛到 PanelHost
 *
 * 重构前这个文件有 17 个硬编码 `lazy()` import + 一个 `switch` 分发。
 * 新增面板要改两处（注册表 + 这里的 switch），漏改不会报错 ——
 * 只会让面板静默失联（阶段 0A 的 `build` 就是这么失联的）。
 *
 * 现在面板装配只有**一条路径**：注册表 → PanelHost。
 * 新增面板只需在 `register-all-panels.ts` 声明一行配置，
 * PanelHost 自动从注册表取 loader 并渲染。
 *
 * ## 保留的装饰层
 *
 * 1. **全局短路**：`!currentProjectId` → 域感知空态（早于所有面板）
 * 2. **nbt 的 store 接线**：`NbtPanelWithStore` 包装组件（§1.6.1 修复）
 *
 * 其余 16 个面板的 `Suspense + PanelLoading` 装饰层由 PanelHost 统一提供
 * （`PanelHost.tsx:59` 的 `<Suspense fallback={fallback ?? <PanelLoadingFallback />}>`）。
 */
import { Suspense, useMemo, useCallback } from 'react';
import { useModStore } from '../store/mod-store.js';
import { NbtEditor } from './NbtEditor.js';
import { useProjectStore } from '../store/project-store.js';
import { useWorkbenchStore, selectDomain } from '../shell/workbench-store.js';
import { emptyStateHintOfDomain } from '../shell/domains.js';
import { PanelHost } from '../shell/PanelHost.js';

function PanelLoading() {
  return (
    <div className="flex h-full items-center justify-center text-sm text-mc-mute">加载面板中…</div>
  );
}

function EmptyPanel({ message }: { message: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
      <div className="text-sm font-medium text-mc-dim">{message}</div>
    </div>
  );
}

/**
 * NBT 编辑器的 store 接线包装。
 *
 * ## 为什么需要这个组件
 *
 * `NbtEditor` 是纯展示组件（props: `initialValue` / `onChange` / `readOnly`），
 * 不耦合 store。但注册表路径若直接渲染裸 `<NbtEditor />`，
 * 会导致 `initialValue` 取默认值 `'{}'`、`onChange` 为 `undefined` ——
 * 打开永远是空 compound，用户的所有编辑不落盘，且没有任何报错。
 *
 * `MiddlePanel` 里已有正确的接线（读 `selectedFile` 对应内容、写回 `updateFileContent`），
 * 但那份接线是内联在 JSX 里的，无法复用。这里把它提成独立组件，让两条路径共享同一份逻辑。
 *
 * 与 `MiddlePanel` 的差异：MiddlePanel 用 `getState()` 在渲染期读（非响应式），
 * 这里用 hook 订阅（响应式）—— 后者更正确，且不影响 MiddlePanel 的既有行为。
 */
function NbtPanelWithStore() {
  const selectedFile = useModStore((s) => s.selectedFile);
  const files = useModStore((s) => s.files);
  const updateFileContent = useModStore((s) => s.updateFileContent);

  const initialValue = useMemo(() => {
    const f = files.find((x) => x.path === selectedFile);
    // .png 等二进制文件不能当文本解析，兜底空对象
    return f && !f.path.endsWith('.png') ? f.content : '{}';
  }, [files, selectedFile]);

  const handleChange = useCallback(
    (snbt: string) => {
      if (selectedFile) updateFileContent(selectedFile, snbt);
    },
    [selectedFile, updateFileContent],
  );

  return <NbtEditor initialValue={initialValue} onChange={handleChange} />;
}

export function MainPanelView({ activePanel }: { activePanel: string }) {
  const currentProjectId = useProjectStore((s) => s.currentProjectId);
  const domain = useWorkbenchStore(selectDomain);

  // 如果没有项目，显示空状态。
  // 文案按域给：§0.2 里三个域的「还没有东西」含义不同 —— launcher 是没选实例、server 是没建服务端、
  // dev 才是没打开项目。用同一句话会误导（例如在服务器域提示「打开或新建项目」）。
  if (!currentProjectId) {
    return <EmptyPanel message={emptyStateHintOfDomain(domain)} />;
  }

  // nbt 需要 store 接线包装，其余面板直接走 PanelHost
  if (activePanel === 'nbt') {
    return (
      <Suspense fallback={<PanelLoading />}>
        <NbtPanelWithStore />
      </Suspense>
    );
  }

  return <PanelHost panelId={activePanel} fallback={<PanelLoading />} />;
}
