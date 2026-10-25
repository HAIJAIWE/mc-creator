import { describe, expect, it } from 'vitest';

import {
  SKIN_LEGACY_HEIGHT,
  SKIN_SLOT_IDS,
  SKIN_TEXTURE_SIZE,
  SLOT_OVERLAY_PARENT,
  type SkinModel,
  type SkinSlotId,
  slotRect,
} from './skin-layout.js';

/**
 * 这份测试是 UV 表的**唯一一份钉子**（三份手写表已收进 `skin-layout.ts`）。
 *
 * 两大类断言：
 * 1. 绝对值 —— 与官方 64×64 展开图一致（数字来自真皮肤解码核对，见模块头注释）；
 * 2. 内部规则 —— 「前脸 = 块起点 + (进深, 进深)」、两两不重叠、不出界。
 *    第 2 类能抓到「照着上一行抄歪一格」这种错（旧表就是这么漂移的）。
 */

/** 官方展开图里每个盒子所在的 16×16 块起点 + 进深 d。 */
const SLOT_BLOCKS: Record<SkinSlotId, { bx: number; by: number; d: number }> = {
  head: { bx: 0, by: 0, d: 8 },
  headOverlay: { bx: 32, by: 0, d: 8 },
  body: { bx: 16, by: 16, d: 4 },
  bodyOverlay: { bx: 16, by: 32, d: 4 },
  rightArm: { bx: 40, by: 16, d: 4 },
  rightArmOverlay: { bx: 40, by: 32, d: 4 },
  leftArm: { bx: 32, by: 48, d: 4 },
  leftArmOverlay: { bx: 48, by: 48, d: 4 },
  rightLeg: { bx: 0, by: 16, d: 4 },
  rightLegOverlay: { bx: 0, by: 32, d: 4 },
  leftLeg: { bx: 16, by: 48, d: 4 },
  leftLegOverlay: { bx: 0, by: 48, d: 4 },
};

const EXPECTED: Record<SkinSlotId, { x: number; y: number; w: number; h: number }> = {
  head: { x: 8, y: 8, w: 8, h: 8 },
  headOverlay: { x: 40, y: 8, w: 8, h: 8 },
  body: { x: 20, y: 20, w: 8, h: 12 },
  bodyOverlay: { x: 20, y: 36, w: 8, h: 12 },
  rightArm: { x: 44, y: 20, w: 4, h: 12 },
  rightArmOverlay: { x: 44, y: 36, w: 4, h: 12 },
  leftArm: { x: 36, y: 52, w: 4, h: 12 },
  leftArmOverlay: { x: 52, y: 52, w: 4, h: 12 },
  rightLeg: { x: 4, y: 20, w: 4, h: 12 },
  rightLegOverlay: { x: 4, y: 36, w: 4, h: 12 },
  leftLeg: { x: 20, y: 52, w: 4, h: 12 },
  leftLegOverlay: { x: 4, y: 52, w: 4, h: 12 },
};

const MODELS: readonly SkinModel[] = ['classic', 'slim'];

describe('skin-layout · 12 个槽的绝对值（classic）', () => {
  for (const slot of SKIN_SLOT_IDS) {
    it(`${slot} = ${JSON.stringify(EXPECTED[slot])}`, () => {
      expect(slotRect('classic', slot)).toEqual(EXPECTED[slot]);
    });
  }

  it('SKIN_SLOT_IDS 没有重复、没有漏项', () => {
    expect(new Set(SKIN_SLOT_IDS).size).toBe(12);
    expect([...SKIN_SLOT_IDS].sort()).toEqual(Object.keys(EXPECTED).sort());
  });
});

describe('skin-layout · 内部规则：前脸 = 块起点 + (进深, 进深)', () => {
  for (const slot of SKIN_SLOT_IDS) {
    it(`${slot} 由块推出`, () => {
      const block = SLOT_BLOCKS[slot];
      const rect = slotRect('classic', slot);
      expect({ x: rect.x, y: rect.y }).toEqual({
        x: block.bx + block.d,
        y: block.by + block.d,
      });
    });
  }

  it('躯干/右臂/右腿的第二层 = 主层 + (0,16)；帽子是头 + (32,0)', () => {
    // 头是唯一一个「第二层摆在旁边而不是下面」的：头 32 宽，右边正好接帽子。
    for (const overlay of ['bodyOverlay', 'rightArmOverlay', 'rightLegOverlay'] as const) {
      const parent = SLOT_OVERLAY_PARENT[overlay]!;
      expect(
        {
          dx: SLOT_BLOCKS[overlay].bx - SLOT_BLOCKS[parent].bx,
          dy: SLOT_BLOCKS[overlay].by - SLOT_BLOCKS[parent].by,
        },
        overlay,
      ).toEqual({ dx: 0, dy: 16 });
    }

    const hat = SLOT_BLOCKS.headOverlay;
    const head = SLOT_BLOCKS.head;
    expect({ dx: hat.bx - head.bx, dy: hat.by - head.by }).toEqual({ dx: 32, dy: 0 });
  });

  it('左腿/左臂的第二层排在 y48 那一行的两端（左腿 -16、左臂 +16）', () => {
    const dl = SLOT_BLOCKS.leftLegOverlay;
    const ll = SLOT_BLOCKS.leftLeg;
    expect({ dx: dl.bx - ll.bx, dy: dl.by - ll.by }).toEqual({ dx: -16, dy: 0 });

    const lao = SLOT_BLOCKS.leftArmOverlay;
    const la = SLOT_BLOCKS.leftArm;
    expect({ dx: lao.bx - la.bx, dy: lao.by - la.by }).toEqual({ dx: 16, dy: 0 });
  });

  it('每个覆盖层槽都登记了主层槽，且主层槽不是覆盖层', () => {
    const overlays = SKIN_SLOT_IDS.filter((s) => s.endsWith('Overlay'));
    expect(overlays).toHaveLength(6);
    for (const overlay of overlays) {
      const parent = SLOT_OVERLAY_PARENT[overlay];
      expect(parent).toBeDefined();
      expect(parent!.endsWith('Overlay')).toBe(false);
      expect(SKIN_SLOT_IDS).toContain(parent);
    }
  });
});

