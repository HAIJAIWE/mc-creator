import { useState, useEffect, useMemo, useCallback } from 'react';
import { shallow } from 'zustand/shallow';
import { McIcon } from '../../assets/mc-ui/McIcon';
import { TabBar } from '../TabBar.js';
import { CodePreview } from '../CodePreview.js';
import { SplitCodeEditor } from '../SplitCodeEditor.js';
import { ShortcutHelpDialog } from '../ShortcutHelpDialog.js';
import { ServerPreviewPanel } from './ServerPreviewPanel.js';
import { ModPreviewPanel } from './ModPreviewPanel.js';
import { DatapackPreviewPanel } from './DatapackPreviewPanel.js';
import { ModpackPreviewPanel } from './ModpackPreviewPanel.js';
import { LauncherPreviewPanel } from './LauncherPreviewPanel.js';
import { ResourcePackPreviewPanel } from './ResourcePackPreviewPanel.js';
import { SkinPreviewPanel } from './SkinPreviewPanel.js';
import { KubejsPreviewPanel } from './KubejsPreviewPanel.js';
import { CraftTweakerPreviewPanel } from './CraftTweakerPreviewPanel.js';
import { BehaviorPackPreviewPanel } from './BehaviorPackPreviewPanel.js';
import { EnchantmentPreviewPanel } from './EnchantmentPreviewPanel.js';
import { ResourcePackPreview } from '../ResourcePackPreview.js';
import { NbtEditor } from '../NbtEditor.js';
import { CommandPalette, type Command } from '../CommandPalette.js';
import { LowcodeWorkspace } from '../lowcode/LowcodeWorkspace.js';
import { PurecodeWorkspace } from '../purecode/PurecodeWorkspace.js';
import { useModStore } from '../../store/mod-store.js';
import { useEditorModeStore } from '../../store/editor-mode-store.js';
import { ipcClient } from '../../lib/ipc-client.js';
import type { GeneratorType } from '@mc-creator/shared';

type MiddleTab = 'preview' | 'lowcode' | 'resources' | 'nbt' | 'code';

/**
 * 中间面板调度器：顶部 tab 切换（预览/资源/NBT/代码），预览 tab 按 generatorType 分发到对应面板。
 * 阶段 4 已实现全部 7 种类型（server/mod/datapack/modpack/resource_pack/skin/launcher）+ KubeJS。
 * 命令面板（F1/Ctrl+P/Ctrl+Shift+P）暴露保存/导出/新建/清空等操作，避免用户在多处工具栏间切换。
 */
