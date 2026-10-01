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
import { downloadGraphAsJson } from '../../lib/nodeGraphSerializer.js';
import { saveGraphToDisk, loadGraphFromDisk } from '../../lib/nodeGraphPersistence.js';
import { useRecentGraphs } from '../../lib/useRecentGraphs.js';
import { useLiveRegion } from '../../lib/useLiveRegion.js';
import { RecentGraphsMenu } from './RecentGraphsMenu.js';
import { DebuggerPanel } from './DebuggerPanel.js';
import { McIcon } from '../../assets/mc-ui/McIcon';
import { OnboardingTour } from './onboarding/OnboardingTour.js';
import { useModStore } from '../../store/mod-store.js';
import { useDebuggerStore } from '../../store/debugger-store.js';
import { specToNodeGraph } from '../../lib/specToNodeGraph.js';
import { applyGraphToProject } from '../../lib/applyGraphToProject.js';
import { useToast } from '../useToast.js';

/**
 * P1 dogfood 修复：从 compileResult 中提取编译消息（替代硬编码空数组）。
 * 编译错误/警告消息现在会传递给 NodeDetailDrawer，在抽屉中显示与当前节点相关的消息。
 */
function extractCompileMessages(
  compileResult: { errors: string[]; warnings: string[] } | null,
  nodeIds: string[],
): { type: 'error' | 'warning'; nodeId: string; message: string }[] {
  if (!compileResult) return [];
  const messages: { type: 'error' | 'warning'; nodeId: string; message: string }[] = [];
  // 从错误/警告文本中提取涉及的节点 ID（与 NodeGraphEditor.extractNodeIds 逻辑一致）
  for (const id of nodeIds) {
    const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`(?:^|[^a-z0-9_])${escaped}(?:$|[^a-z0-9_])`, 'i');
    for (const msg of compileResult.errors) {
      if (regex.test(msg)) messages.push({ type: 'error', nodeId: id, message: msg });
    }
    for (const msg of compileResult.warnings) {
      if (regex.test(msg)) messages.push({ type: 'warning', nodeId: id, message: msg });
    }
  }
  return messages;
}

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
  const { warning: toastWarning } = useToast();

  /**
   * 把 specToNodeGraph 的有损告警显式暴露给用户。
   *
   * 这些告警意味着「spec 里有内容画布表达不了」，用户若在画布上「编译并应用」，
   * 这些内容会从产物中消失。仅用 announce（屏幕阅读器）不够，必须视觉可见。
   */
  const reportSpecLoss = useCallback(
    (warnings: string[]) => {
      if (warnings.length === 0) return;
      const preview = warnings.slice(0, 3).join('；');
      const more = warnings.length > 3 ? `；等共 ${warnings.length} 条` : '';
      toastWarning(`画布无法完整表达该项目：${preview}${more}`);
    },
    [toastWarning],
  );

  const mode = useEditorModeStore((s) => s.mode);
  // 单一真相源接入：只有 mod 类型支持节点图 ↔ spec 双向同步
  const generatorType = useModStore((s) => s.generatorType);
  const spec = useModStore((s) => s.spec);
  const loader = useModStore((s) => s.loader);
  const mcVersion = useModStore((s) => s.mcVersion);
  const setSpec = useModStore((s) => s.setSpec);
  const isModSupported = generatorType === 'mod';
  // 性能：拆分 graph 订阅为细粒度原子选择器，避免节点拖动等高频 graph 变更
  // 触发整个工作区重渲染。回调内需要完整 graph 时用 useNodeGraphStore.getState()
  // 取最新值，避免在 useCallback 依赖项中引用整个 graph 对象。
  const nodeCount = useNodeGraphStore((s) => s.graph.nodes.length);
  const edgeCount = useNodeGraphStore((s) => s.graph.edges.length);
  const addNode = useNodeGraphStore((s) => s.addNode);
  const undo = useNodeGraphStore((s) => s.undo);
  const redo = useNodeGraphStore((s) => s.redo);
  const clear = useNodeGraphStore((s) => s.clear);
  const commit = useNodeGraphStore((s) => s.commit);
  const selectNode = useNodeGraphStore((s) => s.selectNode);
  const collapseAll = useNodeGraphStore((s) => s.collapseAll);
  const expandAll = useNodeGraphStore((s) => s.expandAll);
  // 性能：仅订阅 length（原始数字），避免 undoStack/redoStack 引用变化触发重渲染
  const undoStackLength = useNodeGraphStore((s) => s.undoStack.length);
  const redoStackLength = useNodeGraphStore((s) => s.redoStack.length);
  const setCompileResult = useNodeGraphStore((s) => s.setCompileResult);
  const compileResult = useNodeGraphStore((s) => s.compileResult);
  // P2 dogfood 修复：订阅节点 ID 列表用于编译消息提取（替代 JSX 中 getState()）
  const nodeIds = useNodeGraphStore((s) => s.graph.nodes.map((n) => n.id));
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
      // 性能：用 getState() 取最新 nodes.length，避免订阅整个 graph 触发 handler 重建
      const offset = useNodeGraphStore.getState().graph.nodes.length * 30;
      addNode(kind, { x: 200 + offset, y: 150 + offset });
    },
    [readOnly, commit, addNode],
  );

  // 编译并应用节点图：compileNodeGraph → setSpec → 生成文件 → applyGeneratedFiles（保护手改）
  const handleApply = useCallback(async () => {
    const graph = useNodeGraphStore.getState().graph;
    const result = await applyGraphToProject(graph, {
      generatorType,
      loader,
      mcVersion,
      // 传当前 spec：画布无法表达的内容（模组元信息 / 数据包类内容）保留而不被删除
      baseSpec: useModStore.getState().spec,
    });
    // 无论成败都把编译结果喂给错误高亮 / 编译徽章
    setCompileResult({ spec: result.spec, warnings: result.warnings, errors: result.errors });
    if (result.errors.length > 0) {
      announce(`编译失败：${result.errors.length} 个错误，未应用到项目`);
      return;
    }
    setSpec(result.spec);
    const preserved = useModStore.getState().applyGeneratedFiles(result.files);
    announce(
      preserved.length > 0
        ? `已应用节点图到项目；${preserved.length} 个手改文件已保留`
        : '已应用节点图到项目',
    );
  }, [generatorType, loader, mcVersion, setSpec, setCompileResult, announce]);

  /** 启动调试器：在编译错误节点设置断点并启动调试器 */
  const handleDebug = useCallback(async () => {
    const graph = useNodeGraphStore.getState().graph;
    const result = await applyGraphToProject(graph, {
      generatorType,
      loader,
      mcVersion,
      // 传当前 spec：画布无法表达的内容（模组元信息 / 数据包类内容）保留而不被删除
      baseSpec: useModStore.getState().spec,
    });
    setCompileResult({ spec: result.spec, warnings: result.warnings, errors: result.errors });

    // 在错误节点设置断点（优先使用带定位的结构化错误）
    const errorMessages = result.errorsWithLocation ?? [];
    if (errorMessages.length > 0) {
      const nextBreakpoints = new Set(useDebuggerStore.getState().breakpoints);
      for (const error of errorMessages) {
        const nodeId = error.location?.nodeId;
        if (nodeId && graph.nodes.some((node) => node.id === nodeId)) {
          nextBreakpoints.add(nodeId);
        }
      }
      useDebuggerStore.setState({ breakpoints: nextBreakpoints });
    }

    // 启动调试器（只启动一次）
    useDebuggerStore.getState().start(graph);
  }, [generatorType, loader, mcVersion, setCompileResult]);

  /** 手动「从 Spec 导入」：以 modStore.spec 重建画布（覆盖前确认） */
  const handleImportFromSpec = useCallback(() => {
    if (!spec || !isModSupported) return;
    const current = useNodeGraphStore.getState().graph;
    if (current.nodes.length > 0) {
      if (!window.confirm(`将以 Spec 重建画布，覆盖当前 ${current.nodes.length} 个节点，确定？`)) {
        return;
      }
    }
    const { graph, warnings } = specToNodeGraph(spec);
    useNodeGraphStore.getState().commit();
    useNodeGraphStore.getState().loadGraph(graph);
    reportSpecLoss(warnings);
    announce(
      warnings.length > 0
        ? `已从 Spec 导入画布；${warnings.length} 条提示（含未渲染类型说明）`
        : '已从 Spec 导入画布',
    );
  }, [spec, isModSupported, announce, reportSpecLoss]);

  // 自动导入：整 session 仅一次（空画布 + mod + 有 spec），避免覆盖用户手工搭的图
  const autoImportRef = useRef(false);
  useEffect(() => {
    if (readOnly || autoImportRef.current) return;
    autoImportRef.current = true; // 无论本次是否导入，session 内不再自动导入
    if (!isModSupported || !spec) return;
    if (useNodeGraphStore.getState().graph.nodes.length > 0) return;
    const { graph, warnings } = specToNodeGraph(spec);
    useNodeGraphStore.getState().loadGraph(graph);
    reportSpecLoss(warnings);
    if (warnings.length > 0) {
      announce(`已从 Spec 自动导入画布；${warnings.length} 条提示（未渲染类型仅可表单编辑）`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 仅首次挂载执行一次
  }, []);

  // 导出节点图为 JSON 文件（触发浏览器下载）
  const handleExport = useCallback(() => {
    const json = exportGraph();
    const filename = `${useNodeGraphStore.getState().graph.modId || 'untitled'}-node-graph.json`;
    downloadGraphAsJson(json, filename);
  }, [exportGraph]);

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
    // 性能：用 getState() 取最新 graph，避免订阅整个 graph 触发 handler 重建
    const res = await saveGraphToDisk(useNodeGraphStore.getState().graph);
    if (res.ok) {
      announce(`已保存到 ${res.path}`);
      refreshRecent();
    } else if (res.error !== 'canceled') {
      window.alert(`保存失败：${res.error}`);
    }
  }, [announce, refreshRecent]);

  // 从磁盘加载节点图（弹打开对话框 → 读取 → 反序列化 → 写入 store）
  const handleLoadFromDisk = useCallback(async () => {
    // window.api 类型在 preload/api.d.ts 声明为可选（jsdom 测试环境可能未注入）
    const bridge = window.api?.nodeGraph;
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

  // 非 mod 类型不支持节点图，渲染掩蔽提示（hooks 已全部调用完毕）
  if (!isModSupported) {
    return (
      <div className="flex h-full flex-col bg-mc-bg" role="application" aria-label="低代码工作区">
        <div className="flex items-center gap-2 border-b border-mc-border bg-mc-surface px-3 py-2 text-xs text-mc-dim">
          <McIcon scope="pixel" name="info-box" size={14} aria-hidden="true" />
          <span>
            低代码节点编辑器当前仅支持 Mod 项目（Fabric / NeoForge / Quilt）。当前项目类型：
            {generatorType}
          </span>
        </div>
        <div className="flex flex-1 items-center justify-center text-sm text-mc-mute">
          请将顶部类型切换为 Mod 后再使用节点图
        </div>
      </div>
    );
  }

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
              disabled={undoStackLength === 0}
              aria-label="撤销"
              title="撤销 (Ctrl+Z)"
              className="rounded-mc p-1 text-mc-dim transition-colors hover:bg-mc-surface-2 hover:text-mc-text disabled:cursor-not-allowed disabled:opacity-40"
            >
              ↶
            </button>
            <button
              type="button"
              onClick={redo}
              disabled={redoStackLength === 0}
              aria-label="重做"
              title="重做 (Ctrl+Y)"
              className="rounded-mc p-1 text-mc-dim transition-colors hover:bg-mc-surface-2 hover:text-mc-text disabled:cursor-not-allowed disabled:opacity-40"
            >
              ↷
            </button>
          </div>
        )}

        {/* 从 Spec 导入：把 modStore.spec（AI/表单产物）渲染到画布 */}
        {!readOnly && (
          <button
            type="button"
            onClick={handleImportFromSpec}
            disabled={!isModSupported || !spec}
            aria-label="从 Spec 导入画布"
            title="以当前 ModSpec 重建画布（覆盖前会确认）"
            className="rounded-mc px-2 py-1 text-[11px] text-mc-mute transition-colors hover:bg-mc-surface-2 hover:text-mc-text disabled:cursor-not-allowed disabled:opacity-40"
          >
            ⇄ 从 Spec 导入
          </button>
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
            {nodeCount} 节点 · {edgeCount} 连线
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

          {/* 编译并应用 */}
          <button
            type="button"
            onClick={handleApply}
            data-onboarding="compile"
            aria-label="编译节点图并应用到项目"
            title="编译节点图 → 更新 Spec → 重新生成项目文件（手改文件会保留）"
            className="flex items-center gap-1 rounded-mc bg-mc-accent px-3 py-1 text-[11px] font-medium text-white transition-colors hover:bg-mc-accent/80"
          >
            <span aria-hidden="true">⚙</span>
            编译并应用
          </button>

          {/* 调试：在编译错误处设置断点并启动调试器 */}
          <button
            type="button"
            onClick={handleDebug}
            aria-label="启动调试器（在编译错误处设置断点）"
            title="启动调试器，在编译错误节点设置断点并单步执行"
            className="flex items-center gap-1 rounded-mc bg-purple-600/80 px-3 py-1 text-[11px] font-medium text-white transition-colors hover:bg-purple-600"
            disabled={!compileResult || compileResult.errors.length === 0}
          >
            <span aria-hidden="true">🐛</span>
            调试
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
            <GeneratedCodePreview readOnly={false} />
          </div>
        )}
      </div>

      {/* 节点图调试器（底部水平面板，仅可编辑模式显示） */}
      {/* 性能：不传 graph prop，DebuggerPanel 自行从 store 订阅，避免父组件订阅整个 graph */}
      {!readOnly && (
        <div className="shrink-0 border-t border-mc-border">
          <DebuggerPanel />
        </div>
      )}

      {/* 代码节点编辑器（L2 混合模式：双击 CodeNode 弹出 Monaco） */}
      {!readOnly && <CodeNodeEditor nodeId={codeNodeId} onClose={() => setCodeNodeId(null)} />}

      {/* 节点详情抽屉（覆盖层，由 drawer-store 控制显隐） */}
      {!readOnly && (
        <NodeDetailDrawer compileMessages={extractCompileMessages(compileResult, nodeIds)} />
      )}

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
