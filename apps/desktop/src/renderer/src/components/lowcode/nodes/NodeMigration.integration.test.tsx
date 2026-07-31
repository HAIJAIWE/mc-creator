// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { type ReactElement } from 'react';
import { ReactFlowProvider, type NodeProps } from 'reactflow';
import type { ItemNodeData, RecipeNodeData, ConditionNodeData } from '@mc-creator/shared';
import { useNodeGraphStore } from '../../../store/node-graph-store.js';
import { useDrawerStore } from '../../../store/drawer-store.js';
import { ItemNode } from './ItemNode.js';
import { RecipeNode } from './RecipeNode.js';
import { ConditionNode } from './ConditionNode.js';

function renderWithProvider(ui: ReactElement) {
  return render(<ReactFlowProvider>{ui}</ReactFlowProvider>);
}

describe('节点迁移集成测试', () => {
  beforeEach(() => {
    useNodeGraphStore.getState().clear();
    useDrawerStore.getState().closeDrawer();
  });

  it('点击节点设置按钮打开抽屉', () => {
    const id = useNodeGraphStore.getState().addNode('item', { x: 0, y: 0 });
    const data = useNodeGraphStore.getState().graph.nodes[0].data as ItemNodeData;
    const props = { id, data, selected: false } as unknown as NodeProps<ItemNodeData>;

    renderWithProvider(<ItemNode {...props} />);

    fireEvent.click(screen.getByLabelText('设置'));
    expect(useDrawerStore.getState().open).toBe(true);
    expect(useDrawerStore.getState().nodeId).toBe(id);
  });

  it('点击折叠按钮切换 collapsed', () => {
    const id = useNodeGraphStore.getState().addNode('recipe', { x: 0, y: 0 });
    const data = useNodeGraphStore.getState().graph.nodes[0].data as RecipeNodeData;
    const props = { id, data, selected: false } as unknown as NodeProps<RecipeNodeData>;

    renderWithProvider(<RecipeNode {...props} />);

    fireEvent.click(screen.getByLabelText('折叠'));
    expect(useNodeGraphStore.getState().graph.nodes[0].data.collapsed).toBe(true);
  });

  it('condition 节点显示 true/false 端口', () => {
    const id = useNodeGraphStore.getState().addNode('condition', { x: 0, y: 0 });
    const data = useNodeGraphStore.getState().graph.nodes[0].data as ConditionNodeData;
    const props = { id, data, selected: false } as unknown as NodeProps<ConditionNodeData>;

    renderWithProvider(<ConditionNode {...props} />);

    expect(screen.getByText('真')).toBeTruthy();
    expect(screen.getByText('假')).toBeTruthy();
  });

  it('折叠后端口区完整保留（输入+输出端口均可见）', () => {
    const id = useNodeGraphStore.getState().addNode('recipe', { x: 0, y: 0 });
    useNodeGraphStore.getState().toggleCollapse(id);
    const data = useNodeGraphStore.getState().graph.nodes[0].data as RecipeNodeData;
    const props = { id, data, selected: false } as unknown as NodeProps<RecipeNodeData>;

    renderWithProvider(<RecipeNode {...props} />);

    // P2 修正：折叠时端口区完整保留（输入+输出），便于连线和视觉一致性
    expect(screen.getByText('材料')).toBeTruthy();
    expect(screen.getByText('产物')).toBeTruthy();
  });
});
