// @vitest-environment jsdom
/**
 * DownloadTab（L5 · 下载页）测试
 *
 * ## 这个组件是整个下载页的门面，风险集中在三处
 *
 * 1. **追加式分页 + 去重**。不是「翻页」，是「加载更多」——列表要能一直往下长。
 *    而且源站排序在两页之间会变，同一个项目可能两页都返回。实现读的是
 *    `modResultsRef` 而不是 state（state 在 useCallback 创建时就被快照了，
 *    连点两次「加载更多」会拿同一份旧数组把第一页挤掉）。这两条都要钉住。
 *
 * 2. **下载目标必须落实例，数据包还得落世界**。mod 不能塞进全局共享目录
 *    （没人读它，而且多实例必然互相串）；数据包没有实例级目录，只有
 *    `saves/<世界>/datapacks/`。所以「没有实例」要禁用按钮，没有世界也要禁用 ——
 *    不是点了再报错。
 *
 * 3. **部分失败不许吞掉另一半**。缺 CurseForge key 时 Modrinth 那半边仍然有效，
 *    此时 error 只是旁边的提示条，不能用红块把还能用的结果一起废掉。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react';

vi.mock('skinview3d', () => ({
  SkinViewer: class {
    constructor(_opts: unknown) {}
    loadSkin(): void {}
    dispose(): void {}
  },
}));

vi.mock('../../lib/ipc-client.js', () => ({
  ipcClient: {
    launcherListVersions: vi.fn(),
    launcherListInstances: vi.fn(),
    launcherListWorlds: vi.fn(),
    launcherSearchMods: vi.fn(),
    launcherGetModDetail: vi.fn(),
    launcherDownloadMod: vi.fn(),
    launcherDownloadUrl: vi.fn(),
    launcherInstallModpack: vi.fn(),
    launcherCancelModpack: vi.fn(),
    // 原版游戏侧的下载（客户端 / 服务端 / 服务端实例）
    launcherDownload: vi.fn(),
    launcherDownloadServer: vi.fn(),
    launcherCreateServerInstance: vi.fn(),
    // 两个进度订阅：组件挂载时就会调用，返回值当清理函数用
    onLauncherModpackProgress: vi.fn(() => () => undefined),
    onLauncherDownloadProgress: vi.fn(() => () => undefined),
    /**
     * 中文词 → 英文项目名（MC百科 别名查询）。
     *
     * 只有 MC百科 有中文名，但它不托管文件，所以只拿它查词 ——
     * 数据仍走 Modrinth / CurseForge 的 JSON API。
     */
    launcherModCnAlias: vi.fn(),
    // 皮肤分类（MineSkin 浏览）走的是皮肤库通道，不是 LAUNCHER_SEARCH_MODS
    launcherSkinMineskinPage: vi.fn(),
    launcherSkinAddMineskin: vi.fn(),
    launcherSkinApply: vi.fn(),
    /** 按 Mojang UUID 导正版皮肤。 */
    launcherSkinAddOfficial: vi.fn(),
  },
}));

import { DownloadTab } from './DownloadTab.js';
import { ipcClient } from '../../lib/ipc-client.js';
import type { ModEntry } from '../../../../shared/ipc/launcher.js';
import { PLAY_LOADER_FILTERS } from '../../../../shared/play-loaders.js';

const m = ipcClient as unknown as Record<string, ReturnType<typeof vi.fn>>;

function mod(over: Partial<ModEntry> = {}): ModEntry {
  return {
    id: 'mr_sodium',
    name: 'Sodium',
    summary: '优化渲染',
    source: 'modrinth',
    contentType: 'mod',
    gameVersions: ['1.21.1'],
    loaders: ['fabric'],
    latestVersion: '0.6.0',
    downloadUrl: 'https://cdn.modrinth.com/data/AANobbMI/versions/sodium-0.6.0.jar',
    downloads: 12345678,
    updatedAt: Date.parse('2026-09-15T19:23:00Z'),
    categories: ['optimization'],
    ...over,
  };
}

const INSTANCES = {
  instances: [
    { id: '我的空岛', name: '我的空岛', versionId: '1.21.1', loader: 'fabric', clientReady: true },
  ],
  error: null,
};

/** 切到某个左侧分类（vanilla 不发搜索请求） */
function gotoCategory(label: string): void {
  fireEvent.click(screen.getByRole('button', { name: new RegExp(label) }));
}

/**
 * 左侧栏分类数 = PCL 下载页的六类（原版游戏 + Mod/整合包/数据包/资源包/光影包）
 * **加上**我们自己加的「皮肤」。硬编码是故意的：加/删一类时这条会和
 * `DownloadTab` 的 `CATEGORIES` 对不上，从而提醒去核对那两条原文来源。
 */
const CATEGORY_COUNT = 7;

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  m.launcherListVersions.mockResolvedValue({ versions: [], error: null });
  m.launcherListInstances.mockResolvedValue(INSTANCES);
  m.launcherListWorlds.mockResolvedValue({ worlds: [], error: null });
  m.launcherSearchMods.mockResolvedValue({
    mods: [],
    total: 0,
    page: 0,
    curseForgeConfigured: true,
    error: null,
  });
  m.launcherDownload.mockResolvedValue({ ok: true, error: null });
  m.launcherDownloadServer.mockResolvedValue({ ok: true, error: null });
  m.launcherCreateServerInstance.mockResolvedValue({ ok: true, error: null });
  m.launcherGetModDetail.mockResolvedValue({ detail: null, error: null });
  m.launcherDownloadMod.mockResolvedValue({ path: 'D:\\x\\mods\\a.jar', error: null });
  m.launcherDownloadUrl.mockResolvedValue({ path: 'D:\\x\\mods\\a.jar', error: null });
  m.launcherInstallModpack.mockResolvedValue({
    installed: 0,
    failed: [],
    instanceId: 'x',
    gameDir: 'D:\\x',
    error: null,
  });
  m.launcherCancelModpack.mockResolvedValue({ ok: true, cancelled: true, error: null });
  m.launcherSkinMineskinPage.mockResolvedValue({
    entries: [],
    page: 1,
    hasMore: false,
    error: null,
  });
  m.launcherSkinAddMineskin.mockResolvedValue({ entry: null, error: null });
  m.launcherSkinApply.mockResolvedValue({ ok: true, path: 'D:\\x\\Steve.png', error: null });
  m.launcherSkinAddOfficial.mockResolvedValue({ entry: null, error: null });
  m.launcherModCnAlias.mockResolvedValue({ englishNames: [], aliases: [], error: null });
});

