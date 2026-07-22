// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { NodePalette } from './NodePalette.js';
import { useNodeGraphStore } from '../../store/node-graph-store.js';

describe('NodePalette 模板区域搜索与筛选（Plan B Task 7/8）', () => {
  beforeEach(() => {
    useNodeGraphStore.getState().clear();
  });

  it('渲染模板搜索框', () => {
    render(<NodePalette />);
    expect(screen.getByPlaceholderText('搜索模板...')).toBeTruthy();
  });

  it('渲染模板分类筛选下拉，含「全部分类」', () => {
    render(<NodePalette />);
    expect(screen.getByLabelText('筛选模板分类')).toBeTruthy();
    expect(screen.getByRole('option', { name: '全部分类' })).toBeTruthy();
  });

  it('搜索「铁」过滤出铁剑模板', () => {
    render(<NodePalette />);
    const input = screen.getByPlaceholderText('搜索模板...');
    fireEvent.change(input, { target: { value: '铁' } });
    expect(screen.getByText('铁剑')).toBeTruthy();
    expect(screen.queryByText('金苹果')).toBeNull();
  });

  it('选择「战斗」分类只显示 combat 模板', () => {
    render(<NodePalette />);
    const select = screen.getByLabelText('筛选模板分类');
    fireEvent.change(select, { target: { value: 'combat' } });
    // 铁剑在 combat 分类
    expect(screen.getByText('铁剑')).toBeTruthy();
    // 金苹果在 item 分类，应被隐藏
    expect(screen.queryByText('金苹果')).toBeNull();
  });

  it('搜索无结果显示「无匹配模板」', () => {
    render(<NodePalette />);
    const input = screen.getByPlaceholderText('搜索模板...');
    fireEvent.change(input, { target: { value: 'zzzz不存在' } });
    expect(screen.getByText('无匹配模板')).toBeTruthy();
  });

  it('点击模板触发 onTemplateClick', () => {
    const onTemplateClick = vi.fn();
    render(<NodePalette onTemplateClick={onTemplateClick} />);
    fireEvent.click(screen.getByText('铁剑'));
    expect(onTemplateClick).toHaveBeenCalledOnce();
  });
});
