import { memo, useMemo, useCallback, type ChangeEvent } from 'react';
import type { EditorProps } from './types.js';
import type { VariableNodeData, PortType } from '@mc-creator/shared';

/** varType → PortType 映射（用于按 dataType 过滤变量节点） */
function varTypeToPortType(varType: VariableNodeData['varType']): PortType {
  switch (varType) {
    case 'int':
      return 'integer';
    case 'double':
      return 'number';
    case 'string':
      return 'string';
    case 'boolean':
      return 'boolean';
    case 'item':
      return 'item_stack';
    case 'block':
      return 'block_state';
  }
}

/**
 * 节点引用选择编辑器：下拉列出画布上匹配端口类型的节点。
 * - schema.dataType 指定需要的端口类型（如 'item_stack'）
 * - 变量节点：按 varType 映射 PortType 过滤（阶段 C 新增）
 * - 非变量节点：按输出端口类型过滤
 * - 选中后 onChange 返回节点 id
 */
function NodeRefEditorComponent({ value, onChange, schema, graph, error }: EditorProps<string>) {
  const options = useMemo(() => {
    const dataType = schema.dataType;
    return graph.nodes
      .filter((n) => {
        if (n.data.kind === 'variable') {
          // 变量节点：用 varType 映射 PortType 过滤
          if (!dataType) return true;
          return varTypeToPortType(n.data.varType) === dataType;
        }
        // 非变量节点：按端口类型过滤
        if (!dataType) return true;
        return n.ports.some(
          (p) => p.direction === 'out' && (p.type === dataType || p.type === 'any'),
        );
      })
      .map((n) => {
        // 变量节点：显示 varName (label) 便于识别；其他节点：仅显示 label
        const label =
          n.data.kind === 'variable' ? `${n.data.varName} (${n.data.label})` : n.data.label || n.id;
        return { id: n.id, label };
      });
  }, [graph.nodes, schema.dataType]);

  const handleChange = useCallback(
    (e: ChangeEvent<HTMLSelectElement>) => {
      onChange(e.target.value);
    },
    [onChange],
  );

  return (
    <div className="flex flex-col gap-1">
      <select
        data-testid="noderef-select"
        value={value || ''}
        onChange={handleChange}
        className="w-full border border-t-black border-l-black border-b-white border-r-white bg-mc-bg px-2 py-0.5 text-[11px] text-mc-text outline-none focus:border-mc-accent"
      >
        <option value="">（未选择）</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
      {error && (
        <div role="alert" className="text-[10px] text-red-400">
          {error}
        </div>
      )}
    </div>
  );
}

export const NodeRefEditor = memo(NodeRefEditorComponent);
