import { describe, it, expect } from 'vitest';
import { SkinGenerator } from './skin-generator.js';
import type { GeneratorContext, SkinSpec } from '@mc-creator/shared';

function makeCtx(spec: Partial<SkinSpec>): GeneratorContext {
  return {
    loader: 'fabric',
    mcVersion: '1.21.11',
    modId: 'test_skin',
    spec: {
      modId: 'test_skin',
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

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);

describe('SkinGenerator', () => {
  const gen = new SkinGenerator();

  it('默认皮肤生成（playerName.png，1 个文件）', async () => {
    const result = await gen.generate(makeCtx({
      playerName: 'Steve',
    }));
    expect(result.files).toHaveLength(1);
    expect(result.files[0].path).toBe('Steve.png');
  });

  it('默认 playerName 是 Player', async () => {
    const result = await gen.generate(makeCtx({}));
    expect(result.files[0].path).toBe('Player.png');
  });

  it('generatePreview=true 生成 2 个文件（皮肤 + preview.png）', async () => {
    const result = await gen.generate(makeCtx({
      playerName: 'Alex',
      generatePreview: true,
    }));
    expect(result.files).toHaveLength(2);
    const paths = result.files.map((f) => f.path).sort();
    expect(paths).toEqual(['Alex.png', 'preview.png']);
  });

  it('PNG content 是合法 base64，decode 后以 PNG signature 开头', async () => {
    const result = await gen.generate(makeCtx({
      playerName: 'Base64Test',
    }));
    const png = result.files[0];
    expect(typeof png.content).toBe('string');
    expect(png.content.length).toBeGreaterThan(0);
    const decoded = Buffer.from(png.content, 'base64');
    expect(decoded.subarray(0, 8)).toEqual(PNG_SIG);
    // 应以 IEND 结尾
    const tail = decoded.subarray(decoded.length - 12, decoded.length);
    expect(tail.subarray(4, 8).toString('ascii')).toBe('IEND');
  });

  it('classic 和 slim 两种 model 都生成成功', async () => {
    for (const model of ['classic', 'slim'] as const) {
      const result = await gen.generate(makeCtx({
        playerName: `P_${model}`,
        model,
      }));
      expect(result.files).toHaveLength(1);
      const decoded = Buffer.from(result.files[0].content, 'base64');
      expect(decoded.subarray(0, 8)).toEqual(PNG_SIG);
    }
  });

  it('皮肤为 64x64（IHDR 中宽高均为 64）', async () => {
    const result = await gen.generate(makeCtx({ playerName: 'Size' }));
    const decoded = Buffer.from(result.files[0].content, 'base64');
    // sig(8) + IHDR len(4) + type(4) + width(4)
    const width = decoded.readUInt32BE(8 + 4 + 4);
    const height = decoded.readUInt32BE(8 + 4 + 4 + 4);
    expect(width).toBe(64);
    expect(height).toBe(64);
  });

  it('buildCmd 是 echo 皮肤无需编译', async () => {
    const result = await gen.generate(makeCtx({ playerName: 'Cmd' }));
    expect(result.buildCmd).toBe('echo 皮肤无需编译');
  });

  it('warnings 包含 base64 编码说明', async () => {
    const result = await gen.generate(makeCtx({ playerName: 'Warn' }));
    expect(result.warnings).toContain('PNG 文件已 base64 编码，写入磁盘时需 decode');
  });
});
