// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { type NodeProps, ReactFlowProvider } from 'reactflow';
import { type ReactElement } from 'react';
import { ItemNode } from './ItemNode.js';
import { useNodeGraphStore } from '../../../store/node-graph-store.js';
import type { ItemNodeData } from '@mc-creator/shared';

function renderWithProvider(ui: ReactElement) {
  return render(<ReactFlowProvider>{ui}</ReactFlowProvider>);
}

describe('ItemNode (McNodeShell)', () => {
  beforeEach(() => {
    useNodeGraphStore.getState().clear();
  });

  it('渲染 McNodeShell 头部 + 摘要', () => {
    const id = useNodeGraphStore.getState().addNode('item', { x: 0, y: 0 });
    const data = useNodeGraphStore.getState().graph.nodes[0].data as ItemNodeData;
    const props = { id, data, selected: false } as unknown as NodeProps<ItemNodeData>;

    renderWithProvider(<ItemNode {...props} />);

    expect(screen.getByText('新物品')).toBeTruthy();
    expect(screen.getByLabelText('设置')).toBeTruthy();
    expect(screen.getByLabelText('折叠')).toBeTruthy();
  });

  it('显示物品 ID 摘要', () => {
    const id = useNodeGraphStore.getState().addNode('item', { x: 0, y: 0 });
    const data = useNodeGraphStore.getState().graph.nodes[0].data as ItemNodeData;
    const props = { id, data, selected: false } as unknown as NodeProps<ItemNodeData>;

    renderWithProvider(<ItemNode {...props} />);

    expect(screen.getByText(/new_item/)).toBeTruthy();
  });
});
