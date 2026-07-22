// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { type NodeProps, ReactFlowProvider } from 'reactflow';
import { type ReactElement } from 'react';
import { EventNode } from './EventNode.js';
import { useNodeGraphStore } from '../../../store/node-graph-store.js';
import type { EventNodeData } from '@mc-creator/shared';

function renderWithProvider(ui: ReactElement) {
  return render(<ReactFlowProvider>{ui}</ReactFlowProvider>);
}

describe('EventNode (McNodeShell)', () => {
  beforeEach(() => {
    useNodeGraphStore.getState().clear();
  });

  it('渲染 McNodeShell 头部 + 触发端口', () => {
    const id = useNodeGraphStore.getState().addNode('event', { x: 0, y: 0 });
    const data = useNodeGraphStore.getState().graph.nodes[0].data as EventNodeData;
    const props = { id, data, selected: false } as unknown as NodeProps<EventNodeData>;

    renderWithProvider(<EventNode {...props} />);

    expect(screen.getByText('触发器')).toBeTruthy();
    expect(screen.getByText('触发')).toBeTruthy();
  });
});
