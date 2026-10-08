/**
 * 皮肤布局测试（§5.9 / §6.4）。
 *
 * 核心判据是**官方给的可用像素数**：布局展开后每层必须精确等于
 * 1632 / 1568 / 6528 / 6272（minecraft.wiki Skin 页 Features 段）。
 * 这让「布局对不对」变成机器可判，而不是「看起来像」。
 *
 * 数字来自本仓自己，若坐标表写错这里必红 —— 变异测试见 commit 记录。
 */
import { describe, expect, it } from 'vitest';
import {
  ACCEPTED_SKIN_SIZES,
  FACE_IDS,
  OFFICIAL_USABLE_PIXELS,
  OUTER_UNRESOLVED_REASON,
  countTransparentInnerPixels,
  layout64,
  layout128,
  layoutFor,
  overlapsBetweenLayers,
  unresolvedOuterParts,
  usablePixels,
  validateSkinLayout,
  validateSkinPngSize,
} from './skin-layout.js';

describe('官方可用像素数（本文件的判据来源）', () => {
  it('与官方页面一致：64 classic 1632、64 slim 1568、128 classic 6528、128 slim 6272', () => {
    expect(OFFICIAL_USABLE_PIXELS['64-classic']).toBe(1632);
    expect(OFFICIAL_USABLE_PIXELS['64-slim']).toBe(1568);
    expect(OFFICIAL_USABLE_PIXELS['128-classic']).toBe(6528);
    expect(OFFICIAL_USABLE_PIXELS['128-slim']).toBe(6272);
  });
});

describe('§5.9 布局像素数：与官方精确一致', () => {
  it('64×64 classic 内层 1632；整层 3264 = 官方两层总数（内 1632 + 已解析 outer 384）', () => {
    const l = layout64('classic');
    expect(usablePixels(l, 'inner')).toBe(1632);
    // head outer 六面共 6×8×8 = 384。官方整层 3264 = 内 1632 + 外 1632，
    // 外层只有 head 已解析，故此处按已解析部分断言，不假装凑满 3264。
    expect(usablePixels(l, 'outer')).toBe(384);
  });

  it('64×64 slim 内层 1568（比 classic 少 64 = 两只手臂各 32）', () => {
    const l = layout64('slim');
    expect(usablePixels(l, 'inner')).toBe(1568);
    expect(usablePixels(l, 'outer')).toBe(384);
    expect(1632 - 1568).toBe(64);
  });

  it('128×128 classic 内层 6528', () => {
    expect(usablePixels(layout128('classic'), 'inner')).toBe(6528);
  });

  it('128×128 slim 内层 6272', () => {
    expect(usablePixels(layout128('slim'), 'inner')).toBe(6272);
  });

  it('128 是 64 的四倍（像素数而非坐标）', () => {
    expect(usablePixels(layout128('classic'), 'inner')).toBe(
      usablePixels(layout64('classic'), 'inner') * 4,
    );
  });
});

describe('§5.9「第二层 64×64（帽子/外套）」：只解析有官方依据的部分', () => {
  it('头部（帽子）有 outer，且在内层整体 +32 偏移处', () => {
    const l = layout64('classic');
    expect(l.head.outer).toBeDefined();
    for (const face of FACE_IDS) {
      expect(l.head.outer![face].x, face).toBe(l.head.inner[face].x + 32);
      expect(l.head.outer![face].y, face).toBe(l.head.inner[face].y);
    }
  });

  it('内外层不重叠（帽子若压住内层头部就没意义）', () => {
    const l = layout64('classic');
    expect(overlapsBetweenLayers(l, 64)).toEqual([]);
  });

  it('其余部位 outer 明确为 undefined，且给出可读原因（不静默留空）', () => {
    const l = layout64('classic');
    const unresolved = unresolvedOuterParts(64, 'classic');
    expect(unresolved).not.toContain('head');
    expect(unresolved).toEqual(expect.arrayContaining(['body', 'right_arm', 'left_arm']));
    expect(OUTER_UNRESOLVED_REASON).toContain('未公开');
    expect(OUTER_UNRESOLVED_REASON).toContain('skinview3d');
    expect(l.body.outer).toBeUndefined();
  });

  it('128 布局同样：head 有 outer，其余为 undefined', () => {
    expect(layout128('classic').head.outer).toBeDefined();
    expect(layout128('classic').body.outer).toBeUndefined();
    expect(unresolvedOuterParts(128, 'slim')).toContain('left_leg');
  });
});

