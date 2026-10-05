import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { Tabs, type TabItem } from './Tabs';

const ITEMS: TabItem[] = [
  { value: 'build', label: '构建' },
  { value: 'files', label: '文件' },
  { value: 'settings', label: '设置' },
];

describe('Tabs · 基础渲染', () => {
  it('渲染 tablist', () => {
    render(<Tabs items={ITEMS} />);
    expect(screen.getByRole('tablist')).toBeInTheDocument();
  });

  it('每个 item 渲染一个 tab', () => {
    render(<Tabs items={ITEMS} />);
    expect(screen.getAllByRole('tab')).toHaveLength(3);
  });

  it('非受控时默认选中第一项', () => {
    render(<Tabs items={ITEMS} />);
    expect(screen.getByRole('tab', { name: '构建' })).toHaveAttribute('aria-selected', 'true');
  });

  it('defaultValue 指定默认选中项', () => {
    render(<Tabs items={ITEMS} defaultValue="files" />);
    expect(screen.getByRole('tab', { name: '文件' })).toHaveAttribute('aria-selected', 'true');
  });

  it('defaultValue 指向 disabled 项时也照选（尊重调用方）', () => {
    const items: TabItem[] = [
      { value: 'a', label: '甲' },
      { value: 'b', label: '乙', disabled: true },
    ];
    render(<Tabs items={items} defaultValue="b" />);
    expect(screen.getByRole('tab', { name: '乙' })).toHaveAttribute('aria-selected', 'true');
  });

  it('复用 index.css 的 .mc-tab', () => {
    render(<Tabs items={ITEMS} />);
    expect(screen.getAllByRole('tab')[0]).toHaveClass('mc-tab');
  });

  it('选中项带 mc-tab-selected，未选中带 mc-tab-idle', () => {
    render(<Tabs items={ITEMS} />);
    expect(screen.getByRole('tab', { name: '构建' })).toHaveClass('mc-tab-selected');
    expect(screen.getByRole('tab', { name: '文件' })).toHaveClass('mc-tab-idle');
  });

  it('选中项渲染 mc-active-bar 指示条', () => {
    const { container } = render(<Tabs items={ITEMS} />);
    expect(container.querySelectorAll('.mc-active-bar')).toHaveLength(1);
  });

  it('未选中项不渲染指示条', () => {
    render(<Tabs items={ITEMS} defaultValue="files" />);
    const fileTab = screen.getByRole('tab', { name: '文件' });
    expect(fileTab.parentElement?.querySelector('.mc-active-bar')).not.toBeNull();
    const buildTab = screen.getByRole('tab', { name: '构建' });
    expect(buildTab.parentElement?.querySelector('.mc-active-bar')).toBeNull();
  });

  it('渲染 badge', () => {
    const items: TabItem[] = [{ value: 'a', label: '文件', badge: '3' }];
    render(<Tabs items={items} />);
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('无 badge 时不渲染徽标元素', () => {
    render(<Tabs items={ITEMS} />);
    expect(screen.queryByText('3')).not.toBeInTheDocument();
  });

  it('支持 ReactNode 标签', () => {
    const items: TabItem[] = [{ value: 'a', label: <span data-testid="fancy">复杂</span> }];
    render(<Tabs items={items} />);
    expect(screen.getByTestId('fancy')).toBeInTheDocument();
  });
});

describe('Tabs · 无障碍连线', () => {
  it('aria-orientation 默认 horizontal', () => {
    render(<Tabs items={ITEMS} />);
    expect(screen.getByRole('tablist')).toHaveAttribute('aria-orientation', 'horizontal');
  });

  it('orientation=vertical 时 aria-orientation 为 vertical', () => {
    render(<Tabs items={ITEMS} orientation="vertical" />);
    expect(screen.getByRole('tablist')).toHaveAttribute('aria-orientation', 'vertical');
  });

  it('label 作为 tablist 的可访问名', () => {
    render(<Tabs items={ITEMS} label="工作区视图" />);
    expect(screen.getByRole('tablist', { name: '工作区视图' })).toBeInTheDocument();
  });

  it('未选中项 aria-selected=false', () => {
    render(<Tabs items={ITEMS} />);
    expect(screen.getByRole('tab', { name: '文件' })).toHaveAttribute('aria-selected', 'false');
  });

  it('tab 的 aria-controls 指向自己的 panel id（不是共用一个）', () => {
    render(<Tabs items={ITEMS} />);
    const controls = ITEMS.map((item) =>
      screen.getByRole('tab', { name: item.label as string }).getAttribute('aria-controls'),
    );
    expect(new Set(controls).size).toBe(3);
    for (const id of controls) {
      expect(id).toBeTruthy();
      expect(document.getElementById(id as string)).not.toBeNull();
    }
  });

  it('每个 panel 的 aria-labelledby 指向自己的 tab', () => {
    render(<Tabs items={ITEMS} />);
    for (const item of ITEMS) {
      const tab = screen.getByRole('tab', { name: item.label as string });
      const panel = document.getElementById(tab.getAttribute('aria-controls') as string);
      expect(panel).toHaveAttribute('aria-labelledby', tab.getAttribute('id'));
    }
  });

  it('只有激活的 panel 对辅助技术可见（未激活的 hidden）', () => {
    const { container } = render(<Tabs items={ITEMS} />);
    const panels = container.querySelectorAll('[role="tabpanel"]');
    const visible = Array.from(panels).filter((p) => !p.hasAttribute('hidden'));
    expect(visible).toHaveLength(1);
  });

  it('getByRole 只找到可见 panel（hidden 的不进无障碍树）', () => {
    render(<Tabs items={ITEMS}>面板内容</Tabs>);
    expect(screen.getAllByRole('tabpanel')).toHaveLength(1);
  });

  it('tabpanel 有 tabIndex=0（纯文本面板也能被键盘聚焦滚动）', () => {
    render(<Tabs items={ITEMS}>内容</Tabs>);
    expect(screen.getByRole('tabpanel')).toHaveAttribute('tabindex', '0');
  });

  it('disabled 项标记 aria-disabled 与原生 disabled', () => {
    const items: TabItem[] = [
      { value: 'a', label: '甲' },
      { value: 'b', label: '乙', disabled: true },
    ];
    render(<Tabs items={items} />);
    const tab = screen.getByRole('tab', { name: '乙' });
    expect(tab).toHaveAttribute('aria-disabled', 'true');
    expect(tab).toBeDisabled();
  });

  it('可用项不输出 aria-disabled（避免 false 噪声）', () => {
    render(<Tabs items={ITEMS} />);
    expect(screen.getByRole('tab', { name: '构建' })).not.toHaveAttribute('aria-disabled');
  });
});

describe('Tabs · roving tabindex', () => {
  it('只有激活项 tabIndex=0，其余 -1（Tab 键只停一次）', () => {
    render(<Tabs items={ITEMS} />);
    expect(screen.getByRole('tab', { name: '构建' })).toHaveAttribute('tabindex', '0');
    expect(screen.getByRole('tab', { name: '文件' })).toHaveAttribute('tabindex', '-1');
    expect(screen.getByRole('tab', { name: '设置' })).toHaveAttribute('tabindex', '-1');
  });

  it('切换后 roving 焦点跟随激活项', () => {
    render(<Tabs items={ITEMS} />);
    fireEvent.click(screen.getByRole('tab', { name: '设置' }));
    expect(screen.getByRole('tab', { name: '设置' })).toHaveAttribute('tabindex', '0');
  });
});

describe('Tabs · 非受控交互', () => {
  it('点击切换选中项', () => {
    render(<Tabs items={ITEMS} />);
    fireEvent.click(screen.getByRole('tab', { name: '文件' }));
    expect(screen.getByRole('tab', { name: '文件' })).toHaveAttribute('aria-selected', 'true');
  });

  it('点击触发 onValueChange', () => {
    const onValueChange = vi.fn();
    render(<Tabs items={ITEMS} onValueChange={onValueChange} />);
    fireEvent.click(screen.getByRole('tab', { name: '设置' }));
    expect(onValueChange).toHaveBeenCalledWith('settings');
  });

  it('点击已选中的项仍回调（允许父组件对「重复点击同一 tab」做反应，如滚回顶部）', () => {
    const onValueChange = vi.fn();
    render(<Tabs items={ITEMS} onValueChange={onValueChange} />);
    fireEvent.click(screen.getByRole('tab', { name: '构建' }));
    expect(onValueChange).toHaveBeenCalledWith('build');
  });

  it('重复点击同一项时非受控选中态不变', () => {
    render(<Tabs items={ITEMS} />);
    fireEvent.click(screen.getByRole('tab', { name: '构建' }));
    expect(screen.getByRole('tab', { name: '构建' })).toHaveAttribute('aria-selected', 'true');
  });

  it('点击 disabled 项不切换、不回调', () => {
    const onValueChange = vi.fn();
    const items: TabItem[] = [
      { value: 'a', label: '甲' },
      { value: 'b', label: '乙', disabled: true },
    ];
    render(<Tabs items={items} onValueChange={onValueChange} />);
    fireEvent.click(screen.getByRole('tab', { name: '乙' }));
    expect(onValueChange).not.toHaveBeenCalled();
    expect(screen.getByRole('tab', { name: '甲' })).toHaveAttribute('aria-selected', 'true');
  });

  it('默认选中第一个可用项（跳过开头的 disabled）', () => {
    const items: TabItem[] = [
      { value: 'a', label: '甲', disabled: true },
      { value: 'b', label: '乙' },
    ];
    render(<Tabs items={items} />);
    expect(screen.getByRole('tab', { name: '乙' })).toHaveAttribute('aria-selected', 'true');
  });
});

describe('Tabs · 受控模式', () => {
  it('受控时由 value 决定选中项，忽略内部状态', () => {
    const onValueChange = vi.fn();
    render(<Tabs items={ITEMS} value="files" onValueChange={onValueChange} />);
    expect(screen.getByRole('tab', { name: '文件' })).toHaveAttribute('aria-selected', 'true');
  });

  it('受控时点击只回调不改状态（父组件不更新就不动）', () => {
    const onValueChange = vi.fn();
    render(<Tabs items={ITEMS} value="files" onValueChange={onValueChange} />);
    fireEvent.click(screen.getByRole('tab', { name: '设置' }));
    expect(onValueChange).toHaveBeenCalledWith('settings');
    expect(screen.getByRole('tab', { name: '文件' })).toHaveAttribute('aria-selected', 'true');
  });

  it('value 变化时重新渲染出新的选中态', () => {
    const { rerender } = render(<Tabs items={ITEMS} value="build" />);
    expect(screen.getByRole('tab', { name: '构建' })).toHaveAttribute('aria-selected', 'true');
    rerender(<Tabs items={ITEMS} value="settings" />);
    expect(screen.getByRole('tab', { name: '设置' })).toHaveAttribute('aria-selected', 'true');
  });

  it('受控 + defaultValue 同传时以 value 为准', () => {
    render(<Tabs items={ITEMS} value="settings" defaultValue="files" />);
    expect(screen.getByRole('tab', { name: '设置' })).toHaveAttribute('aria-selected', 'true');
  });

  it('真实受控用法：父组件 state 驱动切换', () => {
    function Harness() {
      const [value, setValue] = useState('build');
      return (
        <>
          <button type="button" onClick={() => setValue('settings')}>
            外部切到设置
          </button>
          <Tabs items={ITEMS} value={value} onValueChange={setValue} />
        </>
      );
    }
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: '外部切到设置' }));
    expect(screen.getByRole('tab', { name: '设置' })).toHaveAttribute('aria-selected', 'true');
  });
});

