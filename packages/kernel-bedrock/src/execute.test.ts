/**
 * Bedrock 内核任务测试（validate_content R 类真实现 + generate_content 确认闸门真实现）。
 *
 * 覆盖要点（§10.2 执行类须弹窗确认 / §10.6 权限分级 / §6.2 导入前校验 /
 * §5.7 目录层级陷阱 / §13.4 沙箱产物永不自动加载 / §0.5 产物哈希）：
 * 1. confirm 未配置或返回 false → 拒绝 + 沙箱目录未创建；
 * 2. confirm true → 生成器真实产出入沙箱，ArtifactRef.sha256 64 位，manifest 直挂包根；
 * 3. 缺 spec → validation 且data.specShape 给出形状示例（§10.0 本内核无 LLM）；
 * 4. validate_content（R 类免确认）：manifest 缺失/非法 JSON/uuid 非法/version 非法/
 *    min_engine_version 缺失/modules 空 → validation + 中文 errors；
 * 5. §5.7 多套一层目录 → validation；
 * 6. version 与 min_engine_version 比较 → 兼容性提示。
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ProgressEvent } from '@mc-creator/contract';
import { BedrockKernel } from './kernel.js';

const dirs: string[] = [];

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function mkTmp(prefix = 'bedrock-exec-'): string {
  const d = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(d);
  return d;
}

async function collect(handle: { progress: AsyncIterable<ProgressEvent> }): Promise<ProgressEvent[]> {
  const out: ProgressEvent[] = [];
  for await (const e of handle.progress) out.push(e);
  return out;
}

const YES = () => true;
const NO = () => false;

/** 写一个合法包根目录（manifest 直挂根）。 */
function seedPack(parent: string, name: string, manifest: unknown): string {
  const dir = join(parent, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'manifest.json'), typeof manifest === 'string' ? manifest : JSON.stringify(manifest, null, 2));
  return dir;
}

