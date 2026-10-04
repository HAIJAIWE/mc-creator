/**
 * 下载引擎 + 持久化队列测试（自包含，不依赖外网）。
 * 本地 node:http 服务器提供：Range / 302 / 500-then-200 / 常驻 500 / 慢响应端点。
 */
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { downloadFile } from './download.js';
import { FileTaskQueue } from './task-queue.js';

const PAYLOAD = Buffer.from('mc-engine-test-block-0123456789abcdef\n'.repeat(2048));
const PAYLOAD_SHA256 = createHash('sha256').update(PAYLOAD).digest('hex');
const PAYLOAD_SHA512 = createHash('sha512').update(PAYLOAD).digest('hex');

let server: Server;
let base = '';
let flakyRemaining = 0;
let hitCount = 0;
let lastRangeHeader: string | null = null;

function servePayload(req: IncomingMessage, res: ServerResponse): void {
  const range = req.headers['range'];
  lastRangeHeader = typeof range === 'string' ? range : null;
  if (typeof range === 'string') {
    const m = /^bytes=(\d+)-$/.exec(range);
    if (m) {
      const start = Number(m[1]);
      if (start >= PAYLOAD.length) {
        res.writeHead(416, { 'Content-Range': `bytes */${PAYLOAD.length}` });
        res.end();
        return;
      }
      const rest = PAYLOAD.subarray(start);
      res.writeHead(206, {
        'Content-Type': 'application/octet-stream',
        'Content-Length': String(rest.length),
        'Content-Range': `bytes ${start}-${PAYLOAD.length - 1}/${PAYLOAD.length}`,
        'Accept-Ranges': 'bytes',
      });
      res.end(rest);
      return;
    }
  }
  res.writeHead(200, {
    'Content-Type': 'application/octet-stream',
    'Content-Length': String(PAYLOAD.length),
    'Accept-Ranges': 'bytes',
  });
  res.end(PAYLOAD);
}

beforeAll(async () => {
  server = createServer((req, res) => {
    hitCount += 1;
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    if (url.pathname === '/redirect') {
      res.writeHead(302, { Location: '/file' });
      res.end();
      return;
    }
    if (url.pathname === '/flaky') {
      if (flakyRemaining > 0) {
        flakyRemaining -= 1;
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('flaky');
        return;
      }
      servePayload(req, res);
      return;
    }
    if (url.pathname === '/always500') {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('boom');
      return;
    }
    if (url.pathname === '/slow') {
      setTimeout(() => {
        res.writeHead(200, {
          'Content-Type': 'application/octet-stream',
          'Content-Length': String(PAYLOAD.length),
        });
        res.end(PAYLOAD);
      }, 400);
      return;
    }
    if (url.pathname === '/file') {
      servePayload(req, res);
      return;
    }
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('nope');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address() as AddressInfo;
  base = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
  await new Promise<void>((resolve, reject) => {
    server.close((e) => (e ? reject(e) : resolve()));
  });
});

let dir = '';

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'mc-engine-test-'));
  flakyRemaining = 0;
  hitCount = 0;
  lastRangeHeader = null;
});

function dest(name?: string): string {
  return join(dir, name ?? `${randomUUID()}.bin`);
}

describe('downloadFile', () => {
  it('完整下载：内容一致并返回字节数', async () => {
    const d = dest();
    const r = await downloadFile(`${base}/file`, d, { retries: 0 });
    expect(r.path).toBe(d);
    expect(r.bytes).toBe(PAYLOAD.length);
    expect((await readFile(d)).equals(PAYLOAD)).toBe(true);
  });

  it('onProgress 回调：首调 done=0、末调 done=total=文件长度', async () => {
    const calls: Array<[number, number]> = [];
    await downloadFile(`${base}/file`, dest(), {
      retries: 0,
      onProgress: (done, total) => calls.push([done, total]),
    });
    expect(calls.length).toBeGreaterThan(0);
    expect(calls[0]?.[0]).toBe(0);
    const last = calls[calls.length - 1];
    expect(last?.[0]).toBe(PAYLOAD.length);
    expect(last?.[1]).toBe(PAYLOAD.length);
  });

  it('跟随 302 重定向下载成功', async () => {
    const d = dest();
    await downloadFile(`${base}/redirect`, d, { retries: 0 });
    expect((await readFile(d)).equals(PAYLOAD)).toBe(true);
  });

  it('重试：两次 500 后成功', async () => {
    flakyRemaining = 2;
    const d = dest();
    await downloadFile(`${base}/flaky`, d); // 默认 retries=2，刚好够用
    expect((await readFile(d)).equals(PAYLOAD)).toBe(true);
    expect(hitCount).toBe(3);
  });

  it('耗尽重试：常驻 500 抛 network/retryable 错误', async () => {
    await expect(downloadFile(`${base}/always500`, dest(), { retries: 2 })).rejects.toMatchObject({
      category: 'network',
      retryable: true,
      code: 'HTTP_500',
    });
    expect(hitCount).toBe(3); // 1 首次 + 2 重试
  });

  it('404 不重试：只请求 1 次且 retryable=false', async () => {
    await expect(
      downloadFile(`${base}/missing`, dest(), { retries: 2 }),
    ).rejects.toMatchObject({ retryable: false, code: 'HTTP_404' });
    expect(hitCount).toBe(1);
  });

  it('断点续传：已存在的 .part 按已下载长度发 Range 续传', async () => {
    const d = dest('resume.bin');
    const half = PAYLOAD.subarray(0, 1024);
    await writeFile(`${d}.part`, half);
    const r = await downloadFile(`${base}/file`, d, { retries: 0 });
    expect(lastRangeHeader).toBe(`bytes=${half.length}-`);
    expect(r.bytes).toBe(PAYLOAD.length);
    expect((await readFile(d)).equals(PAYLOAD)).toBe(true);
  });

  it('sha256 正确时通过', async () => {
    const d = dest();
    await downloadFile(`${base}/file`, d, { retries: 0, sha256: PAYLOAD_SHA256 });
    expect((await readFile(d)).equals(PAYLOAD)).toBe(true);
  });

  it('sha256 不匹配：抛 validation 错误并删除 .part、dest 不存在', async () => {
    const d = dest('bad-hash.bin');
    await expect(
      downloadFile(`${base}/file`, d, { retries: 0, sha256: '0'.repeat(64) }),
    ).rejects.toMatchObject({ category: 'validation', retryable: false, code: 'HASH_MISMATCH' });
    await expect(stat(d)).rejects.toThrow();
    await expect(stat(`${d}.part`)).rejects.toThrow();
  });

  it('sha512 不匹配同样抛 validation 错误', async () => {
    await expect(
      downloadFile(`${base}/file`, dest(), { retries: 0, sha512: '0'.repeat(128) }),
    ).rejects.toMatchObject({ category: 'validation', code: 'HASH_MISMATCH' });
  });

  it('sha512 正确时通过（覆盖正确的 sha512 校验分支）', async () => {
    const d = dest();
    const result = await downloadFile(`${base}/file`, d, { retries: 0, sha512: PAYLOAD_SHA512 });
    expect(result.bytes).toBe(PAYLOAD.length);
    expect(await stat(d)).toBeTruthy();
  });

  it('超时：慢响应抛 network/TIMEOUT 错误', async () => {
    await expect(
      downloadFile(`${base}/slow`, dest(), { timeoutMs: 100, retries: 1 }),
    ).rejects.toMatchObject({ category: 'network', code: 'TIMEOUT', retryable: true });
  });
});