describe('Tabs · 键盘导航', () => {
  it('ArrowRight 移到下一项', () => {
    const onValueChange = vi.fn();
    render(<Tabs items={ITEMS} onValueChange={onValueChange} />);
    fireEvent.keyDown(screen.getByRole('tablist'), { key: 'ArrowRight' });
    expect(onValueChange).toHaveBeenCalledWith('files');
  });

  it('ArrowLeft 移到上一项', () => {
    const onValueChange = vi.fn();
    render(<Tabs items={ITEMS} defaultValue="files" onValueChange={onValueChange} />);
    fireEvent.keyDown(screen.getByRole('tablist'), { key: 'ArrowLeft' });
    expect(onValueChange).toHaveBeenCalledWith('build');
  });

  it('第一项按 ArrowLeft 环绕到最后一项', () => {
    const onValueChange = vi.fn();
    render(<Tabs items={ITEMS} onValueChange={onValueChange} />);
    fireEvent.keyDown(screen.getByRole('tablist'), { key: 'ArrowLeft' });
    expect(onValueChange).toHaveBeenCalledWith('settings');
  });

  it('最后一项按 ArrowRight 环绕到第一项', () => {
    const onValueChange = vi.fn();
    render(<Tabs items={ITEMS} defaultValue="settings" onValueChange={onValueChange} />);
    fireEvent.keyDown(screen.getByRole('tablist'), { key: 'ArrowRight' });
    expect(onValueChange).toHaveBeenCalledWith('build');
  });

  it('方向键跳过 disabled 项', () => {
    const onValueChange = vi.fn();
    const items: TabItem[] = [
      { value: 'a', label: '甲' },
      { value: 'b', label: '乙', disabled: true },
      { value: 'c', label: '丙' },
    ];
    render(<Tabs items={items} onValueChange={onValueChange} />);
    fireEvent.keyDown(screen.getByRole('tablist'), { key: 'ArrowRight' });
    expect(onValueChange).toHaveBeenCalledWith('c');
  });

  it('Home 跳到第一个可用项', () => {
    const onValueChange = vi.fn();
    render(<Tabs items={ITEMS} defaultValue="settings" onValueChange={onValueChange} />);
    fireEvent.keyDown(screen.getByRole('tablist'), { key: 'Home' });
    expect(onValueChange).toHaveBeenCalledWith('build');
  });

  it('End 跳到最后一个可用项', () => {
    const onValueChange = vi.fn();
    render(<Tabs items={ITEMS} onValueChange={onValueChange} />);
    fireEvent.keyDown(screen.getByRole('tablist'), { key: 'End' });
    expect(onValueChange).toHaveBeenCalledWith('settings');
  });

  it('End 跳过末尾的 disabled 项', () => {
    const onValueChange = vi.fn();
    const items: TabItem[] = [
      { value: 'a', label: '甲' },
      { value: 'b', label: '乙' },
      { value: 'c', label: '丙', disabled: true },
    ];
    render(<Tabs items={items} onValueChange={onValueChange} />);
    fireEvent.keyDown(screen.getByRole('tablist'), { key: 'End' });
    expect(onValueChange).toHaveBeenCalledWith('b');
  });

  it('Home 跳过开头的 disabled 项', () => {
    const onValueChange = vi.fn();
    const items: TabItem[] = [
      { value: 'a', label: '甲', disabled: true },
      { value: 'b', label: '乙' },
      { value: 'c', label: '丙' },
    ];
    render(<Tabs items={items} onValueChange={onValueChange} />);
    fireEvent.keyDown(screen.getByRole('tablist'), { key: 'Home' });
    expect(onValueChange).toHaveBeenCalledWith('b');
  });

  it('方向键同时移动真实焦点（roving tabindex 的意义）', () => {
    render(<Tabs items={ITEMS} />);
    screen.getByRole('tab', { name: '构建' }).focus();
    fireEvent.keyDown(screen.getByRole('tablist'), { key: 'ArrowRight' });
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: '文件' }));
  });

  it('vertical 方向用上下键导航', () => {
    const onValueChange = vi.fn();
    render(<Tabs items={ITEMS} orientation="vertical" onValueChange={onValueChange} />);
    fireEvent.keyDown(screen.getByRole('tablist'), { key: 'ArrowDown' });
    expect(onValueChange).toHaveBeenCalledWith('files');
  });

  it('vertical 方向下左右键不触发导航', () => {
    const onValueChange = vi.fn();
    render(<Tabs items={ITEMS} orientation="vertical" onValueChange={onValueChange} />);
    fireEvent.keyDown(screen.getByRole('tablist'), { key: 'ArrowRight' });
    expect(onValueChange).not.toHaveBeenCalled();
  });

  it('horizontal 方向下上下键不触发导航', () => {
    const onValueChange = vi.fn();
    render(<Tabs items={ITEMS} onValueChange={onValueChange} />);
    fireEvent.keyDown(screen.getByRole('tablist'), { key: 'ArrowDown' });
    expect(onValueChange).not.toHaveBeenCalled();
  });

  it('其他按键（如 Tab）不被劫持', () => {
    const onValueChange = vi.fn();
    render(<Tabs items={ITEMS} onValueChange={onValueChange} />);
    fireEvent.keyDown(screen.getByRole('tablist'), { key: 'Tab' });
    expect(onValueChange).not.toHaveBeenCalled();
  });

  it('方向键阻止默认滚动', () => {
    render(<Tabs items={ITEMS} />);
    const event = new KeyboardEvent('keydown', {
      key: 'ArrowRight',
      bubbles: true,
      cancelable: true,
    });
    fireEvent(screen.getByRole('tablist'), event);
    expect(event.defaultPrevented).toBe(true);
  });

  it('全是 disabled 时方向键不炸', () => {
    const onValueChange = vi.fn();
    const items: TabItem[] = [
      { value: 'a', label: '甲', disabled: true },
      { value: 'b', label: '乙', disabled: true },
    ];
    render(<Tabs items={items} onValueChange={onValueChange} />);
    fireEvent.keyDown(screen.getByRole('tablist'), { key: 'ArrowRight' });
    fireEvent.keyDown(screen.getByRole('tablist'), { key: 'Home' });
    expect(onValueChange).not.toHaveBeenCalled();
  });
});

