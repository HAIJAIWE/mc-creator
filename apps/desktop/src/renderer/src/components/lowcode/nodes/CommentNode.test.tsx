// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { type NodeProps, ReactFlowProvider } from 'reactflow';
import { type ReactElement } from 'react';
import { CommentNode } from './CommentNode.js';
import { useNodeGraphStore } from '../../../store/node-graph-store.js';
import type { CommentNodeData } from '@mc-creator/shared';

function renderWithProvider(ui: ReactElement) {
  return render(<ReactFlowProvider>{ui}</ReactFlowProvider>);
}

describe('CommentNode (McNodeShell)', () => {
  beforeEach(() => {
    useNodeGraphStore.getState().clear();
  });

  it('渲染 McNodeShell + 备注文本', () => {
    const id = useNodeGraphStore.getState().addNode('comment', { x: 0, y: 0 });
    const data = useNodeGraphStore.getState().graph.nodes[0].data as CommentNodeData;
    const props = { id, data, selected: false } as unknown as NodeProps<CommentNodeData>;

    renderWithProvider(<CommentNode {...props} />);

    // 默认 text='备注'，title 也回退为 '备注'，故用 getAllByText
    expect(screen.getAllByText('备注').length).toBeGreaterThanOrEqual(1);
    // McNodeShell 头部按钮（旧组件无此按钮）
    expect(screen.getByLabelText('设置')).toBeTruthy();
  });
});
