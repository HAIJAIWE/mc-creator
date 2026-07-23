import { useState, useCallback, useEffect, useRef } from 'react';
import type { NodeKind } from '@mc-creator/shared';
import { NodePalette } from './NodePalette';
import { NodeGraphEditor } from './NodeGraphEditor';
import { SubgraphWorkspace } from './subgraph/SubgraphWorkspace.js';
import { NodeDetailDrawer } from './nodes/drawer/NodeDetailDrawer.js';
import { CodeNodeEditor } from './CodeNodeEditor';
import { ModeSwitcher } from './ModeSwitcher';
import { GeneratedCodePreview } from './GeneratedCodePreview.js';
import { useNodeGraphStore } from '../../store/node-graph-store.js';
import { useEditorModeStore } from '../../store/editor-mode-store.js';
import { compileNodeGraph } from '../../lib/compileNodeGraph.js';
import { downloadGraphAsJson } from '../../lib/nodeGraphSerializer.js';
import { saveGraphToDisk, loadGraphFromDisk } from '../../lib/nodeGraphPersistence.js';
import { useRecentGraphs } from '../../lib/useRecentGraphs.js';
import { useLiveRegion } from '../../lib/useLiveRegion.js';
import { RecentGraphsMenu } from './RecentGraphsMenu.js';
import { DebuggerPanel } from './DebuggerPanel.js';
import { McIcon } from '../../assets/mc-ui/McIcon';
import { OnboardingTour } from './onboarding/OnboardingTour.js';

/** 编译消息占位（Plan C 接入编译器输出后替换为真实消息） */
const EMPTY_COMPILE_MESSAGES: { type: 'error' | 'warning'; nodeId: string; message: string }[] = [];

/** localStorage key：完成引导标记 */
const ONBOARDING_KEY = 'mc-creator:onboarding-completed';
/** 引导总步数（与 ONBOARDING_STEPS 长度一致） */
const ONBOARDING_TOTAL = 5;

/** 安全访问 localStorage（测试环境/non-browser 下可能不存在） */
function readOnboardingCompleted(): boolean {
  try {
    return typeof localStorage !== 'undefined'
      ? localStorage.getItem(ONBOARDING_KEY) === '1'
      : false;
  } catch {
    return false;
  }
}

function writeOnboardingCompleted(): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(ONBOARDING_KEY, '1');
  } catch {
    /* ignore */
  }
}

interface LowcodeWorkspaceProps {
  /** 是否只读（预览模式） */
  readOnly?: boolean;
}

/**
 * 低代码工作区：三栏布局
 *
 * ┌──────────────────────────────────────────────────────┐
 * │  顶部工具栏：ModeSwitcher + 编译 + 撤销/重做           │
 * ├────────┬──────────────────────────┬─────────────────┤
 * │        │                          │                 │
 * │ 节点库  │       React Flow 画布     │   属性面板       │
 * │ 200px  │       (flex-1)            │   280px         │
 * │        │                          │                 │
 * └────────┴──────────────────────────┴─────────────────┘
 */
