/**
 * Tabs 的「文件标签栏插槽」测试：图标 / 关闭按钮 / 脏标记 / 中键 / 右键 /
 * 关闭按钮文案注入 / 受控 value 悬空兜底 / 「默认全关」的回归防线。
 *
 * 与 Tabs.test.tsx 分文件的原因：这批用例全部围绕**新增能力**，
 * 单独成文件能一眼看出「哪些行为是扩展带来的」，也让 Tabs.test.tsx 的 58 条
 * 既有断言保持原样（一字未改），作为向后兼容的证据。
 *
 * 对应实现：Tabs.tsx 文件头第 5/6 条 a11y 说明 + 「文件标签栏能力」小节。
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { Tabs, type TabItem } from './Tabs';

/** 文件标签栏典型数据（desktop TabBar 的形状）。 */
const FILE_ITEMS: TabItem[] = [
  { value: 'a/index.ts', label: 'index.ts', closeable: true, onClose: () => {} },
  { value: 'b/App.tsx', label: 'App.tsx', closeable: true, onClose: () => {} },
  { value: 'c/util.ts', label: 'util.ts', closeable: true, onClose: () => {} },
];

/**
 * @testing-library/dom 的 fireEvent 没有 auxClick 快捷方法
 * （事件表里只有 click/contextMenu），自己造一个可取消的冒泡 MouseEvent。
 */
function fireAuxClick(element: Element, button: number): MouseEvent {
  const event = new MouseEvent('auxclick', { bubbles: true, cancelable: true, button });
  fireEvent(element, event);
  return event;
}

describe('Tabs · 图标槽', () => {
  it('渲染 icon', () => {
    const items: TabItem[] = [
      { value: 'a', label: 'index.ts', icon: <span data-testid="file-icon">TS</span> },
    ];
    render(<Tabs items={items} />);
    expect(screen.getByTestId('file-icon')).toBeInTheDocument();
  });

  it('图标容器带 aria-hidden（装饰性图标不进无障碍树）', () => {
    const items: TabItem[] = [{ value: 'a', label: 'index.ts', icon: <span>ICON</span> }];
    const { container } = render(<Tabs items={items} />);
    const tab = screen.getByRole('tab');
    const iconWrapper = tab.querySelector('[aria-hidden="true"]');
    expect(iconWrapper).not.toBeNull();
    expect(iconWrapper?.textContent).toBe('ICON');
    // tab 内只有一个 aria-hidden（图标的 × 装饰层不算在内，close 按钮没渲染）
    expect(tab.querySelectorAll('[aria-hidden="true"]')).toHaveLength(1);
    // 另一个 aria-hidden 是选中态的 .mc-active-bar（tab 外）
    expect(container.querySelectorAll('[aria-hidden="true"]')).toHaveLength(2);
  });

  it('图标排在标签文字之前', () => {
    const items: TabItem[] = [
      { value: 'a', label: 'index.ts', icon: <span data-testid="file-icon">TS</span> },
    ];
    render(<Tabs items={items} />);
    const tab = screen.getByRole('tab');
    expect(tab.firstElementChild).toContainElement(screen.getByTestId('file-icon'));
  });

  it('图标不污染 tab 的可访问名（仍按纯文件名查找）', () => {
    const items: TabItem[] = [
      { value: 'a', label: 'index.ts', icon: <span>TS-ICON-TEXT</span>, dirty: true },
    ];
    render(<Tabs items={items} />);
    expect(screen.getByRole('tab', { name: 'index.ts' })).toBeInTheDocument();
  });

  it('无 icon 时不渲染图标容器', () => {
    render(<Tabs items={[{ value: 'a', label: 'index.ts' }]} />);
    const tab = screen.getByRole('tab');
    // 标签之外只有 mc-active-bar（选中态指示条，它自己是 aria-hidden）
    expect(tab.querySelector('[aria-hidden="true"]')).toBeNull();
  });

  it('icon 为 null 时按「没有图标」处理（不渲染空壳）', () => {
    const items: TabItem[] = [{ value: 'a', label: 'index.ts', icon: null }];
    render(<Tabs items={items} />);
    expect(screen.getByRole('tab').children).toHaveLength(1);
  });
});

