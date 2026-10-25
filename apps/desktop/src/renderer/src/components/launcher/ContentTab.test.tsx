// @vitest-environment jsdom
/**
 * ContentTab（L6 · 内容 tab）测试
 *
 * ## 这个组件为什么会炸过一次
 *
 * 旧 GameLauncherPanel 的用例把 `launcherListMods` 打成 `{ mods: ['fabric-api.jar'] }`
 * （`string[]`），而主进程真实返回 `ModInfo[]`（对象）。于是「state 声明成 `string[]`
 * + 渲染写 `{m}`」这对错误在测试里自洽，测试全绿，运行时才炸
 * `Objects are not valid as a React child`。
 *
 * 所以本文件的第一条纪律：**fixture 签名收紧到 `ModInfo`**，一旦有人想退回
 * `string[]` 这里会直接编译失败；同时每条渲染用例都显式断言「没有 `[object Object]`」
 * —— 光断言「渲染成功」抓不住 `{m}` 这种错误（对象也能被 React 转成字符串来源）。
 *
 * ## 第二条纪律：契约允许 `{ ok: false, error: null }`
 *
 * `LauncherToggleModResponse.error` 是 `.nullable().optional()`，也就是说
 * 「失败了但没说为什么」是**合法响应**，不是异常。只判 `res.error` 的实现会留下
 * 一条永不回滚的乐观更新：UI 显示已禁用，磁盘上还是启用的。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react';
import { ContentTab, formatBytes } from './ContentTab.js';
import type { ModInfo } from '../../../../shared/ipc/launcher.js';

vi.mock('../../lib/ipc-client.js', () => ({
  ipcClient: {
    launcherListMods: vi.fn(),
    launcherToggleMod: vi.fn(),
    launcherRemoveMod: vi.fn(),
    launcherInstallMod: vi.fn(),
  },
}));

import { ipcClient } from '../../lib/ipc-client.js';

const mockListMods = ipcClient.launcherListMods as ReturnType<typeof vi.fn>;
const mockToggleMod = ipcClient.launcherToggleMod as ReturnType<typeof vi.fn>;
const mockRemoveMod = ipcClient.launcherRemoveMod as ReturnType<typeof vi.fn>;
const mockInstallMod = ipcClient.launcherInstallMod as ReturnType<typeof vi.fn>;

const V1 = '26.2';
const V2 = '1.21.11';

/** 造一条 ModInfo。**签名刻意收紧到 ModInfo** —— 见文件头说明。 */
function mod(partial: Partial<ModInfo> & { name: string }): ModInfo {
  return { enabled: true, ...partial };
}

const FABRIC = mod({ name: 'fabric-api.jar', enabled: true, size: 2 * 1024 * 1024 });
const SODIUM = mod({ name: 'sodium.jar', enabled: false });
const JEI = mod({ name: 'jei.jar', enabled: true });

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  mockListMods.mockResolvedValue({ mods: [], error: null });
  mockToggleMod.mockResolvedValue({ ok: true, error: null });
  mockRemoveMod.mockResolvedValue({ ok: true, error: null });
  mockInstallMod.mockResolvedValue({ ok: true, path: 'mods/sodium.jar', error: null });
});

afterEach(() => {
  cleanup();
});

/** 渲染并等到首次列表请求落地 */
async function renderTab(instanceId = V1) {
  const utils = render(<ContentTab instanceId={instanceId} />);
  await waitFor(() => {
    expect(mockListMods).toHaveBeenCalledWith({ instance: instanceId });
  });
  return utils;
}

/** 渲染并等到指定 Mod 出现（列表渲染完成的可靠信号） */
async function renderTabWithMods(mods: ModInfo[], instanceId = V1) {
  mockListMods.mockResolvedValue({ mods, error: null });
  return renderTab(instanceId);
}

/** Mod 名称所在的 <span>（禁用态加 line-through） */
function nameSpanOf(name: string): HTMLElement {
  return screen.getByText(name);
}

