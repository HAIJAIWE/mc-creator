// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { RagSources, RagSourcesList } from './RagSources.js';

vi.mock('../lib/ipc-client.js', () => ({
  ipcClient: { ragSearch: vi.fn() },
}));

import { ipcClient } from '../lib/ipc-client.js';

const HITS = [
  {
    title: '有形合成配方 crafting_shaped',
    snippet: 'pattern 片段内容',
    source: 'Minecraft Wiki · Recipe',
    url: 'https://minecraft.wiki/w/Recipe',
    score: 12.5,
  },
  { title: '内置模板 new_ore', snippet: '模板片段', source: '内置模板：new_ore', score: 9.1 },
];

beforeEach(() => {
  vi.clearAllMocks();
});

describe('RagSourcesList（纯展示）', () => {
  it('空 hits 渲染空', () => {
    const { container } = render(<RagSourcesList hits={[]} />);
    expect(container.innerHTML).toBe('');
  });

  it('渲染标题/来源/外链跳转', () => {
    render(<RagSourcesList hits={HITS} />);
    expect(screen.getByText('有形合成配方 crafting_shaped')).toBeTruthy();
    expect(screen.getByText('Minecraft Wiki · Recipe')).toBeTruthy();
    const link = screen.getByText('跳转').closest('a');
    expect(link?.getAttribute('href')).toBe('https://minecraft.wiki/w/Recipe');
    expect(link?.getAttribute('target')).toBe('_blank');
  });

  it('无 url 条目不渲染跳转链接', () => {
    render(<RagSourcesList hits={[HITS[1]!]} />);
    expect(screen.queryByText('跳转')).toBeNull();
  });
});

describe('RagSources（折叠容器）', () => {
  it('默认折叠且不触发检索；展开后查询并展示', async () => {
    vi.mocked(ipcClient.ragSearch).mockResolvedValue({ hits: HITS, cached: false });
    render(<RagSources query="红宝石矿石" generatorType="datapack" />);
    // 折叠态：按钮可见，未请求
    expect(screen.getByText(/引用来源/)).toBeTruthy();
    expect(ipcClient.ragSearch).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText(/引用来源/));
    await act(async () => {});
    expect(ipcClient.ragSearch).toHaveBeenCalledWith({
      query: '红宝石矿石',
      generatorType: 'datapack',
      topK: 5,
    });
    expect(screen.getByText('有形合成配方 crafting_shaped')).toBeTruthy();
  });

  it('检索失败时显示“暂无引用来源”而不崩溃', async () => {
    vi.mocked(ipcClient.ragSearch).mockRejectedValue(new Error('ipc down'));
    render(<RagSources query="附魔" />);
    fireEvent.click(screen.getByText(/引用来源/));
    await act(async () => {});
    expect(screen.getByText('暂无引用来源')).toBeTruthy();
  });
});
