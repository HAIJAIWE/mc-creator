// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { NodeGraphEditor } from './NodeGraphEditor.js';
import { useNodeGraphStore } from '../../store/node-graph-store.js';

vi.mock('reactflow', () => ({
  default: ({ onNodeContextMenu }: { onNodeContextMenu?: (e: React.MouseEvent) => void }) => (
    <div
      data-testid="reactflow"
      onContextMenu={(e) => {
        e.preventDefault();
        onNodeContextMenu?.(e);
      }}
    />
  ),
  Background: () => null,
  BackgroundVariant: { Dots: 'dots' },
  Controls: () => null,
  MiniMap: () => null,
  MarkerType: { ArrowClosed: 'arrowclosed' },
}));

describe('NodeGraphEditor 右键封装子图', () => {
  beforeEach(() => {
    useNodeGraphStore.getState().clear();
    useNodeGraphStore.setState({
      graph: { ...useNodeGraphStore.getState().graph, modId: 'test' },
    });
  });

  it('右键节点弹出菜单含「封装为子图」', () => {
    useNodeGraphStore.getState().addNode('item', { x: 0, y: 0 });
    useNodeGraphStore.getState().addNode('item', { x: 100, y: 0 });
    render(<NodeGraphEditor readOnly={false} />);
    fireEvent.contextMenu(screen.getByTestId('reactflow'));
    // 按钮文本为「封装为子图（需先选中节点）」或「封装为子图（N 节点）」，用正则匹配前缀
    expect(screen.getByText(/封装为子图/)).toBeTruthy();
  });
});
