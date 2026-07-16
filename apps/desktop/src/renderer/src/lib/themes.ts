// MC Creator — 生物群系主题系统
// 每套主题携带完整设计令牌（底色/面板/边框/文字/强调色/语义色），
// 切换时整站换肤，Monaco 编辑器同步跟换，选择写入 localStorage。

export interface McTheme {
  id: string;
  name: string;
  description: string;
  /** 各 CSS 变量 -> "R G B" 三元组（与 index.css :root 同形） */
  vars: Record<string, string>;
}

/** 把紧凑对象展开成 css 变量映射，避免重复键名 */
function buildVars(o: {
  bg: string; surface: string; surface2: string; surface3: string;
  border: string; borderStrong: string; text: string; textDim: string; textMute: string;
  accent: string; accentBright: string; accentDeep: string;
  gold: string; goldDeep: string; redstone: string; redstoneDeep: string;
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
  {
    id: 'grass',
    name: '草绿 · 主世界',
    description: '经典草方块配色，暖泥底 + 苦力怕绿',
    vars: buildVars({
      bg: '20 19 15', surface: '28 26 21', surface2: '36 33 24', surface3: '46 42 32',
      border: '58 53 42', borderStrong: '74 68 53', text: '236 232 218', textDim: '182 176 152', textMute: '138 132 105',
      accent: '106 176 76', accentBright: '139 195 74', accentDeep: '78 138 55',
      gold: '217 164 65', goldDeep: '183 132 45', redstone: '217 83 79', redstoneDeep: '178 60 56',
    }),
  },
  {
    id: 'nether',
    name: '下界 · 绯红',
    description: '玄武岩黑红 + 地狱变种橙，炽热感',
    vars: buildVars({
      bg: '18 12 12', surface: '28 18 18', surface2: '38 24 22', surface3: '50 32 28',
      border: '64 40 36', borderStrong: '84 54 46', text: '240 228 222', textDim: '196 170 158', textMute: '150 120 110',
      accent: '214 110 71', accentBright: '232 142 95', accentDeep: '168 78 48',
      gold: '224 160 70', goldDeep: '188 128 52', redstone: '230 92 70', redstoneDeep: '190 64 50',
    }),
  },
  {
    id: 'ocean',
    name: '海洋 · 深海',
    description: '深海蓝绿，沉静的水下氛围',
    vars: buildVars({
      bg: '12 18 24', surface: '18 28 36', surface2: '24 38 48', surface3: '32 50 62',
      border: '42 62 74', borderStrong: '56 80 94', text: '224 236 240', textDim: '170 196 206', textMute: '122 150 162',
      accent: '64 156 198', accentBright: '96 186 224', accentDeep: '44 118 152',
      gold: '210 175 90', goldDeep: '176 142 64', redstone: '226 110 100', redstoneDeep: '190 80 72',
    }),
  },
  {
    id: 'twilight',
    name: '暮色 · 魔法森林',
    description: '暮色森林的紫调，神秘魔法感',
    vars: buildVars({
      bg: '18 14 24', surface: '26 20 34', surface2: '34 27 44', surface3: '44 35 56',
      border: '56 46 70', borderStrong: '72 58 90', text: '232 226 240', textDim: '184 174 200', textMute: '138 128 158',
      accent: '156 122 214', accentBright: '184 154 232', accentDeep: '120 90 176',
      gold: '214 174 96', goldDeep: '178 142 70', redstone: '222 100 120', redstoneDeep: '186 74 96',
    }),
  },
  {
    id: 'end',
    name: '末地 · 终末',
    description: '虚空黑 + 末影青，空灵终极感',
    vars: buildVars({
      bg: '10 12 16', surface: '16 18 24', surface2: '22 24 32', surface3: '30 32 42',
      border: '40 44 56', borderStrong: '54 58 72', text: '222 230 236', textDim: '172 184 196', textMute: '126 138 152',
      accent: '102 214 200', accentBright: '138 232 220', accentDeep: '70 168 158',
      gold: '200 180 220', goldDeep: '168 148 190', redstone: '214 110 200', redstoneDeep: '178 84 168',
    }),
  },
  {
    id: 'redstone',
    name: '红石 · 电路',
    description: '暗石 + 红石红光，机械工业感',
    vars: buildVars({
      bg: '18 14 12', surface: '26 20 16', surface2: '34 26 20', surface3: '44 34 26',
      border: '56 44 34', borderStrong: '72 56 42', text: '238 226 218', textDim: '192 172 158', textMute: '146 124 108',
      accent: '217 83 79', accentBright: '232 120 114', accentDeep: '178 60 56',
      gold: '224 170 72', goldDeep: '188 140 56', redstone: '217 83 79', redstoneDeep: '178 60 56',
    }),
  },
];

const STORAGE_KEY = 'mc-creator-theme';

/** 由 monaco-theme.ts 注册：主题切换后让编辑器同步跟换 */
let refreshMonaco: (() => void) | null = null;
export function registerMonacoRefresh(fn: () => void) {
  refreshMonaco = fn;
}

/** 按 id 应用主题：整站 CSS 变量 + 持久化 + 触发 Monaco 刷新 */
export function applyTheme(id: string) {
  const theme = MC_THEMES.find((t) => t.id === id) ?? MC_THEMES[0];
  const root = document.documentElement.style;
  for (const [k, val] of Object.entries(theme.vars)) {
    root.setProperty(k, val);
  }
  try {
    localStorage.setItem(STORAGE_KEY, theme.id);
  } catch {
    /* localStorage 不可用时静默跳过 */
  }
  refreshMonaco?.();
}

/** 启动时读取上次选择（无则默认草绿），在首屏渲染前同步调用 */
export function initTheme() {
  let id = MC_THEMES[0].id;
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && MC_THEMES.some((t) => t.id === saved)) id = saved;
  } catch {
    /* ignore */
  }
  applyTheme(id);
}
