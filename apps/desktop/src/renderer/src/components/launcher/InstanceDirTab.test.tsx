// @vitest-environment jsdom
/**
 * InstanceDirTab（L8 · 实例目录 tab）测试
 *
 * ## 为什么这个组件的测试重点是「错误不许消失」
 *
 * 越界防护（`resolveInside` + `assertVersionId`）在主进程，渲染层拿到的就是
 * 一条 `error`。如果组件把它吞掉画成「该目录为空」，用户看到的是
 * 「这个文件夹是空的」，而不是「你给的路径被拒了」—— 前者引导用户去折腾磁盘，
 * 后者才指向真正的原因。所以本文件对 error 分支的断言优先级高于空目录分支。
 *
 * 另外这里的列表是「当前目录内容 + 面包屑」，与工作台左栏的**项目文件树**刻意不同；
 * 名称、面包屑文案都刻意避开项目心智（docs §4.3.2），测试一并钉住。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, act, within } from '@testing-library/react';
import { InstanceDirTab } from './InstanceDirTab.js';
import type { InstanceFileInfo } from '../../../../shared/ipc/launcher.js';

vi.mock('../../lib/ipc-client.js', () => ({
  ipcClient: {
    launcherListInstanceFiles: vi.fn(),
  },
}));

import { ipcClient } from '../../lib/ipc-client.js';

const mockList = ipcClient.launcherListInstanceFiles as ReturnType<typeof vi.fn>;

const V1 = '26.2';
const V2 = '1.21.11';

function dir(name: string, path: string, extra: Partial<InstanceFileInfo> = {}): InstanceFileInfo {
  return { name, path, isDirectory: true, ...extra };
}

function file(name: string, path: string, extra: Partial<InstanceFileInfo> = {}): InstanceFileInfo {
  return { name, path, isDirectory: false, size: 0, ...extra };
}

/** 实例根目录的固定清单 */
const ROOT: InstanceFileInfo[] = [
  dir('saves', 'saves'),
  dir('resourcepacks', 'resourcepacks'),
  file('options.txt', 'options.txt', { size: 2048 }),
  file('sodium.jar', 'sodium.jar', { size: 5 * 1024 * 1024, isSymlink: true }),
  file('unknown-size.txt', 'unknown-size.txt', { size: undefined }),
];

/** instances/<v>/ 的清单，按 path 区分根/子目录 */
function listFor(path: string): { files: InstanceFileInfo[]; error: null } {
  if (path === '') return { files: ROOT, error: null };
  if (path === 'saves') {
    return {
      files: [
        dir('world1', 'saves/world1'),
        dir('datapacks', 'saves/datapacks'),
        file('level.dat', 'saves/level.dat', { size: 1536 }),
      ],
      error: null,
    };
  }
  return { files: [], error: null };
}

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  mockList.mockImplementation(async ({ path }: { version: string; path: string }) => listFor(path));
});

afterEach(() => {
  cleanup();
});

/** 渲染并等到首次请求落地（`instanceName` 走条件展开：exactOptionalPropertyTypes） */
async function renderTab(instanceId = V1, instanceName?: string) {
  const props = instanceName === undefined ? { instanceId } : { instanceId, instanceName };
  const utils = render(<InstanceDirTab {...props} />);
  await waitFor(() => {
    expect(mockList).toHaveBeenCalledWith({ instance: instanceId, path: '' });
  });
  return utils;
}

/** 某个条目（行）所在的 <button>，用 title(=相对路径) 精确定位 */
function entryButton(path: string): HTMLElement {
  return screen.getByTitle(path);
}

/** 面包屑 <nav> */
function crumbs() {
  return within(screen.getByLabelText('实例目录路径'));
}

describe('InstanceDirTab · 首次加载', () => {
  it('用 path:"" 请求实例根目录', async () => {
    await renderTab();
    expect(mockList).toHaveBeenCalledTimes(1);
    expect(mockList).toHaveBeenCalledWith({ instance: V1, path: '' });
  });

  it('versionId 为空时不发请求', () => {
    render(<InstanceDirTab instanceId="" />);
    expect(mockList).not.toHaveBeenCalled();
  });

  it('面包屑首段带实例名，与项目文件树区分开', async () => {
    await renderTab(V1, '我的整合包');
    expect(crumbs().getByRole('button', { name: /我的整合包 的实例目录/ })).toBeTruthy();
  });

  it('未传实例名时回落成「实例目录」', async () => {
    await renderTab();
    expect(crumbs().getByRole('button', { name: /实例目录/ })).toBeTruthy();
  });

  it('路径标签显示 game/<versionId>/', async () => {
    await renderTab();
    expect(screen.getByText(`game/${V1}/`)).toBeTruthy();
  });
});