describe('ContentTab · {ok:false, error:null} 必须被当成失败', () => {
  /**
   * 契约允许 `{ ok: false, error: null }`（error 是 nullable+optional）。
   * 只判 `res.error` 的实现会在这种响应上**静默保留乐观更新**：
   *  - remove：Mod 从 UI 消失，用户以为删掉了，磁盘上还在；
   *  - install：当成成功 → 清空输入框并刷新列表，URL 都没了但安装没发生。
   * 这两条与 toggle 的同名坑同源，必须各自锁死。
   */
  it('删除返回 {ok:false, error:null} → 列表回滚，不能假装删掉了', async () => {
    await renderTabWithMods([FABRIC, SODIUM]);
    mockRemoveMod.mockResolvedValue({ ok: false, error: null });

    fireEvent.click(screen.getByRole('button', { name: `删除 ${FABRIC.name}` }));

    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    // Mod 必须还在
    expect(screen.getByText(FABRIC.name)).toBeTruthy();
  });

  it('安装返回 {ok:false, error:null} → 不清空输入框、不当成功', async () => {
    await renderTab();
    mockInstallMod.mockResolvedValue({ ok: false, error: null });
    const input = screen.getByLabelText('Mod 文件直链') as HTMLInputElement;
    const url = 'https://cdn.modrinth.com/data/x/sodium.jar';
    fireEvent.change(input, { target: { value: url } });

    fireEvent.click(screen.getByRole('button', { name: /安装/ }));

    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    // URL 必须保留，用户才能重试或改
    expect((screen.getByLabelText('Mod 文件直链') as HTMLInputElement).value).toBe(url);
  });
});

describe('ContentTab · 渲染 ModInfo[]', () => {
  it('按 name 渲染，且绝不出现 [object Object]', async () => {
    const { container } = await renderTabWithMods([FABRIC, SODIUM, JEI]);
    expect(screen.getByText('fabric-api.jar')).toBeTruthy();
    expect(screen.getByText('sodium.jar')).toBeTruthy();
    expect(screen.getByText('jei.jar')).toBeTruthy();
    // 本项目真实踩过的崩溃：把对象直接当 React child
    expect(container.textContent).not.toContain('[object Object]');
  });

  it('禁用态加 line-through，启用态不加', async () => {
    await renderTabWithMods([FABRIC, SODIUM]);
    expect(nameSpanOf('fabric-api.jar').className).not.toContain('line-through');
    expect(nameSpanOf('sodium.jar').className).toContain('line-through');
  });

  it('size 存在时显示人类可读大小，undefined 时不显示', async () => {
    await renderTabWithMods([FABRIC, SODIUM]);
    expect(screen.getByText('2.0 MB')).toBeTruthy();
    expect(screen.getByText('sodium.jar').parentElement?.textContent).not.toContain('NaN');
  });

  it('主进程返回 error 时如实显示，不静默当成空列表', async () => {
    mockListMods.mockResolvedValue({ mods: [], error: 'mods 目录不存在' });
    await renderTab();
    expect(screen.getByRole('alert').textContent).toContain('mods 目录不存在');
  });

  it('listMods 抛异常时把异常消息显示出来', async () => {
    mockListMods.mockRejectedValue(new Error('IPC 通道已关闭'));
    await renderTab();
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('IPC 通道已关闭');
    });
  });

  it('versionId 为空时不发请求', () => {
    render(<ContentTab instanceId="" />);
    expect(mockListMods).not.toHaveBeenCalled();
  });

  it('切换 instanceId 重新拉取对应实例的列表', async () => {
    const { rerender } = await renderTab(V1);
    rerender(<ContentTab instanceId={V2} />);
    await waitFor(() => {
      expect(mockListMods).toHaveBeenCalledWith({ instance: V2 });
    });
  });
});

describe('ContentTab · formatBytes', () => {
  it.each([
    [0, '0 B'],
    [512, '512 B'],
    [1024, '1.0 KB'],
    [1536, '1.5 KB'],
    [10 * 1024, '10 KB'],
    [5 * 1024 * 1024, '5.0 MB'],
    [20 * 1024 * 1024, '20 MB'],
    [3 * 1024 * 1024 * 1024, '3.0 GB'],
  ])('%d → %s', (bytes, expected) => {
    expect(formatBytes(bytes)).toBe(expected);
  });
});

