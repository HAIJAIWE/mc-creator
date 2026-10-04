/**
 * @mc-creator/shell 单测（vitest）。
 * 覆盖：原子写 roundtrip、越界路径拒绝、跨盘符拒绝、zip-slip 拒绝、
 * 炸弹限额触发、错误文案映射。
 */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { sha256Hex, writeFileAtomic } from './atomic-write.js';
import {
  classifiedFullMessage,
  classifiedMessage,
  classifiedTitle,
  fileErrorCodeFromDesktop,
  fileErrorMessage,
  fileErrorToCategory,
  makeClassifiedError,
  mapFsCodeToFileError,
  toFileError,
} from './errors.js';
import { ensureDir, isPathInWorkspace, isSafePath } from './paths.js';
import { assertSafeEntry, checkZipLimits, ZipSafetyError } from './zip-safety.js';

function scratch(name: string): string {
  return join(tmpdir(), `mc-shell-test-${process.pid}`, name);
}

describe('atomic-write', () => {
  it('roundtrip：写入后读回一致', async () => {
    const target = scratch(`roundtrip-${Date.now()}.txt`);
    await writeFileAtomic(target, 'hello 原子写 ✅');
    await expect(readFile(target, 'utf8')).resolves.toBe('hello 原子写 ✅');
  });

  it('自动创建多级父目录', async () => {
    const target = scratch(join(`deep-${Date.now()}`, 'a', 'b', 'c.json'));
    await writeFileAtomic(target, '{}');
    await expect(readFile(target, 'utf8')).resolves.toBe('{}');
  });

  it('hash:true 返回正确的 sha256', async () => {
    const target = scratch(`hash-${Date.now()}.bin`);
    const data = Buffer.from([0, 1, 2, 3, 255]);
    const expected = createHash('sha256').update(data).digest('hex');
    const res = await writeFileAtomic(target, data, { hash: true });
    expect(res.sha256).toBe(expected);
    expect(sha256Hex('abc')).toBe(createHash('sha256').update('abc').digest('hex'));
  });

  it('覆盖写旧文件且不残留 tmp', async () => {
    const target = scratch(`overwrite-${Date.now()}.txt`);
    await writeFileAtomic(target, 'v1');
    await writeFileAtomic(target, 'v2较长的内容');
    await expect(readFile(target, 'utf8')).resolves.toBe('v2较长的内容');
  });
});

describe('paths', () => {
  it('工作区内相对路径通过', () => {
    const base = resolve('/tmp-ws-probe/mc-shell-base');
    expect(isSafePath('mods/foo.jar', base)).toBe(true);
    expect(isSafePath('.', base)).toBe(true);
  });

  it('越界路径 ../ 拒绝', () => {
    const base = resolve('/tmp-ws-probe/mc-shell-base');
    expect(isSafePath('../evil.jar', base)).toBe(false);
    expect(isSafePath('a/../../evil.jar', base)).toBe(false);
    expect(isSafePath('/etc/passwd', base)).toBe(false);
  });

  it('isPathInWorkspace：内外判定', () => {
    const ws = resolve('/tmp-ws-probe/mc-shell-ws');
    expect(isPathInWorkspace(join(ws, 'saves', 'w1'), ws)).toBe(true);
    expect(isPathInWorkspace(ws, ws)).toBe(true);
    expect(isPathInWorkspace(resolve('/tmp-ws-probe/other'), ws)).toBe(false);
  });

  it('跨盘符拒绝（C:\\ws vs D:\\evil）', () => {
    expect(isSafePath('D:\\evil\\x.jar', 'C:\\ws')).toBe(false);
    expect(isPathInWorkspace('D:\\evil\\x.jar', 'C:\\ws')).toBe(false);
    expect(isSafePath('C:\\ws\\mods\\a.jar', 'C:\\ws')).toBe(true);
  });

  it('ensureDir 递归创建并返回绝对路径', async () => {
    const dir = scratch(join(`ensure-${Date.now()}`, 'x', 'y'));
    const out = await ensureDir(dir);
    expect(out).toBe(resolve(dir));
    // 幂等
    await expect(ensureDir(dir)).resolves.toBe(resolve(dir));
  });
});

