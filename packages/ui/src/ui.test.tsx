import { describe, expect, it } from 'vitest';
import * as ui from './index';

/**
 * 公共 API 出口测试。
 *
 * 这个文件的作用是「锁住包的对外契约」：desktop 侧后续替换组件
 * （§5.4）时会直接 `import { X } from '@mc-creator/ui'`，
 * 一旦有人顺手改名/删导出，这里立刻红，而不是等到 desktop 编译失败。
 */
describe('@mc-creator/ui · 入口可加载', () => {
  it('入口模块非空', async () => {
    const mod = await import('./index');
    expect(mod).toBeDefined();
  });
});

describe('@mc-creator/ui · 组件出口', () => {
  /**
   * forwardRef 组件（Button / Input）在运行时是 `{ $$typeof, render }` 对象而
   * 非函数，所以这里只断言「是可渲染组件」而不硬编码 typeof ——
   * 否则每次有人把普通函数组件改成 forwardRef（或反过来）都会假红。
   */
  const COMPONENTS: Record<string, unknown> = {
    Button: ui.Button,
    Card: ui.Card,
    Dropdown: ui.Dropdown,
    Input: ui.Input,
    Modal: ui.Modal,
    Progress: ui.Progress,
    Tabs: ui.Tabs,
    Toast: ui.Toast,
    ToastProvider: ui.ToastProvider,
    Tooltip: ui.Tooltip,
  };

  it('导出全部 9 个组件 + ToastProvider', () => {
    expect(Object.keys(COMPONENTS)).toHaveLength(10);
    for (const [name, comp] of Object.entries(COMPONENTS)) {
      expect(comp, `${name} 未导出`).toBeDefined();
      const renderable =
        typeof comp === 'function' ||
        (typeof comp === 'object' && comp !== null && 'render' in comp);
      expect(renderable, `${name} 既不是函数也不是 forwardRef 对象`).toBe(true);
    }
  });

  it('forwardRef 组件带有 displayName（React DevTools 可辨识）', () => {
    expect((ui.Button as { displayName?: string }).displayName).toBe('Button');
    expect((ui.Input as { displayName?: string }).displayName).toBe('Input');
  });

  it('导出 useToast', () => {
    expect(ui.useToast).toBeTypeOf('function');
  });

  it('导出辅助函数 getFocusableElements / clampProgress / tooltipPlacementClass', () => {
    expect(ui.getFocusableElements).toBeTypeOf('function');
    expect(ui.clampProgress).toBeTypeOf('function');
    expect(ui.tooltipPlacementClass).toBeTypeOf('function');
  });
});

describe('@mc-creator/ui · hook 出口', () => {
  it('导出 useTheme', () => {
    expect(ui.useTheme).toBeTypeOf('function');
  });

  it('导出主题 store 的读写函数', () => {
    expect(ui.getTheme).toBeTypeOf('function');
    expect(ui.getThemeSnapshot).toBeTypeOf('function');
    expect(ui.getServerThemeSnapshot).toBeTypeOf('function');
    expect(ui.setTheme).toBeTypeOf('function');
    expect(ui.subscribeThemeChange).toBeTypeOf('function');
    expect(ui.applyTheme).toBeTypeOf('function');
    expect(ui.getAvailableThemes).toBeTypeOf('function');
  });

  it('导出主题常量', () => {
    expect(ui.DEFAULT_THEME).toBe('craft-dark');
    expect(ui.THEME_NAMES.length).toBeGreaterThanOrEqual(2);
    expect(Object.keys(ui.THEMES)).toHaveLength(ui.THEME_NAMES.length);
  });
});

describe('@mc-creator/ui · 设计 token 出口', () => {
  it('导出 token 常量', () => {
    expect(Object.keys(ui.MC_COLORS)).toHaveLength(16);
    expect(ui.MC_RADIUS).toBeDefined();
    expect(ui.MC_FONTS).toBeDefined();
    expect(ui.MC_EASE).toBeTypeOf('string');
    expect(ui.MC_SHADOWS).toBeDefined();
  });

  it('导出 rgbVar / colorVar / hex', () => {
    expect(ui.rgbVar('--mc-accent', 0.18)).toBe('rgb(var(--mc-accent) / 0.18)');
    expect(ui.colorVar('accent')).toBe('--mc-accent');
    expect(ui.hex('bg')).toBe('#14130f');
  });

  it('导出语义色映射', () => {
    expect(ui.TONE_COLOR_VAR.gold).toBe('--mc-gold');
  });
});

describe('@mc-creator/ui · 工具出口', () => {
  it('cx 拼接并过滤假值', () => {
    expect(ui.cx('a', 'b')).toBe('a b');
    expect(ui.cx('a', false, undefined, null, '', 'b')).toBe('a b');
    expect(ui.cx()).toBe('');
    expect(ui.cx(false)).toBe('');
  });
});

describe('@mc-creator/ui · 零运行时第三方依赖', () => {
  it('入口只导出本包自己的东西（不含 radix / antd / mui 之类）', () => {
    const names = Object.keys(ui);
    // 若将来引入第三方库，这个断言会提醒同步更新文档与 package.json
    expect(names.length).toBeGreaterThan(20);
    for (const name of names) {
      expect(name, `${name} 不应是外部依赖命名`).not.toMatch(/^(MUI|Ant|AntD|Radix)/);
    }
  });
});