describe('FileTaskQueue', () => {
  it('优先级：数字越小越先出队', async () => {
    const q = new FileTaskQueue<string>(dir);
    await q.init();
    await q.enqueue({ id: 'low', kind: 'download', payload: 'l', priority: 10 });
    await q.enqueue({ id: 'high', kind: 'download', payload: 'h', priority: 1 });
    await q.enqueue({ id: 'mid', kind: 'download', payload: 'm', priority: 5 });
    expect((await q.dequeue())?.id).toBe('high');
    expect((await q.dequeue())?.id).toBe('mid');
    expect((await q.dequeue())?.id).toBe('low');
    expect(await q.dequeue()).toBeNull();
  });

  it('同优先级按先入先出', async () => {
    const q = new FileTaskQueue<string>(dir);
    await q.init();
    await q.enqueue({ id: 'a', kind: 'k', payload: 'a' });
    await q.enqueue({ id: 'b', kind: 'k', payload: 'b' });
    expect((await q.dequeue())?.id).toBe('a');
    expect((await q.dequeue())?.id).toBe('b');
  });

  it('持久化：新实例 init 后任务仍在', async () => {
    const q1 = new FileTaskQueue<{ u: number }>(dir);
    await q1.init();
    await q1.enqueue({ id: 'a', kind: 'download', payload: { u: 1 }, priority: 5 });
    const q2 = new FileTaskQueue<{ u: number }>(dir);
    await q2.init();
    expect(q2.get('a')?.state).toBe('queued');
    expect(q2.pendingCount()).toBe(1);
  });

  it('recover：running 恢复为 queued 并可再次出队', async () => {
    const q1 = new FileTaskQueue<string>(dir);
    await q1.init();
    await q1.enqueue({ id: 'a', kind: 'download', payload: 'x' });
    expect((await q1.dequeue())?.state).toBe('running');
    const q2 = new FileTaskQueue<string>(dir);
    await q2.init();
    expect(await q2.recover()).toBe(1);
    expect(q2.get('a')?.state).toBe('queued');
    expect((await q2.dequeue())?.id).toBe('a');
  });

  it('cancel：queued 任务取消后不再出队', async () => {
    const q = new FileTaskQueue<string>(dir);
    await q.init();
    await q.enqueue({ id: 'a', kind: 'k', payload: 'a' });
    await q.enqueue({ id: 'b', kind: 'k', payload: 'b' });
    expect(await q.cancel('a')).toBe(true);
    expect(q.get('a')?.state).toBe('cancelled');
    expect((await q.dequeue())?.id).toBe('b');
    expect(await q.dequeue()).toBeNull();
  });

  it('cancel 未知 id 返回 false，重复 enqueue 抛错', async () => {
    const q = new FileTaskQueue<string>(dir);
    await q.init();
    expect(await q.cancel('nope')).toBe(false);
    await q.enqueue({ id: 'a', kind: 'k', payload: 'a' });
    await expect(q.enqueue({ id: 'a', kind: 'k', payload: 'a' })).rejects.toThrow();
  });

  it('complete / fail 流转状态并记录错误', async () => {
    const q = new FileTaskQueue<string>(dir);
    await q.init();
    await q.enqueue({ id: 'a', kind: 'k', payload: 'a' });
    await q.enqueue({ id: 'b', kind: 'k', payload: 'b' });
    await q.dequeue();
    await q.dequeue();
    await q.complete('a');
    await q.fail('b', { category: 'network', message: 'boom', retryable: true });
    expect(q.get('a')?.state).toBe('done');
    expect(q.get('b')?.state).toBe('failed');
    expect(q.get('b')?.error).toMatchObject({ message: 'boom' });
    expect(await q.cancel('a')).toBe(false); // 终态不可取消
    await expect(q.complete('missing')).rejects.toThrow();
  });
});