describe('InstanceDirTab · 列表渲染', () => {
  it('目录项与文件项都渲染出来', async () => {
    await renderTab();
    expect(screen.getByText('saves')).toBeTruthy();
    expect(screen.getByText('options.txt')).toBeTruthy();
  });

  it('目录用 Folder 图标、文件用 File 图标', async () => {
    await renderTab();
    expect(entryButton('saves').querySelector('svg.lucide-folder')).toBeTruthy();
    expect(entryButton('options.txt').querySelector('svg.lucide-file')).toBeTruthy();
  });

  it('目录行可点、文件行禁用（不可下钻）', async () => {
    await renderTab();
    expect((entryButton('saves') as HTMLButtonElement).disabled).toBe(false);
    expect((entryButton('options.txt') as HTMLButtonElement).disabled).toBe(true);
  });

  it('点文件行不会发起任何请求', async () => {
    await renderTab();
    fireEvent.click(entryButton('options.txt'));
    expect(mockList).toHaveBeenCalledTimes(1);
  });

  it('文件显示人类可读 size，size 缺失时不显示噪音', async () => {
    await renderTab();
    expect(within(entryButton('options.txt')).getByText('2.0 KB')).toBeTruthy();
    expect(within(entryButton('sodium.jar')).getByText('5.0 MB')).toBeTruthy();
    expect(within(entryButton('unknown-size.txt')).queryByText(/undefined|NaN/)).toBeNull();
  });

  it('isSymlink 显示「链接」标记，普通文件不显示', async () => {
    await renderTab();
    expect(within(entryButton('sodium.jar')).getByText('链接')).toBeTruthy();
    expect(within(entryButton('options.txt')).queryByText('链接')).toBeNull();
  });

  it('软链目录同样显示「链接」', async () => {
    mockList.mockResolvedValue({
      files: [dir('mods', 'mods', { isSymlink: true })],
      error: null,
    });
    await renderTab();
    expect(within(entryButton('mods')).getByText('链接')).toBeTruthy();
  });

  it('空目录显示空态文案', async () => {
    mockList.mockResolvedValue({ files: [], error: null });
    await renderTab();
    expect(screen.getByText('该目录为空')).toBeTruthy();
  });

  it('请求未落地时显示「读取中…」而不是空态', async () => {
    mockList.mockImplementation(() => new Promise(() => {}));
    render(<InstanceDirTab instanceId={V1} />);
    expect(screen.getByText('读取中…')).toBeTruthy();
  });
});

describe('InstanceDirTab · 面包屑下钻', () => {
  it('点目录以新 path 发起二次请求', async () => {
    await renderTab();
    fireEvent.click(entryButton('saves'));

    await waitFor(() => {
      expect(mockList).toHaveBeenCalledWith({ instance: V1, path: 'saves' });
    });
    expect(mockList).toHaveBeenCalledTimes(2);
  });

  it('面包屑逐级累加，路径标签同步', async () => {
    await renderTab();
    fireEvent.click(entryButton('saves'));
    await waitFor(() => expect(screen.getByText('level.dat')).toBeTruthy());

    expect(crumbs().getByRole('button', { name: 'saves' })).toBeTruthy();
    expect(screen.getByText(`game/${V1}/saves`)).toBeTruthy();

    fireEvent.click(entryButton('saves/world1'));
    await waitFor(() => {
      expect(mockList).toHaveBeenCalledWith({ instance: V1, path: 'saves/world1' });
    });
    expect(crumbs().getByRole('button', { name: 'world1' })).toBeTruthy();
    expect(screen.getByText(`game/${V1}/saves/world1`)).toBeTruthy();
  });

  it('点面包屑段可回溯到对应层级', async () => {
    await renderTab();
    fireEvent.click(entryButton('saves'));
    await waitFor(() => expect(screen.getByText('level.dat')).toBeTruthy());
    fireEvent.click(entryButton('saves/world1'));
    await waitFor(() => {
      expect(mockList).toHaveBeenLastCalledWith({ instance: V1, path: 'saves/world1' });
    });

    fireEvent.click(crumbs().getByRole('button', { name: 'saves' }));
    await waitFor(() => {
      expect(mockList).toHaveBeenLastCalledWith({ instance: V1, path: 'saves' });
    });
    expect(screen.getByText(`game/${V1}/saves`)).toBeTruthy();
  });

  it('点面包屑根段回到根目录', async () => {
    await renderTab();
    fireEvent.click(entryButton('saves'));
    await waitFor(() => expect(screen.getByText('level.dat')).toBeTruthy());

    fireEvent.click(crumbs().getByRole('button', { name: /实例目录/ }));
    await waitFor(() => {
      expect(mockList).toHaveBeenLastCalledWith({ instance: V1, path: '' });
    });
    expect(screen.getByText(`game/${V1}/`)).toBeTruthy();
  });

  it('当前层级的面包屑段标记 aria-current=page', async () => {
    await renderTab();
    fireEvent.click(entryButton('saves'));
    await waitFor(() => expect(screen.getByText('level.dat')).toBeTruthy());
    expect(crumbs().getByRole('button', { name: 'saves' }).getAttribute('aria-current')).toBe(
      'page',
    );
  });

  it('刷新按钮按当前 cwd 重新请求', async () => {
    await renderTab();
    fireEvent.click(entryButton('saves'));
    await waitFor(() => expect(mockList).toHaveBeenCalledTimes(2));

    fireEvent.click(screen.getByText('刷新'));
    await waitFor(() => {
      expect(mockList).toHaveBeenCalledTimes(3);
    });
    expect(mockList).toHaveBeenLastCalledWith({ instance: V1, path: 'saves' });
  });
});

