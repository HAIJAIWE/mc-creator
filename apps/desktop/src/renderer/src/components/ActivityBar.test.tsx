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
 *
 * 注意：新架构下 shell 面板仅包含 5 个基础设施面板：
 * explorer, search, git, packages, settings
 * 领域编辑器面板已迁移到中部编辑器标签页
 */

// Shell 面板 ID（基础设施面板）
const SHELL_PANEL_IDS = ['explorer', 'search', 'git', 'packages', 'settings'] as const;

// 中文标签映射
const LABEL_MAP: Record<string, string> = {
  explorer: '资源管理器',
  search: '搜索',
  git: '源代码管理',
  packages: '包管理',
  settings: '设置',
  backToDashboard: '返回项目仪表盘',
};

// Mock useTranslation hook BEFORE importing ActivityBar
vi.mock('../hooks/useTranslation.js', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      if (key.startsWith('activityBar.')) {
        const id = key.replace('activityBar.', '');
        return LABEL_MAP[id] || key;
      }
      if (key.startsWith('settings.')) {
        return key;
      }
      return key;
    },
    tCommon: (key: string) => LABEL_MAP[key] || key,
    locale: 'zh',
  }),
}));

// Mock the panel registry to return shell panels
vi.mock('../shell/panels.js', async (importOriginal) => {
  const original = (await importOriginal()) as typeof import('../shell/panels.js');
  const React = await import('react');
  const MockIcon = () => React.createElement('span', { 'data-testid': 'mock-icon' });
  return {
    ...original,
    getShellPanels: () => [
      {
        id: 'explorer',
        icon: React.createElement(MockIcon),
        title: LABEL_MAP.explorer,
        order: 10,
        kind: 'shell' as const,
        enabled: true,
      },
      {
        id: 'search',
        icon: React.createElement(MockIcon),
        title: LABEL_MAP.search,
        order: 20,
        kind: 'shell' as const,
        enabled: true,
      },
      {
        id: 'git',
        icon: React.createElement(MockIcon),
        title: LABEL_MAP.git,
        order: 30,
        kind: 'shell' as const,
        enabled: true,
      },
      {
        id: 'packages',
        icon: React.createElement(MockIcon),
        title: LABEL_MAP.packages,
        order: 40,
        kind: 'shell' as const,
        enabled: true,
      },
      {
        id: 'settings',
        icon: React.createElement(MockIcon),
        title: LABEL_MAP.settings,
        order: 999,
        kind: 'shell' as const,
        enabled: true,
      },
    ],
  };
});

beforeEach(() => {
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = vi.fn();
  }
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
    render(<ActivityBar leftCollapsed={false} activePanel="items" onChange={() => {}} />);
    const toolbar = screen.getByRole('toolbar', { name: '活动栏' });
    expect(toolbar).toBeTruthy();
    expect(toolbar.getAttribute('aria-orientation')).toBe('vertical');
  });

  it('渲染 4 个活动按钮 + 1 个设置按钮 + 1 个品牌标按钮 = 6 个 button', () => {
    render(<ActivityBar leftCollapsed={false} activePanel="items" onChange={() => {}} />);
    const buttons = screen.getAllByRole('button');
    expect(buttons.length).toBe(6);
  });

  it('每个 shell 面板按钮都有 type="button"（防止表单提交）', () => {
    render(<ActivityBar leftCollapsed={false} activePanel="items" onChange={() => {}} />);
    for (const id of SHELL_PANEL_IDS) {
      const btn = screen.getByLabelText(LABEL_MAP[id]) as HTMLButtonElement;
      expect(btn.type).toBe('button');
    }
  });

  it('每个 shell 面板按钮都有 aria-label 和 title 属性', () => {
    render(<ActivityBar leftCollapsed={false} activePanel="items" onChange={() => {}} />);
    for (const id of SHELL_PANEL_IDS) {
      const label = LABEL_MAP[id];
      const btn = screen.getByLabelText(label);
      expect(btn.getAttribute('aria-label')).toBe(label);
      expect(btn.title).toBe(label);
    }
  });

  it('激活按钮 aria-pressed=true、tabIndex=0', () => {
    render(<ActivityBar leftCollapsed={false} activePanel="search" onChange={() => {}} />);
    const searchBtn = screen.getByLabelText(LABEL_MAP.search);
    expect(searchBtn.getAttribute('aria-pressed')).toBe('true');
    expect(searchBtn.tabIndex).toBe(0);
  });

  it('非激活按钮 aria-pressed=false、tabIndex=-1（Roving Tabindex）', () => {
    render(<ActivityBar leftCollapsed={false} activePanel="items" onChange={() => {}} />);
    for (const id of ['search', 'git', 'packages'] as const) {
      const btn = screen.getByLabelText(LABEL_MAP[id]);
      expect(btn.getAttribute('aria-pressed')).toBe('false');
      expect(btn.tabIndex).toBe(-1);
    }
  });

  it('激活按钮含装饰条 .mc-active-bar，且 aria-hidden="true"', () => {
    render(<ActivityBar leftCollapsed={false} activePanel="items" onChange={() => {}} />);
    const explorerBtn = screen.getByLabelText(LABEL_MAP.explorer);
    const activeBar = explorerBtn.querySelector('.mc-active-bar');
    expect(activeBar).toBeTruthy();
    expect(activeBar?.getAttribute('aria-hidden')).toBe('true');
  });

  it('非激活按钮不含 .mc-active-bar', () => {
    render(<ActivityBar leftCollapsed={false} activePanel="items" onChange={() => {}} />);
    const searchBtn = screen.getByLabelText(LABEL_MAP.search);
    expect(searchBtn.querySelector('.mc-active-bar')).toBeNull();
  });

  it('设置按钮（settings）data-activity="settings"', () => {
    render(<ActivityBar leftCollapsed={false} activePanel="items" onChange={() => {}} />);
    const settingsBtn = screen.getByLabelText(LABEL_MAP.settings);
    expect(settingsBtn.getAttribute('data-activity')).toBe('settings');
    expect(settingsBtn.getAttribute('aria-pressed')).toBe('false');
    expect(settingsBtn.tabIndex).toBe(-1);
  });

  it('设置按钮激活时 aria-pressed=true、tabIndex=0', () => {
    render(<ActivityBar leftCollapsed={false} activePanel="settings" onChange={() => {}} />);
    const settingsBtn = screen.getByLabelText(LABEL_MAP.settings);
    expect(settingsBtn.getAttribute('aria-pressed')).toBe('true');
    expect(settingsBtn.tabIndex).toBe(0);
    expect(screen.getByLabelText(LABEL_MAP.explorer).tabIndex).toBe(-1);
  });

  it('品牌标按钮 aria-label="返回项目仪表盘"、type="button"', () => {
    render(<ActivityBar leftCollapsed={false} activePanel="items" onChange={() => {}} />);
    const homeBtn = screen.getByLabelText(LABEL_MAP.backToDashboard) as HTMLButtonElement;
    expect(homeBtn).toBeTruthy();
    expect(homeBtn.type).toBe('button');
    expect(homeBtn.title).toBe(LABEL_MAP.backToDashboard);
  });
});

