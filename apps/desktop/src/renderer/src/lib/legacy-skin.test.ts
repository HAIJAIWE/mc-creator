/**
 * legacy `64×32` → 现代 `64×64` 的搬运规则。
 *
 * 断言都是**可证伪**的：位置、槽位对应、以及「不丢像素也不重像素」（双射）。
 * 规则一旦漂了（比如把「左肢 = 右肢镜像」写成整体翻转），这里会红。
 */
import { describe, it, expect } from 'vitest';

import {
  LEGACY_TO_MODERN_COPIES,
  LIMB_SLOT_MAP,
  isLegacySkinSize,
  mapLegacyPixel,
} from './legacy-skin.js';

describe('legacy-skin · 64×32 → 64×64 搬运规则', () => {
  it('第一层原位搬：legacy 的 y<32 与 modern 的 y<32 网格一一对应', () => {
    const first = LEGACY_TO_MODERN_COPIES[0]!;
    expect(first.transform).toBe('copy');
    expect(first.src).toEqual({ x: 0, y: 0, w: 64, h: 32 });
    expect(first.dst).toEqual({ x: 0, y: 0, w: 64, h: 32 });
  });

  it('左臂取右臂网格、左腿取右腿网格，且落在现代布局的位置', () => {
    const leftArm = LEGACY_TO_MODERN_COPIES.find((c) => c.dst.x === 32 && c.dst.y === 48)!;
    expect(leftArm).toBeDefined();
    expect(leftArm.src).toEqual({ x: 40, y: 16, w: 16, h: 16 });
    expect(leftArm.transform).toBe('mirrorLimb');

    const leftLeg = LEGACY_TO_MODERN_COPIES.find((c) => c.dst.x === 16 && c.dst.y === 48)!;
    expect(leftLeg).toBeDefined();
    expect(leftLeg.src).toEqual({ x: 0, y: 16, w: 16, h: 16 });
    expect(leftLeg.transform).toBe('mirrorLimb');
  });

  it('肢体镜像：两个侧面互换，前面/背面留在原槽', () => {
    expect(LIMB_SLOT_MAP).toEqual([2, 1, 0, 3]);
  });

  it('像素落点：右臂前面 → 左臂前面（面内水平翻转）', () => {
    const leftArm = LEGACY_TO_MODERN_COPIES.find((c) => c.dst.x === 32 && c.dst.y === 48)!;
    // 右臂前面：网格内第 2 个槽位（列 4-7）、行 4 起
    const target = mapLegacyPixel(leftArm, 40 + 4, 16 + 4)!;
    expect(target).not.toBeNull();
    // 落到左臂前面的同一槽位，列内翻转（列 4 → 列 7）
    expect(target.x).toBe(32 + 7);
    expect(target.y).toBe(48 + 4);
  });

  it('像素落点：右臂左面 → 左臂右面（两个侧面互换）', () => {
    const leftArm = LEGACY_TO_MODERN_COPIES.find((c) => c.dst.x === 32 && c.dst.y === 48)!;
    // 右臂左面 = 网格第 1 个槽位（列 0-3）
    const target = mapLegacyPixel(leftArm, 40 + 0, 16 + 4)!;
    // 左臂的「右面」= 第 3 个槽位（列 8-11），列内翻转（列 0 → 列 3）
    expect(target.x).toBe(32 + 8 + 3);
    expect(target.y).toBe(48 + 4);
  });

  it('像素落点：上下面原位翻转（不参与左右互换）', () => {
    const leftArm = LEGACY_TO_MODERN_COPIES.find((c) => c.dst.x === 32 && c.dst.y === 48)!;
    // 上表面：网格第 2 个槽位（列 4-7）、行 0-3
    const target = mapLegacyPixel(leftArm, 40 + 4, 16 + 0)!;
    expect(target.x).toBe(32 + 4 + 3);
    expect(target.y).toBe(48 + 0);
  });

  it('像素落点是双射：16×16 的肢体网格不丢像素、也不重叠', () => {
    const leftArm = LEGACY_TO_MODERN_COPIES.find((c) => c.dst.x === 32 && c.dst.y === 48)!;
    const seen = new Set<string>();
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        const t = mapLegacyPixel(leftArm, 40 + x, 16 + y)!;
        expect(t).not.toBeNull();
        const key = `${t.x},${t.y}`;
        expect(seen.has(key), `像素 ${key} 被搬了两次`).toBe(false);
        seen.add(key);
        // 落点必须在左臂的网格里
        expect(t.x).toBeGreaterThanOrEqual(32);
        expect(t.x).toBeLessThan(48);
        expect(t.y).toBeGreaterThanOrEqual(48);
        expect(t.y).toBeLessThan(64);
      }
    }
    expect(seen.size).toBe(256);
  });

  it('源矩形外的像素不搬运', () => {
    const first = LEGACY_TO_MODERN_COPIES[0]!;
    expect(mapLegacyPixel(first, 0, 32)).toBeNull();
    expect(mapLegacyPixel(first, 64, 0)).toBeNull();
    expect(mapLegacyPixel(first, -1, 0)).toBeNull();
  });

  it('isLegacySkinSize 只认 64×32', () => {
    expect(isLegacySkinSize(64, 32)).toBe(true);
    expect(isLegacySkinSize(64, 64)).toBe(false);
    expect(isLegacySkinSize(128, 128)).toBe(false);
    expect(isLegacySkinSize(32, 64)).toBe(false);
  });
});
