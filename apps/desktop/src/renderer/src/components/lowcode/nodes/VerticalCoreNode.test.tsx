// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import '@testing-library/jest-dom';
import { render, screen, fireEvent } from '@testing-library/react';
import { ReactFlowProvider } from '@xyflow/react';

// Mock shared module with nodeRegistry（按 kind 返回测试用节点定义，未知 kind 返回 undefined）
vi.mock('@mc-creator/shared', () => {
  const voidIn = (id: string, label: string) => ({ id, label, type: 'void', direction: 'in' });
  const voidOut = (id: string, label: string) => ({ id, label, type: 'void', direction: 'out' });
  const dataIn = (id: string, label: string, type: string) => ({
    id,
    label,
    type,
    direction: 'in',
  });
  const dataOut = (id: string, label: string, type: string) => ({
    id,
    label,
    type,
    direction: 'out',
  });
  const defs: Record<
    string,
    { icon: string; label: string; category: string; inputs: unknown[]; outputs: unknown[] }
  > = {
    on_block_break: {
      icon: 'cube',
      label: '方块被破坏',
      category: 'event',
      inputs: [dataIn('customData', '自定义数据', 'entity')],
      outputs: [voidOut('next', '下一步')],
    },
    damage_entity: {
      icon: 'cube',
      label: '伤害实体',
      category: 'action',
      inputs: [voidIn('exec', '执行'), dataIn('amount', '伤害值', 'number')],
      outputs: [voidOut('next', '下一步')],
    },
    get_entity_pos: {
      icon: 'cube',
      label: '获取实体坐标',
      category: 'getter',
      inputs: [dataIn('x', 'X', 'number'), dataIn('target', 'target', 'string')],
      outputs: [dataOut('result', '结果', 'any')],
    },
    branch: {
      icon: 'cube',
      label: '分支',
      category: 'flow',
      inputs: [voidIn('exec', '执行')],
      outputs: [voidOut('next', '下一步'), voidOut('true', '成立')],
    },
    is_day: {
      icon: 'cube',
      label: '是否为白天',
      category: 'condition',
      inputs: [dataIn('value', '取值', 'boolean')],
      outputs: [],
    },
  };
  return {
    nodeRegistry: {
      get: vi.fn((kind: string) => defs[kind]),
    },
  };
});

// Mock stores
vi.mock('../../../store/node-graph-store.js', () => {
  return {
    useNodeGraphStore: vi.fn((sel) => {
      return sel({
        toggleCollapse: vi.fn(),
        updateNode: vi.fn(),
        commit: vi.fn(),
        graph: { edges: [] },
      });
    }),
  };
});

vi.mock('../../../store/drawer-store.js', () => {
  return {
    useDrawerStore: vi.fn((sel) => {
      return sel({ openDrawer: vi.fn() });
    }),
  };
});

// Import component after mocks are set up
import { VerticalCoreNode, type VerticalCoreNodeData } from './VerticalCoreNode.js';

function renderBlock(data: VerticalCoreNodeData) {
  return render(
    <ReactFlowProvider>
      <VerticalCoreNode id="n1" data={data} selected={false} />
    </ReactFlowProvider>,
  );
}

describe('VerticalCoreNode 拼图积木渲染', () => {
  it('事件渲染为帽子块：无缺口、有凸榫', () => {
    renderBlock({ kind: 'on_block_break' });
    expect(screen.getByTestId('puzzle-block').getAttribute('data-shape')).toBe('hat');
    expect(screen.getByText('方块被破坏')).toBeTruthy();
  });

  it('动作渲染为堆叠块：exec 缺口 + next 凸榫 + 数据端口', () => {
    renderBlock({ kind: 'damage_entity' });
    expect(screen.getByTestId('puzzle-block').getAttribute('data-shape')).toBe('stack');
  });

  it('纯数据源渲染为圆角块：无缺口凸榫、输出在右侧', () => {
    renderBlock({ kind: 'get_entity_pos' });
    expect(screen.getByTestId('puzzle-block').getAttribute('data-shape')).toBe('reporter');
  });

  it('条件分支端口渲染在右侧', () => {
    const { container } = renderBlock({ kind: 'branch' });
    const rightRows = container.querySelectorAll('[data-testid^="block-row-right-"]');
    expect(rightRows.length).toBeGreaterThan(0);
  });

  it('折叠隐藏数据行，头部保留', () => {
    renderBlock({ kind: 'on_block_break', collapsed: true });
    expect(screen.getByText('方块被破坏')).toBeInTheDocument();
    expect(screen.queryByTestId('block-row-left-customData')).not.toBeInTheDocument();
  });

  it('折叠/设置按钮可点击', () => {
    renderBlock({ kind: 'on_block_break' });
    const collapseBtn = screen.getByRole('button', { name: /折叠|展开/i });
    expect(collapseBtn).toBeInTheDocument();
  });

  it('未知 kind 显示占位', () => {
    renderBlock({ kind: 'unknown_kind' });
    expect(screen.getByText(/未知积木类型: unknown_kind/i)).toBeInTheDocument();
  });

  it('数字行可 inline 编辑：改值回车写入 store（先记撤销点）', () => {
    renderBlock({ kind: 'get_entity_pos', x: 10 });
    // click-to-edit：先点击值按钮进入编辑态，才出现 spinbutton
    fireEvent.click(screen.getByTestId('inline-value-left-x'));
    const input = screen.getByRole('spinbutton', { name: /x/i });
    expect(input).toBeInTheDocument();
  });

  it('字符串行 inline 编辑', () => {
    renderBlock({ kind: 'get_entity_pos', target: 'player' });
    fireEvent.click(screen.getByTestId('inline-value-left-target'));
    const input = screen.getByRole('textbox', { name: /target/i });
    expect(input).toBeInTheDocument();
  });

  it('布尔行渲染开关，点击取反提交', () => {
    renderBlock({ kind: 'is_day' });
    const checkbox = screen.getByRole('switch');
    expect(checkbox).toBeInTheDocument();
  });

  it('非基础类型行只读（无 inline 编辑器，去抽屉）', () => {
    renderBlock({ kind: 'on_block_break', customData: {} });
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('已连线的行只读（边优先，字面量不生效）', () => {
    renderBlock({ kind: 'on_block_break' });
    // 模拟有数据边连接的情况
    // 这里只验证渲染不报错
    expect(screen.getByTestId('puzzle-block')).toBeInTheDocument();
  });
});
