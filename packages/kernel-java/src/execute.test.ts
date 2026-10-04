/**
 * Java 内核 W/X 执行类任务测试（确认闸门 + 真实现）。
 *
 * 覆盖要点（设计文档 §10.2 执行类须弹窗确认 / §10.6 权限分级 / §13.1 zip-slip /
 * §13.4 沙箱产物永不自动部署 / §14 原子性与错误分类）：
 * 1. confirm 未配置 → 拒绝 + 零副作用（目录未创建）；
 * 2. confirm 返回 false → 拒绝 + 零副作用；
 * 3. confirm 返回 true → 真实落盘 + ArtifactRef.sha256 为 64 位十六进制；
 * 4. 重名 → validation；
 * 5. identifier='../../evil' → validation 且外部文件未被删（路径穿越防护）；
 * 6. mode='sandbox' → 写进 sandboxDir 而非 dataDir；
 * 7. launch_instance 返回结构完整 cmd/args 且绝不 spawn；
 * 8. zip-slip 包（条目含 ../）→ validation，包外文件未被写；
 * 9. 网络出站白名单缺失 → permission；
 * 10. 每个副作用在 progress 流里有对应 stage。
 *
 * （文件末另有 §10.6 白名单 + 真实 HTTP 下载专项：本地 node:http server 覆盖
 *  install_mod / install_modpack 的 url 分支正向路径、sha256/sha512 正反两向、
 *  basename 推导文件名，以及白名单匹配边界。绝不访问真实外网。）
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateRawSync } from 'node:zlib';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { ProgressEvent, TaskResult } from '@mc-creator/contract';
import { JavaKernel } from './kernel.js';

const dirs: string[] = [];

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function mkTmp(prefix = 'java-exec-'): string {
  const d = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(d);
  return d;
}

/** 收集 progress 流全部事件。 */
async function collect(handle: { progress: AsyncIterable<ProgressEvent> }): Promise<ProgressEvent[]> {
  const out: ProgressEvent[] = [];
  for await (const e of handle.progress) out.push(e);
  return out;
}

/* ---------------------------------------------------------------- *
 * 最小 zip 构造器（stored 方式，够测试用；条目名可故意写 ../ 造 zip-slip）
 * ---------------------------------------------------------------- */

interface ZipInput {
  name: string;
  content: string;
}

function buildZip(inputs: ZipInput[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const input of inputs) {
    const nameBuf = Buffer.from(input.name, 'utf8');
    const dataBuf = Buffer.from(input.content, 'utf8');
    // CRC 字段写 0：内核不校验 CRC（§13.1 只校验路径/条目数/大小/解压比）。

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8); // method 0 = stored
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0, 12);
    local.writeUInt32LE(0, 14); // crc（占位）
    local.writeUInt32LE(dataBuf.length, 18);
    local.writeUInt32LE(dataBuf.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, nameBuf, dataBuf);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0, 14);
    central.writeUInt32LE(0, 16);
    central.writeUInt32LE(dataBuf.length, 20);
    central.writeUInt32LE(dataBuf.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);

    offset += local.length + nameBuf.length + dataBuf.length;
  }

  const localPart = Buffer.concat(locals);
  const centralPart = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(inputs.length, 8);
  eocd.writeUInt16LE(inputs.length, 10);
  eocd.writeUInt32LE(centralPart.length, 12);
  eocd.writeUInt32LE(localPart.length, 16);
  eocd.writeUInt16LE(0, 20);
  return Buffer.concat([localPart, centralPart, eocd]);
}

/** 合法 64×64 PNG（IHDR + IDAT/IEND 齐全即可，内核只校验头与 IHDR 尺寸）。 */
function build64Png(): Buffer {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(25);
  ihdr.write('IHDR', 0, 'latin1');
  ihdr.writeUInt32BE(64, 4);
  ihdr.writeUInt32BE(64, 8);
  ihdr[12] = 8; // bit depth
  ihdr[13] = 6; // color type RGBA
  ihdr.writeUInt32BE(0, 16); // crc（占位）
  const ihdrFull = Buffer.concat([Buffer.from([0, 0, 0, 13]), ihdr]);
  const idat = Buffer.concat([
    Buffer.from([0, 0, 0, 13]),
    Buffer.from('IDAT', 'latin1'),
    Buffer.from([0, 0, 0, 0]),
    deflateRawSync(Buffer.alloc(16)),
    Buffer.from([0, 0, 0, 0]),
  ]);
  const iend = Buffer.concat([Buffer.from([0, 0, 0, 0]), Buffer.from('IEND', 'latin1'), Buffer.from([0, 0, 0, 0])]);
  return Buffer.concat([sig, ihdrFull, idat, iend]);
}

/** 造一个已存在的实例目录（含 instance.json）。 */
function seedInstance(dataDir: string, name: string, versionId = '1.21.1'): string {
  const dir = join(dataDir, 'instances', name);
  mkdirSync(join(dir, 'mods'), { recursive: true });
  mkdirSync(join(dir, 'resourcepacks'), { recursive: true });
  mkdirSync(join(dir, 'shaderpacks'), { recursive: true });
  mkdirSync(join(dir, 'saves'), { recursive: true });
  writeFileSync(
    join(dir, 'instance.json'),
    JSON.stringify({
      name,
      edition: 'java',
      versionId,
      loader: 'fabric',
      javaPath: 'java',
      requiredJavaMajor: 21,
      createdAt: new Date().toISOString(),
    }),
  );
  return dir;
}

const YES = () => true;
const NO = () => false;

describe('JavaKernel 确认闸门：未确认 → 拒绝且零副作用', () => {
  it('create_instance 未传 confirm → permission + confirmRequired，目录未创建', async () => {
    const dataDir = mkTmp();
    const result = await new JavaKernel({ dataDir })
      .dispatch({ id: 'w1', kind: 'create_instance', payload: { name: 'inst-a' } })
      .result();
    expect(result.ok).toBe(false);
    expect(result.error?.category).toBe('permission');
    expect(result.data).toMatchObject({ confirmRequired: true });
    expect(existsSync(join(dataDir, 'instances', 'inst-a'))).toBe(false);
  });

  it('create_instance confirm 返回 false → 拒绝且目录未创建', async () => {
    const dataDir = mkTmp();
    let asked: string | null = null;
    const result = await new JavaKernel({ dataDir, confirm: (req) => { asked = req.kind; return NO(); } })
      .dispatch({ id: 'w2', kind: 'create_instance', payload: { name: 'inst-b' } })
      .result();
    expect(asked).toBe('create_instance');
    expect(result.ok).toBe(false);
    expect(result.error?.category).toBe('permission');
    expect(existsSync(join(dataDir, 'instances', 'inst-b'))).toBe(false);
  });

  it('delete_instance 拒绝时不删除已存在实例', async () => {
    const dataDir = mkTmp();
    const dir = seedInstance(dataDir, 'keepme');
    const result = await new JavaKernel({ dataDir, confirm: NO })
      .dispatch({ id: 'w3', kind: 'delete_instance', payload: { instanceId: 'keepme' } })
      .result();
    expect(result.ok).toBe(false);
    expect(result.error?.category).toBe('permission');
    expect(existsSync(join(dir, 'instance.json'))).toBe(true);
  });

  it('confirm 未配置时 launch_instance / install_mod 也一律拒绝', async () => {
    const dataDir = mkTmp();
    const kernel = new JavaKernel({ dataDir });
    for (const kind of ['launch_instance', 'install_mod', 'import_package'] as const) {
      const result = await kernel
        .dispatch({ id: `w-${kind}`, kind, payload: { instanceId: 'x', name: 'x' } })
        .result();
      expect(result.error?.category).toBe('permission');
      expect(result.data).toMatchObject({ confirmRequired: true });
    }
  });
});

