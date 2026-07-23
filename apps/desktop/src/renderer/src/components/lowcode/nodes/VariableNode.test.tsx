// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { type ReactNode } from 'react';
import { VariableNode } from './VariableNode.js';
import type { VariableNodeData } from '@mc-creator/shared';

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
  ) => sel({ toggleCollapse: () => {}, graph: { nodes: [{ id: 'v1', ports: [] }] } }),
}));

vi.mock('../../../store/drawer-store.js', () => ({
  useDrawerStore: (sel: (s: { openDrawer: () => void }) => unknown) =>
    sel({ openDrawer: () => {} }),
}));

describe('VariableNode', () => {
  it('渲染变量名 + 类型 + 值', () => {
    const data: VariableNodeData = {
      nodeId: 'v1',
      label: '最大伤害',
      note: '',
      disabled: false,
      kind: 'variable',
      varName: 'MAX_DAMAGE',
      varType: 'int',
      value: 10,
      isConstant: true,
      collapsed: false,
    };
    render(<VariableNode data={data} selected={false} />);
    expect(screen.getByTestId('title').textContent).toBe('最大伤害');
    expect(screen.getByTestId('badge').textContent).toBe('const');
    expect(screen.getByTestId('children').textContent).toContain('MAX_DAMAGE');
    expect(screen.getByTestId('children').textContent).toContain('int');
    expect(screen.getByTestId('children').textContent).toContain('10');
  });

  it('非常量时不显示 badge', () => {
    const data: VariableNodeData = {
      nodeId: 'v2',
      label: 'x',
      note: '',
      disabled: false,
      kind: 'variable',
      varName: 'currentHp',
      varType: 'int',
      value: 20,
      isConstant: false,
      collapsed: false,
    };
    render(<VariableNode data={data} selected={false} />);
    expect(screen.queryByTestId('badge')).toBeNull();
  });
});
