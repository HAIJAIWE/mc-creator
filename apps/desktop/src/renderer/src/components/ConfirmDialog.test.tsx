// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';
import 'axe-core'; // 副作用导入：在 jsdom 下挂载 window.axe
import type * as AxeTypes from 'axe-core';
import { ConfirmDialog } from './ConfirmDialog.js';

afterEach(cleanup);

/**
 * axe 扫描整页（Modal 用 portal 挂 document.body，扫 RTL container 会扫空）。
 * 禁用规则清单与 src/test/a11y.scan.test.tsx 保持一致。
 */
async function scanAxeViolations(): Promise<AxeTypes.Result[]> {
  const axe = (window as unknown as { axe?: typeof AxeTypes }).axe;
  if (!axe) throw new Error('window.axe 未挂载，请确认 axe-core 已正确导入');
  const results = await axe.run(document.body, {
    rules: {
      'color-contrast': { enabled: false },
      region: { enabled: false },
      'landmark-one-main': { enabled: false },
      'page-has-heading-one': { enabled: false },
      tabindex: { enabled: false },
      'focus-order-semantics': { enabled: false },
      'target-size': { enabled: false },
    },
    runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] },
  });
  return results.violations;
}

/** 默认参数：open=true 的确认框，测试里按需覆盖单个 prop */
function renderConfirm(overrides: Partial<React.ComponentProps<typeof ConfirmDialog>> = {}) {
  const props = {
    open: true,
    message: '确定删除该文件吗？',
    onConfirm: vi.fn(),
    onCancel: vi.fn(),
    ...overrides,
  };
  return { props, ...render(<ConfirmDialog {...props} />) };
}

