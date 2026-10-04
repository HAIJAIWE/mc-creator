import { describe, expect, it } from 'vitest';
import {
  DEFAULT_THEME,
  MC_COLORS,
  MC_EASE,
  MC_FONTS,
  MC_RADIUS,
  MC_SHADOWS,
  THEMES,
  THEME_NAMES,
  TONE_COLOR_VAR,
  colorVar,
  hex,
  rgbVar,
  type McColorToken,
} from './index';

/**
 * 这些测试锁的是「TS 侧 token 镜像不能与 index.css 漂移」的形状。
 * 真正逐字对齐 index.css 靠人工评审（值写错了这里也发现不了），
 * 但**形状**（键数、值格式、命名规则）能挡住绝大多数手误。
 */
describe('theme · 颜色 token', () => {
  it('恰好 16 个颜色 token', () => {
    expect(Object.keys(MC_COLORS)).toHaveLength(16);
  });

  it('键名集合与 index.css 的 :root 一致', () => {
    expect(Object.keys(MC_COLORS).sort()).toEqual(
      [
        'accent',
        'accent-bright',
        'accent-deep',
        'bg',
        'border',
        'border-strong',
        'gold',
        'gold-deep',
        'redstone',
        'redstone-deep',
        'surface',
        'surface-2',
        'surface-3',
        'text',
        'text-dim',
        'text-mute',
      ].sort(),
    );
  });

  it('每个值都是 "R G B" 三元组', () => {
    for (const [key, value] of Object.entries(MC_COLORS)) {
      expect(value, `${key} 必须是 RGB 三元组`).toMatch(/^\d{1,3} \d{1,3} \d{1,3}$/);
    }
  });

  it('每个分量的取值在 0..255', () => {
    for (const [key, value] of Object.entries(MC_COLORS)) {
      for (const part of value.split(' ')) {
        const n = Number(part);
        expect(Number.isInteger(n), `${key} 的 ${part} 必须是整数`).toBe(true);
        expect(n, `${key} 的 ${part} 越界`).toBeGreaterThanOrEqual(0);
        expect(n, `${key} 的 ${part} 越界`).toBeLessThanOrEqual(255);
      }
    }
  });

  it('草绿品牌色与 index.css 一致（#6AB04C）', () => {
    expect(MC_COLORS.accent).toBe('106 176 76');
    expect(hex('accent')).toBe('#6ab04c');
  });

  it('底色与面板色与 index.css 一致', () => {
    expect(hex('bg')).toBe('#14130f');
    expect(hex('surface')).toBe('#1c1a15');
    expect(hex('text')).toBe('#ece8da');
  });
});

describe('theme · colorVar', () => {
  it('单段 token 拼出 --mc-<token>', () => {
    expect(colorVar('accent')).toBe('--mc-accent');
    expect(colorVar('bg')).toBe('--mc-bg');
  });

  it('带连字符的 token 也能正确拼接', () => {
    expect(colorVar('surface-2')).toBe('--mc-surface-2');
    expect(colorVar('accent-bright')).toBe('--mc-accent-bright');
  });

  it('覆盖全部 16 个 token（keyof 约束生效）', () => {
    const all: McColorToken[] = [
      'bg',
      'surface',
      'surface-2',
      'surface-3',
      'border',
      'border-strong',
      'text',
      'text-dim',
      'text-mute',
      'accent',
      'accent-bright',
      'accent-deep',
      'gold',
      'gold-deep',
      'redstone',
      'redstone-deep',
    ];
    for (const token of all) {
      expect(colorVar(token)).toBe(`--mc-${token}`);
    }
  });
});