describe('ContentTab · 启用/禁用（乐观更新 + 回滚）', () => {
  it('点开关调 launcherToggleMod 并立即乐观更新为禁用', async () => {
    await renderTabWithMods([FABRIC, SODIUM]);
    fireEvent.click(screen.getByLabelText('禁用 fabric-api.jar'));

    // 乐观：不等 IPC 返回就变灰加删除线
    await waitFor(() => {
      expect(nameSpanOf('fabric-api.jar').className).toContain('line-through');
    });
    expect(mockToggleMod).toHaveBeenCalledWith({
      instance: V1,
      name: 'fabric-api.jar',
      enabled: false,
    });
    // 切换不触发重新拉列表
    expect(mockListMods).toHaveBeenCalledTimes(1);
  });

  it('反向切换：禁用 → 启用', async () => {
    await renderTabWithMods([SODIUM]);
    fireEvent.click(screen.getByLabelText('启用 sodium.jar'));
    expect(mockToggleMod).toHaveBeenCalledWith({
      instance: V1,
      name: 'sodium.jar',
      enabled: true,
    });
    await waitFor(() => {
      expect(nameSpanOf('sodium.jar').className).not.toContain('line-through');
    });
  });

  /**
   * 契约允许 `{ ok: false, error: null }`（error 是 nullable+optional）。
   * 只判 `res.error` 的实现会静默保留这次乐观更新 —— UI 说禁用、磁盘上没改。
   */
  it('返回 { ok:false, error:null } 时必须回滚（只看 error 的实现会漏）', async () => {
    mockToggleMod.mockResolvedValue({ ok: false, error: null });
    await renderTabWithMods([FABRIC]);

    fireEvent.click(screen.getByLabelText('禁用 fabric-api.jar'));
    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeTruthy();
    });

    // 回滚：删除线消失、按钮文案回到「禁用」
    expect(nameSpanOf('fabric-api.jar').className).not.toContain('line-through');
    expect(screen.getByLabelText('禁用 fabric-api.jar')).toBeTruthy();
    expect(screen.queryByLabelText('启用 fabric-api.jar')).toBeNull();
    // error 为 null 时必须有兜底文案，不能渲染出空白告警条
    expect(screen.getByRole('alert').textContent).toContain('切换 fabric-api.jar 失败');
  });

  it('返回 { ok:false, error:"boom" } 时回滚并显示后端原因', async () => {
    mockToggleMod.mockResolvedValue({ ok: false, error: 'boom' });
    await renderTabWithMods([FABRIC]);

    fireEvent.click(screen.getByLabelText('禁用 fabric-api.jar'));
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('boom');
    });
    expect(nameSpanOf('fabric-api.jar').className).not.toContain('line-through');
  });

  it('返回 { ok:false, error:null } 时回滚，且不影响其它 Mod 的状态', async () => {
    mockToggleMod.mockResolvedValue({ ok: false, error: null });
    await renderTabWithMods([FABRIC, SODIUM]);

    fireEvent.click(screen.getByLabelText('禁用 fabric-api.jar'));
    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeTruthy();
    });
    // 只回滚被点的那一行
    expect(nameSpanOf('fabric-api.jar').className).not.toContain('line-through');
    expect(nameSpanOf('sodium.jar').className).toContain('line-through');
  });

  it('launcherToggleMod reject 时回滚并显示异常消息', async () => {
    mockToggleMod.mockRejectedValue(new Error('主进程崩了'));
    await renderTabWithMods([FABRIC]);

    fireEvent.click(screen.getByLabelText('禁用 fabric-api.jar'));
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('主进程崩了');
    });
    expect(nameSpanOf('fabric-api.jar').className).not.toContain('line-through');
  });
});

