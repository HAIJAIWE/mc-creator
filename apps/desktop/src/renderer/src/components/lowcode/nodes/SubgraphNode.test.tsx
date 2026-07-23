// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { type ReactNode } from 'react';
import { SubgraphNode } from './SubgraphNode.js';
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
      setEditingSubgraphId: (id: string | null) => void;
      graph: {
        nodes: { id: string; ports: unknown[] }[];
        subgraphs: Record<string, unknown>;
      };
    }) => unknown,
  ) =>
    sel({
      toggleCollapse: () => {},
      setEditingSubgraphId: () => {},
      graph: {
        nodes: [{ id: 's1', ports: [] }],
        subgraphs: { sg_1: { id: 'sg_1', name: '合成铁剑' } },
      },
    }),
}));

vi.mock('../../../store/drawer-store.js', () => ({
  useDrawerStore: (sel: (s: { openDrawer: () => void }) => unknown) =>
    sel({ openDrawer: () => {} }),
}));

describe('SubgraphNode', () => {
  beforeEach(() => {
    customNodeRegistry.clear();
  });

  it('普通子图渲染 subgraphName + 进入提示', () => {
    const data: SubgraphNodeData = {
      nodeId: 's1',
      label: '我的合成',
      note: '',
      disabled: false,
      kind: 'subgraph',
      subgraphId: 'sg_1',
      subgraphName: '合成铁剑',
      customTypeId: null,
      collapsed: false,
      customFields: {},
    };
    render(<SubgraphNode data={data} selected={false} />);
    expect(screen.getByTestId('title').textContent).toBe('我的合成');
    expect(screen.getByTestId('children').textContent).toContain('合成铁剑');
    expect(screen.getByTestId('children').textContent).toContain('双击进入子图');
  });

  it('customTypeId 非空时委托 CustomNodeContent（显示自定义节点内容）', () => {
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
      nodeId: 's2',
      label: '自定义合成台',
      note: '',
      disabled: false,
      kind: 'subgraph',
      subgraphId: '',
      subgraphName: '',
      customTypeId: 'mymod:crafter',
      collapsed: false,
      customFields: {},
    };
    render(<SubgraphNode data={data} selected={false} />);
    // CustomNodeContent 渲染自定义节点摘要
    expect(screen.getByTestId('children').textContent).toContain('mymod:crafter');
  });

  it('子图未注册（subgraphId 找不到）显示警告', () => {
    const data: SubgraphNodeData = {
      nodeId: 's3',
      label: 'x',
      note: '',
      disabled: false,
      kind: 'subgraph',
      subgraphId: 'missing',
      subgraphName: '已删',
      customTypeId: null,
      collapsed: false,
      customFields: {},
    };
    render(<SubgraphNode data={data} selected={false} />);
    expect(screen.getByTestId('children').textContent).toContain('子图未找到');
  });
});
