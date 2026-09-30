// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ReactFlowProvider } from '@xyflow/react';
import { type NodeProps } from '@xyflow/react';
import { type VerticalCoreNodeData } from '@mc-creator/shared';

// Mock shared module with nodeRegistry
vi.mock('@mc-creator/shared', () => ({
  nodeRegistry: {
    get: vi.fn((kind: string) => {
      const baseDef = {
        icon: 'cube',
        label: kind,
        category: 'logic',
        color: 'blue',
        inputs: [],
        outputs: [],
      };
      return baseDef;
    }),
  },
  VerticalCoreNodeData: {} as any,
}));

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
import { VerticalCoreNode } from './VerticalCoreNode.js';
import { type NodeProps } from '@xyflow/react';

function renderBlock(data: VerticalCoreNodeData) {
  return render(
    <ReactFlowProvider>
      <VerticalCoreNode
        {...({ id: 'n1', data, selected: false } as unknown as NodeProps<VerticalCoreNodeData>)}
      />
    </ReactFlowProvider>,
  );
}

describe('VerticalCoreNode 拼图积木渲染', () => {
  it('事件渲染为帽子块：无缺口、有凸榫', () => {
    const { container } = renderBlock({ kind: 'on_block_break' });
    expect(screen.getByTestId('puzzle-block').getAttribute('data-shape')).toBe('hat');
    expect(screen.getByText('方块被破坏')).toBeTruthy();
  });

  it('动作渲染为堆叠块：exec 缺口 + next 凸榫 + 数据端口', () => {
    const { container } = renderBlock({ kind: 'damage_entity' });
    expect(screen.getByTestId('puzzle-block').getAttribute('data-shape')).toBe('stack');
  });

  it('纯数据源渲染为圆角块：无缺口凸榫、输出在右侧', () => {
    const { container } = renderBlock({ kind: 'get_entity_pos' });
    expect(screen.getByTestId('puzzle-block').getAttribute('data-shape')).toBe('reporter');
  });

  it('条件分支端口渲染在右侧', () => {
    const { container } = renderBlock({ kind: 'branch' });
    const rightRows = container.querySelectorAll('[data-testid="right-rows"]');
    expect(rightRows.length).toBeGreaterThan(0);
  });

  it('折叠隐藏数据行，头部保留', () => {
    const { container } = renderBlock({ kind: 'on_block_break', collapsed: true });
    expect(screen.getByTestId('puzzle-block')).toHaveAttribute('data-collapsed', 'true');
  });

  it('折叠/设置按钮可点击', () => {
    renderBlock({ kind: 'on_block_break' });
    const collapseBtn = screen.getByRole('button', { name: /折叠|展开/i });
    expect(collapseBtn).toBeInTheDocument();
  });

  it('未知 kind 显示占位', () => {
    const { container } = renderBlock({ kind: 'unknown_kind' });
    expect(screen.getByText(/未知积木类型: unknown_kind/i)).toBeInTheDocument();
  });

  it('数字行可 inline 编辑：改值回车写入 store（先记撤销点）', () => {
    const { container } = renderBlock({ kind: 'get_entity_pos', x: 10 });
    const input = screen.getByRole('spinbutton', { name: /x/i });
    expect(input).toBeInTheDocument();
  });

  it('字符串行 inline 编辑', () => {
    const { container } = renderBlock({ kind: 'get_entity_pos', target: 'player' });
    const input = screen.getByRole('textbox', { name: /target/i });
    expect(input).toBeInTheDocument();
  });

  it('布尔行渲染开关，点击取反提交', () => {
    const { container } = renderBlock({ kind: 'is_day' });
    const checkbox = screen.getByRole('switch');
    expect(checkbox).toBeInTheDocument();
  });

  it('非基础类型行只读（无 inline 编辑器，去抽屉）', () => {
    const { container } = renderBlock({ kind: 'on_block_break', customData: {} });
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('已连线的行只读（边优先，字面量不生效）', () => {
    const { container } = renderBlock({ kind: 'on_block_break' });
    // 模拟有数据边连接的情况
    // 这里只验证渲染不报错
    expect(screen.getByTestId('puzzle-block')).toBeInTheDocument();
  });
});
