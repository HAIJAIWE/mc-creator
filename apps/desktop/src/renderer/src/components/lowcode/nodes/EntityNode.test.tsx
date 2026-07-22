// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { type NodeProps, ReactFlowProvider } from 'reactflow';
import { type ReactElement } from 'react';
import { EntityNode } from './EntityNode.js';
import { useNodeGraphStore } from '../../../store/node-graph-store.js';
import type { EntityNodeData } from '@mc-creator/shared';

function renderWithProvider(ui: ReactElement) {
  return render(<ReactFlowProvider>{ui}</ReactFlowProvider>);
}

describe('EntityNode (McNodeShell)', () => {
  beforeEach(() => {
    useNodeGraphStore.getState().clear();
  });

  it('渲染 McNodeShell 头部 + 摘要', () => {
    const id = useNodeGraphStore.getState().addNode('entity', { x: 0, y: 0 });
    const data = useNodeGraphStore.getState().graph.nodes[0].data as EntityNodeData;
    const props = { id, data, selected: false } as unknown as NodeProps<EntityNodeData>;

    renderWithProvider(<EntityNode {...props} />);

    expect(screen.getByText('新生物')).toBeTruthy();
    expect(screen.getByLabelText('设置')).toBeTruthy();
  });

  it('显示血量摘要', () => {
    const id = useNodeGraphStore.getState().addNode('entity', { x: 0, y: 0 });
    const data = useNodeGraphStore.getState().graph.nodes[0].data as EntityNodeData;
    const props = { id, data, selected: false } as unknown as NodeProps<EntityNodeData>;

    renderWithProvider(<EntityNode {...props} />);

    expect(screen.getByText(/20/)).toBeTruthy();
  });
});