describe('theme · rgbVar', () => {
  it('省略 alpha 时输出不透明写法', () => {
    expect(rgbVar('--mc-accent')).toBe('rgb(var(--mc-accent))');
  });

  it('带 alpha 时输出空格分隔的斜杠写法（与 index.css 同形）', () => {
    expect(rgbVar('--mc-accent', 0.18)).toBe('rgb(var(--mc-accent) / 0.18)');
  });

  it('alpha=0 输出显式 0（透明）', () => {
    expect(rgbVar('--mc-gold', 0)).toBe('rgb(var(--mc-gold) / 0)');
  });

  it('alpha=1 输出显式 1（不透明）', () => {
    expect(rgbVar('--mc-redstone', 1)).toBe('rgb(var(--mc-redstone) / 1)');
  });

  it('引用 CSS 变量而非 RGB 三元组（换肤才不会脱钩）', () => {
    expect(rgbVar('--mc-accent', 0.5)).not.toContain(MC_COLORS.accent);
    expect(rgbVar('--mc-accent', 0.5)).toContain('var(--mc-accent)');
  });

  it('非法 alpha（<0）抛 RangeError —— 选择抛错而非静默 clamp', () => {
    expect(() => rgbVar('--mc-accent', -0.1)).toThrow(RangeError);
  });

  it('非法 alpha（>1）抛 RangeError', () => {
    expect(() => rgbVar('--mc-accent', 1.1)).toThrow(RangeError);
  });

  it('NaN alpha 抛 RangeError', () => {
    expect(() => rgbVar('--mc-accent', Number.NaN)).toThrow(RangeError);
  });

  it('Infinity alpha 抛 RangeError', () => {
    expect(() => rgbVar('--mc-accent', Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });

  it('RangeError 的消息里带上出错值，便于定位', () => {
    expect(() => rgbVar('--mc-accent', 2)).toThrow(/2/);
  });

  it('变量名未以 -- 开头抛 TypeError', () => {
    expect(() => rgbVar('mc-accent')).toThrow(TypeError);
  });

  it('空变量名抛 TypeError', () => {
    expect(() => rgbVar('')).toThrow(TypeError);
  });

  it('变量名校验先于 alpha 校验', () => {
    expect(() => rgbVar('bad', 0.5)).toThrow(TypeError);
  });
});

describe('theme · 形状 / 动效 / 字体', () => {
  it('圆角是小圆角（方块感），与 index.css 一致', () => {
    expect(MC_RADIUS.sm).toBe('3px');
    expect(MC_RADIUS.lg).toBe('6px');
  });

  it('动效是指数缓出', () => {
    expect(MC_EASE).toBe('cubic-bezier(0.22, 1, 0.36, 1)');
  });

  it('display 字体是 Pixelify Sans', () => {
    expect(MC_FONTS.display).toContain('Pixelify Sans');
  });

  it('body 字体以 system-ui 开头', () => {
    expect(MC_FONTS.body.startsWith('system-ui')).toBe(true);
  });

  it('mono 字体优先 Monocraft 并回退 VT323', () => {
    expect(MC_FONTS.mono).toContain('Monocraft');
    expect(MC_FONTS.mono).toContain('VT323');
  });

  it('立体阴影 token 齐备（凸起方块的四个组成部分）', () => {
    expect(MC_SHADOWS.block).toContain('--mc-bevel-top');
    expect(MC_SHADOWS.block).toContain('--mc-bevel-bottom');
    expect(MC_SHADOWS.block).toContain('--mc-lift');
  });
});

describe('theme · 语义色映射', () => {
  it('三个语义色各自映射到对应 CSS 变量', () => {
    expect(TONE_COLOR_VAR.accent).toBe('--mc-accent');
    expect(TONE_COLOR_VAR.gold).toBe('--mc-gold');
    expect(TONE_COLOR_VAR.redstone).toBe('--mc-redstone');
  });
});

describe('theme · 主题预设', () => {
  it('至少两个主题', () => {
    expect(THEME_NAMES.length).toBeGreaterThanOrEqual(2);
  });

  it('craft-dark 是默认主题', () => {
    expect(DEFAULT_THEME).toBe('craft-dark');
    expect(THEME_NAMES[0]).toBe(DEFAULT_THEME);
  });

  it('THEMES 覆盖 THEME_NAMES 里的每个主题', () => {
    for (const name of THEME_NAMES) {
      expect(THEMES[name], `${name} 未定义`).toBeDefined();
    }
  });

  it('craft-dark 的 accent 与 index.css 默认值逐字一致', () => {
    expect(THEMES['craft-dark']['--mc-accent']).toBe(MC_COLORS.accent);
    expect(THEMES['craft-dark']['--mc-accent-bright']).toBe(MC_COLORS['accent-bright']);
    expect(THEMES['craft-dark']['--mc-accent-deep']).toBe(MC_COLORS['accent-deep']);
  });

  it('每个主题都覆盖完整的 accent 三元组（否则会出现半新半旧的配色）', () => {
    for (const name of THEME_NAMES) {
      const vars = THEMES[name];
      expect(vars['--mc-accent'], `${name} 缺 --mc-accent`).toBeTruthy();
      expect(vars['--mc-accent-bright'], `${name} 缺 --mc-accent-bright`).toBeTruthy();
      expect(vars['--mc-accent-deep'], `${name} 缺 --mc-accent-deep`).toBeTruthy();
    }
  });

  it('各主题 accent 互不相同（换肤必须一眼可辨）', () => {
    const accents = THEME_NAMES.map((name) => THEMES[name]['--mc-accent']);
    expect(new Set(accents).size).toBe(accents.length);
  });

  it('主题只覆盖 CSS 变量（键以 --mc- 开头），不含裸属性名', () => {
    for (const name of THEME_NAMES) {
      for (const key of Object.keys(THEMES[name])) {
        expect(key.startsWith('--mc-'), `${name} 的 ${key} 不是 CSS 变量名`).toBe(true);
      }
    }
  });

  it('主题值都是合法 RGB 三元组（可直接喂给 setProperty）', () => {
    for (const name of THEME_NAMES) {
      for (const value of Object.values(THEMES[name])) {
        expect(value).toMatch(/^\d{1,3} \d{1,3} \d{1,3}$/);
      }
    }
  });
});
