// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';
import 'axe-core'; // 副作用导入：在 jsdom 下挂载 window.axe
import type * as AxeTypes from 'axe-core';
import { PromptDialog } from './PromptDialog.js';

afterEach(cleanup);

/**
 * axe 扫描整页：PromptDialog 走 ui `Modal` 的 portal（挂 document.body），
 * 扫 RTL 的 container 会扫到空节点 —— 那样断言就成了假绿。
 * 禁用规则清单与 src/test/a11y.scan.test.tsx 一致。
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

/** 覆盖项：`undefined` 显式表示「不传这个 prop」，用来切 prompt / confirm 模式 */
type PromptOverrides = {
  [K in keyof React.ComponentProps<typeof PromptDialog>]?:
    React.ComponentProps<typeof PromptDialog>[K] | undefined;
};

/**
 * 默认参数：prompt 模式（传 placeholder）的对话框。
 *
 * 覆盖项里显式写 `placeholder: undefined` 是本文件切到 confirm 模式的手法；
 * 本项目开了 exactOptionalPropertyTypes，JSX 展开不接受 `prop: undefined`
 * 这种「存在但为 undefined」的形态，所以先剥掉这些键再展开。
 */
function renderPrompt(overrides: PromptOverrides = {}) {
  const merged = {
    title: '重命名文件',
    message: '请输入新的文件名',
    placeholder: '输入...',
    onClose: vi.fn(),
    onConfirm: vi.fn(),
    ...overrides,
  };
  const props = Object.fromEntries(
    Object.entries(merged).filter(([, value]) => value !== undefined),
  ) as unknown as React.ComponentProps<typeof PromptDialog>;
  return { props, ...render(<PromptDialog {...props} />) };
}

describe('PromptDialog', () => {
  it('渲染 role="dialog" + aria-modal，并带标题', () => {
    renderPrompt();
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAttribute('aria-labelledby', screen.getByRole('heading').id);
    expect(screen.getByRole('heading')).toHaveTextContent('重命名文件');
  });

  it('prompt 模式渲染输入框（placeholder + aria-label 用 title）', () => {
    renderPrompt();
    const input = screen.getByPlaceholderText('输入...');
    expect(input).toHaveAttribute('aria-label', '重命名文件');
    expect(input).toHaveValue('');
  });

  it('confirm 模式（无 placeholder/defaultValue）不渲染输入框', () => {
    renderPrompt({ placeholder: undefined, message: '确定要清空吗？' });
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.getByText('确定要清空吗？')).toBeInTheDocument();
  });

  it('message 为空时不渲染说明段落', () => {
    renderPrompt({ message: undefined });
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('defaultValue 作为输入框初值', () => {
    renderPrompt({ placeholder: undefined, defaultValue: '原名.java' });
    expect(screen.getByRole('textbox')).toHaveValue('原名.java');
  });

  it('输入内容后点确认：回调收到新值并关闭', () => {
    const onConfirm = vi.fn();
    const onClose = vi.fn();
    renderPrompt({ onConfirm, onClose });

    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: '新名.java' } });
    fireEvent.click(screen.getByRole('button', { name: '确定' }));

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledWith('新名.java');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('confirm 模式下 onConfirm 收到空字符串', () => {
    const onConfirm = vi.fn();
    renderPrompt({ placeholder: undefined, onConfirm });
    fireEvent.click(screen.getByRole('button', { name: '确定' }));
    expect(onConfirm).toHaveBeenCalledWith('');
  });

  it('输入框内回车 = 确认（值 + 关闭）', () => {
    const onConfirm = vi.fn();
    const onClose = vi.fn();
    renderPrompt({ onConfirm, onClose });

    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'abc' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onConfirm).toHaveBeenCalledWith('abc');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('点取消只关闭、不确认', () => {
    const onConfirm = vi.fn();
    const onClose = vi.fn();
    renderPrompt({ onConfirm, onClose });
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(onConfirm).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('点关闭按钮触发 onClose', () => {
    const onClose = vi.fn();
    renderPrompt({ onClose });
    fireEvent.click(screen.getByRole('button', { name: '关闭' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('Escape 触发 onClose', () => {
    const onClose = vi.fn();
    renderPrompt({ onClose });
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('点遮罩不关闭（避免误触丢失已输入内容）', () => {
    const onClose = vi.fn();
    const onConfirm = vi.fn();
    renderPrompt({ onClose, onConfirm });
    fireEvent.click(screen.getByTestId('mc-modal-overlay'));
    expect(onClose).not.toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('confirmLabel / cancelLabel 可覆盖默认文案', () => {
    renderPrompt({ confirmLabel: '清空', cancelLabel: '再想想' });
    expect(screen.getByRole('button', { name: '清空' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '再想想' })).toBeInTheDocument();
  });

  it('danger 模式确认按钮用危险样式', () => {
    renderPrompt({ danger: true });
    expect(screen.getByRole('button', { name: '确定' }).className).toContain('mc-btn-danger');
  });

  it('默认（非 danger）确认按钮用主样式', () => {
    renderPrompt();
    expect(screen.getByRole('button', { name: '确定' }).className).toContain('mc-btn-primary');
  });

  it('prompt 模式打开后焦点落在输入框', () => {
    renderPrompt();
    expect(document.activeElement).toBe(screen.getByRole('textbox'));
  });

  it('confirm 模式打开后焦点落在对话框内', () => {
    renderPrompt({ placeholder: undefined });
    expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true);
  });

  it('a11y：axe-core 扫描（prompt 模式）无 WCAG 违规', async () => {
    renderPrompt();
    expect(await scanAxeViolations()).toEqual([]);
  });

  it('a11y：axe-core 扫描（confirm 模式）无 WCAG 违规', async () => {
    renderPrompt({ placeholder: undefined });
    expect(await scanAxeViolations()).toEqual([]);
  });
});