describe('Tabs · 面板内容', () => {
  it('静态 children 渲染在激活面板里', () => {
    render(<Tabs items={ITEMS}>静态内容</Tabs>);
    expect(screen.getByRole('tabpanel')).toHaveTextContent('静态内容');
  });

  it('渲染函数按 tab 定制内容', () => {
    render(
      <Tabs items={ITEMS}>
        {({ value }) => <span data-testid="panel">{`面板:${value}`}</span>}
      </Tabs>,
    );
    expect(screen.getByTestId('panel')).toHaveTextContent('面板:build');
  });

  it('渲染函数收到对应的 item 对象', () => {
    render(
      <Tabs items={ITEMS} defaultValue="files">
        {({ item }) => <span data-testid="panel">{item?.badge ?? '无'}</span>}
      </Tabs>,
    );
    expect(screen.getByTestId('panel')).toHaveTextContent('无');
  });

  it('切换后面板内容随之更新', () => {
    render(<Tabs items={ITEMS}>{({ value }) => <span data-testid="panel">{value}</span>}</Tabs>);
    fireEvent.click(screen.getByRole('tab', { name: '设置' }));
    expect(screen.getByTestId('panel')).toHaveTextContent('settings');
  });

  it('无 children 时渲染空面板', () => {
    render(<Tabs items={ITEMS} />);
    expect(screen.getByRole('tabpanel')).toBeEmptyDOMElement();
  });

  it('className / panelClassName 可覆盖', () => {
    render(
      <Tabs items={ITEMS} className="my-tabs" panelClassName="my-panel">
        内容
      </Tabs>,
    );
    expect(screen.getByRole('tablist')).toHaveClass('my-tabs');
    expect(screen.getByRole('tabpanel')).toHaveClass('my-panel');
  });
});
