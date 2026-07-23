import { useCallback } from 'react';
import type { SubgraphDefinition } from '@mc-creator/shared';
import { useNodeGraphStore } from '../../../store/node-graph-store.js';
import { SubgraphEditor } from './SubgraphEditor.js';

/**
 * 子图编辑模式容器：当 editingSubgraphId 非 null 时由 LowcodeWorkspace 渲染，
 * 替代主 NodeGraphEditor。顶栏含子图名 + 返回主图按钮。
 */
export function SubgraphWorkspace() {
  const editingSubgraphId = useNodeGraphStore((s) => s.editingSubgraphId);
  const setEditingSubgraphId = useNodeGraphStore((s) => s.setEditingSubgraphId);
  const sg = useNodeGraphStore((s) =>
    editingSubgraphId ? s.graph.subgraphs[editingSubgraphId] : undefined,
  );

  const handleBack = useCallback(() => {
    setEditingSubgraphId(null);
  }, [setEditingSubgraphId]);

  const handleChange = useCallback(
    (updated: SubgraphDefinition | undefined) => {
      if (!editingSubgraphId || !updated) return;
      useNodeGraphStore.setState((s) => ({
        graph: {
          ...s.graph,
          subgraphs: { ...s.graph.subgraphs, [editingSubgraphId]: updated },
        },
      }));
    },
    [editingSubgraphId],
  );

  if (!editingSubgraphId || !sg) {
    return null;
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-mc-border px-3 py-1">
        <button
          type="button"
          onClick={handleBack}
          className="rounded-mc bg-mc-surface-2 px-2 py-1 text-[11px] text-mc-text hover:bg-mc-surface-3"
        >
          ← 返回主图
        </button>
        <span className="text-xs text-mc-mute">编辑子图</span>
      </div>
      <div className="flex-1">
        <SubgraphEditor subgraph={sg} onChange={handleChange} />
      </div>
    </div>
  );
}
