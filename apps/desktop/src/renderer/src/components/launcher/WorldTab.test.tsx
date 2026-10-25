// @vitest-environment jsdom
/**
 * WorldTab（L9 · 世界 tab）测试
 *
 * ## 这个组件的立身之本：损坏的存档**必须**出现在列表里
 *
 * `level.dat` 来自玩家硬盘，可能被旧版工具写成未压缩、被截断、干脆损坏。主进程
 * 把这种存档标成 `readable: false` 后**照样 push 进列表**（见 launcher-service
 * `listWorlds`），UI 负责把它连同告警一起显示出来。
 *
 * 之所以这么在意：任何「静默跳过」的实现都会让用户以为存档丢了 —— 然后去删
 * 存档/重装游戏，代价远大于显示一行「元数据读不出来」。所以下面
 * `WorldTab · 损坏存档` 整个 describe 都在钉这件事：列表项数量不减、告警在、
 * 同批的其它存档不受牵连。
 *
 * ## fixture 纪律：用 zod 契约校验，而不是「实现认什么我就给什么」
 *
 * 本项目踩过「mock 与实现互相印证出假绿」的坑：fixture 用了错误格式，实现也
 * 只认错误格式，两边一起错，测试全绿但真实数据全失效。
 *
 * 因此本文件的所有 fixture 都用 `worldInfo` 助手构造，并且**用 shared 里的
 * 真实 zod schema（`WorldInfo`）parse 一遍**（`WorldTab · fixture 契约`）。
 * 任何人把 fixture 改成主进程根本不会返回的形状，这里立刻红。
 *
 * 另外 fixture 严格复刻主进程的真实回落规则（launcher-service.ts:678-749）：
 *  - `levelName` 解析失败时**回落到 dirName**（所以坏存档不会出现「目录 xxx」）
 *  - `lastPlayed` 用目录 mtime 兜底，可能是 `undefined`
 *  - `sizeBytes` 是**递归统计整个目录**（region 区块才是大头），不是 level.dat 大小
 *  - `readable` 是必填字段，没有「省略即视为 true」的余地
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, act, within } from '@testing-library/react';
import { WorldTab } from './WorldTab.js';
// 值导出 = 真实的 zod schema，用它校验 fixture 形状（见文件头「fixture 纪律」）
import { WorldInfo as WorldInfoSchema } from '../../../../shared/ipc/launcher.js';
import type { WorldInfo } from '../../../../shared/ipc/launcher.js';

vi.mock('../../lib/ipc-client.js', () => ({
  ipcClient: {
    launcherListWorlds: vi.fn(),
  },
}));

import { ipcClient } from '../../lib/ipc-client.js';

const mockListWorlds = ipcClient.launcherListWorlds as ReturnType<typeof vi.fn>;

const V1 = '26.2';
const V2 = '1.21.11';

const DAY = 86_400_000;

/**
 * 造一条 WorldInfo。**签名收紧到 WorldInfo**，`levelName` 缺省回落到 dirName ——
 * 这正是主进程解析失败时的行为（launcher-service.ts:707）。
 */
function worldInfo(partial: Partial<WorldInfo> & { dirName: string }): WorldInfo {
  return { levelName: partial.dirName, readable: true, ...partial };
}

/** 主进程的正常返回形状（src/main/ipc/launcher.ts:319） */
function okRes(worlds: WorldInfo[]) {
  return { worlds, error: null };
}

/** 目录名 == 世界名（玩家按默认值建的存档，主进程原样回传） */
const NEW_WORLD = worldInfo({
  dirName: '新世界',
  gameMode: '生存',
  mcVersion: '1.21.11',
  sizeBytes: 1536,
  lastPlayed: Date.now() - 1000,
});

/** 目录名无意义（'111'），真实世界名才是给人看的 —— 这是本 tab 存在的理由 */
const SKY_ISLAND = worldInfo({
  dirName: '111',
  levelName: '天空岛',
  gameMode: '创造',
  mcVersion: '1.21.11',
  sizeBytes: 5 * 1024 * 1024,
  lastPlayed: Date.now() - 1.5 * DAY,
});

/** level.dat 损坏：readable=false，levelName 回落到 dirName，元数据缺失 */
const BROKEN = worldInfo({
  dirName: '坏档',
  readable: false,
  lastPlayed: undefined,
  sizeBytes: 512,
});

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  mockListWorlds.mockResolvedValue(okRes([]));
});

afterEach(() => {
  cleanup();
});

