// MC Creator — 生物群系主题系统
// 每套主题携带完整设计令牌（底色/面板/边框/文字/强调色/语义色），
// 切换时整站换肤，Monaco 编辑器同步跟换，选择写入 localStorage。
// 支持亮色/暗色/系统跟随三种颜色模式，每种模式独立记忆主题选择。

/** 颜色模式：亮色 / 暗色 / 跟随系统 */
export type ColorMode = 'light' | 'dark' | 'system';

export interface McTheme {
  id: string;
  name: string;
  description: string;
  /** 主题明暗模式：用于按模式分组显示与持久化 */
  mode: 'light' | 'dark';
  /** 各 CSS 变量 -> "R G B" 三元组（与 index.css :root 同形） */
  vars: Record<string, string>;
}

/** 把紧凑对象展开成 css 变量映射，避免重复键名 */
function buildVars(o: {
  bg: string;
  surface: string;
  surface2: string;
  surface3: string;
  border: string;
  borderStrong: string;
  text: string;
  textDim: string;
  textMute: string;
  accent: string;
  accentBright: string;
  accentDeep: string;
  gold: string;
  goldDeep: string;
  redstone: string;
  redstoneDeep: string;
}): Record<string, string> {
  return {
    '--mc-bg': o.bg,
    '--mc-surface': o.surface,
    '--mc-surface-2': o.surface2,
    '--mc-surface-3': o.surface3,
    '--mc-border': o.border,
    '--mc-border-strong': o.borderStrong,
    '--mc-text': o.text,
    '--mc-text-dim': o.textDim,
    '--mc-text-mute': o.textMute,
    '--mc-accent': o.accent,
    '--mc-accent-bright': o.accentBright,
    '--mc-accent-deep': o.accentDeep,
    '--mc-gold': o.gold,
    '--mc-gold-deep': o.goldDeep,
    '--mc-redstone': o.redstone,
    '--mc-redstone-deep': o.redstoneDeep,
  };
}

