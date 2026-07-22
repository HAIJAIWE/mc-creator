// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { type NodeProps, ReactFlowProvider } from 'reactflow';
import { type ReactElement } from 'react';
import { BlockNode } from './BlockNode.js';
import { useNodeGraphStore } from '../../../store/node-graph-store.js';
import type { BlockNodeData } from '@mc-creator/shared';

function renderWithProvider(ui: ReactElement) {
  return render(<ReactFlowProvider>{ui}</ReactFlowProvider>);
}

describe('BlockNode (McNodeShell)', () => {
  beforeEach(() => {
    useNodeGraphStore.getState().clear();
  });

  it('渲染 McNodeShell 头部 + 摘要', () => {
    const id = useNodeGraphStore.getState().addNode('block', { x: 0, y: 0 });
    const data = useNodeGraphStore.getState().graph.nodes[0].data as BlockNodeData;
    const props = { id, data, selected: false } as unknown as NodeProps<BlockNodeData>;

    renderWithProvider(<BlockNode {...props} />);

    expect(screen.getByText('新方块')).toBeTruthy();
    expect(screen.getByLabelText('设置')).toBeTruthy();
  });

  it('方块实体时显示 BE 徽章', () => {
    const id = useNodeGraphStore
      .getState()
      .addNode('block', { x: 0, y: 0 }, { isBlockEntity: true } as never);
    const data = useNodeGraphStore.getState().graph.nodes[0].data as BlockNodeData;
    const props = { id, data, selected: false } as unknown as NodeProps<BlockNodeData>;

    renderWithProvider(<BlockNode {...props} />);

    expect(screen.getByText('BE')).toBeTruthy();
  });
});
