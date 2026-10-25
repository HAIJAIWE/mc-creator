// @vitest-environment jsdom
/**
 * LogTab（L7 · 日志 tab）测试
 *
 * ## 三条纪律
 *
 * 1. **退订必须验**。`launcherLogStream` 返回一个停止函数，组件不调用它 =
 *   主进程那边订阅泄漏，IPC 监听器越积越多。只断言「调了 stream」是不够的，
 *   必须断言卸载 / 切源时那个函数**真的被调用**。
 * 2. **流是回调驱动的**，fixture 里必须把 `onChunk` 存下来手动 `emit`，
 *   否则测的是「订阅了没」，测不到「收到分片会不会渲染」。
 * 3. **空态要指向下一步**。实时源未运行时的空态必须说「去点开始游戏」，
 *   而不是「暂无数据」—— 后者让用户以为功能坏了。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, act, within } from '@testing-library/react';
import { LogTab } from './LogTab.js';

// jsdom 未实现 Element.prototype.scrollIntoView，LogTab 的「自动滚到底」会调用它
if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = vi.fn();
}

vi.mock('../../lib/ipc-client.js', () => ({
  ipcClient: {
    launcherLogStream: vi.fn(),
    launcherReadLatestLog: vi.fn(),
    launcherListCrashReports: vi.fn(),
    launcherReadCrashReport: vi.fn(),
  },
}));

import { ipcClient } from '../../lib/ipc-client.js';

const mockLogStream = ipcClient.launcherLogStream as ReturnType<typeof vi.fn>;
const mockReadLatestLog = ipcClient.launcherReadLatestLog as ReturnType<typeof vi.fn>;
const mockListCrashReports = ipcClient.launcherListCrashReports as ReturnType<typeof vi.fn>;
const mockReadCrashReport = ipcClient.launcherReadCrashReport as ReturnType<typeof vi.fn>;

const V1 = '26.2';
const V2 = '1.21.11';

/** 一个分片，字段对齐 LauncherLogStreamChunk */
function chunk(line: string, done = false) {
  return { requestId: 'req-1', source: 'stdout', line, done };
}

/**
 * 日志 fixture 必须用**真实 MC 格式**：级别在方括号段内的斜杠**之后**
 * （`[main/ERROR]`、`[Server thread/WARN]`），不是之前。
 *
 * 旧 fixture 写成 `[ERROR/Server]`（级别在前），实现里的正则也只吃这种形态，
 * 两者互相印证出「假绿」：真实日志 `[12:00:03] [main/ERROR]:` 根本判不出级别，
 * 级别筛选恒为 0 行。视觉预览点Error 筛出 0/4 行才发现。
 * 下面的用例因此**必须**包含真实形态，否则同样的坑会再踩一次。
 */
const L_INFO = '[12:00:00] [main/INFO]: Loading Minecraft 1.21.11';
const L_WARN = '[12:00:01] [main/WARN]: Missing dependency';
const L_ERROR = '[12:00:02] [Server thread/ERROR]: boom';
const L_FATAL = '[12:00:03] [FATAL]: unrecoverable';
const L_PLAIN = 'no level marker here';

/** 手动驱动流回调的发射器 */
let emit: (c: ReturnType<typeof chunk>) => void = () => {};
/** `launcherLogStream` 返回的停止函数 */
let stop: ReturnType<typeof vi.fn>;

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  emit = () => {};
  stop = vi.fn();
  mockLogStream.mockImplementation((_req: unknown, cb: (c: unknown) => void) => {
    emit = cb as typeof emit;
    return stop;
  });
  mockReadLatestLog.mockResolvedValue({ lines: [], error: null });
  mockListCrashReports.mockResolvedValue({ files: [], error: null });
  mockReadCrashReport.mockResolvedValue({ content: '', error: null });
});

afterEach(() => {
  cleanup();
});

/** 在 act 里推一个分片（流回调来自组件外部，必须显式包 act） */
async function push(c: ReturnType<typeof chunk>) {
  await act(async () => {
    emit(c);
    await Promise.resolve();
  });
}

/** 渲染并等到来源下拉出现 */
async function renderTab(running = false, versionId = V1) {
  const utils = render(<LogTab instanceId={versionId} running={running} />);
  await waitFor(() => {
    expect(screen.getByLabelText('日志来源')).toBeTruthy();
  });
  return utils;
}

