// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { ShortcutHelpDialog, SHORTCUTS } from './ShortcutHelpDialog.js';

afterEach(cleanup);

describe('ShortcutHelpDialog', () => {
  it('open=false 时不渲染', () => {
    render(<ShortcutHelpDialog open={false} onClose={vi.fn()} />);
    expect(document.querySelector('.fixed.inset-0')).toBeNull();
  });

  it('open=true 时渲染标题与快捷键总数', () => {
    render(<ShortcutHelpDialog open onClose={vi.fn()} />);
    expect(screen.getByText('快捷键帮助')).toBeTruthy();
    // 底部统计显示总数
    expect(screen.getByText(new RegExp(`共 ${SHORTCUTS.length} 个快捷键`))).toBeTruthy();
  });

  it('渲染所有快捷键描述', () => {
    render(<ShortcutHelpDialog open onClose={vi.fn()} />);
    // 部分描述可能重复（如"打开命令面板"对应 F1 和 Ctrl+Shift+P），用 getAllByText
    for (const s of SHORTCUTS) {
      expect(screen.getAllByText(s.description).length).toBeGreaterThan(0);
    }
  });

  it('渲染所有快捷键按键', () => {
    render(<ShortcutHelpDialog open onClose={vi.fn()} />);
    // kbd 元素显示按键
    const kbdElements = document.querySelectorAll('kbd');
    expect(kbdElements).toHaveLength(SHORTCUTS.length);
    const keys = Array.from(kbdElements).map((el) => el.textContent);
    for (const s of SHORTCUTS) {
      expect(keys).toContain(s.keys);
    }
  });

  it('按分类分组渲染（每个分类有标题）', () => {
    render(<ShortcutHelpDialog open onClose={vi.fn()} />);
    const categories = Array.from(new Set(SHORTCUTS.map((s) => s.category)));
    for (const cat of categories) {
      expect(screen.getByText(cat)).toBeTruthy();
    }
  });

  it('点击遮罩关闭', () => {
    const onClose = vi.fn();
    render(<ShortcutHelpDialog open onClose={onClose} />);
    // 遮罩是最外层 div（fixed inset-0）
    const overlay = document.querySelector('.fixed.inset-0') as HTMLElement;
    fireEvent.click(overlay);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('点击对话框内部不关闭', () => {
    const onClose = vi.fn();
    render(<ShortcutHelpDialog open onClose={onClose} />);
    // 内部容器有 stopPropagation
    const dialog = document.querySelector('.fixed.inset-0 > div') as HTMLElement;
    fireEvent.click(dialog);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('点击右上角 ✕ 关闭', () => {
    const onClose = vi.fn();
    render(<ShortcutHelpDialog open onClose={onClose} />);
    const closeBtn = screen.getByTitle('关闭 (Esc)') as HTMLElement;
    fireEvent.click(closeBtn);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('按 Esc 关闭', () => {
    const onClose = vi.fn();
    render(<ShortcutHelpDialog open onClose={onClose} />);
    // 注意：key 监听是 window-level
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('open=false 时不监听 Esc', () => {
    const onClose = vi.fn();
    const { rerender } = render(<ShortcutHelpDialog open={false} onClose={onClose} />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
    // 即使后续切到 open=true 也不会泄漏旧监听
    rerender(<ShortcutHelpDialog open onClose={onClose} />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();
  });
});