describe('ConfirmDialog', () => {
  it('open=false 时不渲染任何内容', () => {
    const { container } = renderConfirm({ open: false });
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('渲染 role="dialog" + aria-modal 的模态结构', () => {
    renderConfirm();
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
  });

  it('渲染 message 正文', () => {
    renderConfirm();
    expect(screen.getByText('确定删除该文件吗？')).toBeInTheDocument();
  });

  it('children 存在时优先于 message', () => {
    renderConfirm({ children: <span>自定义内容</span> });
    expect(screen.getByText('自定义内容')).toBeInTheDocument();
    expect(screen.queryByText('确定删除该文件吗？')).toBeNull();
  });

  it('无 children 时标题兜底为 i18n「警告」', () => {
    renderConfirm({ children: <span>自定义内容</span> });
    expect(screen.getByRole('heading', { name: '警告' })).toBeInTheDocument();
  });

  it('传 title 时用 title，且 aria-labelledby 指向该标题', () => {
    renderConfirm({ title: '删除确认' });
    const dialog = screen.getByRole('dialog');
    const heading = screen.getByRole('heading', { name: '删除确认' });
    expect(dialog).toHaveAttribute('aria-labelledby', heading.id);
    expect(heading.id).not.toBe('');
  });

  it('既无 title 也无 children 时不渲染标题栏（无 aria-labelledby）', () => {
    renderConfirm();
    expect(screen.queryByRole('heading')).toBeNull();
    expect(screen.getByRole('dialog')).not.toHaveAttribute('aria-labelledby');
    // 但关闭入口恒在（键盘用户不能只剩 Escape 一条路）
    expect(screen.getByRole('button', { name: '关闭' })).toBeInTheDocument();
  });

  it('aria-describedby 指向正文区域', () => {
    renderConfirm();
    const dialog = screen.getByRole('dialog');
    const describedBy = dialog.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy as string)).toHaveTextContent('确定删除该文件吗？');
  });

  it('默认按钮文案取 i18n（取消 / 确定）', () => {
    renderConfirm();
    expect(screen.getByRole('button', { name: '取消' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '确定' })).toBeInTheDocument();
  });

  it('confirmText / cancelText 可覆盖默认文案', () => {
    renderConfirm({ confirmText: '删除', cancelText: '再想想' });
    expect(screen.getByRole('button', { name: '再想想' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '删除' })).toBeInTheDocument();
  });

  it('destructive 时确认按钮用危险样式（mc-btn-danger）', () => {
    renderConfirm({ destructive: true });
    expect(screen.getByRole('button', { name: '确定' }).className).toContain('mc-btn-danger');
  });

  it('非 destructive 时确认按钮用主样式（mc-btn-primary）', () => {
    renderConfirm();
    expect(screen.getByRole('button', { name: '确定' }).className).toContain('mc-btn-primary');
  });

  it('点击取消触发 onCancel', () => {
    const onCancel = vi.fn();
    renderConfirm({ onCancel });
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('点击确认触发 onConfirm', () => {
    const onConfirm = vi.fn();
    renderConfirm({ onConfirm });
    fireEvent.click(screen.getByRole('button', { name: '确定' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('点击关闭按钮触发 onCancel', () => {
    const onCancel = vi.fn();
    renderConfirm({ onCancel });
    fireEvent.click(screen.getByRole('button', { name: '关闭' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('点击遮罩触发 onCancel', () => {
    const onCancel = vi.fn();
    renderConfirm({ onCancel });
    fireEvent.click(screen.getByTestId('mc-modal-overlay'));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('confirmLoading 时两个按钮都禁用且不触发回调', () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    renderConfirm({ onConfirm, onCancel, confirmLoading: true });

    const confirmBtn = screen.getByRole('button', { name: '加载中...' });
    expect(confirmBtn).toBeDisabled();
    expect(screen.getByRole('button', { name: '取消' })).toBeDisabled();
    expect(confirmBtn).toHaveAttribute('aria-busy', 'true');

    fireEvent.click(confirmBtn);
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(onConfirm).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('Escape 触发 onCancel（Modal 文档级监听）', () => {
    const onCancel = vi.fn();
    renderConfirm({ onCancel });
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('焦点在非交互元素上时回车触发 onConfirm', () => {
    const onConfirm = vi.fn();
    renderConfirm({ onConfirm });
    fireEvent.keyDown(document.body, { key: 'Enter' });
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('焦点在按钮上时回车不额外触发 onConfirm（避免确认/取消双触发）', () => {
    const onConfirm = vi.fn();
    renderConfirm({ onConfirm });
    fireEvent.keyDown(screen.getByRole('button', { name: '取消' }), { key: 'Enter' });
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('confirmLoading 时回车不触发 onConfirm', () => {
    const onConfirm = vi.fn();
    renderConfirm({ onConfirm, confirmLoading: true });
    fireEvent.keyDown(document.body, { key: 'Enter' });
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('Ctrl+Enter 等组合键不触发 onConfirm（留给上层快捷键）', () => {
    const onConfirm = vi.fn();
    renderConfirm({ onConfirm });
    fireEvent.keyDown(document.body, { key: 'Enter', ctrlKey: true });
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('a11y：打开时焦点移入对话框（落在取消按钮上，最无害的动作）', () => {
    renderConfirm();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '取消' }));
  });

  it('a11y：关闭后焦点归还给打开它的元素', () => {
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);
    trigger.focus();

    const props = { open: true, message: 'x', onConfirm: vi.fn(), onCancel: vi.fn() };
    const { rerender } = render(<ConfirmDialog {...props} />);
    expect(document.activeElement).not.toBe(trigger);

    rerender(<ConfirmDialog {...props} open={false} />);
    expect(document.activeElement).toBe(trigger);
    trigger.remove();
  });

  it('a11y：axe-core 扫描（带标题）无 WCAG 违规', async () => {
    renderConfirm({ title: '删除确认' });
    expect(await scanAxeViolations()).toEqual([]);
  });

  it('a11y：axe-core 扫描（无标题）无 WCAG 违规', async () => {
    renderConfirm();
    expect(await scanAxeViolations()).toEqual([]);
  });

  it('a11y：axe-core 扫描（自定义 children + 危险操作）无 WCAG 违规', async () => {
    renderConfirm({ destructive: true, children: <input aria-label="文件名" defaultValue="a" /> });
    expect(await scanAxeViolations()).toEqual([]);
  });
});