describe('skin-layout · 两两不重叠 / 不出界', () => {
  for (const model of MODELS) {
    it(`${model}：12 个槽互不重叠`, () => {
      const rects = SKIN_SLOT_IDS.map((slot) => ({ slot, ...slotRect(model, slot) }));
      for (let i = 0; i < rects.length; i++) {
        for (let j = i + 1; j < rects.length; j++) {
          const a = rects[i]!;
          const b = rects[j]!;
          const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
          // 旧表把 leftLegOverlay 也写成 (20,36) 撞进躯干外套，这条能直接抓到
          expect(overlap, `${a.slot} 和 ${b.slot} 重叠`).toBe(false);
        }
      }
    });

    it(`${model}：12 个槽都在 64×64 内`, () => {
      for (const slot of SKIN_SLOT_IDS) {
        const r = slotRect(model, slot);
        expect(r.x, slot).toBeGreaterThanOrEqual(0);
        expect(r.y, slot).toBeGreaterThanOrEqual(0);
        expect(r.x + r.w, slot).toBeLessThanOrEqual(SKIN_TEXTURE_SIZE);
        expect(r.y + r.h, slot).toBeLessThanOrEqual(SKIN_TEXTURE_SIZE);
      }
    });
  }
});

describe('skin-layout · slim 只改手臂宽度', () => {
  const ARM_SLOTS: readonly SkinSlotId[] = [
    'rightArm',
    'rightArmOverlay',
    'leftArm',
    'leftArmOverlay',
  ];

  it('手臂槽 4px → 3px，x/y/h 不变', () => {
    for (const slot of ARM_SLOTS) {
      const classic = slotRect('classic', slot);
      const slim = slotRect('slim', slot);
      expect(slim).toEqual({ ...classic, w: 3 });
    }
  });

  it('slim 左臂前脸 x 保持 36（不是 37）', () => {
    // 真图实测：左臂块起点 32，顶面在 (36,48)，而展开图里前脸就在顶面正下方 → 同 x。
    // 旧 skin-uv.ts 的 SLIM_UV_MAP 写的 37（注释还写了「像素探针验证」），是错的。
    expect(slotRect('slim', 'leftArm')).toEqual({ x: 36, y: 52, w: 3, h: 12 });
    expect(slotRect('slim', 'leftArmOverlay')).toEqual({ x: 52, y: 52, w: 3, h: 12 });
  });

  it('除手臂外，slim 与 classic 完全相同', () => {
    for (const slot of SKIN_SLOT_IDS) {
      if (ARM_SLOTS.includes(slot)) continue;
      expect(slotRect('slim', slot), slot).toEqual(slotRect('classic', slot));
    }
  });

  it('腿的第二层是占位槽（原版腿没有第二层）—— 值保留，别当成真槽位用', () => {
    // (0,32)-(16,48) 与 (0,48)-(16,64) 在真皮肤上实测为空。
    expect(slotRect('classic', 'rightLegOverlay')).toEqual({ x: 4, y: 36, w: 4, h: 12 });
    expect(slotRect('classic', 'leftLegOverlay')).toEqual({ x: 4, y: 52, w: 4, h: 12 });
  });
});

/**
 * legacy `64×32`（`SKIN_LEGACY_HEIGHT`）。
 *
 * 那张图只有前 32 行，所以**只有 y<32 的那几个槽位存在**：头/帽子/躯干/右臂/右腿。
 * 这条不是我们规定的 —— 是格式本身（见 `SKIN_LEGACY_HEIGHT` 的注释与 core 的
 * `png.ts`：Java 官方与 PCL 都按「64×64 或 legacy 64×32」收）。
 */
describe('skin-layout · legacy 64×32 只有前 32 行的槽位', () => {
  /** 64×64 里落在 y<32 的主层槽位 —— legacy 复用的就是这几个。 */
  const LEGACY_SLOTS = ['head', 'headOverlay', 'body', 'rightArm', 'rightLeg'] as const;

  it('legacy 高度常量就是 32（core 的 LEGACY_SKIN_HEIGHT 同值）', () => {
    expect(SKIN_LEGACY_HEIGHT).toBe(32);
  });

  it('legacy 要用的 5 个槽位整块都在 y<32 里', () => {
    for (const slot of LEGACY_SLOTS) {
      const r = slotRect('classic', slot);
      expect(r.y + r.h, `${slot} ${JSON.stringify(r)} 越过 32 行`).toBeLessThanOrEqual(
        SKIN_LEGACY_HEIGHT,
      );
    }
  });

  it('左肢/左肢外套/躯干外套**不在** legacy 复用范围内（那张图里没有这些块）', () => {
    for (const slot of ['leftArm', 'leftLeg', 'leftArmOverlay', 'bodyOverlay'] as const) {
      const r = slotRect('classic', slot);
      expect(r.y >= SKIN_LEGACY_HEIGHT, `${slot} 落在 y<32，别把它当成 legacy 也有的块`).toBe(true);
    }
  });
});
