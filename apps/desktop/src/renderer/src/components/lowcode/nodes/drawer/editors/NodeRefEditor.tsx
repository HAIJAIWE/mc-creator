import { memo } from 'react';
import type { EditorProps } from './types.js';

/**
 * 节点引用选择编辑器：下拉列出画布上匹配端口类型的节点。
 * - schema.dataType 指定需要的端口类型（如 'item_stack'）
 * - 只列出拥有该类型输出端口的节点
 * - 选中后 onChange 返回节点 id
 */
function NodeRefEditorComponent({ value, onChange, schema, graph }: EditorProps<string>) {
  const dataType = schema.dataType;
  const candidates = graph.nodes.filter((n) =>
    n.ports.some(
      (p) => p.direction === 'out' && (!dataType || p.type === dataType || p.type === 'any'),
    ),
  );

  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full border border-t-black border-l-black border-b-white border-r-white bg-mc-bg px-2 py-0.5 text-[11px] text-mc-text outline-none focus:border-mc-accent"
    >
      <option value="">（未选择）</option>
      {candidates.map((n) => (
        <option key={n.id} value={n.id}>
          {n.data.label || n.id}
        </option>
      ))}
    </select>
  );
}

export const NodeRefEditor = memo(NodeRefEditorComponent);
