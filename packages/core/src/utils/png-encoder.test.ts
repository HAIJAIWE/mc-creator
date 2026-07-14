import { describe, it, expect } from 'vitest';
import {
  encodePng,
  createBuffer,
  fillSolid,
  fillGradient,
  fillCheckerboard,
  hexToRgb,
} from './png-encoder.js';

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);

describe('png-encoder', () => {
  it('encodePng 输出以 PNG signature 开头', () => {
    const buf = createBuffer(2, 2);
    fillSolid(buf, 255, 0, 0);
    const png = encodePng(buf);
    expect(png.subarray(0, 8)).toEqual(PNG_SIG);
  });

  it('encodePng 输出以 IEND chunk 结尾', () => {
    const buf = createBuffer(4, 4);
    fillSolid(buf, 0, 255, 0);
    const png = encodePng(buf);
    // IEND chunk: length(4)=0 + type(4)='IEND' + crc(4)
    const tail = png.subarray(png.length - 12, png.length);
    const len = tail.readUInt32BE(0);
    expect(len).toBe(0);
    expect(tail.subarray(4, 8).toString('ascii')).toBe('IEND');
  });

  it('hexToRgb 正确解析 #FF0000 → [255, 0, 0]', () => {
    expect(hexToRgb('#FF0000')).toEqual([255, 0, 0]);
    expect(hexToRgb('#00ff00')).toEqual([0, 255, 0]);
    expect(hexToRgb('#0000ff')).toEqual([0, 0, 255]);
    expect(hexToRgb('#ffffff')).toEqual([255, 255, 255]);
  });

  it('hexToRgb 非法输入返回白色 [255,255,255]', () => {
    expect(hexToRgb('not-a-color')).toEqual([255, 255, 255]);
    expect(hexToRgb('#FFF')).toEqual([255, 255, 255]); // 长度不对
  });

  it('fillSolid 后 encodePng 不崩溃，且输出长度合理（>0）', () => {
    const buf = createBuffer(16, 16);
    fillSolid(buf, 10, 20, 30);
    const png = encodePng(buf);
    expect(png.length).toBeGreaterThan(0);
    // 至少包含 signature + IHDR(25) + IEND(12)
    expect(png.length).toBeGreaterThanOrEqual(8 + 25 + 12);
  });

  it('fillGradient 后 encodePng 不崩溃', () => {
    const buf = createBuffer(8, 16);
    fillGradient(buf, 255, 0, 0, 0, 0, 255);
    const png = encodePng(buf);
    expect(png.length).toBeGreaterThan(0);
    expect(png.subarray(0, 8)).toEqual(PNG_SIG);
  });

  it('fillCheckerboard 后 encodePng 不崩溃', () => {
    const buf = createBuffer(8, 8);
    fillCheckerboard(buf, 255, 255, 255, 0, 0, 0, 2);
    const png = encodePng(buf);
    expect(png.length).toBeGreaterThan(0);
    expect(png.subarray(0, 8)).toEqual(PNG_SIG);
  });

  it('1x1 图像也能正确编码', () => {
    const buf = createBuffer(1, 1);
    fillSolid(buf, 128, 64, 32);
    const png = encodePng(buf);
    expect(png.subarray(0, 8)).toEqual(PNG_SIG);
    // IHDR width/height 应为 1
    const width = png.readUInt32BE(8 + 4 + 4); // sig(8) + len(4) + type(4)
    const height = png.readUInt32BE(8 + 4 + 4 + 4);
    expect(width).toBe(1);
    expect(height).toBe(1);
  });
});