describe('ActivityBar 点击切换（P7.3 回归）', () => {
  it('点击非激活按钮调用 onChange 并切换 active', () => {
    const onChange = vi.fn();
    render(<ActivityBar leftCollapsed={false} activePanel="items" onChange={onChange} />);
    fireEvent.click(screen.getByLabelText(LABEL_MAP.search));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('search');
  });

  it('点击设置按钮调用 onChange("settings")', () => {
    const onChange = vi.fn();
    render(<ActivityBar leftCollapsed={false} activePanel="items" onChange={onChange} />);
    // 使用 aria-label 定位设置按钮
    fireEvent.click(screen.getByLabelText(LABEL_MAP.settings));
    expect(onChange).toHaveBeenCalledWith('settings');
  });

  it('点击品牌标按钮调用 onHome 回调', () => {
    const onHome = vi.fn();
    render(
      <ActivityBar leftCollapsed={false} activePanel="items" onChange={() => {}} onHome={onHome} />,
    );
    fireEvent.click(screen.getByLabelText(LABEL_MAP.backToDashboard));
    expect(onHome).toHaveBeenCalledTimes(1);
  });

  it('未提供 onHome 时点击品牌标不报错', () => {
    render(<ActivityBar leftCollapsed={false} activePanel="items" onChange={() => {}} />);
    expect(() => {
      fireEvent.click(screen.getByLabelText(LABEL_MAP.backToDashboard));
    }).not.toThrow();
  });
});