const MINE_SKIN = {
  id: 1370552387,
  uuid: '5d8fcbe0',
  textureUrl: 'https://textures.minecraft.net/texture/708b8d30',
  time: 1778429319,
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

async function renderTab() {
  const utils = render(<DownloadTab />);
  await waitFor(() => {
    expect(m.launcherListVersions).toHaveBeenCalled();
    expect(m.launcherListInstances).toHaveBeenCalled();
  });
  return utils;
}

describe('DownloadTab · 分类切换', () => {
  it('默认停在原版游戏，不发内容搜索请求', async () => {
    await renderTab();
    expect(m.launcherSearchMods).not.toHaveBeenCalled();
  });

  /**
   * 左侧栏结构对齐 PCL（`Pages/PageDownload/PageDownloadLeft.xaml`，2026-10 取的）：
   *
   *   原版游戏 ┃ 「社区资源」标题 ┃ Mod / 整合包 / 数据包 / 资源包 / 光影包
   *
   * 只断言「七项都在」是不够的 —— 原先正是七项平铺、没有那条标题，看起来像
   * 全部同源（而原版游戏走 Mojang 官方清单，其余走 Modrinth / CurseForge）。
   */
  it('左侧栏按 PCL 分「社区资源」组：原版游戏在标题之前，其余都在之后', async () => {
    await renderTab();
    const nav = screen.getByRole('navigation', { name: '内容分类' });
    const text = nav.textContent ?? '';

    // 标题恰好出现一次（PCL 原文里也只有一条 TextBlock）
    expect(text.split('社区资源')).toHaveLength(2);

    const at = (s: string): number => {
      const i = text.indexOf(s);
      expect(i, `侧栏里找不到「${s}」`).toBeGreaterThanOrEqual(0);
      return i;
    };
    const order = ['原版游戏', '社区资源', 'Mod', '整合包', '数据包', '资源包', '光影包', '皮肤'];
    const positions = order.map(at);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));

    /**
     * 图标**两两不同**。
     *
     * 原来是「原版游戏」和「数据包」共用 `Box`，侧栏上两行图标长得一模一样
     * —— 等于那一行没有图标。这条断言按 lucide 渲染出的 path 内容比。
     */
    const icons = Array.from(nav.querySelectorAll('button svg')).map((svg) => svg.innerHTML);
    expect(icons).toHaveLength(CATEGORY_COUNT);
    expect(new Set(icons).size).toBe(CATEGORY_COUNT);
  });

  it('切到 Mod 才发搜索，且 contentType 是 mod', async () => {
    m.launcherSearchMods.mockResolvedValue({
      mods: [mod()],
      total: 1,
      page: 0,
      curseForgeConfigured: true,
      error: null,
    });
    await renderTab();
    gotoCategory('Mod');
    await waitFor(() => {
      expect(m.launcherSearchMods).toHaveBeenCalled();
    });
    expect(m.launcherSearchMods.mock.calls[0]![0]).toMatchObject({ contentType: 'mod' });
  });

  it.each(['整合包', '数据包', '资源包', '光影包'])('切到 %s 传对应 contentType', async (label) => {
    await renderTab();
    gotoCategory(label);
    await waitFor(() => {
      expect(m.launcherSearchMods).toHaveBeenCalled();
    });
    const arg = m.launcherSearchMods.mock.calls[0]![0] as { contentType: string };
    expect(['modpack', 'datapack', 'resourcepack', 'shader']).toContain(arg.contentType);
  });

  /**
   * 加载器筛选器只有「全部 + NeoForge + Fabric」。
   *
   * 这份清单和 `CurseForgeSearchPanel` 的文件筛选、`ModDetailView` 的 loader
   * 角标**是同一件事**，所以必须来自同一处（`shared/play-loaders.ts`）。
   * 这里断言的是**渲染出来的 option 全集**——只断言「有 NeoForge」是不够的，
   * 那样顺手把 Forge 加回来也不会有测试红。
   */
  it('加载器筛选只有 全部 + play-loaders 里那两个', async () => {
    await renderTab();
    gotoCategory('Mod');

    const select = screen.getByLabelText('加载器') as HTMLSelectElement;
    expect([...select.options].map((o) => o.value)).toEqual(['', ...PLAY_LOADER_FILTERS]);
    // 显示的是驼峰名，不是原始小写键
    expect([...select.options].map((o) => o.textContent)).toEqual([
      '全部加载器',
      'NeoForge',
      'Fabric',
    ]);
  });

  it('搜索固定按下载量排序、每页 20 条（与 PCL 一致，且在 Modrinth 限流内）', async () => {
    await renderTab();
    gotoCategory('Mod');
    await waitFor(() => {
      expect(m.launcherSearchMods).toHaveBeenCalled();
    });
    expect(m.launcherSearchMods.mock.calls[0]![0]).toMatchObject({ sort: 'downloads', limit: 20 });
  });

  /**
   * 「类型」下拉必须真的进请求，切了还得重新搜。
   *
   * 这条钉的是一个**死控件**：下拉选了「世界元素」，值只进了 state，
   * 既不在请求里、也不在 `loadMods` 的依赖数组里 —— 用户点了没反应，
   * 而且点完翻页还在用旧词。现在 `category` 会随请求发出去（mixinrc 侧
   * 主进程已透传给 Modrinth 的 facets）。
   */
  it('类型筛选：选了会随请求发出，且换选项会重新搜索', async () => {
    m.launcherSearchMods.mockResolvedValue({
      mods: [mod()],
      total: 1,
      page: 0,
      curseForgeConfigured: true,
      error: null,
    });
    await renderTab();
    gotoCategory('Mod');
    await waitFor(() => expect(m.launcherSearchMods).toHaveBeenCalled());

    fireEvent.change(screen.getByLabelText('类型'), { target: { value: 'worldgen' } });

    await waitFor(() => {
      expect(m.launcherSearchMods).toHaveBeenCalledTimes(2);
    });
    expect(m.launcherSearchMods.mock.calls[1]![0]).toMatchObject({
      category: 'worldgen',
      page: 0,
    });
  });

  it('类型回到「全部」时请求里没有 category', async () => {
    m.launcherSearchMods.mockResolvedValue({
      mods: [mod()],
      total: 1,
      page: 0,
      curseForgeConfigured: true,
      error: null,
    });
    await renderTab();
    gotoCategory('Mod');
    await waitFor(() => expect(m.launcherSearchMods).toHaveBeenCalled());

    fireEvent.change(screen.getByLabelText('类型'), { target: { value: 'worldgen' } });
    await waitFor(() => expect(m.launcherSearchMods).toHaveBeenCalledTimes(2));
    fireEvent.change(screen.getByLabelText('类型'), { target: { value: '' } });
    await waitFor(() => expect(m.launcherSearchMods).toHaveBeenCalledTimes(3));

    const arg = m.launcherSearchMods.mock.calls[2]![0] as Record<string, unknown>;
    expect('category' in arg).toBe(false);
  });

  it('空关键词时标题是「按下载量排序，共 N 个」（浏览），不是「搜索到」', async () => {
    m.launcherSearchMods.mockResolvedValue({
      mods: [mod()],
      total: 1,
      page: 0,
      curseForgeConfigured: true,
      error: null,
    });
    await renderTab();
    gotoCategory('Mod');
    expect(await screen.findByText(/按下载量排序，共 1 个/)).toBeTruthy();
  });

  it('有关键词时标题才说「找到 N 个与「x」相关的结果」', async () => {
    m.launcherSearchMods.mockResolvedValue({
      mods: [mod()],
      total: 42,
      page: 0,
      curseForgeConfigured: true,
      error: null,
    });
    await renderTab();
    gotoCategory('Mod');
    fireEvent.change(screen.getByLabelText('名称'), { target: { value: 'sodium' } });
    fireEvent.click(screen.getByText('搜索'));
    expect(await screen.findByText(/找到 42 个与「sodium」相关的结果/)).toBeTruthy();
  });
});

describe('DownloadTab · 追加式分页', () => {
  it('「加载更多」是追加而不是替换：第一页的项目还在', async () => {
    m.launcherSearchMods
      .mockResolvedValueOnce({
        mods: [mod({ id: 'mr_a', name: 'A' })],
        total: 2,
        page: 0,
        curseForgeConfigured: true,
        error: null,
      })
      .mockResolvedValueOnce({
        mods: [mod({ id: 'mr_b', name: 'B' })],
        total: 2,
        page: 1,
        curseForgeConfigured: true,
        error: null,
      });
    await renderTab();
    gotoCategory('Mod');
    await screen.findByText('A');
    fireEvent.click(screen.getByText('加载更多'));
    expect(await screen.findByText('B')).toBeTruthy();
    // A 必须还在 —— 这是「追加」与「翻页」的唯一区别
    expect(screen.getByText('A')).toBeTruthy();
  });

  it('跨页重复的项目只出现一次（源站排序会变，同一项目可能两页都返回）', async () => {
    m.launcherSearchMods
      .mockResolvedValueOnce({
        mods: [mod({ id: 'mr_a', name: 'A' })],
        total: 2,
        page: 0,
        curseForgeConfigured: true,
        error: null,
      })
      .mockResolvedValueOnce({
        mods: [mod({ id: 'mr_a', name: 'A' })],
        total: 2,
        page: 1,
        curseForgeConfigured: true,
        error: null,
      });
    await renderTab();
    gotoCategory('Mod');
    await screen.findByText('A');
    fireEvent.click(screen.getByText('加载更多'));
    await waitFor(() => {
      expect(m.launcherSearchMods).toHaveBeenCalledTimes(2);
    });
    // 去重后仍只有一条（列表里出现两次 A 会让用户以为装了两个）
    expect(screen.getAllByText('A')).toHaveLength(1);
  });

  it('结果数等于总数时不显示「加载更多」（不给一个按了没反应的按钮）', async () => {
    m.launcherSearchMods.mockResolvedValue({
      mods: [mod()],
      total: 1,
      page: 0,
      curseForgeConfigured: true,
      error: null,
    });
    await renderTab();
    gotoCategory('Mod');
    await screen.findByText('Sodium');
    expect(screen.queryByText('加载更多')).toBeNull();
  });

  it('「加载更多」翻页号递增', async () => {
    m.launcherSearchMods.mockResolvedValue({
      mods: [mod()],
      total: 99,
      page: 0,
      curseForgeConfigured: true,
      error: null,
    });
    await renderTab();
    gotoCategory('Mod');
    await screen.findByText('Sodium');
    fireEvent.click(screen.getByText('加载更多'));
    await waitFor(() => {
      expect(m.launcherSearchMods).toHaveBeenCalledTimes(2);
    });
    expect(m.launcherSearchMods.mock.calls[1]![0]).toMatchObject({ page: 1 });
  });
});

