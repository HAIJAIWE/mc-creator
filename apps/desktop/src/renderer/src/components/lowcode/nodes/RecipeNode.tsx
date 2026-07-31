import { memo } from 'react';
import { type NodeProps } from 'reactflow';
import type { RecipeNodeData } from '@mc-creator/shared';
import { McNodeShell } from './base/McNodeShell.js';
import { useNodeActions } from './hooks/useNodeActions.js';
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
 *
 * P2 性能优化：使用 useNodeActions 统一获取 toggleCollapse/openDrawer/node，
 * 避免每次任何节点变化都因 find 选择器触发重新渲染。
 */
function RecipeNodeComponent({ id, data, selected }: NodeProps<RecipeNodeData>) {
  const { toggleCollapse, openDrawer, node } = useNodeActions(data.nodeId);
  const debugState = useDebugState(id);

  return (
    <McNodeShell
      icon="crafting-table"
      title={data.label || data.recipeId || '配方'}
      colorClass="mc-recipe"
      badge={RECIPE_TYPE_LABELS[data.recipeType]}
      ports={node?.ports ?? []}
      collapsed={data.collapsed}
      selected={selected}
      debugState={debugState}
      codeLocked={data.codeLocked}
      onToggleCollapse={toggleCollapse}
      onOpenDrawer={openDrawer}
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