/** 渲染并等到首次请求发出（versionId 是**字符串**参数，不是对象） */
async function renderTab(instanceId = V1) {
  const utils = render(<WorldTab instanceId={instanceId} />);
  await waitFor(() => {
    expect(mockListWorlds).toHaveBeenCalledWith({ instance: instanceId });
  });
  return utils;
}

/** 渲染并等到列表/空态真正落地 */
async function renderTabWithWorlds(worlds: WorldInfo[], instanceId = V1) {
  mockListWorlds.mockResolvedValue(okRes(worlds));
  const utils = render(<WorldTab instanceId={instanceId} />);
  await waitFor(() => {
    expect(mockListWorlds).toHaveBeenCalledWith({ instance: instanceId });
  });
  if (worlds.length > 0) {
    await waitFor(() => {
      expect(screen.getAllByText(worlds[0].levelName).length).toBeGreaterThan(0);
    });
  } else {
    await waitFor(() => {
      expect(screen.getByText(/该实例还没有任何存档/)).toBeTruthy();
    });
  }
  return utils;
}

/** 世界名所在的 <li> */
function rowOf(levelName: string): HTMLElement {
  const li = screen.getAllByText(levelName)[0].closest('li');
  if (!li) throw new Error(`找不到 ${levelName} 所在的 <li>`);
  return li;
}

/** 刷新按钮（title 是稳定定位点） */
function refreshButton(): HTMLButtonElement {
  return screen.getByTitle('刷新世界列表') as HTMLButtonElement;
}

describe('WorldTab · 首次加载', () => {
  it('挂载即请求 launcherListWorlds', async () => {
    await renderTab(V1);
    expect(mockListWorlds).toHaveBeenCalledTimes(1);
    expect(mockListWorlds).toHaveBeenCalledWith({ instance: V1 });
  });

  it('versionId 为空时不发请求，刷新按钮同时禁用', () => {
    render(<WorldTab instanceId="" />);
    expect(mockListWorlds).not.toHaveBeenCalled();
    expect(refreshButton().disabled).toBe(true);
  });

  it('请求未落地时显示「读取中…」，不是空态', () => {
    mockListWorlds.mockImplementation(() => new Promise(() => {}));
    render(<WorldTab instanceId={V1} />);
    expect(screen.getByText('读取中…')).toBeTruthy();
    expect(screen.queryByText(/该实例还没有任何存档/)).toBeNull();
  });

  it('加载中刷新按钮禁用，避免并发拉同一份列表', async () => {
    let resolve: (v: unknown) => void = () => {};
    mockListWorlds.mockImplementation(
      () =>
        new Promise((res) => {
          resolve = res;
        }),
    );
    const { unmount } = render(<WorldTab instanceId={V1} />);
    expect(refreshButton().disabled).toBe(true);
    await act(async () => {
      resolve(okRes([NEW_WORLD]));
      await Promise.resolve();
    });
    expect(refreshButton().disabled).toBe(false);
    unmount();
  });

  it('顶部计数等于列表长度', async () => {
    await renderTabWithWorlds([NEW_WORLD, SKY_ISLAND, BROKEN]);
    expect(screen.getByText('saves/ 下共 3 个世界')).toBeTruthy();
  });
});

