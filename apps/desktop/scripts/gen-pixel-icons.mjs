// 像素图标生成器：把 16x16 的 ASCII 画板转成带黑色描边的 SVG sprite。
// 用法：node scripts/gen-pixel-icons.mjs
// 每个图标 = 16 行字符串，每行 16 个字符；字符映射到调色板颜色，空格=透明。
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, '..', 'src', 'renderer', 'src', 'assets', 'mc-ui', 'pixel');

// 调色板：字符 -> 颜色（贴近 Minecraft 方块/物品配色）
const PAL = {
  ' ': null,
  O: '#15151a', // 黑色描边
  G: '#5fb14b', // 草绿（顶）
  g: '#3f8a2e', // 草绿（暗）
  D: '#8a5a32', // 泥土
  d: '#6b4420', // 泥土（暗）
  W: '#b5854b', // 木板
  w: '#8a5a2e', // 木板（暗）
  S: '#9a9a9a', // 石头
  s: '#6e6e6e', // 石头（暗）
  J: '#d2d2d2', // 铁/灰亮
  j: '#9a9a9a', // 铁/灰暗
  R: '#d63b3b', // 红石
  r: '#a82a2a', // 红石暗
  C: '#5fd6d6', // 钻石青
  c: '#3fb8b8', // 钻石青暗
  F: '#d4af37', // 金
  f: '#a8851f', // 金暗
  P: '#6b47b3', // 紫
  p: '#4b2e83', // 紫暗
  B: '#e8d8b0', // 书页
  b: '#c9b888', // 书页暗
  L: '#7a3b2e', // 皮革棕
  l: '#5a2a20', // 皮革棕暗
  N: '#caa472', // 皮肤
  n: '#8a6848', // 皮肤暗
  H: '#3b7d2e', // 头发绿
  Q: '#5bbf3b', // 苦力怕绿
  q: '#3a8a22', // 苦力怕绿暗
  E: '#f4f4f4', // 白
  T: '#3a6fb0', // 蓝
  t: '#2a558a', // 蓝暗
  V: '#d63b3b', // 红（画）
  Y: '#f0cf5a', // 黄（画）
  X: '#c8722e', // 命令方块橙
  x: '#8a4a18', // 命令方块橙暗
  M: '#d9d9d9', // 结构方块白
  m: '#9a9a9a', // 结构方块灰
};

