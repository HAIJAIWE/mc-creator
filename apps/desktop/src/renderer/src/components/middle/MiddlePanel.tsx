import { useState, useEffect, useMemo, useCallback, Suspense, lazy } from 'react';
import { shallow } from 'zustand/shallow';
import { McIcon } from '../../assets/mc-ui/McIcon';
import { TabBar } from '../TabBar.js';
// CodePreview / SplitCodeEditor / PurecodeWorkspace 静态闭包含 <Editor>，
// 必须经 withMonacoSetup 包裹后再 lazy 化，否则 loader.init() 会走 CDN 分支被 CSP 拦掉。
// LowcodeWorkspace 闭包 142 文件但不含 <Editor>，仅需 lazy 化减体积。
// ResourcePackPreview / NbtEditor 无 Monaco 依赖，保持静态 import。
const CodePreview = lazy(
  withMonacoSetup(() => import('../CodePreview.js').then((m) => ({ default: m.CodePreview }))),
);
const SplitCodeEditor = lazy(
  withMonacoSetup(() =>
    import('../SplitCodeEditor.js').then((m) => ({ default: m.SplitCodeEditor })),
  ),
);
const PurecodeWorkspace = lazy(
  withMonacoSetup(() =>
    import('../purecode/PurecodeWorkspace.js').then((m) => ({ default: m.PurecodeWorkspace })),
  ),
);
const LowcodeWorkspace = lazy(() =>
  import('../lowcode/LowcodeWorkspace.js').then((m) => ({ default: m.LowcodeWorkspace })),
);
import { ShortcutHelpDialog } from '../ShortcutHelpDialog.js';
import { ResourcePackPreview } from '../ResourcePackPreview.js';
import { NbtEditor } from '../NbtEditor.js';
import { CommandPalette, type Command } from '../CommandPalette.js';
import { useModStore } from '../../store/mod-store.js';
import { useEditorModeStore } from '../../store/editor-mode-store.js';
import { useLayoutStore, selectMiddleTab, selectSetMiddleTab } from '../../shell/layout-store.js';
import { ipcClient } from '../../lib/ipc-client.js';
import { withUnimplementedMd } from '../../lib/unimplemented-md.js';
import { withMonacoSetup } from '../../lib/lazy-monaco.js';
import { getPreviewPanel } from '../../shell/preview-registry.js';
import type { GeneratorType } from '@mc-creator/shared';
import { GENERATOR_DESCRIPTORS } from '../../../../shared/generator-descriptors.js';

type MiddleTab = 'preview' | 'lowcode' | 'resources' | 'nbt' | 'code';

/** tab 顺序即视觉顺序，同时决定左右箭头键的循环顺序 */
const MIDDLE_TABS: MiddleTab[] = ['preview', 'lowcode', 'resources', 'nbt', 'code'];

function PreviewPanelFallback() {
  return (
    <div className="flex flex-1 items-center justify-center bg-mc-bg text-sm text-mc-mute">
      加载预览…
    </div>
  );
}

function PlaceholderPanel({ type }: { type: GeneratorType }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 bg-mc-bg">
      <div className="flex h-16 w-16 items-center justify-center rounded-mc-lg border border-mc-border bg-mc-surface-2">
        <McIcon scope="pixel" name="box" size={32} className="text-mc-mute" />
      </div>
      <div className="text-sm font-medium text-mc-dim">
        {GENERATOR_DESCRIPTORS[type]?.label?.zh ?? type} 预览面板开发中
      </div>
      <div className="text-xs text-mc-mute">
        阶段 2-4 实现该类型，当前可切换到「代码」tab 查看文件
      </div>
    </div>
  );
}

function RenderPreviewPanel({ generatorType }: { generatorType: GeneratorType }) {
  const registration = getPreviewPanel(generatorType);

  // useMemo 必须在 early return 之前调用（React Hooks 规则）。
  // 固定 lazy 对象引用，防止每次渲染都新建导致 React 按
  // elementType 引用比较判为不同组件 → 整棵子树卸载重建（用户按 F1 丢预览状态）。
  // 收益为零的 lazy：RenderPreviewPanel 只在 middleTab==='preview' 时被调用，
  // registry loader 的 import() 本来就不会在 tab 不激活时触发。
  const LazyPreview = useMemo(
    () => (registration ? lazy(registration.component) : null),
    [registration],
  );

  if (!registration || LazyPreview === null) {
    return <PlaceholderPanel type={generatorType} />;
  }

  return (
    <Suspense fallback={<PreviewPanelFallback />}>
      <LazyPreview />
    </Suspense>
  );
}

