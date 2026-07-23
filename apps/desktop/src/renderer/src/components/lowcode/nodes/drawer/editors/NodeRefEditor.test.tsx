// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { NodeRefEditor } from './NodeRefEditor.js';
import type { FieldSchema } from './types.js';
import type { NodeGraph, ModNode, NodePort, PortType } from '@mc-creator/shared';

function makePort(type: PortType): NodePort {
  return {
    id: 'out',
    label: '物品',
    type,
    direction: 'out',
    required: false,
    multiple: false,
  };
}

function makeNode(id: string, kind: string, label: string, portType: PortType): ModNode {
  return {
    id,
    type: kind as ModNode['type'],
    position: { x: 0, y: 0 },
    data: {
      nodeId: id,
      label,
      note: '',
      disabled: false,
      collapsed: false,
      kind: kind as never,
    },
    ports: [makePort(portType)],
    selected: false,
  } as unknown as ModNode;
}

const graph: NodeGraph = {
  version: 1,
  modId: 'test',
  viewport: { x: 0, y: 0, zoom: 1 },
  nodes: [
    makeNode('n1', 'item', '铁剑', 'item_stack'),
    makeNode('n2', 'block', '石头', 'block_state'),
  ],
  edges: [],
  subgraphs: {},
};

describe('NodeRefEditor', () => {
  const schema: FieldSchema = {
    key: 'ref',
    label: '引用节点',
    type: 'noderef',
    dataType: 'item_stack',
  };

  it('渲染下拉列表含可选节点', () => {
    render(<NodeRefEditor value="" onChange={() => {}} schema={schema} graph={graph} />);
    const select = screen.getByRole('combobox');
    expect(select).toBeTruthy();
    expect(screen.getByText('铁剑')).toBeTruthy();
  });

  it('选择节点触发 onChange', () => {
    const onChange = vi.fn();
    render(<NodeRefEditor value="" onChange={onChange} schema={schema} graph={graph} />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'n1' } });
    expect(onChange).toHaveBeenCalledWith('n1');
  });

  it('dataType 过滤：只显示匹配端口类型的节点', () => {
    const blockSchema: FieldSchema = {
      key: 'ref',
      label: '引用',
      type: 'noderef',
      dataType: 'block_state',
    };
    render(<NodeRefEditor value="" onChange={() => {}} schema={blockSchema} graph={graph} />);
    // item 节点端口类型是 item_stack，不匹配 block_state，应不显示
    expect(screen.queryByText('铁剑')).toBeNull();
    expect(screen.getByText('石头')).toBeTruthy();
  });
});

describe('NodeRefEditor 变量引用', () => {
  const graph = {
    version: 1 as const,
    modId: 'test',
    viewport: { x: 0, y: 0, zoom: 1 },
    nodes: [
      {
        id: 'v1',
        type: 'variable' as const,
        position: { x: 0, y: 0 },
        data: {
          nodeId: 'v1',
          label: '最大伤害',
          note: '',
          disabled: false,
          kind: 'variable' as const,
          varName: 'MAX_DAMAGE',
          varType: 'int' as const,
          value: 10,
          isConstant: true,
          collapsed: false,
        },
        ports: [],
        selected: false,
      },
      {
        id: 'i1',
        type: 'item' as const,
        position: { x: 0, y: 0 },
        data: {
          nodeId: 'i1',
          label: '铁剑',
          note: '',
          disabled: false,
          kind: 'item' as const,
          itemId: 'iron_sword',
          displayName: '铁剑',
          category: 'sword',
          maxStackSize: 1,
          maxDamage: 250,
          rarity: 'common' as const,
          glow: false,
          collapsed: false,
        },
        ports: [],
        selected: false,
      },
    ],
    edges: [],
    subgraphs: {},
  } as NodeGraph;

  it('schema.dataType 指定类型时列出匹配的变量节点', () => {
    render(
      <NodeRefEditor
        value=""
        onChange={() => {}}
        schema={{ key: 'dmg', label: '伤害', type: 'noderef', dataType: 'integer' }}
        graph={graph}
      />,
    );
    const select = screen.getByTestId('noderef-select') as HTMLSelectElement;
    expect(select.innerHTML).toContain('MAX_DAMAGE');
  });

  it('未指定 dataType 时列出所有节点', () => {
    render(
      <NodeRefEditor
        value=""
        onChange={() => {}}
        schema={{ key: 'ref', label: '引用', type: 'noderef' }}
        graph={graph}
      />,
    );
    const select = screen.getByTestId('noderef-select') as HTMLSelectElement;
    expect(select.innerHTML).toContain('铁剑');
    expect(select.innerHTML).toContain('MAX_DAMAGE');
  });
});
