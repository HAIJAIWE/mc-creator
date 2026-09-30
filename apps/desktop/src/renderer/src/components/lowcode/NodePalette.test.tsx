// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { NodePalette } from './NodePalette.js';
import { customNodeRegistry } from './custom/customNodeRegistry.js';

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

describe('NodePalette 阶段 C', () => {
  beforeEach(() => {
    customNodeRegistry.clear();
  });

  it('高级分类含变量/子图/循环节点', () => {
    render(<NodePalette />);
    expect(screen.getByText('变量')).toBeTruthy();
    expect(screen.getByText('子图')).toBeTruthy();
    // 「循环」存在同名条目（loop 基础节点 + while_loop 条件循环），用 getAllByText 断言存在即可
    expect(screen.getAllByText('循环').length).toBeGreaterThanOrEqual(1);
  });

  it('渲染「导入自定义节点」按钮', () => {
    render(<NodePalette />);
    expect(screen.getByText('导入自定义节点')).toBeTruthy();
  });

  it('点击导入按钮打开 CustomNodeImporter 对话框', () => {
    render(<NodePalette />);
    fireEvent.click(screen.getByText('导入自定义节点'));
    // CustomNodeImporter 对话框标题（h2 元素）
    expect(screen.getByRole('heading', { name: '导入自定义节点' })).toBeTruthy();
  });

  it('注册自定义节点后显示在「自定义节点」分区', () => {
    customNodeRegistry.register({
      typeId: 'mymod:crafter',
      label: '合成台',
      description: '',
      icon: '',
      color: 'mc-code',
      ports: [],
      fields: [],
      codeTemplate: '',
    });
    render(<NodePalette />);
    expect(screen.getByText('合成台')).toBeTruthy();
  });
});