describe('WorldTab · 渲染世界列表', () => {
  it('显示 level.dat 里的真实世界名，而不是没信息量的目录名', async () => {
    await renderTabWithWorlds([SKY_ISLAND]);
    expect(screen.getByText('天空岛')).toBeTruthy();
    // 目录名只作为补充信息出现，不占据主标题
    expect(rowOf('天空岛').querySelector('.truncate')?.textContent).not.toBe('111');
  });

  it('绝不出现 [object Object]（把对象当 React child 的老坑）', async () => {
    const { container } = await renderTabWithWorlds([NEW_WORLD, SKY_ISLAND, BROKEN]);
    expect(container.textContent).not.toContain('[object Object]');
    expect(container.textContent).not.toContain('undefined');
    expect(container.textContent).not.toContain('NaN');
  });

  it('每个世界渲染成一个 <li>', async () => {
    const { container } = await renderTabWithWorlds([NEW_WORLD, SKY_ISLAND, BROKEN]);
    expect(container.querySelectorAll('li')).toHaveLength(3);
  });

  it.each([
    [512, '512 B'],
    [1536, '1.5 KB'],
    [5 * 1024 * 1024, '5.0 MB'],
    [20 * 1024 * 1024, '20 MB'],
    [3 * 1024 * 1024 * 1024, '3.0 GB'],
  ])('sizeBytes=%d 显示为 %s', async (sizeBytes, expected) => {
    const w = worldInfo({ dirName: `w-${sizeBytes}`, sizeBytes });
    await renderTabWithWorlds([w]);
    expect(within(rowOf(w.levelName)).getByText(expected)).toBeTruthy();
  });

  it('sizeBytes 为 0 也照常显示（0 是有效测量值，不是缺失）', async () => {
    await renderTabWithWorlds([worldInfo({ dirName: '空世界', sizeBytes: 0 })]);
    expect(within(rowOf('空世界')).getByText('0 B')).toBeTruthy();
  });

  it('sizeBytes 缺失时不渲染任何尺寸占位', async () => {
    await renderTabWithWorlds([worldInfo({ dirName: '量不出大小' }), NEW_WORLD]);
    // 另一条有尺寸，不能靠「整页没有数字」蒙混过关
    expect(within(rowOf('量不出大小')).queryByText(/B$|KB|MB|GB/)).toBeNull();
    expect(within(rowOf(NEW_WORLD.levelName)).getByText('1.5 KB')).toBeTruthy();
  });

  it('渲染游戏模式与 MC 版本', async () => {
    await renderTabWithWorlds([SKY_ISLAND]);
    const row = within(rowOf('天空岛'));
    expect(row.getByText('创造')).toBeTruthy();
    expect(row.getByText('MC 1.21.11')).toBeTruthy();
  });

  it('元数据缺失时不渲染游戏模式 / MC 版本标签', async () => {
    await renderTabWithWorlds([BROKEN, NEW_WORLD]);
    const row = within(rowOf(BROKEN.levelName));
    expect(row.queryByText(/^MC /)).toBeNull();
    // 同批另一条仍然正常，说明是「按项缺失」而不是「整体降级」
    expect(within(rowOf(NEW_WORLD.levelName)).getByText('MC 1.21.11')).toBeTruthy();
  });

  it.each([
    ['今天玩过', 1000],
    ['昨天玩过', 1.5 * DAY],
    ['3 天前玩过', 3.2 * DAY],
    ['2 个月前玩过', 70 * DAY],
  ])('最后游玩 %s 天前 → %s', async (label, ago) => {
    const w = worldInfo({ dirName: `w-${label}`, lastPlayed: Date.now() - ago });
    await renderTabWithWorlds([w]);
    expect(within(rowOf(w.levelName)).getByText(label)).toBeTruthy();
  });

  it('lastPlayed 缺失时显示「时间未知」', async () => {
    await renderTabWithWorlds([BROKEN]);
    expect(within(rowOf(BROKEN.levelName)).getByText('时间未知')).toBeTruthy();
  });

  it('lastPlayed 为 0（1970 纪元）也算未知，不谎报「今天玩过」', async () => {
    await renderTabWithWorlds([worldInfo({ dirName: '纪元档', lastPlayed: 0 })]);
    expect(within(rowOf('纪元档')).getByText('时间未知')).toBeTruthy();
  });
});

describe('WorldTab · 目录名 vs 世界名', () => {
  it('两者不同时额外显示「目录 xxx」并带 saves/ 前缀的 title', async () => {
    await renderTabWithWorlds([SKY_ISLAND]);
    const row = within(rowOf('天空岛'));
    expect(row.getByText('目录 111')).toBeTruthy();
    expect(within(screen.getByTitle('saves/111')).getByText('目录 111')).toBeTruthy();
  });

  it('两者相同时不显示多余的「目录」行', async () => {
    await renderTabWithWorlds([NEW_WORLD]);
    const row = within(rowOf(NEW_WORLD.levelName));
    expect(row.queryByText(/^目录 /)).toBeNull();
    expect(screen.queryByTitle(`saves/${NEW_WORLD.dirName}`)).toBeNull();
  });
});

