// @vitest-environment jsdom
/**
 * GameLauncherPanel 回归测试（L2「实例轨 + 启动驾驶舱」）。
 *
 * ## 两次重建的教训（保留在文件头，防止重犯）
 *
 * 1. 旧文件曾存在、后来被删除，此后该组件零覆盖。而删除它的旧用例里有一处**致命的
 *    mock 造假**：`launcherListMods` 被打成 `{ mods: ['fabric-api.jar'] }`（`string[]`），
 *    而主进程真实返回 `ModInfo[]`（对象）。于是「state 声明成 `string[]` + 渲染写
 *    `{m}`」这两个错误在测试里**自洽**，测试全绿；到真实运行时才炸
 *    （`Objects are not valid as a React child`）。
 *    旧测试不是「没覆盖到」，而是**用错误类型伪造出了错误的正确性**。
 * 2. 第二次重建（L2）时，该文件又被整批改写。**这次不能删** ——
 *    删测试换绿灯是最容易的假绿手法。改写可以，但必须保持同等或更高的覆盖密度。
 *
 * 因此本文件的纪律：
 *  - mock 一律照抄主进程真实契约（`ModInfo` / `InstanceSummary`），不为迁就组件 bug 降级；
 *  - 每个曾经出过事的点都必须有对应断言，并在断言旁注明它防的是什么。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, within, act } from '@testing-library/react';
import { GameLauncherPanel } from './GameLauncherPanel.js';
import { useModStore } from '../../store/mod-store.js';
import type { InstanceSummary } from '../../../../shared/ipc/launcher.js';
import type { ProcessStatusT } from '../../../../shared/ipc/process-supervisor.js';

vi.mock('../../lib/ipc-client.js', () => ({
  ipcClient: {
    launcherListVersions: vi.fn(),
    launcherListInstances: vi.fn(),
    launcherListServerInstances: vi.fn(),
    launcherCreateInstance: vi.fn(),
    launcherUpdateInstance: vi.fn(),
    launcherDeleteInstance: vi.fn(),
    launcherDownload: vi.fn(),
    launcherLaunch: vi.fn(),
    launcherOpenInstanceFolder: vi.fn(),
    onLauncherGameExit: vi.fn(() => () => undefined),
    launcherPickFiles: vi.fn(),
    launcherInstallLoader: vi.fn(),
    launcherInstallSkin: vi.fn(),
    launcherListMods: vi.fn(),
    launcherToggleMod: vi.fn(),
    launcherRemoveMod: vi.fn(),
    launcherInstallMod: vi.fn(),
    launcherListInstanceFiles: vi.fn(),
    launcherListWorlds: vi.fn(),
    launcherLogStream: vi.fn(),
    launcherReadLatestLog: vi.fn(),
    launcherListCrashReports: vi.fn(),
    launcherReadCrashReport: vi.fn(),
    launcherCreateServerInstance: vi.fn(),
    launcherDeleteServerInstance: vi.fn(),
    locateMc: vi.fn(),
    chooseMcDir: vi.fn(),
    installMod: vi.fn(),
    launchMc: vi.fn(),
    processLaunch: vi.fn(),
    processStop: vi.fn(),
    processStatus: vi.fn(),
    onProcessState: vi.fn(() => () => undefined),
  },
}));

import { ipcClient } from '../../lib/ipc-client.js';

const m = {
  listVersions: ipcClient.launcherListVersions as ReturnType<typeof vi.fn>,
  listInstances: ipcClient.launcherListInstances as ReturnType<typeof vi.fn>,
  listServerInstances: ipcClient.launcherListServerInstances as ReturnType<typeof vi.fn>,
  createServerInstance: ipcClient.launcherCreateServerInstance as ReturnType<typeof vi.fn>,
  createInstance: ipcClient.launcherCreateInstance as ReturnType<typeof vi.fn>,
  updateInstance: ipcClient.launcherUpdateInstance as ReturnType<typeof vi.fn>,
  deleteInstance: ipcClient.launcherDeleteInstance as ReturnType<typeof vi.fn>,
  download: ipcClient.launcherDownload as ReturnType<typeof vi.fn>,
  launch: ipcClient.launcherLaunch as ReturnType<typeof vi.fn>,
  onGameExit: ipcClient.onLauncherGameExit as ReturnType<typeof vi.fn>,
  installLoader: ipcClient.launcherInstallLoader as ReturnType<typeof vi.fn>,
  installSkin: ipcClient.launcherInstallSkin as ReturnType<typeof vi.fn>,
  listMods: ipcClient.launcherListMods as ReturnType<typeof vi.fn>,
  listInstanceFiles: ipcClient.launcherListInstanceFiles as ReturnType<typeof vi.fn>,
  listWorlds: ipcClient.launcherListWorlds as ReturnType<typeof vi.fn>,
  logStream: ipcClient.launcherLogStream as ReturnType<typeof vi.fn>,
  locateMc: ipcClient.locateMc as ReturnType<typeof vi.fn>,
  chooseMcDir: ipcClient.chooseMcDir as ReturnType<typeof vi.fn>,
  installMod: ipcClient.installMod as ReturnType<typeof vi.fn>,
  launchMc: ipcClient.launchMc as ReturnType<typeof vi.fn>,
  processLaunch: ipcClient.processLaunch as ReturnType<typeof vi.fn>,
  processStop: ipcClient.processStop as ReturnType<typeof vi.fn>,
  processStatus: ipcClient.processStatus as ReturnType<typeof vi.fn>,
  onProcessState: ipcClient.onProcessState as ReturnType<typeof vi.fn>,
};

const V1 = '26.2';

/** 造一条 InstanceSummary。签名收紧到真实契约，防止再造「伪造正确性」。 */
function inst(partial: Partial<InstanceSummary> & { id: string }): InstanceSummary {
  return {
    name: partial.id,
    versionId: V1,
    loader: 'vanilla',
    source: 'downloaded',
    createdAt: 1_700_000_000_000,
    clientReady: true,
    ...partial,
  };
}