// 每个图标：name -> 16 行 ASCII
const ICONS = {
  'gen-mod': [
    '     OOOOOO     ',
    '   OOGGGGGGOO   ',
    '  OGGGGGGGGGGO  ',
    ' OGGGGGGGGGGGGO ',
    ' OGGGgggggggGGO ',
    ' OGGGGGGGGGGGGO ',
    ' ODDDDDDDDDDDDO ',
    ' ODdDDDdDDDdDDO ',
    ' ODDDDDDDDDDDDO ',
    ' ODdDDDdDDDdDDO ',
    ' ODDDDDDDDDDDDO ',
    ' ODdDDDdDDDdDDO ',
    ' ODDDDDDDDDDDDO ',
    ' OOOOOOOOOOOOOO ',
    '                ',
    '                ',
  ],
  'gen-datapack': [
    '                ',
    '   OOOOOOOOO    ',
    '  OLLLLLLLLLO   ',
    ' OLLLLLLLLLLLO  ',
    ' OLbBBBBBBbLLO  ',
    ' OLbBBBBBBbLLO  ',
    ' OLbBBBBBBbLLO  ',
    ' OLbBBBBBBbLLO  ',
    ' OLbBBBBBBbLLO  ',
    ' OLbBBBBBBbLLO  ',
    ' OLLLLLLLLLLLO  ',
    '  OOOOOOOOOOO   ',
    '    OFFFFO      ',
    '    OFFFO       ',
    '    OEEEO       ',
    '                ',
  ],
  'gen-modpack': [
    '                ',
    '  OOOOOOOOOOOO  ',
    ' OWWWWWWWWWWWWO ',
    ' OWwWWWWWWWWwWO ',
    ' OWWWWWWWWWWWWO ',
    ' OwwwwwwwwwwwWO ',
    ' OWWWWWWWWWWWWO ',
    ' OOOOOOOOOOOOOO ',
    ' OddddddddddddO ',
    ' OdOOOOOOOOOOdO ',
    ' OdOfFFFFfOOOdO ',
    ' OdOfFFFFfOOOdO ',
    ' OdOOOOOOOOOOdO ',
    ' OddddddddddddO ',
    ' OOOOOOOOOOOOOO ',
    '                ',
  ],
  'gen-server': [
    '                ',
    '  OOOOOOOOOOOO  ',
    ' OXXXXXXXXXXO   ',
    ' OXxxXxxXxxXXO  ',
    ' OXXXXXXXXXXO   ',
    ' OXXOOOOOOXXO   ',
    ' OXXOCCCcOXXO   ',
    ' OXXOCCCcOXXO   ',
    ' OXXOOOOOOXXO   ',
    ' OXXXXXXXXXXO   ',
    ' OXxxXxxXxxXXO  ',
    ' OXXXXXXXXXXO   ',
    ' OOOOOOOOOOOO   ',
    '                ',
    '                ',
    '                ',
  ],
  'gen-resource': [
    '                ',
    '  OOOOOOOOOOOO  ',
    ' OWWWWWWWWWWWWO ',
    ' OWwWWWWWWWWwWO ',
    ' OWWWWWWWWWWWWO ',
    ' OOOOOOOOOOOOOO ',
    ' OOEVVVOYYVOOO  ',
    ' OVVVVVOYYVOOO  ',
    ' OVVVVOOTTTVOO  ',
    ' OVVVOOTTTTVOO  ',
    ' OOETTTTTTVOOO  ',
    ' OOETTTTTTVOOO  ',
    ' OOOTTTTTVOOO   ',
    ' OOOOOOOOOOOO   ',
    '                ',
    '                ',
  ],
  'gen-skin': [
    '                ',
    '   OOOOOOOO     ',
    '  OHHHHHHHHO    ',
    ' OHHHHHHHHHHO   ',
    ' OHhHHHHHHhHO   ',
    ' OHHHHHHHHHHO   ',
    ' ONNNNNNNNNNO   ',
    ' ONnNNNNNNnNO   ',
    ' OOOOOOOOOOOO   ',
    ' ONnNNNNNNnNO   ',
    ' ONnNNNNNNnNO   ',
    ' ONnNNNNNNnNO   ',
    ' OOOOOOOOOOOO   ',
    '                ',
    '                ',
    '                ',
  ],
  'gen-launcher': [
    '                ',
    '    OOOOOO      ',
    '  OOjjjjjjOO    ',
    ' OjjjjjjjjjjO   ',
    ' OjSjjjjjjSjO   ',
    ' OjjjjjjjjjjO   ',
    ' OOOOOOOOOOOO   ',
    ' OOOOOOOOOOOO   ',
    '  OO      OO    ',
    '  OO      OO    ',
    ' OOOO    OOOO   ',
    ' OOOO    OOOO   ',
    '  OO      OO    ',
    '  OO      OO    ',
    '                ',
    '                ',
  ],
  'gen-kubejs': [
    '                ',
    '    OOOO        ',
    '   OjjjjO       ',
    '   OjSSjO       ',
    ' OOOOOOOOOOOO   ',
    ' ORjSSSSSSjRO   ',
    ' ORjSjjjjSjRO   ',
    ' ORjSSSSSSjRO   ',
    ' OOOOOOOOOOOO   ',
    '   OjjjjO       ',
    '   OjSSjO       ',
    '    OOOO        ',
    '                ',
    '                ',
    '                ',
    '                ',
  ],
  'gen-crafttweaker': [
    '                ',
    '  OOOOOOOOOOOO  ',
    ' OWWWWWWWWWWWWO ',
    ' OWwWWWWWWWWwWO ',
    ' OWWWWWWWWWWWWO ',
    ' OwwwwwwwwwwwWO ',
    ' OOOOOOOOOOOOOO ',
    ' OOOOOOOOOOOOOO ',
    ' OOObOOObOOOOO  ',
    ' OOObOOObOOOOO  ',
    ' OOOOOOOOOOOOOO ',
    ' OOOOOOOOOOOOOO ',
    ' OOOOOOOOOOOOOO ',
    '  OOOOOOOOOOOO  ',
    '                ',
    '                ',
  ],
  'gen-behaviorpack': [
    '                ',
    '  OOOOOOOOOOOO  ',
    ' OMMMMMMMMMMMMO ',
    ' OMmMMMMMMMmMMO ',
    ' OMMMMMMMMMMMMO ',
    ' OMMMMMMMMMMMMO ',
    ' OOOOOOOOOOOOOO ',
    ' OOOTTTTTTOOOO  ',
    ' OOTmmmmmmTOOO  ',
    ' OOTmEEEEmTOOO  ',
    ' OOTmEEEEmTOOO  ',
    ' OOTmmmmmmTOOO  ',
    ' OOTTTTTTTOOOO  ',
    ' OOOOOOOOOOOO   ',
    '                ',
    '                ',
  ],
  'gen-enchantment': [
    '                ',
    '   OOOOOOOOO    ',
    '  OPPPPPPPPPO   ',
    ' OPLLLLLLLLLO   ',
    ' OPLbBBBBbLLO   ',
    ' OPLbBBBBbLLO   ',
    ' OPLbBBBBbLLO   ',
    ' OPLbBBBBbLLO   ',
    ' OPLbBBBBbLLO   ',
    ' OPLLLLLLLLLO   ',
    '  OOOOOOOOOO    ',
    '    OCCCCO      ',
    '    OCccCO      ',
    '    OCCCCO      ',
    '                ',
    '                ',
  ],
  'gen-behavioritem': [
    '                ',
    '      OO        ',
    '     OCCO       ',
    '    OCccCO      ',
    '   OCccccCO     ',
    '  OCcccccCCO    ',
    '  OCcCCCccCO    ',
    '  OCcccccCCO    ',
    '   OCccccCO     ',
    '    OCccCO      ',
    '     OCCO       ',
    '      OO        ',
    '                ',
    '                ',
    '                ',
    '                ',
  ],
  'gen-behaviorentity': [
    '                ',
    '   OOOOOOOO     ',
    '  OQQQQQQQQO    ',
    ' OQQQQQQQQQQO   ',
    ' OQqQQQQQQqQO   ',
    ' OQQOOOOOOQQO   ',
    ' OQOQOOOOQOQO   ',
    ' OQOQOOOOQOQO   ',
    ' OQQQOqqOQQQO   ',
    ' OQQQOqqOQQQO   ',
    ' OQQQQQQQQQQO   ',
    ' OQqQQQQQQqQO   ',
    ' OOOOOOOOOOOO   ',
    '                ',
    '                ',
    '                ',
  ],
};

function toSvg(rows) {
  const rects = [];
  rows.forEach((row, y) => {
    const norm = row.padEnd(16, ' ').slice(0, 16);
    for (let x = 0; x < 16; x++) {
      const ch = norm[x];
      const color = PAL[ch];
      if (!color) continue;
      rects.push(`<rect x="${x}" y="${y}" width="1" height="1" fill="${color}"/>`);
    }
  });
  return `<svg viewBox="0 0 16 16" shape-rendering="crispEdges" xmlns="http://www.w3.org/2000/svg">${rects.join('')}</svg>\n`;
}

mkdirSync(OUT, { recursive: true });
let count = 0;
for (const [name, rows] of Object.entries(ICONS)) {
  if (rows.length !== 16) {
    console.warn(`跳过 ${name}: 行数 ${rows.length} != 16`);
    continue;
  }
  const svg = toSvg(rows);
  writeFileSync(join(OUT, `${name}.svg`), svg, 'utf8');
  count++;
}
console.log(`已生成 ${count} 个图标 -> ${OUT}`);
