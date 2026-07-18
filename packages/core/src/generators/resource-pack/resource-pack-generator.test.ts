import { describe, it, expect } from 'vitest';
import { ResourcePackGenerator } from './resource-pack-generator.js';
import type {
  GeneratorContext,
  ResourcePackSpec,
  TextureOverrideEntry,
  ModelEntry,
  FontEntry,
  SoundEntry,
} from '@mc-creator/shared';

function makeCtx(spec: Partial<ResourcePackSpec>): GeneratorContext {
  return {
    loader: 'fabric',
    mcVersion: '1.21.11',
    modId: 'test_rp',
    spec: {
      modId: 'test_rp',
      version: '1.0.0',
      name: 'Test',
      description: '',
      items: [],
      blocks: [],
      ...spec,
    } as any,
    projectPath: '',
  };
}

/** 构造完整 TextureOverrideEntry（补全 zod 默认字段，便于测试可读） */
function tex(p: Partial<TextureOverrideEntry>): TextureOverrideEntry {
  return { path: '', color: '#FFFFFF', width: 16, height: 16, checkerboard: false, ...p };
}

/** 构造完整 ModelEntry */
function mod(p: Partial<ModelEntry>): ModelEntry {
  return { path: '', json: '', autoCubeAll: true, textureName: '', ...p };
}

/** 构造完整 FontEntry */
function font(p: Partial<FontEntry>): FontEntry {
  return {
    id: '',
    char: '',
    texture: '',
    width: 8,
    height: 8,
    x: 0,
    y: 0,
    advance: 8,
    ascent: 7,
    ...p,
  };
}

/** 构造完整 SoundEntry */
function snd(p: Partial<SoundEntry>): SoundEntry {
  return { id: '', event: '', data: '', volume: 1, pitch: 1, stream: false, ...p };
}

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