/**
 * 中间面板调度器：顶部 tab 切换（预览/低代码/资源/NBT/代码），
 * 预览 tab 按 generatorType 从注册表分发到对应面板，
 * 低代码 tab 按 editorMode（L1/L2/L3）在 LowcodeWorkspace / PurecodeWorkspace 间切换。
 */
export function MiddlePanel() {
  // 从 layout-store 读取/写入 middleTab（持久化）
  // layout-store 的 middleTab 类型是 string（跨 localStorage 的持久化值），
  // 这里收窄为 MiddleTab：MEMBER_OF_MIDDLE_TABS 是真值来源，
  // 旧版本残留的非法值（如已删除的 'lowcode'）会被回落成 'preview' 而不是静默失配。
  const rawMiddleTab = useLayoutStore(selectMiddleTab);
  const setMiddleTab = useLayoutStore(selectSetMiddleTab);
  const middleTab = MIDDLE_TABS.includes(rawMiddleTab as MiddleTab)
    ? (rawMiddleTab as MiddleTab)
    : 'preview';

  /**
   * 已访问过的 tab。
   *
   * a11y 要求 5 个 tabpanel 容器同时存在（否则 tab 的 aria-controls 指向空气），
   * 但内容不能无条件挂载 —— LowcodeWorkspace 的闭包 142 个文件，
   * 无条件渲染等于用户停在 preview tab 时就把它加载了。
   *
   * 这个集合让「首次访问才挂载、之后保持挂载」：
   * - 未访问：容器在（满足 a11y），内容不在（不付加载代价）
   * - 已访问：内容保留，切走不丢状态（IDE 的编辑器行为）
   */
  const [visited, setVisited] = useState<ReadonlySet<MiddleTab>>(() => new Set([middleTab]));
  useEffect(() => {
    setVisited((prev: ReadonlySet<MiddleTab>) =>
      prev.has(middleTab) ? prev : new Set<MiddleTab>(prev).add(middleTab),
    );
  }, [middleTab]);

  const { generatorType, splitFile } = useModStore(
    (s) => ({ generatorType: s.generatorType, splitFile: s.splitFile }),
    shallow,
  );
  // L3 纯代码模式分支：purecode 渲染 PurecodeWorkspace，其余仍用 LowcodeWorkspace
  const editorMode = useEditorModeStore((s) => s.mode);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [shortcutHelpOpen, setShortcutHelpOpen] = useState(false);

  // 全局快捷键：F1 / Ctrl+P / Ctrl+Shift+P 打开命令面板，Ctrl+S 保存当前文件
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'F1') {
        e.preventDefault();
        setPaletteOpen(true);
        return;
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'p' || e.key === 'P')) {
        e.preventDefault();
        setPaletteOpen(true);
        return;
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) {
        e.preventDefault();
        const s = useModStore.getState();
        const f = s.files.find((x) => x.path === s.selectedFile);
        if (!f) return;
        void ipcClient
          .saveFile({
            path: f.path,
            content: f.content,
            defaultName: f.path.split('/').pop() || 'file.txt',
          })
          .then((res) => {
            if (res.ok) s.markFileClean(f.path);
          });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // 构建命令列表
  const commands = useMemo<Command[]>(() => {
    const cmds: Command[] = [];

    cmds.push({
      id: 'save-file',
      label: '保存当前文件',
      description: '将当前选中文件另存到本地',
      shortcut: 'Ctrl+S',
      run: async () => {
        const s = useModStore.getState();
        const f = s.files.find((x) => x.path === s.selectedFile);
        if (!f) return;
        const res = await ipcClient.saveFile({
          path: f.path,
          content: f.content,
          defaultName: f.path.split('/').pop() || 'file.txt',
        });
        if (res.ok) s.markFileClean(f.path);
      },
    });

    cmds.push({
      id: 'save-all',
      label: '保存全部文件到目录',
      description: '选择一个目录后保存所有文件',
      run: async () => {
        const s = useModStore.getState();
        if (s.files.length === 0) return;
        const res = await ipcClient.saveAllFiles({ files: s.files });
        if (res.ok) s.markAllClean();
      },
    });

    cmds.push({
      id: 'export-zip',
      label: '导出为 ZIP',
      description: '打包所有文件为 zip',
      run: async () => {
        const s = useModStore.getState();
        if (s.files.length === 0) return;
        await ipcClient.exportZip({
          files: withUnimplementedMd(s.files, s.unimplemented),
          defaultName: `${s.generatorType}-export.zip`,
        });
      },
    });

    cmds.push({
      id: 'new-file',
      label: '新建文件',
      description: '在根目录创建新文件',
      run: () => {
        const name = prompt('请输入文件名（含扩展名）', 'new-file.json');
        if (name) useModStore.getState().createFile(name, '');
      },
    });

    for (const tab of MIDDLE_TABS) {
      const labelMap: Record<MiddleTab, string> = {
        preview: '预览',
        lowcode: '低代码',
        resources: '资源',
        nbt: 'NBT',
        code: '代码',
      };
      cmds.push({
        id: `tab-${tab}`,
        label: `切换到${labelMap[tab]}视图`,
        run: () => setMiddleTab(tab),
      });
    }

    cmds.push({
      id: 'clear-files',
      label: '清空所有文件',
      description: '清空当前生成的文件列表',
      run: () => {
        if (confirm('确定清空所有文件？')) {
          useModStore.getState().setFiles([]);
        }
      },
    });

    cmds.push({
      id: 'toggle-split',
      label: '切换分栏编辑',
      description: '打开/关闭右侧分栏面板',
      run: () => {
        const s = useModStore.getState();
        if (s.splitFile) {
          s.setSplitFile(null);
        } else {
          const other = s.files.find((f) => f.path !== s.selectedFile);
          if (other) s.setSplitFile(other.path);
        }
      },
    });

    cmds.push({
      id: 'shortcut-help',
      label: '快捷键帮助',
      description: '查看全项目所有快捷键列表',
      run: () => setShortcutHelpOpen(true),
    });

    return cmds;
  }, [setMiddleTab, setShortcutHelpOpen]);

  const handleOpenPalette = useCallback(() => setPaletteOpen(true), []);

  const handleTabKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        const idx = MIDDLE_TABS.indexOf(middleTab as MiddleTab);
        const next =
          e.key === 'ArrowRight'
            ? MIDDLE_TABS[(idx + 1) % MIDDLE_TABS.length]
            : MIDDLE_TABS[(idx - 1 + MIDDLE_TABS.length) % MIDDLE_TABS.length];
        setMiddleTab(next);
        const nextBtn = document.getElementById(`middle-tab-${next}`);
        nextBtn?.focus();
      }
    },
    [middleTab, setMiddleTab],
  );

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Tab 切换栏 */}
      <div
        role="tablist"
        aria-label="中间面板视图切换"
        className="flex items-center border-b border-mc-border bg-mc-surface px-2 py-1"
        onKeyDown={handleTabKeyDown}
      >
        <button
          id="middle-tab-preview"
          role="tab"
          aria-selected={middleTab === 'preview'}
          aria-controls="middle-tabpanel-preview"
          tabIndex={middleTab === 'preview' ? 0 : -1}
          onClick={() => setMiddleTab('preview')}
          className={`mc-tab px-3 py-1 ${middleTab === 'preview' ? 'mc-tab-selected' : 'mc-tab-idle'}`}
        >
          <McIcon scope="pixel" name="star" size={12} />
          预览
        </button>
        <button
          id="middle-tab-lowcode"
          role="tab"
          aria-selected={middleTab === 'lowcode'}
          aria-controls="middle-tabpanel-lowcode"
          tabIndex={middleTab === 'lowcode' ? 0 : -1}
          onClick={() => setMiddleTab('lowcode')}
          className={`mc-tab px-3 py-1 ${middleTab === 'lowcode' ? 'mc-tab-selected' : 'mc-tab-idle'}`}
        >
          <McIcon scope="pixel" name="grid" size={12} />
          低代码
        </button>
        <button
          id="middle-tab-resources"
          role="tab"
          aria-selected={middleTab === 'resources'}
          aria-controls="middle-tabpanel-resources"
          tabIndex={middleTab === 'resources' ? 0 : -1}
          onClick={() => setMiddleTab('resources')}
          className={`mc-tab px-3 py-1 ${middleTab === 'resources' ? 'mc-tab-selected' : 'mc-tab-idle'}`}
        >
          <McIcon scope="pixel" name="image" size={12} />
          资源
        </button>
        <button
          id="middle-tab-nbt"
          role="tab"
          aria-selected={middleTab === 'nbt'}
          aria-controls="middle-tabpanel-nbt"
          tabIndex={middleTab === 'nbt' ? 0 : -1}
          onClick={() => setMiddleTab('nbt')}
          className={`mc-tab px-3 py-1 ${middleTab === 'nbt' ? 'mc-tab-selected' : 'mc-tab-idle'}`}
        >
          <McIcon scope="pixel" name="box" size={12} />
          NBT
        </button>
        <button
          id="middle-tab-code"
          role="tab"
          aria-selected={middleTab === 'code'}
          aria-controls="middle-tabpanel-code"
          tabIndex={middleTab === 'code' ? 0 : -1}
          onClick={() => setMiddleTab('code')}
          className={`mc-tab px-3 py-1 ${middleTab === 'code' ? 'mc-tab-selected' : 'mc-tab-idle'}`}
        >
          <McIcon scope="pixel" name="terminal" size={12} />
          代码
        </button>

        {/* 右侧：F1 命令面板入口 */}
        <button
          onClick={handleOpenPalette}
          title="打开命令面板（F1）"
          aria-label="打开命令面板（F1）"
          className="ml-auto flex items-center gap-1 rounded-mc border border-mc-border bg-mc-surface-2 px-2 py-0.5 text-xs text-mc-dim transition-colors hover:bg-mc-surface-3 hover:text-mc-text"
        >
          <span>命令面板</span>
          <span
            className="rounded-mc bg-mc-surface-3 px-1 py-0.5 text-[10px] text-mc-mute"
            aria-hidden="true"
          >
            F1
          </span>
        </button>
      </div>

      {/* Tab 内容 —— 所有 tabpanel 容器同时渲染（未激活的 hidden），修复 aria-controls 指向不存在的元素。

          重内容只在**访问过**该 tab 之后才挂载：LowcodeWorkspace 的静态闭包 142 个文件
          （React Flow 节点体系 + Monaco），若 5 个 tabpanel 无条件渲染内容，
          用户停在 preview tab 时它就已被 import —— 阶段 7 的 Monaco 体积优化会被抵消。
          visited 让切过的 tab 保持挂载（IDE 行为：切走不丢状态）。 */}
      <>
        <div
          role="tabpanel"
          id="middle-tabpanel-preview"
          aria-labelledby="middle-tab-preview"
          tabIndex={0}
          hidden={middleTab !== 'preview'}
          className="min-h-0 flex-1 overflow-hidden"
        >
          <div className="flex h-full flex-col overflow-hidden">
            {visited.has('preview') && <RenderPreviewPanel generatorType={generatorType} />}
          </div>
        </div>

        <div
          role="tabpanel"
          id="middle-tabpanel-lowcode"
          aria-labelledby="middle-tab-lowcode"
          tabIndex={0}
          hidden={middleTab !== 'lowcode'}
          className="min-h-0 flex-1 overflow-hidden"
        >
          <div className="flex h-full flex-col overflow-hidden">
            {visited.has('lowcode') && (
              <Suspense fallback={<div className="p-3 text-mc-dim">加载低代码…</div>}>
                {editorMode === 'purecode' ? <PurecodeWorkspace /> : <LowcodeWorkspace />}
              </Suspense>
            )}
          </div>
        </div>

        <div
          role="tabpanel"
          id="middle-tabpanel-resources"
          aria-labelledby="middle-tab-resources"
          tabIndex={0}
          hidden={middleTab !== 'resources'}
          className="min-h-0 flex-1 overflow-hidden"
        >
          <div className="flex h-full flex-col overflow-hidden">
            {visited.has('resources') && <ResourcePackPreview />}
          </div>
        </div>

        <div
          role="tabpanel"
          id="middle-tabpanel-nbt"
          aria-labelledby="middle-tab-nbt"
          tabIndex={0}
          hidden={middleTab !== 'nbt'}
          className="min-h-0 flex-1 overflow-hidden"
        >
          <div className="flex h-full flex-col overflow-hidden">
            {visited.has('nbt') && (
              <NbtEditor
                initialValue={(() => {
                  const s = useModStore.getState();
                  const f = s.files.find((x) => x.path === s.selectedFile);
                  return f && !f.path.endsWith('.png') ? f.content : '{}';
                })()}
                onChange={(snbt) => {
                  const s = useModStore.getState();
                  if (s.selectedFile) s.updateFileContent(s.selectedFile, snbt);
                }}
              />
            )}
          </div>
        </div>

        <div
          role="tabpanel"
          id="middle-tabpanel-code"
          aria-labelledby="middle-tab-code"
          tabIndex={0}
          hidden={middleTab !== 'code'}
          className="min-h-0 flex-1 overflow-hidden"
        >
          <div className="flex h-full flex-col overflow-hidden">
            {visited.has('code') && (
              <>
                <TabBar />
                <Suspense fallback={<div className="p-3 text-mc-dim">加载编辑器…</div>}>
                  <div className="flex-1 overflow-hidden">
                    {splitFile ? <SplitCodeEditor /> : <CodePreview />}
                  </div>
                </Suspense>
              </>
            )}
          </div>
        </div>
      </>

      {/* 命令面板（F1 触发） */}
      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        commands={commands}
      />

      {/* 快捷键帮助对话框 */}
      <ShortcutHelpDialog open={shortcutHelpOpen} onClose={() => setShortcutHelpOpen(false)} />
    </div>
  );
}