describe('DownloadTab · 部分失败不许废掉另一半', () => {
  it('缺 CurseForge key 但 Modrinth 有结果：error 只作提示条，结果照常显示', async () => {
    m.launcherSearchMods.mockResolvedValue({
      mods: [mod()],
      total: 1,
      page: 0,
      curseForgeConfigured: false,
      error: '未配置 CurseForge key，CurseForge 部分已跳过',
    });
    await renderTab();
    gotoCategory('Mod');
    expect(await screen.findByText('Sodium')).toBeTruthy();
    // 提示条是 role=status（不是红块），红块会把还能用的那一半也一起废掉
    expect(screen.getByRole('status')).toBeTruthy();
    expect(screen.getByText(/CurseForge 部分已跳过/)).toBeTruthy();
  });

  it('提示条可以关掉', async () => {
    m.launcherSearchMods.mockResolvedValue({
      mods: [mod()],
      total: 1,
      page: 0,
      curseForgeConfigured: false,
      error: 'CF 挂了',
    });
    await renderTab();
    gotoCategory('Mod');
    await screen.findByText('CF 挂了');
    fireEvent.click(screen.getByLabelText('关闭提示'));
    await waitFor(() => {
      expect(screen.queryByText('CF 挂了')).toBeNull();
    });
    // 关掉的只是提示条，结果还在
    expect(screen.getByText('Sodium')).toBeTruthy();
  });

  it('两边都失败时才是红块（此时没有结果可救）', async () => {
    m.launcherSearchMods.mockResolvedValue({
      mods: [],
      total: 0,
      page: 0,
      curseForgeConfigured: false,
      error: '两个源都连不上',
    });
    await renderTab();
    gotoCategory('Mod');
    expect(await screen.findByText('两个源都连不上')).toBeTruthy();
  });

  it('搜索抛异常也显示原因，不画成「没有找到结果」', async () => {
    m.launcherSearchMods.mockRejectedValue(new Error('网络断了'));
    await renderTab();
    gotoCategory('Mod');
    expect(await screen.findByText('网络断了')).toBeTruthy();
    expect(screen.queryByText(/没有找到结果/)).toBeNull();
  });
});

describe('DownloadTab · 下载目标（实例 / 世界）', () => {
  beforeEach(() => {
    m.launcherSearchMods.mockResolvedValue({
      mods: [mod()],
      total: 1,
      page: 0,
      curseForgeConfigured: true,
      error: null,
    });
  });

  it('默认选中第一个实例', async () => {
    await renderTab();
    gotoCategory('Mod');
    await screen.findByText('Sodium');
    expect((screen.getByLabelText('安装到') as HTMLSelectElement).value).toBe('我的空岛');
  });

  it('有多个实例时跳过原版，默认选最近在玩的 Fabric/NeoForge 实例', async () => {
    m.launcherListInstances.mockResolvedValue({
      instances: [
        {
          id: '26.3',
          name: '26.3',
          versionId: '26.3',
          loader: 'vanilla',
          clientReady: true,
          lastLaunchedAt: 300,
        },
        {
          id: 'FO',
          name: 'FO',
          versionId: '26.3',
          loader: 'fabric',
          clientReady: true,
          lastLaunchedAt: 200,
        },
      ],
      error: null,
    });
    await renderTab();
    gotoCategory('Mod');
    await screen.findByText('Sodium');
    expect((screen.getByLabelText('安装到') as HTMLSelectElement).value).toBe('FO');
  });

  it('选中原版实例时明确提示 mod 不会生效，并禁用下载', async () => {
    m.launcherListInstances.mockResolvedValue({
      instances: [
        {
          id: '26.3',
          name: '26.3',
          versionId: '26.3',
          loader: 'vanilla',
          clientReady: true,
        },
        {
          id: 'FO',
          name: 'FO',
          versionId: '26.3',
          loader: 'fabric',
          clientReady: true,
        },
      ],
      error: null,
    });
    await renderTab();
    gotoCategory('Mod');
    await screen.findByText('Sodium');

    fireEvent.change(screen.getByLabelText('安装到'), { target: { value: '26.3' } });

    expect(await screen.findByText(/原版（vanilla）/)).toBeTruthy();
    expect((screen.getByLabelText('下载 Sodium') as HTMLButtonElement).disabled).toBe(true);
  });

  it('版本筛选可手动输入 26.3，并带进搜索请求', async () => {
    await renderTab();
    gotoCategory('Mod');
    await screen.findByText('Sodium');

    fireEvent.change(screen.getByLabelText('版本'), { target: { value: '26.3' } });
    fireEvent.click(screen.getByRole('button', { name: '搜索' }));

    await waitFor(() =>
      expect(m.launcherSearchMods).toHaveBeenLastCalledWith(
        expect.objectContaining({ gameVersion: '26.3' }),
      ),
    );
  });

  it('没有实例时禁用下载并说明原因', async () => {
    m.launcherListInstances.mockResolvedValue({ instances: [], error: null });
    await renderTab();
    gotoCategory('Mod');
    await screen.findByText('Sodium');
    const btn = screen.getByLabelText('下载 Sodium');
    expect((btn as HTMLButtonElement).disabled).toBe(true);
    expect(btn.getAttribute('title')).toContain('还没有可安装的实例');
  });

  it('选中的实例被删了 → 回落到第一个（留着失效 id 会让每次下载都炸）', async () => {
    m.launcherListInstances
      .mockResolvedValueOnce({
        instances: [
          {
            id: '旧实例',
            name: '旧实例',
            versionId: '1.21.1',
            loader: 'fabric',
            clientReady: true,
          },
        ],
        error: null,
      })
      .mockResolvedValue(INSTANCES);
    await renderTab();
    gotoCategory('Mod');
    const sel = (await screen.findByLabelText('安装到')) as HTMLSelectElement;
    expect(sel.value).toBe('旧实例');

    // 刷新实例列表（页面上有这个按钮）—— 旧实例已不存在时应回落到第一个，
    // 而不是继续拿着失效 id 去下载（那会每次都在主进程炸）
    fireEvent.click(screen.getByLabelText('刷新实例列表'));
    await waitFor(() => {
      expect((screen.getByLabelText('安装到') as HTMLSelectElement).value).toBe('我的空岛');
    });
  });

  it('数据包必须先选世界，没世界时禁用下载并说明原因', async () => {
    m.launcherListWorlds.mockResolvedValue({ worlds: [], error: null });
    await renderTab();
    gotoCategory('数据包');
    await waitFor(() => {
      expect(m.launcherListWorlds).toHaveBeenCalled();
    });
    const btn = await screen.findByLabelText('下载 Sodium');
    expect((btn as HTMLButtonElement).disabled).toBe(true);
    expect(btn.getAttribute('title')).toContain('数据包必须先选一个世界');
  });

  it('非数据包分类不拉世界列表（读 level.dat 不是免费的）', async () => {
    await renderTab();
    gotoCategory('Mod');
    await screen.findByText('Sodium');
    expect(m.launcherListWorlds).not.toHaveBeenCalled();
  });

  it('数据包下载带上 world 参数', async () => {
    m.launcherListWorlds.mockResolvedValue({
      worlds: [{ dirName: 'world1', name: '新世界', lastPlayed: 1, sizeBytes: 1, version: '1.21' }],
      error: null,
    });
    m.launcherDownloadMod.mockResolvedValue({
      path: 'D:\\x\\world1\\datapacks\\p.zip',
      error: null,
    });
    // 没有 downloadUrl → 走 launcherDownloadMod（带 world 的那条路）
    m.launcherSearchMods.mockResolvedValue({
      mods: [mod({ downloadUrl: undefined })],
      total: 1,
      page: 0,
      curseForgeConfigured: true,
      error: null,
    });
    await renderTab();
    gotoCategory('数据包');
    await waitFor(() => {
      expect(m.launcherListWorlds).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect((screen.getByLabelText('装进世界') as HTMLSelectElement).value).toBe('world1');
    });
    fireEvent.click(screen.getByLabelText('下载 Sodium'));
    await waitFor(() => {
      expect(m.launcherDownloadMod).toHaveBeenCalled();
    });
    expect(m.launcherDownloadMod.mock.calls[0]![0]).toMatchObject({
      contentKind: 'datapack',
      world: 'world1',
    });
  });

  it('非数据包分类不带 world 参数', async () => {
    // 没有 downloadUrl → 走 launcherDownloadMod
    m.launcherSearchMods.mockResolvedValue({
      mods: [mod({ downloadUrl: undefined })],
      total: 1,
      page: 0,
      curseForgeConfigured: true,
      error: null,
    });
    m.launcherDownloadMod.mockResolvedValue({ path: 'D:\\x\\mods\\sodium.jar', error: null });
    await renderTab();
    gotoCategory('Mod');
    await screen.findByText('Sodium');
    fireEvent.click(screen.getByLabelText('下载 Sodium'));
    await waitFor(() => {
      expect(m.launcherDownloadMod).toHaveBeenCalled();
    });
    const arg = m.launcherDownloadMod.mock.calls[0]![0] as Record<string, unknown>;
    expect(arg.contentKind).toBe('mod');
    expect('world' in arg).toBe(false);
  });
});

