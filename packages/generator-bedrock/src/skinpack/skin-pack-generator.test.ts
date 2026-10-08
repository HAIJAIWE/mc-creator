import { describe, it, expect } from 'vitest';
import { SkinPackGenerator } from './skin-pack-generator.js';
import type { FileNode, GeneratorContext } from '@mc-creator/shared';
import { CAPE_TEXTURE_SIZE, SkinPackSpec } from '@mc-creator/shared';

const gen = new SkinPackGenerator();

/**
 * spec 的**输入**类型（zod 的 `parse` 入参），不是输出类型。
 * 用输出类型会要求所有带默认值的字段都必填 —— 而测试恰恰要验证「不填时用默认值」。
 */
type SpecInput = Parameters<typeof SkinPackSpec.parse>[0];

function ctx(spec: Partial<SpecInput>): GeneratorContext {
  return {
    spec: {
      serializeName: 'AdventurePack',
      packName: 'Adventure Pack',
      ...spec,
    },
    loader: 'vanilla',
    mcVersion: '1.21.1',
    targetDir: '/tmp/out',
    signal: new AbortController().signal,
  } as unknown as GeneratorContext;
}

function parse(files: FileNode[], path: string): Record<string, unknown> {
  const f = files.find((x) => x.path === path);
  if (!f) throw new Error(`产物里没有 ${path}（实际有：${files.map((x) => x.path).join(', ')}）`);
  return JSON.parse(f.content) as Record<string, unknown>;
}

function lang(files: FileNode[], path = 'texts/en_US.lang'): string[] {
  const f = files.find((x) => x.path === path);
  if (!f) throw new Error(`产物里没有 ${path}`);
  return f.content.split('\n').filter((l) => l !== '');
}

