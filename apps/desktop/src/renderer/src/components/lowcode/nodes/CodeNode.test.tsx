// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { type NodeProps, ReactFlowProvider } from 'reactflow';
import { type ReactElement } from 'react';
import { CodeNode } from './CodeNode.js';
import { useNodeGraphStore } from '../../../store/node-graph-store.js';
import type { CodeNodeData } from '@mc-creator/shared';

function renderWithProvider(ui: ReactElement) {
  return render(<ReactFlowProvider>{ui}</ReactFlowProvider>);
}

describe('CodeNode (McNodeShell)', () => {
  beforeEach(() => {
    useNodeGraphStore.getState().clear();
  });

  it('渲染 McNodeShell + 语言徽章', () => {
    const id = useNodeGraphStore.getState().addNode('code', { x: 0, y: 0 });
    const data = useNodeGraphStore.getState().graph.nodes[0].data as CodeNodeData;
    const props = { id, data, selected: false } as unknown as NodeProps<CodeNodeData>;

    renderWithProvider(<CodeNode {...props} />);

    expect(screen.getByText('Java')).toBeTruthy();
    expect(screen.getByText('process()')).toBeTruthy();
    // McNodeShell 头部按钮（旧组件无此按钮）
    expect(screen.getByLabelText('设置')).toBeTruthy();
  });
});
