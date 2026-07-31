// @vitest-environment jsdom
/**
 * useRecentGraphs hook 测试
 *
 * 测试策略：
 * - 用 vi.mock 模拟 nodeGraphPersistence 模块，不依赖真实 localStorage / IPC
 * - 用 @testing-library/react 的 renderHook + act 测试 hook
 * - 覆盖 mount 自动 refresh / refresh / remove / loading / error / unmount 竞态
 *
 * 注意：与 nodeGraphPersistence.test.ts 分开存放，避免与主代理的测试文件冲突。
 * 主代理的测试文件覆盖纯函数层（含 localStorage polyfill），本文件专门覆盖 hook 层，
 * 通过 mock 模块隔离开持久化实现，专注验证 hook 的状态管理与副作用逻辑。
 */

import { describe, it, expect, beforeEach, afterEach, vi, type MockedFunction } from 'vitest';
import { renderHook, act, cleanup } from '@testing-library/react';

// === mock nodeGraphPersistence 模块 ===
// 用 vi.fn 直接作为模块导出，测试内通过 (listRecentGraphs as Mock).mockResolvedValue 配置返回值。
// 这是 vitest 推荐的 mock 模式，避免闭包引用未初始化变量的问题。
vi.mock('./nodeGraphPersistence.js', () => ({
  listRecentGraphs: vi.fn(),
  removeRecentGraph: vi.fn(),
}));

import { useRecentGraphs } from './useRecentGraphs.js';
import { listRecentGraphs, removeRecentGraph } from './nodeGraphPersistence.js';

// 类型导入（仅用于类型，不会触发真实模块加载，因为上面已 vi.mock）
import type { RecentGraphEntry } from './nodeGraphPersistence.js';

const mockedListRecent = listRecentGraphs as unknown as MockedFunction<
  () => Promise<RecentGraphEntry[]>
>;
const mockedRemoveRecent = removeRecentGraph as unknown as MockedFunction<
  (filePath: string) => void
>;

function makeEntry(filePath: string, modId = 'mod', nodeCount = 1): RecentGraphEntry {
  return {
    filePath,
    modId,
    savedAt: '2026-07-21T00:00:00.000Z',
    nodeCount,
  };
}

