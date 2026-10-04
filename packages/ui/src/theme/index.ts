/**
 * Craft 设计系统的 TS 侧 token 镜像（设计文档 §4.5 设计系统）。
 *
 * 为什么要有一份 TS 副本：`apps/desktop/src/renderer/src/index.css` 是
 * 样式的唯一事实来源，但有些场景无法只靠 className 表达，必须内联样式，
 * 例如 Progress 的 tone 需要 `rgb(var(--mc-gold))`、Theme 切换需要把
 * 变量值写进 `document.documentElement.style`。此时 TS 侧需要知道
 * 「gold 这个 token 的 CSS 变量名是什么、RGB 三元组是多少」。
 *
 * 维护铁律：**本文件的取值必须与 index.css 的 :root 逐字一致**。
 * 改了 CSS 就要同步改这里（theme.test.ts 会断言两者不会漂移的形状）。
 * 本包不携带任何 CSS 文件 —— 组件只输出语义 className（mc-btn-primary 等），
 * 样式由调用方引入 index.css（Tailwind `@layer components`）获得。
 */

/** 16 个颜色 token：值为 RGB 三元组（不带括号），配合 `rgb(var(--x) / a)` 使用。 */
export const MC_COLORS = {
  // 中性：暖石/泥土灰阶
  bg: '20 19 15',
  surface: '28 26 21',
  'surface-2': '36 33 24',
  'surface-3': '46 42 32',
  border: '58 53 42',
  'border-strong': '74 68 53',
  // 文字：骨白/羊皮纸
  text: '236 232 218',
  'text-dim': '182 176 152',
  'text-mute': '138 132 105',
  // 品牌强调：草绿（creeper green）
  accent: '106 176 76',
  'accent-bright': '139 195 74',
  'accent-deep': '78 138 55',
  // 语义色
  gold: '217 164 65',
  'gold-deep': '183 132 45',
  redstone: '217 83 79',
  'redstone-deep': '178 60 56',
} as const;

/** 颜色 token 名（`'surface-2'` 这类带连字符的键也包含在内）。 */
export type McColorToken = keyof typeof MC_COLORS;

/** 形状：方块感，小圆角。键名对应 Tailwind 的 `rounded-mc` / `rounded-mc-lg`。 */
export const MC_RADIUS = {
  /** `--mc-radius` */
  sm: '3px',
  /** `--mc-radius-lg` */
  lg: '6px',
} as const;

/** 字体栈（display=Pixelify Sans 像素标题字，mono=Monocraft 代码字）。 */
export const MC_FONTS = {
  display: `'Pixelify Sans', "PingFang SC", "Microsoft YaHei", system-ui, sans-serif`,
  body: `system-ui, "PingFang SC", "Microsoft YaHei", sans-serif`,
  mono: `'Monocraft', 'VT323', 'Courier New', Consolas, monospace`,
} as const;

/** 动效：指数缓出，干脆不回弹。 */
export const MC_EASE = 'cubic-bezier(0.22, 1, 0.36, 1)';

/** 立体方块阴影 token：模拟 Minecraft 凸起方块（顶面受光 + 底面暗边）。 */
export const MC_SHADOWS = {
  /** `--mc-bevel-top` 顶部高光 */
  bevelTop: 'inset 0 1px 0 0 rgb(255 255 255 / 0.28)',
  /** `--mc-bevel-left` 左侧高光 */
  bevelLeft: 'inset 1px 0 0 0 rgb(255 255 255 / 0.12)',
  /** `--mc-bevel-bottom` 底部暗边 */
  bevelBottom: 'inset 0 -2px 0 0 rgb(0 0 0 / 0.32)',
  /** `--mc-lift` 外投影（未按下时的 2px 抬升） */
  lift: '0 2px 0 0 rgb(0 0 0 / 0.45)',
  /** `--mc-shadow-block` 完整立体阴影（按钮默认态） */
  block: 'var(--mc-bevel-top), var(--mc-bevel-left), var(--mc-bevel-bottom), var(--mc-lift)',
  /** `--mc-shadow-block-active` 按下塌陷态 */
  blockActive: 'inset 0 2px 3px 0 rgb(0 0 0 / 0.38)',
  /** `--mc-shadow-pop` 浮层投影（弹窗/菜单） */
  pop: '0 14px 34px -10px rgb(0 0 0 / 0.65)',
  /** `--mc-sheen` 面板顶面 sheen */
  sheen: 'inset 0 1px 0 0 rgb(255 255 255 / 0.05)',
} as const;

