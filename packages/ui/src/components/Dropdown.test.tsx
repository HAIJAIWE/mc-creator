import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { Dropdown, type DropdownItem } from './Dropdown';

const ITEMS: DropdownItem[] = [
  { value: 'java', label: 'Java 21' },
  { value: 'kotlin', label: 'Kotlin' },
  { value: 'groovy', label: 'Groovy', disabled: true },
];

const trigger = () => screen.getByRole('combobox');

describe('Dropdown · 基础渲染', () => {
  it('渲染 role="combobox" 触发器', () => {
    render(<Dropdown items={ITEMS} />);
    expect(trigger()).toBeInTheDocument();
  });

  it('复用 index.css 的 .mc-select', () => {
    render(<Dropdown items={ITEMS} />);
    expect(trigger()).toHaveClass('mc-select');
  });

  it('未选中时显示 placeholder', () => {
    render(<Dropdown items={ITEMS} />);
    expect(trigger()).toHaveTextContent('请选择');
  });

  it('placeholder 可自定义', () => {
    render(<Dropdown items={ITEMS} placeholder="选择语言" />);
    expect(trigger()).toHaveTextContent('选择语言');
  });

  it('defaultValue 显示对应项文本', () => {
    render(<Dropdown items={ITEMS} defaultValue="kotlin" />);
    expect(trigger()).toHaveTextContent('Kotlin');
  });

  it('默认收起，不渲染 listbox', () => {
    render(<Dropdown items={ITEMS} />);
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('label 作为可访问名', () => {
    render(<Dropdown items={ITEMS} label="语言" />);
    expect(screen.getByRole('combobox', { name: '语言' })).toBeInTheDocument();
  });

  it('渲染选项图标', () => {
    const items: DropdownItem[] = [
      { value: 'a', label: '甲', icon: <span data-testid="ico">I</span> },
    ];
    render(<Dropdown items={items} open onOpenChange={() => {}} />);
    expect(screen.getByTestId('ico')).toBeInTheDocument();
  });
});

describe('Dropdown · 开关（受控/非受控）', () => {
  it('点击触发器展开', () => {
    render(<Dropdown items={ITEMS} />);
    fireEvent.click(trigger());
    expect(screen.getByRole('listbox')).toBeInTheDocument();
  });

  it('再次点击触发器收起', () => {
    render(<Dropdown items={ITEMS} />);
    fireEvent.click(trigger());
    fireEvent.click(trigger());
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('aria-expanded 反映开关状态', () => {
    render(<Dropdown items={ITEMS} />);
    expect(trigger()).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(trigger());
    expect(trigger()).toHaveAttribute('aria-expanded', 'true');
  });

  it('aria-controls 指向 listbox', () => {
    render(<Dropdown items={ITEMS} open onOpenChange={() => {}} />);
    const controls = trigger().getAttribute('aria-controls');
    expect(document.getElementById(controls as string)).toHaveAttribute('role', 'listbox');
  });

  it('aria-haspopup=listbox', () => {
    render(<Dropdown items={ITEMS} />);
    expect(trigger()).toHaveAttribute('aria-haspopup', 'listbox');
  });

  it('onOpenChange 被调用（true / false）', () => {
    const onOpenChange = vi.fn();
    render(<Dropdown items={ITEMS} onOpenChange={onOpenChange} />);
    fireEvent.click(trigger());
    expect(onOpenChange).toHaveBeenCalledWith(true);
    fireEvent.click(trigger());
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('受控 open 时点击不改状态（由父组件决定）', () => {
    const onOpenChange = vi.fn();
    render(<Dropdown items={ITEMS} open onOpenChange={onOpenChange} />);
    fireEvent.click(trigger());
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(screen.getByRole('listbox')).toBeInTheDocument();
  });

  it('受控 open=false 时不渲染 listbox', () => {
    render(<Dropdown items={ITEMS} open={false} onOpenChange={() => {}} />);
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('disabled 时点击不展开', () => {
    render(<Dropdown items={ITEMS} disabled />);
    fireEvent.click(trigger());
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('disabled 时触发器被禁用', () => {
    render(<Dropdown items={ITEMS} disabled />);
    expect(trigger()).toBeDisabled();
  });
});

describe('Dropdown · 选择', () => {
  it('展开后渲染所有选项', () => {
    render(<Dropdown items={ITEMS} open onOpenChange={() => {}} />);
    expect(screen.getAllByRole('option')).toHaveLength(3);
  });

  it('点击选项触发 onValueChange 并收起', () => {
    const onValueChange = vi.fn();
    render(<Dropdown items={ITEMS} onValueChange={onValueChange} />);
    fireEvent.click(trigger());
    fireEvent.click(screen.getByRole('option', { name: 'Kotlin' }));
    expect(onValueChange).toHaveBeenCalledWith('kotlin');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('非受控：点击后触发器文本更新', () => {
    render(<Dropdown items={ITEMS} />);
    fireEvent.click(trigger());
    fireEvent.click(screen.getByRole('option', { name: 'Java 21' }));
    expect(trigger()).toHaveTextContent('Java 21');
  });

  it('点击 disabled 选项不选中', () => {
    const onValueChange = vi.fn();
    render(<Dropdown items={ITEMS} onValueChange={onValueChange} />);
    fireEvent.click(trigger());
    fireEvent.click(screen.getByRole('option', { name: 'Groovy' }));
    expect(onValueChange).not.toHaveBeenCalled();
  });

  it('disabled 选项标记 aria-disabled', () => {
    render(<Dropdown items={ITEMS} open onOpenChange={() => {}} />);
    expect(screen.getByRole('option', { name: 'Groovy' })).toHaveAttribute('aria-disabled', 'true');
  });

  it('可用选项不输出 aria-disabled', () => {
    render(<Dropdown items={ITEMS} open onOpenChange={() => {}} />);
    expect(screen.getByRole('option', { name: 'Kotlin' })).not.toHaveAttribute('aria-disabled');
  });

  it('当前选中项 aria-selected=true', () => {
    render(<Dropdown items={ITEMS} defaultValue="kotlin" open onOpenChange={() => {}} />);
    expect(screen.getByRole('option', { name: 'Kotlin' })).toHaveAttribute('aria-selected', 'true');
  });

  it('未选中项 aria-selected=false', () => {
    render(<Dropdown items={ITEMS} defaultValue="kotlin" open onOpenChange={() => {}} />);
    expect(screen.getByRole('option', { name: 'Java 21' })).toHaveAttribute(
      'aria-selected',
      'false',
    );
  });

  it('受控 value：点击只回调不改变显示', () => {
    const onValueChange = vi.fn();
    render(<Dropdown items={ITEMS} value="java" onValueChange={onValueChange} />);
    fireEvent.click(trigger());
    fireEvent.click(screen.getByRole('option', { name: 'Kotlin' }));
    expect(onValueChange).toHaveBeenCalledWith('kotlin');
    expect(trigger()).toHaveTextContent('Java 21');
  });

  it('真实受控用法：父组件 state 驱动', () => {
    function Harness() {
      // 注意不要用 useState<string | undefined>：exactOptionalPropertyTypes 下
      // `value?: string` 不接受显式的 undefined，那会把「受控」悄悄变成「非受控」。
      const [value, setValue] = useState('java');
      return <Dropdown items={ITEMS} value={value} onValueChange={setValue} />;
    }
    render(<Harness />);
    fireEvent.click(trigger());
    fireEvent.click(screen.getByRole('option', { name: 'Kotlin' }));
    expect(trigger()).toHaveTextContent('Kotlin');
  });

  it('选择后焦点回到触发器（不丢焦点）', () => {
    render(<Dropdown items={ITEMS} />);
    fireEvent.click(trigger());
    fireEvent.click(screen.getByRole('option', { name: 'Kotlin' }));
    expect(document.activeElement).toBe(trigger());
  });

  it('value 指向不存在的项时回落到 placeholder', () => {
    render(<Dropdown items={ITEMS} value="nope" />);
    expect(trigger()).toHaveTextContent('请选择');
  });

  it('选中项渲染对勾标记', () => {
    const { container } = render(
      <Dropdown items={ITEMS} defaultValue="kotlin" open onOpenChange={() => {}} />,
    );
    expect(container.textContent).toContain('✓');
  });
});

describe('Dropdown · 关闭路径', () => {
  it('Escape 关闭', () => {
    render(<Dropdown items={ITEMS} />);
    fireEvent.click(trigger());
    fireEvent.keyDown(trigger(), { key: 'Escape' });
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('Escape 关闭后焦点回到触发器', () => {
    render(<Dropdown items={ITEMS} />);
    fireEvent.click(trigger());
    fireEvent.keyDown(trigger(), { key: 'Escape' });
    expect(document.activeElement).toBe(trigger());
  });

  it('点击外部关闭', () => {
    render(
      <div>
        <Dropdown items={ITEMS} />
        <button type="button">外部按钮</button>
      </div>,
    );
    fireEvent.click(trigger());
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    fireEvent.mouseDown(screen.getByRole('button', { name: '外部按钮' }));
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('点击组件内部不关闭', () => {
    render(<Dropdown items={ITEMS} />);
    fireEvent.click(trigger());
    fireEvent.mouseDown(trigger());
    expect(screen.getByRole('listbox')).toBeInTheDocument();
  });

  it('Tab 关闭（顺带把焦点交给下一个控件）', () => {
    render(<Dropdown items={ITEMS} />);
    fireEvent.click(trigger());
    fireEvent.keyDown(trigger(), { key: 'Tab' });
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });
});

describe('Dropdown · 键盘导航', () => {
  it('ArrowDown 展开', () => {
    render(<Dropdown items={ITEMS} />);
    fireEvent.keyDown(trigger(), { key: 'ArrowDown' });
    expect(screen.getByRole('listbox')).toBeInTheDocument();
  });

  it('ArrowUp 也能展开', () => {
    render(<Dropdown items={ITEMS} />);
    fireEvent.keyDown(trigger(), { key: 'ArrowUp' });
    expect(screen.getByRole('listbox')).toBeInTheDocument();
  });

  it('Enter 展开', () => {
    render(<Dropdown items={ITEMS} />);
    fireEvent.keyDown(trigger(), { key: 'Enter' });
    expect(screen.getByRole('listbox')).toBeInTheDocument();
  });

  it('Space 展开且不滚动页面', () => {
    render(<Dropdown items={ITEMS} />);
    const event = new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true });
    fireEvent(trigger(), event);
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    expect(event.defaultPrevented).toBe(true);
  });

  it('disabled 时键盘不展开', () => {
    render(<Dropdown items={ITEMS} disabled />);
    fireEvent.keyDown(trigger(), { key: 'ArrowDown' });
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('展开时 ArrowDown 移动 aria-activedescendant 到下一项', () => {
    render(<Dropdown items={ITEMS} open onOpenChange={() => {}} defaultValue="java" />);
    fireEvent.keyDown(trigger(), { key: 'ArrowDown' });
    const activeId = trigger().getAttribute('aria-activedescendant');
    expect(activeId).toBeTruthy();
    expect(document.getElementById(activeId as string)).toHaveTextContent('Kotlin');
  });

  it('展开时 ArrowUp 从第一项回绕到末项（跳过 disabled）', () => {
    render(<Dropdown items={ITEMS} open onOpenChange={() => {}} defaultValue="java" />);
    fireEvent.keyDown(trigger(), { key: 'ArrowUp' });
    const activeId = trigger().getAttribute('aria-activedescendant') as string;
    expect(document.getElementById(activeId)).toHaveTextContent('Kotlin');
  });

  it('方向键跳过 disabled 选项', () => {
    render(<Dropdown items={ITEMS} open onOpenChange={() => {}} defaultValue="kotlin" />);
    fireEvent.keyDown(trigger(), { key: 'ArrowDown' });
    const activeId = trigger().getAttribute('aria-activedescendant') as string;
    // 第三项是 disabled，应跳过并环绕回第一项
    expect(document.getElementById(activeId)).toHaveTextContent('Java 21');
  });

  it('Home 跳到首个可用项', () => {
    render(<Dropdown items={ITEMS} open onOpenChange={() => {}} defaultValue="kotlin" />);
    fireEvent.keyDown(trigger(), { key: 'Home' });
    const activeId = trigger().getAttribute('aria-activedescendant') as string;
    expect(document.getElementById(activeId)).toHaveTextContent('Java 21');
  });

  it('End 跳到末个可用项（跳过 disabled）', () => {
    render(<Dropdown items={ITEMS} open onOpenChange={() => {}} defaultValue="java" />);
    fireEvent.keyDown(trigger(), { key: 'End' });
    const activeId = trigger().getAttribute('aria-activedescendant') as string;
    expect(document.getElementById(activeId)).toHaveTextContent('Kotlin');
  });

  it('Enter 选中当前高亮项', () => {
    const onValueChange = vi.fn();
    render(
      <Dropdown
        items={ITEMS}
        open
        onOpenChange={() => {}}
        defaultValue="java"
        onValueChange={onValueChange}
      />,
    );
    fireEvent.keyDown(trigger(), { key: 'ArrowDown' });
    fireEvent.keyDown(trigger(), { key: 'Enter' });
    expect(onValueChange).toHaveBeenCalledWith('kotlin');
  });

  it('Space 选中当前高亮项', () => {
    const onValueChange = vi.fn();
    render(
      <Dropdown
        items={ITEMS}
        open
        onOpenChange={() => {}}
        defaultValue="kotlin"
        onValueChange={onValueChange}
      />,
    );
    fireEvent.keyDown(trigger(), { key: ' ' });
    expect(onValueChange).toHaveBeenCalledWith('kotlin');
  });

  it('展开时按 Enter 直接选中默认高亮项', () => {
    const onValueChange = vi.fn();
    render(
      <Dropdown
        items={ITEMS}
        open
        onOpenChange={() => {}}
        defaultValue="kotlin"
        onValueChange={onValueChange}
      />,
    );
    fireEvent.keyDown(trigger(), { key: 'Enter' });
    expect(onValueChange).toHaveBeenCalledWith('kotlin');
  });

  it('无高亮项时 Enter 不误选', () => {
    const onValueChange = vi.fn();
    render(<Dropdown items={ITEMS} open onOpenChange={() => {}} onValueChange={onValueChange} />);
    fireEvent.keyDown(trigger(), { key: 'Enter' });
    expect(onValueChange).not.toHaveBeenCalled();
  });

  it('收起时高亮项从 aria-activedescendant 移除', () => {
    render(<Dropdown items={ITEMS} open onOpenChange={() => {}} defaultValue="java" />);
    fireEvent.keyDown(trigger(), { key: 'ArrowDown' });
    expect(trigger()).toHaveAttribute('aria-activedescendant');
    fireEvent.keyDown(trigger(), { key: 'Escape' });
    expect(trigger()).not.toHaveAttribute('aria-activedescendant');
  });

  it('鼠标悬停切换高亮', () => {
    render(<Dropdown items={ITEMS} open onOpenChange={() => {}} defaultValue="java" />);
    fireEvent.mouseEnter(screen.getByRole('option', { name: 'Kotlin' }));
    const activeId = trigger().getAttribute('aria-activedescendant') as string;
    expect(document.getElementById(activeId)).toHaveTextContent('Kotlin');
  });

  it('悬停 disabled 项不改高亮', () => {
    render(<Dropdown items={ITEMS} open onOpenChange={() => {}} defaultValue="java" />);
    const before = trigger().getAttribute('aria-activedescendant');
    fireEvent.mouseEnter(screen.getByRole('option', { name: 'Groovy' }));
    expect(trigger().getAttribute('aria-activedescendant')).toBe(before);
  });

  it('空列表时方向键不崩', () => {
    render(<Dropdown items={[]} open onOpenChange={() => {}} />);
    expect(() => fireEvent.keyDown(trigger(), { key: 'ArrowDown' })).not.toThrow();
    expect(screen.getByRole('listbox')).toBeInTheDocument();
  });

  it('全 disabled 时方向键不崩', () => {
    const items: DropdownItem[] = [{ value: 'a', label: '甲', disabled: true }];
    render(<Dropdown items={items} open onOpenChange={() => {}} />);
    expect(() => fireEvent.keyDown(trigger(), { key: 'ArrowDown' })).not.toThrow();
  });
});

describe('Dropdown · 透传', () => {
  it('className 合并到根容器', () => {
    const { container } = render(<Dropdown items={ITEMS} className="my-dd" />);
    expect(container.firstElementChild).toHaveClass('my-dd');
  });

  it('listboxClassName 合并到浮层', () => {
    render(<Dropdown items={ITEMS} open onOpenChange={() => {}} listboxClassName="my-list" />);
    expect(screen.getByRole('listbox')).toHaveClass('mc-pop', 'my-list');
  });
});