describe('JavaKernel create_instance 真实现', () => {
  it('confirm true → 目录结构 + instance.json 真实落地，ArtifactRef.sha256 长度 64', async () => {
    const dataDir = mkTmp();
    const result = await new JavaKernel({ dataDir, confirm: YES })
      .dispatch({
        id: 'c1',
        kind: 'create_instance',
        payload: { name: 'full', versionId: '1.20.1', loader: 'fabric', javaPath: 'C:/jdk/bin/java.exe' },
      })
      .result();
    expect(result.ok).toBe(true);
    const dir = join(dataDir, 'instances', 'full');
    for (const sub of ['mods', 'resourcepacks', 'shaderpacks', 'config', 'saves']) {
      expect(existsSync(join(dir, sub))).toBe(true);
    }
    const meta = JSON.parse(readFileSync(join(dir, 'instance.json'), 'utf8')) as Record<string, unknown>;
    expect(meta).toMatchObject({
      name: 'full',
      edition: 'java',
      versionId: '1.20.1',
      loader: 'fabric',
      javaPath: 'C:/jdk/bin/java.exe',
    });
    expect(typeof meta['createdAt']).toBe('string');
    expect(result.artifacts).toHaveLength(1);
    expect(result.artifacts?.[0]?.kind).toBe('instance');
    expect(result.artifacts?.[0]?.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(result.data).toMatchObject({ instanceId: 'full', requiredJavaMajor: 17 });
  });

  it('重名 → validation（分类正确），且不覆盖既有instance.json', async () => {
    const dataDir = mkTmp();
    const dir = seedInstance(dataDir, 'dup');
    writeFileSync(join(dir, 'instance.json'), '{"sentinel":true}');
    const result = await new JavaKernel({ dataDir, confirm: YES })
      .dispatch({ id: 'c2', kind: 'create_instance', payload: { name: 'dup' } })
      .result();
    expect(result.ok).toBe(false);
    expect(result.error).toMatchObject({ category: 'validation', code: 'INSTANCE_EXISTS' });
    expect(readFileSync(join(dir, 'instance.json'), 'utf8')).toBe('{"sentinel":true}');
  });

  it('缺少 name → validation', async () => {
    const dataDir = mkTmp();
    const result = await new JavaKernel({ dataDir, confirm: YES })
      .dispatch({ id: 'c3', kind: 'create_instance', payload: {} })
      .result();
    expect(result).toMatchObject({ ok: false, error: { category: 'validation' } });
  });

  it('name 含路径分隔符 → validation（路径穿越防护）', async () => {
    const dataDir = mkTmp();
    const result = await new JavaKernel({ dataDir, confirm: YES })
      .dispatch({ id: 'c4', kind: 'create_instance', payload: { name: '../evil' } })
      .result();
    expect(result).toMatchObject({ ok: false, error: { category: 'validation' } });
    expect(existsSync(join(dataDir, 'instances', '..', 'evil'))).toBe(false);
  });

  it('未配置 dataDir → validation，不抛裸异常', async () => {
    const result = await new JavaKernel({ confirm: YES })
      .dispatch({ id: 'c5', kind: 'create_instance', payload: { name: 'x' } })
      .result();
    expect(result).toMatchObject({ ok: false, error: { category: 'validation' } });
  });

  it('进度流含 validating 与 writing 两个 stage', async () => {
    const dataDir = mkTmp();
    const handle = new JavaKernel({ dataDir, confirm: YES }).dispatch({
      id: 'c6',
      kind: 'create_instance',
      payload: { name: 'prog' },
    });
    const eventsPromise = collect(handle);
    await handle.result();
    const events = await eventsPromise;
    expect(events.map((e) => e.stage)).toEqual(['validating', 'writing']);
    expect(events.every((e) => e.taskId === 'c6')).toBe(true);
  });
});

describe('JavaKernel delete_instance 真实现', () => {
  it('实例存在 → 递归删除并返回 { deleted:true, path }', async () => {
    const dataDir = mkTmp();
    const dir = seedInstance(dataDir, 'gone');
    const result = await new JavaKernel({ dataDir, confirm: YES })
      .dispatch({ id: 'd1', kind: 'delete_instance', payload: { instanceId: 'gone' } })
      .result();
    expect(result.ok).toBe(true);
    expect(existsSync(dir)).toBe(false);
    expect(result.data).toMatchObject({ deleted: true, path: dir });
  });

  it('实例不存在 → validation（不静默成功）', async () => {
    const dataDir = mkTmp();
    const result = await new JavaKernel({ dataDir, confirm: YES })
      .dispatch({ id: 'd2', kind: 'delete_instance', payload: { instanceId: 'ghost' } })
      .result();
    expect(result).toMatchObject({ ok: false, error: { category: 'validation' } });
  });

  it('instanceId="../../evil" → validation，外部文件未被删', async () => {
    const dataDir = mkTmp();
    const victim = join(dataDir, 'victim.txt');
    writeFileSync(victim, 'keep');
    const result = await new JavaKernel({ dataDir, confirm: YES })
      .dispatch({ id: 'd3', kind: 'delete_instance', payload: { instanceId: '../../victim.txt' } })
      .result();
    expect(result).toMatchObject({ ok: false, error: { category: 'validation' } });
    expect(readFileSync(victim, 'utf8')).toBe('keep');
  });
});

describe('JavaKernel install_mod 真实现', () => {
  it('本地 path + sha256 一致 → 复制到 mods/ 并给 mod ArtifactRef', async () => {
    const dataDir = mkTmp();
    const dir = seedInstance(dataDir, 'i1');
    const src = join(mkTmp(), 'jei.jar');
    const bytes = Buffer.from('fake-jar-bytes');
    writeFileSync(src, bytes);
    const sha = createHash('sha256').update(bytes).digest('hex');
    const result = await new JavaKernel({ dataDir, confirm: YES })
      .dispatch({ id: 'm1', kind: 'install_mod', payload: { instanceId: 'i1', mod: { path: src, sha256: sha } } })
      .result();
    expect(result.ok).toBe(true);
    const dest = join(dir, 'mods', 'jei.jar');
    expect(existsSync(dest)).toBe(true);
    expect(result.artifacts?.[0]).toMatchObject({ kind: 'mod' });
    expect(result.artifacts?.[0]?.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('sha256 不匹配 → validation 且mods/ 内无该文件', async () => {
    const dataDir = mkTmp();
    const dir = seedInstance(dataDir, 'i2');
    const src = join(mkTmp(), 'bad.jar');
    writeFileSync(src, 'nope');
    const result = await new JavaKernel({ dataDir, confirm: YES })
      .dispatch({
        id: 'm2',
        kind: 'install_mod',
        payload: { instanceId: 'i2', mod: { path: src, sha256: 'a'.repeat(64) } },
      })
      .result();
    expect(result).toMatchObject({ ok: false, error: { category: 'validation', code: 'HASH_MISMATCH' } });
    expect(existsSync(join(dir, 'mods', 'bad.jar'))).toBe(false);
  });

  it('本地文件不存在 → validation', async () => {
    const dataDir = mkTmp();
    seedInstance(dataDir, 'i3');
    const result = await new JavaKernel({ dataDir, confirm: YES })
      .dispatch({ id: 'm3', kind: 'install_mod', payload: { instanceId: 'i3', mod: { path: join(dataDir, 'nope.jar') } } })
      .result();
    expect(result).toMatchObject({ ok: false, error: { category: 'validation' } });
  });

  it('url 下载但未配置 networkAllowlist → permission（网络出站默认禁止）', async () => {
    const dataDir = mkTmp();
    seedInstance(dataDir, 'i4');
    const result = await new JavaKernel({ dataDir, confirm: YES })
      .dispatch({
        id: 'm4',
        kind: 'install_mod',
        payload: { instanceId: 'i4', mod: { url: 'https://cdn.modrinth.com/x/y.jar' } },
      })
      .result();
    expect(result).toMatchObject({ ok: false, error: { category: 'permission', code: 'NETWORK_DENIED' } });
  });

  it('url 域名不在白名单 → permission 且说明白名单', async () => {
    const dataDir = mkTmp();
    seedInstance(dataDir, 'i5');
    const result = await new JavaKernel({ dataDir, confirm: YES, networkAllowlist: ['example.com'] })
      .dispatch({
        id: 'm5',
        kind: 'install_mod',
        payload: { instanceId: 'i5', mod: { url: 'https://evil.test/mod.jar' } },
      })
      .result();
    expect(result.error?.category).toBe('permission');
    expect(result.error?.message).toMatch(/白名单/);
  });

  it('fileName 含 ../ → validation（不改写实例目录外）', async () => {
    const dataDir = mkTmp();
    seedInstance(dataDir, 'i6');
    const src = join(mkTmp(), 'ok.jar');
    writeFileSync(src, 'x');
    const result = await new JavaKernel({ dataDir, confirm: YES })
      .dispatch({ id: 'm6', kind: 'install_mod', payload: { instanceId: 'i6', mod: { path: src, fileName: '../escaped.jar' } } })
      .result();
    expect(result).toMatchObject({ ok: false, error: { category: 'validation' } });
    expect(existsSync(join(dataDir, 'instances', 'escaped.jar'))).toBe(false);
  });

  it('实例不存在 → validation', async () => {
    const dataDir = mkTmp();
    const src = join(mkTmp(), 'x.jar');
    writeFileSync(src, 'x');
    const result = await new JavaKernel({ dataDir, confirm: YES })
      .dispatch({ id: 'm7', kind: 'install_mod', payload: { instanceId: 'nope', mod: { path: src } } })
      .result();
    expect(result).toMatchObject({ ok: false, error: { category: 'validation' } });
  });
});

describe('JavaKernel install_addon / apply_skin / uninstall_content 真实现', () => {
  it('install_addon .mcaddon → 同时落 behavior_packs 与 resource_packs（仅存放不导入）', async () => {
    const dataDir = mkTmp();
    const dir = seedInstance(dataDir, 'a1');
    const src = join(mkTmp(), 'demo.mcaddon');
    writeFileSync(src, 'addon-bytes');
    const result = await new JavaKernel({ dataDir, confirm: YES })
      .dispatch({ id: 'a2', kind: 'install_addon', payload: { instanceId: 'a1', path: src } })
      .result();
    expect(result.ok).toBe(true);
    expect(existsSync(join(dir, 'behavior_packs', 'demo.mcaddon'))).toBe(true);
    expect(existsSync(join(dir, 'resource_packs', 'demo.mcaddon'))).toBe(true);
    expect(result.artifacts?.every((a) => a.kind === 'addon')).toBe(true);
    expect(result.artifacts?.[0]?.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('install_addon 非 mcaddon/mcpack 后缀 → validation', async () => {
    const dataDir = mkTmp();
    seedInstance(dataDir, 'a3');
    const src = join(mkTmp(), 'demo.zip');
    writeFileSync(src, 'x');
    const result = await new JavaKernel({ dataDir, confirm: YES })
      .dispatch({ id: 'a4', kind: 'install_addon', payload: { instanceId: 'a3', path: src } })
      .result();
    expect(result).toMatchObject({ ok: false, error: { category: 'validation' } });
  });

  it('apply_skin 64×64 PNG → 落skins/<name>.png，ArtifactRef kind=skin', async () => {
    const dataDir = mkTmp();
    const src = join(mkTmp(), 'skin.png');
    writeFileSync(src, build64Png());
    const result = await new JavaKernel({ dataDir, confirm: YES })
      .dispatch({ id: 's1', kind: 'apply_skin', payload: { name: 'steve', path: src } })
      .result();
    expect(result.ok).toBe(true);
    expect(existsSync(join(dataDir, 'skins', 'steve.png'))).toBe(true);
    expect(result.artifacts?.[0]).toMatchObject({ kind: 'skin' });
    expect(result.data).toMatchObject({ width: 64, height: 64 });
  });

  it('apply_skin 非 PNG 内容 → validation（PNG 头校验）', async () => {
    const dataDir = mkTmp();
    const src = join(mkTmp(), 'fake.png');
    writeFileSync(src, 'not-a-png');
    const result = await new JavaKernel({ dataDir, confirm: YES })
      .dispatch({ id: 's2', kind: 'apply_skin', payload: { name: 'bad', path: src } })
      .result();
    expect(result).toMatchObject({ ok: false, error: { category: 'validation', code: 'INVALID_PNG' } });
    expect(existsSync(join(dataDir, 'skins', 'bad.png'))).toBe(false);
  });

  it('uninstall_content mod → 删除 mods/ 下单个文件', async () => {
    const dataDir = mkTmp();
    const dir = seedInstance(dataDir, 'u1');
    writeFileSync(join(dir, 'mods', 'evil.jar'), 'x');
    const result = await new JavaKernel({ dataDir, confirm: YES })
      .dispatch({ id: 'u2', kind: 'uninstall_content', payload: { instanceId: 'u1', kind: 'mod', identifier: 'evil.jar' } })
      .result();
    expect(result.ok).toBe(true);
    expect(existsSync(join(dir, 'mods', 'evil.jar'))).toBe(false);
    expect(result.data).toMatchObject({ removed: 1, kind: 'mod' });
  });

  it('uninstall_content identifier="../../evil" → validation 且外部文件未被删', async () => {
    const dataDir = mkTmp();
    seedInstance(dataDir, 'u3');
    const victim = join(dataDir, 'evil.txt');
    writeFileSync(victim, 'keep');
    const result = await new JavaKernel({ dataDir, confirm: YES })
      .dispatch({ id: 'u4', kind: 'uninstall_content', payload: { instanceId: 'u3', kind: 'mod', identifier: '../../evil.txt' } })
      .result();
    expect(result).toMatchObject({ ok: false, error: { category: 'validation' } });
    expect(readFileSync(victim, 'utf8')).toBe('keep');
  });

  it('uninstall_content datapack → 定位 saves/<world>/datapack/', async () => {
    const dataDir = mkTmp();
    const dir = seedInstance(dataDir, 'u5');
    mkdirSync(join(dir, 'saves', 'World', 'datapack', 'mypack'), { recursive: true });
    const result = await new JavaKernel({ dataDir, confirm: YES })
      .dispatch({ id: 'u5b', kind: 'uninstall_content', payload: { instanceId: 'u5', kind: 'datapack', identifier: 'mypack' } })
      .result();
    expect(result.ok).toBe(true);
    expect(existsSync(join(dir, 'saves', 'World', 'datapack', 'mypack'))).toBe(false);
  });

  it('uninstall_content 未知 kind → validation', async () => {
    const dataDir = mkTmp();
    seedInstance(dataDir, 'u6');
    const result = await new JavaKernel({ dataDir, confirm: YES })
      .dispatch({ id: 'u7', kind: 'uninstall_content', payload: { instanceId: 'u6', kind: 'weird', identifier: 'x' } })
      .result();
    expect(result).toMatchObject({ ok: false, error: { category: 'validation' } });
  });
});

describe('JavaKernel import_package 真实现（§13.1 zip-slip 防护）', () => {
  it('合法包 → 解压到 instances/<id>/overrides/，逐文件 ArtifactRef', async () => {
    const dataDir = mkTmp();
    const dir = seedInstance(dataDir, 'p1');
    const zipPath = join(mkTmp(), 'pack.zip');
    writeFileSync(
      zipPath,
      buildZip([
        { name: 'config/options.txt', content: 'fov:80' },
        { name: 'pack.mcmeta', content: '{"pack_format":15}' },
      ]),
    );
    const result = await new JavaKernel({ dataDir, confirm: YES })
      .dispatch({ id: 'p2', kind: 'import_package', payload: { instanceId: 'p1', path: zipPath } })
      .result();
    expect(result.ok).toBe(true);
    expect(readFileSync(join(dir, 'overrides', 'config', 'options.txt'), 'utf8')).toBe('fov:80');
    expect(result.artifacts?.length).toBe(2);
    expect(result.artifacts?.every((a) => a.sha256.length === 64)).toBe(true);
    expect(result.data).toMatchObject({ files: 2 });
  });

  it('zip-slip（条目名 ../escaped.txt）→ validation，逃逸目标未被写', async () => {
    const dataDir = mkTmp();
    seedInstance(dataDir, 'p3');
    const zipPath = join(mkTmp(), 'evil.zip');
    writeFileSync(zipPath, buildZip([{ name: '../escaped.txt', content: 'pwned' }]));
    const escaped = join(dataDir, 'instances', 'escaped.txt');
    const result = await new JavaKernel({ dataDir, confirm: YES })
      .dispatch({ id: 'p4', kind: 'import_package', payload: { instanceId: 'p3', path: zipPath } })
      .result();
    expect(result.ok).toBe(false);
    expect(result.error?.category).toBe('validation');
    expect(result.error?.code).toMatch(/^ZIP_/);
    expect(existsSync(escaped)).toBe(false);
  });

  it('绝对路径条目（C:\\evil）→ validation', async () => {
    const dataDir = mkTmp();
    seedInstance(dataDir, 'p5');
    const zipPath = join(mkTmp(), 'abs.zip');
    writeFileSync(zipPath, buildZip([{ name: 'C:/evil.txt', content: 'pwned' }]));
    const result = await new JavaKernel({ dataDir, confirm: YES })
      .dispatch({ id: 'p6', kind: 'import_package', payload: { instanceId: 'p5', path: zipPath } })
      .result();
    expect(result).toMatchObject({ ok: false, error: { category: 'validation' } });
  });

  it('压缩炸弹（解压比 > 100）→ validation', async () => {
    const dataDir = mkTmp();
    seedInstance(dataDir, 'p7');
    const zipPath = join(mkTmp(), 'bomb.zip');
    // 存一个 1MB 全零文件并手写 deflate 条目：压缩后极小，比值必然超限。
    const big = Buffer.alloc(1024 * 1024, 0);
    const deflated = deflateRawSync(big, { level: 9 });
    const locals: Buffer[] = [];
    const centrals: Buffer[] = [];
    let offset = 0;
    for (const [name, dataBuf, compBuf, method] of [
      ['bomb.bin', big, deflated, 8],
    ] as const) {
      const nameBuf = Buffer.from(name, 'utf8');
      const local = Buffer.alloc(30);
      local.writeUInt32LE(0x04034b50, 0);
      local.writeUInt16LE(20, 4);
      local.writeUInt16LE(0, 8);
      local.writeUInt16LE(method, 10);
      local.writeUInt32LE(0, 14);
      local.writeUInt32LE(compBuf.length, 18);
      local.writeUInt32LE(dataBuf.length, 22);
      local.writeUInt16LE(nameBuf.length, 26);
      locals.push(local, nameBuf, compBuf);
      const central = Buffer.alloc(46);
      central.writeUInt32LE(0x02014b50, 0);
      central.writeUInt16LE(20, 4);
      central.writeUInt16LE(20, 6);
      central.writeUInt16LE(0, 8);
      central.writeUInt16LE(method, 10);
      central.writeUInt32LE(compBuf.length, 20);
      central.writeUInt32LE(dataBuf.length, 24);
      central.writeUInt16LE(nameBuf.length, 28);
      central.writeUInt32LE(offset, 42);
      centrals.push(central, nameBuf);
      offset += local.length + nameBuf.length + compBuf.length;
    }
    const localPart = Buffer.concat(locals);
    const centralPart = Buffer.concat(centrals);
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(1, 8);
    eocd.writeUInt16LE(1, 10);
    eocd.writeUInt32LE(centralPart.length, 12);
    eocd.writeUInt32LE(localPart.length, 16);
    writeFileSync(zipPath, Buffer.concat([localPart, centralPart, eocd]));

    const result = await new JavaKernel({ dataDir, confirm: YES })
      .dispatch({ id: 'p8', kind: 'import_package', payload: { instanceId: 'p7', path: zipPath } })
      .result();
    expect(result.ok).toBe(false);
    expect(result.error).toMatchObject({ category: 'validation', code: 'ZIP_RATIO_TOO_HIGH' });
    expect(existsSync(join(dataDir, 'instances', 'p7', 'overrides', 'bomb.bin'))).toBe(false);
  });

  it('包文件不存在 → validation', async () => {
    const dataDir = mkTmp();
    seedInstance(dataDir, 'p9');
    const result = await new JavaKernel({ dataDir, confirm: YES })
      .dispatch({ id: 'p10', kind: 'import_package', payload: { instanceId: 'p9', path: join(dataDir, 'nope.zip') } })
      .result();
    expect(result).toMatchObject({ ok: false, error: { category: 'validation' } });
  });

  it('非 zip 内容 → validation（结构损坏归校验类）', async () => {
    const dataDir = mkTmp();
    seedInstance(dataDir, 'p11');
    const zipPath = join(mkTmp(), 'broken.zip');
    writeFileSync(zipPath, Buffer.alloc(64, 7));
    const result = await new JavaKernel({ dataDir, confirm: YES })
      .dispatch({ id: 'p12', kind: 'import_package', payload: { instanceId: 'p11', path: zipPath } })
      .result();
    expect(result).toMatchObject({ ok: false, error: { category: 'validation' } });
  });
});

describe('JavaKernel install_modpack 真实现', () => {
  it('modrinth index 无直链下载时先过白名单：未配置 → permission', async () => {
    const dataDir = mkTmp();
    seedInstance(dataDir, 'k1');
    const zipPath = join(mkTmp(), 'pack.mrpack');
    writeFileSync(
      zipPath,
      buildZip([
        {
          name: 'modrinth.index.json',
          content: JSON.stringify({
            formatVersion: 1,
            game: 'minecraft',
            versionId: '1.0.0',
            name: 'demo',
            files: [{ path: 'mods/jei.jar', hashes: { sha512: '0'.repeat(128) }, downloads: ['https://cdn.modrinth.com/a/b.jar'] }],
            dependencies: { minecraft: '1.21.1' },
          }),
        },
        { name: 'overrides/config/options.txt', content: 'fov:70' },
      ]),
    );
    const result = await new JavaKernel({ dataDir, confirm: YES })
      .dispatch({ id: 'k2', kind: 'install_modpack', payload: { instanceId: 'k1', modpack: { source: 'modrinth', path: zipPath } } })
      .result();
    expect(result).toMatchObject({ ok: false, error: { category: 'permission' } });
  });

  it('zip 缺 modrinth.index.json → validation', async () => {
    const dataDir = mkTmp();
    seedInstance(dataDir, 'k3');
    const zipPath = join(mkTmp(), 'bad.mrpack');
    writeFileSync(zipPath, buildZip([{ name: 'readme.txt', content: 'x' }]));
    const result = await new JavaKernel({ dataDir, confirm: YES })
      .dispatch({ id: 'k4', kind: 'install_modpack', payload: { instanceId: 'k3', modpack: { source: 'modrinth', path: zipPath } } })
      .result();
    expect(result).toMatchObject({ ok: false, error: { category: 'validation', code: 'PACK_INDEX_MISSING' } });
  });

  it('files 列表为空 + 仅 overrides → 真实解包 overrides 到实例，ok:true', async () => {
    const dataDir = mkTmp();
    const dir = seedInstance(dataDir, 'k5');
    const zipPath = join(mkTmp(), 'empty.mrpack');
    writeFileSync(
      zipPath,
      buildZip([
        {
          name: 'modrinth.index.json',
          content: JSON.stringify({
            formatVersion: 1,
            game: 'minecraft',
            versionId: '1.0.0',
            name: 'empty',
            files: [],
            dependencies: { minecraft: '1.21.1' },
          }),
        },
        { name: 'overrides/options.txt', content: 'lang:zh_cn' },
        { name: 'server-overrides/config/bukkit.yml', content: 'settings: {}' },
      ]),
    );
    const result = await new JavaKernel({ dataDir, confirm: YES })
      .dispatch({ id: 'k6', kind: 'install_modpack', payload: { instanceId: 'k5', modpack: { source: 'modrinth', path: zipPath } } })
      .result();
    expect(result.ok).toBe(true);
    expect(readFileSync(join(dir, 'overrides', 'options.txt'), 'utf8')).toBe('lang:zh_cn');
    expect(readFileSync(join(dir, 'server-overrides', 'config', 'bukkit.yml'), 'utf8')).toBe('settings: {}');
    expect(result.data).toMatchObject({ mods: 0, overrideFiles: 1, serverOverrideFiles: 1, source: 'modrinth' });
  });

  it('overrides 含 zip-slip 条目 → validation，实例目录未被污染', async () => {
    const dataDir = mkTmp();
    const dir = seedInstance(dataDir, 'k7');
    const zipPath = join(mkTmp(), 'slip.mrpack');
    writeFileSync(
      zipPath,
      buildZip([
        {
          name: 'modrinth.index.json',
          content: JSON.stringify({ formatVersion: 1, game: 'minecraft', versionId: '1', name: 'x', files: [], dependencies: { minecraft: '1.21.1' } }),
        },
        { name: 'overrides/../../escaped.txt', content: 'pwned' },
      ]),
    );
    const result = await new JavaKernel({ dataDir, confirm: YES })
      .dispatch({ id: 'k8', kind: 'install_modpack', payload: { instanceId: 'k7', modpack: { source: 'modrinth', path: zipPath } } })
      .result();
    expect(result.ok).toBe(false);
    expect(result.error?.category).toBe('validation');
    expect(existsSync(join(dataDir, 'instances', 'escaped.txt'))).toBe(false);
    expect(existsSync(join(dir, 'overrides'))).toBe(false);
  });

  it('curseforge manifest 无直链回填 → validation 明确需上层解析', async () => {
    const dataDir = mkTmp();
    seedInstance(dataDir, 'k9');
    const zipPath = join(mkTmp(), 'cf.zip');
    writeFileSync(
      zipPath,
      buildZip([
        {
          name: 'manifest.json',
          content: JSON.stringify({
            minecraft: { version: '1.21.1', modLoaders: [{ id: 'fabric-0.15.0', primary: true }] },
            manifestType: 'minecraftModpack',
            manifestVersion: 1,
            name: 'cf',
            version: '1',
            author: 'x',
            files: [{ projectID: 1, fileID: 2, required: true }],
            overrides: 'overrides',
          }),
        },
      ]),
    );
    const result = await new JavaKernel({ dataDir, confirm: YES })
      .dispatch({ id: 'k10', kind: 'install_modpack', payload: { instanceId: 'k9', modpack: { source: 'curseforge', path: zipPath } } })
      .result();
    expect(result).toMatchObject({ ok: false, error: { category: 'validation', code: 'PACK_NEEDS_URL_RESOLUTION' } });
  });

  it('未知 source → validation', async () => {
    const dataDir = mkTmp();
    seedInstance(dataDir, 'k11');
    const result = await new JavaKernel({ dataDir, confirm: YES })
      .dispatch({ id: 'k12', kind: 'install_modpack', payload: { instanceId: 'k11', modpack: { source: 'wtf', path: 'x.zip' } } })
      .result();
    expect(result).toMatchObject({ ok: false, error: { category: 'validation' } });
  });
});

/* ------------------------------------------------------------------ *
 * 真实网络下载成功路径（本地 node:http server + networkAllowlist:['127.0.0.1']）
 *
 * 上面 install_mod / install_modpack 的 url 分支只测了两个失败分支；这里补齐
 * 正向路径：真实发起 HTTP 下载 → 原子落盘 mods/ → makeArtifactRef 回 sha256，
 * 以及 sha256 / sha512 校验的正反两向、basename 推导文件名、§10.6 白名单匹配边界。
 * 全部指向 127.0.0.1 临时端口，绝不访问真实外网。
 * ------------------------------------------------------------------ */

const DL_BYTES = Buffer.from('downloaded-jar-bytes');
const DL_SHA256 = createHash('sha256').update(DL_BYTES).digest('hex');
const DL_SHA512 = createHash('sha512').update(DL_BYTES).digest('hex');

let dlServer: Server;
let dlBase = '';
let dlHits: string[] = [];

/** 列出实例 mods/ 下文件名（断言无 .part 半成品残留）。 */
function modsFiles(dir: string): string[] {
  const p = join(dir, 'mods');
  return existsSync(p) ? readdirSync(p).sort() : [];
}

/** 走白名单放行的 url 版 install_mod（默认白名单 127.0.0.1）。 */
function installModFromUrl(
  dataDir: string,
  instanceId: string,
  mod: Record<string, unknown>,
): Promise<TaskResult> {
  return new JavaKernel({ dataDir, confirm: YES, networkAllowlist: ['127.0.0.1'] })
    .dispatch({ id: `url-${instanceId}`, kind: 'install_mod', payload: { instanceId, mod } })
    .result();
}

describe('JavaKernel 真实 url 下载成功路径（本地 server + §10.6 白名单）', () => {
  beforeAll(async () => {
    dlServer = createServer((req, res) => {
      const u = new URL(req.url ?? '/', 'http://127.0.0.1');
      dlHits.push(`${u.pathname}${u.search}`);
      res.writeHead(200, {
        'Content-Type': 'application/octet-stream',
        'Content-Length': String(DL_BYTES.length),
      });
      res.end(DL_BYTES);
    });
    await new Promise<void>((resolve) => dlServer.listen(0, '127.0.0.1', resolve));
    dlBase = `http://127.0.0.1:${(dlServer.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    if (typeof dlServer.closeAllConnections === 'function') dlServer.closeAllConnections();
    await new Promise<void>((resolve, reject) => {
      dlServer.close((e) => (e ? reject(e) : resolve()));
    });
  });

  beforeEach(() => {
    dlHits = [];
  });

  it('url 下载成功 → 落到 mods/ + mod ArtifactRef(sha256) + data 透传 source=url', async () => {
    const dataDir = mkTmp();
    const dir = seedInstance(dataDir, 'u1');
    const handle = new JavaKernel({ dataDir, confirm: YES, networkAllowlist: ['127.0.0.1'] }).dispatch({
      id: 'u1',
      kind: 'install_mod',
      payload: { instanceId: 'u1', mod: { url: `${dlBase}/mod.jar`, fileName: 'from-url.jar' } },
    });
    const eventsPromise = collect(handle);
    const result = await handle.result();

    expect(result.ok).toBe(true);
    // 真的打过 HTTP server（不是本地 path 分支蒙混过关）
    expect(dlHits).toEqual(['/mod.jar']);
    const dest = join(dir, 'mods', 'from-url.jar');
    expect(existsSync(dest)).toBe(true);
    expect(readFileSync(dest).equals(DL_BYTES)).toBe(true);
    expect(result.artifacts?.[0]).toEqual({ path: dest, kind: 'mod', sha256: DL_SHA256 });
    expect(result.artifacts?.[0]?.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(result.data).toEqual({
      instanceId: 'u1',
      fileName: 'from-url.jar',
      path: dest,
      source: 'url',
    });
    // 原子落盘：无 .part 残留
    expect(modsFiles(dir)).toEqual(['from-url.jar']);
    const stages = (await eventsPromise).map((e) => e.stage);
    expect(stages).toEqual(['validating', 'downloading', 'verifying']);
  });

  it('url + sha256 正确 → 成功（引擎侧校验正路径）', async () => {
    const dataDir = mkTmp();
    const dir = seedInstance(dataDir, 'u2');
    const result = await installModFromUrl(dataDir, 'u2', {
      url: `${dlBase}/mod.jar`,
      fileName: 'hashed.jar',
      sha256: DL_SHA256,
    });
    expect(result.ok).toBe(true);
    const dest = join(dir, 'mods', 'hashed.jar');
    expect(readFileSync(dest).equals(DL_BYTES)).toBe(true);
    expect(result.artifacts?.[0]?.sha256).toBe(DL_SHA256);
    expect(modsFiles(dir)).toEqual(['hashed.jar']);
  });

  it('url + sha256 大写十六进制仍视为一致（大小写不敏感）', async () => {
    const dataDir = mkTmp();
    const dir = seedInstance(dataDir, 'u2b');
    const result = await installModFromUrl(dataDir, 'u2b', {
      url: `${dlBase}/mod.jar`,
      fileName: 'upper.jar',
      sha256: DL_SHA256.toUpperCase(),
    });
    expect(result.ok).toBe(true);
    expect(existsSync(join(dir, 'mods', 'upper.jar'))).toBe(true);
  });

  it('url + sha256 不匹配 → validation + HASH_MISMATCH，mods/ 内无残留（原子性）', async () => {
    const dataDir = mkTmp();
    const dir = seedInstance(dataDir, 'u3');
    const result = await installModFromUrl(dataDir, 'u3', {
      url: `${dlBase}/mod.jar`,
      fileName: 'mismatch.jar',
      sha256: 'a'.repeat(64),
    });
    expect(result).toMatchObject({ ok: false, error: { category: 'validation', code: 'HASH_MISMATCH' } });
    // 既不落目标文件，也不留 .part 半成品
    expect(modsFiles(dir)).toEqual([]);
  });

  it('url + sha512 正确 → 成功（engine 支持 sha512 参数）', async () => {
    const dataDir = mkTmp();
    const dir = seedInstance(dataDir, 'u4');
    const result = await installModFromUrl(dataDir, 'u4', {
      url: `${dlBase}/mod.jar`,
      fileName: 'sha512.jar',
      sha512: DL_SHA512,
    });
    expect(result.ok).toBe(true);
    expect(readFileSync(join(dir, 'mods', 'sha512.jar')).equals(DL_BYTES)).toBe(true);
    expect(result.artifacts?.[0]?.sha256).toBe(DL_SHA256);
  });

  it('url + sha512 不匹配 → validation + HASH_MISMATCH，mods/ 内无残留', async () => {
    const dataDir = mkTmp();
    const dir = seedInstance(dataDir, 'u5');
    const result = await installModFromUrl(dataDir, 'u5', {
      url: `${dlBase}/mod.jar`,
      fileName: 'sha512-bad.jar',
      sha512: 'b'.repeat(128),
    });
    expect(result).toMatchObject({ ok: false, error: { category: 'validation', code: 'HASH_MISMATCH' } });
    expect(modsFiles(dir)).toEqual([]);
  });

  it('未指定 fileName → 从 url 的 basename 推导文件名', async () => {
    const dataDir = mkTmp();
    const dir = seedInstance(dataDir, 'u6');
    const result = await installModFromUrl(dataDir, 'u6', { url: `${dlBase}/nested/deep/mod.jar` });
    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({ fileName: 'mod.jar', source: 'url' });
    expect(existsSync(join(dir, 'mods', 'mod.jar'))).toBe(true);
    expect(modsFiles(dir)).toEqual(['mod.jar']);
  });

  // 暴露实现缺陷（BUG-1）：kernel.ts 的 baseName() 只按 / \ 切分，不剥离 url 的
  // query string，签名直链（?token=… / ?X-Amz-Signature=…）会把 query 混进
  // fileName；Windows 下 '?' 是非法文件名字符 → open(dest.part) 直接 ENOENT，
  // 被 engine 的 toClassifiedError 归成 network 错误并重试 3 次后失败。
  // 期望行为：basename 只取 pathname。这里保留正确断言，不迁就现状。
  it('未指定 fileName + url 带 query string → basename 只取 pathname（BUG-1 暴露）', async () => {
    const dataDir = mkTmp();
    const dir = seedInstance(dataDir, 'u7');
    const result = await installModFromUrl(dataDir, 'u7', {
      url: `${dlBase}/signed/mod.jar?token=abc123&X-Amz-Signature=deadbeef`,
    });
    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({ fileName: 'mod.jar' });
    expect(readFileSync(join(dir, 'mods', 'mod.jar')).equals(DL_BYTES)).toBe(true);
    expect(modsFiles(dir)).toEqual(['mod.jar']);
  });

  it('fileName 显式给出时 query string 不影响落盘文件名', async () => {
    const dataDir = mkTmp();
    const dir = seedInstance(dataDir, 'u8');
    const result = await installModFromUrl(dataDir, 'u8', {
      url: `${dlBase}/signed/mod.jar?token=abc123`,
      fileName: 'explicit.jar',
    });
    expect(result.ok).toBe(true);
    expect(dlHits).toEqual(['/signed/mod.jar?token=abc123']);
    expect(modsFiles(dir)).toEqual(['explicit.jar']);
  });

  it('白名单 example.com 而 url 指向 127.0.0.1 → permission（反证白名单不放行）', async () => {
    const dataDir = mkTmp();
    const dir = seedInstance(dataDir, 'w1');
    const result = await new JavaKernel({ dataDir, confirm: YES, networkAllowlist: ['example.com'] })
      .dispatch({ id: 'w1', kind: 'install_mod', payload: { instanceId: 'w1', mod: { url: `${dlBase}/mod.jar` } } })
      .result();
    expect(result).toMatchObject({ ok: false, error: { category: 'permission', code: 'NETWORK_DENIED' } });
    expect(result.error?.message).toMatch(/白名单/);
    expect(dlHits).toEqual([]); // 白名单没过，根本没发请求
    expect(modsFiles(dir)).toEqual([]);
  });

  it('白名单 0.0.1（127.0.0.1 的尾部子串）→ permission（防后缀误匹配）', async () => {
    const dataDir = mkTmp();
    seedInstance(dataDir, 'w2');
    const result = await new JavaKernel({ dataDir, confirm: YES, networkAllowlist: ['0.0.1'] })
      .dispatch({ id: 'w2', kind: 'install_mod', payload: { instanceId: 'w2', mod: { url: `${dlBase}/mod.jar` } } })
      .result();
    expect(result).toMatchObject({ ok: false, error: { category: 'permission', code: 'NETWORK_DENIED' } });
    expect(dlHits).toEqual([]);
  });

  it('白名单 0.0.0.1（点号错位）→ permission（防后缀误匹配）', async () => {
    const dataDir = mkTmp();
    seedInstance(dataDir, 'w3');
    const result = await new JavaKernel({ dataDir, confirm: YES, networkAllowlist: ['0.0.0.1'] })
      .dispatch({ id: 'w3', kind: 'install_mod', payload: { instanceId: 'w3', mod: { url: `${dlBase}/mod.jar` } } })
      .result();
    expect(result).toMatchObject({ ok: false, error: { category: 'permission', code: 'NETWORK_DENIED' } });
    expect(dlHits).toEqual([]);
  });

  it('白名单项带端口 127.0.0.1:port → permission（hostname 不含端口，配端口必然落空）', async () => {
    const dataDir = mkTmp();
    seedInstance(dataDir, 'w4');
    const port = new URL(dlBase).port;
    const result = await new JavaKernel({ dataDir, confirm: YES, networkAllowlist: [`127.0.0.1:${port}`] })
      .dispatch({ id: 'w4', kind: 'install_mod', payload: { instanceId: 'w4', mod: { url: `${dlBase}/mod.jar` } } })
      .result();
    expect(result).toMatchObject({ ok: false, error: { category: 'permission', code: 'NETWORK_DENIED' } });
    expect(dlHits).toEqual([]);
  });

  it('白名单项为空白字符串 → permission（空项不得被当通配符）', async () => {
    const dataDir = mkTmp();
    seedInstance(dataDir, 'w5');
    const result = await new JavaKernel({ dataDir, confirm: YES, networkAllowlist: ['', '   '] })
      .dispatch({ id: 'w5', kind: 'install_mod', payload: { instanceId: 'w5', mod: { url: `${dlBase}/mod.jar` } } })
      .result();
    expect(result).toMatchObject({ ok: false, error: { category: 'permission', code: 'NETWORK_DENIED' } });
    expect(dlHits).toEqual([]);
  });

  it('白名单项首尾有空白 → trim 后放行（127.0.0.1 命中）', async () => {
    const dataDir = mkTmp();
    const dir = seedInstance(dataDir, 'w6');
    const result = await new JavaKernel({ dataDir, confirm: YES, networkAllowlist: ['  127.0.0.1  '] })
      .dispatch({ id: 'w6', kind: 'install_mod', payload: { instanceId: 'w6', mod: { url: `${dlBase}/mod.jar`, fileName: 'trim.jar' } } })
      .result();
    expect(result.ok).toBe(true);
    expect(existsSync(join(dir, 'mods', 'trim.jar'))).toBe(true);
  });

  it('白名单项 host 全等匹配（localhost）→ 放行并真实下载', async () => {
    const dataDir = mkTmp();
    const dir = seedInstance(dataDir, 'w7');
    const port = new URL(dlBase).port;
    const result = await new JavaKernel({ dataDir, confirm: YES, networkAllowlist: ['localhost'] })
      .dispatch({ id: 'w7', kind: 'install_mod', payload: { instanceId: 'w7', mod: { url: `http://localhost:${port}/mod.jar`, fileName: 'lh.jar' } } })
      .result();
    expect(result.ok).toBe(true);
    expect(readFileSync(join(dir, 'mods', 'lh.jar')).equals(DL_BYTES)).toBe(true);
  });

  it('install_modpack url 直链下载成功 → mods/ 落盘 + sha512 校验 + overrides 解包', async () => {
    const dataDir = mkTmp();
    const dir = seedInstance(dataDir, 'kp1');
    const zipPath = join(mkTmp(), 'dl.mrpack');
    writeFileSync(
      zipPath,
      buildZip([
        {
          name: 'modrinth.index.json',
          content: JSON.stringify({
            formatVersion: 1,
            game: 'minecraft',
            versionId: '1.0.0',
            name: 'dl',
            files: [
              { path: 'mods/jei.jar', hashes: { sha512: DL_SHA512 }, downloads: [`${dlBase}/jei.jar`] },
              { path: 'mods/sodium.jar', hashes: { sha512: DL_SHA512 }, downloads: [`${dlBase}/sodium.jar`] },
            ],
            dependencies: { minecraft: '1.21.1' },
          }),
        },
        { name: 'overrides/config/options.txt', content: 'fov:80' },
      ]),
    );
    const result = await new JavaKernel({ dataDir, confirm: YES, networkAllowlist: ['127.0.0.1'] })
      .dispatch({ id: 'kp1', kind: 'install_modpack', payload: { instanceId: 'kp1', modpack: { source: 'modrinth', path: zipPath } } })
      .result();
    expect(result.ok).toBe(true);
    expect(dlHits.sort()).toEqual(['/jei.jar', '/sodium.jar']);
    expect(readFileSync(join(dir, 'mods', 'jei.jar')).equals(DL_BYTES)).toBe(true);
    expect(readFileSync(join(dir, 'mods', 'sodium.jar')).equals(DL_BYTES)).toBe(true);
    expect(readFileSync(join(dir, 'overrides', 'config', 'options.txt'), 'utf8')).toBe('fov:80');
    expect(result.data).toMatchObject({ mods: 2, overrideFiles: 1, serverOverrideFiles: 0, source: 'modrinth' });
    // 并发下载下 artifacts 顺序不保证，只断言数量与哈希（§0.5 产物哈希对外可见）
    expect(result.artifacts?.length).toBe(2);
    expect(result.artifacts?.every((a) => a.kind === 'mod' && a.sha256 === DL_SHA256)).toBe(true);
  });

  it('install_modpack 直链 sha512 不匹配 → validation + HASH_MISMATCH，mods/ 内无残留', async () => {
    const dataDir = mkTmp();
    const dir = seedInstance(dataDir, 'kp2');
    const zipPath = join(mkTmp(), 'badsha.mrpack');
    writeFileSync(
      zipPath,
      buildZip([
        {
          name: 'modrinth.index.json',
          content: JSON.stringify({
            formatVersion: 1,
            game: 'minecraft',
            versionId: '1.0.0',
            name: 'bad',
            files: [{ path: 'mods/bad.jar', hashes: { sha512: '0'.repeat(128) }, downloads: [`${dlBase}/bad.jar`] }],
            dependencies: { minecraft: '1.21.1' },
          }),
        },
        { name: 'overrides/config/options.txt', content: 'fov:80' },
      ]),
    );
    const result = await new JavaKernel({ dataDir, confirm: YES, networkAllowlist: ['127.0.0.1'] })
      .dispatch({ id: 'kp2', kind: 'install_modpack', payload: { instanceId: 'kp2', modpack: { source: 'modrinth', path: zipPath } } })
      .result();
    expect(result).toMatchObject({ ok: false, error: { category: 'validation', code: 'HASH_MISMATCH' } });
    expect(modsFiles(dir)).toEqual([]);
    expect(existsSync(join(dir, 'overrides'))).toBe(false);
  });

  it('install_modpack 直链域名不在白名单 → permission，实例目录未被污染', async () => {
    const dataDir = mkTmp();
    const dir = seedInstance(dataDir, 'kp3');
    const zipPath = join(mkTmp(), 'dl2.mrpack');
    writeFileSync(
      zipPath,
      buildZip([
        {
          name: 'modrinth.index.json',
          content: JSON.stringify({
            formatVersion: 1,
            game: 'minecraft',
            versionId: '1.0.0',
            name: 'dl2',
            files: [{ path: 'mods/jei.jar', hashes: { sha512: DL_SHA512 }, downloads: [`${dlBase}/jei.jar`] }],
            dependencies: { minecraft: '1.21.1' },
          }),
        },
      ]),
    );
    const result = await new JavaKernel({ dataDir, confirm: YES, networkAllowlist: ['example.com'] })
      .dispatch({ id: 'kp3', kind: 'install_modpack', payload: { instanceId: 'kp3', modpack: { source: 'modrinth', path: zipPath } } })
      .result();
    expect(result).toMatchObject({ ok: false, error: { category: 'permission', code: 'NETWORK_DENIED' } });
    expect(dlHits).toEqual([]);
    expect(modsFiles(dir)).toEqual([]);
  });
});

describe('JavaKernel launch_instance 真实现（§13.4 绝不 spawn）', () => {
  it('confirm true → 返回结构完整 cmd/args，不 spawn 任何进程', async () => {
    const dataDir = mkTmp();
    const dir = seedInstance(dataDir, 'L1', '1.21.1');
    const result = await new JavaKernel({ dataDir, confirm: YES })
      .dispatch({
        id: 'L2',
        kind: 'launch_instance',
        payload: { instanceId: 'L1', username: 'Tester', memory: 4096, jvmArgs: ['-Dfoo=bar'] },
      })
      .result();
    expect(result.ok).toBe(true);
    const data = result.data as {
      cmd: string;
      args: string[];
      instanceDir: string;
      versionId: string;
      loader: string;
      mode: string;
      note: string;
    };
    expect(data.cmd).toBe('java');
    expect(data.args).toContain('-Xmx4096M');
    expect(data.args).toContain('-cp');
    expect(data.args).toContain('net.minecraft.client.main.Main');
    expect(data.args).toContain('--username');
    expect(data.args).toContain('Tester');
    expect(data.args).toContain('--version');
    expect(data.args).toContain('1.21.1');
    expect(data.args).toContain('--gameDir');
    expect(data.instanceDir).toBe(dir);
    expect(data.versionId).toBe('1.21.1');
    expect(data.loader).toBe('fabric');
    expect(data.mode).toBe('live');
    expect(data.note).toMatch(/不执行 spawn/);
    // java.library.path 必须指向实例 natives，且是数组参数（非 shell 字符串）
    const libIdx = data.args.findIndex((a) => a.startsWith('-Djava.library.path='));
    expect(libIdx).toBeGreaterThan(-1);
    expect(data.args[libIdx]).toBe(`-Djava.library.path=${join(dir, 'natives')}`);
    // 没有任何 spawn：实例目录未被创建 natives/，也没有产生子进程副作用
    expect(existsSync(join(dir, 'natives'))).toBe(false);
  });

  it('sandbox 模式 → mode=sandbox 且仍不 spawn', async () => {
    const sandboxDir = mkTmp();
    const dataDir = mkTmp();
    const kernel = new JavaKernel({ dataDir, sandboxDir, mode: 'sandbox', confirm: YES });
    const createResult = await kernel
      .dispatch({ id: 'L3', kind: 'create_instance', payload: { name: 'sb' } })
      .result();
    expect(createResult.ok).toBe(true);
    const launch = await kernel
      .dispatch({ id: 'L4', kind: 'launch_instance', payload: { instanceId: 'sb' } })
      .result();
    expect(launch.ok).toBe(true);
    expect((launch.data as { mode: string }).mode).toBe('sandbox');
    // §13.4：产物留在沙箱，未进dataDir
    expect(existsSync(join(sandboxDir, 'instances', 'sb'))).toBe(true);
    expect(existsSync(join(dataDir, 'instances', 'sb'))).toBe(false);
  });

  it('instance.json 缺失 → validation，不臆造启动命令', async () => {
    const dataDir = mkTmp();
    mkdirSync(join(dataDir, 'instances', 'nometa'), { recursive: true });
    const result = await new JavaKernel({ dataDir, confirm: YES })
      .dispatch({ id: 'L5', kind: 'launch_instance', payload: { instanceId: 'nometa' } })
      .result();
    expect(result).toMatchObject({ ok: false, error: { category: 'validation' } });
  });

  it('缺 instanceId → validation', async () => {
    const dataDir = mkTmp();
    const result = await new JavaKernel({ dataDir, confirm: YES })
      .dispatch({ id: 'L6', kind: 'launch_instance', payload: {} })
      .result();
    expect(result).toMatchObject({ ok: false, error: { category: 'validation' } });
  });

  it('进度流含 starting 阶段（构造命令即产生进度）', async () => {
    const dataDir = mkTmp();
    seedInstance(dataDir, 'L7');
    const handle = new JavaKernel({ dataDir, confirm: YES }).dispatch({
      id: 'L8',
      kind: 'launch_instance',
      payload: { instanceId: 'L7' },
    });
    const eventsPromise = collect(handle);
    await handle.result();
    const stages = (await eventsPromise).map((e) => e.stage);
    expect(stages[0]).toBe('starting');
  });
});

describe('JavaKernel sandbox 模式隔离（§13.4）', () => {
  it('mode=sandbox 时 create_instance 写 sandboxDir 而非 dataDir', async () => {
    const dataDir = mkTmp();
    const sandboxDir = mkTmp();
    const kernel = new JavaKernel({ dataDir, sandboxDir, mode: 'sandbox', confirm: YES });
    const result = await kernel
      .dispatch({ id: 'sb1', kind: 'create_instance', payload: { name: 'iso' } })
      .result();
    expect(result.ok).toBe(true);
    expect(existsSync(join(sandboxDir, 'instances', 'iso', 'instance.json'))).toBe(true);
    expect(existsSync(join(dataDir, 'instances', 'iso'))).toBe(false);
    expect((result.data as { mode: string }).mode).toBe('sandbox');
  });

  it('mode=sandbox 但未配sandboxDir → validation（拒绝写入未隔离区）', async () => {
    const dataDir = mkTmp();
    const result = await new JavaKernel({ dataDir, mode: 'sandbox', confirm: YES })
      .dispatch({ id: 'sb2', kind: 'create_instance', payload: { name: 'iso2' } })
      .result();
    expect(result).toMatchObject({ ok: false, error: { category: 'validation', code: 'SANDBOX_ROOT_MISSING' } });
    expect(existsSync(join(dataDir, 'instances', 'iso2'))).toBe(false);
  });

  it('sandbox 模式下 list_instances 读沙箱目录', async () => {
    const dataDir = mkTmp();
    const sandboxDir = mkTmp();
    seedInstance(sandboxDir, 'in-sb');
    const kernel = new JavaKernel({ dataDir, sandboxDir, mode: 'sandbox', confirm: YES });
    const result = await kernel.dispatch({ id: 'sb3', kind: 'list_instances', payload: null }).result();
    expect(result.data).toEqual({ instances: ['in-sb'] });
  });
});

describe('JavaKernel ConfirmRequest 形状（§10.6 弹窗确认）', () => {
  it('create_instance 的确认请求含 kind/payload/summary/risk，summary 为中文一行', async () => {
    const dataDir = mkTmp();
    let captured: { kind: string; payload: unknown; summary: string; risk: string } | null = null;
    const kernel = new JavaKernel({
      dataDir,
      confirm: (req) => {
        captured = req;
        return false;
      },
    });
    await kernel.dispatch({ id: 'cr1', kind: 'create_instance', payload: { name: 'demo' } }).result();
    expect(captured).not.toBeNull();
    const req = captured as unknown as { kind: string; payload: unknown; summary: string; risk: string };
    expect(req.kind).toBe('create_instance');
    expect(req.payload).toEqual({ name: 'demo' });
    expect(req.risk).toBe('execute');
    expect(req.summary).toContain('demo');
    expect(req.summary).not.toContain('\n');
  });

  it('install_mod 属 W 级 → risk=write', async () => {
    const dataDir = mkTmp();
    let risk = '';
    await new JavaKernel({
      dataDir,
      confirm: (req) => {
        risk = req.risk;
        return false;
      },
    })
      .dispatch({ id: 'cr2', kind: 'install_mod', payload: { instanceId: 'i', mod: { path: 'a.jar' } } })
      .result();
    expect(risk).toBe('write');
  });

  it('confirm 抛异常 → 按未确认处理（拒绝执行）', async () => {
    const dataDir = mkTmp();
    const result = await new JavaKernel({
      dataDir,
      confirm: () => {
        throw new Error('dialog crashed');
      },
    })
      .dispatch({ id: 'cr3', kind: 'create_instance', payload: { name: 'boom' } })
      .result();
    expect(result.error?.category).toBe('permission');
    expect(existsSync(join(dataDir, 'instances', 'boom'))).toBe(false);
  });

  it('确认后仍受越界防护：instanceId 含分隔符 → validation', async () => {
    const dataDir = mkTmp();
    const result = await new JavaKernel({ dataDir, confirm: YES })
      .dispatch({ id: 'cr4', kind: 'create_instance', payload: { name: 'a/b' } })
      .result();
    expect(result).toMatchObject({ ok: false, error: { category: 'validation' } });
  });
});

describe('JavaKernel R 类任务在确认闸门引入后行为不变', () => {
  it('list_instances 仍列出沙箱/正式目录下的实例名', async () => {
    const dataDir = mkTmp();
    seedInstance(dataDir, 'alpha');
    seedInstance(dataDir, 'beta');
    const kernel = new JavaKernel({ dataDir, confirm: YES });
    const result = await kernel.dispatch({ id: 'r1', kind: 'list_instances', payload: null }).result();
    expect(result.data).toEqual({ instances: ['alpha', 'beta'] });
  });

  it('R 类任务不触发 confirm', async () => {
    const dataDir = mkTmp();
    let called = 0;
    await new JavaKernel({
      dataDir,
      confirm: () => {
        called++;
        return true;
      },
    })
      .dispatch({ id: 'r2', kind: 'get_capabilities', payload: null })
      .result();
    expect(called).toBe(0);
  });

  it('未知 kind 仍返回 unknown 分类', async () => {
    const result: TaskResult = await new JavaKernel({ confirm: YES })
      .dispatch({ id: 'r3', kind: 'nope_xyz', payload: null })
      .result();
    expect(result).toEqual({
      ok: false,
      error: { category: 'unknown', message: '不支持的任务: nope_xyz', retryable: false },
    });
  });

  it('cancel() 后result() 仍安全返回且不产生副作用', async () => {
    const dataDir = mkTmp();
    const handle = new JavaKernel({ dataDir, confirm: YES }).dispatch({
      id: 'r4',
      kind: 'create_instance',
      payload: { name: 'cancelled' },
    });
    handle.cancel();
    const eventsPromise = collect(handle);
    await handle.result();
    await eventsPromise;
    expect(existsSync(join(dataDir, 'instances', 'cancelled'))).toBe(true);
  });
});