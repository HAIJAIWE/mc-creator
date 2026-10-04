import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import {
  DEFAULT_THEME,
  THEMES,
  applyTheme,
  getAvailableThemes,
  getServerThemeSnapshot,
  getTheme,
  getThemeSnapshot,
  setTheme,
  subscribeThemeChange,
  useTheme,
} from './useTheme';
import type { ThemeName } from '../theme/index';

/**
 * store 是模块级单例（与 i18n 的 currentLocale 同构），所以每个用例
 * 前后都要把主题拨回默认值，否则会串味。
 *
 * 重置必须包在 act() 里：若此时还有上一轮 render 出来的探针组件挂着，
 * setTheme 会同步通知订阅者并触发重渲染 —— 不包 act 就是 React 的
 * "not wrapped in act(...)" 警告。
 */
beforeEach(() => {
  setTheme(DEFAULT_THEME);
});

afterEach(() => {
  act(() => setTheme(DEFAULT_THEME));
});

describe('useTheme · store 读取', () => {
  it('默认主题是 craft-dark', () => {
    expect(getTheme()).toBe('craft-dark');
  });

  it('getThemeSnapshot 与 getTheme 同源（供 useSyncExternalStore 使用）', () => {
    expect(getThemeSnapshot()).toBe(getTheme());
  });

  it('getServerThemeSnapshot 返回默认主题（SSR 首帧一致性）', () => {
    expect(getServerThemeSnapshot()).toBe(DEFAULT_THEME);
  });

  it('getAvailableThemes 返回全部主题名', () => {
    const available = getAvailableThemes();
    expect(available).toHaveLength(Object.keys(THEMES).length);
    expect(available).toContain('craft-dark');
  });
});

describe('useTheme · setTheme 写 CSS 变量', () => {
  it('setTheme 后 store 值改变', () => {
    act(() => setTheme('nether-ember'));
    expect(getTheme()).toBe('nether-ember');
  });

  it('setTheme 真的把 CSS 变量写进 document.documentElement.style', () => {
    act(() => setTheme('nether-ember'));
    const inline = document.documentElement.style;
    expect(inline.getPropertyValue('--mc-accent')).toBe(THEMES['nether-ember']['--mc-accent']);
  });

  it('三个 accent 变量全部被改写（不会出现半新半旧配色）', () => {
    act(() => setTheme('ender-night'));
    const inline = document.documentElement.style;
    expect(inline.getPropertyValue('--mc-accent')).toBe(THEMES['ender-night']['--mc-accent']);
    expect(inline.getPropertyValue('--mc-accent-bright')).toBe(
      THEMES['ender-night']['--mc-accent-bright'],
    );
    expect(inline.getPropertyValue('--mc-accent-deep')).toBe(
      THEMES['ender-night']['--mc-accent-deep'],
    );
  });

  it('切回 craft-dark 会把默认值写回（可逆）', () => {
    act(() => setTheme('nether-ember'));
    act(() => setTheme('craft-dark'));
    expect(document.documentElement.style.getPropertyValue('--mc-accent')).toBe(
      THEMES['craft-dark']['--mc-accent'],
    );
  });

  it('未知主题名不崩（变量保持原样，store 仍被更新）', () => {
    act(() => setTheme('nether-ember'));
    const before = document.documentElement.style.getPropertyValue('--mc-accent');
    act(() => setTheme('no-such-theme' as ThemeName));
    expect(document.documentElement.style.getPropertyValue('--mc-accent')).toBe(before);
  });
});

describe('useTheme · applyTheme 可注入 document', () => {
  it('写到注入的 document，而不是全局 document', () => {
    // 先清空全局的 inline 变量，才能断言「没被动过」
    document.documentElement.style.removeProperty('--mc-accent');
    const setProperty = vi.fn();
    const fakeDoc = { documentElement: { style: { setProperty } } } as unknown as Document;

    applyTheme('nether-ember', fakeDoc);

    expect(setProperty).toHaveBeenCalledWith('--mc-accent', THEMES['nether-ember']['--mc-accent']);
    // 全局 document 不应被动到
    expect(document.documentElement.style.getPropertyValue('--mc-accent')).toBe('');
  });

  it('注入的 document 上按 accent 三元组写入三次', () => {
    const setProperty = vi.fn();
    const fakeDoc = { documentElement: { style: { setProperty } } } as unknown as Document;
    applyTheme('craft-dark', fakeDoc);
    expect(setProperty).toHaveBeenCalledTimes(3);
  });

  it('未知主题名在注入 document 上不写入任何变量', () => {
    const setProperty = vi.fn();
    const fakeDoc = { documentElement: { style: { setProperty } } } as unknown as Document;
    applyTheme('no-such-theme' as ThemeName, fakeDoc);
    expect(setProperty).not.toHaveBeenCalled();
  });
});

