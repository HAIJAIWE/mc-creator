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

  it('折叠时主体隐藏，端口区仍渲染（输入+输出端口均保留）', () => {
    renderWithProvider(
      <McNodeShell {...defaultProps} collapsed={true}>
        <div>摘要</div>
      </McNodeShell>,
    );
    expect(screen.queryByText('摘要内容')).toBeNull();
    // P2 修正：折叠时端口区完整保留（输入+输出），便于连线和视觉一致性
    expect(screen.getByText('材料')).toBeTruthy();
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

  // ============================================================
  // P0-1 codeLock UI：McNodeShell 显示锁定状态
  // ============================================================
  describe('codeLocked 状态', () => {
    it('codeLocked=true 时渲染锁定标记', () => {
      renderWithProvider(
        <McNodeShell {...defaultProps} codeLocked={true}>
          <div>摘要</div>
        </McNodeShell>,
      );
      // 锁定标记应有 aria-label 或 title 标识
      expect(screen.getByLabelText('代码已锁定')).toBeTruthy();
    });

    it('codeLocked=false 时不渲染锁定标记', () => {
      renderWithProvider(
        <McNodeShell {...defaultProps} codeLocked={false}>
          <div>摘要</div>
        </McNodeShell>,
      );
      expect(screen.queryByLabelText('代码已锁定')).toBeNull();
    });

    it('不传 codeLocked 时不渲染锁定标记（默认未锁定）', () => {
      renderWithProvider(
        <McNodeShell {...defaultProps}>
          <div>摘要</div>
        </McNodeShell>,
      );
      expect(screen.queryByLabelText('代码已锁定')).toBeNull();
    });

    it('codeLocked=true 时节点外壳加锁定边框样式', () => {
      const { container } = renderWithProvider(
        <McNodeShell {...defaultProps} codeLocked={true}>
          <div>摘要</div>
        </McNodeShell>,
      );
      const wrapper = container.firstChild as HTMLElement;
      expect(wrapper.className).toContain('border-yellow');
    });

    it('codeLocked=true 时仍显示原 badge', () => {
      renderWithProvider(
        <McNodeShell {...defaultProps} badge="罕见" codeLocked={true}>
          <div>摘要</div>
        </McNodeShell>,
      );
      expect(screen.getByText('罕见')).toBeTruthy();
      expect(screen.getByLabelText('代码已锁定')).toBeTruthy();
    });
  });
});
