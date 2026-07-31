// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { CommandPalette, type Command, MC_COMMAND_TEMPLATES } from './CommandPalette.js';

// jsdom 未实现 Element.prototype.scrollIntoView，CommandPalette 内部使用它
beforeEach(() => {
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = vi.fn();
  }
});

afterEach(cleanup);

function makeCmd(overrides: Partial<Command> = {}): Command {
  return {
    id: overrides.id ?? 'cmd-' + Math.random().toString(36).slice(2, 6),
    label: overrides.label ?? '测试命令',
    run: overrides.run ?? vi.fn(),
    ...overrides,
  };
}

describe('CommandPalette', () => {
  it('open=false 时不渲染', () => {
    render(<CommandPalette open={false} onClose={vi.fn()} commands={[]} />);
    expect(document.querySelector('.fixed.inset-0')).toBeNull();
  });

  it('open=true 时渲染搜索框和命令列表', () => {
    const cmds = [makeCmd({ id: 'a', label: '命令 A' }), makeCmd({ id: 'b', label: '命令 B' })];
    render(<CommandPalette open onClose={vi.fn()} commands={cmds} />);

    expect(screen.getByPlaceholderText(/输入命令名/)).toBeTruthy();
    expect(screen.getByText('命令 A')).toBeTruthy();
    expect(screen.getByText('命令 B')).toBeTruthy();
  });

  it('底部统计显示当前命令数 / 总数', () => {
    const cmds = [makeCmd({ id: 'a', label: 'A' }), makeCmd({ id: 'b', label: 'B' })];
    render(<CommandPalette open onClose={vi.fn()} commands={cmds} />);
    expect(screen.getByText(/2 \/ 2 个命令/)).toBeTruthy();
  });

  it('query 过滤命令（label 匹配）', () => {
    const cmds = [makeCmd({ id: 'a', label: '保存文件' }), makeCmd({ id: 'b', label: '打开设置' })];
    render(<CommandPalette open onClose={vi.fn()} commands={cmds} />);

    const input = screen.getByPlaceholderText(/输入命令名/);
    fireEvent.change(input, { target: { value: '保存' } });

    expect(screen.getByText('保存文件')).toBeTruthy();
    expect(screen.queryByText('打开设置')).toBeNull();
    // 统计更新为 1/2
    expect(screen.getByText(/1 \/ 2 个命令/)).toBeTruthy();
  });

  it('query 过滤命令（description 匹配）', () => {
    const cmds = [
      makeCmd({ id: 'a', label: 'A', description: '保存当前文件' }),
      makeCmd({ id: 'b', label: 'B', description: '打开配置' }),
    ];
    render(<CommandPalette open onClose={vi.fn()} commands={cmds} />);

    fireEvent.change(screen.getByPlaceholderText(/输入命令名/), {
      target: { value: '配置' },
    });
    expect(screen.queryByText('保存当前文件')).toBeNull();
    expect(screen.getByText('打开配置')).toBeTruthy();
  });

  it('无匹配时显示空状态', () => {
    const cmds = [makeCmd({ id: 'a', label: 'A' })];
    render(<CommandPalette open onClose={vi.fn()} commands={cmds} />);
    fireEvent.change(screen.getByPlaceholderText(/输入命令名/), {
      target: { value: 'zzz' },
    });
    expect(screen.getByText('未找到匹配命令')).toBeTruthy();
  });

  it('点击命令执行 run 并关闭', () => {
    const runA = vi.fn();
    const onClose = vi.fn();
    const cmds = [makeCmd({ id: 'a', label: 'A', run: runA })];
    render(<CommandPalette open onClose={onClose} commands={cmds} />);

    fireEvent.click(screen.getByText('A'));
    expect(runA).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('点击遮罩关闭', () => {
    const onClose = vi.fn();
    render(<CommandPalette open onClose={onClose} commands={[]} />);
    fireEvent.click(document.querySelector('.fixed.inset-0') as HTMLElement);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('按 Esc 关闭', () => {
    const onClose = vi.fn();
    render(<CommandPalette open onClose={onClose} commands={[]} />);
    fireEvent.keyDown(screen.getByPlaceholderText(/输入命令名/), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('按 ArrowDown 移动选中项', () => {
    const cmds = [
      makeCmd({ id: 'a', label: 'A' }),
      makeCmd({ id: 'b', label: 'B' }),
      makeCmd({ id: 'c', label: 'C' }),
    ];
    render(<CommandPalette open onClose={vi.fn()} commands={cmds} />);

    const input = screen.getByPlaceholderText(/输入命令名/);
    // 默认选中第一个，按一次下移到第二个
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    // 第二项应高亮（含 CornerDownLeft 图标）
    const items = document.querySelectorAll('[id^="cmd-item-"]');
    expect(items).toHaveLength(3);
    // 通过 selectedIdx 高亮类名检测：selectedIdx=1 时第二项含 'bg-mc-accent/20'
    const secondItem = items[1] as HTMLElement;
    expect(secondItem.className).toContain('bg-mc-accent');
  });

  it('按 ArrowUp 不超出 0', () => {
    const cmds = [makeCmd({ id: 'a', label: 'A' }), makeCmd({ id: 'b', label: 'B' })];
    render(<CommandPalette open onClose={vi.fn()} commands={cmds} />);

    const input = screen.getByPlaceholderText(/输入命令名/);
    fireEvent.keyDown(input, { key: 'ArrowUp' }); // 选中 0 → 0（不变成 -1）
    const firstItem = document.querySelector('[id="cmd-item-0"]') as HTMLElement;
    expect(firstItem.className).toContain('bg-mc-accent');
  });

  it('按 Enter 执行选中命令', () => {
    const runA = vi.fn();
    const cmds = [makeCmd({ id: 'a', label: 'A', run: runA })];
    const onClose = vi.fn();
    render(<CommandPalette open onClose={onClose} commands={cmds} />);

    fireEvent.keyDown(screen.getByPlaceholderText(/输入命令名/), { key: 'Enter' });
    expect(runA).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('按 Tab 切换分类', () => {
    const cmds = [
      makeCmd({ id: 'a', label: 'A', category: 'file' }),
      makeCmd({ id: 'b', label: 'B', category: 'view' }),
    ];
    render(<CommandPalette open onClose={vi.fn()} commands={cmds} />);

    // 默认 'all'，应显示全部
    expect(screen.getByText('A')).toBeTruthy();
    expect(screen.getByText('B')).toBeTruthy();

    fireEvent.keyDown(screen.getByPlaceholderText(/输入命令名/), { key: 'Tab' });
    // 切到第一个分类 'file'，只剩 A
    expect(screen.getByText('A')).toBeTruthy();
    expect(screen.queryByText('B')).toBeNull();
  });

  it('按 Shift+Tab 反向切换分类', () => {
    const cmds = [
      makeCmd({ id: 'a', label: 'A', category: 'file' }),
      makeCmd({ id: 'b', label: 'B', category: 'view' }),
    ];
    render(<CommandPalette open onClose={vi.fn()} commands={cmds} />);

    // 'all' → Shift+Tab → 最后一个分类 'view'
    fireEvent.keyDown(screen.getByPlaceholderText(/输入命令名/), {
      key: 'Tab',
      shiftKey: true,
    });
    expect(screen.queryByText('A')).toBeNull();
    expect(screen.getByText('B')).toBeTruthy();
  });

  it('分类标签栏点击切换', () => {
    const cmds = [
      makeCmd({ id: 'a', label: 'A', category: 'file' }),
      makeCmd({ id: 'b', label: 'B', category: 'view' }),
    ];
    render(<CommandPalette open onClose={vi.fn()} commands={cmds} />);

    // "视图" 同时出现在标签栏和命令 B 的分类徽章中，取第一个（标签栏先渲染）
    const viewButtons = screen.getAllByText('视图');
    fireEvent.click(viewButtons[0]!);
    expect(screen.queryByText('A')).toBeNull();
    expect(screen.getByText('B')).toBeTruthy();
  });

  it('无分类命令时不渲染分类标签栏', () => {
    const cmds = [makeCmd({ id: 'a', label: 'A' })];
    render(<CommandPalette open onClose={vi.fn()} commands={cmds} />);
    // 无 category 时 categories 只有 ['all']，length 不 > 1，不渲染
    expect(screen.queryByText('全部')).toBeNull();
  });

  it('命令带 shortcut 时显示', () => {
    const cmds = [makeCmd({ id: 'a', label: 'A', shortcut: 'Ctrl+S' })];
    render(<CommandPalette open onClose={vi.fn()} commands={cmds} />);
    expect(screen.getByText('Ctrl+S')).toBeTruthy();
  });

  it('命令带 category 显示分类徽章', () => {
    const cmds = [makeCmd({ id: 'a', label: 'A', category: 'git' })];
    render(<CommandPalette open onClose={vi.fn()} commands={cmds} />);
    // "Git" 同时出现在标签栏和命令 A 的分类徽章中
    expect(screen.getAllByText('Git').length).toBeGreaterThan(0);
  });

  it('MC_COMMAND_TEMPLATES 包含常用命令前缀', () => {
    // 这是导出的常量，至少应包含 /give /summon /tp
    const prefixes = MC_COMMAND_TEMPLATES.map((t) => t.prefix);
    expect(prefixes).toContain('/give');
    expect(prefixes).toContain('/summon');
    expect(prefixes).toContain('/tp');
    expect(prefixes).toContain('@p');
    // 每条都有 label/description/syntax/example
    for (const t of MC_COMMAND_TEMPLATES) {
      expect(t.label).toBeTruthy();
      expect(t.description).toBeTruthy();
      expect(t.syntax).toBeTruthy();
      expect(t.example).toBeTruthy();
    }
  });
});
