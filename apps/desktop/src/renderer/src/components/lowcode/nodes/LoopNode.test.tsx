// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { type NodeProps } from 'reactflow';
import { type ReactNode } from 'react';
import { LoopNode } from './LoopNode.js';
import type { LoopNodeData } from '@mc-creator/shared';

vi.mock('./base/McNodeShell.js', () => ({
  McNodeShell: ({
    title,
    badge,
    children,
  }: {
    title: string;
    badge?: string;
    children?: ReactNode;
  }) => (
    <div data-testid="mc-node-shell">
      <span data-testid="title">{title}</span>
      {badge && <span data-testid="badge">{badge}</span>}
      <div data-testid="children">{children}</div>
    </div>
  ),
}));

vi.mock('../../../store/node-graph-store.js', () => ({
  useNodeGraphStore: (
    sel: (s: {
      toggleCollapse: () => void;
      graph: { nodes: { id: string; ports: unknown[] }[] };
    }) => unknown,
  ) =>
    sel({
      toggleCollapse: () => {},
      graph: {
        nodes: [
          { id: 'l1', ports: [] },
          { id: 'l2', ports: [] },
          { id: 'l3', ports: [] },
        ],
      },
    }),
}));

vi.mock('../../../store/drawer-store.js', () => ({
  useDrawerStore: (sel: (s: { openDrawer: () => void }) => unknown) =>
    sel({ openDrawer: () => {} }),
}));

describe('LoopNode', () => {
  it('for 循环渲染 badge + 摘要', () => {
    const data: LoopNodeData = {
      nodeId: 'l1',
      label: '计数',
      note: '',
      disabled: false,
      kind: 'loop',
      loopType: 'for',
      init: 'int i = 0',
      condition: 'i < 10',
      update: 'i++',
      loopVarName: 'i',
      loopVarType: 'int',
      collapsed: false,
      codeLocked: false,
    };
    render(
      <LoopNode {...({ id: 'l1', data, selected: false } as unknown as NodeProps<LoopNodeData>)} />,
    );
    expect(screen.getByTestId('title').textContent).toBe('计数');
    expect(screen.getByTestId('badge').textContent).toBe('for');
    expect(screen.getByTestId('children').textContent).toContain('i < 10');
  });

  it('forEach 循环渲染 iterable', () => {
    const data: LoopNodeData = {
      nodeId: 'l2',
      label: '遍历',
      note: '',
      disabled: false,
      kind: 'loop',
      loopType: 'forEach',
      condition: '',
      loopVarName: 'item',
      loopVarType: 'item',
      iterable: 'itemList',
      collapsed: false,
      codeLocked: false,
    };
    render(
      <LoopNode {...({ id: 'l2', data, selected: false } as unknown as NodeProps<LoopNodeData>)} />,
    );
    expect(screen.getByTestId('badge').textContent).toBe('forEach');
    expect(screen.getByTestId('children').textContent).toContain('itemList');
  });

  it('while 循环渲染 condition', () => {
    const data: LoopNodeData = {
      nodeId: 'l3',
      label: 'while',
      note: '',
      disabled: false,
      kind: 'loop',
      loopType: 'while',
      condition: 'running',
      loopVarName: '',
      loopVarType: 'int',
      collapsed: false,
      codeLocked: false,
    };
    render(
      <LoopNode {...({ id: 'l3', data, selected: false } as unknown as NodeProps<LoopNodeData>)} />,
    );
    expect(screen.getByTestId('badge').textContent).toBe('while');
    expect(screen.getByTestId('children').textContent).toContain('running');
  });
});