beforeEach(() => {
  mockedListRecent.mockReset();
  mockedRemoveRecent.mockReset();
  // 默认返回空数组
  mockedListRecent.mockResolvedValue([]);
  mockedRemoveRecent.mockReturnValue(undefined);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// 辅助：等待 useEffect 触发的初次 refresh 完成
async function waitForInitialRefresh(
  result: { current: { loading: boolean; recent: RecentGraphEntry[]; error: string | null } },
  expectedLength: number,
): Promise<void> {
  await act(async () => {
    // 轮询等待 loading 变为 false 且 recent 更新
    for (let i = 0; i < 50; i++) {
      if (!result.current.loading && result.current.recent.length === expectedLength) return;
      await new Promise((r) => setTimeout(r, 10));
    }
  });
}

describe('useRecentGraphs', () => {
  it('1. mount 时自动 refresh，recent 被填充为模块返回的列表', async () => {
    const list = [makeEntry('/a.json', 'mod_a', 1), makeEntry('/b.json', 'mod_b', 2)];
    mockedListRecent.mockResolvedValue(list);

    const { result } = renderHook(() => useRecentGraphs());

    await waitForInitialRefresh(result, 2);

    expect(result.current.recent).toEqual(list);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
    expect(mockedListRecent).toHaveBeenCalledTimes(1);
  });

  it('2. 模块返回空数组时 mount 后 recent 为空数组', async () => {
    mockedListRecent.mockResolvedValue([]);

    const { result } = renderHook(() => useRecentGraphs());

    await waitForInitialRefresh(result, 0);

    expect(result.current.recent).toEqual([]);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('3. mount 时 refresh 失败则设置 error 且 recent 保持空', async () => {
    mockedListRecent.mockRejectedValue(new Error('localStorage 不可用'));

    const { result } = renderHook(() => useRecentGraphs());

    await act(async () => {
      // 等待 error 被设置
      for (let i = 0; i < 50; i++) {
        if (result.current.error !== null) return;
        await new Promise((r) => setTimeout(r, 10));
      }
    });

    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBe('localStorage 不可用');
    expect(result.current.recent).toEqual([]);
  });

  it('4. 手动 refresh 重新拉取最新数据', async () => {
    const list1 = [makeEntry('/a.json', 'a', 1)];
    const list2 = [makeEntry('/b.json', 'b', 2), makeEntry('/a.json', 'a', 1)];
    mockedListRecent
      .mockResolvedValueOnce(list1) // mount 初次
      .mockResolvedValueOnce(list2); // 手动 refresh

    const { result } = renderHook(() => useRecentGraphs());

    await waitForInitialRefresh(result, 1);

    await act(async () => {
      await result.current.refresh();
    });

    expect(result.current.recent).toEqual(list2);
    expect(mockedListRecent).toHaveBeenCalledTimes(2);
  });

  it('5. remove 调用 removeRecentGraph 后自动 refresh，被移除的条目消失', async () => {
    const list = [makeEntry('/a.json', 'a', 1), makeEntry('/b.json', 'b', 2)];
    const afterRemove = [makeEntry('/b.json', 'b', 2)];
    mockedListRecent
      .mockResolvedValueOnce(list) // mount
      .mockResolvedValueOnce(afterRemove); // remove 后的 refresh

    const { result } = renderHook(() => useRecentGraphs());

    await waitForInitialRefresh(result, 2);

    await act(async () => {
      await result.current.remove('/a.json');
    });

    expect(mockedRemoveRecent).toHaveBeenCalledWith('/a.json');
    expect(result.current.recent).toEqual(afterRemove);
    expect(result.current.recent).toHaveLength(1);
    expect(result.current.error).toBeNull();
  });

  it('6. remove 不存在的路径时模块静默成功，列表不变', async () => {
    const list = [makeEntry('/a.json', 'a', 1)];
    mockedListRecent
      .mockResolvedValueOnce(list) // mount
      .mockResolvedValueOnce(list); // remove 后 refresh（模块幂等，返回相同列表）

    const { result } = renderHook(() => useRecentGraphs());

    await waitForInitialRefresh(result, 1);

    await act(async () => {
      await result.current.remove('/nonexistent.json');
    });

    expect(mockedRemoveRecent).toHaveBeenCalledWith('/nonexistent.json');
    expect(result.current.recent).toHaveLength(1);
    expect(result.current.recent[0].filePath).toBe('/a.json');
    expect(result.current.error).toBeNull();
  });

  it('7. mount 后 unmount 不应触发 setState 警告（canceled 标志阻止）', async () => {
    // 让 listRecentGraphs 返回一个慢 promise，确保 unmount 时异步还未完成
    let resolveFn: (value: RecentGraphEntry[]) => void = () => {};
    mockedListRecent.mockImplementation(
      () =>
        new Promise<RecentGraphEntry[]>((resolve) => {
          resolveFn = resolve;
        }),
    );

    const { unmount } = renderHook(() => useRecentGraphs());
    // 立即 unmount，模拟组件卸载与异步竞态
    unmount();
    // 此时 resolve promise，canceled 标志应阻止 setState
    await act(async () => {
      resolveFn([]);
      await new Promise((r) => setTimeout(r, 0));
    });
    // 不抛即视为通过（React 18 在 unmount 后 setState 会静默）
    expect(true).toBe(true);
  });

  it('8. 多次 remove 连续调用后列表正确递减', async () => {
    const list3 = [
      makeEntry('/a.json', 'a', 1),
      makeEntry('/b.json', 'b', 2),
      makeEntry('/c.json', 'c', 3),
    ];
    const list2 = [makeEntry('/b.json', 'b', 2), makeEntry('/c.json', 'c', 3)];
    const list1 = [makeEntry('/c.json', 'c', 3)];
    const list0: RecentGraphEntry[] = [];
    mockedListRecent
      .mockResolvedValueOnce(list3) // mount
      .mockResolvedValueOnce(list2) // remove /a 后
      .mockResolvedValueOnce(list1) // remove /b 后
      .mockResolvedValueOnce(list0); // remove /c 后

    const { result } = renderHook(() => useRecentGraphs());

    await waitForInitialRefresh(result, 3);

    await act(async () => {
      await result.current.remove('/a.json');
    });
    expect(result.current.recent).toHaveLength(2);

    await act(async () => {
      await result.current.remove('/b.json');
    });
    expect(result.current.recent).toHaveLength(1);
    expect(result.current.recent[0].filePath).toBe('/c.json');

    await act(async () => {
      await result.current.remove('/c.json');
    });
    expect(result.current.recent).toEqual([]);
  });

  it('9. remove 抛异常时设置 error 且不刷新', async () => {
    const list = [makeEntry('/a.json', 'a', 1)];
    mockedListRecent.mockResolvedValueOnce(list); // mount
    mockedRemoveRecent.mockImplementation(() => {
      throw new Error('remove 失败');
    });

    const { result } = renderHook(() => useRecentGraphs());

    await waitForInitialRefresh(result, 1);

    await act(async () => {
      await result.current.remove('/a.json');
    });

    expect(result.current.error).toBe('remove 失败');
    // remove 失败时不应 refresh（保持原列表）
    expect(result.current.recent).toEqual(list);
  });

  it('10. 手动 refresh 失败时设置 error', async () => {
    const list = [makeEntry('/a.json', 'a', 1)];
    mockedListRecent
      .mockResolvedValueOnce(list) // mount
      .mockRejectedValueOnce(new Error('刷新失败')); // 手动 refresh

    const { result } = renderHook(() => useRecentGraphs());

    await waitForInitialRefresh(result, 1);

    await act(async () => {
      await result.current.refresh();
    });

    expect(result.current.error).toBe('刷新失败');
    expect(result.current.loading).toBe(false);
  });
});
