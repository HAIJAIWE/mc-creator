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

// 渲染 icon（每个 24x24 网格单元按目标尺寸最近邻缩放）
function renderIcon(size) {
  const scale = size / 24;
  const rgba = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const gx = Math.min(23, Math.floor(x / scale));
      const gy = Math.min(23, Math.floor(y / scale));
      const cell = GRID[gy][gx];
      const c = cell === 2 ? GRASS : cell === 3 ? DIRT_SPECK : DIRT;
      const idx = (y * size + x) * 4;
      rgba[idx] = c[0];
      rgba[idx + 1] = c[1];
      rgba[idx + 2] = c[2];
      rgba[idx + 3] = c[3];
    }
  }
  return rgba;
}

/** ICO 容器：单 256x256 PNG 负载（Vista+ 支持，与 electron-builder win.icon 兼容） */
function encodeICO(png256) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(1, 4); // count
  const entry = Buffer.alloc(16);
  entry[0] = 0; // width 0 = 256
  entry[1] = 0; // height 0 = 256
  entry[2] = 0; // no palette
  entry[3] = 0; // reserved
  entry.writeUInt16LE(1, 4); // planes
  entry.writeUInt16LE(32, 6); // bit count
  entry.writeUInt32LE(png256.length, 8); // bytes
  entry.writeUInt32LE(6 + 16, 12); // offset
  return Buffer.concat([header, entry, png256]);
}

/** ICNS 容器：ic07(128) + ic08(256) PNG 负载（与 electron-builder mac.icon 兼容） */
function encodeICNS(png128, png256) {
  const entries = [];
  for (const [type, data] of [
    ['ic07', png128],
    ['ic08', png256],
  ]) {
    const head = Buffer.alloc(8);
    head.write(type, 0, 'ascii');
    head.writeUInt32BE(8 + data.length, 4);
    entries.push(head, data);
  }
  const body = Buffer.concat(entries);
  const head = Buffer.alloc(8);
  head.write('icns', 0, 'ascii');
  head.writeUInt32BE(8 + body.length, 4);
  return Buffer.concat([head, body]);
}

// 输出目录与 electron-builder.yml directories.buildResources 对齐
const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'build-resources');
mkdirSync(outDir, { recursive: true });
const png256 = encodePNG(SIZE, SIZE, renderIcon(SIZE));
const png128 = encodePNG(128, 128, renderIcon(128));
writeFileSync(join(outDir, 'icon.png'), png256);
console.log(`icon.png: ${png256.length} bytes`);
const ico = encodeICO(png256);
writeFileSync(join(outDir, 'icon.ico'), ico);
console.log(`icon.ico: ${ico.length} bytes`);
const icns = encodeICNS(png128, png256);
writeFileSync(join(outDir, 'icon.icns'), icns);
console.log(`icon.icns: ${icns.length} bytes`);
