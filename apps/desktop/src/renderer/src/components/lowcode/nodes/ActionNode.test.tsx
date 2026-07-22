// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { type NodeProps, ReactFlowProvider } from 'reactflow';
import { type ReactElement } from 'react';
import { ActionNode } from './ActionNode.js';
import { useNodeGraphStore } from '../../../store/node-graph-store.js';
import type { ActionNodeData } from '@mc-creator/shared';

function renderWithProvider(ui: ReactElement) {
  return render(<ReactFlowProvider>{ui}</ReactFlowProvider>);
}

describe('ActionNode (McNodeShell)', () => {
  beforeEach(() => {
    useNodeGraphStore.getState().clear();
  });

  it('渲染 McNodeShell + 执行/完成端口', () => {
    const id = useNodeGraphStore.getState().addNode('action', { x: 0, y: 0 });
    const data = useNodeGraphStore.getState().graph.nodes[0].data as ActionNodeData;
    const props = { id, data, selected: false } as unknown as NodeProps<ActionNodeData>;

    renderWithProvider(<ActionNode {...props} />);

    expect(screen.getByText('生成实体')).toBeTruthy();
    // "执行" 同时作为头部徽章与输入端口标签出现，用 getAllByText
    expect(screen.getAllByText('执行').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('完成')).toBeTruthy();
  });
});