describe('ResourcePackGenerator', () => {
  const gen = new ResourcePackGenerator();

  it('空 spec（最小配置）只生成 pack.mcmeta + 2 个 lang 文件', async () => {
    const result = await gen.generate(
      makeCtx({
        packName: 'Empty Pack',
        packDescription: '空资源包',
        packFormat: 34,
        namespace: 'minecraft',
      }),
    );

    // 仅 pack.mcmeta + en_us.json + zh_cn.json
    expect(result.files).toHaveLength(3);
    const paths = result.files.map((f) => f.path).sort();
    expect(paths).toEqual([
      'assets/minecraft/lang/en_us.json',
      'assets/minecraft/lang/zh_cn.json',
      'pack.mcmeta',
    ]);
  });

  it('textureOverrides 生成对应 PNG 文件', async () => {
    const result = await gen.generate(
      makeCtx({
        packName: 'Tex',
        textureOverrides: [
          tex({ path: 'block/stone', color: '#FF0000', width: 16, height: 16 }),
          tex({ path: 'item/diamond', color: '#00FF00', width: 8, height: 8 }),
        ],
      }),
    );

    const png1 = result.files.find((f) => f.path === 'assets/minecraft/textures/block/stone.png');
    const png2 = result.files.find((f) => f.path === 'assets/minecraft/textures/item/diamond.png');
    expect(png1).toBeDefined();
    expect(png2).toBeDefined();
    // decode 后应以 PNG signature 开头
    const decoded = Buffer.from(png1!.content, 'base64');
    expect(decoded.subarray(0, 8)).toEqual(PNG_SIG);
  });

  it('models 用 autoCubeAll 自动生成 cube_all JSON', async () => {
    const result = await gen.generate(
      makeCtx({
        packName: 'Model',
        models: [
          mod({ path: 'block/stone', autoCubeAll: true, textureName: 'stone' }),
          mod({ path: 'block/dirt' }), // textureName 默认为空，应使用 path basename
        ],
      }),
    );

    const m1 = result.files.find((f) => f.path === 'assets/minecraft/models/block/stone.json');
    expect(m1).toBeDefined();
    const parsed1 = JSON.parse(m1!.content);
    expect(parsed1.parent).toBe('minecraft:block/cube_all');
    expect(parsed1.textures.all).toBe('minecraft:block/stone');

    const m2 = result.files.find((f) => f.path === 'assets/minecraft/models/block/dirt.json');
    expect(m2).toBeDefined();
    const parsed2 = JSON.parse(m2!.content);
    // textureName 为空 → 使用 path basename（dirt）
    expect(parsed2.textures.all).toBe('minecraft:block/dirt');
  });

  it('models 用自定义 json 直接使用', async () => {
    const customJson = JSON.stringify({
      parent: 'minecraft:item/generated',
      textures: { layer0: 'minecraft:item/iron_ingot' },
    });
    const result = await gen.generate(
      makeCtx({
        packName: 'Custom',
        models: [mod({ path: 'item/iron', json: customJson, autoCubeAll: true })],
      }),
    );

    const m = result.files.find((f) => f.path === 'assets/minecraft/models/item/iron.json');
    expect(m).toBeDefined();
    const parsed = JSON.parse(m!.content);
    expect(parsed.parent).toBe('minecraft:item/generated');
    expect(parsed.textures.layer0).toBe('minecraft:item/iron_ingot');
  });

  it('fonts 生成贴图 PNG + font JSON', async () => {
    const result = await gen.generate(
      makeCtx({
        packName: 'Font',
        namespace: 'myfont',
        fonts: [
          font({ id: 'a', char: 'A', width: 8, height: 8 }),
          font({ id: 'b', char: 'B', width: 16, height: 16 }),
        ],
      }),
    );

    // 字体贴图 PNG
    const pngA = result.files.find((f) => f.path === 'assets/myfont/textures/font/a.png');
    const pngB = result.files.find((f) => f.path === 'assets/myfont/textures/font/b.png');
    expect(pngA).toBeDefined();
    expect(pngB).toBeDefined();
    // decode 后 PNG signature
    expect(Buffer.from(pngA!.content, 'base64').subarray(0, 8)).toEqual(PNG_SIG);

    // 字体定义 JSON
    const fontJson = result.files.find((f) => f.path === 'assets/myfont/font/myfont.json');
    expect(fontJson).toBeDefined();
    const parsed = JSON.parse(fontJson!.content);
    expect(Array.isArray(parsed.providers)).toBe(true);
    expect(parsed.providers).toHaveLength(2);
    expect(parsed.providers[0]).toEqual({
      type: 'bitmap',
      file: 'myfont:font/a.png',
      height: 8,
      ascent: 7,
      chars: ['A'],
    });
    expect(parsed.providers[1].chars).toEqual(['B']);
  });

  it('sounds 生成 sounds.json + 占位 ogg 文件', async () => {
    const result = await gen.generate(
      makeCtx({
        packName: 'Sound',
        namespace: 'mysound',
        sounds: [
          snd({ id: 'hit', event: 'block.stone.hit', volume: 1, pitch: 1, stream: false }),
          snd({ id: 'rain', event: 'ambience.rain', volume: 0.5, pitch: 1, stream: true }),
        ],
      }),
    );

    // ogg 占位文件
    const oggHit = result.files.find((f) => f.path === 'assets/mysound/sounds/hit.ogg');
    const oggRain = result.files.find((f) => f.path === 'assets/mysound/sounds/rain.ogg');
    expect(oggHit).toBeDefined();
    expect(oggRain).toBeDefined();
    // 空 data → 空字符串占位
    expect(oggHit!.content).toBe('');

    // sounds.json
    const soundsJson = result.files.find((f) => f.path === 'assets/mysound/sounds.json');
    expect(soundsJson).toBeDefined();
    const parsed = JSON.parse(soundsJson!.content);
    expect(parsed['block.stone.hit']).toBeDefined();
    expect(parsed['block.stone.hit'].sounds[0].name).toBe('mysound:hit');
    expect(parsed['block.stone.hit'].replace).toBe(false);
    expect(parsed['ambience.rain'].sounds[0].stream).toBe(true);
    expect(parsed['ambience.rain'].sounds[0].volume).toBe(0.5);
  });

  it('lang 文件内容正确', async () => {
    const result = await gen.generate(
      makeCtx({
        packName: 'Lang',
        namespace: 'minecraft',
        langEnUs: { 'item.test.name': 'Test Item', 'block.test.name': 'Test Block' },
        langZhCn: { 'item.test.name': '测试物品', 'block.test.name': '测试方块' },
      }),
    );

    const en = result.files.find((f) => f.path === 'assets/minecraft/lang/en_us.json');
    const zh = result.files.find((f) => f.path === 'assets/minecraft/lang/zh_cn.json');
    expect(en).toBeDefined();
    expect(zh).toBeDefined();
    const enParsed = JSON.parse(en!.content);
    const zhParsed = JSON.parse(zh!.content);
    expect(enParsed['item.test.name']).toBe('Test Item');
    expect(enParsed['block.test.name']).toBe('Test Block');
    expect(zhParsed['item.test.name']).toBe('测试物品');
    expect(zhParsed['block.test.name']).toBe('测试方块');
  });

  it('PNG 文件 content 是合法 base64，Buffer.from 后以 PNG signature 开头', async () => {
    const result = await gen.generate(
      makeCtx({
        packName: 'B64',
        namespace: 'b64',
        textureOverrides: [
          tex({ path: 'block/check', color: '#123456', width: 16, height: 16, checkerboard: true }),
        ],
        fonts: [font({ id: 'f1', char: 'F', width: 8, height: 8 })],
      }),
    );

    const pngFiles = result.files.filter((f) => f.path.endsWith('.png'));
    expect(pngFiles.length).toBeGreaterThanOrEqual(2);

    for (const png of pngFiles) {
      expect(typeof png.content).toBe('string');
      expect(png.content.length).toBeGreaterThan(0);
      const decoded = Buffer.from(png.content, 'base64');
      // 以 PNG signature 开头
      expect(decoded.subarray(0, 8)).toEqual(PNG_SIG);
      // 以 IEND 结尾（IEND chunk 共 12 字节：4 长度 + 4 类型 + 4 CRC）
      const tail = decoded.subarray(decoded.length - 12, decoded.length);
      expect(tail.subarray(4, 8).toString('ascii')).toBe('IEND');
    }
  });

  it('type/loaders/versions 元信息正确', () => {
    expect(gen.type).toBe('resource_pack');
    expect(gen.loaders).toEqual(['fabric', 'neoforge']);
    expect(gen.versions).toEqual(['1.21.1', '1.21.11']);
  });

  it('buildCmd 与 warnings 内容正确', async () => {
    const result = await gen.generate(
      makeCtx({
        packName: 'Cmd',
      }),
    );
    expect(result.buildCmd).toBe('echo 资源包无需编译');
    expect(result.warnings).toContain('PNG/OGG 文件已 base64 编码，写入磁盘时需 decode');
  });

  it('pack.mcmeta 内容正确', async () => {
    const result = await gen.generate(
      makeCtx({
        packName: 'My Pack',
        packDescription: '我的资源包',
        packFormat: 34,
      }),
    );
    const mcmeta = result.files.find((f) => f.path === 'pack.mcmeta');
    expect(mcmeta).toBeDefined();
    const parsed = JSON.parse(mcmeta!.content);
    expect(parsed.pack.pack_format).toBe(34);
    expect(parsed.pack.description).toBe('我的资源包');
  });

  it('textureOverrides 渐变与棋盘格不崩溃', async () => {
    const result = await gen.generate(
      makeCtx({
        packName: 'Grad',
        textureOverrides: [
          tex({
            path: 'block/sky',
            color: '#87CEEB',
            gradientTo: '#000080',
            width: 16,
            height: 16,
          }),
          tex({ path: 'block/grid', color: '#FF0000', checkerboard: true, width: 16, height: 16 }),
        ],
      }),
    );

    const grad = result.files.find((f) => f.path === 'assets/minecraft/textures/block/sky.png');
    const check = result.files.find((f) => f.path === 'assets/minecraft/textures/block/grid.png');
    expect(grad).toBeDefined();
    expect(check).toBeDefined();
    expect(Buffer.from(grad!.content, 'base64').subarray(0, 8)).toEqual(PNG_SIG);
    expect(Buffer.from(check!.content, 'base64').subarray(0, 8)).toEqual(PNG_SIG);
  });
});