function resetStore(files: { path: string; content: string }[] = []) {
  useModStore.setState({ files, jarPath: null });
}

/** 造一条进程状态快照，字段按真实契约补齐，避免「伪造正确性」。 */
function serverStatus(partial: Partial<ProcessStatusT> & { serverId: string }): ProcessStatusT {
  return {
    state: 'stopped',
    pid: null,
    startedAt: null,
    exitCode: null,
    exitSignal: null,
    lastLogLines: [],
    crashCount: 0,
    lastStop: null,
    portReleased: null,
    cmd: 'java',
    args: [],
    cwd: null,
    reloadCommand: null,
    autoRestartEnabled: false,
    autoRestartCount: 0,
    autoRestartExhausted: false,
    autoRestartPending: false,
    lastCommandOutcome: null,
    ...partial,
  };
}

function mockInstances(instances: InstanceSummary[]) {
  m.listInstances.mockResolvedValue({ instances, error: null });
}

/**
 * 左侧实例轨。搜索框在实例轨头部，但列表本身有独立的 `aria-label`，
 * 用它限定查询范围，避免命中右侧驾驶舱里同名的实例标题。
 */
function instanceList(): HTMLElement {
  return screen.getByRole('list', { name: '实例列表' });
}

async function findInstanceList(): Promise<HTMLElement> {
  return screen.findByRole('list', { name: '实例列表' });
}

async function waitForDetail(): Promise<HTMLElement> {
  return screen.findByRole('tablist', { name: '实例详情' });
}

/** 启动设置默认收起；需要改用户名 / 内存 / Java 的用例先展开。 */
async function expandSettings(): Promise<void> {
  fireEvent.click(await screen.findByRole('button', { name: /启动设置/ }));
}

async function selectInstance(name: string) {
  const list = await findInstanceList();
  const btn = within(list).getByRole('button', { name: new RegExp(name) });
  // 选中会挂载新的 ContentTab，它的 IPC mock 在微任务里 resolve。
  // 包在 act 里，避免测试末尾才冒出的 “not wrapped in act” 噪音。
  await act(async () => {
    fireEvent.click(btn);
    await Promise.resolve();
  });
  return btn;
}

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  resetStore();

  m.listVersions.mockResolvedValue({
    versions: [{ id: V1, type: 'release', releaseTime: '2026-06-16T00:00:00Z' }],
    error: null,
  });
  m.listInstances.mockResolvedValue({ instances: [], error: null });
  // 真实主进程返回的是信封，不是裸数组（以前这里用数组 mock，把 bug 盖住了）
  m.listServerInstances.mockResolvedValue({ instances: [], error: null });
  m.createServerInstance.mockResolvedValue({
    ok: true,
    serverDir: 'D:/servers/srv-test',
    jarLinked: true,
    eulaAccepted: true,
    error: null,
  });
  m.createInstance.mockResolvedValue({ ok: true, instance: inst({ id: V1 }), error: null });
  m.updateInstance.mockResolvedValue({ ok: true, instance: inst({ id: V1 }), error: null });
  m.deleteInstance.mockResolvedValue({ ok: true, filesDeleted: false, error: null });
  m.download.mockResolvedValue({ ok: true, error: null });
  m.launch.mockResolvedValue({ pid: 12345, error: null });
  m.onGameExit.mockImplementation(() => () => undefined);
  m.installLoader.mockResolvedValue({ ok: true, error: null });
  m.installSkin.mockResolvedValue({ ok: true, error: null });
  m.listMods.mockResolvedValue({ mods: [], error: null });
  m.listInstanceFiles.mockResolvedValue({ files: [], error: null });
  m.listWorlds.mockResolvedValue({ worlds: [], error: null });
  m.logStream.mockReturnValue(() => undefined);
  m.locateMc.mockResolvedValue({ found: true, mcDir: 'D:/mc/.minecraft', error: null });
  m.chooseMcDir.mockResolvedValue({ path: 'D:/chosen' });
  m.installMod.mockResolvedValue({ ok: true, modsDir: 'D:/mods', error: null });
  m.launchMc.mockResolvedValue({ ok: true, error: null });
  m.processLaunch.mockResolvedValue({ ok: true, pid: 4321, error: null });
  m.processStop.mockResolvedValue({ ok: true, error: null, stop: null });
  m.processStatus.mockResolvedValue({ status: null });
  m.onProcessState.mockImplementation(() => () => undefined);
});

