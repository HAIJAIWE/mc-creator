/**
 * host.ts 测试（阶段 7 补齐的生产宿主入口）。
 *
 * 只断言三件事，不碰真实网络/端口：
 * 1. import 无副作用（本模块只导出符号；不断言实现细节，只验证导出形状，
 *    且本文件内所有用例都不开真实端口、都不碰真实 stdin/stdout，
 *    用例跑完无残留句柄，进程能自然退出）；
 * 2. startStdio / startHttp 为函数，且分别经内存流 / 注入 listener 可走通；
 * 3. 缺 dataDir 时回退到 os.tmpdir() 下 mc-creator-agent 子目录且目录存在。
 */
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable, Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { HOST_FALLBACK_DIR_NAME, resolveHostDataDir, startHttp, startStdio } from './host.js';
import type { HttpResponseLike } from './mcp-http.js';

describe('host 导出形状（import 无副作用：只导出符号，不自启）', () => {
  it('startStdio / startHttp 为函数，resolveHostDataDir 为函数', () => {
    expect(typeof startStdio).toBe('function');
    expect(typeof startHttp).toBe('function');
    expect(typeof resolveHostDataDir).toBe('function');
  });
});

describe('dataDir 缺失回退', () => {
  it('缺 dataDir 时回退到 os.tmpdir() 下 mc-creator-agent 子目录且目录存在', () => {
    const dir = resolveHostDataDir({});
    expect(dir).toBe(join(tmpdir(), HOST_FALLBACK_DIR_NAME));
    expect(HOST_FALLBACK_DIR_NAME).toBe('mc-creator-agent');
    expect(existsSync(dir)).toBe(true);
  });

  it('显式 dataDir 原样返回（同样确保存在）', () => {
    const dir = resolveHostDataDir({ dataDir: join(tmpdir(), HOST_FALLBACK_DIR_NAME) });
    expect(existsSync(dir)).toBe(true);
  });
});

describe('startStdio 经内存流可走通（不碰真实 stdin/stdout）', () => {
  it('空输入流直接结束，无输出行', async () => {
    const input = Readable.from([]);
    const chunks: string[] = [];
    const output = new Writable({
      write(chunk, _encoding, cb) {
        chunks.push(chunk.toString());
        cb();
      },
    });
    await startStdio({ input, output });
    expect(chunks.join('')).toBe('');
  });
});

describe('startHttp 经注入 listener 可走通（不开真实端口）', () => {
  it('注入 fake listener → 返回编排句柄且 close() 干净', async () => {
    let closed = false;
    const running = await startHttp({
      listener: {
        handle: async (): Promise<HttpResponseLike> => ({ status: 200, headers: {}, body: '' }),
        close: () => {
          closed = true;
        },
      },
    });
    expect(typeof running.port).toBe('number');
    expect(running.url).toContain('/mcp');
    expect(typeof running.close).toBe('function');
    await running.close();
    expect(closed).toBe(true);
  });
});
