// @vitest-environment node
/**
 * 整合包文件落盘（`installModpackFiles`）—— 断言的是**线上跑的那份逻辑**。
 *
 * 这个文件以前测试的是 handler 里那段逻辑的**抄件**（`applyOverrides`）：
 * 抄件和真件各自演进，抄件绿了说明不了任何事。现在逻辑抽成了
 * `modpack-install.ts`，测试直接调它。
 *
 * 三条规则各自对应一个用户能看见的症状（详见模块头部注释）：
 * 1. 路径穿越必须挡住（清单来自任意第三方）。
 * 2. sha1 不匹配必须**不落盘**并如实报错 —— 否则坏 jar 静默进 mods/。
 * 3. 服务端专用条目不装（装了实例起不来），且**不算失败**（清单本来就写了）。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { ModpackFile } from '@mc-creator/core';

import { installModpackFiles } from './modpack-install.js';
import { commitDownload, modpackLedgerRecorder } from './download-index.js';

/** 一张能装的文件条目。 */
function file(over: Partial<ModpackFile> & { targetPath: string }): ModpackFile {
  return {
    name: over.targetPath,
    url: 'https://cdn.example.com/x.jar',
    displayName: 'X',
    size: 3,
    client: true,
    server: true,
    ...over,
  };
}

/** 假的下载实现：按 URL 给字节。 */
function fetchOf(map: Record<string, string>): typeof fetch {
  return (async (url: string) => {
    const body = map[url];
    if (body === undefined) {
      return { ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) } as Response;
    }
    return {
      ok: true,
      status: 200,
      arrayBuffer: async () => new TextEncoder().encode(body).buffer,
    } as Response;
  }) as unknown as typeof fetch;
}

const sha1 = (s: string) => createHash('sha1').update(s).digest('hex');