afterEach(() => cleanup());

// ===========================================================================
// 实例轨 + 驾驶舱骨架
// ===========================================================================
describe('L2 · 实例轨与启动驾驶舱', () => {
  it('挂载即拉实例列表与版本清单', async () => {
    render(<GameLauncherPanel />);
    await waitFor(() => expect(m.listInstances).toHaveBeenCalled());
    await screen.findByText('实例库为空');
    expect(m.listVersions).toHaveBeenCalled();
  });

  it('空实例时左右两侧都给引导，而不是一块空白', async () => {
    render(<GameLauncherPanel />);
    expect(await screen.findByText(/还没有实例/)).toBeTruthy();
    expect(await screen.findByText('实例库为空')).toBeTruthy();
  });

  it('默认选中实例，打开就能看到主启动按钮', async () => {
    mockInstances([inst({ id: V1, name: '我的世界' })]);
    render(<GameLauncherPanel />);

    const list = await findInstanceList();
    await waitFor(() =>
      expect(
        within(list)
          .getByRole('button', { name: /我的世界/ })
          .getAttribute('aria-pressed'),
      ).toBe('true'),
    );
    expect(await screen.findByRole('button', { name: '开始游戏' })).toBeTruthy();
  });

  it('默认选中最近玩过的实例，而不是盲信注册表返回顺序', async () => {
    mockInstances([
      inst({ id: 'snapshot', name: '26.4 快照', lastLaunchedAt: undefined }),
      inst({ id: 'fo', name: 'Fabulously Optimized', lastLaunchedAt: Date.now() - 60_000 }),
    ]);
    render(<GameLauncherPanel />);

    const list = await findInstanceList();
    await waitFor(() =>
      expect(
        within(list)
          .getByRole('button', { name: /Fabulously Optimized/ })
          .getAttribute('aria-pressed'),
      ).toBe('true'),
    );
    expect(await screen.findByText('Fabulously Optimized', { selector: 'h2' })).toBeTruthy();
  });

  it('启动设置默认收起，展开后才露出用户名 / 内存 / Java', async () => {
    mockInstances([inst({ id: V1, name: '我的世界' })]);
    render(<GameLauncherPanel />);
    const toggle = await screen.findByRole('button', { name: /启动设置/ });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByLabelText('用户名')).toBeNull();

    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(await screen.findByLabelText('用户名')).toBeTruthy();
    expect(screen.getByLabelText('内存')).toBeTruthy();
    expect(screen.getByLabelText('Java 路径')).toBeTruthy();
  });

  it('不再渲染和实例轨重复的「快速开始」区', async () => {
    render(<GameLauncherPanel />);
    await screen.findByText('实例库为空');
    expect(screen.queryByText('快速开始')).toBeNull();
  });

  it('次入口默认收起（不与主路径争首屏）', async () => {
    render(<GameLauncherPanel />);
    await screen.findByText('实例库为空');
    const sec = screen.getByRole('button', { name: /使用已有的 MC 安装/ });
    expect(sec.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByText(/自动定位/)).toBeNull();
  });
});

// ===========================================================================
// 错误横幅（§4.2.1）
// ===========================================================================
describe('L2 · 统一错误横幅', () => {
  it('实例列表报错显示在顶部横幅', async () => {
    m.listInstances.mockResolvedValue({ instances: [], error: '注册表损坏' });
    render(<GameLauncherPanel />);
    const banner = await screen.findByRole('alert');
    expect(banner.textContent).toContain('注册表损坏');
  });

  it('错误横幅有 role=alert（可被辅助技术播报）', async () => {
    m.listInstances.mockResolvedValue({ instances: [], error: 'x' });
    render(<GameLauncherPanel />);
    expect(await screen.findByRole('alert')).toBeTruthy();
  });
});

