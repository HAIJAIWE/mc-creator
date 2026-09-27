// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ReactFlowProvider } from 'reactflow';
import { type NodeProps } from 'reactflow';
import { VerticalCoreNode, type VerticalCoreNodeData } from './VerticalCoreNode.js';
import { registerAllCoreNodes } from '@mc-creator/shared';

// mock 工厂会被提升，先用 vi.hoisted 准备共享可变状态
const mocks = vi.hoisted(() => ({
  updateNode: vi.fn(),
  commit: vi.fn(),
  edges: [] as { target: string; targetHandle?: string }[],
}));

vi.mock('../../../store/node-graph-store.js', () => ({
  useNodeGraphStore: (sel: (s: Record<string, unknown>) => unknown) =>
    sel({
      toggleCollapse: () => {},
      updateNode: mocks.updateNode,
      commit: mocks.commit,
      graph: { edges: mocks.edges },
    }),
}));

vi.mock('../../../store/drawer-store.js', () => ({
  useDrawerStore: (sel: (s: { openDrawer: () => void }) => unknown) =>
    sel({ openDrawer: () => {} }),
}));

registerAllCoreNodes();

beforeEach(() => {
  mocks.updateNode.mockClear();
  mocks.commit.mockClear();
  mocks.edges.length = 0;
});

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
    expect(container.querySelector('[data-testid="block-notch"]')).toBeNull();
    expect(
      container.querySelector('[data-testid="block-tab"]')?.getAttribute('data-handleid'),
    ).toBe('next');
  });

  it('动作渲染为堆叠块：exec 缺口 + next 凸榫 + 数据行', () => {
    const { container } = renderBlock({
      kind: 'spawn_entity',
      entity_type: 'minecraft:creeper',
      pos: '(0,64,0)',
    });
    expect(screen.getByTestId('puzzle-block').getAttribute('data-shape')).toBe('stack');
    expect(container.querySelector('[data-handleid="exec"]')).toBeTruthy();
    expect(container.querySelector('[data-handleid="next"]')).toBeTruthy();
    expect(screen.getByTestId('block-row-left-entity_type')).toBeTruthy();
    expect(screen.getByText('minecraft:creeper')).toBeTruthy();
    // 未填值显示默认值（按行断言，避免 yaw/pitch 同值误判）
    expect(screen.getByTestId('block-row-left-yaw').textContent).toContain('0');
  });

  it('纯数据源渲染为圆角块：无缺口凸榫、输出在右侧', () => {
    const { container } = renderBlock({ kind: 'get_entity_pos' });
    expect(screen.getByTestId('puzzle-block').getAttribute('data-shape')).toBe('reporter');
    expect(container.querySelector('[data-testid="block-notch"]')).toBeNull();
    expect(container.querySelector('[data-testid="block-tab"]')).toBeNull();
    expect(screen.getByTestId('block-row-right-block_pos')).toBeTruthy();
    expect(screen.getByTestId('block-row-right-vec3')).toBeTruthy();
  });

  it('条件分支端口渲染在右侧', () => {
    const { container } = renderBlock({ kind: 'compare_numbers', a: 5, b: 3 });
    expect(screen.getByTestId('block-row-right-on_true')).toBeTruthy();
    expect(screen.getByTestId('block-row-right-on_false')).toBeTruthy();
    expect(screen.getByTestId('block-row-right-result')).toBeTruthy();
    expect(container.querySelector('[data-handleid="on_true"]')).toBeTruthy();
  });

  it('折叠隐藏数据行，头部保留', () => {
    renderBlock({ kind: 'spawn_entity', collapsed: true });
    expect(screen.getByText('生成实体')).toBeTruthy();
    expect(screen.queryByTestId('block-row-left-entity_type')).toBeNull();
  });

  it('折叠/设置按钮可点击', () => {
    const { container } = renderBlock({ kind: 'spawn_entity' });
    fireEvent.click(screen.getByRole('button', { name: '折叠积木' }));
    // 回调进 store（无断言副作用，仅保证不报错）；设置按钮同理
    fireEvent.click(screen.getByRole('button', { name: '打开节点设置' }));
    expect(container.querySelector('[data-testid="puzzle-block"]')).toBeTruthy();
  });

  it('未知 kind 显示占位', () => {
    renderBlock({ kind: 'no_such_block' });
    expect(screen.getByText('未知积木类型: no_such_block')).toBeTruthy();
  });
});

describe('VerticalCoreNode 行内编辑', () => {
  it('数字行可 inline 编辑：改值回车写回 store（先记撤销点）', () => {
    renderBlock({ kind: 'compare_numbers', a: 5, b: 3 });
    fireEvent.click(screen.getByTestId('inline-value-left-a'));
    fireEvent.change(screen.getByTestId('inline-input-left-a'), { target: { value: '42' } });
    fireEvent.keyDown(screen.getByTestId('inline-input-left-a'), { key: 'Enter' });
    expect(mocks.commit).toHaveBeenCalledTimes(1);
    expect(mocks.updateNode).toHaveBeenCalledWith('n1', { a: 42 });
  });

  it('字符串行可 inline 编辑', () => {
    renderBlock({ kind: 'send_message', text: 'Hello!' });
    fireEvent.click(screen.getByTestId('inline-value-left-text'));
    fireEvent.change(screen.getByTestId('inline-input-left-text'), { target: { value: 'bye' } });
    fireEvent.keyDown(screen.getByTestId('inline-input-left-text'), { key: 'Enter' });
    expect(mocks.updateNode).toHaveBeenCalledWith('n1', { text: 'bye' });
  });

  it('布尔行渲染开关，点击取反提交', () => {
    renderBlock({ kind: 'logic_and', a: false, b: true });
    const sw = screen.getByTestId('inline-bool-left-a');
    expect(sw.getAttribute('aria-checked')).toBe('false');
    fireEvent.click(sw);
    expect(mocks.updateNode).toHaveBeenCalledWith('n1', { a: true });
  });

  it('非基础类型行只读（无 inline 编辑器，去抽屉）', () => {
    renderBlock({ kind: 'spawn_entity', entity_type: 'minecraft:creeper' });
    expect(screen.queryByTestId('inline-value-left-entity_type')).toBeNull();
    expect(screen.getByText('minecraft:creeper')).toBeTruthy();
  });

  it('已连线的行只读（边优先，字面量不生效）', () => {
    mocks.edges.push({ target: 'n1', targetHandle: 'a' });
    renderBlock({ kind: 'compare_numbers', a: 5, b: 3 });
    expect(screen.queryByTestId('inline-value-left-a')).toBeNull();
    // 未连线的 b 行仍可编辑
    expect(screen.getByTestId('inline-value-left-b')).toBeTruthy();
  });
});
