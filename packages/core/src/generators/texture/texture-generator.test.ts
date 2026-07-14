import { describe, it, expect } from 'vitest';
import { TextureGenerator } from './texture-generator.js';
import type { GeneratorContext, TextureSpec, TextureEntry } from '@mc-creator/shared';

function makeCtx(spec: Partial<TextureSpec>): GeneratorContext {
  return {
    loader: 'fabric',
    mcVersion: '1.21.11',
    modId: 'test_tex',
    spec: {
      modId: 'test_tex',
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

/** 构造完整 TextureEntry（补全 zod 默认字段，便于测试可读） */
function tex(p: Partial<TextureEntry>): TextureEntry {
  return { id: '', type: 'block', color: '#FFFFFF', width: 16, height: 16, checkerboard: false, ...p };
}

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);

describe('TextureGenerator', () => {
  const gen = new TextureGenerator();

  it('单个纯色材质生成（pack.mcmeta + 2 lang + 1 PNG = 4 文件）', async () => {
    const result = await gen.generate(makeCtx({
      packName: 'My Pack',
      packDescription: 'desc',
      packFormat: 34,
      modId: 'test_tex',
      textures: [
        tex({ id: 'ruby_block', type: 'block', color: '#FF0000', width: 16, height: 16, checkerboard: false }),
      ],
    }));

    expect(result.files).toHaveLength(4);
    const paths = result.files.map((f) => f.path).sort();
    expect(paths).toEqual([
      'assets/test_tex/lang/en_us.json',
      'assets/test_tex/lang/zh_cn.json',
      'assets/test_tex/textures/block/ruby_block.png',
      'pack.mcmeta',
    ]);
  });

  it('多个材质生成（pack.mcmeta + 2 lang + N PNG）', async () => {
    const result = await gen.generate(makeCtx({
      packName: 'Multi',
      modId: 'multi_mod',
      textures: [
        tex({ id: 'block_a', type: 'block', color: '#FF0000' }),
        tex({ id: 'item_b', type: 'item', color: '#00FF00' }),
        tex({ id: 'armor_c', type: 'armor', color: '#0000FF' }),
      ],
    }));

    // 1 mcmeta + 2 lang + 3 png
    expect(result.files).toHaveLength(6);
    expect(result.files.some((f) => f.path === 'assets/multi_mod/textures/block/block_a.png')).toBe(true);
    expect(result.files.some((f) => f.path === 'assets/multi_mod/textures/item/item_b.png')).toBe(true);
    expect(result.files.some((f) => f.path === 'assets/multi_mod/textures/armor/armor_c.png')).toBe(true);
  });

  it('gradientTo 渐变材质不崩溃', async () => {
    const result = await gen.generate(makeCtx({
      packName: 'Grad',
      modId: 'grad_mod',
      textures: [
        tex({ id: 'sky', type: 'block', color: '#87CEEB', gradientTo: '#000080', width: 16, height: 16 }),
      ],
    }));
    const png = result.files.find((f) => f.path === 'assets/grad_mod/textures/block/sky.png');
    expect(png).toBeDefined();
    const decoded = Buffer.from(png!.content, 'base64');
    expect(decoded.subarray(0, 8)).toEqual(PNG_SIG);
  });

  it('checkerboard=true 棋盘格材质不崩溃', async () => {
    const result = await gen.generate(makeCtx({
      packName: 'Check',
      modId: 'check_mod',
      textures: [
        tex({ id: 'test_grid', type: 'gui', color: '#FF0000', checkerboard: true, width: 16, height: 16 }),
      ],
    }));
    const png = result.files.find((f) => f.path === 'assets/check_mod/textures/gui/test_grid.png');
    expect(png).toBeDefined();
    const decoded = Buffer.from(png!.content, 'base64');
    expect(decoded.subarray(0, 8)).toEqual(PNG_SIG);
  });

  it('PNG 文件 content 是合法 base64，且 decode 后以 PNG signature 开头', async () => {
    const result = await gen.generate(makeCtx({
      packName: 'B64',
      modId: 'b64_mod',
      textures: [
        tex({ id: 'solid', type: 'item', color: '#123456', width: 8, height: 8 }),
      ],
    }));
    const png = result.files.find((f) => f.path.endsWith('.png'))!;
    // content 应该是合法 base64 字符串
    expect(typeof png.content).toBe('string');
    expect(png.content.length).toBeGreaterThan(0);
    // decode 后应以 PNG signature 开头
    const decoded = Buffer.from(png.content, 'base64');
    expect(decoded.subarray(0, 8)).toEqual(PNG_SIG);
    // decode 后应以 IEND 结尾
    const tail = decoded.subarray(decoded.length - 12, decoded.length);
    expect(tail.subarray(4, 8).toString('ascii')).toBe('IEND');
  });

  it('buildCmd 是 echo 材质包无需编译', async () => {
    const result = await gen.generate(makeCtx({
      packName: 'Cmd',
      modId: 'cmd_mod',
      textures: [],
    }));
    expect(result.buildCmd).toBe('echo 材质包无需编译');
  });

  it('warnings 包含 base64 编码说明', async () => {
    const result = await gen.generate(makeCtx({
      packName: 'W',
      modId: 'w_mod',
      textures: [tex({ id: 't', type: 'block', color: '#FFFFFF' })],
    }));
    expect(result.warnings).toContain('PNG 文件已 base64 编码，写入磁盘时需 decode');
  });

  it('pack.mcmeta 内容正确', async () => {
    const result = await gen.generate(makeCtx({
      packName: 'MetaPack',
      packDescription: '我的材质包',
      packFormat: 34,
      modId: 'meta_mod',
      textures: [],
    }));
    const mcmeta = result.files.find((f) => f.path === 'pack.mcmeta');
    expect(mcmeta).toBeDefined();
    const parsed = JSON.parse(mcmeta!.content);
    expect(parsed.pack.pack_format).toBe(34);
    expect(parsed.pack.description).toBe('我的材质包');
  });

  it('语言文件为空对象 {}', async () => {
    const result = await gen.generate(makeCtx({
      packName: 'Lang',
      modId: 'lang_mod',
      textures: [],
    }));
    const zh = result.files.find((f) => f.path === 'assets/lang_mod/lang/zh_cn.json');
    const en = result.files.find((f) => f.path === 'assets/lang_mod/lang/en_us.json');
    expect(zh).toBeDefined();
    expect(en).toBeDefined();
    expect(JSON.parse(zh!.content)).toEqual({});
    expect(JSON.parse(en!.content)).toEqual({});
  });
});