describe('DownloadTab · 下载结果要如实说', () => {
  beforeEach(() => {
    m.launcherSearchMods.mockResolvedValue({
      mods: [mod()],
      total: 1,
      page: 0,
      curseForgeConfigured: true,
      error: null,
    });
  });

  it('有 downloadUrl 时走 URL 直下（别绕道 modId 解析最新版，那会下错版本）', async () => {
    m.launcherDownloadUrl.mockResolvedValue({ path: 'D:\\x\\mods\\sodium.jar', error: null });
    await renderTab();
    gotoCategory('Mod');
    await screen.findByText('Sodium');
    fireEvent.click(screen.getByLabelText('下载 Sodium'));
    await waitFor(() => {
      expect(m.launcherDownloadUrl).toHaveBeenCalled();
    });
    expect(m.launcherDownloadMod).not.toHaveBeenCalled();
  });

  /**
   * 回归：URL 通道**必须**带 modId。
   *
   * 搜索结果里已经填好 `downloadUrl`，所以列表行的下载按钮几乎总是走这条
   * URL 通道。而主进程要靠 modId 把 URL 定位回版本对象才能递归 required
   * 前置 —— 不带就是「下载 Sodium 不带 Fabric API」，装进实例起不来，
   * 而界面一声不吭（依赖下载能力对真实流程而言等于死代码）。
   */
  it('URL 通道也要带 modId，否则主进程没法解析前置', async () => {
    m.launcherDownloadUrl.mockResolvedValue({ path: 'D:\\x\\mods\\sodium.jar', error: null });
    await renderTab();
    gotoCategory('Mod');
    await screen.findByText('Sodium');
    fireEvent.click(screen.getByLabelText('下载 Sodium'));
    await waitFor(() => {
      expect(m.launcherDownloadUrl).toHaveBeenCalled();
    });
    expect(m.launcherDownloadUrl.mock.calls[0]![0]).toMatchObject({ modId: 'mr_sodium' });
  });

  it('URL 通道报回没装上的前置时要说出来', async () => {
    m.launcherDownloadUrl.mockResolvedValue({
      path: 'D:\\x\\mods\\sodium.jar',
      error: null,
      missingDependencies: ['fabric-api'],
    });
    await renderTab();
    gotoCategory('Mod');
    await screen.findByText('Sodium');
    fireEvent.click(screen.getByLabelText('下载 Sodium'));
    expect(await screen.findByText(/前置没有一起装上：fabric-api/)).toBeTruthy();
  });

  it('没有 downloadUrl 时退回按 modId 解析', async () => {
    m.launcherSearchMods.mockResolvedValue({
      mods: [mod({ downloadUrl: undefined })],
      total: 1,
      page: 0,
      curseForgeConfigured: true,
      error: null,
    });
    m.launcherDownloadMod.mockResolvedValue({ path: 'D:\\x\\mods\\sodium.jar', error: null });
    await renderTab();
    gotoCategory('Mod');
    await screen.findByText('Sodium');
    fireEvent.click(screen.getByLabelText('下载 Sodium'));
    await waitFor(() => {
      expect(m.launcherDownloadMod).toHaveBeenCalledWith(
        expect.objectContaining({ modId: 'mr_sodium', targetInstance: '我的空岛' }),
      );
    });
    expect(m.launcherDownloadUrl).not.toHaveBeenCalled();
  });

  it('前置没补齐要明说（少一个 Fabric API 就启动崩，静默成功最坑）', async () => {
    // 走按 modId 解析那条路（没有 downloadUrl）—— 只有它会解析依赖
    m.launcherSearchMods.mockResolvedValue({
      mods: [mod({ downloadUrl: undefined })],
      total: 1,
      page: 0,
      curseForgeConfigured: true,
      error: null,
    });
    m.launcherDownloadMod.mockResolvedValue({
      path: 'D:\\x\\mods\\sodium.jar',
      error: null,
      missingDependencies: ['fabric-api'],
    });
    await renderTab();
    gotoCategory('Mod');
    await screen.findByText('Sodium');
    fireEvent.click(screen.getByLabelText('下载 Sodium'));
    expect(await screen.findByText(/还有前置没补上：fabric-api/)).toBeTruthy();
  });

  it('下载失败显示原因', async () => {
    m.launcherDownloadUrl.mockResolvedValue({ path: null, error: 'HTTP 403' });
    await renderTab();
    gotoCategory('Mod');
    await screen.findByText('Sodium');
    fireEvent.click(screen.getByLabelText('下载 Sodium'));
    expect(await screen.findByText('HTTP 403')).toBeTruthy();
  });
});

describe('DownloadTab · 详情页往返', () => {
  it('点结果进详情，从详情能回到列表', async () => {
    m.launcherSearchMods.mockResolvedValue({
      mods: [mod()],
      // total 要大于已加载数，否则「加载更多」按设计就不渲染（下面用它当路标）
      total: 99,
      page: 0,
      curseForgeConfigured: true,
      error: null,
    });
    await renderTab();
    gotoCategory('Mod');
    fireEvent.click(await screen.findByLabelText('查看 Sodium 的详情'));
    // 详情页里不该再有结果列表的「加载更多」
    expect(screen.queryByText('加载更多')).toBeNull();
    fireEvent.click(screen.getByLabelText('返回搜索结果'));
    expect(await screen.findByText('加载更多')).toBeTruthy();
  });

  /**
   * 回归：详情页的**加载中 / 出错**两条分支原本都不渲染返回键。
   *
   * 后果是用户被**困住**：结果列表被整块替换掉了，页面上除了「重试」什么都没剩。
   * 而出错恰恰发生在网络最差的时候 —— 最需要退出去挑别的项目的时候反而退不出去。
   * 加载中那条更糟：慢网下点进详情就再也点不回列表。
   */
  it('详情加载失败时仍然能返回搜索结果（不许把用户困住）', async () => {
    m.launcherSearchMods.mockResolvedValue({
      mods: [mod()],
      total: 99,
      page: 0,
      curseForgeConfigured: true,
      error: null,
    });
    m.launcherGetModDetail.mockResolvedValue({ detail: null, error: '源站 503' });
    await renderTab();
    gotoCategory('Mod');
    fireEvent.click(await screen.findByLabelText('查看 Sodium 的详情'));
    expect(await screen.findByText('源站 503')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('返回搜索结果'));
    expect(await screen.findByText('加载更多')).toBeTruthy();
  });

  it('详情还在加载时也能返回（慢网下不至于卡死在详情页）', async () => {
    m.launcherSearchMods.mockResolvedValue({
      mods: [mod()],
      total: 99,
      page: 0,
      curseForgeConfigured: true,
      error: null,
    });
    // 永不 resolve，模拟慢响应
    m.launcherGetModDetail.mockReturnValue(new Promise(() => undefined));
    await renderTab();
    gotoCategory('Mod');
    fireEvent.click(await screen.findByLabelText('查看 Sodium 的详情'));
    expect(await screen.findByText('加载详情…')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('返回搜索结果'));
    expect(await screen.findByText('加载更多')).toBeTruthy();
  });
});

