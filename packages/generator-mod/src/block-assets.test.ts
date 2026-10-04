import { describe, it, expect } from 'vitest';
import { ModSpec as ModSpecSchema } from '@mc-creator/shared';
import type { ModSpec } from '@mc-creator/shared';
import { blockAssetFiles, mergeModels, resolveBlockModelType } from './block-assets.js';
import { collectUnimplemented } from './unsupported.js';

const NS = 'ruby_tools';

function specWith(blocks: unknown[], items: unknown[] = []): ModSpec {
  return ModSpecSchema.parse({
    modId: NS,
    version: '1.0.0',
    name: 'Ruby Tools',
    description: '',
    items,
    blocks,
  });
}

function block(overrides: Record<string, unknown>): Record<string, unknown> {
  return { id: 'ruby_block', name: 'Ruby Block', ...overrides };
}

function fileAt(spec: ModSpec, path: string) {
  const node = blockAssetFiles(spec).find((f) => f.path === path);
  expect(node, `missing ${path}`).toBeDefined();
  return JSON.parse(node!.content);
}

function blockModel(spec: ModSpec, id = 'ruby_block') {
  return fileAt(spec, `src/main/resources/assets/${NS}/models/block/${id}.json`);
}

describe('block-assets 方块资源生成', () => {
  it('cube_all：blockstate 路径 + cube_all 模型 + 方块物品模型', () => {
    const spec = specWith([block({ modelType: 'cube_all' })]);

    expect(fileAt(spec, `src/main/resources/assets/${NS}/blockstates/ruby_block.json`)).toEqual({
      variants: { '': { model: `${NS}:block/ruby_block` } },
    });

    expect(blockModel(spec)).toEqual({
      parent: 'minecraft:block/cube_all',
      textures: { all: `${NS}:block/ruby_block` },
    });

    expect(fileAt(spec, `src/main/resources/assets/${NS}/models/item/ruby_block.json`)).toEqual({
      parent: `${NS}:block/ruby_block`,
    });
  });

  it('cube_column：end/side 缺省回落到占位纹理（不引用 _top/_side）', () => {
    const spec = specWith([block({ modelType: 'cube_column' })]);
    expect(blockModel(spec)).toEqual({
      parent: 'minecraft:block/cube_column',
      textures: { end: `${NS}:block/ruby_block`, side: `${NS}:block/ruby_block` },
    });
  });

  it('cross：textures.cross + render_type=cutout，且 cutout 只出现在 cross', () => {
    const cross = specWith([block({ modelType: 'cross' })]);
    expect(blockModel(cross)).toEqual({
      parent: 'minecraft:block/cross',
      textures: { cross: `${NS}:block/ruby_block` },
      render_type: 'cutout',
    });

    const cubeAll = specWith([block({ modelType: 'cube_all' })]);
    expect(blockModel(cubeAll)).not.toHaveProperty('render_type');
  });

  it('door/fence/stairs/custom 回退为 cube_all', () => {
    for (const modelType of ['door', 'fence', 'stairs', 'custom']) {
      const spec = specWith([block({ modelType })]);
      expect(blockModel(spec)).toEqual({
        parent: 'minecraft:block/cube_all',
        textures: { all: `${NS}:block/ruby_block` },
      });
    }
  });

  it('texturePaths 覆盖生效（cube_column 取 top 作 end、north 作 side）', () => {
    const spec = specWith([
      block({
        modelType: 'cube_column',
        texturePaths: {
          top: 'other:block/top',
          bottom: 'other:block/bottom',
          north: 'other:block/n',
        },
      }),
    ]);
    expect(blockModel(spec)).toEqual({
      parent: 'minecraft:block/cube_column',
      textures: { end: 'other:block/top', side: 'other:block/n' },
    });
  });

  it('texturePath（单一纹理）覆盖 cube_all 的 all', () => {
    const spec = specWith([block({ modelType: 'cube_all', texturePath: 'other:block/x' })]);
    expect(blockModel(spec).textures).toEqual({ all: 'other:block/x' });
  });

  it('resolveBlockModelType：显式优先，缺失时按 blockType 推导', () => {
    expect(resolveBlockModelType({ modelType: 'cross', blockType: 'full_block' })).toBe('cross');
    expect(resolveBlockModelType({ blockType: 'full_block' })).toBe('cube_all');
    expect(resolveBlockModelType({ blockType: 'slab' })).toBe('custom');
  });

  it('block/item id 冲突：以方块为准，且不含重复路径', () => {
    const spec = specWith(
      [block({ modelType: 'cube_all' })],
      [{ id: 'ruby_block', name: 'Ruby Block Item' }],
    );
    const itemNodes = [
      {
        path: `src/main/resources/assets/${NS}/models/item/ruby_block.json`,
        content: JSON.stringify({ parent: 'minecraft:item/generated' }, null, 2),
      },
    ];
    const blockNodes = blockAssetFiles(spec);
    const merged = mergeModels(itemNodes, blockNodes);

    const paths = merged.map((f) => f.path);
    expect(new Set(paths).size).toBe(paths.length);
    const itemPath = `src/main/resources/assets/${NS}/models/item/ruby_block.json`;
    const node = merged.find((f) => f.path === itemPath)!;
    expect(JSON.parse(node.content)).toEqual({ parent: `${NS}:block/ruby_block` });
  });
});

describe('block-assets 回退警告', () => {
  it('door/fence/stairs 触发一条 block warning（可定位具体方块）', () => {
    const out = collectUnimplemented(
      { blocks: [{ id: 'ruby_block', blockType: 'full_block', modelType: 'stairs' }] },
      'fabric',
    );
    expect(out.length).toBe(1);
    expect(out[0]).toMatchObject({ kind: 'block', type: 'stairs', id: 'ruby_block' });

    // 无法识别的取值同样回退并告警
    const weird = collectUnimplemented(
      { blocks: [{ id: 'x', modelType: 'weird_model' }] },
      'fabric',
    );
    expect(weird[0]).toMatchObject({ kind: 'block', type: 'weird_model', id: 'x' });
  });

  it('支持的模型类型不产生警告', () => {
    const out = collectUnimplemented(
      {
        blocks: [
          { id: 'a', blockType: 'full_block', modelType: 'cube_all' },
          { id: 'b', blockType: 'full_block', modelType: 'cube_column' },
          { id: 'c', blockType: 'full_block', modelType: 'cross' },
        ],
      },
      'fabric',
    );
    expect(out).toEqual([]);
  });
});
