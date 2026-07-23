// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { type ReactNode } from 'react';
import { SubgraphEditor } from './SubgraphEditor.js';
import type { SubgraphDefinition, ModNode } from '@mc-creator/shared';

// 捕获传递给 ReactFlow 的 props，用于验证交互回调
let capturedReactFlowProps: Record<string, unknown> = {};

vi.mock('reactflow', () => ({
  default: (props: { children?: ReactNode } & Record<string, unknown>) => {
    capturedReactFlowProps = props;
    return <div data-testid="reactflow">{props.children}</div>;
  },
  Background: () => <div data-testid="background" />,
  BackgroundVariant: { Dots: 'dots' },
  Controls: () => <div data-testid="controls" />,
  MiniMap: () => <div data-testid="minimap" />,
  applyNodeChanges: (changes: unknown[], nodes: unknown[]) => nodes,
  applyEdgeChanges: (changes: unknown[], edges: unknown[]) => edges,
  addEdge: (conn: unknown, edges: unknown[]) => [...edges, conn],
}));

function makeInnerItem(id: string): ModNode {
  return {
    id,
    type: 'item',
    position: { x: 0, y: 0 },
    data: {
      nodeId: id,
      label: id,
      note: '',
      disabled: false,
      kind: 'item',
      itemId: id,
      displayName: id,
      category: 'misc',
      maxStackSize: 64,
      maxDamage: 0,
      rarity: 'common',
      glow: false,
      collapsed: false,
      codeLocked: false,
    },
    ports: [],
    selected: false,
  };
}

const mockSg: SubgraphDefinition = {
  id: 'sg_1',
  name: '测试子图',
  nodes: [],
  edges: [],
  portMappings: [],
};

describe('SubgraphEditor', () => {
  it('渲染子图名 + React Flow 画布', () => {
    render(<SubgraphEditor subgraph={mockSg} onChange={() => {}} />);
    expect(screen.getByText(/测试子图/)).toBeTruthy();
    expect(screen.getByTestId('reactflow')).toBeTruthy();
  });

  it('渲染边界节点添加按钮', () => {
    render(<SubgraphEditor subgraph={mockSg} onChange={() => {}} />);
    expect(screen.getByText('添加输入边界')).toBeTruthy();
    expect(screen.getByText('添加输出边界')).toBeTruthy();
  });

  it('传递 onNodesChange / onEdgesChange / onConnect / isValidConnection 给 ReactFlow', () => {
    render(<SubgraphEditor subgraph={mockSg} onChange={() => {}} />);
    expect(typeof capturedReactFlowProps.onNodesChange).toBe('function');
    expect(typeof capturedReactFlowProps.onEdgesChange).toBe('function');
    expect(typeof capturedReactFlowProps.onConnect).toBe('function');
    expect(typeof capturedReactFlowProps.isValidConnection).toBe('function');
  });

  it('多个输入/输出边界节点 Y 坐标按索引展开（不堆叠在 y=0）', () => {
    const sg: SubgraphDefinition = {
      id: 'sg_multi',
      name: '多边界',
      nodes: [],
      edges: [],
      portMappings: [
        {
          internalPortId: 'in_0',
          externalPortId: 'in_0',
          label: '输入1',
          direction: 'in',
          type: 'item_stack',
        },
        {
          internalPortId: 'in_1',
          externalPortId: 'in_1',
          label: '输入2',
          direction: 'in',
          type: 'item_stack',
        },
        {
          internalPortId: 'out_0',
          externalPortId: 'out_0',
          label: '输出1',
          direction: 'out',
          type: 'item_stack',
        },
        {
          internalPortId: 'out_1',
          externalPortId: 'out_1',
          label: '输出2',
          direction: 'out',
          type: 'item_stack',
        },
      ],
    };
    render(<SubgraphEditor subgraph={sg} onChange={() => {}} />);
    const nodes = capturedReactFlowProps.nodes as Array<{
      id: string;
      position: { x: number; y: number };
    }>;
    const inNodes = nodes.filter((n) => n.id.startsWith('boundary_in_'));
    const outNodes = nodes.filter((n) => n.id.startsWith('boundary_out_'));
    // 输入边界节点 Y 坐标应递增（不全部为 0）
    const inYs = inNodes.map((n) => n.position.y);
    expect(inYs).not.toEqual([0, 0]);
    expect(new Set(inYs).size).toBe(inNodes.length);
    // 输出边界节点 Y 坐标应递增
    const outYs = outNodes.map((n) => n.position.y);
    expect(outYs).not.toEqual([0, 0]);
    expect(new Set(outYs).size).toBe(outNodes.length);
  });

  it('内部节点在 flowNodes 中保留', () => {
    const sg: SubgraphDefinition = {
      id: 'sg_inner',
      name: '含内部节点',
      nodes: [makeInnerItem('n1'), makeInnerItem('n2')],
      edges: [],
      portMappings: [],
    };
    render(<SubgraphEditor subgraph={sg} onChange={() => {}} />);
    const nodes = capturedReactFlowProps.nodes as Array<{ id: string }>;
    expect(nodes.some((n) => n.id === 'n1')).toBe(true);
    expect(nodes.some((n) => n.id === 'n2')).toBe(true);
  });
});