describe('§5.9 模型变体：classic 4px 手臂 / slim 3px 手臂', () => {
  it('classic 手臂正面 4px、slim 3px', () => {
    expect(layout64('classic').right_arm.inner.front.width).toBe(4);
    expect(layout64('slim').right_arm.inner.front.width).toBe(3);
    expect(layout64('slim').left_arm.inner.front.width).toBe(3);
  });

  it('slim 只改手臂，腿/身体/头宽度不变（官方只说 lose arms 25%）', () => {
    const c = layout64('classic');
    const s = layout64('slim');
    expect(s.body.inner.front.width).toBe(c.body.inner.front.width);
    expect(s.head.inner.front.width).toBe(c.head.inner.front.width);
    expect(s.right_leg.inner.front.width).toBe(c.right_leg.inner.front.width);
  });

  it('slim 的手臂侧面仍是 4px（厚度方向展开，不随粗细变）', () => {
    const s = layout64('slim');
    expect(s.right_arm.inner.left.width).toBe(4);
    expect(s.right_arm.inner.right.width).toBe(4);
  });

  it('模型尺寸符合官方描述：classic 32 高 16 宽 / slim 32 高 14 宽', () => {
    // 官方：「exactly 32 pixels tall and 16 pixels wide on the classic model
    // with 4 pixel wide arms, and 14 on the slim model with 3 pixel wide arms」
    // 4px 手臂：身体 8 宽 + 两臂 4+4 = 16 ✓；3px 手臂：8 + 3+3 = 14 ✓
    const widthOf = (model: 'classic' | 'slim'): number => {
      const l = layout64(model);
      return (
        l.body.inner.front.width + l.right_arm.inner.front.width + l.left_arm.inner.front.width
      );
    };
    expect(widthOf('classic')).toBe(16);
    expect(widthOf('slim')).toBe(14);
  });
});

describe('坐标不越界', () => {
  it('64×64 四种组合都无面越界', () => {
    for (const res of [64, 128] as const) {
      for (const model of ['classic', 'slim'] as const) {
        const issues = validateSkinLayout(res, model);
        expect(issues, `${res}-${model}: ${JSON.stringify(issues)}`).toEqual([]);
      }
    }
  });
});

describe('§5.9 上传尺寸校验（官方允许 64×32 / 64×64 / 128×128）', () => {
  it('官方三种尺寸全被接受', () => {
    for (const s of ACCEPTED_SKIN_SIZES) {
      expect(validateSkinPngSize(s.width, s.height), `${s.width}×${s.height}`).toEqual([]);
    }
  });

  it('非法尺寸被拒并给出中文原因', () => {
    const r = validateSkinPngSize(256, 256);
    expect(r).toHaveLength(1);
    expect(r[0]?.message).toContain('64×32');
    expect(r[0]?.message).toContain('128×128');
    expect(validateSkinPngSize(0, 0).length).toBeGreaterThan(0);
    expect(validateSkinPngSize(64, 63).length).toBeGreaterThan(0);
  });
});

describe('Java 版「内层强制全不透明」（官方 Transparency 段）', () => {
  it('统计 alpha != 255 的像素数（按 RGBA 步长 4 扫描）', () => {
    const rgba = [255, 0, 0, 255, 0, 255, 0, 128, 0, 0, 255, 0];
    expect(countTransparentInnerPixels(rgba)).toBe(2);
    expect(countTransparentInnerPixels([255, 0, 0, 255, 255, 255, 255, 255])).toBe(0);
  });
});

describe('HD 是推导布局（官方未公开 128 逐面坐标表）', () => {
  it('128 坐标是 64 的两倍（明确标为推导，不宣称逐面等同官方）', () => {
    const a = layout64('classic');
    const b = layout128('classic');
    expect(b.head.inner.front.x).toBe(a.head.inner.front.x * 2);
    expect(b.head.inner.front.width).toBe(a.head.inner.front.width * 2);
  });

  it('layoutFor 分发正确', () => {
    expect(layoutFor(64, 'classic')).toEqual(layout64('classic'));
    expect(layoutFor(128, 'slim')).toEqual(layout128('slim'));
  });
});
