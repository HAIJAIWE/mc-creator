// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { NodePalette } from './NodePalette.js';
import { clearPluginNodes, registerNode } from './node-registry.js';
import { customNodeRegistry } from '../../domain/customNodeRegistry.js';

vi.mock('../../store/node-graph-store.js', () => ({
  useNodeGraphStore: (sel: (s: unknown) => unknown) => {
    const store = {
      addNode: vi.fn(),
      commit: vi.fn(),
      loadGraph: vi.fn(),
      addCustomNode: vi.fn(),
    };
    return sel(store);
  },
}));

describe('NodePalette 插件节点分区', () => {
  beforeEach(() => {
    clearPluginNodes();
    customNodeRegistry.clear();
  });

  it('无插件时显示空提示', () => {
    render(<NodePalette />);
    expect(screen.getByText(/未加载插件节点/)).toBeTruthy();
  });

  it('注册插件节点后按分组显示 + 自定义 badge + 共用搜索框', () => {
    registerNode({
      id: 'myplugin:hello_block',
      title: 'Hello 方块',
      category: 'content',
      description: '示例插件节点',
      inputs: [],
      outputs: [],
      toSpec: () => [],
    });
    render(<NodePalette />);
    expect(screen.getByText('Hello 方块')).toBeTruthy();
    expect(screen.getByText('自定义')).toBeTruthy();

    // 共用顶部搜索框可过滤插件节点
    const search = screen.getByPlaceholderText('搜索节点...');
    fireEvent.change(search, { target: { value: 'zzzz不存在' } });
    expect(screen.getByText('无匹配插件节点')).toBeTruthy();
  });
});
