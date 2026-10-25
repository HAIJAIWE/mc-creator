/**
 * 搜索的**补拉循环**回归网。
 *
 * ## 为什么要单独一个文件
 *
 * 「搜索页永远停在加载中」这个 bug 的原因不在源站、也不在渲染层，而在
 * `LAUNCHER_SEARCH_MODS` handler 里那段"补拉凑够"的循环：
 *
 *   - 它的注释写着「本页**明显不足**才补」，但代码里**没有**这条判断 ——
 *     每次搜索都无条件多补两轮；
 *   - 每补一轮又走**逐条**富化（`enrichModrinthHit`），而那条路径会拉项目的
 *     **全量版本列表**：实测 Fabric API 是 1.2MB / 1211 个版本 / 单次 22 秒。
 *
 * 20 条顺序走完 = 分钟级，用户看到的就是"加载中"转圈转到天荒地老。
 *
 * 断言方式选最笨的一种：**数请求次数**。补一次就多一次 search + 一批富化，
 * 这个数字变了就是回归。
 */
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';

const h = vi.hoisted(() => ({
  handlers: new Map<string, (e: unknown, raw: unknown) => unknown>(),
  userData: '',
  /** 每次 search 的记录（offset/limit），用来数补拉轮数。 */
  searchCalls: [] as Array<{ offset: number; limit: number }>,
  /** 批量富化调用次数。 */
  enrichCalls: { projects: 0, versions: 0 },
  /** 源站这一页实际给多少条（默认给满 = limit）。 */
  hitsPerPage: -1,
  /** true = 每页都给同一批 id（模拟源站忽略 offset 的情况）。 */
  repeatHits: false,
}));

vi.mock('electron', () => ({
  ipcMain: {
    handle: (ch: string, fn: (e: unknown, raw: unknown) => unknown) => {
      h.handlers.set(ch, fn);
    },
    on: () => undefined,
    removeHandler: (ch: string) => {
      h.handlers.delete(ch);
    },
  },
  dialog: { showOpenDialog: vi.fn(), showMessageBox: vi.fn() },
  app: { getPath: () => h.userData, on: () => undefined },
}));

/**
 * Modrinth 客户端换成假的：**命中数可控**，`total` 故意远大于一页
 * （真实源站就是这样）—— 于是"还有源没取尽"永远为真，唯一能阻止补拉的
 * 就是"本页够一页"。
 */
vi.mock('@mc-creator/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@mc-creator/core')>();

  class FakeModrinthApiClient {
    async search(
      _query: string,
      opts: { limit?: number; offset?: number } = {},
    ): Promise<{ hits: Array<Record<string, unknown>>; total: number }> {
      const offset = opts.offset ?? 0;
      const limit = opts.limit ?? 20;
      h.searchCalls.push({ offset, limit });
      const count = h.hitsPerPage < 0 ? limit : h.hitsPerPage;
      const hits: Array<Record<string, unknown>> = [];
      for (let i = 0; i < count; i++) {
        const n = h.repeatHits ? i : offset + i;
        hits.push({
          project_id: `p${n}`,
          slug: `proj-${n}`,
          title: `Project ${n}`,
          description: 'x',
          icon_url: null,
          downloads: 1000 - n,
          categories: [],
          latest_version: `v${n}`,
          date_modified: '2026-01-01T00:00:00Z',
        });
      }
      return { hits, total: 100_000 };
    }

    async getProjectsByIds(ids: string[]): Promise<Map<string, Record<string, unknown>>> {
      h.enrichCalls.projects += 1;
      const m = new Map<string, Record<string, unknown>>();
      for (const id of ids) {
        m.set(id, {
          id,
          slug: id,
          title: id,
          description: '',
          body: '',
          icon_url: null,
          categories: [],
          downloads: 1,
          followers: 1,
          project_type: 'mod',
          game_versions: ['1.21.1'],
          loaders: ['fabric'],
          versions: [`v${id.slice(1)}`],
          wiki_url: null,
          source_url: null,
          issues_url: null,
          discord_url: null,
          donation_urls: [],
          published: '2026-01-01T00:00:00Z',
          updated: '2026-01-01T00:00:00Z',
          client_side: 'required',
          server_side: 'optional',
          team: 't',
        });
      }
      return m;
    }

    async getVersionsByIds(ids: string[]): Promise<Map<string, Record<string, unknown>>> {
      h.enrichCalls.versions += 1;
      const m = new Map<string, Record<string, unknown>>();
      for (const id of ids) {
        m.set(id, {
          id,
          project_id: 'p',
          version_number: '1.0.0',
          name: '1.0.0',
          game_versions: ['1.21.1'],
          loaders: ['fabric'],
          files: [
            {
              url: 'https://cdn.example.com/a.jar',
              filename: 'a.jar',
              primary: true,
              size: 10,
              hashes: { sha1: 'x' },
            },
          ],
          date_published: '2026-01-01T00:00:00Z',
          version_type: 'release',
          status: 'listed',
          downloads: 1,
        });
      }
      return m;
    }

    /** 逐条兜底路径：本用例里必须**永远不出现**（它就是慢的那条）。 */
    async getVersions(): Promise<never> {
      throw new Error('逐条富化被调用了 —— 补拉应该走批量（见本文件顶部注释）');
    }
  }

  return {
    ...actual,
    ModrinthApiClient: FakeModrinthApiClient as unknown as typeof actual.ModrinthApiClient,
  };
});