/** 切换日志来源 */
function switchSource(to: 'live' | 'latest' | 'crash') {
  fireEvent.change(screen.getByLabelText('日志来源'), { target: { value: to } });
}

/** 级别筛选按钮 */
function levelButton(name: string): HTMLElement {
  return within(screen.getByLabelText('日志级别筛选')).getByRole('button', { name });
}

describe('LogTab · 来源切换', () => {
  it('默认来源是 live，且不订阅流（未运行）', async () => {
    await renderTab(false);
    expect((screen.getByLabelText('日志来源') as HTMLSelectElement).value).toBe('live');
    expect(mockLogStream).not.toHaveBeenCalled();
  });

  it('切到 latest 调 launcherReadLatestLog 并渲染行', async () => {
    mockReadLatestLog.mockResolvedValue({ lines: [L_INFO, L_ERROR], error: null });
    await renderTab();

    switchSource('latest');
    await waitFor(() => {
      expect(mockReadLatestLog).toHaveBeenCalledWith({ instance: V1 });
    });
    await waitFor(() => {
      expect(screen.getByText(L_INFO)).toBeTruthy();
    });
    expect(screen.getByText(L_ERROR)).toBeTruthy();
  });

  it('切到 crash 调 listCrashReports 并默认打开第一份', async () => {
    mockListCrashReports.mockResolvedValue({
      files: ['crash-2026-10-10.txt', 'crash-2026-10-09.txt'],
      error: null,
    });
    mockReadCrashReport.mockImplementation(async (req: { instance: string; filename: string }) => ({
      content: `head of ${req.filename}`,
      error: null,
    }));
    await renderTab();

    switchSource('crash');
    await waitFor(() => {
      expect(mockListCrashReports).toHaveBeenCalledWith({ instance: V1 });
    });
    // 默认打开列表里的第一份
    await waitFor(() => {
      expect(mockReadCrashReport).toHaveBeenCalledWith({
        instance: V1,
        filename: 'crash-2026-10-10.txt',
      });
    });
    expect(screen.getByText('head of crash-2026-10-10.txt')).toBeTruthy();
    const sel = screen.getByLabelText('选择崩溃报告') as HTMLSelectElement;
    expect(sel.value).toBe('crash-2026-10-10.txt');
  });

  it('默认打开的那份读取失败 → 显示原因，而不是谎称「没有崩溃报告」', async () => {
    mockListCrashReports.mockResolvedValue({
      files: ['crash-2026-10-10.txt'],
      error: null,
    });
    mockReadCrashReport.mockResolvedValue({ content: '', error: '文件被占用' });
    await renderTab();

    switchSource('crash');
    await waitFor(() => {
      expect(mockReadCrashReport).toHaveBeenCalledWith({
        instance: V1,
        filename: 'crash-2026-10-10.txt',
      });
    });
    // 列表说「有」，但打开失败 —— 必须显示失败原因
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('文件被占用');
    });
    // 不能显示成「该实例没有崩溃报告」
    expect(screen.queryByText('该实例没有崩溃报告')).toBeNull();
  });

  it('在崩溃报告下拉里选另一份会重新读取', async () => {
    mockListCrashReports.mockResolvedValue({
      files: ['crash-a.txt', 'crash-b.txt'],
      error: null,
    });
    await renderTab();
    switchSource('crash');
    await waitFor(() => {
      expect(mockReadCrashReport).toHaveBeenCalledWith({ instance: V1, filename: 'crash-a.txt' });
    });

    fireEvent.change(screen.getByLabelText('选择崩溃报告'), {
      target: { value: 'crash-b.txt' },
    });
    await waitFor(() => {
      expect(mockReadCrashReport).toHaveBeenLastCalledWith({
        instance: V1,
        filename: 'crash-b.txt',
      });
    });
  });

  it('latest 源不再开实时流', async () => {
    mockReadLatestLog.mockResolvedValue({ lines: [L_INFO], error: null });
    await renderTab(true);
    expect(mockLogStream).toHaveBeenCalledTimes(1);

    switchSource('latest');
    await waitFor(() => {
      expect(mockReadLatestLog).toHaveBeenCalled();
    });
    expect(stop).toHaveBeenCalled();
    expect(mockLogStream).toHaveBeenCalledTimes(1);
  });
});

