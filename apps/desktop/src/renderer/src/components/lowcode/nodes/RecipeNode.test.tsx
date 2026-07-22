// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { type NodeProps, ReactFlowProvider } from 'reactflow';
import { type ReactElement } from 'react';
import { RecipeNode } from './RecipeNode.js';
import { useNodeGraphStore } from '../../../store/node-graph-store.js';
import type { RecipeNodeData } from '@mc-creator/shared';

function renderWithProvider(ui: ReactElement) {
  return render(<ReactFlowProvider>{ui}</ReactFlowProvider>);
}

describe('RecipeNode (McNodeShell)', () => {
  beforeEach(() => {
    useNodeGraphStore.getState().clear();
  });

  it('渲染 McNodeShell 头部 + 摘要 + 端口标签', () => {
    const id = useNodeGraphStore.getState().addNode('recipe', { x: 0, y: 0 });
    const data = useNodeGraphStore.getState().graph.nodes[0].data as RecipeNodeData;
    const props = { id, data, selected: false } as unknown as NodeProps<RecipeNodeData>;

    renderWithProvider(<RecipeNode {...props} />);

    // recipe 默认无 displayName，title 回退到 recipeId（new_recipe）
    expect(screen.getByText('new_recipe')).toBeTruthy();
    expect(screen.getByText('材料')).toBeTruthy();
    expect(screen.getByText('产物')).toBeTruthy();
  });
});