/**
 * 皮肤分类。
 *
 * 实测约束（2026-10）：Modrinth 的 `project_type` 里**没有 skin**，CurseForge
 * 我们映射的 classId 里也没有；能用的只有 MineSkin，而它的条目只有
 * `id/uuid/textureUrl/time` —— 无名字、无作者，也没有任何按名字查的接口
 * （MineSkin/LittleSkin 的 `/api/player/{name}` 都是 404）。
 *
 * 所以这一类**只能是浏览**，界面上必须照实说，不能留一个永远返回全量的
 * 搜索框 —— 那比没有搜索框更让人以为是自己搜错了。
 */
describe('DownloadTab · 切分类', () => {
  /**
   * 回归：这三件事以前都漏了，症状分别是「结果点不切换」「页码不归零」
   * 「详情页不换内容」。
   *
   * 尤其第一条：`onClick` 原来只 `setActiveCategory`，旧分类的结果会一直挂在
   * 屏幕上直到新数据回来 —— 用户看到的就是「点了 Mod 要等一会才切换」。
   */
  it('切分类立刻清空旧结果（不等新数据回来才"突然"变成新分类）', async () => {
    m.launcherSearchMods.mockResolvedValue({
      mods: [mod({ id: 'mr_a', name: '甲分类的结果' })],
      total: 99,
      page: 0,
      curseForgeConfigured: true,
      error: null,
    });
    await renderTab();
    gotoCategory('Mod');
    expect(await screen.findByText('甲分类的结果')).toBeTruthy();

    m.launcherSearchMods.mockResolvedValue({
      mods: [mod({ id: 'mr_b', name: '乙分类的结果' })],
      total: 99,
      page: 0,
      curseForgeConfigured: true,
      error: null,
    });
    gotoCategory('整合包');
    // 旧结果必须在切换这一刻就消失，而不是留在屏幕上
    expect(screen.queryByText('甲分类的结果')).toBeNull();
    expect(await screen.findByText('乙分类的结果')).toBeTruthy();
  });

  it('翻过页再切分类，页码归零（否则去要新分类的第 N 页）', async () => {
    m.launcherSearchMods.mockResolvedValue({
      mods: [mod()],
      total: 999,
      page: 0,
      curseForgeConfigured: true,
      error: null,
    });
    await renderTab();
    gotoCategory('Mod');
    await screen.findByText('Sodium');
    // 翻一页（不能连着点两次：第二次会撞上 modLoading=true 按钮禁用，
    // 那是产品的正确行为，不是 bug）
    fireEvent.click(screen.getByText('加载更多'));
    await waitFor(() => {
      expect(m.launcherSearchMods).toHaveBeenCalledTimes(2);
    });
    expect(m.launcherSearchMods.mock.calls[1]![0]).toMatchObject({ page: 1 });

    await waitFor(() => {
      expect((screen.getByText('加载更多') as HTMLButtonElement).disabled).toBe(false);
    });
    gotoCategory('整合包');
    await waitFor(() => {
      expect(m.launcherSearchMods).toHaveBeenCalledTimes(3);
    });
    // 新分类必须从第 0 页开始，而不是接着翻过的页码
    expect(m.launcherSearchMods.mock.calls[2]![0]).toMatchObject({ page: 0 });
  });

  it('详情页打开时切分类，详情要关掉（否则显示的还是旧分类的内容）', async () => {
    m.launcherSearchMods.mockResolvedValue({
      mods: [mod()],
      total: 99,
      page: 0,
      curseForgeConfigured: true,
      error: null,
    });
    await renderTab();
    gotoCategory('Mod');
    fireEvent.click(await screen.findByLabelText('查看 Sodium 的详情'));
    expect(await screen.findByLabelText('返回搜索结果')).toBeTruthy();

    gotoCategory('整合包');
    // 详情必须消失，回到列表
    expect(screen.queryByLabelText('返回搜索结果')).toBeNull();
  });

  it('切到皮肤时清掉 mod 的详情', async () => {
    m.launcherSearchMods.mockResolvedValue({
      mods: [mod()],
      total: 99,
      page: 0,
      curseForgeConfigured: true,
      error: null,
    });
    await renderTab();
    gotoCategory('Mod');
    fireEvent.click(await screen.findByLabelText('查看 Sodium 的详情'));
    expect(await screen.findByLabelText('返回搜索结果')).toBeTruthy();

    gotoCategory('皮肤');
    expect(screen.queryByLabelText('返回搜索结果')).toBeNull();
  });
});

describe('DownloadTab · 搜索结果里带中文名（MC百科 别名）', () => {
  beforeEach(() => {
    m.launcherSearchMods.mockResolvedValue({
      mods: [mod()],
      total: 1,
      page: 0,
      curseForgeConfigured: true,
      error: null,
    });
  });

  it('搜中文词时先查别名，再把英文名发给 Modrinth', async () => {
    m.launcherModCnAlias.mockResolvedValue({
      englishNames: ['Sodium'],
      aliases: [
        { mcmodId: '2785', cnName: '钠', enName: 'Sodium', summary: '大大提高性能的渲染引擎' },
      ],
      error: null,
    });
    await renderTab();
    gotoCategory('Mod');
    fireEvent.change(await screen.findByLabelText('名称'), { target: { value: '钠' } });
    fireEvent.click(screen.getByText('搜索'));
    await waitFor(() => {
      expect(m.launcherModCnAlias).toHaveBeenCalledWith({ key: '钠' });
    });
    await waitFor(() => {
      expect(m.launcherSearchMods).toHaveBeenCalledWith(
        expect.objectContaining({ query: 'Sodium' }),
      );
    });
  });

  it('提示「钠 → Sodium」（否则结果点进去是英文，用户以为搜错了）', async () => {
    m.launcherModCnAlias.mockResolvedValue({
      englishNames: ['Sodium'],
      aliases: [{ mcmodId: '2785', cnName: '钠', enName: 'Sodium', summary: '' }],
      error: null,
    });
    await renderTab();
    gotoCategory('Mod');
    fireEvent.change(await screen.findByLabelText('名称'), { target: { value: '钠' } });
    fireEvent.click(screen.getByText('搜索'));
    expect(await screen.findByText(/「钠」→ Sodium/)).toBeTruthy();
  });

  it('纯英文词不查别名（MC百科 限流很凶，白查是浪费）', async () => {
    await renderTab();
    gotoCategory('Mod');
    fireEvent.change(await screen.findByLabelText('名称'), { target: { value: 'sodium' } });
    fireEvent.click(screen.getByText('搜索'));
    await waitFor(() => {
      expect(m.launcherSearchMods).toHaveBeenCalled();
    });
    expect(m.launcherModCnAlias).not.toHaveBeenCalled();
  });

  it('别名查不到也用原词照常搜（不该整个搜索失败）', async () => {
    m.launcherModCnAlias.mockResolvedValue({ englishNames: [], aliases: [], error: null });
    await renderTab();
    gotoCategory('Mod');
    fireEvent.change(await screen.findByLabelText('名称'), { target: { value: '某个生僻中文词' } });
    fireEvent.click(screen.getByText('搜索'));
    await waitFor(() => {
      expect(m.launcherSearchMods).toHaveBeenCalledWith(
        expect.objectContaining({ query: '某个生僻中文词' }),
      );
    });
  });

  it('别名接口报错也不打断搜索', async () => {
    m.launcherModCnAlias.mockResolvedValue({
      englishNames: [],
      aliases: [],
      error: 'MC百科 触发了限流（HTTP 429）',
    });
    await renderTab();
    gotoCategory('Mod');
    fireEvent.change(await screen.findByLabelText('名称'), { target: { value: '钠' } });
    fireEvent.click(screen.getByText('搜索'));
    await waitFor(() => {
      expect(m.launcherSearchMods).toHaveBeenCalledWith(expect.objectContaining({ query: '钠' }));
    });
  });
});

