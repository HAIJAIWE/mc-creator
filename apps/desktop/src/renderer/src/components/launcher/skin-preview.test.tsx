/**
 * 皮肤正面预览的 UV 映射测试。
 *
 * ## 这个文件存在的理由：一版测试放过了错的坐标
 *
 * 上一版的测试只断言「内部自洽」—— 不越界、不碰透明区、覆盖层与主层对齐。
 * 结果**坐标全错也全绿**：左腿取到了顶面、躯干外套取到了右臂区域、还凭空
 * 编出一个不存在的「左腿外套」。画出来是一堆错位碎片。
 *
 * 自洽性检查不是没用（它能挡住「未来又写飘了」），但它**证明不了正确**。
 * 所以这里分两组：
 * - 「对照官方布局表」：断言**绝对值**，坐标错必红。这才是主力。
 * - 「内部自洽」：防止后续改动把布局改歪（保留，但明确它只是辅助）。
 *
 * ## 为什么测坐标表而不是「画出来像不像」
 *
 * 环境里没有 canvas 实现（jsdom 的 `getContext('2d')` 返回 null），像素级断言
 * 跑不了。而 UV 坐标恰恰是**唯一写错了也不会抛异常**的部分。
 *
 * ## 后来又拿真皮肤图核了一遍（关键：这一遍才是「跟真图比」）
 *
 * 「对照官方布局表」那组仍然是**跟表比** —— 表错了它照样绿，事实也是：它全绿的
 * 时候有三处坐标是错的。后来用真 64×64 皮肤（MHF_Steve / Dinnerbone，从
 * minotar.net 取）解码后逐块跑了一遍合成（临时脚本，真图不在仓库里、CI 也拿不到），
 * 才看出三处错坐标 + 一处左右反了。细节见 `skin-preview.shared.ts` 文件头。
 *
 * 这里只补**能静态钉住**的部分：坐标绝对值、左右落位、块归属。
 * 「合成出来像不像人」那一步只能在真图上做，钉不进 CI。
 */
import { describe, it, expect } from 'vitest';
import {
  SKIN_FRONT_PARTS,
  SKIN_FRONT_PARTS_LEGACY,
  selectSkinFrontParts,
  OUT_W,
  OUT_H,
  ARM_W,
  SKIN_TEXTURE_SIZE,
  type SkinPart,
} from './skin-preview.shared.js';

const main = SKIN_FRONT_PARTS.filter((p) => !p.overlay);
const overlays = SKIN_FRONT_PARTS.filter((p) => p.overlay);

/** 目标位置（`dx,dy`）相同的算「同一处」。 */
const at = (p: SkinPart) => `${p.dx},${p.dy}`;
/** 目标矩形。 */
const box = (p: SkinPart) => `${p.dx},${p.dy},${p.src.w},${p.src.h}`;

