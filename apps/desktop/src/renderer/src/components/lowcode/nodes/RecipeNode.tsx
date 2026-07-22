import { memo } from 'react';
import { type NodeProps } from 'reactflow';
import type { RecipeNodeData } from '@mc-creator/shared';
import { useNodeGraphStore } from '../../../store/node-graph-store.js';
import { useDrawerStore } from '../../../store/drawer-store.js';
import { McNodeShell } from './base/McNodeShell.js';
import { useDebugState } from './base/useNodeStates.js';

const RECIPE_TYPE_LABELS: Record<RecipeNodeData['recipeType'], string> = {
  crafting_shaped: '有序合成',
  crafting_shapeless: '无序合成',
  smelting: '熔炼',
  blasting: '高炉',
  smoking: '烟熏',
  stonecutting: '切石',
};

/**
 * 配方节点：表达一个合成/烧炼配方。
 * 端口：in (item_stack, multiple) ← 材料 / out (item_stack) ← 产物
 * 颜色：mc-recipe（黄色）
 */
function RecipeNodeComponent({ id, data, selected }: NodeProps<RecipeNodeData>) {
  const toggleCollapse = useNodeGraphStore((s) => s.toggleCollapse);
  const openDrawer = useDrawerStore((s) => s.openDrawer);
  const ports = useNodeGraphStore((s) => s.graph.nodes.find((n) => n.id === id)?.ports ?? []);
  const debugState = useDebugState(id);

  return (
    <McNodeShell
      icon="crafting-table"
      title={data.label || data.recipeId || '配方'}
      colorClass="mc-recipe"
      badge={RECIPE_TYPE_LABELS[data.recipeType]}
      ports={ports}
      collapsed={data.collapsed}
      selected={selected}
      debugState={debugState}
      onToggleCollapse={() => toggleCollapse(id)}
      onOpenDrawer={() => openDrawer(id)}
    >
      <div className="text-mc-mute">ID: {data.recipeId}</div>
      <div className="flex gap-2 text-mc-dim">
        <span>产出 ×{data.outputCount}</span>
        {data.cookTime !== 200 && <span>{data.cookTime}t</span>}
        {data.experience > 0 && <span>EXP {data.experience}</span>}
      </div>
      {data.note && <div className="text-mc-mute">{data.note}</div>}
    </McNodeShell>
  );
}

export const RecipeNode = memo(RecipeNodeComponent);