describe('DownloadTab · 原版下载要先给实例起名', () => {
  /**
   * 实例名**同时是磁盘目录名**（`game/<名字>/`）。`shared/instance-name.ts`
   * 的文件头写明了设计意图「下载原版时弹框让用户起名，输入非法字符立刻红字提示」，
   * 主进程的 `LauncherDownloadRequest.instanceName` 也一直支持 ——
   * 但渲染层此前直接 `launcherDownload({ version })`，实例名就默认成了版本号。
   */
  const ONE_RELEASE = {
    versions: [{ id: '1.21.1', type: 'release', releaseTime: '2024-08-08T00:00:00+00:00' }],
    error: null,
  };

  /**
   * 点开某个版本的下载按钮。
   *
   * 列表要等 mock 的版本清单落进 state 才渲染；默认停在「最新版本」卡片上，
   * 它的 aria-label 是「下载最新版本 <id>」（普通版本行是「下载 <id>」，
   * 但分组默认折叠）。两个按钮走的是同一个 `doDownload`。
   */
  async function clickDownload(version: string) {
    fireEvent.click(await screen.findByRole('button', { name: `下载最新版本 ${version}` }));
    return await screen.findByRole('textbox');
  }

  it('点下载不直接发请求，先弹起名框（默认值 = 版本号）', async () => {
    m.launcherListVersions.mockResolvedValue(ONE_RELEASE);
    await renderTab();

    const input = await clickDownload('1.21.1');

    expect(m.launcherDownload).not.toHaveBeenCalled();
    expect(input).toHaveValue('1.21.1');
  });

  it('确认后把用户起的名字作为 instanceName 传下去', async () => {
    m.launcherListVersions.mockResolvedValue(ONE_RELEASE);
    await renderTab();

    const input = await clickDownload('1.21.1');
    fireEvent.change(input, { target: { value: '我的世界' } });
    fireEvent.click(screen.getByRole('button', { name: '开始下载' }));

    await waitFor(() => expect(m.launcherDownload).toHaveBeenCalledTimes(1));
    expect(m.launcherDownload).toHaveBeenCalledWith({
      version: '1.21.1',
      instanceName: '我的世界',
    });
  });

  it('取消不发请求', async () => {
    m.launcherListVersions.mockResolvedValue(ONE_RELEASE);
    await renderTab();

    await clickDownload('1.21.1');
    fireEvent.click(screen.getByRole('button', { name: '取消' }));

    expect(m.launcherDownload).not.toHaveBeenCalled();
  });

  it('非法名字（含斜杠）拦住确认 —— 不自动替换成下划线', async () => {
    m.launcherListVersions.mockResolvedValue(ONE_RELEASE);
    await renderTab();

    const input = await clickDownload('1.21.1');
    fireEvent.change(input, { target: { value: '我的/世界' } });

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '开始下载' })).toBeDisabled();
  });

  it('撞上别的 MC 版本的已有实例名 → 拦住（否则会把那个实例改成这个版本）', async () => {
    // INSTANCES 里有「我的空岛 @ 1.21.1」；这里下载 1.20.1
    m.launcherListVersions.mockResolvedValue({
      versions: [{ id: '1.20.1', type: 'release', releaseTime: '2023-06-12T00:00:00+00:00' }],
      error: null,
    });
    await renderTab();

    const input = await clickDownload('1.20.1');
    fireEvent.change(input, { target: { value: '我的空岛' } });

    expect(screen.getByRole('alert').textContent).toContain('我的空岛');
    expect(screen.getByRole('button', { name: '开始下载' })).toBeDisabled();
    expect(m.launcherDownload).not.toHaveBeenCalled();
  });
});

describe('DownloadTab · 皮肤分类', () => {
  it('切到皮肤走 MineSkin 通道，不发 Modrinth/CF 搜索', async () => {
    m.launcherSkinMineskinPage.mockResolvedValue({
      entries: [MINE_SKIN],
      page: 1,
      hasMore: true,
      error: null,
    });
    await renderTab();
    gotoCategory('皮肤');
    await waitFor(() => {
      expect(m.launcherSkinMineskinPage).toHaveBeenCalledWith({ page: 1 });
    });
    // 关键：不能去搜 Modrinth —— 那边根本没有皮肤这个类型
    expect(m.launcherSearchMods).not.toHaveBeenCalled();
  });

  it('把「不能搜」的原因说清楚，而不是留一个空的搜索框', async () => {
    await renderTab();
    gotoCategory('皮肤');
    expect(await screen.findByText(/皮肤站不提供按名字搜索/)).toBeTruthy();
    // 搜索框在皮肤分类下不该出现
    expect(screen.queryByLabelText('名称')).toBeNull();
  });

  it('渲染 MineSkin 条目（只有编号，源站没有名字）', async () => {
    m.launcherSkinMineskinPage.mockResolvedValue({
      entries: [MINE_SKIN],
      page: 1,
      hasMore: false,
      error: null,
    });
    await renderTab();
    gotoCategory('皮肤');
    expect(await screen.findByText('#1370552387')).toBeTruthy();
  });

  /**
   * 回归：缩略图不能用整张贴图缩略。
   *
   * 皮肤贴图左上角 `(0,0)-(8,8)` 是全透明的帽子层，整张缩略出来就是一堆噪声，
   * 用户根本挑不出皮肤 —— 这正是修复前截图里看到的现象。
   */
  it('缩略图用正面小人（canvas），不是整张贴图缩略', async () => {
    m.launcherSkinMineskinPage.mockResolvedValue({
      entries: [MINE_SKIN],
      page: 1,
      hasMore: false,
      error: null,
    });
    await renderTab();
    gotoCategory('皮肤');
    const preview = await screen.findByRole('img', {
      name: /MineSkin #1370552387 的正面预览/,
    });
    // 用的是 canvas（正面合成），不是 <img src=贴图>
    expect(preview.tagName.toLowerCase()).toBe('canvas');
    expect(screen.queryByAltText('MineSkin #1370552387')).toBeNull();
  });

  it('MineSkin 连不上时显示原因，不画成「没有内容」', async () => {
    m.launcherSkinMineskinPage.mockResolvedValue({
      entries: [],
      page: 1,
      hasMore: false,
      error: '连不上 MineSkin',
    });
    await renderTab();
    gotoCategory('皮肤');
    expect(await screen.findByText('连不上 MineSkin')).toBeTruthy();
    expect(screen.queryByText('这一页没有内容。')).toBeNull();
  });

  it('第一页时上一页禁用', async () => {
    m.launcherSkinMineskinPage.mockResolvedValue({
      entries: [MINE_SKIN],
      page: 1,
      hasMore: true,
      error: null,
    });
    await renderTab();
    gotoCategory('皮肤');
    await screen.findByText('#1370552387');
    expect((screen.getByText('上一页') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByText('下一页') as HTMLButtonElement).disabled).toBe(false);
  });

  it('「导入」= 存进皮肤库，并说明还要玩家名才生效', async () => {
    m.launcherSkinMineskinPage.mockResolvedValue({
      entries: [MINE_SKIN],
      page: 1,
      hasMore: false,
      error: null,
    });
    m.launcherSkinAddMineskin.mockResolvedValue({
      entry: { ...mod(), id: 's1', name: 'MineSkin 皮肤' },
      error: null,
    });
    await renderTab();
    gotoCategory('皮肤');
    fireEvent.click(await screen.findByLabelText('导入皮肤 #1370552387'));
    await waitFor(() => {
      expect(m.launcherSkinAddMineskin).toHaveBeenCalledWith({ mineskinId: 1370552387 });
    });
    // 皮肤按玩家名索引 —— 存进库不等于生效，必须说清楚
    expect(await screen.findByText(/填好玩家名后点「导入并应用」才能在游戏里显示/)).toBeTruthy();
    expect(m.launcherSkinApply).not.toHaveBeenCalled();
  });

  it('「导入并应用」同时落库 + 应用到该玩家名', async () => {
    m.launcherSkinMineskinPage.mockResolvedValue({
      entries: [MINE_SKIN],
      page: 1,
      hasMore: false,
      error: null,
    });
    m.launcherSkinAddMineskin.mockResolvedValue({
      entry: { ...mod(), id: 's1', name: 'MineSkin 皮肤' },
      error: null,
    });
    await renderTab();
    gotoCategory('皮肤');
    fireEvent.change(await screen.findByLabelText('应用到玩家'), { target: { value: 'Steve' } });
    fireEvent.click(await screen.findByLabelText('导入并应用皮肤 #1370552387'));
    await waitFor(() => {
      expect(m.launcherSkinApply).toHaveBeenCalledWith({
        skinId: 's1',
        instance: '我的空岛',
        playerName: 'Steve',
      });
    });
    expect(await screen.findByText(/已存进皮肤库并应用到玩家「Steve」/)).toBeTruthy();
  });

  it('玩家名没填时禁用「导入并应用」（皮肤按玩家名索引，不能猜）', async () => {
    m.launcherSkinMineskinPage.mockResolvedValue({
      entries: [MINE_SKIN],
      page: 1,
      hasMore: false,
      error: null,
    });
    await renderTab();
    gotoCategory('皮肤');
    const btn = await screen.findByLabelText('导入并应用皮肤 #1370552387');
    expect((btn as HTMLButtonElement).disabled).toBe(true);
  });

  it('玩家名含路径穿越时禁用「导入并应用」', async () => {
    m.launcherSkinMineskinPage.mockResolvedValue({
      entries: [MINE_SKIN],
      page: 1,
      hasMore: false,
      error: null,
    });
    await renderTab();
    gotoCategory('皮肤');
    fireEvent.change(await screen.findByLabelText('应用到玩家'), {
      target: { value: '../escape' },
    });
    expect(
      (await screen.findByLabelText('导入并应用皮肤 #1370552387')) as HTMLButtonElement,
    ).toHaveProperty('disabled', true);
  });

  it('没有实例时禁用「导入并应用」并说明原因', async () => {
    m.launcherListInstances.mockResolvedValue({ instances: [], error: null });
    m.launcherSkinMineskinPage.mockResolvedValue({
      entries: [MINE_SKIN],
      page: 1,
      hasMore: false,
      error: null,
    });
    await renderTab();
    gotoCategory('皮肤');
    fireEvent.change(await screen.findByLabelText('应用到玩家'), { target: { value: 'Steve' } });
    const btn = await screen.findByLabelText('导入并应用皮肤 #1370552387');
    expect((btn as HTMLButtonElement).disabled).toBe(true);
    expect(btn.getAttribute('title')).toContain('请先选择一个实例');
  });

  it('库里有但应用失败时，两件事分开报（不谎报成导入失败）', async () => {
    m.launcherSkinMineskinPage.mockResolvedValue({
      entries: [MINE_SKIN],
      page: 1,
      hasMore: false,
      error: null,
    });
    m.launcherSkinAddMineskin.mockResolvedValue({
      entry: { ...mod(), id: 's1', name: 'MineSkin 皮肤' },
      error: null,
    });
    m.launcherSkinApply.mockResolvedValue({ ok: false, error: '实例不存在: 我的空岛' });
    await renderTab();
    gotoCategory('皮肤');
    fireEvent.change(await screen.findByLabelText('应用到玩家'), { target: { value: 'Steve' } });
    fireEvent.click(await screen.findByLabelText('导入并应用皮肤 #1370552387'));
    expect(
      await screen.findByText(/已存进皮肤库，但应用到玩家「Steve」失败：实例不存在/),
    ).toBeTruthy();
  });
});