describe('皮肤正面预览 · 对照官方 64×64 布局表', () => {
  /**
   * 这组是**绝对值**断言：坐标错了一定红。
   *
   * 每一行都对应官方布局表里的一格（见 `skin-preview.shared.ts` 文件头）。
   * 写死字面量是故意的 —— 用常量拼出来再断言等于自己跟自己比。
   */
  const EXPECTED: Array<{ name: string; overlay: boolean; src: SkinPart['src'] }> = [
    { name: '头', overlay: false, src: { x: 8, y: 8, w: 8, h: 8 } },
    { name: '躯干', overlay: false, src: { x: 20, y: 20, w: 8, h: 12 } },
    { name: '右臂', overlay: false, src: { x: 44, y: 20, w: 4, h: 12 } },
    { name: '右腿', overlay: false, src: { x: 4, y: 20, w: 4, h: 12 } },
    { name: '左腿', overlay: false, src: { x: 20, y: 52, w: 4, h: 12 } },
    { name: '左臂', overlay: false, src: { x: 36, y: 52, w: 4, h: 12 } },
    { name: '帽子', overlay: true, src: { x: 40, y: 8, w: 8, h: 8 } },
    { name: '躯干外套', overlay: true, src: { x: 20, y: 36, w: 8, h: 12 } },
    { name: '右臂外套', overlay: true, src: { x: 44, y: 36, w: 4, h: 12 } },
  ];

  it.each(EXPECTED)('$name 取样点正确', ({ src }) => {
    const found = SKIN_FRONT_PARTS.find((p) => p.src.x === src.x && p.src.y === src.y);
    expect(found, `(${src.x},${src.y}) 不在任何一块里`).toBeDefined();
    expect(found!.src).toEqual(src);
  });

  it('正好九个部件，不多不少（多出来的多半是编出来的层）', () => {
    expect(SKIN_FRONT_PARTS).toHaveLength(EXPECTED.length);
  });

  /**
   * 64×64 格式**没有腿的外套层**。
   *
   * 左肢/外套这几块挨得很近（`(20,36)` 是躯干外套、`(20,52)` 是左腿正面、
   * `(16,48)-(32,64)` 是整条左腿），凭记忆很容易把其中一个当成另一个 ——
   * 这张表就因为这样错过了两次。所以这里钉的是**块归属**：外套层不许落在
   * 腿块里（右腿块 `(0,16)-(16,32)`、左腿块 `(16,48)-(32,64)`）。
   */
  it('没有外套层落在腿块里（64×64 的腿没有外套层）', () => {
    const legBlocks = [
      { x: 0, y: 16, w: 16, h: 16 },
      { x: 16, y: 48, w: 16, h: 16 },
    ];
    const inBlock = (p: SkinPart['src'], b: (typeof legBlocks)[number]) =>
      p.x >= b.x && p.y >= b.y && p.x + p.w <= b.x + b.w && p.y + p.h <= b.y + b.h;
    const bogus = SKIN_FRONT_PARTS.filter(
      (p) => p.overlay && legBlocks.some((b) => inBlock(p.src, b)),
    );
    expect(
      bogus.map((p) => `${p.src.x},${p.src.y}`),
      '腿块里不该有任何取样块',
    ).toEqual([]);
  });

  it('覆盖层只有三块（帽子 / 躯干外套 / 右臂外套）', () => {
    expect(overlays).toHaveLength(3);
    expect(overlays.map((p) => p.src.x)).toEqual([40, 20, 44]);
  });

  it('主层有六块（头 / 躯干 / 两臂 / 两腿）', () => {
    expect(main).toHaveLength(6);
  });
});