describe('LogTab · 实时流订阅与退订', () => {
  it('running=false 时不开流', async () => {
    await renderTab(false);
    expect(mockLogStream).not.toHaveBeenCalled();
  });

  it('running=true 时订阅并渲染 chunk 的 line', async () => {
    await renderTab(true);
    expect(mockLogStream).toHaveBeenCalledWith({ instance: V1 }, expect.any(Function));

    await push(chunk(L_INFO));
    await waitFor(() => {
      expect(screen.getByText(L_INFO)).toBeTruthy();
    });
    expect(screen.getByText('1 / 1 行')).toBeTruthy();
  });

  it('多帧按到达顺序追加', async () => {
    await renderTab(true);
    await push(chunk(L_INFO));
    await push(chunk(L_WARN));
    await push(chunk(L_ERROR));
    await waitFor(() => {
      expect(screen.getByText('3 / 3 行')).toBeTruthy();
    });
  });

  it('done:true 且无内容时不追加空行', async () => {
    await renderTab(true);
    await push(chunk(L_INFO));
    await push(chunk('', true));
    await waitFor(() => {
      expect(screen.getByText('1 / 1 行')).toBeTruthy();
    });
  });

  it('done:true 且带内容时仍追加这一行（进程退出前的最后一行）', async () => {
    await renderTab(true);
    await push(chunk(L_INFO));
    await push(chunk('[12:00:09] [main/INFO]: exiting', true));
    await waitFor(() => {
      expect(screen.getByText('2 / 2 行')).toBeTruthy();
    });
    expect(screen.getByText('[12:00:09] [main/INFO]: exiting')).toBeTruthy();
  });

  it('组件卸载时调用 launcherLogStream 返回的停止函数', async () => {
    const { unmount } = await renderTab(true);
    expect(stop).not.toHaveBeenCalled();
    unmount();
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it('versionId 变化会退订旧流再开新流', async () => {
    const { rerender } = await renderTab(true);
    expect(mockLogStream).toHaveBeenCalledTimes(1);

    rerender(<LogTab instanceId={V2} running={true} />);
    await waitFor(() => {
      expect(mockLogStream).toHaveBeenCalledTimes(2);
    });
    expect(stop).toHaveBeenCalledTimes(1);
    expect(mockLogStream).toHaveBeenLastCalledWith({ instance: V2 }, expect.any(Function));
  });

  it('running 由 true 变 false 时退订', async () => {
    const { rerender } = await renderTab(true);
    rerender(<LogTab instanceId={V1} running={false} />);
    await waitFor(() => {
      expect(stop).toHaveBeenCalledTimes(1);
    });
  });
});

describe('LogTab · 级别筛选', () => {
  const LINES = [L_INFO, L_WARN, L_ERROR, L_FATAL, L_PLAIN];

  async function renderWithLines() {
    mockReadLatestLog.mockResolvedValue({ lines: LINES, error: null });
    await renderTab();
    switchSource('latest');
    await waitFor(() => {
      expect(screen.getByText('5 / 5 行')).toBeTruthy();
    });
  }

  /**
   * 回归：真实 MC 日志形态下，级别筛选必须真的能筛出东西。
   *
   * 这一条是被视觉预览逼出来的 —— 页面上点 Error 筛出「0 / 4 行」，
   * 因为 detectLevel 的正则只吃 `[ERROR]` 不吃真实格式 `[main/ERROR]`，
   * 而当时的 jsdom fixture 又恰好写成了 `[ERROR/Server]`，与错实现互相印证成假绿。
   * 现在 fixture 一律用真实形态，任何「级别判不出来」的回归都会在这里现形。
   */
  it('真实 MC 格式 [线程/级别] 能被各级别筛选正确识别', async () => {
    await renderWithLines();
    // 每种级别各筛一次，计数都必须大于 0
    for (const [label, expected] of [
      ['Error', 2],
      ['Warn', 1],
      ['Info', 1],
    ] as const) {
      fireEvent.click(levelButton(label));
      await waitFor(() => {
        expect(screen.getByText(`${expected} / 5 行`)).toBeTruthy();
      });
    }
  });

  it('级别判不出来时不会误判成某个级别', async () => {
    // 行内出现 "error" 但不在级别位上，不应被当成 ERROR 行
    mockReadLatestLog.mockResolvedValue({
      lines: ['[12:00:00] [main/INFO]: handler threw error while parsing'],
      error: null,
    });
    await renderTab();
    switchSource('latest');
    await waitFor(() => expect(screen.getByText('1 / 1 行')).toBeTruthy());
    fireEvent.click(levelButton('Error'));
    await waitFor(() => expect(screen.getByText('0 / 1 行')).toBeTruthy());
  });

  it('All 下全部显示', async () => {
    await renderWithLines();
    expect(levelButton('全部').getAttribute('aria-pressed')).toBe('true');
    for (const l of LINES) {
      expect(screen.getByText(l)).toBeTruthy();
    }
  });

  it('Error 下只留 ERROR / FATAL', async () => {
    await renderWithLines();
    fireEvent.click(levelButton('Error'));
    await waitFor(() => {
      expect(screen.getByText('2 / 5 行')).toBeTruthy();
    });
    expect(screen.getByText(L_ERROR)).toBeTruthy();
    expect(screen.getByText(L_FATAL)).toBeTruthy();
    expect(screen.queryByText(L_INFO)).toBeNull();
    expect(screen.queryByText(L_PLAIN)).toBeNull();
  });

  it('Warn 下只留 WARN', async () => {
    await renderWithLines();
    fireEvent.click(levelButton('Warn'));
    await waitFor(() => {
      expect(screen.getByText('1 / 5 行')).toBeTruthy();
    });
    expect(screen.getByText(L_WARN)).toBeTruthy();
    expect(screen.queryByText(L_ERROR)).toBeNull();
  });

  it('Info 下只留 INFO，且无级别标记的行被隐藏', async () => {
    await renderWithLines();
    fireEvent.click(levelButton('Info'));
    await waitFor(() => {
      expect(screen.getByText('1 / 5 行')).toBeTruthy();
    });
    expect(screen.getByText(L_INFO)).toBeTruthy();
    expect(screen.queryByText(L_PLAIN)).toBeNull();
  });

  it('切回 All 恢复全部', async () => {
    await renderWithLines();
    fireEvent.click(levelButton('Error'));
    await waitFor(() => expect(screen.getByText('2 / 5 行')).toBeTruthy());
    fireEvent.click(levelButton('全部'));
    await waitFor(() => expect(screen.getByText('5 / 5 行')).toBeTruthy());
    expect(levelButton('全部').getAttribute('aria-pressed')).toBe('true');
  });
});

describe('LogTab · 搜索叠加在级别筛选之上', () => {
  const LINES = [L_INFO, L_WARN, L_ERROR, L_PLAIN];

  async function renderWithLines() {
    mockReadLatestLog.mockResolvedValue({ lines: LINES, error: null });
    await renderTab();
    switchSource('latest');
    await waitFor(() => expect(screen.getByText('4 / 4 行')).toBeTruthy());
  }

  it('All + 搜索只留命中的行', async () => {
    await renderWithLines();
    fireEvent.change(screen.getByLabelText('搜索日志'), { target: { value: 'boom' } });
    await waitFor(() => {
      expect(screen.getByText('1 / 4 行')).toBeTruthy();
    });
    expect(screen.getByText(L_ERROR)).toBeTruthy();
    expect(screen.queryByText(L_INFO)).toBeNull();
  });

  it('搜索大小写不敏感', async () => {
    await renderWithLines();
    fireEvent.change(screen.getByLabelText('搜索日志'), { target: { value: 'MISSING' } });
    await waitFor(() => {
      expect(screen.getByText(L_WARN)).toBeTruthy();
    });
    expect(screen.getByText('1 / 4 行')).toBeTruthy();
  });

  it('级别 + 搜索是两个条件的交集（先级别后搜索）', async () => {
    await renderWithLines();
    fireEvent.click(levelButton('Error'));
    fireEvent.change(screen.getByLabelText('搜索日志'), { target: { value: 'boom' } });
    await waitFor(() => {
      expect(screen.getByText('1 / 4 行')).toBeTruthy();
    });
    expect(screen.getByText(L_ERROR)).toBeTruthy();
  });

  it('级别命中但搜索不命中 → 0 行', async () => {
    await renderWithLines();
    fireEvent.click(levelButton('Error'));
    fireEvent.change(screen.getByLabelText('搜索日志'), { target: { value: 'Loading' } });
    await waitFor(() => {
      expect(screen.getByText('0 / 4 行')).toBeTruthy();
    });
  });
});

describe('LogTab · 空态与错误', () => {
  it('实时源未运行时，空态指向右上角的启动按钮', async () => {
    await renderTab(false);
    expect(screen.getByText('在右上角点击「开始游戏」以接收实时日志')).toBeTruthy();
  });

  it('实时源已运行但还没输出时，空态是「等待游戏输出…」', async () => {
    await renderTab(true);
    expect(screen.getByText('等待游戏输出…')).toBeTruthy();
  });

  it('latest 没有日志时显示对应空态，不复用实时文案', async () => {
    await renderTab();
    switchSource('latest');
    await waitFor(() => {
      expect(mockReadLatestLog).toHaveBeenCalled();
    });
    expect(screen.getByText(/该实例还没有产生过日志/)).toBeTruthy();
    expect(screen.queryByText('在右上角点击「开始游戏」以接收实时日志')).toBeNull();
  });

  it('崩溃报告为空时显示对应空态', async () => {
    mockListCrashReports.mockResolvedValue({ files: [], error: null });
    await renderTab();
    switchSource('crash');
    await waitFor(() => {
      expect(screen.getByText('该实例没有崩溃报告')).toBeTruthy();
    });
    expect(screen.queryByLabelText('选择崩溃报告')).toBeNull();
    expect(mockReadCrashReport).not.toHaveBeenCalled();
  });

  it('readLatestLog 返回 error 时显示错误', async () => {
    mockReadLatestLog.mockResolvedValue({ lines: [], error: 'latest.log 不存在' });
    await renderTab();
    switchSource('latest');
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('latest.log 不存在');
    });
  });

  it('readLatestLog reject 时显示异常消息', async () => {
    mockReadLatestLog.mockRejectedValue(new Error('IPC 通道已关闭'));
    await renderTab();
    switchSource('latest');
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('IPC 通道已关闭');
    });
  });

  it('listCrashReports 返回 error 时显示错误', async () => {
    mockListCrashReports.mockResolvedValue({ files: [], error: '崩溃目录不可读' });
    await renderTab();
    switchSource('crash');
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('崩溃目录不可读');
    });
  });

  it('切换 instanceId 清空上一个实例的日志', async () => {
    mockReadLatestLog.mockImplementation(async (req: { instance: string }) =>
      req.instance === V1 ? { lines: [L_INFO], error: null } : { lines: [], error: null },
    );
    const { rerender } = await renderTab(false, V1);
    switchSource('latest');
    await waitFor(() => expect(screen.getByText(L_INFO)).toBeTruthy());

    rerender(<LogTab instanceId={V2} running={false} />);
    await waitFor(() => {
      expect(mockReadLatestLog).toHaveBeenCalledWith({ instance: V2 });
    });
    await waitFor(() => {
      expect(screen.queryByText(L_INFO)).toBeNull();
    });
    expect(screen.getByText(/该实例还没有产生过日志/)).toBeTruthy();
  });
});

