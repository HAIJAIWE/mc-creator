// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { type NodeProps } from 'reactflow';
import { type ReactNode } from 'react';
import { SubgraphBoundaryNode, type SubgraphBoundaryNodeData } from './SubgraphBoundaryNode.js';

vi.mock('../nodes/base/McNodeShell.js', () => ({
  McNodeShell: ({
    title,
    badge,
    ports,
    children,
  }: {
    title: string;
    badge?: string;
    ports: unknown[];
    children?: ReactNode;
  }) => (
    <div data-testid="mc-node-shell">
      <span data-testid="title">{title}</span>
      {badge && <span data-testid="badge">{badge}</span>}
      <span data-testid="ports-count">{ports.length}</span>
      <div data-testid="children">{children}</div>
    </div>
  ),
}));

vi.mock('../../../store/node-graph-store.js', () => ({
  useNodeGraphStore: (sel: (s: { toggleCollapse: () => void }) => unknown) =>
    sel({ toggleCollapse: () => {} }),
}));

describe('SubgraphBoundaryNode', () => {
  it('input 边界节点渲染 badge=in', () => {
    render(
      <SubgraphBoundaryNode
        {...({
          id: 'b1',
          data: {
            nodeId: 'b1',
            label: '输入',
            note: '',
            disabled: false,
            kind: 'comment',
            text: '',
            color: 'yellow',
            boundaryType: 'in',
            portLabel: '材料',
            portType: 'item_stack',
            collapsed: false,
            codeLocked: false,
            formatVersion: 1,
          },
          selected: false,
        } as unknown as NodeProps<SubgraphBoundaryNodeData>)}
      />,
    );
    expect(screen.getByTestId('badge').textContent).toBe('in');
    expect(screen.getByTestId('children').textContent).toContain('材料');
  });

  it('output 边界节点渲染 badge=out', () => {
    render(
      <SubgraphBoundaryNode
        {...({
          id: 'b2',
          data: {
            nodeId: 'b2',
            label: '输出',
            note: '',
            disabled: false,
            kind: 'comment',
            text: '',
            color: 'yellow',
            boundaryType: 'out',
            portLabel: '产物',
            portType: 'item_stack',
            collapsed: false,
            codeLocked: false,
            formatVersion: 1,
          },
          selected: false,
        } as unknown as NodeProps<SubgraphBoundaryNodeData>)}
      />,
    );
    expect(screen.getByTestId('badge').textContent).toBe('out');
    expect(screen.getByTestId('children').textContent).toContain('产物');
  });
});
