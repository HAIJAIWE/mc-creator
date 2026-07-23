import { useCallback, useEffect, useState } from 'react';
import Editor from '@monaco-editor/react';
import type { CodeNodeData } from '@mc-creator/shared';
import { useNodeGraphStore } from '../../store/node-graph-store.js';
import { useModStore } from '../../store/mod-store.js';
import { useEditorModeStore } from '../../store/editor-mode-store.js';
import {
  promoteCodeNodeToPurecode,
  type CodeNodeDataForPromotion,
} from '../../lib/promoteToPurecode.js';

/** 预置 import 快捷插入（不动态调 IPC，用静态映射） */
const PRESET_IMPORTS: { label: string; importLine: string }[] = [
  {
    label: 'Forge API',
    importLine:
      'import net.minecraftforge.eventbus.api.SubscribeEvent;\nimport net.minecraftforge.fml.common.Mod;',
  },
  {
    label: 'Fabric API',
    importLine:
      'import net.fabricmc.fabric.api.event.EventFactory;\nimport net.fabricmc.fabric.api.event.player.PlayerBlockBreakEvents;',
  },
  {
    label: 'JEI',
    importLine: 'import mezz.jei.api.IModPlugin;\nimport mezz.jei.api.JeiPlugin;',
  },
  {
    label: 'Create',
    importLine: 'import com.simibubi.create.content.contrast.Contrast;',
  },
];

interface CodeNodeEditorProps {
  /** 要编辑的节点 ID；为 null 时不显示 */
  nodeId: string | null;
  /** 关闭回调 */
  onClose: () => void;
}

/**
 * 代码节点编辑器（L2 混合模式核心）
 *
 * 双击画布上的 CodeNode 时弹出，提供 Monaco 编辑器编辑 Java/JS/Kotlin 代码。
 *
 * 与 L3 纯代码模式的区别：
 * - L3 编辑整份源码文件（脚手架）
 * - L2 仅编辑节点内嵌的代码片段（嵌入到生成的 Java 方法体）
 *
 * 实时同步策略：
 * - 打开时 commit 一次撤销点（保存"编辑前"状态）
 * - 编辑器/表单每次变更都立即调用 store.updateNode
 * - 关闭时不额外 commit（避免产生多个撤销点）
 *
 * 字段对应 CodeNodeData：
 * - code：Monaco 编辑器内容
 * - methodName / language / inputSignature / outputSignature：顶部表单
 */
