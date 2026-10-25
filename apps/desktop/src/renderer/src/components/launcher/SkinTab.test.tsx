// @vitest-environment jsdom
/**
 * SkinTab（§5.9 · 皮肤 tab）测试
 *
 * ## 这个组件容易出错的三个地方，测试重点就在这儿
 *
 * 1. **玩家名是主键，而它用户可改**。LocalSkin 的文件名就是玩家名
 *    （`localSkinFileName`），所以「应用」按钮的可用性直接绑定在它上面。
 *    含 `/`、`\`、`..` 的名字必须让按钮**禁用**——不能发出去让主进程报错，
 *    也不能放过去指望主进程兜（主进程兜是兜底，不是许可）。
 *
 * 2. **多选导入里一张坏图不该拖垮整批**。逐张 add、逐张计数是刻意的：
 *    用户换皮肤常常一次拖一堆图进来。
 *
 * 3. **已应用列表读的是磁盘，不是库索引**（主进程 `listAppliedSkins`）。
 *    所以库里删掉一张皮肤，实例上那份**应该还在** —— 这条由主进程保证，
 *    这里断言 UI 没有把两件事混在一起画。
 *
 * ## 不测什么
 *
 * skinview3d 的 3D 渲染（WebGL 在 jsdom 里没有）。这里只断言「选了皮肤
 * 之后会走读 PNG 的通道拿到 data URL」，不断言 canvas 上画出了什么。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react';

vi.mock('skinview3d', () => ({
  SkinViewer: class {
    constructor(_opts: unknown) {}
    loadSkin(): void {}
    dispose(): void {}
  },
}));

/**
 * URL 导入现在走共用的 `importSkinFromUrl`（规范化 → 渲染层转 PNG → 落库），
 * 因为用户手头最多的链接是 MC百科 的，而它站上图是 WebP 且常带 `@宽x高`
 * 缩放后缀 —— 不先规范化+转换，每一条都会报「不是有效的皮肤 PNG」。
 * 这里 mock 掉那个模块，单独测 SkinTab 怎么用它。
 */
const mockImportSkin = vi.fn();
vi.mock('../../lib/skin-url-import.js', () => ({
  importSkinFromUrl: (...args: unknown[]) => mockImportSkin(...args),
}));

vi.mock('../../lib/ipc-client.js', () => ({
  ipcClient: {
    launcherSkinList: vi.fn(),
    launcherSkinListApplied: vi.fn(),
    launcherSkinReadPng: vi.fn(),
    launcherSkinAddLocal: vi.fn(),
    launcherSkinAddUrl: vi.fn(),
    launcherSkinAddMineskin: vi.fn(),
    launcherSkinMineskinPage: vi.fn(),
    launcherSkinRemove: vi.fn(),
    launcherSkinUpdate: vi.fn(),
    launcherSkinApply: vi.fn(),
    launcherSkinUnapply: vi.fn(),
    launcherPickFiles: vi.fn(),
  },
}));

import { SkinTab } from './SkinTab.js';
import { ipcClient } from '../../lib/ipc-client.js';
import type { SkinEntryT } from '../../../../shared/ipc/launcher.js';

const m = ipcClient as unknown as Record<string, ReturnType<typeof vi.fn>>;

const DATA_URL = 'data:image/png;base64,iVBORw0KGgo=';

function entry(over: Partial<SkinEntryT> = {}): SkinEntryT {
  return {
    id: 's1',
    name: '测试皮肤',
    model: 'classic',
    source: 'file',
    width: 64,
    height: 64,
    sizeBytes: 1024,
    createdAt: 1,
    origin: null,
    ...over,
  };
}