// ===========================================================================
// 实例轨
// ===========================================================================
describe('L2 · 实例轨', () => {
  it('渲染实例列表', async () => {
    mockInstances([inst({ id: V1, name: '我的世界' }), inst({ id: 'old', name: '旧版' })]);
    render(<GameLauncherPanel />);
    const list = await findInstanceList();
    expect(within(list).getByRole('button', { name: /我的世界/ })).toBeTruthy();
    expect(within(list).getByRole('button', { name: /旧版/ })).toBeTruthy();
  });

  it('搜索只过滤实例轨，不把驾驶舱里的当前实例改掉', async () => {
    mockInstances([inst({ id: 'a', name: 'Alpha' }), inst({ id: 'b', name: 'Beta' })]);
    render(<GameLauncherPanel />);
    await within(await findInstanceList()).findByRole('button', { name: /Alpha/ });
    fireEvent.change(screen.getByLabelText('搜索实例'), { target: { value: 'bet' } });
    await waitFor(() =>
      expect(within(instanceList()).queryByRole('button', { name: /Alpha/ })).toBeNull(),
    );
    expect(within(instanceList()).getByRole('button', { name: /Beta/ })).toBeTruthy();
    // Alpha 仍是选中项：搜索是「看哪条」，不是「切实例」
    expect(await screen.findByRole('button', { name: '开始游戏' })).toBeTruthy();
  });

  it('未下载实例在轨道上灰显（clientReady=false）', async () => {
    mockInstances([inst({ id: V1, name: '我的世界', clientReady: false })]);
    render(<GameLauncherPanel />);
    const card = await within(await findInstanceList()).findByRole('button', { name: /26\.2/ });
    expect(card.className).toContain('opacity-60');
  });

  it('状态徽章：从未游玩过 / N 天前（lastLaunchedAt 的 UI 投影）', async () => {
    mockInstances([
      inst({ id: 'a', name: 'A' }),
      inst({ id: 'b', name: 'B', lastLaunchedAt: Date.now() - 3 * 86_400_000 }),
    ]);
    render(<GameLauncherPanel />);
    await findInstanceList();
    expect(await screen.findAllByText(/从未游玩过/)).not.toHaveLength(0);
    expect(screen.getAllByText(/3 天前玩过/).length).toBeGreaterThan(0);
  });
});