describe('installModpackFiles', () => {
  let root: string;
  let gameDir: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'mp-install-'));
    gameDir = join(root, 'game', '我的整合包');
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('下载后按 targetPath 落盘，父目录自动建', async () => {
    const r = await installModpackFiles({
      gameDir,
      files: [
        file({ targetPath: 'mods/a.jar', url: 'https://cdn.example.com/a' }),
        file({ targetPath: 'resourcepacks/b.zip', url: 'https://cdn.example.com/b' }),
      ],
      resolveRedirect: async () => null,
      fetchImpl: fetchOf({ 'https://cdn.example.com/a': 'AAA', 'https://cdn.example.com/b': 'BB' }),
    });
    expect(r.failed).toEqual([]);
    expect(r.installed).toBe(2);
    expect(readFileSync(join(gameDir, 'mods', 'a.jar'), 'utf-8')).toBe('AAA');
    // 资源包落 resourcepacks/ 而不是 mods/（CF 侧按后缀分目录）
    expect(readFileSync(join(gameDir, 'resourcepacks', 'b.zip'), 'utf-8')).toBe('BB');
  });

  it('sha1 匹配 → 正常落盘', async () => {
    const r = await installModpackFiles({
      gameDir,
      files: [
        file({
          targetPath: 'mods/a.jar',
          url: 'https://cdn.example.com/a',
          sha1: sha1('AAA'),
        }),
      ],
      resolveRedirect: async () => null,
      fetchImpl: fetchOf({ 'https://cdn.example.com/a': 'AAA' }),
    });
    expect(r.installed).toBe(1);
    expect(existsSync(join(gameDir, 'mods', 'a.jar'))).toBe(true);
  });

  it('sha1 不匹配 → 不落盘，并说清期望/实际', async () => {
    const r = await installModpackFiles({
      gameDir,
      files: [
        file({
          targetPath: 'mods/broken.jar',
          url: 'https://cdn.example.com/a',
          // 期望的是「完整文件」的哈希，下载回来的却是被截断的内容
          sha1: sha1('AAAAAAAAAA'),
        }),
      ],
      resolveRedirect: async () => null,
      fetchImpl: fetchOf({ 'https://cdn.example.com/a': 'AAA' }),
    });
    expect(r.installed).toBe(0);
    expect(r.failed).toHaveLength(1);
    expect(r.failed[0]?.name).toBe('mods/broken.jar');
    expect(r.failed[0]?.error).toContain('sha1 不匹配');
    expect(r.failed[0]?.error).toContain(sha1('AAAAAAAAAA'));
    // 坏文件绝不能留在盘上（留在盘上 = 游戏加载它 = 崩）
    expect(existsSync(join(gameDir, 'mods', 'broken.jar'))).toBe(false);
  });

  it('大写 sha1（CF 给的可能是大写）照认', async () => {
    const r = await installModpackFiles({
      gameDir,
      files: [
        file({
          targetPath: 'mods/a.jar',
          url: 'https://cdn.example.com/a',
          sha1: sha1('AAA').toUpperCase(),
        }),
      ],
      resolveRedirect: async () => null,
      fetchImpl: fetchOf({ 'https://cdn.example.com/a': 'AAA' }),
    });
    expect(r.installed).toBe(1);
  });

  it('没有 sha1 的文件照旧装（没有参照物就无从校验，不该因此拒绝）', async () => {
    const r = await installModpackFiles({
      gameDir,
      files: [file({ targetPath: 'mods/a.jar', url: 'https://cdn.example.com/a' })],
      resolveRedirect: async () => null,
      fetchImpl: fetchOf({ 'https://cdn.example.com/a': 'AAA' }),
    });
    expect(r.installed).toBe(1);
  });

  it('一个失败不拖累其余（整包几十个文件，一个挂了别的照装）', async () => {
    const r = await installModpackFiles({
      gameDir,
      files: [
        file({ targetPath: 'mods/a.jar', url: 'https://cdn.example.com/a' }),
        file({ targetPath: 'mods/missing.jar', url: 'https://cdn.example.com/nope' }),
        file({ targetPath: 'mods/c.jar', url: 'https://cdn.example.com/c' }),
      ],
      resolveRedirect: async () => null,
      fetchImpl: fetchOf({ 'https://cdn.example.com/a': 'A', 'https://cdn.example.com/c': 'C' }),
    });
    expect(r.installed).toBe(2);
    expect(r.failed.map((f) => f.name)).toEqual(['mods/missing.jar']);
    expect(r.failed[0]?.error).toContain('HTTP 404');
    expect(existsSync(join(gameDir, 'mods', 'c.jar'))).toBe(true);
  });

  it('服务端专用条目不装，也不算失败', async () => {
    const r = await installModpackFiles({
      gameDir,
      files: [
        file({ targetPath: 'mods/server-only.jar', client: false }),
        file({ targetPath: 'mods/a.jar', url: 'https://cdn.example.com/a' }),
      ],
      resolveRedirect: async () => null,
      fetchImpl: fetchOf({ 'https://cdn.example.com/a': 'A' }),
    });
    expect(r.installed).toBe(1);
    expect(r.failed).toEqual([]);
    expect(existsSync(join(gameDir, 'mods', 'server-only.jar'))).toBe(false);
  });

  it('路径穿越被拒（清单是任意第三方上传的 zip）', async () => {
    const r = await installModpackFiles({
      gameDir,
      files: [file({ targetPath: '../../escaped.jar', url: 'https://cdn.example.com/a' })],
      resolveRedirect: async () => null,
      fetchImpl: fetchOf({ 'https://cdn.example.com/a': 'A' }),
    });
    expect(r.installed).toBe(0);
    expect(r.failed).toHaveLength(1);
    expect(existsSync(join(root, 'escaped.jar'))).toBe(false);
    expect(existsSync(join(gameDir, '..', 'escaped.jar'))).toBe(false);
  });

  it('CurseForge 重定向：拿到直链就装，拿不到就报「去填 key」', async () => {
    const ok = await installModpackFiles({
      gameDir,
      files: [
        file({ targetPath: 'mods/cf.jar', url: null, curseforge: { projectId: 1, fileId: 2 } }),
      ],
      resolveRedirect: async () => 'https://cdn.example.com/cf',
      fetchImpl: fetchOf({ 'https://cdn.example.com/cf': 'CF' }),
    });
    expect(ok.installed).toBe(1);

    const noKey = await installModpackFiles({
      gameDir,
      files: [
        file({ targetPath: 'mods/cf2.jar', url: null, curseforge: { projectId: 1, fileId: 3 } }),
      ],
      resolveRedirect: async () => null,
      fetchImpl: fetchOf({}),
    });
    expect(noKey.installed).toBe(0);
    expect(noKey.failed[0]?.error).toContain('CurseForge');
  });

  it('进度回调逐个报（UI 的进度条靠它）', async () => {
    const seen: Array<[number, number, string]> = [];
    await installModpackFiles({
      gameDir,
      files: [
        file({ targetPath: 'mods/a.jar', url: 'https://cdn.example.com/a' }),
        file({ targetPath: 'mods/b.jar', url: 'https://cdn.example.com/b' }),
      ],
      resolveRedirect: async () => null,
      onProgress: (i, total, f) => seen.push([i, total, f.targetPath]),
      fetchImpl: fetchOf({ 'https://cdn.example.com/a': 'A', 'https://cdn.example.com/b': 'B' }),
    });
    expect(seen).toEqual([
      [0, 2, 'mods/a.jar'],
      [1, 2, 'mods/b.jar'],
    ]);
  });

  /**
   * 「装完的文件进账本」的通知口（`onFileInstalled`）。
   *
   * 只有**真的落盘了**才该通知：下崩的、sha1 对不上的、服务端专用被跳过的一律不算
   * —— 账本是「这个文件确实下了」的凭据，记错了反而会误导后续替换。
   */
  it('onFileInstalled 只对成功落盘的文件触发，并带上真实的下载地址', async () => {
    const installed: Array<{ path: string; url: string; projectId: string | undefined }> = [];
    const r = await installModpackFiles({
      gameDir,
      files: [
        file({
          targetPath: 'mods/ok.jar',
          url: 'https://cdn.example.com/ok',
          projectId: 'mr_ok',
        }),
        file({
          targetPath: 'mods/bad-sha.jar',
          url: 'https://cdn.example.com/bad',
          sha1: '0'.repeat(40),
          projectId: 'mr_bad',
        }),
        file({ targetPath: 'mods/server.jar', client: false, projectId: 'mr_server' }),
        file({ targetPath: 'mods/missing.jar', url: 'https://cdn.example.com/nope' }),
        file({ targetPath: 'mods/via-cf.jar', url: null, curseforge: { projectId: 7, fileId: 8 } }),
      ],
      resolveRedirect: async () => 'https://cdn.example.com/cf',
      onFileInstalled: (f, url) =>
        installed.push({ path: f.targetPath, url, projectId: f.projectId }),
      fetchImpl: fetchOf({
        'https://cdn.example.com/ok': 'OK',
        'https://cdn.example.com/bad': 'BAD',
        'https://cdn.example.com/cf': 'CF',
      }),
    });

    expect(r.installed).toBe(2); // ok.jar + via-cf.jar
    expect(installed).toEqual([
      { path: 'mods/ok.jar', url: 'https://cdn.example.com/ok', projectId: 'mr_ok' },
      // 重定向来的文件，回调拿到的必须是**真正下到东西的那个地址**
      { path: 'mods/via-cf.jar', url: 'https://cdn.example.com/cf', projectId: undefined },
    ]);
  });

  /**
   * 取消的三条路径。
   *
   * 取消是用户主动行为，不是「下载失败」：已落盘的文件要保留并记账，没轮到的
   * 文件不能再发请求，更不能把剩下的全记成 failed（界面会误报几十条失败）。
   */
  it('开始前就取消：一个请求都不发，也不产生失败项', async () => {
    const ac = new AbortController();
    ac.abort();
    let calls = 0;
    const fetchImpl = (async () => {
      calls++;
      return { ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(0) } as Response;
    }) as unknown as typeof fetch;

    const r = await installModpackFiles({
      gameDir,
      files: [file({ targetPath: 'mods/a.jar', url: 'https://cdn.example.com/a' })],
      resolveRedirect: async () => null,
      fetchImpl,
      signal: ac.signal,
    });

    expect(r).toEqual({ installed: 0, failed: [], cancelled: true });
    expect(calls).toBe(0);
    expect(existsSync(join(gameDir, 'mods', 'a.jar'))).toBe(false);
  });

  it('下载中途取消：fetch 收到 signal，取消后不落半截文件', async () => {
    const ac = new AbortController();
    let started!: () => void;
    const startedPromise = new Promise<void>((resolve) => {
      started = resolve;
    });
    const fetchImpl = (async (_url: string, init?: RequestInit) => {
      started();
      await new Promise<never>((_resolve, reject) => {
        const signal = init?.signal;
        const onAbort = (): void => reject(new DOMException('Aborted', 'AbortError'));
        if (signal?.aborted) onAbort();
        else signal?.addEventListener('abort', onAbort, { once: true });
      });
    }) as unknown as typeof fetch;

    const pending = installModpackFiles({
      gameDir,
      files: [file({ targetPath: 'mods/a.jar', url: 'https://cdn.example.com/a' })],
      resolveRedirect: async () => null,
      fetchImpl,
      signal: ac.signal,
    });
    await startedPromise;
    ac.abort();
    const r = await pending;

    expect(r.installed).toBe(0);
    expect(r.cancelled).toBe(true);
    expect(r.failed).toEqual([]);
    expect(existsSync(join(gameDir, 'mods', 'a.jar'))).toBe(false);
  });

  it('第一个文件落盘后取消：保留并记账，后面的文件不再请求', async () => {
    const ac = new AbortController();
    let calls = 0;
    const fetchImpl = (async () => {
      calls++;
      return {
        ok: true,
        status: 200,
        arrayBuffer: async () => new TextEncoder().encode('AAA').buffer,
      } as Response;
    }) as unknown as typeof fetch;
    const recorded: string[] = [];

    const r = await installModpackFiles({
      gameDir,
      files: [
        file({ targetPath: 'mods/a.jar', url: 'https://cdn.example.com/a' }),
        file({ targetPath: 'mods/b.jar', url: 'https://cdn.example.com/b' }),
      ],
      resolveRedirect: async () => null,
      fetchImpl,
      signal: ac.signal,
      onFileInstalled: (f) => {
        recorded.push(f.targetPath);
        ac.abort();
      },
    });

    expect(calls).toBe(1);
    expect(r.installed).toBe(1);
    expect(r.cancelled).toBe(true);
    expect(r.failed).toEqual([]);
    // 已落盘的那个必须记账 —— 之后从搜索页下同一个 mod 才能替换掉它
    expect(recorded).toEqual(['mods/a.jar']);
    expect(readFileSync(join(gameDir, 'mods', 'a.jar'), 'utf-8')).toBe('AAA');
    expect(existsSync(join(gameDir, 'mods', 'b.jar'))).toBe(false);
  });

  /**
   * 装完整合包 → 从搜索页再下同一个 mod：旧的那份必须被替换掉。
   *
   * 这是端到端的接缝测试：真的走安装器落盘、真的把归属记进账本（`batchRecorder`）、
   * 再由下载路径的 `commitDownload` 去替换。留下的两个同 mod id 的 jar 会让
   * NeoForge `Duplicate mod` 拒启动。
   */
  it('装包时记的账本，让之后单独下载同一个 mod 能替换掉旧文件', async () => {
    const packFiles = [
      file({
        targetPath: 'mods/jei-26.3-neoforge-31.15.0.79.jar',
        url: 'https://cdn.example.com/jei-79',
        projectId: 'cf_238222',
      }),
      file({
        targetPath: 'mods/ferritecore-9.0.0.jar',
        url: 'https://cdn.example.com/ferrite',
        projectId: 'mr_uXXizFIs',
      }),
    ];
    await installModpackFiles({
      gameDir,
      files: packFiles,
      resolveRedirect: async () => null,
      fetchImpl: fetchOf({
        'https://cdn.example.com/jei-79': 'JEI79',
        'https://cdn.example.com/ferrite': 'FERRITE',
      }),
      // 线上就是这个回调（`modpackLedgerRecorder`），不是测试另写的适配
      onFileInstalled: modpackLedgerRecorder(gameDir),
    });
    expect(existsSync(join(gameDir, 'mods', 'jei-26.3-neoforge-31.15.0.79.jar'))).toBe(true);

    // 搜索页下了同一个项目的**新构建**（文件名不同 ⇒ 光靠覆盖写盘救不了）
    writeFileSync(join(gameDir, 'mods', 'jei-26.3-neoforge-31.15.0.81.jar'), 'JEI81');
    const victims = commitDownload(gameDir, {
      projectId: 'cf_238222',
      dir: 'mods',
      name: 'jei-26.3-neoforge-31.15.0.81.jar',
    });

    expect(victims).toEqual(['jei-26.3-neoforge-31.15.0.79.jar']);
    expect(existsSync(join(gameDir, 'mods', 'jei-26.3-neoforge-31.15.0.79.jar'))).toBe(false);
    // 别的项目（整合包里另一个 mod）不动
    expect(existsSync(join(gameDir, 'mods', 'ferritecore-9.0.0.jar'))).toBe(true);
  });
});
