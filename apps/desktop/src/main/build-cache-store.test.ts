// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildCacheFileName,
  resolveBuildCacheFile,
  loadBuildCacheSnapshot,
  saveBuildCacheSnapshot,
} from './build-cache-store.js';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'mc-build-cache-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('build-cache-store：按项目隔离的构建缓存持久化', () => {
  it('空 projectId 落到 default 桶，非空用 base64url 编码且互不碰撞', () => {
    expect(buildCacheFileName('')).toBe('default.json');
    expect(buildCacheFileName('   ')).toBe('default.json');
    // 不同 id → 不同文件名（即便含有路径分隔符等危险字符）
    const a = buildCacheFileName('proj-1');
    const b = buildCacheFileName('proj/1');
    expect(a).not.toBe(b);
    expect(a.endsWith('.json')).toBe(true);
    // 文件名里不得出现路径分隔符
    expect(b).not.toContain('/');
    expect(b).not.toContain('\\');
  });

  it('resolveBuildCacheFile 返回 dir 下的文件路径', () => {
    expect(resolveBuildCacheFile(dir, 'p1')).toBe(join(dir, buildCacheFileName('p1')));
  });

  it('首次构建（文件不存在）返回 undefined', async () => {
    await expect(loadBuildCacheSnapshot(dir, 'never-built')).resolves.toBeUndefined();
    // 目录本身也不存在时同样静默降级
    await expect(loadBuildCacheSnapshot(join(dir, 'nope'), 'x')).resolves.toBeUndefined();
  });

  it('save → load 往返一致，且按项目隔离', async () => {
    const snapshot = {
      'demo\0fabric\0items': {
        hash: 'h1',
        files: [{ path: 'ModItems.java', content: 'class X{}' }],
      },
    };
    await saveBuildCacheSnapshot(dir, 'proj-a', snapshot);

    await expect(loadBuildCacheSnapshot(dir, 'proj-a')).resolves.toEqual(snapshot);
    // 另一个项目读不到别人的缓存
    await expect(loadBuildCacheSnapshot(dir, 'proj-b')).resolves.toBeUndefined();
  });

  it('save 会自动创建缺失的目录', async () => {
    const nested = join(dir, 'a', 'b');
    await saveBuildCacheSnapshot(nested, 'p1', {});
    await expect(loadBuildCacheSnapshot(nested, 'p1')).resolves.toEqual({});
  });

  it('缓存文件损坏 / 结构不符时返回 undefined，不抛错', async () => {
    const file = resolveBuildCacheFile(dir, 'broken');
    await writeFile(file, '{ not json', 'utf8');
    await expect(loadBuildCacheSnapshot(dir, 'broken')).resolves.toBeUndefined();

    await writeFile(file, '[1,2,3]', 'utf8');
    await expect(loadBuildCacheSnapshot(dir, 'broken')).resolves.toBeUndefined();

    await writeFile(file, 'null', 'utf8');
    await expect(loadBuildCacheSnapshot(dir, 'broken')).resolves.toBeUndefined();
  });

  it('写入失败不抛错（目录位置被文件占用）', async () => {
    // 让 dir 这个路径本身是个文件 → mkdir 必然失败
    const blocked = join(dir, 'blocked');
    await mkdir(blocked);
    await writeFile(join(blocked, 'x'), 'x', 'utf8');
    await expect(saveBuildCacheSnapshot(join(blocked, 'x'), 'p', {})).resolves.toBeUndefined();
  });
});