export const MC_THEMES: McTheme[] = [
  // ===== 暗色主题（6 套） =====
  {
    id: 'grass',
    name: '草绿 · 主世界',
    description: '经典草方块配色，暖泥底 + 苦力怕绿',
    mode: 'dark',
    vars: buildVars({
      bg: '20 19 15',
      surface: '28 26 21',
      surface2: '36 33 24',
      surface3: '46 42 32',
      border: '58 53 42',
      borderStrong: '74 68 53',
      text: '236 232 218',
      textDim: '182 176 152',
      textMute: '138 132 105',
      accent: '106 176 76',
      accentBright: '139 195 74',
      accentDeep: '78 138 55',
      gold: '217 164 65',
      goldDeep: '183 132 45',
      redstone: '217 83 79',
      redstoneDeep: '178 60 56',
    }),
  },
  {
    id: 'nether',
    name: '下界 · 绯红',
    description: '玄武岩黑红 + 地狱变种橙，炽热感',
    mode: 'dark',
    vars: buildVars({
      bg: '18 12 12',
      surface: '28 18 18',
      surface2: '38 24 22',
      surface3: '50 32 28',
      border: '64 40 36',
      borderStrong: '84 54 46',
      text: '240 228 222',
      textDim: '196 170 158',
      textMute: '150 120 110',
      accent: '214 110 71',
      accentBright: '232 142 95',
      accentDeep: '168 78 48',
      gold: '224 160 70',
      goldDeep: '188 128 52',
      redstone: '230 92 70',
      redstoneDeep: '190 64 50',
    }),
  },
  {
    id: 'ocean',
    name: '海洋 · 深海',
    description: '深海蓝绿，沉静的水下氛围',
    mode: 'dark',
    vars: buildVars({
      bg: '12 18 24',
      surface: '18 28 36',
      surface2: '24 38 48',
      surface3: '32 50 62',
      border: '42 62 74',
      borderStrong: '56 80 94',
      text: '224 236 240',
      textDim: '170 196 206',
      textMute: '122 150 162',
      accent: '64 156 198',
      accentBright: '96 186 224',
      accentDeep: '44 118 152',
      gold: '210 175 90',
      goldDeep: '176 142 64',
      redstone: '226 110 100',
      redstoneDeep: '190 80 72',
    }),
  },
  {
    id: 'twilight',
    name: '暮色 · 魔法森林',
    description: '暮色森林的紫调，神秘魔法感',
    mode: 'dark',
    vars: buildVars({
      bg: '18 14 24',
      surface: '26 20 34',
      surface2: '34 27 44',
      surface3: '44 35 56',
      border: '56 46 70',
      borderStrong: '72 58 90',
      text: '232 226 240',
      textDim: '184 174 200',
      textMute: '138 128 158',
      accent: '156 122 214',
      accentBright: '184 154 232',
      accentDeep: '120 90 176',
      gold: '214 174 96',
      goldDeep: '178 142 70',
      redstone: '222 100 120',
      redstoneDeep: '186 74 96',
    }),
  },
  {
    id: 'end',
    name: '末地 · 终末',
    description: '虚空黑 + 末影青，空灵终极感',
    mode: 'dark',
    vars: buildVars({
      bg: '10 12 16',
      surface: '16 18 24',
      surface2: '22 24 32',
      surface3: '30 32 42',
      border: '40 44 56',
      borderStrong: '54 58 72',
      text: '222 230 236',
      textDim: '172 184 196',
      textMute: '126 138 152',
      accent: '102 214 200',
      accentBright: '138 232 220',
      accentDeep: '70 168 158',
      gold: '200 180 220',
      goldDeep: '168 148 190',
      redstone: '214 110 200',
      redstoneDeep: '178 84 168',
    }),
  },
  {
    id: 'redstone',
    name: '红石 · 电路',
    description: '暗石 + 红石红光，机械工业感',
    mode: 'dark',
    vars: buildVars({
      bg: '18 14 12',
      surface: '26 20 16',
      surface2: '34 26 20',
      surface3: '44 34 26',
      border: '56 44 34',
      borderStrong: '72 56 42',
      text: '238 226 218',
      textDim: '192 172 158',
      textMute: '146 124 108',
      accent: '217 83 79',
      accentBright: '232 120 114',
      accentDeep: '178 60 56',
      gold: '224 170 72',
      goldDeep: '188 140 56',
      redstone: '217 83 79',
      redstoneDeep: '178 60 56',
    }),
  },

  // ===== 亮色主题（3 套，文字对比度 ≥ 4.5:1 WCAG AA） =====
  {
    id: 'light-grass',
    name: '草绿 · 晨光',
    description: '明亮米白底 + 草绿强调，清新日间风',
    mode: 'light',
    vars: buildVars({
      bg: '245 242 232', // 浅暖白
      surface: '252 250 242', // 亮米白
      surface2: '238 234 220', // 略深米色
      surface3: '228 222 205', // hover 面
      border: '210 204 188', // 浅灰边框
      borderStrong: '180 174 158',
      text: '50 45 35', // 深棕主文字（对比度 ~12:1）
      textDim: '90 82 68', // 中棕次文字（对比度 ~6.5:1）
      textMute: '130 122 105', // 浅棕提示
      accent: '78 138 55', // 草绿（略深以保证亮底对比度）
      accentBright: '106 176 76',
      accentDeep: '60 110 42',
      gold: '150 105 35',
      goldDeep: '120 82 26',
      redstone: '185 60 55',
      redstoneDeep: '150 45 42',
    }),
  },
  {
    id: 'light-ocean',
    name: '海洋 · 浅海',
    description: '亮蓝白底 + 海蓝强调，明亮水面感',
    mode: 'light',
    vars: buildVars({
      bg: '240 244 248', // 浅蓝白
      surface: '250 252 254', // 亮蓝白
      surface2: '226 234 240', // 略深蓝灰
      surface3: '214 224 232', // hover 面
      border: '200 210 218', // 浅灰蓝边框
      borderStrong: '168 178 188',
      text: '30 40 50', // 深蓝灰主文字（对比度 ~13:1）
      textDim: '70 84 96', // 中蓝灰次文字（对比度 ~6:1）
      textMute: '118 130 142', // 浅蓝灰提示
      accent: '36 110 150', // 海蓝（略深以保证亮底对比度）
      accentBright: '54 138 178',
      accentDeep: '28 88 122',
      gold: '150 110 40',
      goldDeep: '118 84 30',
      redstone: '180 60 58',
      redstoneDeep: '146 44 42',
    }),
  },
  {
    id: 'light-sand',
    name: '沙漠 · 沙金',
    description: '亮沙黄底 + 沙金强调，温暖沙漠日',
    mode: 'light',
    vars: buildVars({
      bg: '248 240 220', // 浅沙黄
      surface: '253 248 234', // 亮沙白
      surface2: '240 230 206', // 略深沙色
      surface3: '230 218 190', // hover 面
      border: '212 198 168', // 浅沙灰边框
      borderStrong: '180 164 130',
      text: '60 48 32', // 深棕主文字（对比度 ~11:1）
      textDim: '100 84 60', // 中棕次文字（对比度 ~5.5:1）
      textMute: '146 128 96', // 浅棕提示
      accent: '160 110 35', // 沙金
      accentBright: '192 142 58',
      accentDeep: '128 84 24',
      gold: '150 105 35',
      goldDeep: '118 80 26',
      redstone: '180 62 52',
      redstoneDeep: '146 46 38',
    }),
  },
];