describe('WorldTab · 损坏存档必须列出', () => {
  it('readable:false 仍然占一个列表项，不被静默跳过', async () => {
    const { container } = await renderTabWithWorlds([NEW_WORLD, BROKEN, SKY_ISLAND]);
    expect(container.querySelectorAll('li')).toHaveLength(3);
    expect(screen.getByText('坏档')).toBeTruthy();
    expect(screen.getByText('saves/ 下共 3 个世界')).toBeTruthy();
  });

  it('显示「level.dat 不可读」提示，且说清存档本身还在', async () => {
    await renderTabWithWorlds([BROKEN]);
    expect(screen.getByText(/level\.dat 不可读/)).toBeTruthy();
    expect(screen.getByText(/存档本身仍在/)).toBeTruthy();
  });

  it('告警落在坏存档自己那一行，不会挂到别的存档上', async () => {
    await renderTabWithWorlds([BROKEN, NEW_WORLD]);
    expect(within(rowOf('坏档')).getByText(/level\.dat 不可读/)).toBeTruthy();
    expect(within(rowOf(NEW_WORLD.levelName)).queryByText(/level\.dat 不可读/)).toBeNull();
  });

  it('可读存档不带这条告警', async () => {
    await renderTabWithWorlds([NEW_WORLD]);
    expect(screen.queryByText(/level\.dat 不可读/)).toBeNull();
  });

  it('主进程回落成 levelName=dirName，所以坏档不显示「目录 xxx」', async () => {
    // 这是 launcher-service.ts:707 的真实行为：解析失败 → levelName = dirName
    await renderTabWithWorlds([BROKEN]);
    expect(within(rowOf('坏档')).queryByText(/^目录 /)).toBeNull();
  });

  it('一个坏存档不影响同批其它存档照常显示元数据', async () => {
    await renderTabWithWorlds([BROKEN, SKY_ISLAND]);
    const ok = within(rowOf('天空岛'));
    expect(ok.getByText('创造')).toBeTruthy();
    expect(ok.getByText('MC 1.21.11')).toBeTruthy();
    expect(ok.getByText('5.0 MB')).toBeTruthy();
    expect(ok.queryByText(/level\.dat 不可读/)).toBeNull();
  });

  it('列表里清一色坏存档时仍显示列表、而不是空态', async () => {
    await renderTabWithWorlds([BROKEN, worldInfo({ dirName: '坏档2', readable: false })]);
    expect(screen.queryByText(/该实例还没有任何存档/)).toBeNull();
    expect(screen.getAllByText(/level\.dat 不可读/)).toHaveLength(2);
  });
});

