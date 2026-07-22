// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { type NodeProps, ReactFlowProvider } from 'reactflow';
import { type ReactElement } from 'react';
import { MachineNode } from './MachineNode.js';
import { useNodeGraphStore } from '../../../store/node-graph-store.js';
import type { MachineNodeData } from '@mc-creator/shared';

function renderWithProvider(ui: ReactElement) {
  return render(<ReactFlowProvider>{ui}</ReactFlowProvider>);
}

describe('MachineNode (McNodeShell)', () => {
  beforeEach(() => {
    useNodeGraphStore.getState().clear();
  });

  it('渲染 McNodeShell 头部 + 端口标签', () => {
    const id = useNodeGraphStore.getState().addNode('machine', { x: 0, y: 0 });
    const data = useNodeGraphStore.getState().graph.nodes[0].data as MachineNodeData;
    const props = { id, data, selected: false } as unknown as NodeProps<MachineNodeData>;

    renderWithProvider(<MachineNode {...props} />);

    expect(screen.getByText('新机器')).toBeTruthy();
    expect(screen.getByText('输入物品')).toBeTruthy();
    expect(screen.getByText('能源输入')).toBeTruthy();
    expect(screen.getByText('输出物品')).toBeTruthy();
  });
});
