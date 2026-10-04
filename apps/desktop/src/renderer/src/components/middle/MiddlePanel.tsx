import { useState, useEffect, useMemo, useCallback, Suspense, lazy } from 'react';
import { shallow } from 'zustand/shallow';
import { McIcon } from '../../assets/mc-ui/McIcon';
import { TabBar } from '../TabBar.js';
import { CodePreview } from '../CodePreview.js';
import { SplitCodeEditor } from '../SplitCodeEditor.js';
import { ShortcutHelpDialog } from '../ShortcutHelpDialog.js';
import { ResourcePackPreview } from '../ResourcePackPreview.js';
import { NbtEditor } from '../NbtEditor.js';
import { CommandPalette, type Command } from '../CommandPalette.js';
import { LowcodeWorkspace } from '../lowcode/LowcodeWorkspace.js';
import { PurecodeWorkspace } from '../purecode/PurecodeWorkspace.js';
import { useModStore } from '../../store/mod-store.js';
import { useEditorModeStore } from '../../store/editor-mode-store.js';
import { useLayoutStore, selectMiddleTab, selectSetMiddleTab } from '../../shell/layout-store.js';
import { ipcClient } from '../../lib/ipc-client.js';
import { withUnimplementedMd } from '../../lib/unimplemented-md.js';
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

  if (!registration) {
    return <PlaceholderPanel type={generatorType} />;
  }

  const { component: PreviewComponent } = registration;

  const LazyPreview = lazy(PreviewComponent);

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
  const middleTab = useLayoutStore(selectMiddleTab);
  const setMiddleTab = useLayoutStore(selectSetMiddleTab);

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
  const commands = useMemo<Command[]>(
    () => {
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
    },
    [setMiddleTab, setShortcutHelpOpen],
  );

  const handleOpenPalette = useCallback(() => setPaletteOpen(true), []);

  const handleTabKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        const idx = MIDDLE_TABS.indexOf(middleTab as MiddleTab);
        const next = e.key === 'ArrowRight'
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

      {/* Tab 内容 */}
      <div
        className="flex flex-1 flex-col overflow-hidden"
        role="tabpanel"
        id={`middle-tabpanel-${middleTab}`}
        aria-labelledby={`middle-tab-${middleTab}`}
        tabIndex={0}
      >
        {middleTab === 'preview' ? (
          <RenderPreviewPanel generatorType={generatorType} />
        ) : middleTab === 'lowcode' ? (
          editorMode === 'purecode' ? (
            <PurecodeWorkspace />
          ) : (
            <LowcodeWorkspace />
          )
        ) : middleTab === 'resources' ? (
          <ResourcePackPreview />
        ) : middleTab === 'nbt' ? (
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
        ) : (
          <>
            <TabBar />
            <div className="flex-1 overflow-hidden">
              {splitFile ? <SplitCodeEditor /> : <CodePreview />}
            </div>
          </>
        )}
      </div>

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