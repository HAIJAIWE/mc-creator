// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { type NodeProps, ReactFlowProvider } from 'reactflow';
import { type ReactElement } from 'react';
import { MultiBlockNode } from './MultiBlockNode.js';
import { useNodeGraphStore } from '../../../store/node-graph-store.js';
import type { MultiBlockNodeData } from '@mc-creator/shared';

function renderWithProvider(ui: ReactElement) {
  return render(<ReactFlowProvider>{ui}</ReactFlowProvider>);
}

describe('MultiBlockNode (McNodeShell)', () => {
  beforeEach(() => {
    useNodeGraphStore.getState().clear();
  });

  it('渲染 McNodeShell 头部 + 端口', () => {
    const id = useNodeGraphStore.getState().addNode('multiblock', { x: 0, y: 0 });
    const data = useNodeGraphStore.getState().graph.nodes[0].data as MultiBlockNodeData;
    const props = { id, data, selected: false } as unknown as NodeProps<MultiBlockNodeData>;

    renderWithProvider(<MultiBlockNode {...props} />);

    expect(screen.getByText('新多方块结构')).toBeTruthy();
    expect(screen.getByText('控制器')).toBeTruthy();
    expect(screen.getByText('结构')).toBeTruthy();
  });
});