describe('ContentTab · 删除', () => {
  it('删除成功后列表移除该项', async () => {
    await renderTabWithMods([FABRIC, SODIUM]);
    fireEvent.click(screen.getByLabelText('删除 fabric-api.jar'));

    await waitFor(() => {
      expect(screen.queryByText('fabric-api.jar')).toBeNull();
    });
    expect(screen.getByText('sodium.jar')).toBeTruthy();
    expect(mockRemoveMod).toHaveBeenCalledWith({ instance: V1, name: 'fabric-api.jar' });
  });

  it('删除失败（带 error）时回滚', async () => {
    mockRemoveMod.mockResolvedValue({ ok: false, error: '文件被占用' });
    await renderTabWithMods([FABRIC]);

    fireEvent.click(screen.getByLabelText('删除 fabric-api.jar'));
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('文件被占用');
    });
    expect(screen.getByText('fabric-api.jar')).toBeTruthy();
  });

  it('删除 reject 时回滚', async () => {
    mockRemoveMod.mockRejectedValue(new Error('权限不足'));
    await renderTabWithMods([FABRIC]);

    fireEvent.click(screen.getByLabelText('删除 fabric-api.jar'));
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('权限不足');
    });
    expect(screen.getByText('fabric-api.jar')).toBeTruthy();
  });
});

describe('ContentTab · 从 URL 安装', () => {
  const URL_1 = 'https://cdn.modrinth.com/data/AAAA/sodium-0.5.8.jar';

  it('成功后清空输入框并刷新列表', async () => {
    mockListMods.mockResolvedValueOnce({ mods: [], error: null });
    mockListMods.mockResolvedValue({ mods: [FABRIC, SODIUM], error: null });
    await renderTab();

    const input = screen.getByLabelText('Mod 文件直链') as HTMLInputElement;
    fireEvent.change(input, { target: { value: URL_1 } });
    fireEvent.click(screen.getByText('安装'));

    await waitFor(() => {
      expect(mockInstallMod).toHaveBeenCalledWith({
        instance: V1,
        name: 'sodium-0.5.8.jar',
        url: URL_1,
      });
    });
    // 输入框清空
    await waitFor(() => {
      expect(input.value).toBe('');
    });
    // 列表刷新：新装的那个出现在列表里
    await waitFor(() => {
      expect(mockListMods).toHaveBeenCalledTimes(2);
    });
    expect(screen.getByText('sodium.jar')).toBeTruthy();
  });

  it('回车也能触发安装', async () => {
    mockListMods.mockResolvedValue({ mods: [], error: null });
    await renderTab();
    fireEvent.change(screen.getByLabelText('Mod 文件直链'), { target: { value: URL_1 } });
    fireEvent.keyDown(screen.getByLabelText('Mod 文件直链'), { key: 'Enter' });
    await waitFor(() => {
      expect(mockInstallMod).toHaveBeenCalledTimes(1);
    });
  });

  it('失败时保留输入内容、不清空、不刷新列表，并显示错误', async () => {
    mockInstallMod.mockResolvedValue({ ok: false, error: '下载 404' });
    await renderTab();

    const input = screen.getByLabelText('Mod 文件直链') as HTMLInputElement;
    fireEvent.change(input, { target: { value: URL_1 } });
    fireEvent.click(screen.getByText('安装'));

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('下载 404');
    });
    expect(input.value).toBe(URL_1);
    expect(mockListMods).toHaveBeenCalledTimes(1);
  });

  it('install reject 时显示异常消息且不清空输入', async () => {
    mockInstallMod.mockRejectedValue(new Error('网络不可达'));
    await renderTab();

    const input = screen.getByLabelText('Mod 文件直链') as HTMLInputElement;
    fireEvent.change(input, { target: { value: URL_1 } });
    fireEvent.click(screen.getByText('安装'));

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('网络不可达');
    });
    expect(input.value).toBe(URL_1);
  });

  it('输入为空时安装按钮禁用且不发请求', async () => {
    await renderTab();
    expect(screen.getByText('安装').closest('button')?.disabled).toBe(true);
    fireEvent.click(screen.getByText('安装'));
    expect(mockInstallMod).not.toHaveBeenCalled();
  });
});