describe('zip-safety', () => {
  it('合法条目放行并归一化分隔符', () => {
    expect(assertSafeEntry('mods/foo.jar')).toBe('mods/foo.jar');
    expect(assertSafeEntry('a\\b\\c.txt')).toBe('a/b/c.txt');
  });

  it('zip-slip 条目拒绝（../ 逃逸）', () => {
    expect(() => assertSafeEntry('../evil.sh')).toThrow(ZipSafetyError);
    expect(() => assertSafeEntry('a/../../evil.sh')).toThrowError(/逃逸/);
  });

  it('绝对路径条目拒绝（含盘符与 UNC）', () => {
    expect(() => assertSafeEntry('/etc/passwd')).toThrow(ZipSafetyError);
    expect(() => assertSafeEntry('C:\\Windows\\x.dll')).toThrow(ZipSafetyError);
    expect(() => assertSafeEntry('C:/Windows/x.dll')).toThrow(ZipSafetyError);
  });

  it('符号链接条目拒绝', () => {
    expect(() => assertSafeEntry('link', { isSymlink: true })).toThrowError(/符号链接/);
  });

  it('炸弹限额：条目数超限触发', () => {
    const entries = Array.from({ length: 10001 }, (_, i) => ({ name: `f${i}`, size: 1 }));
    expect(() => checkZipLimits(entries)).toThrowError(/文件数量/);
  });

  it('炸弹限额：总大小超限触发', () => {
    const entries = [{ name: 'big', size: 2 * 1024 * 1024 * 1024 + 1, compressedSize: 1024 }];
    expect(() => checkZipLimits(entries)).toThrowError(/总大小/);
  });

  it('炸弹限额：解压比超限触发', () => {
    const entries = [{ name: 'bomb', size: 100 * 1024 * 1024, compressedSize: 512 * 1024 }];
    expect(() => checkZipLimits(entries)).toThrowError(/解压比/);
  });
});

describe('errors 文案映射', () => {
  it('六分类标题与说明均为中文', () => {
    expect(classifiedTitle('network')).toBe('网络错误');
    expect(classifiedMessage('disk')).toContain('磁盘');
    expect(classifiedFullMessage('permission')).toContain('权限不足');
  });

  it('文件错误文案含路径', () => {
    expect(fileErrorMessage('DISK_FULL')).toBe('磁盘空间不足');
    expect(fileErrorMessage('NOT_FOUND', 'a/b')).toContain('a/b');
  });

  it('fs 错误码映射与分类', () => {
    expect(mapFsCodeToFileError('ENOSPC')).toBe('DISK_FULL');
    expect(mapFsCodeToFileError('EPERM')).toBe('PERMISSION');
    expect(mapFsCodeToFileError('ENOENT')).toBe('NOT_FOUND');
    expect(mapFsCodeToFileError('EEXIST')).toBe('CONFLICT');
    expect(mapFsCodeToFileError('ENAMETOOLONG')).toBe('INVALID_PATH');
    expect(fileErrorToCategory('DISK_FULL')).toBe('disk');
    expect(fileErrorToCategory('PERMISSION')).toBe('permission');
    expect(toFileError(Object.assign(new Error('x'), { code: 'ENOENT' }), 'p').code).toBe('NOT_FOUND');
  });

  it('桌面端旧码兼容与重试策略', () => {
    expect(fileErrorCodeFromDesktop('PERMISSION_DENIED')).toBe('PERMISSION');
    expect(fileErrorCodeFromDesktop('NOT_FOUND')).toBe('NOT_FOUND');
    expect(makeClassifiedError('network', 'm').retryable).toBe(true);
    expect(makeClassifiedError('disk', 'm').retryable).toBe(false);
  });
});