/** 解析产物里的 PNG 头，拿到真实尺寸（比断言"我传了 64"可靠——验的是字节） */
function pngSize(files: FileNode[], path: string): { width: number; height: number } {
  const f = files.find((x) => x.path === path);
  if (!f) throw new Error(`产物里没有 ${path}`);
  const buf = Buffer.from(f.content, 'base64');
  // PNG: 8 字节签名 + IHDR(4 len + 4 type) + width(4) + height(4)
  expect(buf.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

describe('产物结构（官方 skins.json / manifest 要求）', () => {
  it('产出 manifest.json + skins.json + 贴图 + lang', async () => {
    const r = await gen.generate(
      ctx({ skins: [{ skinKey: 'Knight', displayName: 'Knight Armor', primaryColor: '#334455' }] }),
    );
    const paths = r.files.map((f) => f.path);
    expect(paths).toContain('manifest.json');
    expect(paths).toContain('skins.json');
    expect(paths).toContain('textures/Knight.png');
    expect(paths).toContain('texts/en_US.lang');
    expect(r.buildCmd).toBe('');
  });

  it('CSPJ101：skins.json 必定产出（官方 Error 级要求）', async () => {
    const r = await gen.generate(ctx({ skins: [] }));
    expect(r.files.some((f) => f.path === 'skins.json')).toBe(true);
  });
});

describe('manifest.json', () => {
  it('模块类型是 skin_pack（官方示例，不是 behavior/resource 的 data/resources）', async () => {
    const r = await gen.generate(ctx({ skins: [] }));
    const m = parse(r.files, 'manifest.json') as { modules: Array<{ type: string }> };
    expect(m.modules[0]?.type).toBe('skin_pack');
  });

  it('不含 min_engine_version（官方 skin pack 示例没有该字段，§6.2 亦如此判定）', async () => {
    const r = await gen.generate(ctx({ skins: [] }));
    const m = parse(r.files, 'manifest.json') as { header: Record<string, unknown> };
    expect(m.header).not.toHaveProperty('min_engine_version');
    // 反面：普通基岩生成器会回落到 mcVersion，skin pack 刻意不做
    expect(m.header).toHaveProperty('uuid');
    expect(m.header).toHaveProperty('version');
  });
});

describe('skins.json（CSPJ103 / CSPJ115 强制）', () => {
  it('CSPJ103：localization_name 与 serialize_name 必须相同（用字面量断言官方示例值）', async () => {
    const r = await gen.generate(ctx({ serializeName: 'FantasyAdventure', skins: [] }));
    const d = parse(r.files, 'skins.json') as {
      serialize_name: string;
      localization_name: string;
    };
    // 字面量钉死，而不是 toBe(d.serialize_name) —— 后者只验自洽，钉不住值
    expect(d.serialize_name).toBe('FantasyAdventure');
    expect(d.localization_name).toBe('FantasyAdventure');
  });

  it('CSPJ115：geometry 输出官方完整 ID', async () => {
    const r = await gen.generate(
      ctx({
        skins: [
          { skinKey: 'A', displayName: 'A', geometry: 'custom', primaryColor: '#111111' },
          { skinKey: 'B', displayName: 'B', geometry: 'customSlim', primaryColor: '#111111' },
        ],
      }),
    );
    const d = parse(r.files, 'skins.json') as { skins: Array<{ geometry: string }> };
    expect(d.skins[0]?.geometry).toBe('geometry.humanoid.custom');
    expect(d.skins[1]?.geometry).toBe('geometry.humanoid.customSlim');
  });

  it('CSPJ115：非法 geometry 被 schema 拒（不能产出坏包）', () => {
    expect(() =>
      SkinPackSpec.parse({
        serializeName: 'P',
        packName: 'P',
        skins: [{ skinKey: 'A', displayName: 'A', geometry: 'humanoid' }],
      }),
    ).toThrow();
  });

  it('CSPJ113：标识符不得有首尾空白', () => {
    for (const bad of [' Pack', 'Pack ', 'Pa ck']) {
      expect(
        () => SkinPackSpec.parse({ serializeName: bad, packName: 'P', skins: [] }),
        bad,
      ).toThrow();
    }
  });
});

describe('CSPJ107 贴图尺寸（Error 级，最硬的规则之一）', () => {
  it('默认 64×64 —— 断言的是 PNG 字节里的真实宽高', async () => {
    const r = await gen.generate(
      ctx({ skins: [{ skinKey: 'K', displayName: 'K', primaryColor: '#804000' }] }),
    );
    expect(pngSize(r.files, 'textures/K.png')).toEqual({ width: 64, height: 64 });
  });

  it('显式 128 时产出 128×128（官方 CSPJ107 同时认可 64 与 128）', async () => {
    const r = await gen.generate(
      ctx({
        textureSize: 128,
        skins: [{ skinKey: 'K', displayName: 'K', primaryColor: '#804000' }],
      }),
    );
    expect(pngSize(r.files, 'textures/K.png')).toEqual({ width: 128, height: 128 });
  });

  it('其它尺寸一律被拒，不做「就近取整」', () => {
    for (const bad of [32, 96, 256, 63, 65]) {
      expect(
        () =>
          SkinPackSpec.parse({
            serializeName: 'P',
            packName: 'P',
            textureSize: bad,
            skins: [],
          }),
        String(bad),
      ).toThrow();
    }
  });
});

describe('CSPJ106 披风尺寸（Error 级，固定 64×32）', () => {
  it('披风固定 64×32', async () => {
    const r = await gen.generate(ctx({ cape: { capeKey: 'MyCape', color: '#402020' }, skins: [] }));
    expect(pngSize(r.files, 'textures/MyCape.png')).toEqual({
      width: CAPE_TEXTURE_SIZE.width,
      height: CAPE_TEXTURE_SIZE.height,
    });
    // 字面量钉死官方数值，不只引用常量
    expect(CAPE_TEXTURE_SIZE.width).toBe(64);
    expect(CAPE_TEXTURE_SIZE.height).toBe(32);
  });

  it('披风也进 skins[]（官方把披风作为 skins 条目）', async () => {
    const r = await gen.generate(ctx({ cape: { capeKey: 'MyCape' }, skins: [] }));
    const d = parse(r.files, 'skins.json') as {
      skins: Array<{ localization_name: string; texture: string }>;
    };
    expect(d.skins).toHaveLength(1);
    expect(d.skins[0]?.localization_name).toBe('MyCape');
    expect(d.skins[0]?.texture).toBe('MyCape.png');
  });

  it('schema 不提供披风尺寸字段：传入 size 会被剥离，无法影响产物', async () => {
    // 注意机制：zod 默认**剥离**未知键而非报错（与仓内既有约定一致，
    // 同文件 persona 那条也是断言「被剥离」）。所以这里断言的是
    // 「size 进不了产物」，而不是「parse 会抛错」—— 后者是写错了机制。
    const parsed = SkinPackSpec.parse({
      serializeName: 'P',
      packName: 'P',
      cape: { capeKey: 'C', size: 128 },
      skins: [],
    });
    expect(JSON.stringify(parsed)).not.toContain('128');

    const r = await gen.generate(ctx({ cape: { capeKey: 'C' } as never, skins: [] }));
    // 无论怎么传，披风永远是官方规定的 64×32
    expect(pngSize(r.files, 'textures/C.png')).toEqual({ width: 64, height: 32 });
  });
});

describe('CSPJ116 数量上限（Error 级，最多 80）', () => {
  it('81 个皮肤被 schema 拒', () => {
    const skins = Array.from({ length: 81 }, (_, i) => ({
      skinKey: `S${i}`,
      displayName: `S${i}`,
    }));
    expect(() => SkinPackSpec.parse({ serializeName: 'P', packName: 'P', skins })).toThrow();
  });

  it('80 个刚好放行（边界不是拍脑袋写的）', () => {
    const skins = Array.from({ length: 80 }, (_, i) => ({
      skinKey: `S${i}`,
      displayName: `S${i}`,
    }));
    const parsed = SkinPackSpec.parse({ serializeName: 'P', packName: 'P', skins });
    expect(parsed.skins).toHaveLength(80);
  });
});

describe('CSPJ105 / CSPJ110 贴图引用', () => {
  it('CSPJ105：两个皮肤共用贴图给告警', async () => {
    const r = await gen.generate(
      ctx({
        skins: [
          { skinKey: 'A', displayName: 'A', texture: 'Shared' },
          { skinKey: 'B', displayName: 'B', texture: 'Shared' },
        ],
      }),
    );
    expect(r.warnings.some((w) => w.includes('CSPJ105'))).toBe(true);
  });

  it('CSPJ110：不产出任何未被 skins.json 引用的贴图', async () => {
    const r = await gen.generate(
      ctx({
        skins: [
          { skinKey: 'A', displayName: 'A' },
          { skinKey: 'B', displayName: 'B' },
        ],
        cape: { capeKey: 'C' },
      }),
    );
    const textures = r.files
      .filter((f) => f.path.startsWith('textures/'))
      .map((f) => f.path.replace('textures/', ''));
    const d = parse(r.files, 'skins.json') as {
      skins: Array<{ texture: string }>;
    };
    const referenced = d.skins.map((s) => s.texture);
    // 每个贴图都被引用，且没有多余的
    expect([...textures].sort()).toEqual([...referenced].sort());
  });
});

describe('CSPJ111 本地化键（Error 级）', () => {
  it('每个皮肤都有 skin.<pack>.<key> 条目（lang 里没给译文也回落 displayName）', async () => {
    const r = await gen.generate(
      ctx({
        skins: [
          { skinKey: 'MageRobe', displayName: 'Mystical Mage Robes' },
          { skinKey: 'Warrior', displayName: 'Legendary Warrior Armor' },
        ],
      }),
    );
    const lines = lang(r.files);
    expect(lines).toContain('skinpack.AdventurePack=Adventure Pack');
    expect(lines).toContain('skin.AdventurePack.MageRobe=Mystical Mage Robes');
    expect(lines).toContain('skin.AdventurePack.Warrior=Legendary Warrior Armor');
  });

  it('有 author 时产出 skinpack.<pack>.by（官方 pack attribution 键）', async () => {
    const r = await gen.generate(ctx({ packAuthor: 'Epic Creators', skins: [] }));
    expect(lang(r.files)).toContain('skinpack.AdventurePack.by=Epic Creators');
  });

  it('额外 locale 也必须覆盖全部皮肤键（缺一个就是 CSPJ111）', async () => {
    const r = await gen.generate(
      ctx({
        skins: [
          { skinKey: 'Knight', displayName: 'Knight Armor' },
          { skinKey: 'Mage', displayName: 'Mage Robes' },
        ],
        lang: { zh_CN: { Knight: '骑士' } },
      }),
    );
    const zh = lang(r.files, 'texts/zh_CN.lang');
    expect(zh).toContain('skin.AdventurePack.Knight=骑士');
    // Mage 没给译文 → 回落 displayName，而不是留空键（空值会被游戏显示成键名本身）
    expect(zh).toContain('skin.AdventurePack.Mage=Mage Robes');
  });

  it('CSPJ112：lang 里多余的键仍输出（保留用户译文），但不改 skins.json', async () => {
    const r = await gen.generate(
      ctx({ skins: [{ skinKey: 'A', displayName: 'A' }], lang: { zh_CN: { Extra: '多余' } } }),
    );
    const zh = lang(r.files, 'texts/zh_CN.lang');
    expect(zh).toContain('skin.AdventurePack.Extra=多余');
    const d = parse(r.files, 'skins.json') as { skins: unknown[] };
    expect(d.skins).toHaveLength(1);
  });
});

describe('明确未实现：HD / Persona', () => {
  it('每次生成都带出未实现原因，且写明 CSPJ108 与「不猜」', async () => {
    const r = await gen.generate(ctx({ skins: [] }));
    const w = r.warnings.find((x) => x.includes('HD/Persona'));
    expect(w).toBeDefined();
    expect(w).toContain('CSPJ108');
    expect(w).toContain('Creator');
  });

  it('schema 不提供任何 persona/HD 字段（无法被误用）', () => {
    const parsed = SkinPackSpec.parse({
      serializeName: 'P',
      packName: 'P',
      skins: [{ skinKey: 'A', displayName: 'A', persona: 'x' }],
    });
    // zod 默认剥离未知键 → 产物里不会出现 persona
    expect(JSON.stringify(parsed)).not.toContain('persona');
  });
});

describe('空包与告警', () => {
  it('既无皮肤也无披风时告警（产出的包不会被游戏识别到内容）', async () => {
    const r = await gen.generate(ctx({ skins: [] }));
    expect(r.warnings.some((w) => w.includes('未生成任何皮肤或披风'))).toBe(true);
  });

  it('type: paid 给告警（第三方包不该用 marketplace 专用字段）', async () => {
    const r = await gen.generate(
      ctx({ skins: [{ skinKey: 'A', displayName: 'A', type: 'paid' }] }),
    );
    expect(r.warnings.some((w) => w.includes('paid'))).toBe(true);
  });
});
