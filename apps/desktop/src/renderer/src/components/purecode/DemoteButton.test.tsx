// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { DemoteButton } from './DemoteButton.js';
import type { FileNode } from '@mc-creator/shared';
import type { DemoteResult } from '../../lib/demoteFromPurecode.js';

// === 测试夹具 ===

const MOD_ITEMS_JAVA = `package com.example.demo;
import net.minecraft.item.Item;
public class ModItems {
    public static final Item RUBY_SWORD = register(
        "ruby_sword",
        new Item(new Item.Settings())
    );
    private static Item register(String name, Item item) {
        return register(name, item);
    }
}
`;

const SAMPLE_FILES: FileNode[] = [{ path: 'src/main/java/ModItems.java', content: MOD_ITEMS_JAVA }];

// === 测试用例 ===

describe('DemoteButton', () => {
  beforeEach(() => {
    // mock window.confirm，默认返回 true
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    // mock console.warn 避免污染测试输出
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('1. 渲染按钮（默认文案 + aria-label）', () => {
    render(<DemoteButton files={SAMPLE_FILES} onDemote={vi.fn()} />);
    const button = screen.getByRole('button');
    expect(button).toBeTruthy();
    expect(button.textContent).toContain('降级到 L2');
    expect(button.getAttribute('aria-label')).toBe('从 Java 代码反向生成节点图');
  });

  it('2. 自定义 label 文案正确显示', () => {
    render(<DemoteButton files={SAMPLE_FILES} onDemote={vi.fn()} label="⬇ 降级" />);
    const button = screen.getByRole('button');
    expect(button.textContent).toContain('⬇ 降级');
  });

  it('3. 点击触发 demote，确认后调用 onDemote', () => {
    const onDemote = vi.fn();
    render(<DemoteButton files={SAMPLE_FILES} modId="demo_mod" onDemote={onDemote} />);
    const button = screen.getByRole('button');
    fireEvent.click(button);

    // 应弹出 confirm 对话框
    expect(window.confirm).toHaveBeenCalledTimes(1);
    // 确认后应调用 onDemote
    expect(onDemote).toHaveBeenCalledTimes(1);

    // 传入的应是 DemoteResult，包含 graph/stats/warnings
    const arg = onDemote.mock.calls[0][0] as DemoteResult;
    expect(arg.graph).toBeDefined();
    expect(arg.stats).toBeDefined();
    expect(arg.warnings).toBeDefined();
    expect(arg.warnings).toEqual([]);
    expect(arg.graph.modId).toBe('demo_mod');
    // 应提取到 1 个物品
    expect(arg.stats.items).toBe(1);
  });

  it('4. 用户取消 confirm 时不调用 onDemote', () => {
    // mock confirm 返回 false（用户取消）
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    const onDemote = vi.fn();
    render(<DemoteButton files={SAMPLE_FILES} modId="demo_mod" onDemote={onDemote} />);
    const button = screen.getByRole('button');
    fireEvent.click(button);

    expect(window.confirm).toHaveBeenCalledTimes(1);
    expect(onDemote).not.toHaveBeenCalled();
  });

  it('5. files 为空时按钮禁用，点击不触发 demote', () => {
    const onDemote = vi.fn();
    render(<DemoteButton files={[]} modId="demo_mod" onDemote={onDemote} />);
    const button = screen.getByRole('button') as HTMLButtonElement;
    expect(button.disabled).toBe(true);

    // 即使点击也不应触发
    fireEvent.click(button);
    expect(window.confirm).not.toHaveBeenCalled();
    expect(onDemote).not.toHaveBeenCalled();
  });

  it('6. 显式 disabled=true 时按钮禁用', () => {
    const onDemote = vi.fn();
    render(<DemoteButton files={SAMPLE_FILES} modId="demo_mod" onDemote={onDemote} disabled />);
    const button = screen.getByRole('button') as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });

  it('7. confirm 对话框中包含提取统计信息', () => {
    const onDemote = vi.fn();
    render(<DemoteButton files={SAMPLE_FILES} modId="demo_mod" onDemote={onDemote} />);
    fireEvent.click(screen.getByRole('button'));
    // 检查 confirm 调用时传入的消息包含 "1 个物品"
    const confirmMsg = (window.confirm as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(confirmMsg).toMatch(/1 个物品/);
    expect(confirmMsg).toMatch(/确认降级/);
  });
});
