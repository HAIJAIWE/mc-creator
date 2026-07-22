import { memo } from 'react';
import { type NodeProps } from 'reactflow';
import type { CodeNodeData } from '@mc-creator/shared';
import { useNodeGraphStore } from '../../../store/node-graph-store.js';
import { useDrawerStore } from '../../../store/drawer-store.js';
import { McNodeShell } from './base/McNodeShell.js';
import { useDebugState } from './base/useNodeStates.js';

/**
 * 代码节点：L2 混合模式核心。
 * 用户在节点图嵌入 Java/JS/Kotlin 代码，通过端口连线。
 * 双击节点打开 Monaco 编辑器编辑代码。
 * 端口：in (any) / out (any)
 * 颜色：mc-code（灰色）
 */
function CodeNodeComponent({ id, data, selected }: NodeProps<CodeNodeData>) {
  const toggleCollapse = useNodeGraphStore((s) => s.toggleCollapse);
  const openDrawer = useDrawerStore((s) => s.openDrawer);
  const ports = useNodeGraphStore((s) => s.graph.nodes.find((n) => n.id === id)?.ports ?? []);
  const debugState = useDebugState(id);

  const languageLabel =
    data.language === 'java' ? 'Java' : data.language === 'kotlin' ? 'Kotlin' : 'JS';

  // 预览代码首行（去掉注释和空行）
  const codePreview = data.code
    .split('\n')
    .filter((l) => !l.trim().startsWith('//') && l.trim().length > 0)[0]
    ?.trim()
    .slice(0, 40);

  return (
    <McNodeShell
      icon="scroll-quill"
      title={data.methodName + '()' || data.label || '代码'}
      colorClass="mc-code"
      badge={languageLabel}
      ports={ports}
      collapsed={data.collapsed}
      selected={selected}
      debugState={debugState}
      onToggleCollapse={() => toggleCollapse(id)}
      onOpenDrawer={() => openDrawer(id)}
    >
      {codePreview && (
        <div className="truncate font-mono text-mc-mute" title={codePreview}>
          {codePreview}
        </div>
      )}
      <div className="text-[10px] text-mc-mute">双击编辑代码</div>
      {data.note && <div className="text-mc-mute">{data.note}</div>}
    </McNodeShell>
  );
}

export const CodeNode = memo(CodeNodeComponent);
