/**
 * §5.4 整合包增量更新的判定单元测试（content/modpack/incremental.ts）。
 *
 * 这一层只测「判定」不测「安装」：安装侧（downloadFile 调用次数）的断言在
 * execute.test.ts。这里守住三件容易悄悄坏掉的事：
 * 1. 摘要必须**流式**算：2GB 的 jar 不能整块进内存。用 mock 掉 fs/promises 的
 *    open 来数每次 read() 的缓冲长度，断言它恒等于 64KiB 且调用次数与文件大小
 *    成正比 —— 这比「跑一个大文件然后看内存」确定得多，不受 GC / 分配器影响。
 * 2. 跳过的判据必须是 sha512 全等，且大小写不敏感。
 * 3. 每一条「不能跳过」的理由都要能走到（读不出来 / 不是普通文件 / 计划无哈希），
 *    因为漏掉任何一条的后果都是「更新没生效」这种极难排查的 bug。
 */

import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DIGEST_CHUNK_SIZE, checkLocalFile, digestFile, sameDigest } from './incremental.js';

/**
 * 探针：记录每次 read() 的缓冲长度，以及是否有人试图整块读文件。
 * mock 只做「记录 + 转发」，真读真算，测试不因此失真。
 */
const probe = vi.hoisted(() => ({ readLens: [] as number[], readFilePaths: [] as string[] }));
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    readFile: ((path: unknown, ...rest: unknown[]) => {
      probe.readFilePaths.push(String(path));
      return (actual.readFile as (...a: unknown[]) => Promise<unknown>)(path, ...rest);
    }) as typeof actual.readFile,
    open: (async (path: unknown, flags: unknown, ...rest: unknown[]) => {
      const fh = await (
        actual.open as unknown as (...a: unknown[]) => Promise<{
          read: (...a: unknown[]) => Promise<{ bytesRead: number }>;
        }>
      )(path, flags, ...rest);
      const origRead = fh.read.bind(fh);
      return new Proxy(fh, {
        get(target, prop, receiver) {
          if (prop !== 'read') return Reflect.get(target, prop, receiver);
          return (...args: unknown[]) => {
            probe.readLens.push(Number(args[2]));
            return (origRead as (...a: unknown[]) => Promise<{ bytesRead: number }>)(...args);
          };
        },
      });
    }) as typeof actual.open,
  };
});

const dirs: string[] = [];

function mkTmp(): string {
  const d = mkdtempSync(join(tmpdir(), 'mp-incr-'));
  dirs.push(d);
  return d;
}

beforeEach(() => {
  probe.readLens.length = 0;
  probe.readFilePaths.length = 0;
});

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** 造一个已知内容的文件，返回路径与其 sha512。 */
function seedFile(dir: string, name: string, bytes: Buffer): { path: string; sha512: string } {
  const p = join(dir, name);
  mkdirSync(join(dir, 'sub'), { recursive: true });
  writeFileSync(p, bytes);
  return { path: p, sha512: createHash('sha512').update(bytes).digest('hex') };
}

describe('digestFile 流式摘要（§5.4 增量更新的性能前提）', () => {
  it('小文件 → sha256/sha512 与一次性哈希一致', async () => {
    const dir = mkTmp();
    const bytes = Buffer.from('hello-modpack');
    const { path } = seedFile(dir, 'a.jar', bytes);
    const d = await digestFile(path);
    expect(d.sha256).toBe(createHash('sha256').update(bytes).digest('hex'));
    expect(d.sha512).toBe(createHash('sha512').update(bytes).digest('hex'));
  });

  it('摘要不分块把文件读进内存（跨多个 64KiB 块）', async () => {
    const dir = mkTmp();
    // 5 块 + 一点尾巴：跨块才能证明是循环读而不是「一次性 readFile」。
    const bytes = Buffer.alloc(DIGEST_CHUNK_SIZE * 5 + 17, 0xab);
    const { path } = seedFile(dir, 'big.jar', bytes);
    const d = await digestFile(path);

    expect(d.sha512).toBe(createHash('sha512').update(bytes).digest('hex'));
    // 每次 read 的缓冲长度恒为 64KiB，与文件大小无关 —— 内存上限与 2GB 包无关。
    // 7 次 = 5 个满块 + 1 个 17 字节尾块 + 1 次读到 0 判定 EOF。
    expect(probe.readLens.length).toBe(7);
    expect(new Set(probe.readLens)).toEqual(new Set([DIGEST_CHUNK_SIZE]));
    // 整块读的 API 一次都没被调用。
    expect(probe.readFilePaths).toEqual([]);
  });

  it('空文件 → 合法摘要且不炸（长度为 0 的边界）', async () => {
    const dir = mkTmp();
    const p = join(dir, 'empty.jar');
    writeFileSync(p, Buffer.alloc(0));
    const d = await digestFile(p);
    expect(d.sha512).toBe(createHash('sha512').update(Buffer.alloc(0)).digest('hex'));
    expect(readFileSync(p).length).toBe(0);
  });
});