describe('皮肤正面预览 · 内部自洽（辅助，不是正确性的证明）', () => {
  it('每块都落在 64×64 贴图内', () => {
    for (const p of SKIN_FRONT_PARTS) {
      expect(p.src.x + p.src.w, `x 越界: ${JSON.stringify(p.src)}`).toBeLessThanOrEqual(
        SKIN_TEXTURE_SIZE,
      );
      expect(p.src.y + p.src.h, `y 越界: ${JSON.stringify(p.src)}`).toBeLessThanOrEqual(
        SKIN_TEXTURE_SIZE,
      );
    }
  });

  /** 回归根因：左上角 `(0,0)-(8,8)` 是全透明帽子层，取到这里就是空白。 */
  it('没有一块取自左上角的全透明帽子区 (0,0)-(8,8)', () => {
    for (const p of SKIN_FRONT_PARTS) {
      const hitsHole = p.src.x < 8 && p.src.y < 8;
      expect(hitsHole, `取到了透明区: ${JSON.stringify(p.src)}`).toBe(false);
    }
  });

  /**
   * 同一块**贴图**不会被采样两次（否则该区域出现重影）。
   *
   * 注意比的是**源矩形**而不是目标矩形：覆盖层与主层画到同一处是**对的**
   * （帽子就是要盖在头上），拿目标矩形去比会把正确实现判成错。
   *
   * 上一版凭空编了个 `(36,52,4,12)` 当「左腿外套」，那其实已经是左臂正面 ——
   * 源矩形重复，正是这条能抓到的。
   */
  it('同一块贴图不会被采样两次（否则该区域出现重影）', () => {
    const srcs = SKIN_FRONT_PARTS.map((p) => `${p.src.x},${p.src.y},${p.src.w},${p.src.h}`);
    expect(new Set(srcs).size, `重复采样: ${srcs.join(' | ')}`).toBe(srcs.length);
  });

  it('主层全部排在覆盖层之前（帽子要盖在头上）', () => {
    const lastMain = SKIN_FRONT_PARTS.lastIndexOf(main[main.length - 1]!);
    const firstOverlay = SKIN_FRONT_PARTS.indexOf(overlays[0]!);
    expect(lastMain).toBeLessThan(firstOverlay);
  });

  it('每块覆盖层都有目标矩形一致的主层', () => {
    const mainBoxes = main.map(box);
    for (const o of overlays) {
      expect(mainBoxes, `覆盖层 ${JSON.stringify(o.src)} 找不到对应主层`).toContain(box(o));
    }
  });

  it('所有块都在 16×32 合成画布内', () => {
    for (const p of SKIN_FRONT_PARTS) {
      expect(p.dx + p.src.w).toBeLessThanOrEqual(OUT_W);
      expect(p.dy + p.src.h).toBeLessThanOrEqual(OUT_H);
    }
  });

  it('头在 16 宽画布里居中', () => {
    const head = main.find((p) => p.src.w === 8 && p.src.h === 8)!;
    expect(head.dx).toBe((OUT_W - 8) / 2);
  });

  it('两条腿并排占满躯干下方', () => {
    const legs = main.filter((p) => p.src.h === 12 && p.dy === 20);
    expect(legs).toHaveLength(2);
    expect(legs.map((p) => p.dx).sort((a, b) => a - b)).toEqual([4, 8]);
  });

  it('两条手臂分居躯干两侧', () => {
    const arms = main.filter((p) => p.src.w === ARM_W && p.src.h === 12 && p.dy === 8);
    expect(arms).toHaveLength(2);
    expect(arms.map((p) => p.dx).sort((a, b) => a - b)).toEqual([0, 12]);
  });

  /**
   * 左右不能反：正面视角下**玩家的右肢在画面左边**。
   *
   * 上一条只钉住了「两条手臂分居两侧」，左右反了照样绿。这条钉的是落位，
   * 理由见 `skin-preview.shared.ts` 文件头「左 / 右」—— 九块取的都是正面
   * 贴图，而正面贴图是按观众的视角画的，所以对方的右手在观众左边。
   */
  it.each([
    { name: '右臂', x: 44, y: 20, dx: 0 },
    { name: '左臂', x: 36, y: 52, dx: 12 },
    { name: '右腿', x: 4, y: 20, dx: 4 },
    { name: '左腿', x: 20, y: 52, dx: 8 },
  ])('$name 落在画面 x=$dx（右肢在左）', ({ x, y, dx }) => {
    const p = main.find((q) => q.src.x === x && q.src.y === y);
    expect(p, `(${x},${y}) 不在主层里`).toBeDefined();
    expect(p!.dx).toBe(dx);
  });

  /** 右臂外套必须跟着右臂走，别留在画面右边。 */
  it('右臂外套与右臂同处', () => {
    const arm = main.find((p) => p.src.x === 44 && p.src.y === 20)!;
    const jacket = overlays.find((p) => p.src.x === 44 && p.src.y === 36)!;
    expect(jacket.dx).toBe(arm.dx);
    expect(jacket.dy).toBe(arm.dy);
  });

  it('合成画布尺寸 = 两条手臂 + 躯干，头 8 + 躯干 12 + 腿 12', () => {
    expect(OUT_W).toBe(ARM_W * 2 + 8);
    expect(OUT_H).toBe(8 + 12 + 12);
    expect(Math.max(...main.map((p) => p.dy + p.src.h))).toBe(OUT_H);
  });

  it('同一处不应有两块主层（会互相盖住）', () => {
    const spots = main.map(at);
    expect(new Set(spots).size).toBe(spots.length);
  });
});

/**
 * legacy `64×32`：唯一一张**不按 64×64 走**的贴图。
 *
 * 这一组的期望值同样来自外部事实，不是我们自洽：
 * - Java 至今支持 64×32（官方启动器报错原文 `64x64 or 64x32`）
 * - 那张图 `y16..31` 之后没有了：没有左肢块、没有任何第二层，只剩帽子
 * - 游戏对 legacy 的处理是「Steve 模型 + 把右肢镜像到左边」，所以左肢取右肢的矩形
 */
