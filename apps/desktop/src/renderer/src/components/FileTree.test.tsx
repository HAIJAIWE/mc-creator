// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { FileTree } from './FileTree.js';
import { useModStore } from '../store/mod-store.js';

// jsdom 无 ResizeObserver，FileTree 用它测量容器高度，提供 stub 避免崩
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal('ResizeObserver', ResizeObserverStub);

/**
 * FileTree a11y 键盘导航测试：
 * 1. role=tree + treeitem 语义
 * 2. Roving Tabindex（仅聚焦行 tabIndex=0）
 * 3. 方向键导航（ArrowDown/Up/Right/Left/Home/End + 折叠展开联动）
 */

/** 构造一个 2 层目录结构：a/1.txt、a/b/2.txt、c.txt */
const FILES = [
  { path: 'a/1.txt', content: 'x' },
  { path: 'a/b/2.txt', content: 'y' },
  { path: 'c.txt', content: 'z' },
];

function renderTree() {
  useModStore.setState({
    files: FILES,
    selectedFile: null,
    buildLog: '',
    loading: false,
  });
  return render(<FileTree />);
}

/** 取可见行按钮列表（Treeitem 角色） */
function treeItems() {
  return screen.getAllByRole('treeitem');
}

/** 对当前聚焦行触发键盘事件（容器 onKeyDown 需要事件冒泡到容器） */
function keyOnFocused(key: string) {
  const tree = screen.getByRole('tree');
  fireEvent.keyDown(tree, { key });
}

describe('FileTree', () => {
  beforeEach(() => {
    renderTree();
  });

  it('1. 容器 role=tree + aria-label，节点 role=treeitem（Roving Tabindex 语义）', () => {
    const tree = screen.getByRole('tree', { name: '项目文件' });
    expect(tree).toBeTruthy();
    const items = treeItems();
    // a、1.txt、b、2.txt、c.txt 全部可见（默认全部展开）
    expect(items).toHaveLength(5);
    // 文件夹带展开状态
    const folderA = items.find((i) => i.textContent?.includes('a')) as HTMLElement;
    expect(folderA.getAttribute('aria-expanded')).toBe('true');
  });

  it('2. Roving Tabindex：首行 tabIndex=0，其余 -1', () => {
    const items = treeItems();
    expect(items[0].tabIndex).toBe(0);
    for (let i = 1; i < items.length; i++) {
      expect(items[i].tabIndex).toBe(-1);
    }
  });

  it('3. ArrowDown 把焦点移入下一行（焦点行 tabIndex 同步跟随）', () => {
    keyOnFocused('ArrowDown');
    const items = treeItems();
    expect(items[1].tabIndex).toBe(0);
    expect(items[0].tabIndex).toBe(-1);
  });

  it('4. ArrowUp 回到上一行', () => {
    keyOnFocused('ArrowDown');
    keyOnFocused('ArrowUp');
    const items = treeItems();
    expect(items[0].tabIndex).toBe(0);
  });

  it('5. ArrowRight 进入第一个子节点（a → 1.txt）', () => {
    // 初始焦点在 a（索引 0），展开态下 ArrowRight 进入 1.txt（索引 1）
    keyOnFocused('ArrowRight');
    const items = treeItems();
    expect(items[1].tabIndex).toBe(0);
  });

  it('6. ArrowLeft 折叠时回到父节点（b 下方 2.txt → b）', () => {
    // 先下移到 b（索引 2）
    keyOnFocused('ArrowDown');
    keyOnFocused('ArrowDown');
    // 展开态下 ArrowLeft 折叠 b
    keyOnFocused('ArrowLeft');
    const tree = screen.getByRole('tree');
    fireEvent.keyDown(tree, { key: 'ArrowRight' });
    // 折叠后 b 无子节点，ArrowRight 不再进入；焦点仍在 b
    const items = screen.getAllByRole('treeitem');
    expect(items[2].tabIndex).toBe(0);
  });

  it('7. ArrowLeft 从文件跳回父节点（1.txt → a）', () => {
    // 下移到 1.txt（索引 1）
    keyOnFocused('ArrowDown');
    keyOnFocused('ArrowLeft');
    const items = treeItems();
    expect(items[0].tabIndex).toBe(0);
  });

  it('8. Home 跳到第一行、End 跳到最后一行', () => {
    keyOnFocused('End');
    const items = treeItems();
    expect(items[items.length - 1].tabIndex).toBe(0);
    keyOnFocused('Home');
    expect(treeItems()[0].tabIndex).toBe(0);
  });

  it('9. 焦点行不超出边界（首行 ArrowUp 停在 0）', () => {
    keyOnFocused('ArrowUp');
    expect(treeItems()[0].tabIndex).toBe(0);
  });

  it('10. 点击行后选择文件（aria-selected=true）', () => {
    const items = treeItems();
    fireEvent.click(within(items[3] as HTMLElement).getByText('2.txt'));
    const after = screen.getAllByRole('treeitem');
    // 2.txt（索引 3）变为选中
    expect(after[3].getAttribute('aria-selected')).toBe('true');
  });
});
