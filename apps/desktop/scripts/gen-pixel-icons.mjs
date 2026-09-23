// 像素图标生成器 v2：24x24 画布 + 方向性明暗引擎
// 用法：node scripts/gen-pixel-icons.mjs
//
// 相比 v1（16x16 平涂双色）的质量关键：
// 1. 每个基色自动派生 4 阶色阶（高光/基色/阴影/深阴影），HSL 明度调整
// 2. 方向性明暗：顶边邻空→高光，底边邻空→深阴影，左邻空→微亮，右邻空→微暗（左上光源）
//    —— 这是对齐真实 MC 贴图（方块顶亮底暗）的做法，替代平涂
// 3. 柔和描边（per-icon flag）：用邻近色的深阴影色描一圈，非纯黑
// 4. 同色横向 run 合并成单个 rect，控制 SVG 体积
// 5. 额外输出 scripts/icon-preview.html 供人工审查（暗底 24/48/96 三档）
//
// 字符约定：'.' 或 ' ' = 透明；大写 = 基色（自动明暗）；小写 = 手动阴影阶（不参与自动明暗）；
//           'K' = 固定近黑（瞳孔/开口等，不参与明暗）
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, '..', 'src', 'renderer', 'src', 'assets', 'mc-ui', 'pixel');
const SIZE = 24;

// === 调色板：字符 -> 基色（贴近 Minecraft 方块/物品配色） ===
const PAL = {
  G: '#5db646', // 草绿
  D: '#8a5a32', // 泥土
  W: '#b5854b', // 橡木板
  L: '#7a4a2e', // 皮革/深木
  S: '#8f8f8f', // 石头
  J: '#d8d8d8', // 铁
  F: '#f0c532', // 金
  C: '#45e0cf', // 钻石青
  R: '#d63b3b', // 红石红
  T: '#3a6fb0', // 蓝
  P: '#a05cd6', // 紫
  N: '#caa472', // 皮肤
  B: '#e8e0c8', // 纸/书页
  E: '#f4f4f4', // 白
  X: '#c8722e', // 命令方块橙
  Y: '#f5e042', // 亮黄
  Z: '#6f9c50', // 僵尸绿
  H: '#4a3123', // 头发深棕
  Q: '#3d3d3d', // 深灰（GUI 槽位中心）
  K: '#1c1c1c', // 固定近黑（无明暗）
};

