/**
 * Texture Set 测试（§6.4 材质 / §5.5 资源包 PBR）。
 *
 * 断言锚在官方页面原文给的规则与示例上（实抓，见 texture-set.ts 头部链接），
 * 特别是官方明确列出的**非法 texture_set 条件**（"Invalid *.texture_set.json" 段）——
 * 那段是游戏真会拒绝的清单，逐条覆盖。
 */
import { describe, expect, it } from 'vitest';
import {
  TEXTURE_EXTENSION_PRIORITY,
  TEXTURE_SET_FORMAT_VERSION,
  TEXTURE_SET_LAYERS,
  TextureSetError,
  dominantProperty,
  merToHex,
  mersToArgb,
  pickTexture,
  renderTextureSet,
  textureSetPath,
  validateTextureSet,
  type TextureSetSpec,
} from './texture-set.js';

const BASE: TextureSetSpec = {
  name: 'ruby_sword',
  layers: { color: 'ruby_sword' },
};

function parse(text: string): { format_version: unknown; ts: Record<string, unknown> } {
  const doc = JSON.parse(text) as Record<string, unknown>;
  return {
    format_version: doc['format_version'],
    ts: doc['minecraft:texture_set'] as Record<string, unknown>,
  };
}

describe('渲染形状（官方 schema 1.21.30）', () => {
  it('顶层是 format_version（字符串）+ minecraft:texture_set（对象）', () => {
    const p = parse(renderTextureSet(BASE));
    expect(p.format_version).toBe(TEXTURE_SET_FORMAT_VERSION);
    expect(TEXTURE_SET_FORMAT_VERSION).toBe('1.21.30');
    expect(typeof p.ts).toBe('object');
  });

  it('format_version 是字符串不是数字（官方示例写的是 "1.16.100"）', () => {
    const p = parse(renderTextureSet(BASE));
    expect(typeof p.format_version).toBe('string');
  });

  it('文件名是 <基名>.texture_set.json，与贴图同目录', () => {
    expect(textureSetPath('ruby_sword')).toBe('textures/entity/ruby_sword.texture_set.json');
    expect(textureSetPath('a', 'textures/items')).toBe('textures/items/a.texture_set.json');
  });

  it('只写出现的层，不写 undefined 键', () => {
    const text = renderTextureSet({ ...BASE, layers: { color: 'x', normal: 'x_normal' } });
    const p = parse(text);
    expect(Object.keys(p.ts).sort()).toEqual(['color', 'normal']);
    expect(text).not.toContain('undefined');
  });

  it('官方示例「数值 color + 十六进制 MER + 引用 normal」原样可渲染', () => {
    const p = parse(
      renderTextureSet({
        name: 'grass_carried',
        layers: {
          color: [180, 140, 190, 255],
          metalness_emissive_roughness: '#FBA34C',
          normal: 'grass_carried_normal',
        },
      }),
    );
    expect(p.ts['color']).toEqual([180, 140, 190, 255]);
    expect(p.ts['metalness_emissive_roughness']).toBe('#FBA34C');
    expect(p.ts['normal']).toBe('grass_carried_normal');
  });

  it('官方示例「引用 color + MER + heightmap」可渲染', () => {
    const p = parse(
      renderTextureSet({
        name: 'grass_carried',
        layers: {
          color: 'grass_carried',
          metalness_emissive_roughness: 'grass_carried_mer',
          heightmap: 'grass_carried_heightmap',
        },
      }),
    );
    expect(p.ts['heightmap']).toBe('grass_carried_heightmap');
  });

  it('官方示例「1.21.30 + MERS + normal」（子表面示例）可渲染', () => {
    const p = parse(
      renderTextureSet({
        name: 'cactus_side',
        pipeline: 'vibrant_visuals',
        layers: {
          color: 'cactus_side',
          metalness_emissive_roughness_subsurface: 'cactus_side_mers',
          normal: 'cactus_side_normal',
        },
      }),
    );
    expect(p.ts['metalness_emissive_roughness_subsurface']).toBe('cactus_side_mers');
  });

  it('五层键名与官方 schema 完全一致', () => {
    expect([...TEXTURE_SET_LAYERS]).toEqual([
      'color',
      'normal',
      'heightmap',
      'metalness_emissive_roughness',
      'metalness_emissive_roughness_subsurface',
    ]);
  });
});