describe('Tabs · 关闭按钮', () => {
  it('closeable 渲染关闭按钮', () => {
    render(<Tabs items={FILE_ITEMS} />);
    expect(screen.getAllByRole('button', { name: /关闭/ })).toHaveLength(3);
  });

  it('不传 closeable 时不渲染关闭按钮', () => {
    render(
      <Tabs
        items={[
          { value: 'a', label: '甲' },
          { value: 'b', label: '乙' },
        ]}
      />,
    );
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  it('closeable: false 时同样不渲染关闭按钮', () => {
    const items: TabItem[] = [{ value: 'a', label: '甲', closeable: false }];
    render(<Tabs items={items} />);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('点击关闭按钮触发该项的 onClose 并带上自己的 value', () => {
    const onCloseA = vi.fn();
    const onCloseC = vi.fn();
    const items: TabItem[] = [
      { value: 'a', label: 'index.ts', closeable: true, onClose: onCloseA },
      { value: 'b', label: 'App.tsx', closeable: true, onClose: vi.fn() },
      { value: 'c', label: 'util.ts', closeable: true, onClose: onCloseC },
    ];
    render(<Tabs items={items} defaultValue="b" />);
    fireEvent.click(screen.getByRole('button', { name: '关闭 index.ts' }));
    expect(onCloseA).toHaveBeenCalledTimes(1);
    expect(onCloseA).toHaveBeenCalledWith('a');
    expect(onCloseC).not.toHaveBeenCalled();
  });

  it('【核心】点击关闭按钮不连带触发 onValueChange（stopPropagation 防线）', () => {
    const onValueChange = vi.fn();
    const items: TabItem[] = [
      { value: 'a', label: 'index.ts', closeable: true, onClose: vi.fn() },
      { value: 'b', label: 'App.tsx', closeable: true, onClose: vi.fn() },
    ];
    render(<Tabs items={items} defaultValue="b" onValueChange={onValueChange} />);
    fireEvent.click(screen.getByRole('button', { name: '关闭 index.ts' }));
    expect(onValueChange).not.toHaveBeenCalled();
  });

  it('【核心】点击关闭按钮不改变选中态（受控与非受控都是）', () => {
    const items: TabItem[] = [
      { value: 'a', label: 'index.ts', closeable: true, onClose: vi.fn() },
      { value: 'b', label: 'App.tsx', closeable: true, onClose: vi.fn() },
    ];
    const { rerender } = render(<Tabs items={items} defaultValue="b" />);
    fireEvent.click(screen.getByRole('button', { name: '关闭 index.ts' }));
    expect(screen.getByRole('tab', { name: 'App.tsx' })).toHaveAttribute('aria-selected', 'true');

    rerender(<Tabs items={items} value="a" />);
    fireEvent.click(screen.getByRole('button', { name: '关闭 index.ts' }));
    expect(screen.getByRole('tab', { name: 'index.ts' })).toHaveAttribute('aria-selected', 'true');
  });

  it('关闭按钮默认可访问名为「关闭 {文件名}」', () => {
    render(<Tabs items={FILE_ITEMS} />);
    expect(screen.getByRole('button', { name: '关闭 index.ts' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '关闭 util.ts' })).toBeInTheDocument();
  });

  it('关闭按钮图标自身 aria-hidden（不重复朗读）', () => {
    render(<Tabs items={FILE_ITEMS} />);
    const closeBtn = screen.getByRole('button', { name: '关闭 index.ts' });
    expect(closeBtn.querySelector('span')?.getAttribute('aria-hidden')).toBe('true');
    // × 这个字形不出现在任何可访问名里（tab 名是纯文件名）
    expect(screen.getByRole('tab', { name: 'index.ts' })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: /×/ })).toBeNull();
  });

  it('closeLabel 覆盖可访问名（英文环境不读中文）', () => {
    render(<Tabs items={FILE_ITEMS} closeLabel={(_v, label) => `Close ${label}`} />);
    expect(screen.getByRole('button', { name: 'Close index.ts' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '关闭 index.ts' })).toBeNull();
  });

  it('closeLabel 收到 (value, 纯文本标签) 两个参数', () => {
    const closeLabel = vi.fn((_v: string, l: string) => `Close ${l}`);
    render(<Tabs items={FILE_ITEMS} closeLabel={closeLabel} />);
    fireEvent.click(screen.getByRole('button', { name: 'Close index.ts' }));
    expect(closeLabel).toHaveBeenCalledWith('a/index.ts', 'index.ts');
  });

  it('ariaLabel 作为关闭按钮文案里的文件名来源（label 是 ReactNode 时）', () => {
    const items: TabItem[] = [
      {
        value: 'a/index.ts',
        label: <span data-testid="fancy">带图标的名字</span>,
        ariaLabel: 'index.ts',
        closeable: true,
        onClose: vi.fn(),
      },
    ];
    render(<Tabs items={items} />);
    expect(screen.getByRole('button', { name: '关闭 index.ts' })).toBeInTheDocument();
  });

  it('label 是 ReactNode 又没给 ariaLabel 时退回 value（不编造名字）', () => {
    const items: TabItem[] = [
      { value: 'a/index.ts', label: <span>带图标的名字</span>, closeable: true, onClose: vi.fn() },
    ];
    render(<Tabs items={items} />);
    expect(screen.getByRole('button', { name: '关闭 a/index.ts' })).toBeInTheDocument();
  });

  it('tab 自身显式带 aria-label，避免子元素文案被拼进 tab 名', () => {
    render(<Tabs items={FILE_ITEMS} />);
    expect(screen.getByRole('tab', { name: 'index.ts' })).toHaveAttribute('aria-label', 'index.ts');
  });

  it('tab 名不再读成「文件名 + 关闭按钮 + 脏标记」的拼接串', () => {
    const items: TabItem[] = [
      { value: 'a', label: 'index.ts', closeable: true, onClose: vi.fn(), dirty: true },
    ];
    render(<Tabs items={items} />);
    expect(screen.getByRole('tab', { name: 'index.ts' })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: /关闭/ })).toBeNull();
  });

  it('closeable 时用 div[role=tab] 承载（避免 button 套 button 的非法 HTML）', () => {
    const { container } = render(<Tabs items={FILE_ITEMS} />);
    expect(container.querySelectorAll('button[role="tab"]')).toHaveLength(0);
    expect(container.querySelectorAll('div[role="tab"]')).toHaveLength(3);
    // 关键：tab 里没有嵌套 button
    expect(
      container.querySelector('div[role="tab"] button')?.parentElement?.getAttribute('role'),
    ).toBe('tab');
  });

  it('非 closeable 时仍是原生 button[role=tab]', () => {
    const { container } = render(<Tabs items={[{ value: 'a', label: '甲' }]} />);
    expect(container.querySelectorAll('button[role="tab"]')).toHaveLength(1);
    expect(container.querySelectorAll('div[role="tab"]')).toHaveLength(0);
  });

  it('div[role=tab] 用 Enter 键选中（等价原生 button 的键盘激活）', () => {
    const onValueChange = vi.fn();
    render(<Tabs items={FILE_ITEMS} onValueChange={onValueChange} />);
    fireEvent.keyDown(screen.getByRole('tab', { name: 'App.tsx' }), { key: 'Enter' });
    expect(onValueChange).toHaveBeenCalledWith('b/App.tsx');
  });

  it('div[role=tab] 用 Space 键选中', () => {
    const onValueChange = vi.fn();
    render(<Tabs items={FILE_ITEMS} onValueChange={onValueChange} />);
    fireEvent.keyDown(screen.getByRole('tab', { name: 'util.ts' }), { key: ' ' });
    expect(onValueChange).toHaveBeenCalledWith('c/util.ts');
  });

  it('关闭按钮上按 Enter 不会连带选中该 tab（键盘路径同样要拦）', () => {
    const onValueChange = vi.fn();
    render(<Tabs items={FILE_ITEMS} defaultValue="a/index.ts" onValueChange={onValueChange} />);
    fireEvent.keyDown(screen.getByRole('button', { name: '关闭 util.ts' }), { key: 'Enter' });
    expect(onValueChange).not.toHaveBeenCalled();
  });

  it('tab 禁用时关闭按钮一起禁用', () => {
    const items: TabItem[] = [
      { value: 'a', label: '甲', closeable: true, onClose: vi.fn(), disabled: true },
    ];
    render(<Tabs items={items} />);
    expect(screen.getByRole('button', { name: '关闭 甲' })).toBeDisabled();
  });

  it('禁用 tab 上的关闭按钮点了不回调', () => {
    const onClose = vi.fn();
    const items: TabItem[] = [
      { value: 'a', label: '甲', closeable: true, onClose, disabled: true },
    ];
    render(<Tabs items={items} />);
    fireEvent.click(screen.getByRole('button', { name: '关闭 甲' }));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('禁用 tab 自身不可选中（div 分支靠 onClick 里的 disabled 判断）', () => {
    const onValueChange = vi.fn();
    const items: TabItem[] = [
      { value: 'a', label: '甲', closeable: true, onClose: vi.fn(), disabled: true },
      { value: 'b', label: '乙', closeable: true, onClose: vi.fn() },
    ];
    render(<Tabs items={items} defaultValue="b" onValueChange={onValueChange} />);
    fireEvent.click(screen.getByRole('tab', { name: '甲' }));
    expect(onValueChange).not.toHaveBeenCalled();
  });

  it('没给 onClose 时点关闭按钮不炸（组件不自己改 items）', () => {
    const items: TabItem[] = [{ value: 'a', label: '甲', closeable: true }];
    render(<Tabs items={items} />);
    expect(() => fireEvent.click(screen.getByRole('button', { name: '关闭 甲' }))).not.toThrow();
    expect(screen.getByRole('tab', { name: '甲' })).toBeInTheDocument();
  });

  it('关闭按钮与 badge / 图标互不干扰', () => {
    const items: TabItem[] = [
      {
        value: 'a',
        label: 'index.ts',
        badge: '3',
        icon: <span data-testid="file-icon">TS</span>,
        dirty: true,
        closeable: true,
        onClose: vi.fn(),
      },
    ];
    render(<Tabs items={items} />);
    expect(screen.getByTestId('file-icon')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '关闭 index.ts' })).toBeInTheDocument();
  });
});