describe('LogTab · 全屏与无障碍', () => {
  it('全屏按钮切换 expanded 态的容器类名', async () => {
    const { container } = await renderTab();
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).not.toContain('fixed');

    fireEvent.click(screen.getByLabelText('全屏展开'));
    await waitFor(() => {
      expect(container.firstElementChild?.className).toContain('fixed');
    });
    expect(screen.queryByLabelText('全屏展开')).toBeNull();
    expect(screen.getByLabelText('退出全屏')).toBeTruthy();

    fireEvent.click(screen.getByLabelText('退出全屏'));
    await waitFor(() => {
      expect(container.firstElementChild?.className).not.toContain('fixed');
    });
  });

  it('日志区是 role=log，实时源 aria-live=polite、其它源 off', async () => {
    const { unmount } = await renderTab(true);
    expect(screen.getByRole('log').getAttribute('aria-live')).toBe('polite');

    switchSource('latest');
    await waitFor(() => {
      expect(screen.getByRole('log').getAttribute('aria-live')).toBe('off');
    });
    unmount();
  });

  it('级别按钮带 aria-pressed 表达当前档位', async () => {
    await renderTab();
    expect(levelButton('全部').getAttribute('aria-pressed')).toBe('true');
    expect(levelButton('Error').getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(levelButton('Warn'));
    await waitFor(() => {
      expect(levelButton('Warn').getAttribute('aria-pressed')).toBe('true');
    });
    expect(levelButton('全部').getAttribute('aria-pressed')).toBe('false');
  });
});