// === 颜色工具（hex <-> HSL，明度平移） ===
function hexToRgb(hex) {
  const h = hex.replace('#', '');
  return {
    r: parseInt(h.slice(0, 2), 16) / 255,
    g: parseInt(h.slice(2, 4), 16) / 255,
    b: parseInt(h.slice(4, 6), 16) / 255,
  };
}
function rgbToHex(r, g, b) {
  const f = (v) =>
    Math.round(Math.min(1, Math.max(0, v)) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${f(r)}${f(g)}${f(b)}`;
}
function rgbToHsl(r, g, b) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return { h, s, l };
}
/** 明度平移：dl ∈ [-1,1]，正=变亮，负=变暗 */
function shift(hex, dl) {
  const { r, g, b } = hexToRgb(hex);
  const { h, s, l } = rgbToHsl(r, g, b);
  const nl = Math.min(1, Math.max(0, l + dl));
  // HSL -> RGB
  const hue2rgb = (p, q, t) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  if (s === 0) {
    const v = nl;
    return rgbToHex(v, v, v);
  }
  const q = nl < 0.5 ? nl * (1 + s) : nl + s - nl * s;
  const p = 2 * nl - q;
  return rgbToHex(hue2rgb(p, q, h + 1 / 3), hue2rgb(p, q, h), hue2rgb(p, q, h - 1 / 3));
}

// === 色阶（每基色派生 5 阶，缓存） ===
const TONES = {}; // char -> { hi, lit, base, lo, deep }
function tonesOf(ch) {
  if (TONES[ch]) return TONES[ch];
  const base = PAL[ch];
  TONES[ch] = {
    hi: shift(base, 0.18),
    lit: shift(base, 0.08),
    base,
    lo: shift(base, -0.13),
    deep: shift(base, -0.32),
  };
  return TONES[ch];
}

/** 归一化行：补 '.' 到 24、截断超长 */
function norm(row) {
  return row.padEnd(SIZE, '.').slice(0, SIZE);
}

/**
 * 渲染 sprite 为 SVG 字符串。
 * @param rows 24 行字符画（'.'/' '=透明）
 * @param opts.outline 柔和描边（用邻近色的深阴影色外扩 1px）
 */
function renderSprite(rows, { outline = false } = {}) {
  const grid = rows.map(norm);
  // 解析每个格子的最终颜色
  const color = (x, y) => {
    const ch = grid[y]?.[x];
    if (!ch || ch === '.' || ch === ' ') return null;
    if (ch === 'K') return PAL.K; // 固定近黑
    const up = ch.toUpperCase();
    if (!PAL[up]) return null;
    const t = tonesOf(up);
    if (ch !== up) return t.lo; // 小写 = 手动阴影阶
    // 大写：方向性自动明暗（只对"邻接透明"的边缘生效）
    const empty = (xx, yy) => {
      const c = grid[yy]?.[xx];
      return !c || c === '.' || c === ' ';
    };
    if (empty(x, y - 1)) return t.hi; // 顶边受光
    if (empty(x, y + 1)) return t.deep; // 底边深阴影
    if (empty(x - 1, y)) return t.lit; // 左微亮
    if (empty(x + 1, y)) return t.lo; // 右微暗
    return t.base;
  };

  const cells = Array.from({ length: SIZE }, () => Array(SIZE).fill(null));
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      cells[y][x] = color(x, y);
    }
  }

  // 柔和描边：空格且 4 邻接有色的格子 → 用最近邻的深阴影色
  if (outline) {
    const dirs = [
      [0, -1],
      [0, 1],
      [-1, 0],
      [1, 0],
    ];
    const outlineCells = [];
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        if (cells[y][x]) continue;
        for (const [dx, dy] of dirs) {
          const nx = x + dx;
          const ny = y + dy;
          const nch = grid[ny]?.[nx];
          if (!nch || nch === '.' || nch === ' ') continue;
          const up = nch === 'K' ? 'K' : nch.toUpperCase();
          const col = up === 'K' ? PAL.K : tonesOf(up).deep;
          outlineCells.push([x, y, col]);
          break;
        }
      }
    }
    for (const [x, y, col] of outlineCells) cells[y][x] = col;
  }

  // 同色横向 run 合并为 rect
  const rects = [];
  for (let y = 0; y < SIZE; y++) {
    let x = 0;
    while (x < SIZE) {
      const c = cells[y][x];
      if (!c) {
        x++;
        continue;
      }
      let len = 1;
      while (x + len < SIZE && cells[y][x + len] === c) len++;
      rects.push(`<rect x="${x}" y="${y}" width="${len}" height="1" fill="${c}"/>`);
      x += len;
    }
  }

  return `<svg viewBox="0 0 ${SIZE} ${SIZE}" shape-rendering="crispEdges" xmlns="http://www.w3.org/2000/svg">${rects.join('')}</svg>\n`;
}

// ============================================================
//  Sprite 定义（24x24 字符画，'.'=透明）
//  语义重合的图标共享同一份定义（如 creeper 同时用于活动栏与实体节点）
// ============================================================

const ART = {
  // --- 基础形状 ---
  folder: [
    '..WWWWWWW...............',
    '..WWWWWWW...............',
    '..WWWWWWW...............',
    '..WWWWWWW...............',
    '..WWWWWWWWWWWWWWWWWWWW..',
    '..WWWWWWWWWWWWWWWWWWWW..',
    '..WWWWWWWWWWWWWWWWWWWW..',
    '..WWWWWWWWWWWWWWWWWWWW..',
    '..wwwwwwwwwwwwwwwwwwww..',
    '..WWWWWWWWWWWWWWWWWWWW..',
    '..WWWWWWWWWWWWWWWWWWWW..',
    '..WWWWWWWWWWWWWWWWWWWW..',
    '..WWWWWWWWWWWWWWWWWWWW..',
    '..WWWWWWWWWWWWWWWWWWWW..',
    '..wwwwwwwwwwwwwwwwwwww..',
    '..WWWWWWWWWWWWWWWWWWWW..',
    '..WWWWWWWWWWWWWWWWWWWW..',
    '..WWWWWWWWWWWWWWWWWWWW..',
    '..WWWWWWWWWWWWWWWWWWWW..',
    '..WWWWWWWWWWWWWWWWWWWW..',
    '..WWWWWWWWWWWWWWWWWWWW..',
    '........................',
    '........................',
    '........................',
  ],
  spyglass: [
    '........................',
    '........................',
    '........................',
    '...............CCC......',
    '..............CCCCC.....',
    '..............CEEC......',
    '.............JJJJ.......',
    '............JJJJ........',
    '...........EEEE.........',
    '..........JJJJ..........',
    '.........JJJJ...........',
    '........JJJJ............',
    '.......EEEE.............',
    '......JJJJ..............',
    '.....JJJJ...............',
    '....JJJJ................',
    '...JJJJ.................',
    '..JJJJ..................',
    '.JJJJJ..................',
    '.JJJJJ..................',
    '.jjjjj..................',
    '........................',
    '........................',
    '........................',
  ],
  git: [
    '........................',
    '........................',
    '........................',
    '................RRRRR...',
    '................RRFRR...',
    '................RRRRR...',
    '..........RRRR..RRRRR...',
    '..........RRRR..RRRRR...',
    '..........RRRR..........',
    '..........RRRR..........',
    '..........RRRR..........',
    '..........RRRR..........',
    '..........RRRR..........',
    '..........RRRR..........',
    '..........RRRR..........',
    '....RRRRR.RRRR..........',
    '....RRFRR.RRRR..........',
    '....RRRRR.RRRR..........',
    '....RRRRR...............',
    '....RRRRR...............',
    '....RRRRR...............',
    '........................',
    '........................',
    '........................',
  ],
  chest: [
    '........................',
    '..LLLLLLLLLLLLLLLLLLLL..',
    '..LWWWWWWWWWWWWWWWWWWL..',
    '..LWWWWWWWWWWWWWWWWWWL..',
    '..LWWWWWWWWJJJJWWWWWWL..',
    '..LWWWWWWWWJEEJWWWWWWL..',
    '..LLLLLLLLJJJJLLLLLLLL..',
    '..LLLLLLLLJEEJLLLLLLLL..',
    '..LWWWWWWWWJJJJWWWWWWL..',
    '..LWWWWWWWWWWWWWWWWWWL..',
    '..LWWWWWWWWWWWWWWWWWWL..',
    '..LWWWWWWWWWWWWWWWWWWL..',
    '..LWWWWWWWWWWWWWWWWWWL..',
    '..LWWWWWWWWWWWWWWWWWWL..',
    '..LWWWWWWWWWWWWWWWWWWL..',
    '..LWWWWWWWWWWWWWWWWWWL..',
    '..LWWWWWWWWWWWWWWWWWWL..',
    '..LWWWWWWWWWWWWWWWWWWL..',
    '..LWWWWWWWWWWWWWWWWWWL..',
    '..LWWWWWWWWWWWWWWWWWWL..',
    '..LWWWWWWWWWWWWWWWWWWL..',
    '..LLLLLLLLLLLLLLLLLLLL..',
    '........................',
    '........................',
  ],
  ingot: [
    '........................',
    '........................',
    '........................',
    '........................',
    '........................',
    '........................',
    '.........EEEEEEEE.......',
    '.......FFFFFFFFFFFF.....',
    '......FFFFFFFFFFFFFF....',
    '......FFFFFFFFFFFFFF....',
    '......FFFFFFFFFFFFFFf...',
    '......FFFFFFFFFFFFFFf...',
    '......FFFFFFFFFFFFFFf...',
    '......FFFFFFFFFFFFFFf...',
    '......FFFFFFFFFFFFFFf...',
    '......fFFFFFFFFFFFFFf...',
    '......fffffffffffffff...',
    '........................',
    '........................',
    '........................',
    '........................',
    '........................',
    '........................',
    '........................',
  ],
  grass: [
    '........................',
    '........................',
    '..GGGGGGGGGGGGGGGGGGGG..',
    '..GGGGGGGGGGGGGGGGGGGG..',
    '..GGGGGGGGGGGGGGGGGGGG..',
    '..GDGGDGGDGGDGGDGGDGGG..',
    '..DDdDDDdDDDDdDDDdDDDD..',
    '..DDDDdDDDDDDdDDDDdDDD..',
    '..DdDDDDdDDDDDDdDDDdDD..',
    '..DDDDDDdDDdDDDDDDdDDD..',
    '..DdDDDdDDDDdDDdDDDDdD..',
    '..DDDDdDDDDDDdDDDDdDDD..',
    '..DDdDDDDdDDDDDDdDDDDd..',
    '..DDDDDDdDDdDDDDdDDDDD..',
    '..DdDDDdDDDDdDDdDDDDdD..',
    '..DDDDdDDDDDDdDDDDdDDD..',
    '..DDdDDDDdDDDDDDdDDDDd..',
    '..DDDDDDdDDdDDDDDDdDDD..',
    '..DdDDDdDDDDdDDdDDDDdD..',
    '..DDDDdDDDDDDdDDDDdDDD..',
    '..DDdDDDDdDDDDDDdDDDDd..',
    '..DDDDDDDdDDdDDDDDDdDD..',
    '........................',
    '........................',
  ],
  creeper: [
    '........................',
    '........................',
    '..GgGGGGgGGGGgGGGgGGGg..',
    '..GGGGgGGGgGGGGGGgGGGg..',
    '..GgGGGGGGgGGgGGGGGGgG..',
    '..GGGKKKKKGGGGGKKKKKGg..',
    '..GgGKKKKKGGGGGKKKKKGG..',
    '..GGGKKKKKGgGGGKKKKKGg..',
    '..GgGKKKKKGGGGGKKKKKGG..',
    '..GGGKKKKKGgGGGKKKKKGg..',
    '..GgGGGGGGgGGgGGGGGGgG..',
    '..GGGGgGGGgGGGGGGgGGGg..',
    '..GgGGGGGKKKKGGGGgGGGG..',
    '..GGGGgGGKKKKGGgGGGGgG..',
    '..GgGGGGGKKKKGGGGgGGGG..',
    '..GGGGKKKKKKKKKKGGgGGg..',
    '..GgGGKKKKKKKKKKGGGGGG..',
    '..GGGGKKKKKKKKKKGgGGgG..',
    '..GgGGKKKGGGGKKKGGGGGG..',
    '..GGGGKKKGGGGKKKGgGGgG..',
    '..GgGGKKKGGGGKKKGGGGGG..',
    '..GGGgGGGgGGGGgGGgGGGg..',
    '........................',
    '........................',
  ],
  noteblock: [
    '........................',
    '........................',
    '..WWWWWWWWWWWWWWWWWWWW..',
    '..WWWWWWWWWWWWWWWWWWWW..',
    '..WWWWWWWWWFFWWWWWWWWW..',
    '..WWWWWWWWFFFWWWWWWWWW..',
    '..WWWWWWWWFFWWWWWWWWWW..',
    '..WWWWWWWWFFWWWWWWWWWW..',
    '..wwwwwwwwFFwwwwwwwwww..',
    '..WWWWWWWWFFWWWWWWWWWW..',
    '..WWWWWWWWFFWWWWWWWWWW..',
    '..WWWWWWWWFFWWWWWWWWWW..',
    '..WWWWWWWWFFWWWWWWWWWW..',
    '..WWWWWWWFFFWWWWWWWWWW..',
    '..WWWWWWFFFFWWWWWWWWWW..',
    '..wwwwwwwwwwwwwwwwwwww..',
    '..WWWWWWWWWWWWWWWWWWWW..',
    '..WWWWWWWWWWWWWWWWWWWW..',
    '..WWWWWWWWWWWWWWWWWWWW..',
    '..WWWWWWWWWWWWWWWWWWWW..',
    '..WWWWWWWWWWWWWWWWWWWW..',
    '..WWWWWWWWWWWWWWWWWWWW..',
    '........................',
    '........................',
  ],
  cmd: [
    '........................',
    '........................',
    '..XXXXXXXXXXXXXXXXXXXX..',
    '..XXXXXXXXXXXXXXXXXXXX..',
    '..XXXXXXXXXXXXXXXXXXXX..',
    '..XXXXXXXXXXXXXXXXXXXX..',
    '..XXXXXXXXXXXXXXXXXXXX..',
    '..XXXXXXXXXXXXXXXXXXXX..',
    '..XXXXXXxxxxxxxxxxXXXX..',
    '..XXXXXxxxxxxxxxxxxXXX..',
    '..XXXXXxxxxxxxxxxxxXXX..',
    '..XXXXXxxxxxxxxxxxxXXX..',
    '..XXXXXxxxxxxxxxxxxXXX..',
    '..XXXXXxxxxxxxxxxxxXXX..',
    '..XXXXXxxxxxxxxxxxxXXX..',
    '..XXXXXxxxxxxxxxxxxXXX..',
    '..XXXXXXxxxxxxxxxxXXXX..',
    '..XXXXXXXXXXXXXXXXXXXX..',
    '..XXXXXXXXXXXXXXXXXXXX..',
    '..XXXXXXXXXXXXXXXXXXXX..',
    '..XXXXXXXXXXXXXXXXXXXX..',
    '..XXXXXXXXXXXXXXXXXXXX..',
    '........................',
    '........................',
  ],
  gamepad: [
    '........................',
    '........................',
    '........................',
    '........................',
    '........................',
    '.....JJJJJJJJJJJJJJ....',
    '....JJJJJJJJJJJJJJJJ...',
    '...JJJJJJJJJJJJJJJJJJ..',
    '..JJJJJJJJJJJJJJJJJJJJ..',
    '..JJTTTJJJJJJJJJRRJJJJ..',
    '..JJTTTJJJJJJJJJRRJJJJ..',
    '..JTTTTTJJJKKJJJJJJJJJ..',
    '..JTTTTTJJJKKJJJJJJRRJ..',
    '..JTTTTTJJJKKJJJJJJRRJ..',
    '..JJTTTJJJJJJJJJJJJJJJ..',
    '..JJTTTJJJJJJJJJJJJJJJ..',
    '...JJJJJJJJJJJJJJJJJJ..',
    '....JJJJJJJJJJJJJJJJ...',
    '.....JJJJJJJJJJJJJJ....',
    '........................',
    '........................',
    '........................',
    '........................',
    '........................',
  ],
  gear: [
    '........................',
    '........................',
    '..........JJJJ..........',
    '..........JJJJ..........',
    '.......JJ.JJJJ.JJ.......',
    '......JJJJJJJJJJJJJ.....',
    '......JJJJJJJJJJJJJ.....',
    '.....JJJJJJJJJJJJJJJ....',
    '.....JJJJJKKKKJJJJJJ....',
    '.....JJJJJKKKKJJJJJJ....',
    '....JJJJJJKKKKJJJJJJJ...',
    '....JJJJJJKKKKJJJJJJJ...',
    '....JJJJJJKKKKJJJJJJJ...',
    '....JJJJJJKKKKJJJJJJJ...',
    '.....JJJJJKKKKJJJJJJ....',
    '.....JJJJJKKKKJJJJJJ....',
    '.....JJJJJJJJJJJJJJJ....',
    '......JJJJJJJJJJJJJ.....',
    '......JJJJJJJJJJJJJ.....',
    '.......JJ.JJJJ.JJ.......',
    '..........JJJJ..........',
    '..........JJJJ..........',
    '........................',
    '........................',
  ],
  stoneblock: [
    '........................',
    '........................',
    '..SSSSSSSSSSSSSSSSSSSS..',
    '..SSSsSSSSSSsSSSSSsSSS..',
    '..SSSSSSsSSSSSSSSsSSSS..',
    '..SsSSSSSSSsSSSSSSSSsS..',
    '..SSSSSSSSSSSSSsSSSSSS..',
    '..SSSsSSSSsSSSSSSSSsSS..',
    '..SSSSSSSSSSSSSSSSSSSS..',
    '..SSSSsSSSSSSsSSSSSSsS..',
    '..SsSSSSSSSSSSSSSsSSSS..',
    '..SSSSSSsSSSSSSSSSSSSS..',
    '..SSSsSSSSSSsSSSSsSSSS..',
    '..SSSSSSSSSSSSSSSSSSSS..',
    '..SSSSsSSSSSSSSsSSSSSS..',
    '..SsSSSSSsSSSSSSSSSsSS..',
    '..SSSSSSSSSSSsSSSSSSSS..',
    '..SSSsSSSSSSSSSSsSSSsS..',
    '..SSSSSSsSSSSSSSSSSSSS..',
    '..SSSSSSSSSSsSSSSsSSSS..',
    '..SsSSSsSSSSSSSSSSSSsS..',
    '..SSSSSSSSSSSSSSSSSSSS..',
    '........................',
    '........................',
  ],
  crafting: [
    '........................',
    '........................',
    '..WWWWWWWWWWWWWWWWWWWW..',
    '..WWWWWWWWWWWWWWWWWWWW..',
    '..WWWWWWWWWWWWWWWWWWWW..',
    '..WWWWWWWWKKWWWWWWWWWW..',
    '..WWWWWWWWKKWWWWWWWWWW..',
    '..WWWWJJWWKKWWJJWWWWWW..',
    '..WWWWJJWWKKWWJJWWWWWW..',
    '..WWWWJJWWKKWWJJWWWWWW..',
    '..WWWWJJWWKKWWJJWWWWWW..',
    '..WWWWJJWWKKWWJJWWWWWW..',
    '..WWWWJJWWKKWWJJWWWWWW..',
    '..WWWWJJWWKKWWJJWWWWWW..',
    '..WWWWWWWWKKWWWWWWWWWW..',
    '..WWWWWWWWKKWWWWWWWWWW..',
    '..WWWWWWWWKKWWWWWWWWWW..',
    '..WWWWJJWWKKWWJJWWWWWW..',
    '..WWWWJJWWKKWWJJWWWWWW..',
    '..WWWWJJWWKKWWJJWWWWWW..',
    '..WWWWJJWWKKWWJJWWWWWW..',
    '..WWWWWWWWKKWWWWWWWWWW..',
    '........................',
    '........................',
  ],
  book: [
    '........................',
    '........................',
    '........................',
    '..LLLLLLLLLLLLLLLLLLL..',
    '..LBBBBBBBBBBBBBBBBEEE..',
    '..LBBBBBBBBBBBBBBBBEEE..',
    '..LBBBBBBBBBBBBBBBBEEE..',
    '..LBBBBBBFFBBBBBBBEEE..',
    '..LBBBBBBFFBBBBBBBEEE..',
    '..LBBBBBBFFBBBBBBBEEE..',
    '..LBBBBBBBBBBBBBBBEEE..',
    '..LBBBBBBBBBBBBBBBEEE..',
    '..LBBBBBBBBBBBBBBBEEE..',
    '..LBBBBBBBBBBBBBBBEEE..',
    '..LBBBBBBBBBBBBBBBEEE..',
    '..LBBBBBBBBBBBBBBBEEE..',
    '..LBBBBBBBBBBBBBBBEEE..',
    '..LBBBBBBBBBBBBBBBEEE..',
    '..LBBBBBBBBBBBBBBBEEE..',
    '..LBBBBBBBBBBBBBBBEEE..',
    '..LLLLLLLLLLLLLLLLLLL..',
    '........................',
    '........................',
    '........................',
  ],
  enchantbook: [
    '........................',
    '........................',
    '..P.....................',
    '..LLLLLLLLLLLLLLLLLLLP..',
    '..LBBBBBBBBBBBBBBBBPEE..',
    '..LBBBBBBBBBBBBBBBBEEE..',
    '..LBBBBBBPPBBBBBBBPEE..',
    '..LBBBBBBPPBBBBBBBEEP..',
    '..LBBBBBBPPBBBBBBBEEE..',
    '..LBBBBBBPPBBBBBBBEEE..',
    '..LBBBBBBBBBBBBBBBEEE..',
    'P.LBBBBBBBBBBBBBBBPEE..',
    '..LBBBBBBBBBBBBBBBEEE..',
    '..LBBBBBBBBBBBBBBBEEP..',
    '..LBBBBBBBBBBBBBBBEEE..',
    '..LBBBBBBBBBBBBBBBEEE..',
    '..LBBBBBBBBBBBBBBBEEE..',
    '..LBBBBBBBBBBBBBBBEEP..',
    '..LBBBBBBBBBBBBBBBEEE..',
    '..LBBBBBBBBBBBBBBBEEE..',
    '..LLLLLLLLLLLLLLLLLLL..',
    '.....................P..',
    '........................',
    '........................',
  ],
  bundle: [
    '........................',
    '..........WW............',
    '..........WW............',
    '..........WW............',
    '.........LLLL...........',
    '........JJLLJJ..........',
    '.......LJLLLLJL.........',
    '......LLJLLLLJLL........',
    '.....LLLJLLLLJLLL.......',
    '....LLLLLLLLLLLLLL......',
    '...LLLLLLLLLLLLLLLL.....',
    '..LLLLBLLLLLLLlbLLL.....',
    '..LLLBLLLLLLLLLlLLL.....',
    '..LLLLLLLLLLLLLLLLL.....',
    '..LLLLLLLLLLLLLLLLL.....',
    '..LLLLLLLLLLLLLLLLL.....',
    '..LLLLLLLLLLLLLLLLL.....',
    '..LLLLLLLLLLLLLLLLL.....',
    '...LLLLLLLLLLLLLLL......',
    '....LLLLLLLLLLLLL.......',
    '.....LLLLLLLLLLL........',
    '........................',
    '........................',
    '........................',
  ],
  furnace: [
    '........................',
    '........................',
    '..SSSSSSSSSSSSSSSSSSSS..',
    '..SSsSSSSSSSSsSSSSsSSS..',
    '..SSSSSSsSSSSSSSSsSSSS..',
    '..SsSSSSSSSsSSSSSSSSsS..',
    '..SSSSSSSSSSSSSsSSSSSS..',
    '..SSSsSSSSSSSSSSSSSsSS..',
    '..SSSSSSSSSSSSSSSSSSSS..',
    '..SSSSsSSSSSSsSSSSSSsS..',
    '..SsSSSSSSSSSSSSSsSSSS..',
    '..SSSSSSSKKKKKKKKSSSSS..',
    '..SSSsSSKKKKKKKKKKSsSS..',
    '..SSSSSSKKKKKKKKKKSSSS..',
    '..SsSSSKKRRRRRRKKKKSsS..',
    '..SSSSSKKRRFFRRKKKKSSS..',
    '..SSSsSKKRFFFFRRKKKSsS..',
    '..SSSSSKKRFFFFRRKKKSSS..',
    '..SSSSSKKRRFFRRKKKKSsS..',
    '..SsSSSKKRRRRRRKKKKSSS..',
    '..SSSSSKKKKKKKKKKKSSSS..',
    '..SSSsSKKKKKKKKKKKSsSS..',
    '........................',
    '........................',
  ],
  painting: [
    '........................',
    '........................',
    '..LLLLLLLLLLLLLLLLLLLL..',
    '..LTTTTTTTTTTTTTTTTTTL..',
    '..LTTTTTTTTTTTTTTTTTTL..',
    '..LTTYYYTTTTTTTTTTTTL..',
    '..LTTYYYTTTTTTTTTTTTL..',
    '..LTTTTTTTTTTTTTTTTTTL..',
    '..LTTTTTTTTTTTTTTTTTTL..',
    '..LTTTTTTTTTTTTTTTTTTL..',
    '..LGGGGGGGGGGGGGGGGGGL..',
    '..LGGLLGGGGGGGGGGGGGGL..',
    '..LGGGGGGGGGLLGGGGGGGL..',
    '..LGGGGGGGGGGGGGGGGGGL..',
    '..LGGGGGGGGGGGGGGGGGGL..',
    '..LDDDDDDDDDDDDDDDDDDL..',
    '..LDDDDDDDDDDDDDDDDDDL..',
    '..LDDDDDDDDDDDDDDDDDDL..',
    '..LLLLLLLLLLLLLLLLLLLL..',
    '........................',
    '........................',
    '........................',
    '........................',
    '........................',
  ],
  steve: [
    '........................',
    '........................',
    '..HHHHHHHHHHHHHHHHHHHH..',
    '..HHHHHHHHHHHHHHHHHHHH..',
    '..HHHHHHHHHHHHHHHHHHHH..',
    '..HHNNNNNNNNNNNNNNNNHH..',
    '..HHNNNNNNNNNNNNNNNNHH..',
    '..HHNNNNNNNNNNNNNNNNHH..',
    '..HHNNNNNNNNNNNNNNNNHH..',
    '..HHEETTNNNNNNTTEENHHH..',
    '..HHEETTNNNNNNTTEENHHH..',
    '..HHNNNNNNNNNNNNNNNNHH..',
    '..HHNNNNnnnnnnnnNNNNHH..',
    '..HHNNNNnnnnnnnnNNNNHH..',
    '..HHNNNNNNNNNNNNNNNNHH..',
    '..HHNNNNNNNNNNNNNNNNHH..',
    '..HHNNNNLLLLLLNNNNNNHH..',
    '..HHNNNNLLLLLLNNNNNNHH..',
    '..HHNNNNNNNNNNNNNNNNHH..',
    '..HHNNNNNNNNNNNNNNNNHH..',
    '..HHNNNNNNNNNNNNNNNNHH..',
    '..HHHHHHHHHHHHHHHHHHHH..',
    '........................',
    '........................',
  ],
  zombie: [
    '........................',
    '........................',
    '..ZZZZZZZZZZZZZZZZZZZZ..',
    '..ZZzZZZZZZZZZzZZZZZZZ..',
    '..ZZZZZZZZzZZZZZZZZzZZ..',
    '..ZzZZZZZZZZZZZZZZZZzZ..',
    '..ZZZzZZZZZZZZZZZzZZZZ..',
    '..ZZZZZZZZZZZZZZZZZZZZ..',
    '..ZZZKKKKZZZZZZKKKKZZZ..',
    '..ZZZKKKKZZZZZZKKKKZZZ..',
    '..ZZZKKKKZZZZZZKKKKZZZ..',
    '..ZzZZKKKKZZZZZZKKKKZzZ..'.slice(0, 24),
    '..ZZZZZZZZZZZZZZZZZZZZ..',
    '..ZZzZZZZZZZZZZZZZzZZZ..',
    '..ZZZZZZKKKKKKZZZZZZZZ..',
    '..ZZZzZZKKKKKKZZZzZZZZ..',
    '..ZZZZZZKKKKKKZZZZZZzZ..',
    '..ZZZZZZKKKKKKZZZZZZZZ..',
    '..ZZzZZZZZZZZZZZZZZzZZ..',
    '..ZZZZZZZZzZZZZZZZZZZZ..',
    '..ZzZZZZZZZZZZZZzZZZZZ..',
    '..ZZZZZZZzZZZZZZZZZZzZ..',
    '........................',
    '........................',
  ],
  launcher: [
    '........................',
    '........................',
    '........................',
    '........................',
    '..............EE........',
    '..............EEE.......',
    '..............EEEE......',
    '..............EEEEE.....',
    '..............EEEEEE....',
    '..............EEEEEEE...',
    '..............EEEEEE....',
    '..............EEEEE.....',
    '..GGGGGGGGGG..EEEE......',
    '..GGGGGGGGGG..EEE.......',
    '..GGGGGGGGGG..EE........',
    '..GDGGDGGDGG..E.........',
    '..DDdDDDdDDD............',
    '..DDDDdDDDDD............',
    '..DdDDDDdDDD............',
    '..DDDDDdDDdD............',
    '..DdDDDdDDDDD............'.slice(0, 24),
    '..DDdDDDDDdDD............'.slice(0, 24),
    '........................',
    '........................',
  ],
  piston: [
    '........................',
    '........................',
    '..WWWWWWWWWWWWWWWWWWWW..',
    '..WWWWWWWWWWWWWWWWWWWW..',
    '..WWWWWWWWWWWWWWWWWWWW..',
    '..WWWWWWWWWWWWWWWWWWWW..',
    '..WWWWJJJJJJJJJJJJWWWW..',
    '..WWWWJKJJJJJJJJKJWWWW..',
    '..WWWWJKJJJJJJJJKJWWWW..',
    '..WWWWJJJJJWWJJJJJWWWW..',
    '..WWWWJJJJJWWJJJJJWWWW..',
    '..WWWWJJJJJWWJJJJJWWWW..',
    '..WWWWJJJJJWWJJJJJWWWW..',
    '..WWWWJJJJJWWJJJJJWWWW..',
    '..WWWWJJJJJWWJJJJJWWWW..',
    '..WWWWJJJJJWWJJJJJWWWW..',
    '..WWWWJKJJJJJJJJKJWWWW..',
    '..WWWWJKJJJJJJJJKJWWWW..',
    '..WWWWJJJJJJJJJJJJWWWW..',
    '..WWWWWWWWWWWWWWWWWWWW..',
    '..WWWWWWWWWWWWWWWWWWWW..',
    '..WWWWWWWWWWWWWWWWWWWW..',
    '........................',
    '........................',
  ],
  anvil: [
    '........................',
    '........................',
    '........................',
    '........................',
    '...JJJJJJJJJJJJJJJJJ...',
    '..JJJJJJJJJJJJJJJJJJJ..',
    '...JJJJJJJJJJJJJJJJ....',
    '.....JJJJJJJJJJJJ......',
    '.......JJJJJJJJ........',
    '........JJJJJJ..........',
    '........JJJJJJ..........',
    '........JJJJJJ..........',
    '........JJJJJJ..........',
    '........JJJJJJ..........',
    '........JJJJJJ..........',
    '......JJJJJJJJJJ........',
    '....JJJJJJJJJJJJJJ......',
    '...JJJJJJJJJJJJJJJJ.....',
    '...jjjjjjjjjjjjjjjj.....',
    '........................',
    '........................',
    '........................',
    '........................',
    '........................',
  ],
  structure: [
    '........................',
    '........................',
    '..KKKKKKKKKKKKKKKKKKKK..',
    '..KKKKKKKKKKKKKKKKKKKK..',
    '..KKEEEEEEEEEEEEEEEEKK..',
    '..KKEEEEEEEEEEEEEEEEKK..',
    '..KKEEEEEEEEEEEEEEEEKK..',
    '..KKEEKKKKKKKKKKKKEEKK..',
    '..KKEEKKKKKKKKKKKKEEKK..',
    '..KKEEKKKKKKKKKKKKEEKK..',
    '..KKEEKKKKKKKKKKKKEEKK..',
    '..KKEEKKKKKKKKKKKKEEKK..',
    '..KKEEKKKKKKKKKKKKEEKK..',
    '..KKEEKKKKKKKKKKKKEEKK..',
    '..KKEEKKKKKKKKKKKKEEKK..',
    '..KKEEKKKKKKKKKKKKEEKK..',
    '..KKEEKKKKKKKKKKKKEEKK..',
    '..KKEEEEEEEEEEEEEEEEKK..',
    '..KKEEEEEEEEEEEEEEEEKK..',
    '..KKEEEEEEEEEEEEEEEEKK..',
    '..KKKKKKKKKKKKKKKKKKKK..',
    '..KKKKKKKKKKKKKKKKKKKK..',
    '........................',
    '........................',
  ],
  diamond: [
    '........................',
    '........................',
    '........................',
    '........................',
    '........................',
    '........EEEEEEEE........',
    '......CCCCCCCCCCCC......',
    '.....CCCCCCCCCCCCCC.....',
    '....cCCCCCCCCCCCCCCC....',
    '....cCCCCCCCCCCCCCCCc...',
    '...cCCCCCCCCCCCCCCCCc...',
    '...cCCCCCCCCCCCCCCCCc...',
    '....CCCCCCCCCCCCCCCC....',
    '....cCCCCCCCCCCCCCCc....',
    '.....CCCCCCCCCCCCCC.....',
    '......CCCCCCCCCCCC......',
    '.......CCCCCCCCCC.......',
    '........CCCCCCCC........',
    '.........CCCCCC.........',
    '..........CCCC..........',
    '...........CC...........',
    '........................',
    '........................',
    '........................',
  ],
  bell: [
    '........................',
    '........................',
    '..........EE............',
    '..........EE............',
    '.........FFFF...........',
    '........FFFFFF..........',
    '.......FFFFFFFF.........',
    '......FFFFFFFFFF........',
    '......FFFFFFFFFF........',
    '.....FFFFFFFFFFF........',
    '.....FFFFFFFFFFF........',
    '....FFFFFFFFFFFFF.......',
    '....FFFFFFFFFFFFF.......',
    '...FFFFFFFFFFFFFFF......',
    '...FFFFFFFFFFFFFFF......',
    '...fFFFFFFFFFFFFFf......',
    '..........KK............',
    '..........KK............',
    '........................',
    '........................',
    '........................',
    '........................',
    '........................',
    '........................',
  ],
  comparator: [
    '........................',
    '........................',
    '........................',
    '........................',
    '........................',
    '.....RRR...RRR...RRR....',
    '.....RRR...RRR...RRR....',
    '.....RRR...RRR...RRR....',
    '.....RRR...RRR...RRR....',
    '.....RRR...RRR...RRR....',
    '..SSSSSSSSSSSSSSSSSSSS..',
    '..SSSsSSSSSSSSsSSSSSSS..',
    '..SSSSSSSsSSSSSSSSSsSS..',
    '..SsSSSSSSSSSSSsSSSSSS..',
    '..SSSSSSsSSSSSSSSSSsSS..',
    '..SSSsSSSSSSSsSSSSSSSS..',
    '..SSSSSSSSSSSSSSSsSSSS..',
    '..SsSSSSsSSSSSSSSSSSsS..',
    '..SSSSSSSSSSSSSSSSSSSS..',
    '........................',
    '........................',
    '........................',
    '........................',
    '........................',
  ],
  tnt: [
    '........................',
    '........................',
    '........................',
    '....RRRRRRRRRRRRRRRR....',
    '....RRRRRRRRRRRRRRRR....',
    '....RRRRRRRRRRRRRRRR....',
    '....RRRRRRRRRRRRRRRR....',
    '....RRRRRRRRRRRRRRRR....',
    '....EEEEEEEEEEEEEEEE....',
    '....EEKKKEEKEEKEEKKE....',
    '....EEKEEEEKEEKEEEKE....',
    '....EEEEEEEKEEKEEEKE....',
    '....EEEEEEEKEEKEEKKE....',
    '....RRRRRRRRRRRRRRRR....',
    '....RRRRRRRRRRRRRRRR....',
    '....RRRRRRRRRRRRRRRR....',
    '....RRRRRRRRRRRRRRRR....',
    '....RRRRRRRRRRRRRRRR....',
    '....rrrrrrrrrrrrrrrr....',
    '........................',
    '........................',
    '........................',
    '........................',
    '........................',
  ],
  bookquill: [
    '........................',
    '........................',
    '................FF......',
    '...............FFFF.....',
    '..............FFFFF.....',
    '.............FFFEE......',
    '............FFFF........',
    '...EEEEELLEEEEEE........',
    '..EEEEEELLEEEEEE........',
    '..EttEEELLEEttEE........',
    '..EttEEELLEEttEE........',
    '..EEEEEELLEEEEE........',
    '..EttEEELLEEttEE........',
    '..EttEEELLEEttEE........',
    '..EEEEEELLEEEEE........',
    '...EEEELLLLEEE..........',
    '....EEELLLLEE...........',
    '.....ELLLLLL............',
    '........................',
    '........................',
    '........................',
    '........................',
    '........................',
    '........................',
  ],
  sign: [
    '........................',
    '........................',
    '..WWWWWWWWWWWWWWWWWWWW..',
    '..WWWWWWWWWWWWWWWWWWWW..',
    '..WWKKKKKKKKKKKWWWWWWW..',
    '..WWKKKKKKKKKKKWWWWWWW..',
    '..WWWWWWWWWWWWWWWWWWWW..',
    '..wwwwwwwwwwwwwwwwwwww..',
    '..WWKKKKKKKKWWWWWWWWWW..',
    '..WWKKKKKKKKWWWWWWWWWW..',
    '..WWWWWWWWWWWWWWWWWWWW..',
    '..WWWWWWWWWWWWWWWWWWWW..',
    '..........WWWW..........',
    '..........WWWW..........',
    '..........WWWW..........',
    '..........WWWW..........',
    '..........WWWW..........',
    '..........WWWW..........',
    '..........WWWW..........',
    '..........WWWW..........',
    '..........WWWW..........',
    '..........wwww..........',
    '........................',
    '........................',
  ],
  hopper: [
    '........................',
    '........................',
    '........................',
    '....JJJJJJJJJJJJJJJJ....',
    '....JKKKKKKKKKKKKKKJ....',
    '....JKKKKKKKKKKKKKKJ....',
    '....JJJJJJJJJJJJJJJJ....',
    '......JJJJJJJJJJJJ......',
    '......JJJJJJJJJJJJ......',
    '........JJJJJJJJ........',
    '........JJJJJJJJ........',
    '..........JJJJ..........',
    '..........JJJJ..........',
    '..........JJJJ..........',
    '..........JJJJ..........',
    '..........JJJJ..........',
    '..........jjjj..........',
    '........................',
    '........................',
    '........................',
    '........................',
    '........................',
    '........................',
    '........................',
  ],
  loop: [
    '........................',
    '........................',
    '........................',
    '......JJJJ..............',
    '.....JJJJJJ.............',
    '....JJJJJJJ.............',
    '....JJJ..........JJJ....',
    '....JJJ.........JJJJJ...',
    '....JJJ........JJJJJJ...',
    '....JJJ........JJJJJ....',
    '....JJJ.........JJJ.....',
    '....JJJ..........JJJ....',
    '....JJJ..........JJJ....',
    '....JJJ..........JJJ....',
    '....JJJ..........JJJ....',
    '....JJJ..........JJJ....',
    '.....JJJJJJ..JJJJJJ.....',
    '......JJJJ....JJJJ......',
    '........EE....JJJ.......',
    '.......EEE....EE........',
    '.......EE....EEE........',
    '.............EE.........',
    '........................',
    '........................',
  ],
  brewing: [
    '........................',
    '........................',
    '..........EEEE..........',
    '..........JJJJ..........',
    '..........JJJJ..........',
    '..........JJJJ..........',
    '..........JJJJ..........',
    '..........JJJJ..........',
    '.....EE...JJJJ...EE.....',
    '.....TT...JJJJ...RR.....',
    '.....TT...JJJJ...RR.....',
    '.....TT...JJJJ...RR.....',
    '.....TT...JJJJ...RR.....',
    '.....TT...JJJJ...RR.....',
    '.....TT...JJJJ...RR.....',
    '.....TT...JJJJ...RR.....',
    '.....TT...JJJJ...RR.....',
    '.....TT...JJJJ...RR.....',
    '..SSSSSSSSSSSSSSSSSSSS..',
    '..SSSsSSSSSSSSsSSSSsSS..',
    '..SSSSSSSsSSSSSSSSsSSS..',
    '........................',
    '........................',
    '........................',
  ],
  map: [
    '........................',
    '........................',
    '..BBBBBBBBBBBBBBBBBBBB..',
    '..BBBBBBBBBBBBBBBBBBBB..',
    '..BBBBBBBBRRRBBBBBBBBB..',
    '..BBBBBBBRRRRRBBBBBBBB..',
    '..BBBBBBBRRRRRBBBBBBBB..',
    '..BBBBBBBRRRBBBBBBBBBB..',
    '..BBBBBBBBKBBBBBBBBBBB..',
    '..BBBBGGGGGGGGBBBBBBBB..',
    '..BBGGGGGGGGGGGGBBBBBB..',
    '..BGGGGGGGGGGGGGGGTBBB..',
    '..BGGGGGGGGGGGGGTTTTBB..',
    '..BGGGGGGGGGGGGTTTTTBB..',
    '..BGGGGGGGGGGGGGTTTTBB..',
    '..BBGGGGGGGGGGGGGTBBBB..',
    '..BBBGGGGGGGGGGGBBBBBB..',
    '..BBBBGGGGGGGGBBBBBBBB..',
    '..BBBBBBBBBBBBBBBBBBBB..',
    '..BBBBBBBBBBBBBBBBBBBB..',
    '..BBBBBBBBBBBBBBBBBBBB..',
    '........................',
    '........................',
    '........................',
  ],
  endframe: [
    '........................',
    '........................',
    '..SSSSSSSSSSSSSSSSSSSS..',
    '..SSsSSSSSSSSsSSSSsSSS..',
    '..SSSSSSSKKKKKKKKSSSSS..',
    '..SsSSSSKKKKKKKKKKSSsS..',
    '..SSSSSKKKKKKKKKKKKSSS..',
    '..SSSsKKKKKKKKKKKKKSsS..',
    '..SSSSKKKKKKKKKKKKKSSS..',
    '..SSSSKKKKCCCCCKKKKSSS..',
    '..SsSSKKKCCEECCKKKKSsS..',
    '..SSSSKKKCCEEECCKKKSSS..',
    '..SSSsKKKCCEEECCKKKSsS..',
    '..SSSSKKKCCEECCKKKKSSS..',
    '..SsSSKKKKCCCCCKKKKSsS..',
    '..SSSSKKKKKKKKKKKKKSSS..',
    '..SSSsKKKKKKKKKKKKKSsS..',
    '..SSSSSKKKKKKKKKKKSSSS..',
    '..SSsSSSKKKKKKKKKSsSSS..',
    '..SSSSSSSSsSSSSSSSSSSS..',
    '..SSSsSSSSSSSSsSSSSSSS..',
    '..SSSSSSSSSSSSSSSSSSSS..',
    '........................',
    '........................',
  ],
  bucket: [
    '........................',
    '........................',
    '........................',
    '......TTTTTTTTTTTT......',
    '.....TTTTTTTTTTTTTT.....',
    '.....TTtTTTTtTTTTtT.....',
    '.....JJJJJJJJJJJJJJ.....',
    '.....JJJJJJJJJJJJJJ.....',
    '.....JJJJJJJJJJJJJJ.....',
    '.....JJJJJJJJJJJJJJ.....',
    '......JJJJJJJJJJJJ......',
    '......JJJJJJJJJJJJ......',
    '......JJJJJJJJJJJJ......',
    '......JJJJJJJJJJJJ......',
    '......JJJJJJJJJJJJ......',
    '......JJJJJJJJJJJJ......',
    '......JJJJJJJJJJJJ......',
    '......jjjjjjjjjjjj......',
    '........................',
    '........................',
    '........................',
    '........................',
    '........................',
    '........................',
  ],
  slot: [
    '........................',
    '........................',
    '........................',
    '...SSSSSSSSSSSSSSSSSS...',
    '...SSSSSSSSSSSSSSSSSS...',
    '...SKKKKKKKKKKKKKKKS...',
    '...SKKKKKKKKKKKKKKKS...',
    '...SKQQQQQQQQQQQQQKS...',
    '...SKQQQQQQQQQQQQQKS...',
    '...SKQQQQQQQQQQQQQKS...',
    '...SKQQQQQQQQQQQQQKS...',
    '...SKQQQQQQQQQQQQQKS...',
    '...SKQQQQQQQQQQQQQKS...',
    '...SKQQQQQQQQQQQQQKS...',
    '...SKQQQQQQQQQQQQQKS...',
    '...SKQQQQQQQQQQQQQKS...',
    '...SKQQQQQQQQQQQQQKS...',
    '...SKQQQQQQQQQQQQQKS...',
    '...SKKKKKKKKKKKKKKKS...',
    '...SKKKKKKKKKKKKKKKS...',
    '...SSSSSSSSSSSSSSSSSS...',
    '...SSSSSSSSSSSSSSSSSS...',
    '........................',
    '........................',
  ],
};

// === 图标名 -> sprite + 选项（名字保持稳定，接入点不改名） ===
const ICONS = {
  // 活动栏（atb-*）
  'atb-folder': { art: 'folder', outline: true },
  'atb-search': { art: 'spyglass', outline: true },
  'atb-git': { art: 'git', outline: true },
  'atb-chest': { art: 'chest', outline: true },
  'atb-ingot': { art: 'ingot', outline: true },
  'atb-grass': { art: 'grass', outline: true },
  'atb-creeper': { art: 'creeper', outline: true },
  'atb-note': { art: 'noteblock', outline: true },
  'atb-cmd': { art: 'cmd', outline: true },
  'atb-gamepad': { art: 'gamepad', outline: true },
  'atb-cog': { art: 'gear', outline: true },
  // Dashboard 类型卡（gen-*）
  'gen-mod': { art: 'crafting', outline: true },
  'gen-datapack': { art: 'book', outline: true },
  'gen-modpack': { art: 'bundle', outline: true },
  'gen-server': { art: 'furnace', outline: true },
  'gen-resource': { art: 'painting', outline: true },
  'gen-skin': { art: 'steve', outline: true },
  'gen-launcher': { art: 'launcher', outline: true },
  'gen-kubejs': { art: 'piston', outline: true },
  'gen-crafttweaker': { art: 'anvil', outline: true },
  'gen-behaviorpack': { art: 'structure', outline: true },
  'gen-enchantment': { art: 'enchantbook', outline: true },
  'gen-behavioritem': { art: 'diamond', outline: true },
  'gen-behaviorentity': { art: 'zombie', outline: true },
  // 低代码节点（node-*）
  'node-item': { art: 'diamond', outline: true },
  'node-block': { art: 'stoneblock', outline: true },
  'node-entity': { art: 'creeper', outline: true },
  'node-recipe': { art: 'crafting', outline: true },
  'node-machine': { art: 'furnace', outline: true },
  'node-multiblock': { art: 'structure', outline: true },
  'node-event': { art: 'bell', outline: true },
  'node-condition': { art: 'comparator', outline: true },
  'node-action': { art: 'tnt', outline: true },
  'node-code': { art: 'bookquill', outline: true },
  'node-comment': { art: 'sign', outline: true },
  'node-variable': { art: 'hopper', outline: true },
  'node-subgraph': { art: 'bundle', outline: true },
  'node-loop': { art: 'loop', outline: true },
  'node-procedure': { art: 'brewing', outline: true },
  'node-biome': { art: 'map', outline: true },
  'node-dimension': { art: 'endframe', outline: true },
  'node-fluid': { art: 'bucket', outline: true },
  'node-gui': { art: 'slot', outline: true },
};

// === 生成 ===
mkdirSync(OUT, { recursive: true });
const groups = {
  '活动栏（atb-*）': (name) => name.startsWith('atb-'),
  'Dashboard 类型（gen-*）': (name) => name.startsWith('gen-'),
  '低代码节点（node-*）': (name) => name.startsWith('node-'),
};

const svgs = {};
let count = 0;
for (const [name, { art, outline }] of Object.entries(ICONS)) {
  const rows = ART[art];
  if (!rows || rows.length !== SIZE) {
    console.warn(`跳过 ${name}：${art} 行数 ${rows?.length ?? 0} != ${SIZE}`);
    continue;
  }
  const svg = renderSprite(rows, { outline });
  writeFileSync(join(OUT, `${name}.svg`), svg, 'utf8');
  svgs[name] = svg;
  count++;
}
console.log(`已生成 ${count} 个图标 -> ${OUT}`);

// === 预览页（人工审查用） ===
const sectionHtml = Object.entries(groups)
  .map(([title, match]) => {
    const cells = Object.entries(svgs)
      .filter(([name]) => match(name))
      .map(([name, svg]) => {
        const inner = svg.replace(/<\/?svg[^>]*>/g, '');
        return `<div class="cell">
          <div class="big"><svg viewBox="0 0 24 24" shape-rendering="crispEdges">${inner}</svg></div>
          <div class="mid"><svg viewBox="0 0 24 24" shape-rendering="crispEdges">${inner}</svg></div>
          <div class="sml"><svg viewBox="0 0 24 24" shape-rendering="crispEdges">${inner}</svg></div>
          <div class="name">${name}</div>
        </div>`;
      })
      .join('\n');
    return `<h2>${title}</h2><div class="grid">${cells}</div>`;
  })
  .join('\n');

const html = `<!doctype html>
<html lang="zh">
<head>
<meta charset="utf-8">
<title>MC 像素图标预览</title>
<style>
  body { background: #14130f; color: #ece8da; font-family: system-ui, "Microsoft YaHei", sans-serif; padding: 24px; }
  h2 { color: #8bc34a; font-size: 14px; margin: 24px 0 12px; border-bottom: 1px solid #3a352a; padding-bottom: 6px; }
  .grid { display: flex; flex-wrap: wrap; gap: 12px; }
  .cell { background: #1c1a15; border: 1px solid #3a352a; border-radius: 4px; padding: 10px; text-align: center; }
  .cell svg { image-rendering: pixelated; display: block; }
  .big svg { width: 96px; height: 96px; }
  .mid svg { width: 48px; height: 48px; }
  .sml svg { width: 24px; height: 24px; }
  .cell > div { margin: 0 auto 6px; }
  .name { font-size: 11px; color: #b6b098; font-family: monospace; }
  .sml { display: flex; align-items: center; justify-content: center; height: 24px; }
</style>
</head>
<body>
<h1 style="font-size:16px">MC 像素图标预览（24/48/96 px，暗底）</h1>
${sectionHtml}
</body>
</html>
`;
writeFileSync(join(__dirname, 'icon-preview.html'), html, 'utf8');
console.log(`预览页 -> ${join(__dirname, 'icon-preview.html')}`);