describe('官方「Invalid」清单逐条覆盖', () => {
  it('缺 color → 报错（唯一必填层）', () => {
    const issues = validateTextureSet({
      name: 'x',
      layers: {} as TextureSetSpec['layers'],
    });
    expect(issues.some((i) => i.path === 'color' && i.message.includes('唯一必填'))).toBe(true);
  });

  it('normal 与 heightmap 同时定义 → 报错', () => {
    const issues = validateTextureSet({
      ...BASE,
      layers: { color: 'x', normal: 'x_n', heightmap: 'x_h' },
    });
    expect(issues.some((i) => i.message.includes('不得同时定义'))).toBe(true);
  });

  it('MER 与 MERS 同时定义 → 报错', () => {
    const issues = validateTextureSet({
      ...BASE,
      layers: {
        color: 'x',
        metalness_emissive_roughness: 'x_mer',
        metalness_emissive_roughness_subsurface: 'x_mers',
      },
    });
    expect(issues.some((i) => i.message.includes('MER 与 MERS'))).toBe(true);
  });

  it('heightmap 用于 texture-based object → 报错（官方 Caution）', () => {
    const issues = validateTextureSet({
      name: 'item_x',
      textureBasedObject: true,
      layers: { color: 'item_x', heightmap: 'item_x_h' },
    });
    expect(issues.some((i) => i.path === 'heightmap' && i.message.includes('normal'))).toBe(true);
  });

  it('heightmap 必须是单通道均匀值或贴图引用', () => {
    // 官方原文：single channel layer 用 "2 hex digits"。非单通道的数组被拒。
    expect(
      validateTextureSet({ ...BASE, layers: { color: 'x', heightmap: [128, 0] } }).some((i) =>
        i.message.includes('单通道'),
      ),
    ).toBe(true);
    expect(
      validateTextureSet({ ...BASE, layers: { color: 'x', heightmap: [128, 0, 0] } }).some((i) =>
        i.message.includes('单通道'),
      ),
    ).toBe(true);
    // 形态本身不合法（对象 / 布尔）→ 拒
    expect(
      validateTextureSet({ ...BASE, layers: { color: 'x', heightmap: true } as never }).some((i) =>
        i.message.includes('单通道'),
      ),
    ).toBe(true);
    // 合法的单通道均匀值：1 项整数 / 裸整数 / 2 位十六进制（带不带 # 都收）
    expect(validateTextureSet({ ...BASE, layers: { color: 'x', heightmap: 128 } })).toEqual([]);
    expect(validateTextureSet({ ...BASE, layers: { color: 'x', heightmap: [128] } })).toEqual([]);
    expect(validateTextureSet({ ...BASE, layers: { color: 'x', heightmap: '80' } })).toEqual([]);
    expect(validateTextureSet({ ...BASE, layers: { color: 'x', heightmap: '#80' } })).toEqual([]);
  });

  it('官方消歧缺口：4 位十六进制按「贴图引用」放行（官方未规定优先级，不自行发明）', () => {
    // 官方页面未说明字符串该优先按均匀值还是按贴图名解释。本模块取并集，
    // 故 '8080'（既非 2 位十六进制、也长得像贴图名）按引用判为合法。
    // 这条断言是为了把该缺口显式钉住，避免日后有人以为已消歧。
    expect(validateTextureSet({ ...BASE, layers: { color: 'x', heightmap: '8080' } })).toEqual([]);
  });

  it('MER 均匀值必须 3 通道', () => {
    expect(
      validateTextureSet({
        ...BASE,
        layers: { color: 'x', metalness_emissive_roughness: [130, 135] },
      }).some((i) => i.message.includes('3 项')),
    ).toBe(true);
    expect(
      validateTextureSet({
        ...BASE,
        layers: { color: 'x', metalness_emissive_roughness: [130, 135, 140, 1] },
      }).some((i) => i.message.includes('3 项')),
    ).toBe(true);
    // 合法的 3 通道与 6 位十六进制
    expect(
      validateTextureSet({
        ...BASE,
        layers: { color: 'x', metalness_emissive_roughness: [130, 135, 140] },
      }),
    ).toEqual([]);
    expect(
      validateTextureSet({
        ...BASE,
        layers: { color: 'x', metalness_emissive_roughness: 'FBA34C' },
      }),
    ).toEqual([]);
  });

  it('MERS 均匀值必须 4 通道', () => {
    expect(
      validateTextureSet({
        ...BASE,
        layers: { color: 'x', metalness_emissive_roughness_subsurface: [1, 2, 3] },
      }).some((i) => i.message.includes('4 项')),
    ).toBe(true);
    expect(
      validateTextureSet({
        ...BASE,
        layers: { color: 'x', metalness_emissive_roughness_subsurface: [1, 2, 3, 4] },
      }),
    ).toEqual([]);
  });

  it('color 均匀值必须 4 通道（官方：Color support 4-channel values）', () => {
    expect(
      validateTextureSet({ ...BASE, layers: { color: [1, 2, 3] } }).some((i) =>
        i.message.includes('4 项'),
      ),
    ).toBe(true);
    expect(validateTextureSet({ ...BASE, layers: { color: [1, 2, 3, 4] } })).toEqual([]);
    expect(validateTextureSet({ ...BASE, layers: { color: 'FFAABBCC' } })).toEqual([]);
  });

  it('通道值超 0-255 / 非整数被拒', () => {
    expect(
      validateTextureSet({ ...BASE, layers: { color: [1, 2, 3, 300] } }).length,
    ).toBeGreaterThan(0);
    expect(
      validateTextureSet({ ...BASE, layers: { color: [1, 2, 3, 4.5] } }).length,
    ).toBeGreaterThan(0);
  });

  it('贴图引用须无扩展名、无越界（官方：只能引用同包内贴图）', () => {
    expect(
      validateTextureSet({ ...BASE, layers: { color: '../other/x' } }).some((i) =>
        i.message.includes('同包内'),
      ),
    ).toBe(true);
    expect(
      validateTextureSet({ ...BASE, layers: { color: 'x.png' } }).some((i) =>
        i.message.includes('同包内'),
      ),
    ).toBe(true);
    expect(validateTextureSet({ ...BASE, layers: { color: 'a_b-c/d' } })).toEqual([]);
  });

  it('贴图基名不得带扩展名', () => {
    expect(
      validateTextureSet({ name: 'x.png', layers: { color: 'x' } }).some((i) =>
        i.message.includes('扩展名'),
      ),
    ).toBe(true);
  });

  it('多层问题一次性全列', () => {
    const issues = validateTextureSet({
      name: 'x.png',
      textureBasedObject: true,
      layers: {
        color: [1, 2],
        normal: 'n',
        heightmap: [1, 2],
        metalness_emissive_roughness: [1],
        metalness_emissive_roughness_subsurface: [1, 2],
      },
    });
    expect(issues.length).toBeGreaterThanOrEqual(5);
  });
});

