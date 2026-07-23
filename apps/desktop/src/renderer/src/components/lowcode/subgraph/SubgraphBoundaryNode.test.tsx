// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { type ReactNode } from 'react';
import { SubgraphBoundaryNode } from './SubgraphBoundaryNode.js';

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
        data={{
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
        }}
        selected={false}
      />,
    );
    expect(screen.getByTestId('badge').textContent).toBe('in');
    expect(screen.getByTestId('children').textContent).toContain('材料');
  });

  it('output 边界节点渲染 badge=out', () => {
    render(
      <SubgraphBoundaryNode
        data={{
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
        }}
        selected={false}
      />,
    );
    expect(screen.getByTestId('badge').textContent).toBe('out');
    expect(screen.getByTestId('children').textContent).toContain('产物');
  });
});
