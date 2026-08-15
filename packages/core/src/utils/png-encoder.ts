import { deflate } from 'pako';

/** 像素数据（RGBA）。用 Uint8Array 以便浏览器与 Node 同构运行。 */
export interface PixelBuffer {
  width: number;
  height: number;
  data: Uint8Array; // width * height * 4 字节
}

/** 设置像素颜色 */
export function setPixel(
  buf: PixelBuffer,
  x: number,
  y: number,
  r: number,
  g: number,
  b: number,
  a: number = 255,
): void {
  if (x < 0 || x >= buf.width || y < 0 || y >= buf.height) return;
  const i = (y * buf.width + x) * 4;
  buf.data[i] = r;
  buf.data[i + 1] = g;
  buf.data[i + 2] = b;
  buf.data[i + 3] = a;
}

/** 用纯色填充 */
export function fillSolid(
  buf: PixelBuffer,
  r: number,
  g: number,
  b: number,
  a: number = 255,
): void {
  for (let i = 0; i < buf.data.length; i += 4) {
    buf.data[i] = r;
    buf.data[i + 1] = g;
    buf.data[i + 2] = b;
    buf.data[i + 3] = a;
  }
}

/** 垂直渐变 */
export function fillGradient(
  buf: PixelBuffer,
  r1: number,
  g1: number,
  b1: number,
  r2: number,
  g2: number,
  b2: number,
): void {
  for (let y = 0; y < buf.height; y++) {
    const t = buf.height === 1 ? 0 : y / (buf.height - 1);
    const r = Math.round(r1 + (r2 - r1) * t);
    const g = Math.round(g1 + (g2 - g1) * t);
    const b = Math.round(b1 + (b2 - b1) * t);
    for (let x = 0; x < buf.width; x++) setPixel(buf, x, y, r, g, b, 255);
  }
}

/** 棋盘格 */
export function fillCheckerboard(
  buf: PixelBuffer,
  r1: number,
  g1: number,
  b1: number,
  r2: number,
  g2: number,
  b2: number,
  cellSize: number = 1,
): void {
  for (let y = 0; y < buf.height; y++) {
    for (let x = 0; x < buf.width; x++) {
      const isAlt = (Math.floor(x / cellSize) + Math.floor(y / cellSize)) % 2 === 1;
      const [r, g, b] = isAlt ? [r2, g2, b2] : [r1, g1, b1];
      setPixel(buf, x, y, r, g, b, 255);
    }
  }
}

/** 创建像素缓冲 */
export function createBuffer(width: number, height: number): PixelBuffer {
  return { width, height, data: new Uint8Array(width * height * 4) };
}

/** hex #RRGGBB -> [r,g,b] */
export function hexToRgb(hex: string): [number, number, number] {
  const m = /^#([0-9a-fA-F]{2})([0-9a-fA-F]{2})([0-9a-fA-F]{2})$/.exec(hex);
  if (!m) return [255, 255, 255];
  return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
}

/** 将 PixelBuffer 编码为 PNG 字节（Uint8Array，浏览器与 Node 通用） */
export function encodePng(buf: PixelBuffer): Uint8Array {
  const sig = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = new Uint8Array(13);
  writeUInt32BE(ihdr, 0, buf.width);
  writeUInt32BE(ihdr, 4, buf.height);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace
  // IDAT raw: 每行 1 字节 filter(0) + width*4 字节 RGBA
  const rowSize = buf.width * 4 + 1;
  const raw = new Uint8Array(rowSize * buf.height);
  for (let y = 0; y < buf.height; y++) {
    raw[y * rowSize] = 0; // filter none
    raw.set(buf.data.subarray(y * buf.width * 4, (y + 1) * buf.width * 4), y * rowSize + 1);
  }
  const idat = deflate(raw);
  return concatBytes([
    sig,
    makeChunk('IHDR', ihdr),
    makeChunk('IDAT', idat),
    makeChunk('IEND', new Uint8Array(0)),
  ]);
}

/** 字节数组 base64 编码（浏览器用 btoa，Node 用 Buffer），用于 PNG 存入 FileNode.content */
export function toBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('base64');
  }
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function makeChunk(type: string, data: Uint8Array): Uint8Array {
  const len = new Uint8Array(4);
  writeUInt32BE(len, 0, data.length);
  const typeBuf = Uint8Array.from(type, (c) => c.charCodeAt(0));
  const crcBuf = new Uint8Array(4);
  writeUInt32BE(crcBuf, 0, crc32(concatBytes([typeBuf, data])));
  return concatBytes([len, typeBuf, data, crcBuf]);
}

function writeUInt32BE(target: Uint8Array, offset: number, value: number): void {
  target[offset] = (value >>> 24) & 0xff;
  target[offset + 1] = (value >>> 16) & 0xff;
  target[offset + 2] = (value >>> 8) & 0xff;
  target[offset + 3] = value & 0xff;
}

function concatBytes(chunks: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const c of chunks) total += c.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}

function crc32(buf: Uint8Array): number {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