export function LowcodeWorkspace({ readOnly = false }: LowcodeWorkspaceProps) {
  const [codeNodeId, setCodeNodeId] = useState<string | null>(null);
  const [paletteWidth] = useState(220);
  /** 预览面板宽度（右侧第 4 栏，仅 showPreview=true 时显示） */
  const [previewWidth] = useState(420);
  /** 是否显示生成代码实时预览面板 */
  const [showPreview, setShowPreview] = useState(false);
  /** 隐藏的文件输入元素 ref（用于导入节点图 JSON） */
  const importInputRef = useRef<HTMLInputElement>(null);
  /** 是否展开「最近打开」下拉 */
  const [showRecent, setShowRecent] = useState(false);
  /** 当前引导步骤索引（null 表示未启动） */
  const [onboardingStep, setOnboardingStep] = useState<number | null>(null);

  // 首次打开自动启动引导（localStorage 无完成标记时启动）
  useEffect(() => {
    if (!readOnboardingCompleted()) {
      setOnboardingStep(0);
    }
  }, []);

  const handleOnboardingNext = useCallback(() => {
    setOnboardingStep((prev) => {
      if (prev === null) return null;
      if (prev >= ONBOARDING_TOTAL - 1) {
        writeOnboardingCompleted();
        return null;
      }
      return prev + 1;
    });
  }, []);

  const handleOnboardingSkip = useCallback(() => {
    writeOnboardingCompleted();
    setOnboardingStep(null);
  }, []);

  const handleOnboardingRestart = useCallback(() => {
    setOnboardingStep(0);
  }, []);
  /** 最近打开的节点图列表 + 刷新操作 */
  const { recent, refresh: refreshRecent } = useRecentGraphs();
  /** 屏幕阅读器动态通知（保存/加载/导入/导出状态） */
  const { announce, LiveRegion } = useLiveRegion({ clearAfterMs: 3000 });

  const mode = useEditorModeStore((s) => s.mode);
  const graph = useNodeGraphStore((s) => s.graph);
  const addNode = useNodeGraphStore((s) => s.addNode);
  const undo = useNodeGraphStore((s) => s.undo);
  const redo = useNodeGraphStore((s) => s.redo);
  const clear = useNodeGraphStore((s) => s.clear);
  const commit = useNodeGraphStore((s) => s.commit);
  const selectNode = useNodeGraphStore((s) => s.selectNode);
  const collapseAll = useNodeGraphStore((s) => s.collapseAll);
  const expandAll = useNodeGraphStore((s) => s.expandAll);
  const undoStack = useNodeGraphStore((s) => s.undoStack);
  const redoStack = useNodeGraphStore((s) => s.redoStack);
  const setCompileResult = useNodeGraphStore((s) => s.setCompileResult);
  const compileResult = useNodeGraphStore((s) => s.compileResult);
  const exportGraph = useNodeGraphStore((s) => s.exportGraph);
  const importGraph = useNodeGraphStore((s) => s.importGraph);
  // 阶段 C：当前正在编辑的子图 id（非 null 时用 SubgraphWorkspace 替代主画布）
  const editingSubgraphId = useNodeGraphStore((s) => s.editingSubgraphId);

  // 键盘快捷键：撤销/重做/复制/取消选中
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // 只读模式不响应快捷键
      if (readOnly) return;

      // 避免 Monaco 编辑器（CodeNodeEditorDialog）内触发
      // target 可能是 window/document（无 closest 方法），需做类型守卫
      const target = e.target;
      if (target instanceof HTMLElement && target.closest('.monaco-editor')) return;

      const isCtrl = e.ctrlKey || e.metaKey;

      // Ctrl+Shift+Z：重做（优先判定，避免与 Ctrl+Z 撤销冲突）
      if (isCtrl && e.shiftKey && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault();
        redo();
        return;
      }
      // Ctrl+Y：重做
      if (isCtrl && (e.key === 'y' || e.key === 'Y')) {
        e.preventDefault();
        redo();
        return;
      }
      // Ctrl+Z（无 Shift）：撤销
      if (isCtrl && !e.shiftKey && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault();
        undo();
        return;
      }
      // Ctrl+D：复制选中节点
      if (isCtrl && (e.key === 'd' || e.key === 'D')) {
        e.preventDefault();
        const { selectedNodeId, duplicateNode } = useNodeGraphStore.getState();
        if (selectedNodeId) duplicateNode(selectedNodeId);
        return;
      }
      // Escape：取消选中
      if (e.key === 'Escape') {
        selectNode(null);
        return;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [readOnly, undo, redo, selectNode]);

  // 在画布中心创建节点
  const handleNodeClick = useCallback(
    (kind: NodeKind) => {
      if (readOnly) return;
      commit();
      // 随机位置（避免重叠），实际可基于视口中心计算
      const offset = graph.nodes.length * 30;
      addNode(kind, { x: 200 + offset, y: 150 + offset });
    },
    [readOnly, commit, graph.nodes.length, addNode],
  );

  // 编译节点图：结果存入 store，由 NodeGraphEditor 高亮错误节点、工具栏徽章显示状态
  const handleCompile = useCallback(() => {
    const result = compileNodeGraph(graph);
    setCompileResult(result);
  }, [graph, setCompileResult]);

  // 导出节点图为 JSON 文件（触发浏览器下载）
  const handleExport = useCallback(() => {
    const json = exportGraph();
    const filename = `${graph.modId || 'untitled'}-node-graph.json`;
    downloadGraphAsJson(json, filename);
  }, [exportGraph, graph.modId]);

  // 点击导入按钮 → 触发隐藏的 file input
  const handleImportClick = useCallback(() => {
    importInputRef.current?.click();
  }, []);

  // 选择文件后读取并导入节点图
  const handleImportFile = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        const json = String(reader.result);
        const result = importGraph(json);
        if (!result.ok) {
          window.alert(`导入失败：${result.error}`);
        }
      };
      reader.onerror = () => {
        window.alert('读取文件失败，请重试');
      };
      reader.readAsText(file);
      // 清空 input value，便于重复导入同一文件
      e.target.value = '';
    },
    [importGraph],
  );

  // 保存节点图到磁盘（通过 IPC 调用主进程 fs，弹保存对话框）
  const handleSaveToDisk = useCallback(async () => {
    const res = await saveGraphToDisk(graph);
    if (res.ok) {
      announce(`已保存到 ${res.path}`);
      refreshRecent();
    } else if (res.error !== 'canceled') {
      window.alert(`保存失败：${res.error}`);
    }
  }, [graph, announce, refreshRecent]);

  // 从磁盘加载节点图（弹打开对话框 → 读取 → 反序列化 → 写入 store）
  const handleLoadFromDisk = useCallback(async () => {
    const bridge = (
      window as unknown as {
        api?: {
          nodeGraph?: {
            showOpenDialog(): Promise<{ ok: true; filePath: string } | { ok: false }>;
          };
        };
      }
    ).api?.nodeGraph;
    if (!bridge) {
      window.alert('持久化桥接未注入，无法加载');
      return;
    }
    const openRes = await bridge.showOpenDialog();
    if (!openRes.ok) return; // 用户取消
    const res = await loadGraphFromDisk(openRes.filePath);
    if (res.ok) {
      commit();
      useNodeGraphStore.getState().loadGraph(res.graph);
      announce('节点图已加载');
    } else {
      window.alert(`加载失败：${res.error}`);
    }
  }, [commit, announce]);

  // 从最近列表加载
  const handleOpenRecent = useCallback(
    async (filePath: string) => {
      const res = await loadGraphFromDisk(filePath);
      if (res.ok) {
        commit();
        useNodeGraphStore.getState().loadGraph(res.graph);
        announce('节点图已加载');
      } else {
        window.alert(`加载失败：${res.error}`);
      }
      setShowRecent(false);
    },
    [commit, announce],
  );

  // 双击代码节点打开编辑器
  const handleNodeDoubleClick = useCallback((nodeId: string, kind: NodeKind) => {
    if (kind === 'code') {
      setCodeNodeId(nodeId);
    }
  }, []);

  // L1 模式下禁用 CodeNode
  const disableCodeNode = mode === 'lowcode';

  // 编译状态徽章（未编译时不显示）
  const compileStatus = compileResult
    ? compileResult.errors.length > 0
      ? {
          cls: 'bg-red-500/20 text-red-400',
          text: `✗ ${compileResult.errors.length} 个错误`,
          label: `编译失败：${compileResult.errors.length} 个错误`,
        }
      : compileResult.warnings.length > 0
        ? {
            cls: 'bg-yellow-500/20 text-yellow-400',
            text: `⚠ ${compileResult.warnings.length} 个警告`,
            label: `编译通过，但有 ${compileResult.warnings.length} 个警告`,
          }
        : {
            cls: 'bg-green-500/20 text-green-400',
            text: '✓ 编译通过',
            label: '编译通过',
          }
    : null;

  return (
    <div className="flex h-full flex-col bg-mc-bg" role="application" aria-label="低代码工作区">
      {/* 顶部工具栏 */}
      <div className="flex items-center gap-3 border-b border-mc-border bg-mc-surface px-3 py-1.5">
        <div className="flex items-center gap-2">
          <McIcon
            scope="pixel"
            name="portal"
            size={16}
            className="text-mc-accent"
            aria-hidden="true"
          />
          <span className="text-xs font-medium text-mc-text">低代码编辑器</span>
        </div>

        <div className="mx-2 h-4 w-px bg-mc-border" aria-hidden="true" />

        <ModeSwitcher disabled={readOnly} />

        <div className="mx-2 h-4 w-px bg-mc-border" aria-hidden="true" />

        {/* 撤销/重做 */}
        {!readOnly && (
          <div className="flex items-center gap-1" role="group" aria-label="历史操作">
            <button
              type="button"
              onClick={undo}
              disabled={undoStack.length === 0}
              aria-label="撤销"
              title="撤销 (Ctrl+Z)"
              className="rounded-mc p-1 text-mc-dim transition-colors hover:bg-mc-surface-2 hover:text-mc-text disabled:cursor-not-allowed disabled:opacity-40"
            >
              ↶
            </button>
            <button
              type="button"
              onClick={redo}
              disabled={redoStack.length === 0}
              aria-label="重做"
              title="重做 (Ctrl+Y)"
              className="rounded-mc p-1 text-mc-dim transition-colors hover:bg-mc-surface-2 hover:text-mc-text disabled:cursor-not-allowed disabled:opacity-40"
            >
              ↷
            </button>
          </div>
        )}

        {/* 清空 */}
        {!readOnly && (
          <button
            type="button"
            onClick={() => {
              if (window.confirm('确定清空所有节点？此操作可撤销。')) {
                commit();
                clear();
              }
            }}
            aria-label="清空画布"
            title="清空画布"
            className="rounded-mc px-2 py-1 text-[11px] text-mc-mute transition-colors hover:bg-red-500/20 hover:text-red-400"
          >
            清空
          </button>
        )}

        {/* 导出 / 导入（节点图 JSON 文件） */}
        {!readOnly && (
          <div className="flex items-center gap-1" role="group" aria-label="导入导出">
            <button
              type="button"
              onClick={handleExport}
              aria-label="导出节点图为 JSON 文件"
              title="导出当前节点图为 .json 文件"
              className="rounded-mc px-2 py-1 text-[11px] text-mc-mute transition-colors hover:bg-mc-surface-2 hover:text-mc-text"
            >
              ⬆ 导出
            </button>
            <button
              type="button"
              onClick={handleImportClick}
              aria-label="从 JSON 文件导入节点图"
              title="从 .json 文件导入节点图"
              className="rounded-mc px-2 py-1 text-[11px] text-mc-mute transition-colors hover:bg-mc-surface-2 hover:text-mc-text"
            >
              ⬇ 导入
            </button>
            {/* 隐藏的 file input：accept=application/json，单文件选择 */}
            <input
              ref={importInputRef}
              type="file"
              accept="application/json,.json"
              onChange={handleImportFile}
              className="hidden"
              aria-hidden="true"
              tabIndex={-1}
            />
          </div>
        )}

        {/* 持久化到磁盘（通过 IPC 写入主进程文件系统） */}
        {!readOnly && (
          <div className="flex items-center gap-1" role="group" aria-label="磁盘持久化">
            <button
              type="button"
              onClick={handleSaveToDisk}
              aria-label="保存节点图到磁盘"
              title="保存到磁盘文件（.json）"
              className="rounded-mc px-2 py-1 text-[11px] text-mc-mute transition-colors hover:bg-mc-surface-2 hover:text-mc-text"
            >
              💾 存盘
            </button>
            <button
              type="button"
              onClick={handleLoadFromDisk}
              aria-label="从磁盘加载节点图"
              title="从磁盘文件加载节点图"
              className="rounded-mc px-2 py-1 text-[11px] text-mc-mute transition-colors hover:bg-mc-surface-2 hover:text-mc-text"
            >
              📂 加载
            </button>
            <div className="relative">
              <button
                type="button"
                onClick={() => setShowRecent((v) => !v)}
                aria-label="最近打开的节点图"
                aria-expanded={showRecent}
                title="最近打开"
                className="rounded-mc px-2 py-1 text-[11px] text-mc-mute transition-colors hover:bg-mc-surface-2 hover:text-mc-text"
              >
                🕘 最近
              </button>
              {showRecent && (
                <RecentGraphsMenu
                  entries={recent}
                  onOpen={handleOpenRecent}
                  onClose={() => setShowRecent(false)}
                  ariaLabelSuffix="低代码编辑器"
                />
              )}
            </div>
          </div>
        )}

        <div className="ml-auto flex items-center gap-2">
          {/* 新手引导 ? 按钮（手动重启引导） */}
          <button
            type="button"
            onClick={handleOnboardingRestart}
            aria-label="启动新手引导"
            title="新手引导"
            className="rounded-mc px-2 py-1 text-[11px] text-mc-mute transition-colors hover:bg-mc-surface-2 hover:text-mc-text"
          >
            ?
          </button>

          {/* 节点统计 */}
          <span
            className="rounded-mc bg-mc-surface-2 px-2 py-0.5 text-[10px] text-mc-mute"
            role="status"
          >
            {graph.nodes.length} 节点 · {graph.edges.length} 连线
          </span>

          {/* 实时预览切换按钮 */}
          <button
            type="button"
            onClick={() => setShowPreview((v) => !v)}
            aria-label={showPreview ? '隐藏生成代码预览' : '显示生成代码预览'}
            aria-pressed={showPreview}
            title={showPreview ? '隐藏生成代码预览面板' : '显示生成代码预览面板（实时编译）'}
            className={`rounded-mc px-2 py-1 text-[11px] transition-colors ${
              showPreview
                ? 'bg-mc-accent/20 text-mc-accent'
                : 'text-mc-mute hover:bg-mc-surface-2 hover:text-mc-text'
            }`}
          >
            👁 预览
          </button>

          {/* 编译状态徽章 */}
          {compileStatus && (
            <span
              className={`rounded-mc px-2 py-0.5 text-[10px] font-medium ${compileStatus.cls}`}
              role="status"
              aria-label={compileStatus.label}
              title={compileStatus.label}
            >
              {compileStatus.text}
            </span>
          )}

          {/* 编译 */}
          <button
            type="button"
            onClick={handleCompile}
            data-onboarding="compile"
            aria-label="编译节点图"
            title="编译节点图为 ModSpec"
            className="flex items-center gap-1 rounded-mc bg-mc-accent px-3 py-1 text-[11px] font-medium text-white transition-colors hover:bg-mc-accent/80"
          >
            <span aria-hidden="true">⚙</span>
            编译
          </button>
        </div>
      </div>

      {/* 三栏布局（开启预览时为四栏：palette / canvas / property / preview） */}
      <div className="flex flex-1 overflow-hidden">
        {/* 左侧：节点库 */}
        {!readOnly && (
          <div
            style={{ width: paletteWidth }}
            className="shrink-0 border-r border-mc-border"
            data-onboarding="palette"
          >
            <NodePalette onNodeClick={handleNodeClick} disableCodeNode={disableCodeNode} />
          </div>
        )}

        {/* 中间：画布 */}
        <div className="flex-1 overflow-hidden" data-onboarding="canvas">
          {/* 阶段 C：编辑子图时用 SubgraphWorkspace 替代主画布 */}
          {editingSubgraphId ? (
            <SubgraphWorkspace />
          ) : (
            <NodeGraphEditor readOnly={readOnly} onNodeDoubleClick={handleNodeDoubleClick} />
          )}
        </div>

        {/* 右侧：工具栏（折叠/展开按钮） */}
        {!readOnly && (
          <aside
            className="flex w-12 flex-col items-center gap-2 border-l-2 border-l-black border-t-white border-r-white border-b-white bg-mc-surface py-2"
            data-onboarding="drawer"
          >
            <button
              type="button"
              aria-label="全部折叠"
              title="全部折叠"
              onClick={collapseAll}
              className="border border-t-white border-l-white border-b-black border-r-black bg-mc-btn px-1 py-1 text-[11px] hover:bg-mc-btn-hover"
            >
              ▾
            </button>
            <button
              type="button"
              aria-label="全部展开"
              title="全部展开"
              onClick={expandAll}
              className="border border-t-white border-l-white border-b-black border-r-black bg-mc-btn px-1 py-1 text-[11px] hover:bg-mc-btn-hover"
            >
              ▸
            </button>
          </aside>
        )}

        {/* 最右侧：生成代码实时预览面板（可切换显隐） */}
        {showPreview && (
          <div
            style={{ width: previewWidth }}
            className="shrink-0 border-l border-mc-border"
            role="region"
            aria-label="生成代码预览面板"
          >
            <GeneratedCodePreview />
          </div>
        )}
      </div>

      {/* 节点图调试器（底部水平面板，仅可编辑模式显示） */}
      {!readOnly && (
        <div className="shrink-0 border-t border-mc-border">
          <DebuggerPanel graph={graph} />
        </div>
      )}

      {/* 代码节点编辑器（L2 混合模式：双击 CodeNode 弹出 Monaco） */}
      {!readOnly && <CodeNodeEditor nodeId={codeNodeId} onClose={() => setCodeNodeId(null)} />}

      {/* 节点详情抽屉（覆盖层，由 drawer-store 控制显隐） */}
      {!readOnly && <NodeDetailDrawer compileMessages={EMPTY_COMPILE_MESSAGES} />}

      {/* 新手引导浮层（首次打开或点 ? 按钮触发） */}
      {onboardingStep !== null && (
        <OnboardingTour
          step={onboardingStep}
          onNext={handleOnboardingNext}
          onSkip={handleOnboardingSkip}
        />
      )}

      {/* 屏幕阅读器动态通知区域（保存/加载状态朗读，3 秒后自动清空） */}
      <LiveRegion id="lowcode-workspace-status" />
    </div>
  );
}