import { registerLauncherHandlers } from './ipc/launcher.js';
import { LAUNCHER_SEARCH_MODS } from '../shared/ipc-channels.js';

beforeAll(() => {
  registerLauncherHandlers();
});

afterEach(() => {
  h.searchCalls.length = 0;
  h.enrichCalls.projects = 0;
  h.enrichCalls.versions = 0;
  h.hitsPerPage = -1;
  h.repeatHits = false;
});

async function search(limit: number): Promise<{ mods: unknown[]; total: number }> {
  const fn = h.handlers.get(LAUNCHER_SEARCH_MODS);
  expect(fn).toBeDefined();
  return (await fn!(
    { sender: {} },
    { query: '', contentType: 'mod', source: 'modrinth', limit, sort: 'downloads' },
  )) as { mods: unknown[]; total: number };
}

describe('搜索补拉循环', () => {
  it('本页够一页时**不补拉**（回归：曾经无条件补两轮 → 搜索页卡在加载中）', async () => {
    const res = await search(20);

    expect(res.mods.length).toBe(20);
    // 只打了一次 search：没有补拉
    expect(h.searchCalls).toEqual([{ offset: 0, limit: 20 }]);
    // 富化只走了主路径那一次批量（projects + versions 各一次）
    expect(h.enrichCalls).toEqual({ projects: 1, versions: 1 });
    expect(res.total).toBe(100_000);
  });

  it('本页不足一页且源站还有货时**会**补拉（别把闸关死）', async () => {
    // 源站这一页只给 5 条：20 条一页就得补
    h.hitsPerPage = 5;
    const res = await search(20);

    // 第一轮 5 条 + 两轮补拉各 5 条 = 15 条（补拉上限 2 轮）
    expect(res.mods.length).toBe(15);
    expect(h.searchCalls).toEqual([
      { offset: 0, limit: 20 },
      { offset: 5, limit: 20 },
      { offset: 10, limit: 20 },
    ]);
    // 每一轮补拉都走批量富化（不是逐条）
    expect(h.enrichCalls).toEqual({ projects: 3, versions: 3 });
  });

  it('补拉不会把同一条项目塞两遍，也不会空转', async () => {
    // 源站每页都给同样的 3 条（忽略 offset）→ 补拉拿不到新条目就应当停
    h.hitsPerPage = 3;
    h.repeatHits = true;
    const res = await search(20);

    // 只有第一页那 3 条（去重后），没有被补拉塞出重复行
    expect(res.mods.length).toBe(3);
    // 打了一次主搜索 + 一次补拉（拿不到新的就 break，不是硬补两轮）
    expect(h.searchCalls).toEqual([
      { offset: 0, limit: 20 },
      { offset: 3, limit: 20 },
    ]);
  });
});