/**
 * 皮肤详情：点行打开，能放大看、能转 3D、能回去。
 *
 * 与 mod 侧点行进详情一致。源站条目只有编号，不放大根本不知道自己在挑谁，
 * 所以详情页给的是列表给不了的三样：可旋转 3D（模型自动判）、完整贴图、
 * 编号/uuid/直链。
 */
describe('DownloadTab · 皮肤详情', () => {
  async function gotoSkinList() {
    m.launcherSkinMineskinPage.mockResolvedValue({
      entries: [MINE_SKIN],
      page: 1,
      hasMore: false,
      error: null,
    });
    await renderTab();
    gotoCategory('皮肤');
    await screen.findByText('#1370552387');
  }

  it('点条目进详情，展示 3D 与完整贴图', async () => {
    await gotoSkinList();
    fireEvent.click(screen.getByLabelText('查看皮肤 #1370552387 的详情'));
    expect(await screen.findByText('皮肤 #1370552387')).toBeTruthy();
    // 完整贴图原图（列表里只给 8×32 的正面合成，看不到背面）
    expect(screen.getByAltText('皮肤 #1370552387 的完整贴图')).toBeTruthy();
    // 列表已被详情替换 —— 按列表专属的按钮判断（详情里也会显示编号，
    // 所以不能拿「#1370552387 这个文本消失」当证据）
    expect(screen.queryByLabelText('导入皮肤 #1370552387')).toBeNull();
  });

  it('详情里说明「模型自动识别」（列表的 2D 合成按 classic 取，slim 会多一列杂色）', async () => {
    await gotoSkinList();
    fireEvent.click(screen.getByLabelText('查看皮肤 #1370552387 的详情'));
    expect(await screen.findByText('可拖动旋转 · 模型自动识别')).toBeTruthy();
  });

  it('详情里仍然说清「没有名字」，不编一个', async () => {
    await gotoSkinList();
    fireEvent.click(screen.getByLabelText('查看皮肤 #1370552387 的详情'));
    expect(await screen.findByText(/只给编号，没有名字和作者/)).toBeTruthy();
  });

  it('能从详情返回列表', async () => {
    await gotoSkinList();
    fireEvent.click(screen.getByLabelText('查看皮肤 #1370552387 的详情'));
    fireEvent.click(await screen.findByLabelText('返回皮肤列表'));
    expect(await screen.findByText('#1370552387')).toBeTruthy();
  });

  /** 行可点、按钮也在行里 —— 不阻断冒泡就会「导入」顺带把详情也打开。 */
  it('点行内按钮不会顺带打开详情', async () => {
    await gotoSkinList();
    m.launcherSkinAddMineskin.mockResolvedValue({
      entry: { ...mod(), id: 's1', name: 'x' },
      error: null,
    });
    fireEvent.click(screen.getByLabelText('导入皮肤 #1370552387'));
    await waitFor(() => {
      expect(m.launcherSkinAddMineskin).toHaveBeenCalled();
    });
    // 详情没被顺带打开（列表按钮仍在）
    expect(screen.queryByAltText('皮肤 #1370552387 的完整贴图')).toBeNull();
    expect(screen.getByText('#1370552387')).toBeTruthy();
  });

  it('详情里也能直接导入并应用', async () => {
    await gotoSkinList();
    m.launcherSkinAddMineskin.mockResolvedValue({
      entry: { ...mod(), id: 's1', name: 'x' },
      error: null,
    });
    fireEvent.click(screen.getByLabelText('查看皮肤 #1370552387 的详情'));
    fireEvent.change(await screen.findByLabelText('应用到玩家'), { target: { value: 'Steve' } });
    fireEvent.click(await screen.findByText('导入并应用'));
    await waitFor(() => {
      expect(m.launcherSkinApply).toHaveBeenCalledWith({
        skinId: 's1',
        instance: '我的空岛',
        playerName: 'Steve',
      });
    });
  });
});

/**
 * 按 UUID 导正版皮肤。
 *
 * 这是目前**唯一**能拿到「某个具体的人」皮肤的路子 —— MineSkin 只有匿名浏览。
 * 两端都要盯：
 * - 输入框只收 UUID，标题里就得说明「不能填玩家名」（说了别人才不会去试）
 * - 成功时把 Mojang 返回的**玩家名**念出来，否则用户没法确认找对了人
 */
