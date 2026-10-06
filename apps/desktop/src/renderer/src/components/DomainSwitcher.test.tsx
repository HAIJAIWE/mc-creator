// @vitest-environment jsdom
/**
 * DomainSwitcher 测试：§0.2 顶部域切换器
 *
 * 覆盖：
 * 1. 三个域都渲染，中文显示名走 domains.ts 真源（不 mock i18n，用真实语言包顺带守 i18n 不漂移）
 * 2. ARIA：role=tablist / role=tab / aria-selected / roving tabindex
 * 3. 点击切域 → 回调参数正确
 * 4. 左右箭头切域（含循环）、Home/End
 * 5. 键盘可达：整组只占一个 Tab 停靠点，方向键后焦点跟到新激活 tab
 * 6. 非受控模式写 domain-store（tabs 之外的实际接线）
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { DomainSwitcher } from './DomainSwitcher.js';
import { useDomainStore, DEFAULT_DOMAIN } from '../store/domain-store.js';

/** 切换器上三个 tab 的中文名 */
const TAB_LABELS = ['启动器', '服务器', 'MC 开发'] as const;

const tablist = () => screen.getByRole('tablist', { name: '工作域切换' });
const tabs = () => screen.getAllByRole('tab');
const tab = (name: string) => screen.getByRole('tab', { name });

