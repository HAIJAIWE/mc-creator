import { describe, expect, it } from 'vitest';

import { SKIN_SLOT_IDS, slotRect, type SkinModel } from '../../lib/skin-layout.js';
import {
  BODY_PART_DISPLAY_ORDER,
  BODY_PART_INFOS,
  getBodyPartAt,
  getBodyPartRect,
  type BodyPartId,
} from './skin-uv.js';

/**
 * `skin-uv.ts` 负责的是「部位元数据 + 点击命中」，UV 数字本身来自
 * `lib/skin-layout.ts`。这个文件原来**一条测试都没有**，而它恰好是被手抄漂移
 * 波及的地方（静态元数据里 `rightArmOverlay` 指着手臂背面）。
 *
 * 所以这里的断言都对着**行为/元数据自洽**，不是「把实现抄一遍」：
 * - 每个槽前脸的正中心，点下去必须命中它自己（拿唯一来源的矩形反查）；
 * - 前脸之外必须点空；
 * - slim 的手臂少一列，那一列点下去要落到 `null`，而 classic 要命中手臂；
 * - 元数据里「主层的 overlayRect」必须等于「第二层自己的 rect」。
 */

const MODELS: readonly SkinModel[] = ['classic', 'slim'];

/** 矩形正中心。宽高都是偶数，所以 .5 落在像素边界上，这里取左半边那格。 */
function center(r: { x: number; y: number; w: number; h: number }): { x: number; y: number } {
  return { x: r.x + Math.floor(r.w / 2), y: r.y + Math.floor(r.h / 2) };
}

describe('skin-uv · 点击命中', () => {
  for (const model of MODELS) {
    it(`${model}：12 个槽前脸的正中心都命中自己`, () => {
      for (const slot of SKIN_SLOT_IDS) {
        const { x, y } = center(slotRect(model, slot));
        expect(getBodyPartAt(model, x, y), `${slot} @ (${x},${y})`).toBe(slot);
      }
    });

    it(`${model}：前脸之外点空`, () => {
      // (0,0) 在头块左上角，但头的前脸在 (8,8) —— 展开图的左上角不是任何前脸
      expect(getBodyPartAt(model, 0, 0)).toBeNull();
      // 躯干块的左上角 (16,16) 也不是前脸（前脸在 (20,20)）
      expect(getBodyPartAt(model, 16, 16)).toBeNull();
      // 越界
      expect(getBodyPartAt(model, 63, 63)).toBeNull();
      expect(getBodyPartAt(model, -1, 8)).toBeNull();
    });
  }

  it('slim 的手臂比 classic 少一列：第 4 列点下去是空的', () => {
    // 右臂前脸 (44,20)：classic 占 44..47，slim 只占 44..46
    expect(getBodyPartAt('classic', 47, 20)).toBe('rightArm');
    expect(getBodyPartAt('slim', 47, 20)).toBeNull();
    // 左臂同理：classic 36..39，slim 36..38
    expect(getBodyPartAt('classic', 39, 52)).toBe('leftArm');
    expect(getBodyPartAt('slim', 39, 52)).toBeNull();
  });

  it('点命中的结果一定是合法部位 id', () => {
    for (let y = 0; y < 64; y++) {
      for (let x = 0; x < 64; x++) {
        const hit = getBodyPartAt('classic', x, y);
        if (hit !== null) expect(SKIN_SLOT_IDS).toContain(hit);
      }
    }
  });
});

describe('skin-uv · 部位矩形', () => {
  for (const model of MODELS) {
    it(`${model}：getBodyPartRect 取到的就是唯一来源里的那一格`, () => {
      for (const slot of SKIN_SLOT_IDS) {
        expect(getBodyPartRect(model, slot), slot).toEqual(slotRect(model, slot));
      }
    });
  }

  it('isOverlay=true 且传的是主层时，取到对应第二层', () => {
    expect(getBodyPartRect('classic', 'body', true)).toEqual(slotRect('classic', 'bodyOverlay'));
    expect(getBodyPartRect('slim', 'leftArm', true)).toEqual(slotRect('slim', 'leftArmOverlay'));
    expect(getBodyPartRect('classic', 'rightArm', true)).toEqual(
      slotRect('classic', 'rightArmOverlay'),
    );
  });

  it('已经传第二层时不会被再加一次 Overlay', () => {
    // bodyOverlayOverlay 这种东西不存在，得原样返回
    expect(getBodyPartRect('classic', 'bodyOverlay', true)).toEqual(
      slotRect('classic', 'bodyOverlay'),
    );
  });

  it('slim 的矩形与 classic 只差手臂宽度', () => {
    for (const slot of SKIN_SLOT_IDS) {
      const c = getBodyPartRect('classic', slot);
      const s = getBodyPartRect('slim', slot);
      if (slot.includes('Arm')) {
        expect(s, slot).toEqual({ ...c, w: 3 });
      } else {
        expect(s, slot).toEqual(c);
      }
    }
  });
});

describe('skin-uv · 部位元数据自洽', () => {
  it('12 个部位都有元数据，显示顺序覆盖全部且不重复', () => {
    expect(Object.keys(BODY_PART_INFOS)).toHaveLength(12);
    expect([...BODY_PART_DISPLAY_ORDER].sort()).toEqual([...SKIN_SLOT_IDS].sort());
  });

  it('元数据里的 rect 就是唯一来源的 classic 前脸', () => {
    for (const slot of SKIN_SLOT_IDS) {
      expect(BODY_PART_INFOS[slot].rect, slot).toEqual(slotRect('classic', slot));
    }
  });

  it('主层的 overlayRect === 第二层自己的 rect（这条能抓「外套指错格」）', () => {
    for (const slot of SKIN_SLOT_IDS) {
      if (slot.endsWith('Overlay')) continue;
      const main = BODY_PART_INFOS[slot];
      const overlayId = `${slot}Overlay` as BodyPartId;
      expect(main.overlayRect, `${slot}.overlayRect`).toEqual(BODY_PART_INFOS[overlayId].rect);
      expect(main.overlayLabel, slot).toBeTruthy();
      expect(main.children).toEqual([overlayId]);
    }
  });

  it('第二层的 parent 指回主层，且自己不挂 overlayRect', () => {
    for (const slot of SKIN_SLOT_IDS) {
      if (!slot.endsWith('Overlay')) continue;
      const info = BODY_PART_INFOS[slot];
      expect(info.isOverlay, slot).toBe(true);
      expect(info.overlayRect, slot).toBeUndefined();
      expect(info.parent, slot).toBe(slot.replace(/Overlay$/, ''));
      expect(BODY_PART_INFOS[info.parent!], slot).toBeDefined();
    }
  });

  it('主层都标 isOverlay=false 且没有 parent', () => {
    for (const slot of SKIN_SLOT_IDS) {
      if (slot.endsWith('Overlay')) continue;
      expect(BODY_PART_INFOS[slot].isOverlay, slot).toBe(false);
      expect(BODY_PART_INFOS[slot].parent, slot).toBeUndefined();
    }
  });
});
