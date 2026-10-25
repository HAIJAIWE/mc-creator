// @vitest-environment node
/**
 * 版本号的**一致性**：从清单到界面到落盘，必须是同一个字符串。
 *
 * 起因是用户问「版本一致，对应链接也一样吧」「下载版号都是对的吗」。
 * 这两问都不能靠读代码回答 —— 中间隔着 resolveVersion → IPC → 界面 → 文件名
 * 四段，任何一段自己改写 id 都不会报错，只会安静地错位。
 *
 * 钉的是**同一个 id 走完全程后处处相等**。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

import { LauncherService, type VersionDetail } from './launcher-service.js';

const ID = '26.4-snapshot-3';

const DETAIL: VersionDetail = {
  id: ID,
  assets: '26',
  assetsUrl: 'https://example.invalid/index.json',
  clientUrl: 'https://example.invalid/client.jar',
  libraryUrls: [],
  javaMajor: null,
  clientSha1: null,
  clientSize: null,
  serverUrl: null,
  serverSha1: null,
  serverSize: null,
};

describe('版本号一致性：清单 → 下载 → 落盘 → 更新日志链接', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'vc-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('下载的 jar 落在 versions/<id>/<id>.jar，文件名与目录名都是同一个 id', async () => {
    const jar = Buffer.from('client-jar-bytes');
    const svc = new LauncherService(dir, (async () => ({
      ok: true,
      status: 200,
      arrayBuffer: async () => jar.buffer.slice(jar.byteOffset, jar.byteOffset + jar.byteLength),
    })) as unknown as typeof fetch);

    const written = await svc.downloadClient(DETAIL);

    // 逐段核对，任何一段被改写都会在这里现形
    expect(written).toBe(join(dir, 'versions', ID, `${ID}.jar`));
    expect(existsSync(join(dir, 'versions', ID, `${ID}.jar`))).toBe(true);
    // 目录里不该出现第二个版本目录（说明 id 没有被规范化/改写）
    expect(existsSync(join(dir, 'versions', ID, `${ID}.jar.disabled`))).toBe(false);
    expect(readFileSync(written, 'utf-8')).toBe('client-jar-bytes');
  });

  it('快照版 id 原样穿过全链路（含 createHash 之类的规范化不会碰它）', async () => {
    // 快照版号是最容易被"清洗"的形态：带 -、带小写、长度不固定
    expect(ID).toMatch(/^\d+\.\d+-snapshot-\d+$/);
    const svc = new LauncherService(dir);
    // gameDir / modsDir 两条派生路径必须挂在同一个 id 下。
    // mods 现在是 `<gameDir>/mods`（2026-10-13 改）：Minecraft 只认 gameDir 下的
    // mods，之前放在 `versions/<id>/mods` 时游戏永远扫不到。
    expect(svc.gameDir(ID)).toBe(join(dir, 'game', ID));
    expect(svc.modsDir(ID)).toBe(join(dir, 'game', ID, 'mods'));
    // 两条路径必须是父子关系，不能是两个平行目录
    expect(svc.modsDir(ID).startsWith(svc.gameDir(ID))).toBe(true);
  });

  it('更新日志链接的 id 来源只有一处：清单里的 id 本身', async () => {
    /**
     * 这里**不** import `wikiUrlFor` —— 主进程的 tsconfig 不收渲染层文件，
     * 跨进程 import 会被 typecheck 挡住（这也是一条边界信号，别绕过它）。
     * 链接规则本身由 `wiki-links.test.ts` 管。
     *
     * 本用例只钉主进程这侧的事实：`detail.id` 原样透传，
     * 不被 assets / clientUrl / 哈希之类的东西改写。
     */
    const svc = new LauncherService(dir);
    expect(svc.gameDir(DETAIL.id)).toBe(join(dir, 'game', DETAIL.id));
    expect(svc.modsDir(DETAIL.id)).toBe(join(dir, 'game', DETAIL.id, 'mods'));
    // assets 索引号是 '26'，与版本号 '26.4-snapshot-3' 无关 ——
    // 若哪天有人拿 assets 去拼路径，这里会现形
    expect(DETAIL.assets).not.toBe(DETAIL.id);
  });

  it('sha1/size 校验用的是清单给的哈希，不是 id 派生的', async () => {
    const jar = Buffer.from('payload');
    const sha1 = createHash('sha1').update(jar).digest('hex');
    const svc = new LauncherService(dir, (async () => ({
      ok: true,
      status: 200,
      arrayBuffer: async () => jar.buffer.slice(jar.byteOffset, jar.byteOffset + jar.byteLength),
    })) as unknown as typeof fetch);
    // 正确的哈希 → 落盘
    await svc.downloadClient({ ...DETAIL, clientSha1: sha1, clientSize: jar.length });
    expect(existsSync(join(dir, 'versions', ID, `${ID}.jar`))).toBe(true);

    // 错的 size → 不落盘（坏文件比缺文件更糟：缺了会明确报错，坏了是静默崩）
    const dir2 = mkdtempSync(join(tmpdir(), 'vc2-'));
    const svc2 = new LauncherService(dir2, (async () => ({
      ok: true,
      status: 200,
      arrayBuffer: async () => jar.buffer.slice(jar.byteOffset, jar.byteOffset + jar.byteLength),
    })) as unknown as typeof fetch);
    await expect(svc2.downloadClient({ ...DETAIL, clientSize: 999999 })).rejects.toThrow();
    expect(existsSync(join(dir2, 'versions', ID, `${ID}.jar`)), '校验失败却落盘了').toBe(false);
    rmSync(dir2, { recursive: true, force: true });
  });
});