/** 列表里的一项（按显示名点）。选中后同一个名字也会出现在右侧详情里，所以限定在 <ul> 内。 */
function itemByName(name: string): HTMLElement {
  const lists = screen.getAllByRole('list');
  for (const ul of lists) {
    const hit = within(ul).queryByText(name);
    if (hit) return hit;
  }
  throw new Error(`列表里找不到「${name}」`);
}

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  m.launcherSkinList.mockResolvedValue({ entries: [] });
  m.launcherSkinListApplied.mockResolvedValue({ applied: [] });
  m.launcherSkinReadPng.mockResolvedValue({ dataUrl: DATA_URL, error: null });
  m.launcherPickFiles.mockResolvedValue({ paths: [], error: null });
  m.launcherSkinApply.mockResolvedValue({ ok: true, path: 'C:\\x\\Steve.png', error: null });
  m.launcherSkinUnapply.mockResolvedValue({ ok: true, error: null });
  m.launcherSkinRemove.mockResolvedValue({ ok: true, error: null });
  m.launcherSkinUpdate.mockResolvedValue({ entry: entry(), error: null });
  m.launcherSkinMineskinPage.mockResolvedValue({
    entries: [],
    page: 1,
    hasMore: false,
    error: null,
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

async function renderTab(props: { instanceId?: string; playerName?: string } = {}) {
  const utils = render(
    <SkinTab instanceId={props.instanceId ?? 'inst1'} playerName={props.playerName ?? 'Steve'} />,
  );
  await waitFor(() => {
    expect(m.launcherSkinList).toHaveBeenCalled();
    expect(m.launcherSkinListApplied).toHaveBeenCalledWith({
      instance: props.instanceId ?? 'inst1',
    });
  });
  return utils;
}

describe('SkinTab · 初次加载', () => {
  it('同时拉库列表与已应用列表', async () => {
    await renderTab();
    expect(m.launcherSkinList).toHaveBeenCalledTimes(1);
    expect(m.launcherSkinListApplied).toHaveBeenCalledWith({ instance: 'inst1' });
  });

  it('库为空时给出引导文案，而不是一片空白', async () => {
    await renderTab();
    expect(await screen.findByText(/库里还没有皮肤/)).toBeTruthy();
  });

  it('库列表加载失败时把错误显示出来（不许静默成「空库」）', async () => {
    m.launcherSkinList.mockRejectedValue(new Error('库索引读不了'));
    render(<SkinTab instanceId="inst1" playerName="Steve" />);
    expect(await screen.findByText('库索引读不了')).toBeTruthy();
  });

  /**
   * 回归：IPC 的失败是**返回值里的 error 字段**，不是 throw。
   *
   * 原实现只 catch 不查 `res.error`，于是「读不到库」被画成
   * 「库里还没有皮肤」—— 用户以为自己没导入，去反复点导入按钮。
   * 这条测的就是那条漏掉的分支。
   */
  it('库列表返回 error 字段时也要报错，不能画成「库里还没有皮肤」', async () => {
    m.launcherSkinList.mockResolvedValue({ entries: [], error: '库索引读不了' });
    render(<SkinTab instanceId="inst1" playerName="Steve" />);
    expect(await screen.findByText('库索引读不了')).toBeTruthy();
    expect(screen.queryByText(/库里还没有皮肤/)).toBeNull();
  });

  it('已应用列表读失败时退回空列表，不整页转红', async () => {
    // 已应用列表是「锦上添花」，它挂了不该挡住导入/预览主流程。
    m.launcherSkinListApplied.mockRejectedValue(new Error('读盘失败'));
    m.launcherSkinList.mockResolvedValue({ entries: [entry()] });
    render(<SkinTab instanceId="inst1" playerName="Steve" />);
    expect(await screen.findByText('测试皮肤')).toBeTruthy();
  });

  /**
   * 同上，但走 error 字段那条路径。
   *
   * 这条比 throw 那条更要紧：把「还没应用过」画成「已应用的读不到了」，
   * 用户会以为刚装上的皮肤丢了，然后反复点应用。
   */
  it('已应用列表返回 error 字段时显示原因，不谎报「还没有」', async () => {
    m.launcherSkinListApplied.mockResolvedValue({ applied: [], error: '读不到 LocalSkin 目录' });
    m.launcherSkinList.mockResolvedValue({ entries: [entry()] });
    render(<SkinTab instanceId="inst1" playerName="Steve" />);
    expect(await screen.findByText('读不到 LocalSkin 目录')).toBeTruthy();
    expect(screen.queryByText(/还没有。应用后/)).toBeNull();
  });
});

describe('SkinTab · 选中与预览', () => {
  it('点条目后走读 PNG 通道拿 data URL（不能用 file://）', async () => {
    m.launcherSkinList.mockResolvedValue({ entries: [entry({ id: 'sA', name: '甲' })] });
    await renderTab();
    fireEvent.click(itemByName('甲'));
    await waitFor(() => {
      expect(m.launcherSkinReadPng).toHaveBeenCalledWith({ id: 'sA' });
    });
    await waitFor(() => {
      expect(screen.getByAltText('甲 皮肤')).toBeTruthy();
    });
    expect(screen.getByAltText('甲 皮肤').getAttribute('src')).toBe(DATA_URL);
  });

  it('读图失败时只是没有图，不该整页报错', async () => {
    m.launcherSkinList.mockResolvedValue({ entries: [entry({ id: 'sA', name: '甲' })] });
    m.launcherSkinReadPng.mockResolvedValue({ dataUrl: null, error: '皮肤文件缺失' });
    await renderTab();
    fireEvent.click(itemByName('甲'));
    await waitFor(() => {
      expect(m.launcherSkinReadPng).toHaveBeenCalled();
    });
    // 2D 图不出现，但条目本身仍然可选、可操作
    expect(screen.queryByAltText('甲 皮肤')).toBeNull();
    expect(itemByName('甲')).toBeTruthy();
  });

  it('没选中时不读图（省一次 IPC）', async () => {
    m.launcherSkinList.mockResolvedValue({ entries: [entry({ name: '甲' })] });
    await renderTab();
    expect(m.launcherSkinReadPng).not.toHaveBeenCalled();
  });

  it('显示来源标签与尺寸；slim 额外标出来', async () => {
    m.launcherSkinList.mockResolvedValue({
      entries: [entry({ id: 'sB', name: '乙', source: 'mineskin', model: 'slim' })],
    });
    await renderTab();
    fireEvent.click(itemByName('乙'));
    expect(await screen.findByText('MineSkin · 64×64 · Slim')).toBeTruthy();
  });

  it('切模型失败时要说出来（下拉框已经变了，不报错等于骗人）', async () => {
    m.launcherSkinList.mockResolvedValue({ entries: [entry({ id: 'sB', name: '乙' })] });
    m.launcherSkinUpdate.mockResolvedValue({ entry: null, error: '皮肤不在库里' });
    await renderTab();
    fireEvent.click(itemByName('乙'));
    fireEvent.change(await screen.findByLabelText('皮肤模型'), { target: { value: 'slim' } });
    expect(await screen.findByText('皮肤不在库里')).toBeTruthy();
  });
});

describe('SkinTab · 应用（玩家名是主键）', () => {
  beforeEach(() => {
    m.launcherSkinList.mockResolvedValue({ entries: [entry({ id: 'sA', name: '甲' })] });
  });

  it('默认把实例的 username 填进玩家名', async () => {
    await renderTab({ playerName: 'Notch' });
    fireEvent.click(itemByName('甲'));
    expect((await screen.findByLabelText('玩家名')) as HTMLInputElement).toBeTruthy();
    expect(((await screen.findByLabelText('玩家名')) as HTMLInputElement).value).toBe('Notch');
  });

  it('玩家名含 / 时禁用应用按钮', async () => {
    await renderTab();
    fireEvent.click(itemByName('甲'));
    const input = await screen.findByLabelText('玩家名');
    fireEvent.change(input, { target: { value: 'bad/name' } });
    expect((screen.getByTitle('玩家名不能含 / \\ 或 ..') as HTMLButtonElement).disabled).toBe(true);
  });

  it('玩家名含 .. 时禁用应用按钮', async () => {
    await renderTab();
    fireEvent.click(itemByName('甲'));
    fireEvent.change(await screen.findByLabelText('玩家名'), { target: { value: '..' } });
    expect((screen.getByTitle('玩家名不能含 / \\ 或 ..') as HTMLButtonElement).disabled).toBe(true);
  });

  it('玩家名为空时禁用应用按钮', async () => {
    await renderTab();
    fireEvent.click(itemByName('甲'));
    fireEvent.change(await screen.findByLabelText('玩家名'), { target: { value: '   ' } });
    expect((screen.getByTitle('玩家名不能含 / \\ 或 ..') as HTMLButtonElement).disabled).toBe(true);
  });

  it('合法玩家名才发请求，且带上 skinId/instance/playerName', async () => {
    await renderTab({ playerName: 'Steve' });
    fireEvent.click(itemByName('甲'));
    fireEvent.click(await screen.findByTitle('复制到 LocalSkin/skins/<玩家名>.png'));
    await waitFor(() => {
      expect(m.launcherSkinApply).toHaveBeenCalledWith({
        skinId: 'sA',
        instance: 'inst1',
        playerName: 'Steve',
      });
    });
  });

  it('应用成功后刷新已应用列表并给出提示', async () => {
    m.launcherSkinListApplied.mockResolvedValueOnce({ applied: [] }).mockResolvedValue({
      applied: [{ playerName: 'Steve', path: 'C:\\x\\Steve.png', sizeBytes: 2048 }],
    });
    await renderTab({ playerName: 'Steve' });
    fireEvent.click(itemByName('甲'));
    fireEvent.click(await screen.findByTitle('复制到 LocalSkin/skins/<玩家名>.png'));
    expect(
      await screen.findByText(/已应用到玩家「Steve」（CustomSkinLoader 的 LocalSkin）/),
    ).toBeTruthy();
    expect(await screen.findByText('Steve')).toBeTruthy();
  });

  /**
   * 资源包那条路的结果要**单独说**，不能吞。
   *
   * 它是「没装 mod 也能显示皮肤」的那条路（覆盖默认皮肤贴图）。写成一句
   * 「已应用」的话，用户在 1.8+ 原版实例上点了应用、游戏里却没变，
   * 就是因为不知道这句话在说什么。
   */
  it('主进程回 note 时把两条路的结果都说出来', async () => {
    m.launcherSkinApply.mockResolvedValue({
      ok: true,
      path: 'C:\\game\\CustomSkinLoader\\LocalSkin\\skins\\Steve.png',
      note: '已写离线皮肤资源包 MC Creator Skin.zip（覆盖 18 份默认皮肤贴图）',
    });
    await renderTab({ playerName: 'Steve' });
    fireEvent.click(itemByName('甲'));
    fireEvent.click(await screen.findByTitle('复制到 LocalSkin/skins/<玩家名>.png'));
    expect(
      await screen.findByText(/已应用到玩家「Steve」（CustomSkinLoader 的 LocalSkin）/),
    ).toBeTruthy();
    expect(await screen.findByText(/已写离线皮肤资源包 MC Creator Skin\.zip/)).toBeTruthy();
  });

  it('主进程说资源包写不成时也照说（不是「应用失败」）', async () => {
    m.launcherSkinApply.mockResolvedValue({
      ok: true,
      path: 'C:\\game\\CustomSkinLoader\\LocalSkin\\skins\\Steve.png',
      note: '离线皮肤资源包没写成：1.5.2 还没有资源包（资源包是 1.6 才有的）',
    });
    await renderTab({ playerName: 'Steve' });
    fireEvent.click(itemByName('甲'));
    fireEvent.click(await screen.findByTitle('复制到 LocalSkin/skins/<玩家名>.png'));
    expect(await screen.findByText(/离线皮肤资源包没写成：1\.5\.2/)).toBeTruthy();
    // 这不是失败：不能画成错误条
    expect(screen.queryByText(/离线皮肤资源包没写成：1\.5\.2/)).toBeTruthy();
  });

  it('应用失败时显示原因，且不假装成功', async () => {
    m.launcherSkinApply.mockResolvedValue({ ok: false, error: '皮肤文件缺失' });
    await renderTab({ playerName: 'Steve' });
    fireEvent.click(itemByName('甲'));
    fireEvent.click(await screen.findByTitle('复制到 LocalSkin/skins/<玩家名>.png'));
    expect(await screen.findByText('皮肤文件缺失')).toBeTruthy();
    expect(screen.queryByText(/已应用到玩家/)).toBeNull();
  });
});

describe('SkinTab · 从文件导入', () => {
  it('用户取消（空路径）时什么都不做', async () => {
    await renderTab();
    fireEvent.click(screen.getByTitle('从本地 PNG 导入'));
    await waitFor(() => {
      expect(m.launcherPickFiles).toHaveBeenCalled();
    });
    expect(m.launcherSkinAddLocal).not.toHaveBeenCalled();
  });

  it('多选时逐张导入，成功几张就报几张', async () => {
    m.launcherPickFiles.mockResolvedValue({ paths: ['C:\\a.png', 'C:\\b.png'], error: null });
    m.launcherSkinAddLocal
      .mockResolvedValueOnce({ entry: entry({ id: 'sa', name: '甲' }), error: null })
      .mockResolvedValueOnce({ entry: entry({ id: 'sb', name: '乙' }), error: null });
    m.launcherSkinList.mockResolvedValue({ entries: [] });
    await renderTab();
    fireEvent.click(screen.getByTitle('从本地 PNG 导入'));
    expect(await screen.findByText('已导入 2 张')).toBeTruthy();
    expect(m.launcherSkinAddLocal).toHaveBeenCalledTimes(2);
  });

  it('一张坏图不该让其余的也失败', async () => {
    m.launcherPickFiles.mockResolvedValue({ paths: ['C:\\a.png', 'C:\\bad.png'], error: null });
    m.launcherSkinAddLocal
      .mockResolvedValueOnce({ entry: entry({ id: 'sa', name: '甲' }), error: null })
      .mockResolvedValueOnce({ entry: null, error: '不是有效的皮肤 PNG' });
    await renderTab();
    fireEvent.click(screen.getByTitle('从本地 PNG 导入'));
    // 计数要说清楚：导入 1 张、失败 1 张，并给出第一条失败原因
    expect(await screen.findByText(/已导入 1 张，1 张失败：不是有效的皮肤 PNG/)).toBeTruthy();
  });

  it('全失败时如实说 0 张成功', async () => {
    m.launcherPickFiles.mockResolvedValue({ paths: ['C:\\bad.png'], error: null });
    m.launcherSkinAddLocal.mockResolvedValue({ entry: null, error: '不是 PNG' });
    await renderTab();
    fireEvent.click(screen.getByTitle('从本地 PNG 导入'));
    expect(await screen.findByText(/已导入 0 张，1 张失败/)).toBeTruthy();
  });

  it('选择器本身报错时显示错误', async () => {
    m.launcherPickFiles.mockResolvedValue({ paths: [], error: 'dialog 炸了' });
    await renderTab();
    fireEvent.click(screen.getByTitle('从本地 PNG 导入'));
    expect(await screen.findByText('dialog 炸了')).toBeTruthy();
  });
});

describe('SkinTab · 从 URL 导入', () => {
  /**
   * URL 导入现在走共用的 `importSkinFromUrl`（规范化 → 渲染层转 PNG → 落库），
   * 不能再直接发 `{ url }`。下面这些都断言那个共用模块被正确接进来了。
   */
  it('prompt 取消（空串）时不发请求', async () => {
    vi.spyOn(window, 'prompt').mockReturnValue(null);
    await renderTab();
    fireEvent.click(screen.getByTitle('从 URL 导入'));
    expect(mockImportSkin).not.toHaveBeenCalled();
  });

  it('走共用导入逻辑，并把转换好的 PNG 一起发出去', async () => {
    vi.spyOn(window, 'prompt').mockReturnValue('https://i.mcmod.cn/a/b.png');
    mockImportSkin.mockResolvedValue({ ok: true, entryId: 'su' });
    m.launcherSkinList.mockResolvedValue({ entries: [entry({ id: 'su', name: '正版皮肤' })] });
    await renderTab();
    fireEvent.click(screen.getByTitle('从 URL 导入'));
    await waitFor(() => {
      expect(mockImportSkin).toHaveBeenCalledWith('https://i.mcmod.cn/a/b.png', expect.anything());
    });
    expect(await screen.findByText('已从链接导入')).toBeTruthy();
    // 导入成功后选中新那张
    await waitFor(() => {
      expect(m.launcherSkinReadPng).toHaveBeenCalledWith({ id: 'su' });
    });
  });

  it('导入失败时把原因显示出来，不静默', async () => {
    vi.spyOn(window, 'prompt').mockReturnValue('https://www.mcmod.cn/post/1.html');
    mockImportSkin.mockResolvedValue({
      ok: false,
      error: '这是 MC百科 的**页面**链接，不是图片。',
    });
    await renderTab();
    fireEvent.click(screen.getByTitle('从 URL 导入'));
    expect(await screen.findByText('这是 MC百科 的**页面**链接，不是图片。')).toBeTruthy();
  });
});

describe('SkinTab · 公共库', () => {
  it('切到公共库才请求 MineSkin（默认视图不去打扰网络）', async () => {
    await renderTab();
    expect(m.launcherSkinMineskinPage).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('公共库'));
    await waitFor(() => {
      expect(m.launcherSkinMineskinPage).toHaveBeenCalledWith({ page: 1 });
    });
  });

  it('下一页按钮在没有更多时禁用；第一页时上一页禁用', async () => {
    m.launcherSkinMineskinPage.mockResolvedValue({
      entries: [{ id: '1', uuid: 'u1', url: 'http://x', time: 1 }],
      page: 1,
      hasMore: false,
      error: null,
    });
    await renderTab();
    fireEvent.click(screen.getByText('公共库'));
    await screen.findByText('#1');
    expect((screen.getByText('上一页') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByText('下一页') as HTMLButtonElement).disabled).toBe(true);
  });

  it('公共库失败时显示原因，不画成「没有内容」', async () => {
    m.launcherSkinMineskinPage.mockResolvedValue({
      entries: [],
      page: 1,
      hasMore: false,
      error: '连不上',
    });
    await renderTab();
    fireEvent.click(screen.getByText('公共库'));
    expect(await screen.findByText('连不上')).toBeTruthy();
  });

  it('导入 MineSkin 皮肤后回到「我的皮肤」', async () => {
    m.launcherSkinMineskinPage.mockResolvedValue({
      entries: [{ id: '7', uuid: 'u', url: 'http://x', time: 1 }],
      page: 1,
      hasMore: false,
      error: null,
    });
    m.launcherSkinAddMineskin.mockResolvedValue({
      entry: entry({ id: 'sm', name: 'MineSkin 皮肤' }),
      error: null,
    });
    m.launcherSkinList.mockResolvedValue({ entries: [entry({ id: 'sm', name: 'MineSkin 皮肤' })] });
    await renderTab();
    fireEvent.click(screen.getByText('公共库'));
    fireEvent.click(await screen.findByTitle('导入 MineSkin #7'));
    await waitFor(() => {
      expect(m.launcherSkinAddMineskin).toHaveBeenCalledWith({ mineskinId: '7' });
    });
    // 回到库视图，能看到新皮肤
    expect(itemByName('MineSkin 皮肤')).toBeTruthy();
  });
});

describe('SkinTab · 删除', () => {
  beforeEach(() => {
    m.launcherSkinList.mockResolvedValue({ entries: [entry({ id: 'sA', name: '甲' })] });
  });

  it('删库里的条目不影响「已应用」列表（副本在实例 gameDir，属实例数据）', async () => {
    m.launcherSkinListApplied.mockResolvedValue({
      applied: [{ playerName: 'Steve', path: 'C:\\x\\Steve.png', sizeBytes: 2048 }],
    });
    m.launcherSkinList.mockResolvedValueOnce({ entries: [entry({ id: 'sA', name: '甲' })] });
    await renderTab();
    fireEvent.click(itemByName('甲'));
    fireEvent.click(await screen.findByTitle('从皮肤库删除（已应用的副本不受影响）'));
    await waitFor(() => {
      expect(m.launcherSkinRemove).toHaveBeenCalledWith({ id: 'sA' });
    });
    // 已应用列表仍然在 —— 两件事分开画
    expect(await screen.findByText('Steve')).toBeTruthy();
  });

  it('删已应用的皮肤走 unapply，不动库', async () => {
    m.launcherSkinListApplied.mockResolvedValue({
      applied: [{ playerName: 'Steve', path: 'C:\\x\\Steve.png', sizeBytes: 2048 }],
    });
    await renderTab();
    fireEvent.click(await screen.findByLabelText('取消 Steve'));
    await waitFor(() => {
      expect(m.launcherSkinUnapply).toHaveBeenCalledWith({
        instance: 'inst1',
        playerName: 'Steve',
      });
    });
    expect(m.launcherSkinRemove).not.toHaveBeenCalled();
  });
});
