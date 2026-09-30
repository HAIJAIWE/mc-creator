// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ModeSwitcher } from './ModeSwitcher.js';
import { useEditorModeStore } from '../../store/editor-mode-store.js';

describe('ModeSwitcher a11y 键盘导航', () => {
  beforeEach(() => {
    useEditorModeStore.setState({ mode: 'lowcode' });
  });

  it('Roving Tabindex：仅当前选中项 tabIndex=0，其余 tabIndex=-1', () => {
    render(<ModeSwitcher />);
    const lowcodeBtn = screen.getByRole('radio', { name: /L1 低代码/ });
    const hybridBtn = screen.getByRole('radio', { name: /L2 混合/ });
    const purecodeBtn = screen.getByRole('radio', { name: /L3 纯代码/ });

    expect(lowcodeBtn).toHaveAttribute('tabIndex', '0');
    expect(hybridBtn).toHaveAttribute('tabIndex', '-1');
    expect(purecodeBtn).toHaveAttribute('tabIndex', '-1');

    // 切换到 hybrid
    fireEvent.click(hybridBtn);
    expect(lowcodeBtn).toHaveAttribute('tabIndex', '-1');
    expect(hybridBtn).toHaveAttribute('tabIndex', '0');
    expect(purecodeBtn).toHaveAttribute('tabIndex', '-1');
  });

  it('ArrowRight/ArrowDown 循环切换到下一项', () => {
    render(<ModeSwitcher />);
    const container = screen.getByRole('radiogroup');
    const lowcodeBtn = screen.getByRole('radio', { name: /L1 低代码/ });
    const hybridBtn = screen.getByRole('radio', { name: /L2 混合/ });
    const purecodeBtn = screen.getByRole('radio', { name: /L3 纯代码/ });

    // 手动聚焦第一个 radio（jsdom 默认 focus 在 body）
    lowcodeBtn.focus();
    expect(lowcodeBtn).toHaveFocus();

    // ArrowRight → hybrid
    fireEvent.keyDown(container, { key: 'ArrowRight' });
    expect(hybridBtn).toHaveFocus();
    expect(useEditorModeStore.getState().mode).toBe('hybrid');

    // ArrowDown → purecode
    fireEvent.keyDown(container, { key: 'ArrowDown' });
    expect(purecodeBtn).toHaveFocus();
    expect(useEditorModeStore.getState().mode).toBe('purecode');

    // ArrowRight 循环回 lowcode
    fireEvent.keyDown(container, { key: 'ArrowRight' });
    expect(lowcodeBtn).toHaveFocus();
    expect(useEditorModeStore.getState().mode).toBe('lowcode');
  });

  it('ArrowLeft/ArrowUp 循环切换到上一项', () => {
    render(<ModeSwitcher />);
    const container = screen.getByRole('radiogroup');
    const lowcodeBtn = screen.getByRole('radio', { name: /L1 低代码/ });
    const hybridBtn = screen.getByRole('radio', { name: /L2 混合/ });
    const purecodeBtn = screen.getByRole('radio', { name: /L3 纯代码/ });

    lowcodeBtn.focus();
    expect(lowcodeBtn).toHaveFocus();

    // ArrowLeft → purecode (循环)
    fireEvent.keyDown(container, { key: 'ArrowLeft' });
    expect(purecodeBtn).toHaveFocus();
    expect(useEditorModeStore.getState().mode).toBe('purecode');

    // ArrowUp → hybrid
    fireEvent.keyDown(container, { key: 'ArrowUp' });
    expect(hybridBtn).toHaveFocus();
    expect(useEditorModeStore.getState().mode).toBe('hybrid');

    // ArrowLeft → lowcode
    fireEvent.keyDown(container, { key: 'ArrowLeft' });
    expect(lowcodeBtn).toHaveFocus();
    expect(useEditorModeStore.getState().mode).toBe('lowcode');
  });

  it('Home 跳到第一项，End 跳到最后一项', () => {
    render(<ModeSwitcher />);
    const container = screen.getByRole('radiogroup');
    const lowcodeBtn = screen.getByRole('radio', { name: /L1 低代码/ });
    const hybridBtn = screen.getByRole('radio', { name: /L2 混合/ });
    const purecodeBtn = screen.getByRole('radio', { name: /L3 纯代码/ });

    // 先切到 hybrid
    fireEvent.click(hybridBtn);
    hybridBtn.focus();
    expect(hybridBtn).toHaveFocus();

    // Home → lowcode
    fireEvent.keyDown(container, { key: 'Home' });
    expect(lowcodeBtn).toHaveFocus();
    expect(useEditorModeStore.getState().mode).toBe('lowcode');

    // End → purecode
    fireEvent.keyDown(container, { key: 'End' });
    expect(purecodeBtn).toHaveFocus();
    expect(useEditorModeStore.getState().mode).toBe('purecode');
  });

  it('disabled=true 时不响应键盘导航', () => {
    render(<ModeSwitcher disabled />);
    const container = screen.getByRole('radiogroup');
    const lowcodeBtn = screen.getByRole('radio', { name: /L1 低代码/ });
    const hybridBtn = screen.getByRole('radio', { name: /L2 混合/ });
    expect(hybridBtn).toBeInTheDocument();

    lowcodeBtn.focus();
    expect(lowcodeBtn).toHaveFocus();

    fireEvent.keyDown(container, { key: 'ArrowRight' });
    // 模式不应改变
    expect(useEditorModeStore.getState().mode).toBe('lowcode');
    expect(lowcodeBtn).toHaveFocus();
  });

  it('radiogroup 具备 aria-label，每个 radio 具备 aria-checked 与描述性 aria-label', () => {
    render(<ModeSwitcher />);
    const group = screen.getByRole('radiogroup');
    expect(group).toHaveAttribute('aria-label', '编辑模式切换');

    const lowcodeBtn = screen.getByRole('radio', { name: /L1 低代码/ });
    const hybridBtn = screen.getByRole('radio', { name: /L2 混合/ });
    const purecodeBtn = screen.getByRole('radio', { name: /L3 纯代码/ });

    expect(lowcodeBtn).toHaveAttribute('aria-checked', 'true');
    expect(lowcodeBtn).toHaveAttribute('aria-label', expect.stringContaining('L1'));
    expect(lowcodeBtn).toHaveAttribute('aria-label', expect.stringContaining('节点图编辑'));

    expect(hybridBtn).toHaveAttribute('aria-checked', 'false');
    expect(hybridBtn).toHaveAttribute('aria-label', expect.stringContaining('L2'));
    expect(hybridBtn).toHaveAttribute('aria-label', expect.stringContaining('Monaco'));

    expect(purecodeBtn).toHaveAttribute('aria-checked', 'false');
    expect(purecodeBtn).toHaveAttribute('aria-label', expect.stringContaining('L3'));
    expect(purecodeBtn).toHaveAttribute('aria-label', expect.stringContaining('脚手架'));
  });
});