/** 语义色 → CSS 变量名。Progress 的 tone 等场景靠它内联取色，避免组件自带魔法值。 */
export const TONE_COLOR_VAR = {
  accent: '--mc-accent',
  gold: '--mc-gold',
  redstone: '--mc-redstone',
} as const;

/** 语义色名。 */
export type ToneColor = keyof typeof TONE_COLOR_VAR;

/** 颜色 token → CSS 变量名：`colorVar('surface-2')` → `'--mc-surface-2'`。 */
export function colorVar(token: McColorToken): string {
  return `--mc-${token}`;
}

/**
 * 拼出带 alpha 的 `rgb()` 值。
 *
 * 这是 index.css 里 `rgb(var(--mc-accent) / 0.18)` 的 TS 版本。
 * **必须引用 CSS 变量而不是 RGB 三元组本身**：主题切换只改写
 * `--mc-accent` 等变量，内联值若写死三元组会与换肤脱钩。
 *
 * @param name CSS 变量名，须以 `--` 开头（如 `'--mc-accent'`）
 * @param alpha 0..1；省略时输出不透明写法 `rgb(var(--x))`
 * @throws TypeError name 未以 `--` 开头
 * @throws RangeError alpha 非有限数或越界 —— 选择「抛错」而非静默 clamp：
 *   alpha 写错是调用方的 bug，静默改成 0/1 会把 bug 藏进样式里，
 *   在评审时完全看不出来。
 */
export function rgbVar(name: string, alpha?: number): string {
  if (!name.startsWith('--')) {
    throw new TypeError(`rgbVar: 变量名须以 "--" 开头，收到 ${JSON.stringify(name)}`);
  }
  if (alpha === undefined) {
    return `rgb(var(${name}))`;
  }
  if (!Number.isFinite(alpha) || alpha < 0 || alpha > 1) {
    throw new RangeError(`rgbVar: alpha 须为 0..1 的有限数，收到 ${alpha}`);
  }
  return `rgb(var(${name}) / ${alpha})`;
}

/**
 * RGB 三元组 → `#RRGGBB`。仅供需要真实色值的场景（如 canvas、
 * 需要把颜色喂给非 CSS API 的第三方库）；常规样式请用 `rgbVar`。
 */
export function hex(token: McColorToken): string {
  const [r, g, b] = MC_COLORS[token].split(' ').map(Number);
  const hex2 = (n: number): string => n.toString(16).padStart(2, '0');
  return `#${hex2(r)}${hex2(g)}${hex2(b)}`;
}

/* ------------------------------------------------------------------ *
 * 主题（换肤预设）
 * ------------------------------------------------------------------ */

/** 主题名。`craft-dark` 即 index.css `:root` 的默认草绿主题。 */
export type ThemeName = 'craft-dark' | 'nether-ember' | 'ender-night';

/** 默认主题：与 index.css `:root` 完全一致（不改写任何变量也能得到它）。 */
export const DEFAULT_THEME: ThemeName = 'craft-dark';

/**
 * 主题表：主题名 → 该主题要**覆盖**的 CSS 变量。
 *
 * 键是完整 CSS 变量名（含 `--mc-` 前缀），值是 RGB 三元组字符串，
 * 直接喂给 `documentElement.style.setProperty`。
 *
 * 为什么要 `Partial`：主题只需覆盖「品牌强调色」三元组，
 * 中性色/文字色沿用 :root 默认 —— 与 SettingsPanel 只换 accent 的
 * 实际行为一致，也避免每个主题都抄一遍 16 个 token 而逐渐漂移。
 *
 * 三个主题的 accent 刻意选成绿 / 橙红 / 紫：换肤是否生效必须一眼可辨，
 * 若三者色相接近，测试只能验证「变量变了」而验证不了「用户看得出变了」。
 */
export const THEMES: Record<ThemeName, Partial<Record<string, string>>> = {
  /** 草绿（creeper）：index.css 默认值 */
  'craft-dark': {
    '--mc-accent': MC_COLORS.accent,
    '--mc-accent-bright': MC_COLORS['accent-bright'],
    '--mc-accent-deep': MC_COLORS['accent-deep'],
  },
  /** 下界余烬：红橙 */
  'nether-ember': {
    '--mc-accent': '196 84 52',
    '--mc-accent-bright': '224 118 74',
    '--mc-accent-deep': '142 58 36',
  },
  /** 末地之夜：紫 */
  'ender-night': {
    '--mc-accent': '140 98 200',
    '--mc-accent-bright': '168 130 224',
    '--mc-accent-deep': '100 68 150',
  },
};

/** 全部主题名，按展示顺序。 */
export const THEME_NAMES: readonly ThemeName[] = ['craft-dark', 'nether-ember', 'ender-night'];