describe('useTheme · 订阅机制', () => {
  it('主题变化时通知订阅者', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeThemeChange(listener);

    act(() => setTheme('nether-ember'));

    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it('重复设置同一主题不通知（避免无谓重渲染）', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeThemeChange(listener);

    act(() => setTheme('craft-dark'));

    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });

  it('取消订阅后不再收到通知', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeThemeChange(listener);
    unsubscribe();

    act(() => setTheme('ender-night'));

    expect(listener).not.toHaveBeenCalled();
  });

  it('多个订阅者都会被通知', () => {
    const a = vi.fn();
    const b = vi.fn();
    const unA = subscribeThemeChange(a);
    const unB = subscribeThemeChange(b);

    act(() => setTheme('nether-ember'));

    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
    unA();
    unB();
  });

  it('订阅函数返回的 unsubscribe 幂等（重复调用不报错）', () => {
    const unsubscribe = subscribeThemeChange(() => {});
    unsubscribe();
    expect(() => unsubscribe()).not.toThrow();
  });
});

describe('useTheme · SSR（无 DOM 环境）', () => {
  /**
   * 用 `vi.stubGlobal('document', undefined)` 模拟 SSR：`typeof document`
   * 对「变量值为 undefined」同样返回 'undefined'，所以守卫会生效。
   * 换肤是纯副作用，没有 DOM 时必须静默跳过，不能让 SSR 渲染失败。
   *
   * 注：`useTheme` 的**挂载**副作用（applyTheme）在无 DOM 下也安全，但这条
   * 路径无法在本套件里验证 —— RTL 的 `render()` 自己就依赖 `document.body`，
   * jsdom 环境下没有真正的无 DOM 渲染器（renderToString 又不执行 effect）。
   * 挂载路径改由非 SSR 用例「挂载时补一次 applyTheme」覆盖。
   */
  it('无 document 时 applyTheme 静默跳过不抛错', () => {
    vi.stubGlobal('document', undefined);
    try {
      expect(() => applyTheme('nether-ember')).not.toThrow();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('无 document 时 setTheme 仍更新 store（状态与副作用解耦）', () => {
    vi.stubGlobal('document', undefined);
    try {
      act(() => setTheme('ender-night'));
      expect(getTheme()).toBe('ender-night');
    } finally {
      act(() => setTheme(DEFAULT_THEME));
      vi.unstubAllGlobals();
    }
  });

  it('无 document 时 applyTheme 仍通知订阅者', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeThemeChange(listener);
    vi.stubGlobal('document', undefined);
    try {
      act(() => setTheme('nether-ember'));
      expect(listener).toHaveBeenCalledTimes(1);
    } finally {
      unsubscribe();
      vi.unstubAllGlobals();
    }
  });

  it('恢复 document 后功能正常（stub 未污染全局）', () => {
    expect(typeof document).toBe('object');
    act(() => setTheme('nether-ember'));
    expect(document.documentElement.style.getPropertyValue('--mc-accent')).toBe(
      THEMES['nether-ember']['--mc-accent'],
    );
  });
});

/** 测试探针：在 React 里消费 useTheme */
function ThemeProbe() {
  const { theme, setTheme: change, themeNames, themes } = useTheme();
  return (
    <div>
      <span data-testid="theme">{theme}</span>
      <span data-testid="theme-count">{themeNames.length}</span>
      <span data-testid="themes-keys">{Object.keys(themes).join(',')}</span>
      <button type="button" onClick={() => change('ender-night')}>
        换肤
      </button>
    </div>
  );
}

describe('useTheme · hook', () => {
  it('返回当前主题', () => {
    act(() => setTheme('nether-ember'));
    render(<ThemeProbe />);
    expect(screen.getByTestId('theme')).toHaveTextContent('nether-ember');
  });

  it('外部 setTheme 触发 hook 重渲染（useSyncExternalStore 生效）', () => {
    render(<ThemeProbe />);
    expect(screen.getByTestId('theme')).toHaveTextContent('craft-dark');

    act(() => setTheme('ender-night'));

    expect(screen.getByTestId('theme')).toHaveTextContent('ender-night');
  });

  it('hook 里的 setTheme 既改 store 也写 CSS 变量', () => {
    render(<ThemeProbe />);

    act(() => {
      screen.getByRole('button', { name: '换肤' }).click();
    });

    expect(getTheme()).toBe('ender-night');
    expect(document.documentElement.style.getPropertyValue('--mc-accent')).toBe(
      THEMES['ender-night']['--mc-accent'],
    );
    expect(screen.getByTestId('theme')).toHaveTextContent('ender-night');
  });

  it('返回主题定义表与主题名列表', () => {
    render(<ThemeProbe />);
    expect(screen.getByTestId('theme-count')).toHaveTextContent('3');
    expect(screen.getByTestId('themes-keys')).toHaveTextContent(
      'craft-dark,nether-ember,ender-night',
    );
  });

  it('挂载时补一次 applyTheme，让 DOM 与 store 对齐', () => {
    // 直接改 store 但不写 DOM（模拟绕过 hook 的调用路径）
    act(() => setTheme('nether-ember'));
    document.documentElement.style.removeProperty('--mc-accent');

    render(<ThemeProbe />);

    expect(document.documentElement.style.getPropertyValue('--mc-accent')).toBe(
      THEMES['nether-ember']['--mc-accent'],
    );
  });
});