export function MiddlePanel() {
  const [activeTab, setActiveTab] = useState<MiddleTab>('preview');
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
      // F1：打开命令面板（阻止浏览器默认帮助菜单）
      if (e.key === 'F1') {
        e.preventDefault();
        setPaletteOpen(true);
        return;
      }
      // Ctrl+P / Ctrl+Shift+P：Quick Open / 命令面板（与 VS Code 一致）
      if ((e.ctrlKey || e.metaKey) && (e.key === 'p' || e.key === 'P')) {
        e.preventDefault();
        setPaletteOpen(true);
        return;
      }
      // Ctrl+S：保存当前文件
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
      case 'behavior_pack':
        return <BehaviorPackPreviewPanel />;
      case 'enchantment':
        return <EnchantmentPreviewPanel />;
      default:
        return <PlaceholderPanel type={generatorType} />;
    }
  };

  // 构建命令列表：通过 useModStore.getState() 在运行时取最新状态，
  // 避免订阅过多字段触发不必要的重渲染。setActiveTab 由 useState 提供，引用稳定。
  const commands = useMemo<Command[]>(
    () => {
      const cmds: Command[] = [];

      // 保存当前文件（仅当存在选中文件时可用）
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

      // 保存全部文件到目录
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

      // 导出 zip
      cmds.push({
        id: 'export-zip',
        label: '导出为 ZIP',
        description: '打包所有文件为 zip',
        run: async () => {
          const s = useModStore.getState();
          if (s.files.length === 0) return;
          await ipcClient.exportZip({
            files: s.files,
            defaultName: `${s.generatorType}-export.zip`,
          });
        },
      });

      // 新建文件
      cmds.push({
        id: 'new-file',
        label: '新建文件',
        description: '在根目录创建新文件',
        run: () => {
          const name = prompt('请输入文件名（含扩展名）', 'new-file.json');
          if (name) useModStore.getState().createFile(name, '');
        },
      });

      // 切换到预览 Tab
      cmds.push({
        id: 'tab-preview',
        label: '切换到预览视图',
        description: '查看生成结果的预览面板',
        run: () => setActiveTab('preview'),
      });

      // 切换到低代码 Tab
      cmds.push({
        id: 'tab-lowcode',
        label: '切换到低代码视图',
        description: '打开节点图编辑器（L1 低代码 / L2 混合 / L3 纯代码）',
        run: () => setActiveTab('lowcode'),
      });

      // 切换到代码 Tab
      cmds.push({
        id: 'tab-code',
        label: '切换到代码视图',
        description: '查看 / 编辑生成文件源码',
        run: () => setActiveTab('code'),
      });

      // 切换到资源 Tab
      cmds.push({
        id: 'tab-resources',
        label: '切换到资源视图',
        description: '查看资源包实时预览（贴图/模型/语言/音效）',
        run: () => setActiveTab('resources'),
      });

      // 切换到 NBT Tab
      cmds.push({
        id: 'tab-nbt',
        label: '切换到 NBT 编辑器',
        description: '查看/编辑 NBT 数据（实体/方块实体/物品 NBT）',
        run: () => setActiveTab('nbt'),
      });

      // 清空所有文件
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

      // 分栏编辑
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

      // 快捷键帮助
      cmds.push({
        id: 'shortcut-help',
        label: '快捷键帮助',
        description: '查看全项目所有快捷键列表',
        run: () => setShortcutHelpOpen(true),
      });

      return cmds;
    },
    // setActiveTab 引用稳定（来自 useState），加入 deps 保证闭包正确
    [setActiveTab, setShortcutHelpOpen],
  );

  // 在 tab 栏点击 F1 提示徽标也能打开命令面板
  const handleOpenPalette = useCallback(() => setPaletteOpen(true), []);

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Tab 切换栏 */}
      <div
        role="tablist"
        aria-label="中间面板视图切换"
        className="flex items-center border-b border-mc-border bg-mc-surface px-2 py-1"
        onKeyDown={(e) => {
          if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
            e.preventDefault();
            const tabs: MiddleTab[] = ['preview', 'lowcode', 'resources', 'nbt', 'code'];
            const idx = tabs.indexOf(activeTab);
            const next = e.key === 'ArrowRight' ? tabs[(idx + 1) % 5] : tabs[(idx - 1 + 5) % 5];
            setActiveTab(next);
            // 焦点跟随选中项移动（WAI-ARIA Tabs 模式：箭头键切换 + 自动聚焦新 tab）
            const nextBtn = document.getElementById(`middle-tab-${next}`);
            nextBtn?.focus();
          }
        }}
      >
        <button
          id="middle-tab-preview"
          role="tab"
          aria-selected={activeTab === 'preview'}
          aria-controls="middle-tabpanel-preview"
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
          id="middle-tab-lowcode"
          role="tab"
          aria-selected={activeTab === 'lowcode'}
          aria-controls="middle-tabpanel-lowcode"
          tabIndex={activeTab === 'lowcode' ? 0 : -1}
          onClick={() => setActiveTab('lowcode')}
          className={`flex items-center gap-1.5 rounded-mc px-3 py-1 text-xs font-medium transition-colors ${
            activeTab === 'lowcode'
              ? 'bg-mc-surface-2 text-mc-text border-b-2 border-mc-accent'
              : 'text-mc-dim hover:bg-mc-surface-2/60 hover:text-mc-text'
          }`}
        >
          <McIcon scope="pixel" name="grid" size={12} />
          低代码
        </button>
        <button
          id="middle-tab-resources"
          role="tab"
          aria-selected={activeTab === 'resources'}
          aria-controls="middle-tabpanel-resources"
          tabIndex={activeTab === 'resources' ? 0 : -1}
          onClick={() => setActiveTab('resources')}
          className={`flex items-center gap-1.5 rounded-mc px-3 py-1 text-xs font-medium transition-colors ${
            activeTab === 'resources'
              ? 'bg-mc-surface-2 text-mc-text border-b-2 border-mc-accent'
              : 'text-mc-dim hover:bg-mc-surface-2/60 hover:text-mc-text'
          }`}
        >
          <McIcon scope="pixel" name="image" size={12} />
          资源
        </button>
        <button
          id="middle-tab-nbt"
          role="tab"
          aria-selected={activeTab === 'nbt'}
          aria-controls="middle-tabpanel-nbt"
          tabIndex={activeTab === 'nbt' ? 0 : -1}
          onClick={() => setActiveTab('nbt')}
          className={`flex items-center gap-1.5 rounded-mc px-3 py-1 text-xs font-medium transition-colors ${
            activeTab === 'nbt'
              ? 'bg-mc-surface-2 text-mc-text border-b-2 border-mc-accent'
              : 'text-mc-dim hover:bg-mc-surface-2/60 hover:text-mc-text'
          }`}
        >
          <McIcon scope="pixel" name="box" size={12} />
          NBT
        </button>
        <button
          id="middle-tab-code"
          role="tab"
          aria-selected={activeTab === 'code'}
          aria-controls="middle-tabpanel-code"
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

      {/* Tab 内容（WAI-ARIA Tabpanel：role="tabpanel" + aria-labelledby 关联 tab） */}
      <div
        className="flex flex-1 flex-col overflow-hidden"
        role="tabpanel"
        id={`middle-tabpanel-${activeTab}`}
        aria-labelledby={`middle-tab-${activeTab}`}
        tabIndex={0}
      >
        {activeTab === 'preview' ? (
          renderPreviewPanel()
        ) : activeTab === 'lowcode' ? (
          editorMode === 'purecode' ? (
            <PurecodeWorkspace />
          ) : (
            <LowcodeWorkspace />
          )
        ) : activeTab === 'resources' ? (
          <ResourcePackPreview />
        ) : activeTab === 'nbt' ? (
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