describe('WorldTab · 空态', () => {
  it('空列表显示引导空态，并且指向「新建世界」这一步', async () => {
    await renderTabWithWorlds([]);
    const empty = screen.getByText(/该实例还没有任何存档/);
    expect(empty.textContent).toContain('新建世界');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('主进程缺省 worlds 字段时也按空列表处理，不炸', async () => {
    // 契约里 worlds 是必填，但组件写了 `res.worlds ?? []`；
    // 这里只钉住「不崩 + 空态」，不为这个防御分支编造主进程行为。
    mockListWorlds.mockResolvedValue({ error: null });
    render(<WorldTab instanceId={V1} />);
    await waitFor(() => {
      expect(screen.getByText(/该实例还没有任何存档/)).toBeTruthy();
    });
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('WorldTab · 主进程错误必须显示，不能伪装成「没有存档」', () => {
  it('返回 error 时显示原因，且**不**同时显示空态', async () => {
    mockListWorlds.mockResolvedValue({ worlds: [], error: 'saves 目录不存在' });
    await renderTab(V1);

    expect(screen.getByRole('alert').textContent).toContain('saves 目录不存在');
    // 关键：二者不能同时出现。用户看到「该实例还没有任何存档」会以为存档真没了。
    expect(screen.queryByText(/该实例还没有任何存档/)).toBeNull();
    expect(screen.queryByText('读取中…')).toBeNull();
  });

  it('error 分支清空上一批世界，不残留上一实例的内容', async () => {
    mockListWorlds.mockResolvedValueOnce(okRes([NEW_WORLD, SKY_ISLAND]));
    await renderTab(V1);
    expect(screen.getByText('天空岛')).toBeTruthy();

    mockListWorlds.mockResolvedValue({ worlds: [], error: '存档目录已被删除' });
    fireEvent.click(refreshButton());

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('存档目录已被删除');
    });
    expect(screen.queryByText('天空岛')).toBeNull();
    expect(screen.queryByText('新世界')).toBeNull();
  });

  it('请求 reject 时把异常消息显示出来，且同样不显示空态', async () => {
    mockListWorlds.mockRejectedValue(new Error('IPC 通道已关闭'));
    await renderTab(V1);

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('IPC 通道已关闭');
    });
    expect(screen.queryByText(/该实例还没有任何存档/)).toBeNull();
  });

  it('刷新成功后错误消失、列表回来', async () => {
    mockListWorlds.mockResolvedValueOnce({ worlds: [], error: '存档目录已被删除' });
    await renderTab(V1);
    expect(screen.getByRole('alert')).toBeTruthy();

    mockListWorlds.mockResolvedValue(okRes([SKY_ISLAND]));
    fireEvent.click(refreshButton());

    await waitFor(() => {
      expect(screen.queryByRole('alert')).toBeNull();
    });
    expect(screen.getByText('天空岛')).toBeTruthy();
    expect(screen.getByText('saves/ 下共 1 个世界')).toBeTruthy();
  });
});

describe('WorldTab · 刷新与切换实例', () => {
  it('点刷新重新拉取当前实例的列表', async () => {
    await renderTabWithWorlds([NEW_WORLD]);
    fireEvent.click(refreshButton());
    await waitFor(() => {
      expect(mockListWorlds).toHaveBeenCalledTimes(2);
    });
    expect(mockListWorlds).toHaveBeenLastCalledWith({ instance: V1 });
  });

  it('刷新会拉回磁盘上的新变化，而不是拿旧 state 糊弄', async () => {
    mockListWorlds.mockResolvedValueOnce(okRes([NEW_WORLD]));
    await renderTab(V1);

    mockListWorlds.mockResolvedValue(okRes([NEW_WORLD, SKY_ISLAND]));
    fireEvent.click(refreshButton());

    await waitFor(() => {
      expect(screen.getByText('saves/ 下共 2 个世界')).toBeTruthy();
    });
    expect(screen.getByText('天空岛')).toBeTruthy();
  });

  it('切换 versionId 重新拉取对应实例的列表', async () => {
    const { rerender } = await renderTab(V1);
    rerender(<WorldTab instanceId={V2} />);
    await waitFor(() => {
      expect(mockListWorlds).toHaveBeenCalledWith({ instance: V2 });
    });
    expect(mockListWorlds).toHaveBeenCalledTimes(2);
  });

  it('切换 instanceId 后列表换成新实例的内容', async () => {
    mockListWorlds.mockImplementation(async (req: { instance: string }) =>
      req.instance === V1 ? okRes([NEW_WORLD]) : okRes([SKY_ISLAND]),
    );
    const { rerender } = await renderTab(V1);
    expect(screen.getByText('新世界')).toBeTruthy();

    rerender(<WorldTab instanceId={V2} />);
    await waitFor(() => {
      expect(screen.getByText('天空岛')).toBeTruthy();
    });
    expect(screen.queryByText('新世界')).toBeNull();
    expect(screen.getByText('saves/ 下共 1 个世界')).toBeTruthy();
  });

  it('卸载后未决请求落地不再触发状态更新', async () => {
    let resolve: (v: unknown) => void = () => {};
    mockListWorlds.mockImplementation(
      () =>
        new Promise((res) => {
          resolve = res;
        }),
    );

    const { unmount } = render(<WorldTab instanceId={V1} />);
    await waitFor(() => {
      expect(mockListWorlds).toHaveBeenCalledTimes(1);
    });

    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    unmount();
    await act(async () => {
      resolve(okRes([NEW_WORLD]));
      await Promise.resolve();
    });

    expect(errSpy).not.toHaveBeenCalled();
    expect(mockListWorlds).toHaveBeenCalledTimes(1);
    errSpy.mockRestore();
  });
});

describe('WorldTab · fixture 契约（防止 mock 与实现互相印证出假绿）', () => {
  const ALL_FIXTURES: WorldInfo[] = [
    NEW_WORLD,
    SKY_ISLAND,
    BROKEN,
    worldInfo({ dirName: '最小集', readable: false, lastPlayed: undefined }),
  ];

  it('本文件所有 fixture 都能通过主进程真实的 zod schema', () => {
    for (const w of ALL_FIXTURES) {
      expect(() => WorldInfoSchema.parse(w)).not.toThrow();
    }
  });

  it('可读存档额外带上全部可选元数据也依然合法（没有隐藏字段名）', () => {
    const full = worldInfo({
      dirName: '满配',
      levelName: '满配世界',
      lastPlayed: Date.now(),
      gameMode: '旁观',
      mcVersion: '26.2',
      sizeBytes: 42,
      readable: true,
    });
    const parsed = WorldInfoSchema.parse(full);
    expect(parsed.levelName).toBe('满配世界');
    expect(parsed.gameMode).toBe('旁观');
    expect(parsed.sizeBytes).toBe(42);
  });

  it('readable 是必填：省略它会被契约拒绝（所以实现不能「缺省当作可读」）', () => {
    expect(WorldInfoSchema.safeParse({ dirName: 'x', levelName: 'x' }).success).toBe(false);
    expect(
      WorldInfoSchema.safeParse({ dirName: 'x', levelName: 'x', readable: true }).success,
    ).toBe(true);
  });

  it('dirName / levelName 是必填字符串 —— 列表不能按目录名瞎凑', () => {
    expect(WorldInfoSchema.safeParse({ readable: true }).success).toBe(false);
    expect(WorldInfoSchema.safeParse({ dirName: 'x', readable: true }).success).toBe(false);
  });
});