describe('Tabs · 关闭按钮的键盘可达性（roving tabindex 里的取舍）', () => {
  it('只有「选中项」的关闭按钮 tabIndex=0，其余 -1', () => {
    render(<Tabs items={FILE_ITEMS} defaultValue="b/App.tsx" />);
    expect(screen.getByRole('button', { name: '关闭 index.ts' })).toHaveAttribute('tabindex', '-1');
    expect(screen.getByRole('button', { name: '关闭 App.tsx' })).toHaveAttribute('tabindex', '0');
    expect(screen.getByRole('button', { name: '关闭 util.ts' })).toHaveAttribute('tabindex', '-1');
  });

  it('Tab 序列在 tablist 里恒定只占 2 格（选中 tab + 它的关闭按钮）', () => {
    const items: TabItem[] = Array.from({ length: 10 }, (_, i) => ({
      value: `f${i}.ts`,
      label: `f${i}.ts`,
      closeable: true,
      onClose: vi.fn(),
    }));
    const { container } = render(<Tabs items={items} />);
    const tablist = screen.getByRole('tablist');
    expect(tablist.querySelectorAll('[tabindex="0"]')).toHaveLength(2);
    // 若是「每个关闭按钮都可聚焦」，这里会是 11
    expect(container.querySelectorAll('[role="tab"]')).toHaveLength(10);
  });

  it('方向键切到别的 tab 后，可聚焦的关闭按钮跟着换人', () => {
    render(<Tabs items={FILE_ITEMS} defaultValue="a/index.ts" />);
    fireEvent.keyDown(screen.getByRole('tablist'), { key: 'ArrowRight' });
    expect(screen.getByRole('button', { name: '关闭 App.tsx' })).toHaveAttribute('tabindex', '0');
    expect(screen.getByRole('button', { name: '关闭 index.ts' })).toHaveAttribute('tabindex', '-1');
    expect(screen.getByRole('tab', { name: 'App.tsx' })).toHaveAttribute('tabindex', '0');
  });

  it('未选中项的关闭按钮在 Tab 序列外（不会一排按钮都要按 Tab）', () => {
    render(<Tabs items={FILE_ITEMS} defaultValue="a/index.ts" />);
    const idleClose = screen.getByRole('button', { name: '关闭 App.tsx' });
    expect(idleClose).toHaveAttribute('tabindex', '-1');
    expect(screen.getByRole('tablist').contains(idleClose)).toBe(true);
  });

  it('关闭按钮仍可被程序聚焦（.focus() 有效，只是 Tab 键不到）', () => {
    render(<Tabs items={FILE_ITEMS} defaultValue="a/index.ts" />);
    const closeBtn = screen.getByRole('button', { name: '关闭 index.ts' });
    closeBtn.focus();
    expect(document.activeElement).toBe(closeBtn);
  });
});

