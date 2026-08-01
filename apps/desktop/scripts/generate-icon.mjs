/**
 * 生成应用图标 build/icon.png（256x256，grass block 风格，与 McMark 一致）。
 * 纯 Node 实现：手写 PNG 编码（zlib deflate + CRC32），无第三方依赖。
 * 用法: node scripts/generate-icon.mjs
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SIZE = 256;

// McMark 的矩形（viewBox 24x24）→ 缩放到 256
// 颜色
const DIRT = [107, 86, 56, 255]; // #6b5638
const GRASS = [124, 189, 107, 255]; // #7cbd6b（草绿，取 mc-accent 近似）
const DIRT_SPECK = [125, 102, 63, 255]; // #7d663f

// 24x24 网格:1 = dirt,2 = grass top,3 = dirt speck
const GRID = (() => {
  const g = Array.from({ length: 24 }, () => new Array(24).fill(1));
  // 草皮顶 (0-8)
  for (let y = 0; y < 9; y++) for (let x = 0; x < 24; x++) g[y][x] = 2;
  // 草皮垂落块
  for (let y = 9; y < 12; y++) for (let x = 3; x < 6; x++) g[y][x] = 2;
  for (let y = 9; y < 13; y++) for (let x = 11; x < 15; x++) g[y][x] = 2;
  for (let y = 9; y < 12; y++) for (let x = 18; x < 20; x++) g[y][x] = 2;
  // 泥土斑点
  g[14][6] = 3;
  g[14][7] = 3;
  g[17][15] = 3;
  g[17][16] = 3;
  g[19][9] = 3;
  g[19][10] = 3;
  return g;
})();

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function encodePNG(width, height, rgba) {
  // raw scanlines: 每行前加 filter byte 0
  const raw = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    raw[y * (1 + width * 4)] = 0;
    rgba.copy(raw, y * (1 + width * 4) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// 渲染 256x256（每个 24x24 网格单元 = 256/24 ≈ 10.67px，用最近邻缩放）
const scale = SIZE / 24;
const px = Buffer.alloc(SIZE * SIZE * 4);
for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    const gx = Math.min(23, Math.floor(x / scale));
    const gy = Math.min(23, Math.floor(y / scale));
    const cell = GRID[gy][gx];
    const c = cell === 2 ? GRASS : cell === 3 ? DIRT_SPECK : DIRT;
    const idx = (y * SIZE + x) * 4;
    px[idx] = c[0];
    px[idx + 1] = c[1];
    px[idx + 2] = c[2];
    px[idx + 3] = c[3];
  }
}

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'build');
mkdirSync(outDir, { recursive: true });
const png = encodePNG(SIZE, SIZE, px);
writeFileSync(join(outDir, 'icon.png'), png);
console.log(`icon.png 已生成: ${png.length} bytes`);