describe('RTX 下 subsurface 被忽略（官方明文）', () => {
  it('pipeline=rtx + MERS 均匀值 → 报错并给出改用 MER 的提示', () => {
    const issues = validateTextureSet({
      name: 'x',
      pipeline: 'rtx',
      layers: { color: 'x', metalness_emissive_roughness_subsurface: [0, 0, 0, 128] },
    });
    const e = issues.find((i) => i.path === 'metalness_emissive_roughness_subsurface');
    expect(e?.message).toContain('RTX');
    expect(e?.message).toContain('MER');
  });

  it('pipeline=rtx + MERS 引用图 → 同样报错（官方：RTX 整层忽略，不只是均匀值）', () => {
    const issues = validateTextureSet({
      name: 'x',
      pipeline: 'rtx',
      layers: { color: 'x', metalness_emissive_roughness_subsurface: 'x_mers' },
    });
    expect(issues.some((i) => i.path === 'metalness_emissive_roughness_subsurface')).toBe(true);
  });

  it('pipeline=rtx + MER 引用图 → 无问题（MER 是 RTX 真正用的）', () => {
    expect(
      validateTextureSet({
        name: 'x',
        pipeline: 'rtx',
        layers: { color: 'x', metalness_emissive_roughness: 'x_mer' },
      }),
    ).toEqual([]);
  });

  it('pipeline=vibrant_visuals + MERS → 无问题', () => {
    expect(
      validateTextureSet({
        name: 'x',
        pipeline: 'vibrant_visuals',
        layers: { color: 'x', metalness_emissive_roughness_subsurface: 'x_mers' },
      }),
    ).toEqual([]);
  });
});

