// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { type NodeProps, ReactFlowProvider } from 'reactflow';
import { type ReactElement } from 'react';
import { ConditionNode } from './ConditionNode.js';
import { useNodeGraphStore } from '../../../store/node-graph-store.js';
import type { ConditionNodeData } from '@mc-creator/shared';

function renderWithProvider(ui: ReactElement) {
  return render(<ReactFlowProvider>{ui}</ReactFlowProvider>);
}

describe('ConditionNode (McNodeShell)', () => {
  beforeEach(() => {
    useNodeGraphStore.getState().clear();
  });

  it('渲染 McNodeShell + 真/假端口', () => {
    const id = useNodeGraphStore.getState().addNode('condition', { x: 0, y: 0 });
    const data = useNodeGraphStore.getState().graph.nodes[0].data as ConditionNodeData;
    const props = { id, data, selected: false } as unknown as NodeProps<ConditionNodeData>;

    renderWithProvider(<ConditionNode {...props} />);

    expect(screen.getByText('拥有物品')).toBeTruthy();
    expect(screen.getByText('真')).toBeTruthy();
    expect(screen.getByText('假')).toBeTruthy();
  });
});
