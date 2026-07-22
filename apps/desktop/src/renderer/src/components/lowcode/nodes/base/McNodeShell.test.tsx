// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ReactFlowProvider } from 'reactflow';
import { McNodeShell } from './McNodeShell.js';
import type { NodePort } from '@mc-creator/shared';

const ports: NodePort[] = [
  { id: 'in', label: '材料', type: 'item_stack', direction: 'in', required: true, multiple: true },
  {
    id: 'out',
    label: '产物',
    type: 'item_stack',
    direction: 'out',
    required: false,
    multiple: false,
  },
];

function renderWithProvider(ui: React.ReactElement) {
  return render(<ReactFlowProvider>{ui}</ReactFlowProvider>);
}

describe('McNodeShell', () => {
  const defaultProps = {
    icon: 'sword',
    title: '物品',
    colorClass: 'mc-item',
    badge: '普通',
    ports,
    collapsed: false,
    onToggleCollapse: () => {},
    onOpenDrawer: () => {},
  };

  it('展开时渲染头部 + 主体 + 端口', () => {
    renderWithProvider(
      <McNodeShell {...defaultProps}>
        <div>摘要内容</div>
      </McNodeShell>,
    );
    expect(screen.getByText('物品')).toBeTruthy();
    expect(screen.getByText('摘要内容')).toBeTruthy();
    expect(screen.getByText('材料')).toBeTruthy();
    expect(screen.getByText('产物')).toBeTruthy();
  });

  it('折叠时隐藏主体，仍渲染端口', () => {
    renderWithProvider(
      <McNodeShell {...defaultProps} collapsed={true}>
        <div>摘要内容</div>
      </McNodeShell>,
    );
    expect(screen.queryByText('摘要内容')).toBeNull();
    expect(screen.getByText('产物')).toBeTruthy();
  });

  it('折叠时隐藏输入端口，保留输出端口', () => {
    renderWithProvider(
      <McNodeShell {...defaultProps} collapsed={true}>
        <div>摘要</div>
      </McNodeShell>,
    );
    expect(screen.queryByText('材料')).toBeNull();
    expect(screen.getByText('产物')).toBeTruthy();
  });

  it('点击折叠按钮触发 onToggleCollapse', () => {
    const onToggle = vi.fn();
    renderWithProvider(
      <McNodeShell {...defaultProps} onToggleCollapse={onToggle}>
        <div>摘要</div>
      </McNodeShell>,
    );
    fireEvent.click(screen.getByLabelText('折叠'));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('点击设置按钮触发 onOpenDrawer', () => {
    const onOpen = vi.fn();
    renderWithProvider(
      <McNodeShell {...defaultProps} onOpenDrawer={onOpen}>
        <div>摘要</div>
      </McNodeShell>,
    );
    fireEvent.click(screen.getByLabelText('设置'));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('selected=true 时添加选中边框样式', () => {
    const { container } = renderWithProvider(
      <McNodeShell {...defaultProps} selected={true}>
        <div>摘要</div>
      </McNodeShell>,
    );
    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper.className).toContain('border-mc-accent');
  });

  it('无 children 时不渲染主体区', () => {
    renderWithProvider(<McNodeShell {...defaultProps} />);
    expect(screen.queryByText('摘要内容')).toBeNull();
  });
});