// ===========================================================================
// 启动按钮状态机（§4.5）
// ===========================================================================
describe('L2 · 启动按钮四态', () => {
  it('clientReady=true → 文案「开始游戏」，直接启动不下载', async () => {
    mockInstances([inst({ id: V1 })]);
    render(<GameLauncherPanel />);
    fireEvent.click(await screen.findByRole('button', { name: '开始游戏' }));
    await waitFor(() => expect(m.launch).toHaveBeenCalled());
    await screen.findByRole('button', { name: '运行中 12345' });
    expect(m.download).not.toHaveBeenCalled();
  });

  it('clientReady=false → 文案「下载并启动」，先下载再启动', async () => {
    mockInstances([inst({ id: V1, clientReady: false })]);
    render(<GameLauncherPanel />);
    fireEvent.click(await screen.findByRole('button', { name: '下载并启动' }));
    await waitFor(() => expect(m.launch).toHaveBeenCalled());
    await screen.findByRole('button', { name: '运行中 12345' });
    expect(m.download).toHaveBeenCalledWith({ version: V1, instanceId: V1 });
  });

  it('下载失败则不启动，错误进横幅', async () => {
    mockInstances([inst({ id: V1, clientReady: false })]);
    m.download.mockResolvedValue({ ok: false, error: '网络中断' });
    render(<GameLauncherPanel />);
    fireEvent.click(await screen.findByRole('button', { name: '下载并启动' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('网络中断'));
    expect(m.launch).not.toHaveBeenCalled();
  });

  it('启动成功显示 PID，按钮变「运行中 N」，实例轨也标出运行中', async () => {
    mockInstances([inst({ id: V1 }), inst({ id: 'other', name: '另一个' })]);
    render(<GameLauncherPanel />);
    fireEvent.click(await screen.findByRole('button', { name: '开始游戏' }));

    const running = await screen.findByRole('button', { name: '运行中 12345' });
    expect((running as HTMLButtonElement).disabled).toBe(true);
    const list = instanceList();
    expect(within(list).getByText(/运行中 · PID 12345/)).toBeTruthy();
  });

  it('运行中切到另一个实例，不能把「运行中」错贴到它头上', async () => {
    m.listMods.mockImplementation(({ instance }: { instance: string }) =>
      Promise.resolve({
        mods:
          instance === 'b'
            ? [{ name: 'b-mod.jar', enabled: true }]
            : [{ name: 'a-mod.jar', enabled: true }],
        error: null,
      }),
    );
    mockInstances([inst({ id: 'a', name: 'A' }), inst({ id: 'b', name: 'B' })]);
    render(<GameLauncherPanel />);
    await screen.findByText('a-mod.jar');
    fireEvent.click(await screen.findByRole('button', { name: '开始游戏' }));
    await screen.findByRole('button', { name: '运行中 12345' });

    await selectInstance('B');
    await waitFor(() => expect(screen.getByText(/另一个实例正在运行（PID 12345）/)).toBeTruthy());
    await waitFor(() => expect(m.listMods).toHaveBeenCalledWith({ instance: 'b' }));
    await screen.findByText('b-mod.jar');
    // 当前实例不是运行中的那个，按钮应显示「开始游戏」但被禁用
    const start = screen.getByRole('button', { name: '开始游戏' }) as HTMLButtonElement;
    expect(start.disabled).toBe(true);
  });

  it('启动参数取自实例元数据，不是硬编码', async () => {
    mockInstances([inst({ id: V1, username: 'Alex', memory: '4G' })]);
    render(<GameLauncherPanel />);
    fireEvent.click(await screen.findByRole('button', { name: '开始游戏' }));
    await waitFor(() =>
      expect(m.launch).toHaveBeenCalledWith({ instance: V1, username: 'Alex', memory: '4G' }),
    );
    await screen.findByRole('button', { name: '运行中 12345' });
  });

  it('游戏退出事件要清掉「运行中」，否则用户再也点不动开始游戏', async () => {
    let exitHandler:
      ((e: { instance: string; code: number | null; signal: string | null }) => void) | null = null;
    m.onGameExit.mockImplementation((handler: typeof exitHandler) => {
      exitHandler = handler;
      return () => undefined;
    });
    mockInstances([inst({ id: V1 })]);
    render(<GameLauncherPanel />);
    fireEvent.click(await screen.findByRole('button', { name: '开始游戏' }));
    await screen.findByRole('button', { name: '运行中 12345' });

    act(() => exitHandler!({ instance: V1, code: 0, signal: null }));
    await waitFor(() => expect(screen.getByRole('button', { name: '开始游戏' })).toBeTruthy());
    expect(screen.getByText('游戏已退出')).toBeTruthy();
  });
});

// ===========================================================================
// 实例 CRUD
// ===========================================================================
describe('L2 · 实例增删改', () => {
  it('新建实例走独立弹窗，名字和版本一次提交', async () => {
    render(<GameLauncherPanel />);
    fireEvent.click(await screen.findByRole('button', { name: '新建实例' }));
    const dialog = await screen.findByRole('dialog', { name: '新建实例' });

    const select = within(dialog).getByLabelText('MC 版本') as HTMLSelectElement;
    await waitFor(() => expect(select.value).toBe(V1));
    fireEvent.change(within(dialog).getByLabelText(/实例名称/), {
      target: { value: '我的世界' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: '创建实例' }));

    await waitFor(() =>
      expect(m.createInstance).toHaveBeenCalledWith({ versionId: V1, name: '我的世界' }),
    );
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '新建实例' })).toBeNull());
  });

  it('默认版本选最新正式版，不拿刚出的 snapshot 当默认', async () => {
    m.listVersions.mockResolvedValue({
      versions: [
        { id: '26.4-snapshot-5', type: 'snapshot', releaseTime: '2026-08-01T00:00:00Z' },
        { id: '26.3', type: 'release', releaseTime: '2026-06-16T00:00:00Z' },
      ],
      error: null,
    });
    render(<GameLauncherPanel />);
    fireEvent.click(await screen.findByRole('button', { name: '新建实例' }));
    const dialog = await screen.findByRole('dialog', { name: '新建实例' });
    const select = within(dialog).getByLabelText('MC 版本') as HTMLSelectElement;

    await waitFor(() => expect(select.value).toBe('26.3'));
  });

  it('实例名留空时用版本号，仍交给主进程做目录名校验', async () => {
    render(<GameLauncherPanel />);
    fireEvent.click(await screen.findByRole('button', { name: '新建实例' }));
    const dialog = await screen.findByRole('dialog', { name: '新建实例' });
    const select = within(dialog).getByLabelText('MC 版本') as HTMLSelectElement;
    await waitFor(() => expect(select.value).toBe(V1));

    fireEvent.click(within(dialog).getByRole('button', { name: '创建实例' }));
    await waitFor(() =>
      expect(m.createInstance).toHaveBeenCalledWith({ versionId: V1, name: undefined }),
    );
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '新建实例' })).toBeNull());
  });

  it('非法实例名当场拦住，创建按钮不提交', async () => {
    render(<GameLauncherPanel />);
    fireEvent.click(await screen.findByRole('button', { name: '新建实例' }));
    const dialog = await screen.findByRole('dialog', { name: '新建实例' });
    fireEvent.change(within(dialog).getByLabelText(/实例名称/), {
      target: { value: '我的/世界' },
    });
    expect(await within(dialog).findByText(/不能有这些字符/)).toBeTruthy();
    expect(
      (within(dialog).getByRole('button', { name: '创建实例' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(m.createInstance).not.toHaveBeenCalled();
  });

  it('创建失败时错误留在弹窗里，不静默关闭', async () => {
    m.createInstance.mockResolvedValue({ ok: false, error: '磁盘只读', errorCode: 'EACCES' });
    render(<GameLauncherPanel />);
    fireEvent.click(await screen.findByRole('button', { name: '新建实例' }));
    const dialog = await screen.findByRole('dialog', { name: '新建实例' });
    const select = within(dialog).getByLabelText('MC 版本') as HTMLSelectElement;
    await waitFor(() => expect(select.value).toBe(V1));
    fireEvent.click(within(dialog).getByRole('button', { name: '创建实例' }));

    expect(await within(dialog).findByRole('alert')).toHaveProperty(
      'textContent',
      expect.stringContaining('磁盘只读'),
    );
    expect(screen.getByRole('dialog', { name: '新建实例' })).toBeTruthy();
  });

  it('删除实例先确认，确认后传 deleteFiles:false（默认不删存档）', async () => {
    mockInstances([inst({ id: V1, name: '我的世界' })]);
    render(<GameLauncherPanel />);
    fireEvent.click(await screen.findByRole('button', { name: '删除实例 我的世界' }));
    fireEvent.click(await screen.findByRole('button', { name: '删除实例' }));
    await waitFor(() =>
      expect(m.deleteInstance).toHaveBeenCalledWith({ id: V1, deleteFiles: false }),
    );
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '删除实例？' })).toBeNull());
  });

  it('删除确认框点取消不会发 IPC', async () => {
    mockInstances([inst({ id: V1, name: '我的世界' })]);
    render(<GameLauncherPanel />);
    fireEvent.click(await screen.findByRole('button', { name: '删除实例 我的世界' }));
    fireEvent.click(await screen.findByRole('button', { name: '取消' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '删除实例？' })).toBeNull());
    expect(m.deleteInstance).not.toHaveBeenCalled();
  });

  it('删除失败显示错误，不静默', async () => {
    mockInstances([inst({ id: V1, name: '我的世界' })]);
    m.deleteInstance.mockResolvedValue({ ok: false, filesDeleted: false, error: '占用中' });
    render(<GameLauncherPanel />);
    fireEvent.click(await screen.findByRole('button', { name: '删除实例 我的世界' }));
    fireEvent.click(await screen.findByRole('button', { name: '删除实例' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('占用中'));
  });

  it('改用户名失焦才提交，且值未变时不发 IPC', async () => {
    mockInstances([inst({ id: V1, name: '我的世界', username: 'Steve' })]);
    render(<GameLauncherPanel />);
    await expandSettings();
    const input = (await screen.findByLabelText('用户名')) as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'Alex' } });
    // 敲键过程中不该发 IPC
    expect(m.updateInstance).not.toHaveBeenCalled();
    fireEvent.blur(input, { target: { value: 'Alex' } });
    await waitFor(() =>
      expect(m.updateInstance).toHaveBeenCalledWith({ id: V1, patch: { username: 'Alex' } }),
    );
  });

  it('Java 路径可按实例保存（启动器要用的正是这条路径）', async () => {
    mockInstances([inst({ id: V1, name: '我的世界' })]);
    render(<GameLauncherPanel />);
    await expandSettings();
    const input = (await screen.findByLabelText('Java 路径')) as HTMLInputElement;
    const java = 'D:\\Java\\jdk-25\\bin\\java.exe';
    fireEvent.change(input, { target: { value: java } });
    expect(m.updateInstance).not.toHaveBeenCalled();
    fireEvent.blur(input, { target: { value: java } });
    await waitFor(() =>
      expect(m.updateInstance).toHaveBeenCalledWith({ id: V1, patch: { javaPath: java } }),
    );
  });

  it('用户名没改时失焦不发 IPC（无谓写盘）', async () => {
    mockInstances([inst({ id: V1, name: '我的世界', username: 'Steve' })]);
    render(<GameLauncherPanel />);
    await expandSettings();
    fireEvent.blur(await screen.findByLabelText('用户名'), { target: { value: 'Steve' } });
    expect(m.updateInstance).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// 详情 tab 区（§4.3）
// ===========================================================================
describe('L2 · 实例详情 tab 区', () => {
  async function openDetail() {
    mockInstances([inst({ id: V1, name: '我的世界' })]);
    render(<GameLauncherPanel />);
    return waitForDetail();
  }

  it('七个 tab 齐备：内容 / 实例目录 / 世界 / 日志 / 皮肤 / 分享 / 设置', async () => {
    await openDetail();
    for (const label of ['内容', '实例目录', '世界', '日志', '皮肤', '分享', '设置']) {
      expect(screen.getByRole('tab', { name: label })).toBeTruthy();
    }
  });

  it('默认停在「内容」tab', async () => {
    await openDetail();
    expect(screen.getByRole('tab', { name: '内容' }).getAttribute('aria-selected')).toBe('true');
    await waitFor(() => expect(m.listMods).toHaveBeenCalledWith({ instance: V1 }));
  });

  it('切到「实例目录」tab 拉目录列表', async () => {
    await openDetail();
    fireEvent.click(screen.getByRole('tab', { name: '实例目录' }));
    // 注意：组件 prop 叫 versionId（对齐 InstanceSummary），但 IPC 契约字段是 version
    await waitFor(() =>
      expect(m.listInstanceFiles).toHaveBeenCalledWith({ instance: V1, path: '' }),
    );
  });

  it('切到「日志」tab 渲染日志面板', async () => {
    await openDetail();
    fireEvent.click(screen.getByRole('tab', { name: '日志' }));
    expect(await screen.findByLabelText('搜索日志')).toBeTruthy();
  });

  it('切到「世界」tab 拉取世界列表', async () => {
    m.listWorlds.mockResolvedValue({ worlds: [], error: null });
    await openDetail();
    fireEvent.click(screen.getByRole('tab', { name: '世界' }));
    await waitFor(() => expect(m.listWorlds).toHaveBeenCalledWith({ instance: V1 }));
  });

  it('未实现的 tab 如实说明，不用空壳假装有内容', async () => {
    await openDetail();
    fireEvent.click(screen.getByRole('tab', { name: '分享' }));
    expect(await screen.findByText(/尚未实现/)).toBeTruthy();
  });
});

// ===========================================================================
// 加载器 / 皮肤
// ===========================================================================
describe('L2 · 加载器与皮肤', () => {
  async function openDetail() {
    mockInstances([inst({ id: V1, name: '我的世界' })]);
    render(<GameLauncherPanel />);
    return waitForDetail();
  }

  it('装 Fabric 调用对应 IPC', async () => {
    await openDetail();
    fireEvent.click(screen.getByRole('button', { name: /装 Fabric/ }));
    await waitFor(() =>
      expect(m.installLoader).toHaveBeenCalledWith({ version: V1, loader: 'fabric', instance: V1 }),
    );
    expect(await screen.findByText('Fabric 加载器安装完成')).toBeTruthy();
  });

  it('皮肤 API URL 可编辑并传给安装 IPC', async () => {
    await openDetail();
    const input = screen.getByLabelText('皮肤站 Yggdrasil API URL');
    fireEvent.change(input, { target: { value: 'https://example.test/api/yggdrasil' } });
    fireEvent.click(screen.getByRole('button', { name: /装皮肤支持/ }));
    await waitFor(() =>
      expect(m.installSkin).toHaveBeenCalledWith({
        instance: V1,
        skinApiUrl: 'https://example.test/api/yggdrasil',
      }),
    );
    expect(await screen.findByText('离线皮肤支持已安装（CustomSkinLoader）')).toBeTruthy();
  });
});

// ===========================================================================
// 次入口
// ===========================================================================
describe('L2 · 次入口（离线已有安装）', () => {
  it('打开独立弹窗后可自动定位 MC 安装', async () => {
    render(<GameLauncherPanel />);
    const entry = screen.getByRole('button', { name: /使用已有的 MC 安装/ });
    fireEvent.click(entry);
    expect(entry.getAttribute('aria-expanded')).toBe('true');
    const dialog = await screen.findByRole('dialog', { name: '使用已有的 MC 安装' });
    fireEvent.click(within(dialog).getByRole('button', { name: /自动定位/ }));
    await waitFor(() => expect(m.locateMc).toHaveBeenCalled());
    expect((await within(dialog).findAllByText(/D:\/mc\/\.minecraft/)).length).toBeGreaterThan(0);
  });

  it('无构建产物时「安装 Mod」禁用', async () => {
    render(<GameLauncherPanel />);
    fireEvent.click(screen.getByRole('button', { name: /使用已有的 MC 安装/ }));
    const dialog = await screen.findByRole('dialog', { name: '使用已有的 MC 安装' });
    fireEvent.click(within(dialog).getByRole('button', { name: /自动定位/ }));
    await within(dialog).findAllByText(/D:\/mc\/\.minecraft/);
    const btn = within(dialog).getByRole('button', { name: /安装 Mod（需先构建）/ });
    expect((btn as HTMLButtonElement).disabled).toBe(true);
  });

  it('有构建产物时可安装到该安装', async () => {
    resetStore([{ path: 'out/my.jar', content: 'PK' }]);
    render(<GameLauncherPanel />);
    fireEvent.click(screen.getByRole('button', { name: /使用已有的 MC 安装/ }));
    const dialog = await screen.findByRole('dialog', { name: '使用已有的 MC 安装' });
    fireEvent.click(within(dialog).getByRole('button', { name: /自动定位/ }));
    await within(dialog).findAllByText(/D:\/mc\/\.minecraft/);
    fireEvent.click(within(dialog).getByRole('button', { name: /安装当前 Mod 到该安装/ }));
    await waitFor(() => expect(m.installMod).toHaveBeenCalled());
  });
});

// ===========================================================================
// 挂载/卸载卫生
// ===========================================================================
describe('L2 · 挂载卸载卫生', () => {
  it('全程无 console.error（无 React act 警告）', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mockInstances([inst({ id: V1, name: '我的世界' })]);
    const { unmount } = render(<GameLauncherPanel />);
    await waitForDetail();
    unmount();
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('卸载后不再发 IPC', async () => {
    mockInstances([inst({ id: V1, name: '我的世界' })]);
    const { unmount } = render(<GameLauncherPanel />);
    await waitForDetail();
    await waitFor(() => expect(m.listMods).toHaveBeenCalled());
    const before = m.listMods.mock.calls.length;
    unmount();
    expect(m.listMods.mock.calls.length).toBe(before);
  });
});

/**
 * 服务端页签曾经一点就炸：主进程返回 `{ instances }`，渲染层按裸数组收，
 * `serverInstances.map is not a function`。上面的 mock 以前直接返回数组，
 * 恰好把这个形状错位盖住了 —— 现在 mock 用**真实信封**，并断言渲染结果。
 */
describe('L7 · 服务端页签', () => {
  it('按真实信封 `{ instances }` 渲染实例列表', async () => {
    m.listServerInstances.mockResolvedValue({
      instances: [
        {
          id: 'srv-1',
          name: '朋友的服',
          versionId: V1,
          jarKind: 'bundler',
          eulaAccepted: false,
          createdAt: 1_700_000_000_000,
        },
      ],
      error: null,
    });
    render(<GameLauncherPanel />);
    fireEvent.click(await screen.findByRole('tab', { name: '服务端' }));
    expect(await screen.findByText('服务端实例（1）')).toBeTruthy();
    expect(screen.getByText('朋友的服')).toBeTruthy();
  });

  it('创建表单的版本选择不会被受控 value 重置，提交时把真实版本发给主进程', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<GameLauncherPanel />);
    fireEvent.click(await screen.findByRole('tab', { name: '服务端' }));

    fireEvent.change(screen.getByLabelText('服务端实例名'), {
      target: { value: 'srv-test' },
    });
    fireEvent.change(screen.getByLabelText('选择 MC 版本'), {
      target: { value: V1 },
    });
    // 这是旧实现的断点：选完立刻被 React 重置为空串，创建按钮静默无反应。
    expect((screen.getByLabelText('选择 MC 版本') as HTMLSelectElement).value).toBe(V1);

    fireEvent.click(screen.getByRole('button', { name: '创建' }));

    await waitFor(() =>
      expect(m.createServerInstance).toHaveBeenCalledWith({
        serverId: 'srv-test',
        version: V1,
        acceptEula: true,
      }),
    );
    // 成功后才清空，避免用户以为没提交
    await waitFor(() =>
      expect((screen.getByLabelText('服务端实例名') as HTMLInputElement).value).toBe(''),
    );
    confirmSpy.mockRestore();
  });

  it('创建表单：没选版本时不弹 EULA、不发 IPC，错误显示在服务端页', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<GameLauncherPanel />);
    fireEvent.click(await screen.findByRole('tab', { name: '服务端' }));

    fireEvent.change(screen.getByLabelText('服务端实例名'), {
      target: { value: 'srv-test' },
    });
    fireEvent.click(screen.getByRole('button', { name: '创建' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('请选择 MC 版本');
    expect(m.createServerInstance).not.toHaveBeenCalled();
    expect(confirmSpy).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it('运行中的实例显示状态与「停止」按钮，停止走主进程确认闸门', async () => {
    m.listServerInstances.mockResolvedValue({
      instances: [
        {
          id: 'srv-1',
          name: '朋友的服',
          versionId: V1,
          jarKind: 'bundler',
          eulaAccepted: true,
          createdAt: 1_700_000_000_000,
        },
      ],
      error: null,
    });
    m.processStatus.mockResolvedValue({
      status: serverStatus({ serverId: 'srv-1', state: 'running', pid: 4242 }),
    });
    render(<GameLauncherPanel />);
    fireEvent.click(await screen.findByRole('tab', { name: '服务端' }));

    // 状态标签与启动按钮都会显示「运行中」，所以断言 PID 与停止按钮更精确。
    expect(await screen.findByText('PID 4242')).toBeTruthy();
    expect(screen.getByRole('button', { name: '运行中' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '停止' }));
    await waitFor(() => expect(m.processStop).toHaveBeenCalledWith('srv-1'));
  });

  it('原生弹窗点取消时显示「已取消启动」，不弹红色错误横幅', async () => {
    m.listServerInstances.mockResolvedValue({
      instances: [
        {
          id: 'srv-1',
          name: '朋友的服',
          versionId: V1,
          jarKind: 'bundler',
          eulaAccepted: true,
          createdAt: 1_700_000_000_000,
        },
      ],
      error: null,
    });
    // denied 与 error 会同时返回（error 只是给日志的说明），UI 必须先判 denied。
    m.processLaunch.mockResolvedValue({
      ok: false,
      pid: null,
      denied: true,
      error: '用户取消了启动',
    });
    render(<GameLauncherPanel />);
    fireEvent.click(await screen.findByRole('tab', { name: '服务端' }));

    fireEvent.click(await screen.findByRole('button', { name: '启动' }));

    expect(await screen.findByText('已取消启动')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