export function CodeNodeEditor({ nodeId, onClose }: CodeNodeEditorProps) {
  const node = useNodeGraphStore((s) => s.graph.nodes.find((n) => n.id === nodeId));
  const updateNode = useNodeGraphStore((s) => s.updateNode);
  const commit = useNodeGraphStore((s) => s.commit);

  // 本地 state：避免 Monaco 受控 value 在 store 更新后产生光标跳动
  const [code, setCode] = useState('');
  const [methodName, setMethodName] = useState('process');
  const [language, setLanguage] = useState<CodeNodeData['language']>('java');
  const [inputSignature, setInputSignature] = useState('{}');
  const [outputSignature, setOutputSignature] = useState('{}');

  // 同步 store → 本地 state（仅 nodeId 变化时触发，避免实时写回引发循环）
  useEffect(() => {
    if (node && node.data.kind === 'code') {
      setCode(node.data.code);
      setMethodName(node.data.methodName);
      setLanguage(node.data.language);
      setInputSignature(node.data.inputSignature);
      setOutputSignature(node.data.outputSignature);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeId]);

  // 打开时提交撤销点（保存"编辑前"状态，关闭后可 Ctrl+Z 回滚整段编辑）
  useEffect(() => {
    if (nodeId) commit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeId]);

  // ESC 关闭
  useEffect(() => {
    if (!nodeId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [nodeId, onClose]);

  // 实时同步本地变更到 store（不 commit，避免每个按键产生撤销点）
  const syncToStore = useCallback(
    (patch: Partial<CodeNodeData>) => {
      if (!nodeId || !node || node.data.kind !== 'code') return;
      updateNode(nodeId, patch as Partial<CodeNodeData>);
    },
    [nodeId, node, updateNode],
  );

  const handleCodeChange = useCallback(
    (val: string | undefined) => {
      const next = val ?? '';
      setCode(next);
      syncToStore({ code: next });
    },
    [syncToStore],
  );

  const handleMethodNameChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const next = e.target.value;
      setMethodName(next);
      syncToStore({ methodName: next });
    },
    [syncToStore],
  );

  const handleLanguageChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      const next = e.target.value as CodeNodeData['language'];
      setLanguage(next);
      syncToStore({ language: next });
    },
    [syncToStore],
  );

  const handleInputSignatureChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const next = e.target.value;
      setInputSignature(next);
      syncToStore({ inputSignature: next });
    },
    [syncToStore],
  );

  const handleOutputSignatureChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const next = e.target.value;
      setOutputSignature(next);
      syncToStore({ outputSignature: next });
    },
    [syncToStore],
  );

  // 提升到 L3：把当前 Code 节点提升为 L3 纯代码模式的脚手架文件
  const handlePromoteToL3 = useCallback(() => {
    if (!node || node.data.kind !== 'code') return;
    const codeNodeData: CodeNodeDataForPromotion = {
      nodeId: node.data.nodeId,
      label: node.data.label,
      note: node.data.note,
      language: node.data.language,
      code: node.data.code,
      inputSignature: node.data.inputSignature,
      outputSignature: node.data.outputSignature,
      methodName: node.data.methodName,
    };
    // 从节点图 store 读取当前 modId
    const currentModId = useNodeGraphStore.getState().graph.modId;
    const result = promoteCodeNodeToPurecode(codeNodeData, currentModId);

    const confirmed = window.confirm(
      `提升后将生成 ${result.files.length} 个文件，并将切换到 L3 纯代码模式。是否继续？`,
    );
    if (!confirmed) return;

    // 优先存入 useModStore（store 有 setFiles 方法）
    try {
      useModStore.getState().setFiles(result.files);
    } catch {
      // store 调用失败时兜底
    }
    // 同时写入 window.__promotedFiles，便于 PurecodeWorkspace 在集成步骤读取
    // 类型已在 preload/api.d.ts 声明（FileNode[] 可选），无需 as 断言
    window.__promotedFiles = result.files;

    // 切换到 L3 纯代码模式
    useEditorModeStore.getState().setMode('purecode');

    // 提示用户
    window.alert('已提升到 L3 模式，请查看 PurecodeWorkspace');

    // 关闭当前编辑器
    onClose();
  }, [node, onClose]);

  // nodeId 为空 / 节点不存在 / 非 code 节点 → 不渲染
  if (!nodeId || !node || node.data.kind !== 'code') return null;

  const monacoLanguage =
    language === 'java' ? 'java' : language === 'kotlin' ? 'kotlin' : 'javascript';
  const nodeLabel = node.data.label || '代码节点';
  const charCount = code.length;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="code-node-editor-title"
      onClick={onClose}
    >
      <div
        className="flex max-h-[90vh] w-[900px] max-w-[90vw] flex-col overflow-hidden rounded-mc-lg border border-mc-border bg-mc-surface shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 顶部标题栏：节点 label + 提升按钮 + 关闭按钮 */}
        <div className="flex items-center justify-between border-b border-mc-border px-4 py-2">
          <div className="flex items-center gap-3">
            <span className="text-xs" aria-hidden="true">
              📝
            </span>
            <h2 id="code-node-editor-title" className="text-sm font-medium text-mc-text">
              {nodeLabel}
            </h2>
            <span
              className="rounded-mc bg-mc-surface-2 px-2 py-0.5 text-[10px] text-mc-mute"
              aria-label="节点 ID"
            >
              {nodeId}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {/* 提升到 L3 纯代码模式 */}
            <button
              type="button"
              onClick={handlePromoteToL3}
              aria-label="提升此代码节点到 L3 纯代码模式"
              title="将此代码节点提升为完整的 L3 项目脚手架"
              className="rounded-mc bg-purple-500/20 px-3 py-1 text-[11px] font-medium text-purple-300 hover:bg-purple-500/30"
            >
              🚀 提升到 L3
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="关闭"
              title="关闭 (ESC)"
              className="rounded-mc p-1 text-mc-mute transition-colors hover:bg-mc-surface-2 hover:text-mc-text"
            >
              ✕
            </button>
          </div>
        </div>

        {/* 字段表单：methodName / language / inputSignature / outputSignature */}
        <div className="grid grid-cols-2 gap-3 border-b border-mc-border bg-mc-surface-2 px-4 py-2">
          <div className="flex items-center gap-2">
            <label className="text-[11px] text-mc-dim" htmlFor="cn-method">
              方法名
            </label>
            <input
              id="cn-method"
              type="text"
              value={methodName}
              onChange={handleMethodNameChange}
              pattern="^[a-zA-Z_][a-zA-Z0-9_]*$"
              className="flex-1 rounded-mc border border-mc-border bg-mc-surface px-2 py-0.5 font-mono text-[11px] text-mc-text outline-none focus:border-mc-accent"
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-[11px] text-mc-dim" htmlFor="cn-lang">
              语言
            </label>
            <select
              id="cn-lang"
              value={language}
              onChange={handleLanguageChange}
              className="flex-1 rounded-mc border border-mc-border bg-mc-surface px-2 py-0.5 text-[11px] text-mc-text outline-none focus:border-mc-accent"
            >
              <option value="java">Java</option>
              <option value="kotlin">Kotlin</option>
              <option value="javascript">JavaScript（脚本引擎）</option>
            </select>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-[11px] text-mc-dim" htmlFor="cn-in-sig">
              输入签名
            </label>
            <textarea
              id="cn-in-sig"
              value={inputSignature}
              onChange={handleInputSignatureChange}
              rows={1}
              spellCheck={false}
              className="flex-1 resize-none rounded-mc border border-mc-border bg-mc-surface px-2 py-0.5 font-mono text-[11px] text-mc-text outline-none focus:border-mc-accent"
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-[11px] text-mc-dim" htmlFor="cn-out-sig">
              输出签名
            </label>
            <textarea
              id="cn-out-sig"
              value={outputSignature}
              onChange={handleOutputSignatureChange}
              rows={1}
              spellCheck={false}
              className="flex-1 resize-none rounded-mc border border-mc-border bg-mc-surface px-2 py-0.5 font-mono text-[11px] text-mc-text outline-none focus:border-mc-accent"
            />
          </div>
        </div>

        {/* Monaco 编辑器 */}
        <div
          className="flex-1 overflow-hidden"
          style={{ minHeight: 400 }}
          data-testid="code-node-monaco-container"
          role="region"
          aria-label="Monaco 代码编辑器"
        >
          {/* import 快捷插入按钮栏（阶段 C 外部 mod API 增强） */}
          <div className="flex items-center gap-1 border-b border-mc-border bg-mc-surface-2 px-4 py-1">
            <span className="text-[10px] text-mc-dim">import 快捷插入：</span>
            {PRESET_IMPORTS.map((p) => (
              <button
                key={p.label}
                type="button"
                onClick={() => {
                  const newCode = `${p.importLine}\n\n${code}`;
                  setCode(newCode);
                  syncToStore({ code: newCode });
                }}
                className="rounded-mc bg-mc-surface px-2 py-0.5 text-[10px] text-mc-text hover:bg-mc-surface-3"
              >
                {p.label}
              </button>
            ))}
          </div>
          <Editor
            height="100%"
            language={monacoLanguage}
            value={code}
            onChange={handleCodeChange}
            theme="vs-dark"
            options={{
              minimap: { enabled: false },
              fontSize: 12,
              tabSize: 4,
              automaticLayout: true,
              scrollBeyondLastLine: false,
              wordWrap: 'on',
              lineNumbers: 'on',
              renderLineHighlight: 'all',
              bracketPairColorization: { enabled: true },
            }}
          />
        </div>

        {/* 底部状态栏：当前语言 + 字符数 */}
        <div className="flex items-center justify-between border-t border-mc-border bg-mc-surface-2 px-4 py-2">
          <div className="flex items-center gap-3 text-[10px] text-mc-mute" role="status">
            <span
              className="rounded-mc bg-mc-surface px-2 py-0.5 font-mono"
              aria-label="当前编辑器语言"
            >
              {monacoLanguage}
            </span>
            <span aria-label="字符数">{charCount} 字符</span>
          </div>
          <div className="text-[10px] text-mc-mute">ESC 关闭</div>
        </div>
      </div>
    </div>
  );
}