describe('InstanceDirTab · 主进程错误必须显示，不能伪装成空目录', () => {
  it('返回 error 时显示原因，且不显示「该目录为空」', async () => {
    mockList.mockResolvedValue({ files: [], error: '路径越界：game/26.2/../../etc' });
    await renderTab();

    expect(screen.getByRole('alert').textContent).toContain('路径越界');
    expect(screen.queryByText('该目录为空')).toBeNull();
  });

  it('error 分支清空上一批条目，不残留旧目录内容', async () => {
    mockList.mockResolvedValue({ files: [], error: '目录已被删除' });
    await renderTab();
    expect(screen.queryByText('saves')).toBeNull();
  });

  it('下钻失败时错误替换掉旧目录的内容', async () => {
    mockList.mockImplementation(async ({ path }: { version: string; path: string }) => {
      if (path === '') return { files: ROOT, error: null };
      return { files: [], error: '权限不足' };
    });
    await renderTab();
    fireEvent.click(entryButton('saves'));

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('权限不足');
    });
    expect(screen.queryByText('该目录为空')).toBeNull();
  });

  it('请求 reject 时把异常消息显示出来', async () => {
    mockList.mockRejectedValue(new Error('IPC 通道已关闭'));
    render(<InstanceDirTab instanceId={V1} />);
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('IPC 通道已关闭');
    });
    expect(screen.queryByText('该目录为空')).toBeNull();
  });

  it('刷新成功后错误消失', async () => {
    mockList.mockResolvedValueOnce({ files: [], error: '目录已被删除' });
    await renderTab();
    expect(screen.getByRole('alert')).toBeTruthy();

    fireEvent.click(screen.getByText('刷新'));
    await waitFor(() => {
      expect(screen.queryByRole('alert')).toBeNull();
    });
    expect(screen.getByText('saves')).toBeTruthy();
  });
});

describe('InstanceDirTab · 切换实例与卸载', () => {
  it('versionId 变化后回到根目录，不沿用上个实例的路径', async () => {
    const { rerender } = await renderTab(V1);
    fireEvent.click(entryButton('saves'));
    await waitFor(() => expect(screen.getByText('level.dat')).toBeTruthy());

    rerender(<InstanceDirTab instanceId={V2} />);
    await waitFor(() => {
      expect(mockList).toHaveBeenLastCalledWith({ instance: V2, path: '' });
    });
    expect(screen.getByText(`game/${V2}/`)).toBeTruthy();
    // 面包屑回到只有根段
    expect(crumbs().queryByRole('button', { name: 'saves' })).toBeNull();
  });

  /**
   * 上一条只断言了「最后一次调用」，抓不到中间那次脏请求。
   *
   * 若用 `useEffect(() => setCwd(''), [versionId])` 重置 cwd，切实例时会先以
   * 「新实例 + 旧实例路径」发一次请求（主进程多半回「路径不存在」，闪现错误条），
   * 重置引发的二次渲染才发正确请求。cwd 必须**派生**出来，首帧就正确。
   */
  it('切实例时不发出「新实例 + 旧路径」的无效请求', async () => {
    const { rerender } = await renderTab(V1);
    fireEvent.click(entryButton('saves'));
    await waitFor(() => expect(screen.getByText('level.dat')).toBeTruthy());
    const before = mockList.mock.calls.length;

    rerender(<InstanceDirTab instanceId={V2} />);
    await waitFor(() => expect(mockList).toHaveBeenLastCalledWith({ instance: V2, path: '' }));

    const newCalls = mockList.mock.calls.slice(before).map((c) => c[0]);
    expect(newCalls).toEqual([{ instance: V2, path: '' }]);
    // 尤其不能出现 V2 配旧路径 'saves' 的组合
    expect(newCalls.some((c) => c.version === V2 && c.path !== '')).toBe(false);
  });

  it('卸载后未决请求落地不再触发请求/状态更新', async () => {
    let resolveList: (v: unknown) => void = () => {};
    mockList.mockImplementation(
      () =>
        new Promise((res) => {
          resolveList = res;
        }),
    );

    const { unmount } = render(<InstanceDirTab instanceId={V1} />);
    await waitFor(() => {
      expect(mockList).toHaveBeenCalledTimes(1);
    });

    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    unmount();
    await act(async () => {
      resolveList({ files: ROOT, error: null });
      await Promise.resolve();
    });

    expect(errSpy).not.toHaveBeenCalled();
    expect(mockList).toHaveBeenCalledTimes(1);
    errSpy.mockRestore();
  });
});
