// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { type ReactNode } from 'react';
import { CustomNodeContent } from './CustomNode.js';
import { customNodeRegistry } from '../custom/customNodeRegistry.js';
import type { SubgraphNodeData } from '@mc-creator/shared';

vi.mock('./base/McNodeShell.js', () => ({
  McNodeShell: ({ title, children }: { title: string; children?: ReactNode }) => (
    <div data-testid="mc-node-shell">
      <span data-testid="title">{title}</span>
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
  ) => sel({ toggleCollapse: () => {}, graph: { nodes: [{ id: 'c1', ports: [] }] } }),
}));

vi.mock('../../../store/drawer-store.js', () => ({
  useDrawerStore: (sel: (s: { openDrawer: () => void }) => unknown) =>
    sel({ openDrawer: () => {} }),
}));

describe('CustomNodeContent', () => {
  beforeEach(() => {
    customNodeRegistry.clear();
  });

  it('schema 已注册时渲染 label + typeId', () => {
    customNodeRegistry.register({
      typeId: 'mymod:crafter',
      label: '自定义合成台',
      description: '3x3',
      icon: 'crafting-table',
      color: 'mc-custom',
      ports: [],
      fields: [],
      codeTemplate: '',
    });
    const data: SubgraphNodeData = {
      nodeId: 'c1',
      label: '我的合成台',
      note: '',
      disabled: false,
      kind: 'subgraph',
      subgraphId: '',
      subgraphName: '',
      customTypeId: 'mymod:crafter',
      collapsed: false,
      customFields: {},
    };
    render(<CustomNodeContent data={data} selected={false} ports={[]} />);
    expect(screen.getByTestId('title').textContent).toBe('我的合成台');
    expect(screen.getByTestId('children').textContent).toContain('mymod:crafter');
  });

  it('schema 未注册时显示警告', () => {
    const data: SubgraphNodeData = {
      nodeId: 'c2',
      label: 'x',
      note: '',
      disabled: false,
      kind: 'subgraph',
      subgraphId: '',
      subgraphName: '',
      customTypeId: 'unregistered:type',
      collapsed: false,
      customFields: {},
    };
    render(<CustomNodeContent data={data} selected={false} ports={[]} />);
    expect(screen.getByTestId('children').textContent).toContain('自定义类型未注册');
  });
});