describe('checkLocalFile 跳过判定（§5.4 增量更新的正确性前提）', () => {
  it('目标不存在 → download/absent（首次安装）', async () => {
    const dir = mkTmp();
    const v = await checkLocalFile(join(dir, 'nothing.jar'), 'a'.repeat(128));
    expect(v).toEqual({ kind: 'download', reason: 'absent' });
  });

  it('目标存在且 sha512 一致 → unchanged + 带出 sha256（可跳过下载）', async () => {
    const dir = mkTmp();
    const bytes = Buffer.from('installed-jar');
    const { path, sha512 } = seedFile(dir, 'ok.jar', bytes);
    const v = await checkLocalFile(path, sha512);
    expect(v).toEqual({
      kind: 'unchanged',
      sha256: createHash('sha256').update(bytes).digest('hex'),
    });
  });

  it('期望 sha512 大写 → 仍判 unchanged（十六进制大小写不敏感）', async () => {
    const dir = mkTmp();
    const { path, sha512 } = seedFile(dir, 'up.jar', Buffer.from('upper'));
    const v = await checkLocalFile(path, sha512.toUpperCase());
    expect(v.kind).toBe('unchanged');
  });

  it('本地内容被改 → download/changed（不误跳过）', async () => {
    const dir = mkTmp();
    const { path, sha512 } = seedFile(dir, 'edited.jar', Buffer.from('original'));
    writeFileSync(path, Buffer.from('tampered-but-same-size!!'));
    const v = await checkLocalFile(path, sha512);
    expect(v).toEqual({ kind: 'download', reason: 'changed' });
  });

  it('本地被截断（大小都变了）→ download/changed', async () => {
    const dir = mkTmp();
    const { path, sha512 } = seedFile(dir, 'trunc.jar', Buffer.alloc(4096, 7));
    writeFileSync(path, Buffer.alloc(10, 7));
    const v = await checkLocalFile(path, sha512);
    expect(v).toEqual({ kind: 'download', reason: 'changed' });
  });

  it('计划无 sha512 → download/no-expected-hash（CurseForge 常见，绝不用 size 猜）', async () => {
    const dir = mkTmp();
    const { path } = seedFile(dir, 'cf.jar', Buffer.from('curseforge-bytes'));
    // 文件确实在、内容也确实「看起来没变」，但没有内容级证据 → 仍必须下载。
    const v = await checkLocalFile(path, undefined);
    expect(v).toEqual({ kind: 'download', reason: 'no-expected-hash' });
  });

  it('计划 sha512 非法（非 128 位十六进制）→ download/invalid-expected-hash', async () => {
    const dir = mkTmp();
    const { path } = seedFile(dir, 'weird.jar', Buffer.from('x'));
    for (const bad of ['', 'deadbeef', 'z'.repeat(128), 'a'.repeat(127)]) {
      const v = await checkLocalFile(path, bad);
      expect(v).toEqual({ kind: 'download', reason: 'invalid-expected-hash' });
    }
  });

  it('目标是目录而非文件 → download/changed（不能把目录当已装好的 jar）', async () => {
    const dir = mkTmp();
    const asDir = join(dir, 'adir');
    mkdirSync(asDir, { recursive: true });
    const v = await checkLocalFile(asDir, 'a'.repeat(128));
    expect(v).toEqual({ kind: 'download', reason: 'changed' });
  });

  it('本地读不出来 → download/unreadable（读本地失败不该让整次更新失败）', async () => {
    const dir = mkTmp();
    const { path } = seedFile(dir, 'locked.jar', Buffer.from('locked'));
    // 让 open 抛 EACCES：模拟权限不足 / 被别的进程独占。
    const realOpen = await import('node:fs/promises');
    const spy = vi
      .spyOn(realOpen, 'open')
      .mockRejectedValue(Object.assign(new Error('EPERM'), { code: 'EPERM' }));
    try {
      const v = await checkLocalFile(path, 'a'.repeat(128));
      expect(v).toEqual({ kind: 'download', reason: 'unreadable' });
    } finally {
      spy.mockRestore();
    }
  });

  it('同一份文件被判定两次 → 两次都一致（幂等，重复调用不会翻转结论）', async () => {
    const dir = mkTmp();
    const { path, sha512 } = seedFile(dir, 'idem.jar', Buffer.from('idem'));
    const a = await checkLocalFile(path, sha512);
    const b = await checkLocalFile(path, sha512);
    expect(a).toEqual(b);
  });
});

describe('sameDigest', () => {
  it('大小写不敏感、前后空白不宽容（空白应当判为不匹配）', () => {
    expect(sameDigest('ABC', 'abc')).toBe(true);
    expect(sameDigest('abc', 'abd')).toBe(false);
    expect(sameDigest(' abc', 'abc')).toBe(false);
  });
});