beforeEach(() => {
  // store 是模块级单例 + 持久化，这里显式回到默认值，免得用例互相污染
  useDomainStore.setState({ domain: DEFAULT_DOMAIN });
  // 同 ActivityBar.test.tsx：让 rAF 同步执行，焦点断言才不用 await
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    cb(0);
    return 0;
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('DomainSwitcher 渲染', () => {
  it('渲染 tablist 容器与三个 tab（启动器 / 服务器 / MC 开发）', () => {
    render(<DomainSwitcher value="dev" onChange={() => {}} />);
    expect(tablist()).toBeTruthy();
    expect(tablist().getAttribute('aria-orientation')).toBe('horizontal');
    expect(tabs()).toHaveLength(3);
    for (const label of TAB_LABELS) {
      expect(tab(label).textContent).toBe(label);
    }
  });

  it('三个 tab 的顺序即 §0.2 的域顺序 launcher → server → dev', () => {
    render(<DomainSwitcher value="launcher" onChange={() => {}} />);
    expect(tabs().map((el) => el.textContent)).toEqual([...TAB_LABELS]);
  });

  it('常驻显示当前域的一句话职责', () => {
    render(<DomainSwitcher value="server" onChange={() => {}} />);
    expect(screen.getByText('长期运行形态：服务端实例、世界数据与资源包的持续运维。')).toBeTruthy();
  });

  it('标注智能体横向贯穿（三域都在，不占域位）', () => {
    render(<DomainSwitcher value="dev" onChange={() => {}} />);
    expect(screen.getByText('智能体 · 三域常驻')).toBeTruthy();
  });

  it('每个 tab 都 type="button"（防止表单提交）且带职责 title', () => {
    render(<DomainSwitcher value="launcher" onChange={() => {}} />);
    for (const el of tabs()) {
      expect((el as HTMLButtonElement).type).toBe('button');
      expect(el.getAttribute('title')).toBeTruthy();
    }
    expect(tab('启动器').getAttribute('title')).toBe(
      '把内容跑起来：拉客户端、装依赖、启动游戏实例。',
    );
  });
});

describe('DomainSwitcher ARIA 选中态', () => {
  it('当前域 aria-selected=true，其余为 false', () => {
    render(<DomainSwitcher value="server" onChange={() => {}} />);
    expect(tab('启动器').getAttribute('aria-selected')).toBe('false');
    expect(tab('服务器').getAttribute('aria-selected')).toBe('true');
    expect(tab('MC 开发').getAttribute('aria-selected')).toBe('false');
  });

  it('每个 tab 的 id 唯一且可反查域（domains.<id>）', () => {
    render(<DomainSwitcher value="launcher" onChange={() => {}} />);
    expect(tab('启动器').id).toBe('domain-tab-launcher');
    expect(tab('服务器').id).toBe('domain-tab-server');
    expect(tab('MC 开发').id).toBe('domain-tab-dev');
  });

  it('roving tabindex：只有激活 tab tabIndex=0，其余 -1（整组只吃一个 Tab 停靠点）', () => {
    render(<DomainSwitcher value="dev" onChange={() => {}} />);
    expect(tab('MC 开发').tabIndex).toBe(0);
    expect(tab('启动器').tabIndex).toBe(-1);
    expect(tab('服务器').tabIndex).toBe(-1);
  });
});

describe('DomainSwitcher 点击切域', () => {
  it('点击未激活 tab 以其域 id 回调', () => {
    const onChange = vi.fn();
    render(<DomainSwitcher value="dev" onChange={onChange} />);
    fireEvent.click(tab('启动器'));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('launcher');
  });

  it('点击当前域也回调（不吞事件，父层仍可决定要不要 no-op）', () => {
    const onChange = vi.fn();
    render(<DomainSwitcher value="server" onChange={onChange} />);
    fireEvent.click(tab('服务器'));
    expect(onChange).toHaveBeenCalledWith('server');
  });
});

describe('DomainSwitcher 键盘导航（自动激活 + 左右箭头）', () => {
  it('ArrowRight 切到下一个域', () => {
    const onChange = vi.fn();
    render(<DomainSwitcher value="launcher" onChange={onChange} />);
    fireEvent.keyDown(tab('启动器'), { key: 'ArrowRight' });
    expect(onChange).toHaveBeenCalledWith('server');
  });

  it('ArrowLeft 切到上一个域', () => {
    const onChange = vi.fn();
    render(<DomainSwitcher value="server" onChange={onChange} />);
    fireEvent.keyDown(tab('服务器'), { key: 'ArrowLeft' });
    expect(onChange).toHaveBeenCalledWith('launcher');
  });

  it('ArrowLeft 在第一个域时循环到最后一个（MC 开发）', () => {
    const onChange = vi.fn();
    render(<DomainSwitcher value="launcher" onChange={onChange} />);
    fireEvent.keyDown(tab('启动器'), { key: 'ArrowLeft' });
    expect(onChange).toHaveBeenCalledWith('dev');
  });

  it('ArrowRight 在最后一个域时循环回第一个（启动器）', () => {
    const onChange = vi.fn();
    render(<DomainSwitcher value="dev" onChange={onChange} />);
    fireEvent.keyDown(tab('MC 开发'), { key: 'ArrowRight' });
    expect(onChange).toHaveBeenCalledWith('launcher');
  });

  it('Home / End 跳到首尾', () => {
    const onChange = vi.fn();
    const { unmount } = render(<DomainSwitcher value="server" onChange={onChange} />);
    fireEvent.keyDown(tab('服务器'), { key: 'Home' });
    expect(onChange).toHaveBeenLastCalledWith('launcher');
    unmount();

    onChange.mockClear();
    render(<DomainSwitcher value="launcher" onChange={onChange} />);
    fireEvent.keyDown(tab('启动器'), { key: 'End' });
    expect(onChange).toHaveBeenLastCalledWith('dev');
  });

  it('方向键后焦点直接搬到目标 tab，不等父层重渲染（键盘可达不中断）', () => {
    const onChange = vi.fn();
    render(<DomainSwitcher value="launcher" onChange={onChange} />);
    tab('启动器').focus();
    expect(document.activeElement).toBe(tab('启动器'));

    // value 还是 launcher（父层还没重渲染），焦点已经落到服务器 tab
    fireEvent.keyDown(tab('启动器'), { key: 'ArrowRight' });
    expect(document.activeElement).toBe(tab('服务器'));
    expect(onChange).toHaveBeenCalledWith('server');
  });

  it('ArrowLeft 循环时焦点也跟到最后一个 tab', () => {
    const onChange = vi.fn();
    render(<DomainSwitcher value="launcher" onChange={onChange} />);
    tab('启动器').focus();
    fireEvent.keyDown(tab('启动器'), { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(tab('MC 开发'));
  });

  it('焦点搬到新激活 tab 后，它的 roving tabindex 也是 0', () => {
    const onChange = vi.fn();
    const { rerender } = render(<DomainSwitcher value="launcher" onChange={onChange} />);
    tab('启动器').focus();
    fireEvent.keyDown(tab('启动器'), { key: 'ArrowRight' });
    rerender(<DomainSwitcher value="server" onChange={onChange} />);
    expect(tab('服务器').tabIndex).toBe(0);
    expect(tab('启动器').tabIndex).toBe(-1);
    expect(document.activeElement).toBe(tab('服务器'));
  });

  it('其它键（Tab/Enter/Space/上下箭头）不切域', () => {
    const onChange = vi.fn();
    render(<DomainSwitcher value="dev" onChange={onChange} />);
    for (const key of ['Tab', 'Enter', ' ', 'ArrowUp', 'ArrowDown']) {
      fireEvent.keyDown(tab('MC 开发'), { key });
    }
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('DomainSwitcher 非受控模式接 domain-store', () => {
  it('不传 value/onChange 时读写 domain-store', () => {
    render(<DomainSwitcher />);
    // store 默认域是 dev
    expect(tab('MC 开发').getAttribute('aria-selected')).toBe('true');

    fireEvent.click(tab('服务器'));
    expect(useDomainStore.getState().domain).toBe('server');
    expect(tab('服务器').getAttribute('aria-selected')).toBe('true');
    expect(tab('MC 开发').getAttribute('aria-selected')).toBe('false');
  });

  it('store 域变化后 tab 选中态同步', () => {
    render(<DomainSwitcher />);
    act(() => {
      useDomainStore.setState({ domain: 'launcher' });
    });
    expect(tab('启动器').getAttribute('aria-selected')).toBe('true');
    expect(tab('MC 开发').getAttribute('aria-selected')).toBe('false');
  });
});