describe('ActivityBar 键盘导航（WAI-ARIA Toolbar 模式）', () => {
  it('ArrowDown 切换到下一个活动', () => {
    const onChange = vi.fn();
    render(<ActivityBar leftCollapsed={false} activePanel="items" onChange={onChange} />);
    const explorerBtn = screen.getByLabelText(LABEL_MAP.explorer);
    fireEvent.keyDown(explorerBtn, { key: 'ArrowDown' });
    expect(onChange).toHaveBeenCalledWith('search');
  });

  it('ArrowUp 切换到上一个活动', () => {
    const onChange = vi.fn();
    render(<ActivityBar leftCollapsed={false} activePanel="search" onChange={onChange} />);
    const searchBtn = screen.getByLabelText(LABEL_MAP.search);
    fireEvent.keyDown(searchBtn, { key: 'ArrowUp' });
    expect(onChange).toHaveBeenCalledWith('explorer');
  });

  it('ArrowUp 在第一个活动时循环到最后一个（settings）', () => {
    const onChange = vi.fn();
    render(<ActivityBar leftCollapsed={false} activePanel="items" onChange={onChange} />);
    const explorerBtn = screen.getByLabelText(LABEL_MAP.explorer);
    fireEvent.keyDown(explorerBtn, { key: 'ArrowUp' });
    expect(onChange).toHaveBeenCalledWith('settings');
  });

  it('ArrowDown 在最后一个活动时循环到第一个（explorer）', () => {
    const onChange = vi.fn();
    render(<ActivityBar leftCollapsed={false} activePanel="settings" onChange={onChange} />);
    const settingsBtn = screen.getByLabelText(LABEL_MAP.settings);
    fireEvent.keyDown(settingsBtn, { key: 'ArrowDown' });
    expect(onChange).toHaveBeenCalledWith('explorer');
  });

  it('Home 键跳到第一个活动（explorer）', () => {
    const onChange = vi.fn();
    render(<ActivityBar leftCollapsed={false} activePanel="packages" onChange={onChange} />);
    const packagesBtn = screen.getByLabelText(LABEL_MAP.packages);
    fireEvent.keyDown(packagesBtn, { key: 'Home' });
    expect(onChange).toHaveBeenCalledWith('explorer');
  });

  it('End 键跳到最后一个活动（settings）', () => {
    const onChange = vi.fn();
    render(<ActivityBar leftCollapsed={false} activePanel="items" onChange={onChange} />);
    const explorerBtn = screen.getByLabelText(LABEL_MAP.explorer);
    fireEvent.keyDown(explorerBtn, { key: 'End' });
    expect(onChange).toHaveBeenCalledWith('settings');
  });

  it('ArrowDown 切换后焦点移动到新激活按钮（requestAnimationFrame 回调）', () => {
    render(<ActivityBar leftCollapsed={false} activePanel="items" onChange={() => {}} />);
    const explorerBtn = screen.getByLabelText(LABEL_MAP.explorer);
    explorerBtn.focus();
    expect(document.activeElement).toBe(explorerBtn);
    fireEvent.keyDown(explorerBtn, { key: 'ArrowDown' });
    const searchBtn = screen.getByLabelText(LABEL_MAP.search);
    expect(document.activeElement).toBe(searchBtn);
  });

  it('End 键切换后焦点移动到最后一个按钮', () => {
    render(<ActivityBar leftCollapsed={false} activePanel="items" onChange={() => {}} />);
    const explorerBtn = screen.getByLabelText(LABEL_MAP.explorer);
    explorerBtn.focus();
    fireEvent.keyDown(explorerBtn, { key: 'End' });
    const settingsBtn = screen.getByLabelText(LABEL_MAP.settings);
    expect(document.activeElement).toBe(settingsBtn);
  });

  it('Home 键切换后焦点移动到第一个按钮', () => {
    render(<ActivityBar leftCollapsed={false} activePanel="settings" onChange={() => {}} />);
    const settingsBtn = screen.getByLabelText(LABEL_MAP.settings);
    settingsBtn.focus();
    fireEvent.keyDown(settingsBtn, { key: 'Home' });
    const explorerBtn = screen.getByLabelText(LABEL_MAP.explorer);
    expect(document.activeElement).toBe(explorerBtn);
  });

  it('其它键（如 Tab/Enter/Space）不触发 onChange', () => {
    const onChange = vi.fn();
    render(<ActivityBar leftCollapsed={false} activePanel="items" onChange={onChange} />);
    const explorerBtn = screen.getByLabelText(LABEL_MAP.explorer);
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
    render(<ActivityBar leftCollapsed={false} activePanel="items" onChange={() => {}} />);
    const searchBtn = screen.getByLabelText(LABEL_MAP.search);
    fireEvent.mouseEnter(searchBtn);
    const tooltip = searchBtn.querySelector('.mc-pop[role="tooltip"]');
    expect(tooltip).toBeTruthy();
    expect(tooltip?.textContent).toBe(LABEL_MAP.search);
  });

  it('鼠标离开后 tooltip 消失', () => {
    render(<ActivityBar leftCollapsed={false} activePanel="items" onChange={() => {}} />);
    const searchBtn = screen.getByLabelText(LABEL_MAP.search);
    fireEvent.mouseEnter(searchBtn);
    expect(searchBtn.querySelector('.mc-pop[role="tooltip"]')).toBeTruthy();
    fireEvent.mouseLeave(searchBtn);
    expect(searchBtn.querySelector('.mc-pop[role="tooltip"]')).toBeNull();
  });

  it('激活按钮 hover 时也显示 tooltip', () => {
    render(<ActivityBar leftCollapsed={false} activePanel="items" onChange={() => {}} />);
    const explorerBtn = screen.getByLabelText(LABEL_MAP.explorer);
    fireEvent.mouseEnter(explorerBtn);
    const tooltip = explorerBtn.querySelector('.mc-pop[role="tooltip"]');
    expect(tooltip).toBeTruthy();
    expect(tooltip?.textContent).toBe(LABEL_MAP.explorer);
  });
});