describe('渲染失败即抛（不落游戏会丢弃的文件）', () => {
  it('非法定义抛 TextureSetError 并带全部问题', () => {
    let caught: unknown;
    try {
      renderTextureSet({ name: 'x', layers: { color: 'x', normal: 'n', heightmap: 'h' } });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(TextureSetError);
    if (caught instanceof TextureSetError) expect(caught.issues.length).toBeGreaterThan(0);
  });
});

describe('MER 通道映射（官方：R=Metalness, G=Emissive, B=Roughness）', () => {
  it('merToHex 按 R/G/B 顺序', () => {
    // R=0x12 M, G=0x34 E, B=0x56 R
    expect(merToHex(0x12, 0x34, 0x56)).toBe('#123456');
  });

  it('mersToArgb 把 subsurface 放 A 位', () => {
    // A=S=0x78, R=M=0x11, G=E=0x22, B=Rough=0x33
    expect(mersToArgb(0x11, 0x22, 0x33, 0x78)).toBe('78112233');
  });

  it('越界被夹紧，不会产出非法通道', () => {
    expect(merToHex(-10, 300, 12.7)).toBe('#00FF0C');
  });

  it('merToHex 产物能通过本模块校验（自洽）', () => {
    expect(
      validateTextureSet({
        name: 'x',
        layers: { color: 'x', metalness_emissive_roughness: merToHex(10, 20, 30) },
      }),
    ).toEqual([]);
    expect(
      validateTextureSet({
        name: 'x',
        pipeline: 'vibrant_visuals',
        layers: { color: 'x', metalness_emissive_roughness_subsurface: mersToArgb(1, 2, 3, 4) },
      }),
    ).toEqual([]);
  });
});

describe('metalness 与 subsurface 谁主导（官方规则 7）', () => {
  it('官方例子 [64,0,0,128] → 非金属带亚表面 128（subsurface 主导）', () => {
    expect(dominantProperty(64, 128)).toBe('subsurface');
  });

  it('官方例子 [255,0,0,64] → 金属且亚表面归 0（metalness 主导）', () => {
    expect(dominantProperty(255, 64)).toBe('metalness');
  });

  it('平局偏向 subsurface（官方原文 "A tie favors subsurface"）', () => {
    expect(dominantProperty(100, 100)).toBe('subsurface');
    expect(dominantProperty(0, 0)).toBe('subsurface');
  });
});

describe('重复图片引用的扩展名优先级（官方：.tga > .png > .jpg > .jpeg）', () => {
  it('优先级表与官方一致', () => {
    expect([...TEXTURE_EXTENSION_PRIORITY]).toEqual(['.tga', '.png', '.jpg', '.jpeg']);
  });

  it('多扩展名共存时挑中 tga（官方示例 grass.tga 胜出）', () => {
    expect(pickTexture(['grass.png', 'grass.tga'])).toBe('.tga');
    expect(pickTexture(['grass.jpg', 'grass.png'])).toBe('.png');
    expect(pickTexture(['grass.jpeg', 'grass.jpg'])).toBe('.jpg');
  });

  it('大小写不敏感；都不存在返 undefined', () => {
    expect(pickTexture(['grass.PNG', 'grass.TGA'])).toBe('.tga');
    expect(pickTexture(['grass.bmp'])).toBeUndefined();
    expect(pickTexture([])).toBeUndefined();
  });
});