describe('Tabs · 脏标记', () => {
  it('dirty 渲染金色圆点（语义色 --mc-gold）', () => {
    const items: TabItem[] = [{ value: 'a', label: 'index.ts', dirty: true }];
    render(<Tabs items={items} />);
    const dirty = screen.getByRole('img', { name: '未保存的更改' });
    expect(dirty).toHaveTextContent('●');
    expect(dirty).toHaveClass('text-mc-gold');
  });

  it('脏标记带可访问语义 role=img + aria-label（纯视觉圆点对读屏等于不存在）', () => {
    const items: TabItem[] = [{ value: 'a', label: 'index.ts', dirty: true }];
    render(<Tabs items={items} />);
    const dirty = screen.getByRole('img', { name: '未保存的更改' });
    expect(dirty.getAttribute('role')).toBe('img');
    expect(dirty.getAttribute('aria-label')).toBe('未保存的更改');
  });

  it('dirtyLabel 可覆盖（i18n）', () => {
    const items: TabItem[] = [{ value: 'a', label: 'index.ts', dirty: true }];
    render(<Tabs items={items} dirtyLabel="Unsaved changes" />);
    expect(screen.getByRole('img', { name: 'Unsaved changes' })).toBeInTheDocument();
  });

  it('不传 dirty 时不渲染脏标记', () => {
    render(<Tabs items={[{ value: 'a', label: 'index.ts' }]} />);
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('dirty: false 时同样不渲染脏标记', () => {
    const items: TabItem[] = [{ value: 'a', label: 'index.ts', dirty: false }];
    render(<Tabs items={items} />);
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('只有脏的那一项有标记', () => {
    const items: TabItem[] = [
      { value: 'a', label: 'index.ts', dirty: true },
      { value: 'b', label: 'App.tsx' },
    ];
    render(<Tabs items={items} />);
    expect(screen.getAllByRole('img', { name: '未保存的更改' })).toHaveLength(1);
  });

  it('脏标记不被拼进 tab 的可访问名', () => {
    const items: TabItem[] = [{ value: 'a', label: 'index.ts', dirty: true }];
    render(<Tabs items={items} />);
    expect(screen.getByRole('tab', { name: 'index.ts' })).toHaveAttribute('aria-label', 'index.ts');
    expect(screen.queryByRole('tab', { name: /未保存/ })).toBeNull();
  });
});

describe('Tabs · 辅助键点击（中键关闭）', () => {
  it('中键触发 onTabAuxClick 并带上 button 与 value', () => {
    const onTabAuxClick = vi.fn();
    render(<Tabs items={FILE_ITEMS} onTabAuxClick={onTabAuxClick} />);
    fireAuxClick(screen.getByRole('tab', { name: 'App.tsx' }), 1);
    expect(onTabAuxClick).toHaveBeenCalledTimes(1);
    expect(onTabAuxClick).toHaveBeenCalledWith('b/App.tsx', 1);
  });

  it('非选中 tab 上的中键同样触发（不必先选中）', () => {
    const onTabAuxClick = vi.fn();
    render(<Tabs items={FILE_ITEMS} defaultValue="a/index.ts" onTabAuxClick={onTabAuxClick} />);
    fireAuxClick(screen.getByRole('tab', { name: 'util.ts' }), 1);
    expect(onTabAuxClick).toHaveBeenCalledWith('c/util.ts', 1);
  });

  it('中键被 preventDefault（X11 主选择区粘贴 / 滚动光标都是噪音）', () => {
    render(<Tabs items={FILE_ITEMS} onTabAuxClick={vi.fn()} />);
    expect(fireAuxClick(screen.getByRole('tab', { name: 'index.ts' }), 1).defaultPrevented).toBe(
      true,
    );
  });

  it('左键点击不触发 onTabAuxClick（否则一次点击被回调两次）', () => {
    const onTabAuxClick = vi.fn();
    const onValueChange = vi.fn();
    render(<Tabs items={FILE_ITEMS} onTabAuxClick={onTabAuxClick} onValueChange={onValueChange} />);
    fireAuxClick(screen.getByRole('tab', { name: 'App.tsx' }), 0);
    expect(onTabAuxClick).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('tab', { name: 'App.tsx' }));
    expect(onValueChange).toHaveBeenCalledWith('b/App.tsx');
    expect(onTabAuxClick).not.toHaveBeenCalled();
  });

  it('右键（button=2）也走辅助键回调，原样把 button 透传', () => {
    const onTabAuxClick = vi.fn();
    render(<Tabs items={FILE_ITEMS} onTabAuxClick={onTabAuxClick} />);
    fireAuxClick(screen.getByRole('tab', { name: 'index.ts' }), 2);
    expect(onTabAuxClick).toHaveBeenCalledWith('a/index.ts', 2);
  });

  it('非中键的辅助键不 preventDefault（不越权改事件语义）', () => {
    render(<Tabs items={FILE_ITEMS} onTabAuxClick={vi.fn()} />);
    expect(fireAuxClick(screen.getByRole('tab', { name: 'index.ts' }), 2).defaultPrevented).toBe(
      false,
    );
  });

  it('不传 onTabAuxClick 时中键点击是纯 no-op（不 preventDefault、不抛）', () => {
    render(<Tabs items={FILE_ITEMS} />);
    expect(() => fireAuxClick(screen.getByRole('tab', { name: 'index.ts' }), 1)).not.toThrow();
    expect(fireAuxClick(screen.getByRole('tab', { name: 'index.ts' }), 1).defaultPrevented).toBe(
      false,
    );
  });

  it('中键不改变选中态（关闭 ≠ 切换）', () => {
    const items: TabItem[] = [
      { value: 'a', label: '甲' },
      { value: 'b', label: '乙' },
    ];
    render(<Tabs items={items} defaultValue="a" onTabAuxClick={vi.fn()} />);
    fireAuxClick(screen.getByRole('tab', { name: '乙' }), 1);
    expect(screen.getByRole('tab', { name: '甲' })).toHaveAttribute('aria-selected', 'true');
  });
});

describe('Tabs · 右键菜单', () => {
  it('右键触发 onTabContextMenu 并带上 value', () => {
    const onTabContextMenu = vi.fn();
    render(<Tabs items={FILE_ITEMS} onTabContextMenu={onTabContextMenu} />);
    fireEvent.contextMenu(screen.getByRole('tab', { name: 'util.ts' }));
    expect(onTabContextMenu).toHaveBeenCalledTimes(1);
    expect(onTabContextMenu.mock.calls[0]?.[0]).toBe('c/util.ts');
  });

  it('回调拿到的是原生 MouseEvent（能读 clientX/clientY 定位菜单）', () => {
    const onTabContextMenu = vi.fn();
    render(<Tabs items={FILE_ITEMS} onTabContextMenu={onTabContextMenu} />);
    fireEvent.contextMenu(screen.getByRole('tab', { name: 'index.ts' }), {
      clientX: 120,
      clientY: 48,
    });
    const event = onTabContextMenu.mock.calls[0]?.[1] as MouseEvent;
    expect(event).toBeInstanceOf(MouseEvent);
    expect(event.clientX).toBe(120);
    expect(event.clientY).toBe(48);
  });

  it('默认不 preventDefault（弹不弹菜单由调用方决定）', () => {
    const menuEvent = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    render(<Tabs items={FILE_ITEMS} onTabContextMenu={vi.fn()} />);
    fireEvent(screen.getByRole('tab', { name: 'index.ts' }), menuEvent);
    expect(menuEvent.defaultPrevented).toBe(false);
  });

  it('调用方自己 preventDefault 能拦住默认菜单（组件不越权）', () => {
    const onTabContextMenu = vi.fn((_value: string, event: MouseEvent) => event.preventDefault());
    const menuEvent = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    render(<Tabs items={FILE_ITEMS} onTabContextMenu={onTabContextMenu} />);
    fireEvent(screen.getByRole('tab', { name: 'index.ts' }), menuEvent);
    expect(onTabContextMenu).toHaveBeenCalled();
    expect(menuEvent.defaultPrevented).toBe(true);
  });

  it('右键不改变选中态、不触发 onValueChange', () => {
    const onValueChange = vi.fn();
    render(<Tabs items={FILE_ITEMS} onTabAuxClick={vi.fn()} onValueChange={onValueChange} />);
    fireEvent.contextMenu(screen.getByRole('tab', { name: 'App.tsx' }));
    expect(onValueChange).not.toHaveBeenCalled();
    expect(screen.getByRole('tab', { name: 'index.ts' })).toHaveAttribute('aria-selected', 'true');
  });

  it('右键菜单与辅助键回调互不串台', () => {
    const onTabAuxClick = vi.fn();
    const onTabContextMenu = vi.fn();
    render(
      <Tabs items={FILE_ITEMS} onTabAuxClick={onTabAuxClick} onTabContextMenu={onTabContextMenu} />,
    );
    fireEvent.contextMenu(screen.getByRole('tab', { name: 'index.ts' }));
    expect(onTabAuxClick).not.toHaveBeenCalled();
    expect(onTabContextMenu).toHaveBeenCalledTimes(1);
  });

  it('不传 onTabContextMenu 时右键是原生行为（不 preventDefault）', () => {
    render(<Tabs items={FILE_ITEMS} />);
    const menuEvent = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    fireEvent(screen.getByRole('tab', { name: 'index.ts' }), menuEvent);
    expect(menuEvent.defaultPrevented).toBe(false);
  });

  it('非 closeable 的 button[role=tab] 上右键同样触发', () => {
    const onTabContextMenu = vi.fn();
    render(<Tabs items={[{ value: 'a', label: '甲' }]} onTabContextMenu={onTabContextMenu} />);
    fireEvent.contextMenu(screen.getByRole('tab', { name: '甲' }));
    expect(onTabContextMenu.mock.calls[0]?.[0]).toBe('a');
  });
});

describe('Tabs · 受控 value 悬空的选中兜底', () => {
  it('value 不在 items 里时高亮第一个未禁用项', () => {
    const items: TabItem[] = [
      { value: 'a', label: 'index.ts' },
      { value: 'b', label: 'App.tsx' },
    ];
    render(<Tabs items={items} value="已删除的文件.ts" />);
    expect(screen.getByRole('tab', { name: 'index.ts' })).toHaveAttribute('aria-selected', 'true');
  });

  it('兜底项也带 mc-tab-selected 与 active-bar（视觉上不留空白标签栏）', () => {
    const items: TabItem[] = [
      { value: 'a', label: 'index.ts' },
      { value: 'b', label: 'App.tsx' },
    ];
    const { container } = render(<Tabs items={items} value="已删除的文件.ts" />);
    const fallbackTab = screen.getByRole('tab', { name: 'index.ts' });
    expect(fallbackTab).toHaveClass('mc-tab-selected');
    expect(fallbackTab.parentElement?.querySelector('.mc-active-bar')).not.toBeNull();
    expect(container.querySelectorAll('.mc-active-bar')).toHaveLength(1);
  });

  it('兜底跳过开头的 disabled 项', () => {
    const items: TabItem[] = [
      { value: 'a', label: '甲', disabled: true },
      { value: 'b', label: '乙' },
    ];
    render(<Tabs items={items} value="幽灵" />);
    expect(screen.getByRole('tab', { name: '乙' })).toHaveAttribute('aria-selected', 'true');
  });

  it('兜底时对应面板可见（不会出现「所有面板都 hidden」）', () => {
    const items: TabItem[] = [
      { value: 'a', label: 'index.ts' },
      { value: 'b', label: 'App.tsx' },
    ];
    render(
      <Tabs items={items} value="幽灵">
        {({ value }) => <span>{`面板:${value}`}</span>}
      </Tabs>,
    );
    const panel = screen.getByRole('tabpanel');
    expect(panel).toHaveTextContent('面板:a');
  });

  it('兜底不改受控值、也不回调 onValueChange（那是调用方的账）', () => {
    const onValueChange = vi.fn();
    const items: TabItem[] = [{ value: 'a', label: 'index.ts' }];
    render(<Tabs items={items} value="幽灵" onValueChange={onValueChange} />);
    expect(onValueChange).not.toHaveBeenCalled();
    // 重渲染后仍是受控值：父组件没同步之前组件不会自说自话地改选中
    expect(screen.getByRole('tab', { name: 'index.ts' })).toHaveAttribute('aria-selected', 'true');
  });

  it('兜底后方向键从兜底项继续（不是从 0 号另起一段）', () => {
    const onValueChange = vi.fn();
    const items: TabItem[] = [
      { value: 'a', label: 'index.ts' },
      { value: 'b', label: 'App.tsx' },
    ];
    render(<Tabs items={items} value="幽灵" onValueChange={onValueChange} />);
    fireEvent.keyDown(screen.getByRole('tablist'), { key: 'ArrowRight' });
    expect(onValueChange).toHaveBeenCalledWith('b');
  });

  it('兜底时 roving tabindex 仍有一格（键盘用户能进标签栏）', () => {
    const items: TabItem[] = [
      { value: 'a', label: 'index.ts' },
      { value: 'b', label: 'App.tsx' },
    ];
    render(<Tabs items={items} value="幽灵" />);
    const tablist = screen.getByRole('tablist');
    expect(tablist.querySelectorAll('[role="tab"][tabindex="0"]')).toHaveLength(1);
  });

  it('value 恢复合法后兜底自动失效（不粘住）', () => {
    const items: TabItem[] = [
      { value: 'a', label: 'index.ts' },
      { value: 'b', label: 'App.tsx' },
    ];
    const { rerender } = render(<Tabs items={items} value="幽灵" />);
    rerender(<Tabs items={items} value="b" />);
    expect(screen.getByRole('tab', { name: 'App.tsx' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'index.ts' })).toHaveAttribute('aria-selected', 'false');
  });

  it('文件被关掉后（items 变短）非受控选中态也自动兜底', () => {
    const items: TabItem[] = [
      { value: 'a', label: 'index.ts' },
      { value: 'b', label: 'App.tsx' },
    ];
    const { rerender } = render(<Tabs items={items} defaultValue="b" />);
    rerender(<Tabs items={[items[0] as TabItem]} defaultValue="b" />);
    expect(screen.getByRole('tab', { name: 'index.ts' })).toHaveAttribute('aria-selected', 'true');
  });

  it('items 为空 + value 悬空时不炸（没有任何可高亮项）', () => {
    render(<Tabs items={[]} value="幽灵" />);
    expect(screen.queryAllByRole('tab')).toHaveLength(0);
    expect(screen.getByRole('tablist')).toBeInTheDocument();
  });

  it('items 全禁用时兜底到第一个 disabled 项（尊重调用方，别自作主张跳过）', () => {
    const items: TabItem[] = [
      { value: 'a', label: '甲', disabled: true },
      { value: 'b', label: '乙', disabled: true },
    ];
    render(<Tabs items={items} value="幽灵" />);
    expect(screen.getByRole('tab', { name: '甲' })).toHaveAttribute('aria-selected', 'true');
  });
});

describe('Tabs · 回归防线：新增能力默认全关时 DOM 不变', () => {
  const PLAIN: TabItem[] = [
    { value: 'a', label: '甲' },
    { value: 'b', label: '乙' },
  ];

  it('tablist 的 HTML 与扩展前逐字一致（id 归一化后比对）', () => {
    const { container } = render(<Tabs items={PLAIN} />);
    const normalize = (html: string): string =>
      html.replace(/mc-tab-\w+-/g, 'TAB-').replace(/mc-tabpanel-\w+-/g, 'PANEL-');
    expect(normalize(container.innerHTML)).toBe(
      '<div class="flex min-h-0 flex-col">' +
        '<div role="tablist" aria-orientation="horizontal" class="flex items-center gap-0.5 border-b border-mc-border bg-mc-surface px-1 py-1">' +
        '<span class="relative inline-flex">' +
        '<button type="button" role="tab" id="TAB-a" aria-selected="true" aria-controls="PANEL-a" tabindex="0" class="mc-tab cursor-pointer px-2 py-1 mc-tab-selected">' +
        '<span>甲</span></button><span class="mc-active-bar" aria-hidden="true"></span></span>' +
        '<span class="relative inline-flex">' +
        '<button type="button" role="tab" id="TAB-b" aria-selected="false" aria-controls="PANEL-b" tabindex="-1" class="mc-tab cursor-pointer px-2 py-1 mc-tab-idle">' +
        '<span>乙</span></button></span></div>' +
        '<div role="tabpanel" id="PANEL-a" aria-labelledby="TAB-a" tabindex="0" class="px-3 py-3 text-sm text-mc-text"></div>' +
        '<div role="tabpanel" id="PANEL-b" aria-labelledby="TAB-b" tabindex="0" hidden="" class="px-3 py-3 text-sm text-mc-text"></div>' +
        '</div>',
    );
  });

  it('tab 上不输出 aria-label（没有冗余朗读源）', () => {
    render(<Tabs items={PLAIN} />);
    for (const tab of screen.getAllByRole('tab')) {
      expect(tab).not.toHaveAttribute('aria-label');
    }
  });

  it('tablist 内没有任何 role=button / role=img 子元素', () => {
    render(<Tabs items={PLAIN} />);
    const tablist = screen.getByRole('tablist');
    expect(tablist.querySelectorAll('[role="button"]')).toHaveLength(0);
    expect(tablist.querySelectorAll('[role="img"]')).toHaveLength(0);
    expect(tablist.querySelectorAll('button button')).toHaveLength(0);
  });

  it('不传 closeable 时连 aria-hidden 装饰层都不多一个', () => {
    render(<Tabs items={PLAIN} />);
    const tablist = screen.getByRole('tablist');
    expect(tablist.querySelectorAll('[aria-hidden="true"]')).toHaveLength(1);
  });

  it('默认 tablist 里可聚焦元素只有 1 个（roving 未被新按钮污染）', () => {
    render(<Tabs items={PLAIN} />);
    expect(screen.getByRole('tablist').querySelectorAll('[tabindex="0"]')).toHaveLength(1);
  });

  it('既有键盘导航在默认配置下不受影响', () => {
    const onValueChange = vi.fn();
    render(<Tabs items={PLAIN} onValueChange={onValueChange} />);
    fireEvent.keyDown(screen.getByRole('tablist'), { key: 'ArrowRight' });
    expect(onValueChange).toHaveBeenCalledWith('b');
  });
});
