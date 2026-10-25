/**
 * 皮肤 PNG 校验：这是最容易被「随便写个尺寸检查」糊过去的一层，
 * 所以用例刻意覆盖真实会出现的怪文件。
 *
 * ⚠️ 尺寸这一条曾经**两个方向都错**：`[64, 128]` —— 收了 64×128（哪里都不合法），
 * 又把 Java 至今支持的 legacy 64×32 拒了；而旧测试把这套错行为钉得死死的
 * （「64×128 合法」「64×32 高度不对」），属于典型的**只断言内部自洽**。
 * 现在的期望值有三个外部出处，不是我们自己推的：
 * - Java 官方启动器上传报错原文：`Skin images must be 64x64 or 64x32 pixel PNG files`
 * - Minecraft Wiki「Skin」：Java 上传「64×64，或 legacy 64×32」；128×128 属 Bedrock
 * - PCL `ModMinecraft.vb#McSkinSelect`（对着正版接口的预检）：64×32 或 64×64
 */
import { describe, it, expect } from 'vitest';

import {
  parseSkinPng,
  localSkinFileName,
  isLegacySkinSize,
  SKIN_WIDTH,
  SKIN_HEIGHTS,
  LEGACY_SKIN_HEIGHT,
} from './png.js';

/** 用真实 PNG 头拼一张「合法」皮肤文件（内容无所谓，只校验头）。 */
function png(width: number, height: number): Buffer {
  const b = Buffer.alloc(64);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8); // IHDR length
  Buffer.from('IHDR').copy(b, 12);
  b.writeUInt32BE(width, 16);
  b.writeUInt32BE(height, 20);
  return b;
}

describe('parseSkinPng · 合法皮肤', () => {
  it('64×64（现代格式）', () => {
    expect(parseSkinPng(png(64, 64))).toMatchObject({ ok: true, width: 64, height: 64 });
  });

  it('64×32（legacy 旧格式，1.7 及更早）—— Java 至今能读', () => {
    expect(parseSkinPng(png(64, 32))).toMatchObject({ ok: true, width: 64, height: 32 });
  });
});

describe('parseSkinPng · 错误必须说清是哪一项', () => {
  it('非 PNG（jpeg/webp/被改名的 zip）', () => {
    const r = parseSkinPng(
      Buffer.from([
        0xff, 0xd8, 0xff, 0xe0, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18,
        19,
      ]),
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/不是 PNG/);
  });

  it('文件太小（连 PNG 签名都放不下）', () => {
    expect(parseSkinPng(Buffer.from('abc')).error).toMatch(/太小/);
  });

  it('被截断：有签名但读不到 IHDR', () => {
    const r = parseSkinPng(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 1]));
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/截断/);
  });

  it('宽不是 64 —— 含最常见的两种误用', () => {
    // 32×32 方块图标
    expect(parseSkinPng(png(32, 32)).error).toMatch(/宽度必须是 64/);
    // 512×512 大图（HD 皮肤 mod 之外 Minecraft 读不了）
    expect(parseSkinPng(png(512, 512)).error).toMatch(/宽度必须是 64/);
  });

  it('高不是 64 / 32', () => {
    // 64×128：不是任何平台的皮肤（128 是 Bedrock 的**128×128**，不是「宽不变、高翻倍」）
    expect(parseSkinPng(png(64, 128)).error).toMatch(/高度必须是 64 或 32/);
    expect(parseSkinPng(png(64, 256)).error).toMatch(/高度必须是 64 或 32/);
    expect(parseSkinPng(png(64, 16)).error).toMatch(/高度必须是 64 或 32/);
  });

  it('128×128（Bedrock 尺寸）走不到这条链路 —— 我们的库是 Java 的', () => {
    expect(parseSkinPng(png(128, 128)).error).toMatch(/宽度必须是 64/);
  });

  it('exactOptionalPropertyTypes 友好：error 恒为 string|null，不是 undefined', () => {
    const r = parseSkinPng(png(64, 64));
    expect(Object.prototype.hasOwnProperty.call(r, 'error')).toBe(true);
    expect(r.error).toBeNull();
  });
});

describe('localSkinFileName · 玩家名进路径', () => {
  it('普通名字照常用', () => {
    expect(localSkinFileName('Steve')).toBe('Steve.png');
    expect(localSkinFileName('Notch_1')).toBe('Notch_1.png');
    // 离线模式/中文名不该被挡（只挡危险字符，不强制 Minecraft 命名规则）
    expect(localSkinFileName('小明')).toBe('小明.png');
    expect(localSkinFileName('  Steve  ')).toBe('Steve.png');
  });

  it('路径穿越一律 null', () => {
    for (const bad of ['', '   ', '.', '..', 'a/b', 'a\\b', '../evil', 'a..b']) {
      expect(localSkinFileName(bad), `玩家名 ${JSON.stringify(bad)} 必须被拒`).toBeNull();
    }
  });
});

describe('尺寸常量', () => {
  it('宽恒为 64（Minecraft 硬性要求）', () => {
    expect(SKIN_WIDTH).toBe(64);
  });

  it('两个合法高度就是 64 与 32，legacy 常量指向其中的 32', () => {
    expect([...SKIN_HEIGHTS].sort((a, b) => a - b)).toEqual([32, 64]);
    expect(SKIN_HEIGHTS).toContain(LEGACY_SKIN_HEIGHT);
    expect(LEGACY_SKIN_HEIGHT).toBe(32);
  });
});

describe('isLegacySkinSize · legacy 只有 Steve 模型', () => {
  it('64×32 是 legacy（调用方据此锁 classic）', () => {
    expect(isLegacySkinSize(64, 32)).toBe(true);
  });

  it('其它尺寸都不是 legacy', () => {
    for (const [w, h] of [
      [64, 64],
      [64, 128],
      [128, 128],
      [32, 32],
      [0, 0],
    ] as const) {
      expect(isLegacySkinSize(w, h), `${w}×${h} 不该被判成 legacy`).toBe(false);
    }
  });
});
