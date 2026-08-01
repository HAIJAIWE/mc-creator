// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ActivityBar } from './ActivityBar.js';

/**
 * ActivityBar 测试：覆盖 P8.2 修复成果（WAI-ARIA Toolbar + Roving Tabindex）。
 *
 * 验证维度：
 * 1. ARIA 结构完整性（toolbar role / aria-orientation / aria-label / aria-pressed / aria-hidden）
 * 2. Roving Tabindex（仅 active 按钮 tabIndex=0）
 * 3. 键盘导航（ArrowUp/ArrowDown/Home/End，含循环）
 * 4. 点击切换（P7.3 回归）
 * 5. tooltip role="tooltip"
 * 6. 品牌标按钮 onHome 回调
 * 7. type="button" 防止表单提交
 */

const ACTIVITY_IDS = [
  'explorer',
  'search',
  'git',
  'packages',
  'items',
  'blocks',
  'mc',
  'entity',
  'audio',
  'cicd',
] as const;

beforeEach(() => {
  // jsdom polyfill：部分子组件可能调用 scrollIntoView
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = vi.fn();
  }
  // requestAnimationFrame 在 jsdom 里是同步近似实现，但 ActivityBar 依赖它延迟 focus，
  // 测试里用 vi.fn 转为同步执行，确保 focus 在 onChange 后立即发生
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    cb(0);
    return 0;
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('ActivityBar 渲染与 ARIA 结构', () => {
  it('渲染 toolbar 容器，含正确的 role / aria-label / aria-orientation', () => {
    render(<ActivityBar active="explorer" onChange={() => {}} />);
    const toolbar = screen.getByRole('toolbar', { name: '活动栏' });
    expect(toolbar).toBeTruthy();
    expect(toolbar.getAttribute('aria-orientation')).toBe('vertical');
  });

  it('渲染 11 个活动按钮 + 1 个设置按钮 + 1 个品牌标按钮 = 13 个 button', () => {
    render(<ActivityBar active="explorer" onChange={() => {}} />);
    const buttons = screen.getAllByRole('button');
    expect(buttons.length).toBe(13);
  });

  it('每个活动按钮都有 type="button"（防止表单提交）', () => {
    render(<ActivityBar active="explorer" onChange={() => {}} />);
    for (const id of [...ACTIVITY_IDS, 'settings']) {
      const btn = screen.getByLabelText(
        id === 'settings' ? '设置' : labelFor(id),
      ) as HTMLButtonElement;
      expect(btn.type).toBe('button');
    }
  });

  it('每个活动按钮都有 aria-label 和 title 属性', () => {
    render(<ActivityBar active="explorer" onChange={() => {}} />);
    for (const id of ACTIVITY_IDS) {
      const label = labelFor(id);
      const btn = screen.getByLabelText(label);
      expect(btn.getAttribute('aria-label')).toBe(label);
      expect(btn.title).toBe(label);
    }
  });

  it('激活按钮 aria-pressed=true、tabIndex=0', () => {
    render(<ActivityBar active="items" onChange={() => {}} />);
    const itemsBtn = screen.getByLabelText('物品/配方');
    expect(itemsBtn.getAttribute('aria-pressed')).toBe('true');
    expect(itemsBtn.tabIndex).toBe(0);
  });

  it('非激活按钮 aria-pressed=false、tabIndex=-1（Roving Tabindex）', () => {
    render(<ActivityBar active="explorer" onChange={() => {}} />);
    // 抽查 search / items / game 三个非激活按钮
    for (const id of ['search', 'items', 'game'] as const) {
      const btn = screen.getByLabelText(labelFor(id));
      expect(btn.getAttribute('aria-pressed')).toBe('false');
      expect(btn.tabIndex).toBe(-1);
    }
  });

  it('激活按钮含装饰条 .mc-active-bar，且 aria-hidden="true"', () => {
    render(<ActivityBar active="explorer" onChange={() => {}} />);
    const explorerBtn = screen.getByLabelText('资源管理器');
    const activeBar = explorerBtn.querySelector('.mc-active-bar');
    expect(activeBar).toBeTruthy();
    expect(activeBar?.getAttribute('aria-hidden')).toBe('true');
  });

  it('非激活按钮不含 .mc-active-bar', () => {
    render(<ActivityBar active="explorer" onChange={() => {}} />);
    const searchBtn = screen.getByLabelText('搜索');
    expect(searchBtn.querySelector('.mc-active-bar')).toBeNull();
  });

  it('设置按钮（settings）独立渲染在底部，data-activity="settings"', () => {
    render(<ActivityBar active="explorer" onChange={() => {}} />);
    const settingsBtn = screen.getByLabelText('设置');
    expect(settingsBtn.getAttribute('data-activity')).toBe('settings');
    expect(settingsBtn.getAttribute('aria-pressed')).toBe('false');
    expect(settingsBtn.tabIndex).toBe(-1);
  });

  it('设置按钮激活时 aria-pressed=true、tabIndex=0', () => {
    render(<ActivityBar active="settings" onChange={() => {}} />);
    const settingsBtn = screen.getByLabelText('设置');
    expect(settingsBtn.getAttribute('aria-pressed')).toBe('true');
    expect(settingsBtn.tabIndex).toBe(0);
    // 此时 explorer 应是非激活
    expect(screen.getByLabelText('资源管理器').tabIndex).toBe(-1);
  });

  it('品牌标按钮 aria-label="返回项目仪表盘"、type="button"', () => {
    render(<ActivityBar active="explorer" onChange={() => {}} />);
    const homeBtn = screen.getByLabelText('返回项目仪表盘') as HTMLButtonElement;
    expect(homeBtn).toBeTruthy();
    expect(homeBtn.type).toBe('button');
    expect(homeBtn.title).toBe('返回项目仪表盘');
  });
});

describe('ActivityBar 点击切换（P7.3 回归）', () => {
  it('点击非激活按钮调用 onChange 并切换 active', () => {
    const onChange = vi.fn();
    render(<ActivityBar active="explorer" onChange={onChange} />);
    fireEvent.click(screen.getByLabelText('物品/配方'));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('items');
  });

  it('点击设置按钮调用 onChange("settings")', () => {
    const onChange = vi.fn();
    render(<ActivityBar active="explorer" onChange={onChange} />);
    fireEvent.click(screen.getByLabelText('设置'));
    expect(onChange).toHaveBeenCalledWith('settings');
  });

  it('点击品牌标按钮调用 onHome 回调', () => {
    const onHome = vi.fn();
    render(<ActivityBar active="explorer" onChange={() => {}} onHome={onHome} />);
    fireEvent.click(screen.getByLabelText('返回项目仪表盘'));
    expect(onHome).toHaveBeenCalledTimes(1);
  });

  it('未提供 onHome 时点击品牌标不报错', () => {
    render(<ActivityBar active="explorer" onChange={() => {}} />);
    expect(() => {
      fireEvent.click(screen.getByLabelText('返回项目仪表盘'));
    }).not.toThrow();
  });
});

describe('ActivityBar 键盘导航（WAI-ARIA Toolbar 模式）', () => {
  it('ArrowDown 切换到下一个活动', () => {
    const onChange = vi.fn();
    render(<ActivityBar active="explorer" onChange={onChange} />);
    const explorerBtn = screen.getByLabelText('资源管理器');
    fireEvent.keyDown(explorerBtn, { key: 'ArrowDown' });
    expect(onChange).toHaveBeenCalledWith('search');
  });

  it('ArrowUp 切换到上一个活动', () => {
    const onChange = vi.fn();
    render(<ActivityBar active="search" onChange={onChange} />);
    const searchBtn = screen.getByLabelText('搜索');
    fireEvent.keyDown(searchBtn, { key: 'ArrowUp' });
    expect(onChange).toHaveBeenCalledWith('explorer');
  });

  it('ArrowUp 在第一个活动时循环到最后一个（game）', () => {
    const onChange = vi.fn();
    render(<ActivityBar active="explorer" onChange={onChange} />);
    const explorerBtn = screen.getByLabelText('资源管理器');
    fireEvent.keyDown(explorerBtn, { key: 'ArrowUp' });
    expect(onChange).toHaveBeenCalledWith('game');
  });

  it('ArrowDown 在最后一个活动时循环到第一个（explorer）', () => {
    const onChange = vi.fn();
    render(<ActivityBar active="game" onChange={onChange} />);
    const gameBtn = screen.getByLabelText('游戏启动器');
    fireEvent.keyDown(gameBtn, { key: 'ArrowDown' });
    expect(onChange).toHaveBeenCalledWith('explorer');
  });

  it('Home 键跳到第一个活动（explorer）', () => {
    const onChange = vi.fn();
    render(<ActivityBar active="items" onChange={onChange} />);
    const itemsBtn = screen.getByLabelText('物品/配方');
    fireEvent.keyDown(itemsBtn, { key: 'Home' });
    expect(onChange).toHaveBeenCalledWith('explorer');
  });

  it('End 键跳到最后一个活动（game）', () => {
    const onChange = vi.fn();
    render(<ActivityBar active="explorer" onChange={onChange} />);
    const explorerBtn = screen.getByLabelText('资源管理器');
    fireEvent.keyDown(explorerBtn, { key: 'End' });
    expect(onChange).toHaveBeenCalledWith('game');
  });

  it('ArrowDown 切换后焦点移动到新激活按钮（requestAnimationFrame 回调）', () => {
    render(<ActivityBar active="explorer" onChange={() => {}} />);
    const explorerBtn = screen.getByLabelText('资源管理器');
    explorerBtn.focus();
    expect(document.activeElement).toBe(explorerBtn);
    // 触发 ArrowDown，由于 onChange 是 no-op，active 不会真的切换，
    // 但 handleKeyDown 会尝试 querySelector('[data-activity="search"]') 并 focus 它
    fireEvent.keyDown(explorerBtn, { key: 'ArrowDown' });
    const searchBtn = screen.getByLabelText('搜索');
    expect(document.activeElement).toBe(searchBtn);
  });

  it('End 键切换后焦点移动到最后一个按钮', () => {
    render(<ActivityBar active="explorer" onChange={() => {}} />);
    const explorerBtn = screen.getByLabelText('资源管理器');
    explorerBtn.focus();
    fireEvent.keyDown(explorerBtn, { key: 'End' });
    const gameBtn = screen.getByLabelText('游戏启动器');
    expect(document.activeElement).toBe(gameBtn);
  });

  it('Home 键切换后焦点移动到第一个按钮', () => {
    render(<ActivityBar active="cicd" onChange={() => {}} />);
    const cicdBtn = screen.getByLabelText('CI/CD');
    cicdBtn.focus();
    fireEvent.keyDown(cicdBtn, { key: 'Home' });
    const explorerBtn = screen.getByLabelText('资源管理器');
    expect(document.activeElement).toBe(explorerBtn);
  });

  it('其它键（如 Tab/Enter/Space）不触发 onChange', () => {
    const onChange = vi.fn();
    render(<ActivityBar active="explorer" onChange={onChange} />);
    const explorerBtn = screen.getByLabelText('资源管理器');
    fireEvent.keyDown(explorerBtn, { key: 'Tab' });
    fireEvent.keyDown(explorerBtn, { key: 'Enter' });
    fireEvent.keyDown(explorerBtn, { key: ' ' });
    fireEvent.keyDown(explorerBtn, { key: 'ArrowLeft' });
    fireEvent.keyDown(explorerBtn, { key: 'ArrowRight' });
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('ActivityBar tooltip', () => {
  it('hover 按钮时显示 role="tooltip" 的浮层', () => {
    render(<ActivityBar active="explorer" onChange={() => {}} />);
    const searchBtn = screen.getByLabelText('搜索');
    fireEvent.mouseEnter(searchBtn);
    const tooltip = searchBtn.querySelector('.mc-pop[role="tooltip"]');
    expect(tooltip).toBeTruthy();
    expect(tooltip?.textContent).toBe('搜索');
  });

  it('鼠标离开后 tooltip 消失', () => {
    render(<ActivityBar active="explorer" onChange={() => {}} />);
    const searchBtn = screen.getByLabelText('搜索');
    fireEvent.mouseEnter(searchBtn);
    expect(searchBtn.querySelector('.mc-pop[role="tooltip"]')).toBeTruthy();
    fireEvent.mouseLeave(searchBtn);
    expect(searchBtn.querySelector('.mc-pop[role="tooltip"]')).toBeNull();
  });

  it('激活按钮 hover 时也显示 tooltip', () => {
    render(<ActivityBar active="explorer" onChange={() => {}} />);
    const explorerBtn = screen.getByLabelText('资源管理器');
    fireEvent.mouseEnter(explorerBtn);
    const tooltip = explorerBtn.querySelector('.mc-pop[role="tooltip"]');
    expect(tooltip).toBeTruthy();
    expect(tooltip?.textContent).toBe('资源管理器');
  });
});

// === 工具函数 ===

/** activity id -> 中文 label 映射（与 ActivityBar.tsx 中 activities 数组保持同步） */
function labelFor(id: string): string {
  const map: Record<string, string> = {
    explorer: '资源管理器',
    search: '搜索',
    git: '源代码管理',
    packages: '包管理',
    items: '物品/配方',
    blocks: '方块编辑',
    mc: 'MC 启动器',
    entity: '实体 AI',
    audio: '音效管理',
    cicd: 'CI/CD',
    game: '游戏启动器',
    settings: '设置',
  };
  return map[id] ?? '';
}