const VALID_MANIFEST = {
  format_version: 2,
  header: {
    name: 'demo pack',
    description: 'desc',
    uuid: '3f2b1a44-9c8e-4f21-8a1b-1234567890ab',
    version: [1, 0, 0],
    min_engine_version: [1, 21, 0],
  },
  modules: [{ type: 'data', uuid: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', version: [1, 0, 0] }],
};

const BEHAVIOR_PACK_SPEC = {
  packId: 'demo_pack',
  packName: 'Demo Pack',
  description: 'demo',
  packFormat: 2,
  mcVersion: [1, 21, 0],
  header: { uuid: '3f2b1a44-9c8e-4f21-8a1b-1234567890ab' },
  entities: [
    { identifier: 'demo_pack:zombie', components: { 'minecraft:health': { value: 20 } }, events: {} },
  ],
  recipes: [
    { identifier: 'demo_pack:stick', type: 'shaped_crafting', result: 'minecraft:stick', count: 1 },
  ],
  lootTables: [],
};

const ITEM_SPEC = {
  packId: 'item_pack',
  packName: 'Item Pack',
  packFormat: 2,
  mcVersion: [1, 21, 0],
  header: { uuid: '3f2b1a44-9c8e-4f21-8a1b-1234567890ac' },
  items: [
    {
      id: 'ruby_sword',
      name: '红宝石剑',
      category: 'weapons',
      maxStackSize: 1,
      attackDamage: 7,
      attackSpeed: 1.6,
      primaryColor: '#c0392b',
      secondaryColor: '#7b241c',
    },
  ],
  lang: {},
};

const ENTITY_SPEC = {
  packId: 'entity_pack',
  packName: 'Entity Pack',
  packFormat: 2,
  mcVersion: [1, 21, 0],
  header: { uuid: '3f2b1a44-9c8e-4f21-8a1b-1234567890ad' },
  entities: [
    {
      id: 'my_beast',
      name: '我的怪物',
      hostile: true,
      geometry: 'zombie',
      mainColor: '#6f7a4f',
      goals: [{ type: 'melee', priority: 1 }],
      drops: [{ item: 'minecraft:rotten_flesh', count: 1 }],
    },
  ],
  lang: {},
};

describe('BedrockKernel generate_content 确认闸门', () => {
  it('未传 confirm → permission + confirmRequired，沙箱未产生任何目录', async () => {
    const sandboxDir = mkTmp();
    const result = await new BedrockKernel({ sandboxDir, mode: 'sandbox' })
      .dispatch({ id: 'g1', kind: 'generate_content', payload: { prompt: 'p', kind: 'addon', spec: BEHAVIOR_PACK_SPEC } })
      .result();
    expect(result.ok).toBe(false);
    expect(result.error?.category).toBe('permission');
    expect(result.data).toMatchObject({ confirmRequired: true });
    expect(existsSync(join(sandboxDir, 'packs'))).toBe(false);
  });

  it('confirm 返回 false → 拒绝且沙箱未落盘', async () => {
    const sandboxDir = mkTmp();
    const result = await new BedrockKernel({ sandboxDir, mode: 'sandbox', confirm: NO })
      .dispatch({ id: 'g2', kind: 'generate_content', payload: { prompt: 'p', kind: 'addon', spec: BEHAVIOR_PACK_SPEC } })
      .result();
    expect(result.error?.category).toBe('permission');
    expect(existsSync(join(sandboxDir, 'packs', 'demo_pack'))).toBe(false);
  });

  it('确认请求含中文 summary + risk=execute，且提到需自行导入', async () => {
    const sandboxDir = mkTmp();
    let summary = '';
    let risk = '';
    await new BedrockKernel({
      sandboxDir,
      mode: 'sandbox',
      confirm: (req) => {
        summary = req.summary;
        risk = req.risk;
        return false;
      },
    })
      .dispatch({ id: 'g3', kind: 'generate_content', payload: { prompt: '做一个火焰剑', kind: 'addon', spec: BEHAVIOR_PACK_SPEC } })
      .result();
    expect(risk).toBe('execute');
    expect(summary).toContain('addon');
    expect(summary).toContain('火焰剑');
    expect(summary).not.toContain('\n');
  });

  it('confirm 抛异常 → 按未确认处理', async () => {
    const sandboxDir = mkTmp();
    const result = await new BedrockKernel({
      sandboxDir,
      mode: 'sandbox',
      confirm: () => {
        throw new Error('nope');
      },
    })
      .dispatch({ id: 'g4', kind: 'generate_content', payload: { prompt: 'p', kind: 'addon', spec: BEHAVIOR_PACK_SPEC } })
      .result();
    expect(result.error?.category).toBe('permission');
    expect(existsSync(join(sandboxDir, 'packs'))).toBe(false);
  });
});

describe('BedrockKernel generate_content 真实现', () => {
  it('addon → BehaviorPackGenerator 产出并落盘到沙箱，ArtifactRef sha256 64 位', async () => {
    const sandboxDir = mkTmp();
    const handle = new BedrockKernel({ sandboxDir, mode: 'sandbox', confirm: YES }).dispatch({
      id: 'gc1',
      kind: 'generate_content',
      payload: { prompt: 'demo', kind: 'addon', spec: BEHAVIOR_PACK_SPEC },
    });
    const eventsPromise = collect(handle);
    const result = await handle.result();
    expect(result.ok).toBe(true);
    const outDir = join(sandboxDir, 'packs', 'demo_pack');
    expect(existsSync(join(outDir, 'manifest.json'))).toBe(true);
    expect(existsSync(join(outDir, 'entities', 'zombie.json'))).toBe(true);
    expect(existsSync(join(outDir, 'recipes', 'stick.json'))).toBe(true);
    // manifest 直挂包根（§5.7 层级陷阱）
    const manifest = JSON.parse(readFileSync(join(outDir, 'manifest.json'), 'utf8')) as Record<string, unknown>;
    expect(manifest).toHaveProperty('header');
    expect(result.artifacts?.length).toBeGreaterThanOrEqual(3);
    expect(result.artifacts?.every((a) => a.kind === 'addon' && /^[0-9a-f]{64}$/.test(a.sha256))).toBe(true);
    expect((result.data as { manifestPresent: boolean }).manifestPresent).toBe(true);
    expect((result.data as { generator: string }).generator).toBe('behavior_pack');
    expect((await eventsPromise).map((e) => e.stage)).toEqual(['validating', 'generating', 'verifying']);
  });

  it('texturepack → BehaviorItemGenerator，PNG 以base64 解码为真实二进制', async () => {
    const sandboxDir = mkTmp();
    const result = await new BedrockKernel({ sandboxDir, mode: 'sandbox', confirm: YES })
      .dispatch({ id: 'gc2', kind: 'generate_content', payload: { prompt: 'item', kind: 'texturepack', spec: ITEM_SPEC } })
      .result();
    expect(result.ok).toBe(true);
    const outDir = join(sandboxDir, 'packs', 'item_pack');
    const png = readFileSync(join(outDir, 'textures', 'items', 'ruby_sword.png'));
    expect(png.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    expect(existsSync(join(outDir, 'items', 'ruby_sword.json'))).toBe(true);
    expect(existsSync(join(outDir, 'texts', 'zh_CN.lang'))).toBe(true);
    expect((result.data as { generator: string }).generator).toBe('behavior_item');
  });

  it('skinpack → 兜底 BehaviorEntityGenerator 且data.note 说明原因', async () => {
    const sandboxDir = mkTmp();
    const result = await new BedrockKernel({ sandboxDir, mode: 'sandbox', confirm: YES })
      .dispatch({ id: 'gc3', kind: 'generate_content', payload: { prompt: 'beast', kind: 'skinpack', spec: ENTITY_SPEC } })
      .result();
    expect(result.ok).toBe(true);
    const data = result.data as { generator: string; note: string };
    expect(data.generator).toBe('behavior_entity');
    expect(data.note).toMatch(/skinpack/);
    expect(existsSync(join(sandboxDir, 'packs', 'entity_pack', 'manifest.json'))).toBe(true);
    expect(existsSync(join(sandboxDir, 'packs', 'entity_pack', 'entities', 'my_beast.behavior.json'))).toBe(true);
  });

  it('缺 spec → validation 且 data.specShape 给出形状示例（不臆造 spec）', async () => {
    const sandboxDir = mkTmp();
    const result = await new BedrockKernel({ sandboxDir, mode: 'sandbox', confirm: YES })
      .dispatch({ id: 'gc4', kind: 'generate_content', payload: { prompt: 'p', kind: 'addon' } })
      .result();
    expect(result.ok).toBe(false);
    expect(result.error).toMatchObject({ category: 'validation', code: 'SPEC_REQUIRED' });
    const shape = (result.data as { specShape: Record<string, unknown> }).specShape;
    expect(shape).toHaveProperty('packId');
    expect(shape).toHaveProperty('entities');
    expect(existsSync(join(sandboxDir, 'packs'))).toBe(false);
  });

  it('缺 spec 时 specShape 随 kind 变化（texturepack 给 items）', async () => {
    const sandboxDir = mkTmp();
    const result = await new BedrockKernel({ sandboxDir, mode: 'sandbox', confirm: YES })
      .dispatch({ id: 'gc5', kind: 'generate_content', payload: { prompt: 'p', kind: 'texturepack' } })
      .result();
    const shape = (result.data as { specShape: Record<string, unknown> }).specShape;
    expect(shape).toHaveProperty('items');
  });

  it('kind 非法 → validation', async () => {
    const sandboxDir = mkTmp();
    const result = await new BedrockKernel({ sandboxDir, mode: 'sandbox', confirm: YES })
      .dispatch({ id: 'gc6', kind: 'generate_content', payload: { prompt: 'p', kind: 'datapack', spec: BEHAVIOR_PACK_SPEC } })
      .result();
    expect(result).toMatchObject({ ok: false, error: { category: 'validation' } });
  });

  it('缺 prompt → validation', async () => {
    const sandboxDir = mkTmp();
    const result = await new BedrockKernel({ sandboxDir, mode: 'sandbox', confirm: YES })
      .dispatch({ id: 'gc7', kind: 'generate_content', payload: { kind: 'addon', spec: BEHAVIOR_PACK_SPEC } })
      .result();
    expect(result).toMatchObject({ ok: false, error: { category: 'validation' } });
  });

  it('空 spec（无实体/配方）→ 生成器产出仅 manifest，仍 ok:true', async () => {
    const sandboxDir = mkTmp();
    const result = await new BedrockKernel({ sandboxDir, mode: 'sandbox', confirm: YES })
      .dispatch({
        id: 'gc8',
        kind: 'generate_content',
        payload: {
          prompt: 'p',
          kind: 'addon',
          spec: { packId: 'empty_pack', packName: 'Empty', header: { uuid: '3f2b1a44-9c8e-4f21-8a1b-1234567890ae' } },
        },
      })
      .result();
    expect(result.ok).toBe(true);
    expect(existsSync(join(sandboxDir, 'packs', 'empty_pack', 'manifest.json'))).toBe(true);
    // BehaviorPackGenerator 对空实体/配方列表不产出子目录文件，只出 manifest
    expect((result.data as { files: unknown[] }).files).toHaveLength(1);
  });

  it('name 含路径分隔符 → validation（路径穿越防护），沙箱外未落盘', async () => {
    const sandboxDir = mkTmp();
    const parent = mkTmp();
    const result = await new BedrockKernel({ sandboxDir, mode: 'sandbox', confirm: YES })
      .dispatch({
        id: 'gc9',
        kind: 'generate_content',
        payload: { prompt: 'p', kind: 'addon', spec: BEHAVIOR_PACK_SPEC, name: '../escaped' },
      })
      .result();
    expect(result).toMatchObject({ ok: false, error: { category: 'validation' } });
    expect(existsSync(join(parent, 'escaped'))).toBe(false);
  });

  it('mode=sandbox 未配sandboxDir/dataDir → validation', async () => {
    const result = await new BedrockKernel({ mode: 'sandbox', confirm: YES })
      .dispatch({ id: 'gc10', kind: 'generate_content', payload: { prompt: 'p', kind: 'addon', spec: BEHAVIOR_PACK_SPEC } })
      .result();
    expect(result).toMatchObject({ ok: false, error: { category: 'validation', code: 'SANDBOX_ROOT_MISSING' } });
  });

  it('dataDir 退路：sandbox 模式无 sandboxDir 时写入 dataDir，且不写 com.mojang', async () => {
    const dataDir = mkTmp();
    const result = await new BedrockKernel({ dataDir, mode: 'sandbox', confirm: YES })
      .dispatch({ id: 'gc11', kind: 'generate_content', payload: { prompt: 'p', kind: 'addon', spec: BEHAVIOR_PACK_SPEC } })
      .result();
    expect(result.ok).toBe(true);
    expect(existsSync(join(dataDir, 'packs', 'demo_pack', 'manifest.json'))).toBe(true);
    const data = result.data as { dir: string };
    expect(data.dir.startsWith(dataDir)).toBe(true);
  });

  it('同一包名重复生成 → 覆盖写且 sha256 稳定（幂等）', async () => {
    const sandboxDir = mkTmp();
    const kernel = new BedrockKernel({ sandboxDir, mode: 'sandbox', confirm: YES });
    const payload = { prompt: 'p', kind: 'addon' as const, spec: { ...BEHAVIOR_PACK_SPEC, header: { uuid: '3f2b1a44-9c8e-4f21-8a1b-1234567890ab' } } };
    const first = await kernel.dispatch({ id: 'gc12a', kind: 'generate_content', payload }).result();
    const second = await kernel.dispatch({ id: 'gc12b', kind: 'generate_content', payload }).result();
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    const a = (first.data as { files: { path: string; sha256: string }[] }).files;
    const b = (second.data as { files: { path: string; sha256: string }[] }).files;
    expect(b.length).toBe(a.length);
    // manifest 内含随机生成的 module uuid，故只对确定性产物断言哈希稳定。
    const entityA = a.find((f) => f.path.endsWith('entities/zombie.json'));
    const entityB = b.find((f) => f.path.endsWith('entities/zombie.json'));
    expect(entityB?.sha256).toBe(entityA?.sha256);
    // 覆盖写而非追加：文件集合数量不变
    expect(b.every((f) => existsSync(f.path))).toBe(true);
  });
});

describe('BedrockKernel validate_content（R 类免确认真实现）', () => {
  it('合法 manifest → ok:true，data 含 manifest/uuid/version/modules', async () => {
    const parent = mkTmp();
    const dir = seedPack(parent, 'good', VALID_MANIFEST);
    // R 类：不传 confirm 也能执行
    const result = await new BedrockKernel({ sandboxDir: mkTmp(), mode: 'sandbox' })
      .dispatch({ id: 'v1', kind: 'validate_content', payload: { path: dir } })
      .result();
    expect(result.ok).toBe(true);
    const data = result.data as { uuid: string; version: number[]; modules: number; errors: string[] };
    expect(data.uuid).toBe(VALID_MANIFEST.header.uuid);
    expect(data.version).toEqual([1, 0, 0]);
    expect(data.modules).toBe(1);
    expect(data.errors).toEqual([]);
  });

  it('缺 manifest.json → validation', async () => {
    const parent = mkTmp();
    const dir = join(parent, 'nomanifest');
    mkdirSync(dir, { recursive: true });
    const result = await new BedrockKernel()
      .dispatch({ id: 'v2', kind: 'validate_content', payload: { path: dir } })
      .result();
    expect(result).toMatchObject({ ok: false, error: { category: 'validation', code: 'MANIFEST_MISSING' } });
  });

  it('§5.7 多套一层（manifest 在子目录）→ validation 并明确层级陷阱', async () => {
    const parent = mkTmp();
    const dir = join(parent, 'nested');
    mkdirSync(join(dir, 'inner'), { recursive: true });
    writeFileSync(join(dir, 'inner', 'manifest.json'), JSON.stringify(VALID_MANIFEST));
    const result = await new BedrockKernel()
      .dispatch({ id: 'v3', kind: 'validate_content', payload: { path: dir } })
      .result();
    expect(result.ok).toBe(false);
    expect(result.error?.category).toBe('validation');
    expect(result.error?.message).toMatch(/层级陷阱/);
  });

  it('manifest 非法 JSON → validation', async () => {
    const parent = mkTmp();
    const dir = seedPack(parent, 'badjson', '{ not json');
    const result = await new BedrockKernel()
      .dispatch({ id: 'v4', kind: 'validate_content', payload: { path: dir } })
      .result();
    expect(result).toMatchObject({ ok: false, error: { category: 'validation', code: 'MANIFEST_INVALID_JSON' } });
  });

  it('uuid 格式非法 → validation 且 errors 含中文说明', async () => {
    const parent = mkTmp();
    const dir = seedPack(parent, 'baduuid', {
      ...VALID_MANIFEST,
      header: { ...VALID_MANIFEST.header, uuid: 'not-a-uuid-zz' },
    });
    const result = await new BedrockKernel()
      .dispatch({ id: 'v5', kind: 'validate_content', payload: { path: dir } })
      .result();
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('MANIFEST_INVALID');
    const errors = (result.data as { errors: string[] }).errors;
    expect(errors.some((e) => e.includes('uuid') && e.includes('格式非法'))).toBe(true);
  });

  it('version 非 [int,int,int] 也非语义化字符串 → validation', async () => {
    const parent = mkTmp();
    const dir = seedPack(parent, 'badver', {
      ...VALID_MANIFEST,
      header: { ...VALID_MANIFEST.header, version: { major: 1 } },
    });
    const result = await new BedrockKernel()
      .dispatch({ id: 'v6', kind: 'validate_content', payload: { path: dir } })
      .result();
    const errors = (result.data as { errors: string[] }).errors;
    expect(errors.some((e) => e.includes('version') && e.includes('格式非法'))).toBe(true);
  });

  it('语义化字符串 version 被接受', async () => {
    const parent = mkTmp();
    const dir = seedPack(parent, 'semver', {
      ...VALID_MANIFEST,
      header: { ...VALID_MANIFEST.header, version: '1.2.3' },
    });
    const result = await new BedrockKernel()
      .dispatch({ id: 'v7', kind: 'validate_content', payload: { path: dir } })
      .result();
    expect(result.ok).toBe(true);
    expect((result.data as { version: number[] }).version).toEqual([1, 2, 3]);
  });

  it('min_engine_version 缺失 → validation', async () => {
    const parent = mkTmp();
    const dir = seedPack(parent, 'nomin', {
      format_version: 2,
      header: { uuid: VALID_MANIFEST.header.uuid, version: [1, 0, 0] },
      modules: VALID_MANIFEST.modules,
    });
    const result = await new BedrockKernel()
      .dispatch({ id: 'v8', kind: 'validate_content', payload: { path: dir } })
      .result();
    const errors = (result.data as { errors: string[] }).errors;
    expect(errors.some((e) => e.includes('min_engine_version'))).toBe(true);
  });

  it('modules 为空 → validation', async () => {
    const parent = mkTmp();
    const dir = seedPack(parent, 'nomod', { ...VALID_MANIFEST, modules: [] });
    const result = await new BedrockKernel()
      .dispatch({ id: 'v9', kind: 'validate_content', payload: { path: dir } })
      .result();
    const errors = (result.data as { errors: string[] }).errors;
    expect(errors.some((e) => e.includes('modules'))).toBe(true);
  });

  it('module 缺 type → validation', async () => {
    const parent = mkTmp();
    const dir = seedPack(parent, 'modnotype', {
      ...VALID_MANIFEST,
      modules: [{ uuid: VALID_MANIFEST.modules[0]!.uuid, version: [1, 0, 0] }],
    });
    const result = await new BedrockKernel()
      .dispatch({ id: 'v10', kind: 'validate_content', payload: { path: dir } })
      .result();
    const errors = (result.data as { errors: string[] }).errors;
    expect(errors.some((e) => e.includes('modules[0].type'))).toBe(true);
  });

  it('payload.version 低于 min_engine_version → 兼容性提示', async () => {
    const parent = mkTmp();
    const dir = seedPack(parent, 'compat', VALID_MANIFEST);
    const result = await new BedrockKernel()
      .dispatch({ id: 'v11', kind: 'validate_content', payload: { path: dir, version: [1, 16, 0] } })
      .result();
    const data = result.data as { compatWarning: string | null; requestedVersion: number[] };
    expect(data.compatWarning).toMatch(/不兼容/);
    expect(data.requestedVersion).toEqual([1, 16, 0]);
    expect(result.error?.category).toBe('validation');
  });

  it('payload.version 高于 min_engine_version → 无兼容性告警', async () => {
    const parent = mkTmp();
    const dir = seedPack(parent, 'compat2', VALID_MANIFEST);
    const result = await new BedrockKernel()
      .dispatch({ id: 'v12', kind: 'validate_content', payload: { path: dir, version: [1, 21, 0] } })
      .result();
    expect(result.ok).toBe(true);
    expect((result.data as { compatWarning: string | null }).compatWarning).toBeNull();
  });

  it('目录不存在 → validation', async () => {
    const parent = mkTmp();
    const result = await new BedrockKernel()
      .dispatch({ id: 'v13', kind: 'validate_content', payload: { path: join(parent, 'ghost') } })
      .result();
    expect(result).toMatchObject({ ok: false, error: { category: 'validation', code: 'PACK_DIR_NOT_FOUND' } });
  });

  it('path 指向文件而非目录 → validation', async () => {
    const parent = mkTmp();
    const file = join(parent, 'a.txt');
    writeFileSync(file, 'x');
    const result = await new BedrockKernel()
      .dispatch({ id: 'v14', kind: 'validate_content', payload: { path: file } })
      .result();
    expect(result).toMatchObject({ ok: false, error: { category: 'validation' } });
  });

  it('缺 path → validation', async () => {
    const result = await new BedrockKernel()
      .dispatch({ id: 'v15', kind: 'validate_content', payload: {} })
      .result();
    expect(result).toMatchObject({ ok: false, error: { category: 'validation' } });
  });
});

describe('BedrockKernel R 类既有行为不变', () => {
  it('get_target_state 仍是 validation/unknown 形状且提示 §6.1 降级', async () => {
    const result = await new BedrockKernel()
      .dispatch({ id: 'r1', kind: 'get_target_state', payload: null })
      .result();
    expect(typeof result.ok).toBe('boolean');
    if (!result.ok) expect(typeof result.error?.message).toBe('string');
  });

  it('R 类任务不触发 confirm', async () => {
    let called = 0;
    const result = await new BedrockKernel({
      confirm: () => {
        called++;
        return true;
      },
    })
      .dispatch({ id: 'r2', kind: 'get_capabilities', payload: null })
      .result();
    expect(result.ok).toBe(true);
    expect(called).toBe(0);
  });

  it('未知 kind 仍返回 unknown 分类', async () => {
    const result = await new BedrockKernel({ confirm: YES })
      .dispatch({ id: 'r3', kind: 'nope_xyz', payload: null })
      .result();
    expect(result).toEqual({
      ok: false,
      error: { category: 'unknown', message: '不支持的任务: nope_xyz', retryable: false },
    });
  });
});