describe('皮肤正面预览 · legacy 64×32', () => {
  const legMain = SKIN_FRONT_PARTS_LEGACY.filter((p) => !p.overlay);
  const legOverlays = SKIN_FRONT_PARTS_LEGACY.filter((p) => p.overlay);
  const mirrored = SKIN_FRONT_PARTS_LEGACY.filter((p) => p.mirror === true);

  it.each([
    { name: '右臂', src: { x: 44, y: 20, w: 4, h: 12 }, dx: 0, mirror: false },
    { name: '躯干', src: { x: 20, y: 20, w: 8, h: 12 }, dx: 4, mirror: false },
    { name: '左臂（右臂镜像）', src: { x: 44, y: 20, w: 4, h: 12 }, dx: 12, mirror: true },
    { name: '头', src: { x: 8, y: 8, w: 8, h: 8 }, dx: 4, mirror: false },
    { name: '右腿', src: { x: 4, y: 20, w: 4, h: 12 }, dx: 4, mirror: false },
    { name: '左腿（右腿镜像）', src: { x: 4, y: 20, w: 4, h: 12 }, dx: 8, mirror: true },
    { name: '帽子', src: { x: 40, y: 8, w: 8, h: 8 }, dx: 4, mirror: false, overlay: true },
  ])('$name 的取样点与落位', ({ src, dx, mirror }) => {
    const found = SKIN_FRONT_PARTS_LEGACY.find(
      (p) =>
        p.dx === dx && p.src.x === src.x && p.src.y === src.y && (p.mirror === true) === mirror,
    );
    expect(found, `dx=${dx} 处没有 (${src.x},${src.y}) mirror=${mirror} 的块`).toBeDefined();
    expect(found!.src).toEqual(src);
  });

  it('正好七块：六块主层 + 一块帽子', () => {
    expect(SKIN_FRONT_PARTS_LEGACY).toHaveLength(7);
    expect(legMain).toHaveLength(6);
    expect(legOverlays).toHaveLength(1);
  });

  /** 这是这一整组里最硬的一条：legacy 图只有 32 高，取到 y≥32 就是**图外**。 */
  it('没有任何一块取到 y≥32（legacy 图只有 32 行）', () => {
    for (const p of SKIN_FRONT_PARTS_LEGACY) {
      expect(p.src.y + p.src.h, `取样越界: ${JSON.stringify(p.src)}`).toBeLessThanOrEqual(32);
    }
  });

  /** legacy 没有躯干外套/袖/裤 —— 那些块的第二层在 y32..47，那张图里根本不存在。 */
  it('只有帽子一块覆盖层（没有外套/袖/裤）', () => {
    expect(legOverlays.map((p) => p.src.x)).toEqual([40]);
  });

  it('左肢就是右肢的矩形 + 镜像，且落在画面左边（右肢在左）', () => {
    const rightArm = legMain.find((p) => p.src.x === 44)!;
    const leftArm = mirrored.find((p) => p.src.w === ARM_W && p.src.x === 44)!;
    expect(leftArm.src).toEqual(rightArm.src);
    expect(leftArm.dx).toBeGreaterThan(rightArm.dx);
    const rightLeg = legMain.find((p) => p.src.x === 4)!;
    const leftLeg = mirrored.find((p) => p.src.x === 4)!;
    expect(leftLeg.src).toEqual(rightLeg.src);
    expect(leftLeg.dx).toBeGreaterThan(rightLeg.dx);
  });

  it('被采样两次的块**必须**是标了 mirror 的那一对（镜像复查）', () => {
    const counts = new Map<string, number>();
    for (const p of SKIN_FRONT_PARTS_LEGACY) {
      const k = `${p.src.x},${p.src.y},${p.src.w},${p.src.h}`;
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    const dupes = [...counts.entries()].filter(([, n]) => n > 1).map(([k]) => k);
    expect(dupes).toHaveLength(2); // 右臂、右腿各被采两次
    // 每个重复的块里，恰好有一块是镜像
    for (const k of dupes) {
      const same = SKIN_FRONT_PARTS_LEGACY.filter(
        (p) => `${p.src.x},${p.src.y},${p.src.w},${p.src.h}` === k,
      );
      expect(same.filter((p) => p.mirror === true)).toHaveLength(1);
    }
  });

  it('legacy 取的每一块在 64×64 表里都逐像素相同（同一张图的前 32 行）', () => {
    const classic = SKIN_FRONT_PARTS.map((p) => `${p.src.x},${p.src.y},${p.src.w},${p.src.h}`);
    for (const p of SKIN_FRONT_PARTS_LEGACY) {
      expect(classic, `classic 表里没有 ${JSON.stringify(p.src)}`).toContain(
        `${p.src.x},${p.src.y},${p.src.w},${p.src.h}`,
      );
    }
  });

  it('legacy 表里没有 slim 取样（任何一块都不是 3px 宽）', () => {
    for (const p of SKIN_FRONT_PARTS_LEGACY) {
      expect(p.src.w, `${JSON.stringify(p.src)} 是 3px —— slim 的手臂宽度`).not.toBe(3);
    }
  });
});

describe('selectSkinFrontParts · 尺寸分派', () => {
  it('64×64 → 现代表', () => {
    expect(selectSkinFrontParts(64, 64)).toBe(SKIN_FRONT_PARTS);
  });

  it('64×32 → legacy 表', () => {
    expect(selectSkinFrontParts(64, 32)).toBe(SKIN_FRONT_PARTS_LEGACY);
  });

  it.each([
    [64, 128], // 哪里都不合法的尺寸（旧白名单把它当合法）
    [128, 128], // Bedrock 的 HD
    [512, 512], // HD mod
    [32, 32], // 图标
    [0, 0],
  ])('%i×%i → null（不画，而不是画错）', (w, h) => {
    expect(selectSkinFrontParts(w, h)).toBeNull();
  });
});