describe('DownloadTab · 按 UUID 导正版皮肤', () => {
  const UUID = '069a79f444e94726a5befca90e38aaf5';

  beforeEach(() => {
    m.launcherSkinMineskinPage.mockResolvedValue({
      entries: [],
      page: 1,
      hasMore: false,
      error: null,
    });
  });

  it('输入框标题说明不能填玩家名（说了别人才不会去试）', async () => {
    await renderTab();
    gotoCategory('皮肤');
    const input = await screen.findByLabelText('正版 UUID');
    expect(input.getAttribute('title')).toMatch(/不能填玩家名/);
  });

  it('成功时把 Mojang 返回的玩家名念出来（否则没法确认找对了人）', async () => {
    m.launcherSkinAddOfficial.mockResolvedValue({
      entry: { ...mod(), id: 'so', name: 'Notch 的正版皮肤' },
      playerName: 'Notch',
      hasCape: false,
      error: null,
    });
    await renderTab();
    gotoCategory('皮肤');
    fireEvent.change(await screen.findByLabelText('正版 UUID'), { target: { value: UUID } });
    fireEvent.click(screen.getByText('导入正版皮肤'));
    await waitFor(() => {
      expect(m.launcherSkinAddOfficial).toHaveBeenCalledWith({ uuid: UUID });
    });
    expect(await screen.findByText(/已导入 Notch 的正版皮肤并存进皮肤库/)).toBeTruthy();
  });

  it('有披风时要说明「只导了皮肤」（别让人以为看到了全部）', async () => {
    m.launcherSkinAddOfficial.mockResolvedValue({
      entry: { ...mod(), id: 'so', name: 'x' },
      playerName: 'Notch',
      hasCape: true,
      error: null,
    });
    await renderTab();
    gotoCategory('皮肤');
    fireEvent.change(await screen.findByLabelText('正版 UUID'), { target: { value: UUID } });
    fireEvent.click(screen.getByText('导入正版皮肤'));
    expect(await screen.findByText(/该账号有披风，但本启动器现在只导皮肤/)).toBeTruthy();
  });

  it('UUID 格式不对时如实报错（别让人以为接口挂了）', async () => {
    m.launcherSkinAddOfficial.mockResolvedValue({ entry: null, error: '不是合法的 UUID' });
    await renderTab();
    gotoCategory('皮肤');
    fireEvent.change(await screen.findByLabelText('正版 UUID'), { target: { value: 'Notch' } });
    fireEvent.click(screen.getByText('导入正版皮肤'));
    expect(await screen.findByText('不是合法的 UUID')).toBeTruthy();
  });

  it('空输入时按钮禁用', async () => {
    await renderTab();
    gotoCategory('皮肤');
    expect((screen.getByText('导入正版皮肤') as HTMLButtonElement).disabled).toBe(true);
  });
});

/**
 * 装整合包前的「会覆盖」闸门。
 *
 * 以前查的是 `instances.find((i) => i.id === mcVersion)` —— 把 MC 版本号当
 * 实例 id。多实例之后实例 id 就是整合包的名字，这条**永远查不到**，闸门等于
 * 从来没生效过。现在主进程按「同名同版本才覆盖、同名不同版本另起 (2)」走，
 * 这里必须问在同一条规则上，否则要么白弹、要么该弹不弹。
 */
describe('DownloadTab · 装整合包前提醒「会覆盖同名实例」', () => {
  const PACK = {
    id: 'mr_pack',
    name: 'Fabulously Optimized',
    source: 'modrinth' as const,
    contentType: 'modpack' as const,
    categories: [],
    gameVersions: ['26.3'],
    loaders: ['fabric'],
    versions: [
      {
        id: 'pv1',
        versionNumber: '15.0.0-beta.1',
        gameVersions: ['26.3'],
        loaders: ['fabric'],
        files: [],
      },
    ],
  };

  function setup(instances: Array<{ name: string; versionId: string }>): void {
    m.launcherSearchMods.mockResolvedValue({
      mods: [mod({ id: 'mr_pack', name: 'Fabulously Optimized', contentType: 'modpack' })],
      total: 1,
      page: 0,
      curseForgeConfigured: true,
      error: null,
    });
    m.launcherGetModDetail.mockResolvedValue({ detail: PACK, error: null });
    m.launcherListInstances.mockResolvedValue({
      instances: instances.map((i) => ({
        ...i,
        id: i.name,
        loader: 'fabric',
        clientReady: true,
      })),
      error: null,
    });
    m.launcherInstallModpack.mockResolvedValue({
      ok: true,
      instanceId: 'Fabulously Optimized',
      gameDir: 'C:\\game\\Fabulously Optimized',
      installed: 49,
      failed: [],
    });
  }

  /** 进详情 → 展开版本分组 → 点「安装」。 */
  async function openInstallButton(): Promise<void> {
    await renderTab();
    gotoCategory('整合包');
    fireEvent.click(await screen.findByLabelText('查看 Fabulously Optimized 的详情'));
    fireEvent.click(await screen.findByRole('button', { name: /Fabric 15\.0\.0-beta\.1/ }));
    fireEvent.click(await screen.findByLabelText('安装整合包版本 15.0.0-beta.1'));
  }

  it('已有同名同版本实例：先弹应用内确认框，点「覆盖安装」才装', async () => {
    setup([{ name: 'Fabulously Optimized', versionId: '26.3' }]);
    await openInstallButton();
    // 是应用内 Modal，不是 window.confirm（后者标题会显示成「Electron」）
    expect(await screen.findByText('重装同名整合包？')).toBeTruthy();
    expect(
      screen.getByText(/已经有一个叫「Fabulously Optimized」的实例了（MC 26\.3，fabric）/),
    ).toBeTruthy();
    expect(m.launcherInstallModpack).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: '覆盖安装' }));
    await waitFor(() => {
      expect(m.launcherInstallModpack).toHaveBeenCalledWith({
        modId: 'mr_pack',
        versionId: 'pv1',
        instanceName: 'Fabulously Optimized',
      });
    });
  });

  it('用户点取消：一个字节都不下', async () => {
    setup([{ name: 'Fabulously Optimized', versionId: '26.3' }]);
    await openInstallButton();
    fireEvent.click(await screen.findByRole('button', { name: '取消' }));
    await waitFor(() => {
      expect(screen.queryByText('重装同名整合包？')).toBeNull();
    });
    expect(m.launcherInstallModpack).not.toHaveBeenCalled();
  });

  it('同名但版本不同：不弹框（主进程会另起 (2)，不覆盖任何东西）', async () => {
    setup([{ name: 'Fabulously Optimized', versionId: '1.21.1' }]);
    await openInstallButton();
    await waitFor(() => {
      expect(m.launcherInstallModpack).toHaveBeenCalled();
    });
    expect(screen.queryByText('重装同名整合包？')).toBeNull();
  });

  it('按「这个版本」的 MC 版本判断，不是项目级并集里的最新版本', async () => {
    // 项目级 gameVersions 是全部版本支持的并集（旧→新）；要装的是 1.21.1 那个版本
    setup([{ name: 'Fabulously Optimized', versionId: '1.21.1' }]);
    m.launcherGetModDetail.mockResolvedValue({
      detail: {
        ...PACK,
        gameVersions: ['1.16.5', '1.21.1', '26.3'],
        versions: [{ ...PACK.versions[0], gameVersions: ['1.21.1'] }],
      },
      error: null,
    });
    await openInstallButton();
    expect(await screen.findByText(/MC 1\.21\.1，fabric/)).toBeTruthy();
    expect(m.launcherInstallModpack).not.toHaveBeenCalled();
  });

  it('安装中可以取消：只发取消信号，结果由安装返回值收尾并说明保留了什么', async () => {
    setup([]);
    let resolveInstall: (value: unknown) => void = () => undefined;
    m.launcherInstallModpack.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveInstall = resolve;
        }),
    );

    await openInstallButton();
    fireEvent.click(await screen.findByRole('button', { name: /取消安装/ }));
    await waitFor(() => {
      expect(m.launcherCancelModpack).toHaveBeenCalledWith({
        modId: 'mr_pack',
        versionId: 'pv1',
      });
    });
    // 信号发出后不能立刻把按钮恢复成「取消安装」：安装还在收尾，
    // 用户需要看到「正在取消…」并且不能重复点。
    expect(screen.getByText('正在取消安装…')).toBeTruthy();
    const cancellingButton = screen.getByRole('button', { name: /正在取消/ });
    expect((cancellingButton as HTMLButtonElement).disabled).toBe(true);

    await act(async () => {
      resolveInstall({
        ok: false,
        cancelled: true,
        instanceId: 'Fabulously Optimized',
        gameDir: 'C:\\game\\Fabulously Optimized',
        installed: 7,
        failed: [],
        error: '安装已取消',
      });
    });

    expect(
      await screen.findByText(/已取消安装。已写入的 7 个文件保留在实例「Fabulously Optimized」/),
    ).toBeTruthy();
  });
});