describe('ContentTab · 搜索（只过滤已装内容）', () => {
  it('按名称过滤已装 Mod，只留命中的那一个', async () => {
    await renderTabWithMods([FABRIC, SODIUM, JEI]);
    fireEvent.change(screen.getByLabelText('搜索已装 Mod'), { target: { value: 'so' } });

    // 三个都已装，只是「so」只命中 sodium
    await waitFor(() => {
      expect(screen.queryByText('fabric-api.jar')).toBeNull();
    });
    expect(screen.queryByText('jei.jar')).toBeNull();
    expect(screen.getByText('sodium.jar')).toBeTruthy();
  });

  it('过滤是纯客户端行为：清空搜索词后全部回归', async () => {
    await renderTabWithMods([FABRIC, SODIUM, JEI]);
    const input = screen.getByLabelText('搜索已装 Mod');
    fireEvent.change(input, { target: { value: 'jei' } });
    expect(screen.getByText('jei.jar')).toBeTruthy();
    fireEvent.change(input, { target: { value: '' } });
    expect(screen.getByText('fabric-api.jar')).toBeTruthy();
    expect(screen.getByText('sodium.jar')).toBeTruthy();
    expect(screen.getByText('jei.jar')).toBeTruthy();
  });

  it('大小写不敏感', async () => {
    await renderTabWithMods([FABRIC, SODIUM]);
    fireEvent.change(screen.getByLabelText('搜索已装 Mod'), { target: { value: 'FABRIC' } });
    await waitFor(() => {
      expect(screen.queryByText('sodium.jar')).toBeNull();
    });
    expect(screen.getByText('fabric-api.jar')).toBeTruthy();
  });

  it('搜索不再触发任何 IPC —— 这不是第二套 Modrinth 搜索面', async () => {
    await renderTabWithMods([FABRIC, SODIUM]);
    fireEvent.change(screen.getByLabelText('搜索已装 Mod'), { target: { value: 's' } });
    await waitFor(() => {
      expect(screen.getByText('sodium.jar')).toBeTruthy();
    });
    expect(mockListMods).toHaveBeenCalledTimes(1);
  });

  it('无匹配时文案是「没有匹配…」，与「一个都没装」区分开', async () => {
    await renderTabWithMods([FABRIC]);
    fireEvent.change(screen.getByLabelText('搜索已装 Mod'), { target: { value: 'zzz' } });
    await waitFor(() => {
      expect(screen.getByText('没有匹配「zzz」的 Mod')).toBeTruthy();
    });
  });

  it('一个都没装时文案指向安装路径，而不是「无匹配」', async () => {
    await renderTabWithMods([]);
    expect(screen.getByText(/该实例还没有安装任何 Mod/).textContent).toContain(
      '粘贴 Modrinth 文件直链',
    );
  });

  it('清空搜索词后列表恢复', async () => {
    await renderTabWithMods([FABRIC, SODIUM]);
    const input = screen.getByLabelText('搜索已装 Mod');
    fireEvent.change(input, { target: { value: 'sodium' } });
    await waitFor(() => {
      expect(screen.queryByText('fabric-api.jar')).toBeNull();
    });
    fireEvent.change(input, { target: { value: '' } });
    expect(screen.getByText('fabric-api.jar')).toBeTruthy();
    expect(screen.getByText('sodium.jar')).toBeTruthy();
  });
});

describe('ContentTab · 刷新与卸载', () => {
  it('刷新按钮重新拉取列表', async () => {
    await renderTabWithMods([FABRIC]);
    fireEvent.click(screen.getByTitle('刷新已装 Mod'));
    await waitFor(() => {
      expect(mockListMods).toHaveBeenCalledTimes(2);
    });
  });

  it('卸载后未决请求落地不再触发请求/状态更新', async () => {
    let resolveList: (v: unknown) => void = () => {};
    mockListMods.mockImplementation(
      () =>
        new Promise((res) => {
          resolveList = res;
        }),
    );

    const { unmount } = render(<ContentTab instanceId={V1} />);
    await waitFor(() => {
      expect(mockListMods).toHaveBeenCalledTimes(1);
    });

    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    unmount();
    await act(async () => {
      resolveList({ mods: [FABRIC], error: null });
      await Promise.resolve();
    });

    expect(errSpy).not.toHaveBeenCalled();
    expect(mockListMods).toHaveBeenCalledTimes(1);
    errSpy.mockRestore();
  });
});