// localStorage keys
const MODE_STORAGE_KEY = 'mc-creator-color-mode';
const LIGHT_THEME_STORAGE_KEY = 'mc-creator-light-theme';
const DARK_THEME_STORAGE_KEY = 'mc-creator-dark-theme';
/** 旧版单一主题 key，仅用于读取迁移与旧版兼容 */
const LEGACY_STORAGE_KEY = 'mc-creator-theme';

/** 由 monaco-theme.ts 注册：主题切换后让编辑器同步跟换 */
let refreshMonaco: (() => void) | null = null;
export function registerMonacoRefresh(fn: () => void) {
  refreshMonaco = fn;
}

/** 获取系统当前明暗模式 */
export function getSystemMode(): 'light' | 'dark' {
  if (typeof window === 'undefined') return 'dark';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/** 获取当前生效的明暗模式（system 会解析为实际值） */
export function getEffectiveMode(mode: ColorMode): 'light' | 'dark' {
  return mode === 'system' ? getSystemMode() : mode;
}

/** 按 mode 获取默认主题 id */
export function getDefaultThemeId(mode: 'light' | 'dark'): string {
  return mode === 'light' ? 'light-grass' : 'grass';
}

/** 读取指定模式下的当前主题 id（无则返回默认；dark 模式兼容旧版单一 key） */
export function getCurrentThemeId(mode: 'light' | 'dark'): string {
  const storageKey = mode === 'light' ? LIGHT_THEME_STORAGE_KEY : DARK_THEME_STORAGE_KEY;
  try {
    const saved = localStorage.getItem(storageKey);
    if (saved && MC_THEMES.some((t) => t.id === saved && t.mode === mode)) return saved;
    // 旧版迁移：dark 模式下若新 key 无值，尝试旧版单一 key（旧版所有主题均为 dark）
    if (mode === 'dark') {
      const legacy = localStorage.getItem(LEGACY_STORAGE_KEY);
      if (legacy && MC_THEMES.some((t) => t.id === legacy && t.mode === 'dark')) return legacy;
    }
  } catch {
    /* localStorage 不可用时静默跳过 */
  }
  return getDefaultThemeId(mode);
}

/** 按 id 应用主题：整站 CSS 变量 + 持久化 + 触发 Monaco 刷新 */
export function applyTheme(id: string) {
  const theme = MC_THEMES.find((t) => t.id === id) ?? MC_THEMES[0];
  const root = document.documentElement.style;
  for (const [k, val] of Object.entries(theme.vars)) {
    root.setProperty(k, val);
  }
  // 持久化到模式对应 key（同时写旧 key 兼容旧版读取）
  const storageKey = theme.mode === 'light' ? LIGHT_THEME_STORAGE_KEY : DARK_THEME_STORAGE_KEY;
  try {
    localStorage.setItem(storageKey, theme.id);
    localStorage.setItem(LEGACY_STORAGE_KEY, theme.id);
  } catch {
    /* localStorage 不可用时静默跳过 */
  }
  refreshMonaco?.();
}

/**
 * 应用指定颜色模式：解析 mode → 读取该模式下上次选择的主题 → 调用 applyTheme。
 * 同时把 mode 持久化到 localStorage。
 */
export function applyColorMode(mode: ColorMode) {
  const effective = getEffectiveMode(mode);
  const themeId = getCurrentThemeId(effective);
  applyTheme(themeId);
  try {
    localStorage.setItem(MODE_STORAGE_KEY, mode);
  } catch {
    /* ignore */
  }
}

/** 读取当前颜色模式（默认 'system'） */
export function getCurrentMode(): ColorMode {
  try {
    const saved = localStorage.getItem(MODE_STORAGE_KEY);
    if (saved === 'light' || saved === 'dark' || saved === 'system') return saved;
  } catch {
    /* ignore */
  }
  return 'system';
}

let systemModeListenerRegistered = false;

/**
 * 启动时初始化颜色模式：读取 localStorage 的 mode，应用主题，
 * 若 mode === 'system' 则注册 matchMedia change 监听器，系统变化时自动重新应用。
 * 在首屏渲染前同步调用以避免闪烁。
 */
export function initColorMode() {
  const mode = getCurrentMode();
  applyColorMode(mode);
  // 注册系统模式变化监听器（仅注册一次，全局生效）
  if (!systemModeListenerRegistered && typeof window !== 'undefined' && window.matchMedia) {
    const mql = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => {
      if (getCurrentMode() === 'system') applyColorMode('system');
    };
    if (typeof mql.addEventListener === 'function') {
      mql.addEventListener('change', handler);
    } else if (typeof mql.addListener === 'function') {
      // Safari < 14 兼容
      mql.addListener(handler);
    }
    systemModeListenerRegistered = true;
  }
}

/** 向后兼容：等价于 initColorMode()。旧版调用点可继续使用。 */
export function initTheme() {
  initColorMode();
}
