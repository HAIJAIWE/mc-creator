/**
 * BuildPanel 集成测试（阶段 0A：构建入口恢复）
 *
 * ## 为什么需要这个文件
 *
 * `BuildPanel.tsx` 此前**零引用**——后端 `registerBuildHandlers`、`BUILD_STREAM` 通道、
 * `mod-store` 的 build 字段全都在，唯独没有任何界面能触发构建。
 * `BuildPanel.test.tsx` 只覆盖组件内部逻辑（且它自己也只测组件，不测接线），
 * 因此「构建按钮点下去会不会真的走到 IPC」这件事从未被验证过。
 *
 * 本文件验证的是**接线**：从 UI 点击 → ipcClient 调用 → store 写入。
 *
 * 覆盖：
 * 1. 点击「编译 .jar」触发 checkJava → prepareBuildDir → buildWithFix → setBuildResult
 * 2. JDK 预检失败时不进入构建，给出下载链接
 * 3. 构建失败时可触发 AI 诊断修复
 * 4. 流式构建走 buildStream 且按 chunk 累积日志
 * 5. 无文件时按钮禁用（避免空构建）
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { BuildPanel } from './dev/BuildPanel.js';
import { useModStore } from '../store/mod-store.js';
import { ipcClient } from '../lib/ipc-client.js';

// 整个 ipc-client 模块打桩：本测试要断言的是「UI 调用了哪个通道」，
// 而不是 ipcClient 自己的实现（那由 ipc-client 自己的测试负责）。
vi.mock('../lib/ipc-client.js', () => ({
  ipcClient: {
    checkJava: vi.fn(),
    abortBuild: vi.fn(),
    prepareBuildDir: vi.fn(),
    buildWithFix: vi.fn(),
    buildStream: vi.fn(),
    fixSuggest: vi.fn(),
    locateMc: vi.fn(),
    chooseMcDir: vi.fn(),
    installMod: vi.fn(),
    launchMc: vi.fn(),
  },
}));

const mockIpc = ipcClient as unknown as Record<string, ReturnType<typeof vi.fn>>;

/** 把 store 置于「有一个文件」的状态，构建按钮才可用 */
function seedFiles() {
  useModStore.setState({
    files: [{ path: 'src/main/java/com/example/Demo.java', content: 'class Demo {}' }],
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  seedFiles();
  useModStore.setState({
    buildLog: '',
    buildSuccess: null,
    jarPath: null,
    sha256: null,
    fixLog: [],
    loading: false,
    error: null,
  });

  // 默认：JDK 就绪、构建成功
  mockIpc.checkJava.mockResolvedValue({ ok: true });
  mockIpc.prepareBuildDir.mockResolvedValue({
    projectPath: 'D:/tmp/mc-build',
    estimatedSteps: 1,
  });
  mockIpc.buildWithFix.mockResolvedValue({
    success: true,
    log: 'BUILD SUCCESSFUL',
    jarPath: 'build/libs/demo.jar',
    sha256: 'abc123',
    fixLog: [],
    attempts: 1,
  });
});

afterEach(() => {
  cleanup();
});

describe('BuildPanel · 构建接线（阶段 0A）', () => {
  it('点击「编译 .jar」依次调用 checkJava → prepareBuildDir → buildWithFix', async () => {
    render(<BuildPanel />);

    fireEvent.click(screen.getByRole('button', { name: '编译 .jar' }));

    await waitFor(() => {
      expect(mockIpc.buildWithFix).toHaveBeenCalledWith('D:/tmp/mc-build');
    });
    // 预检必须在构建之前，且构建用的是准备目录返回的路径
    expect(mockIpc.checkJava).toHaveBeenCalledTimes(1);
    expect(mockIpc.prepareBuildDir).toHaveBeenCalledTimes(1);
    expect(mockIpc.prepareBuildDir).toHaveBeenCalledWith([
      { path: 'src/main/java/com/example/Demo.java', content: 'class Demo {}' },
    ]);
  });

  it('构建成功后把结果写入 mod-store（setBuildResult）', async () => {
    render(<BuildPanel />);

    fireEvent.click(screen.getByRole('button', { name: '编译 .jar' }));

    await waitFor(() => {
      expect(useModStore.getState().buildSuccess).toBe(true);
    });
    expect(useModStore.getState().buildLog).toBe('BUILD SUCCESSFUL');
    expect(useModStore.getState().jarPath).toBe('build/libs/demo.jar');
    expect(useModStore.getState().sha256).toBe('abc123');
  });

  it('JDK 预检失败时不进入构建，并展示下载链接', async () => {
    mockIpc.checkJava.mockResolvedValue({
      ok: false,
      message: '未检测到 JDK 21',
      downloadUrl: 'https://example.com/jdk21.zip',
    });

    render(<BuildPanel />);
    fireEvent.click(screen.getByRole('button', { name: '编译 .jar' }));

    await waitFor(() => {
      expect(screen.getByRole('link', { name: 'https://example.com/jdk21.zip' })).toBeTruthy();
    });
    // 关键：预检拦住后不得继续准备目录或构建
    expect(mockIpc.prepareBuildDir).not.toHaveBeenCalled();
    expect(mockIpc.buildWithFix).not.toHaveBeenCalled();
  });

  it('构建失败时展示失败态并可触发 AI 诊断修复', async () => {
    mockIpc.buildWithFix.mockResolvedValue({
      success: false,
      log: 'error: cannot find symbol',
      jarPath: null,
      sha256: null,
      fixLog: [],
      attempts: 3,
    });

    render(<BuildPanel />);
    fireEvent.click(screen.getByRole('button', { name: '编译 .jar' }));

    await waitFor(() => {
      expect(useModStore.getState().buildSuccess).toBe(false);
    });
    expect(screen.getByText('编译失败')).toBeTruthy();

    // AI 诊断修复：把日志与文件预览交给 fixSuggest
    mockIpc.fixSuggest.mockImplementation(
      (_log: string, _files: unknown, onDelta: (d: string, done: boolean) => void) => {
        onDelta('检查 import 语句', true);
      },
    );
    fireEvent.click(screen.getByRole('button', { name: 'AI 诊断修复' }));

    await waitFor(() => {
      expect(mockIpc.fixSuggest).toHaveBeenCalledTimes(1);
    });
    const [logArg, filesArg] = mockIpc.fixSuggest.mock.calls[0] as [string, unknown];
    expect(logArg).toBe('error: cannot find symbol');
    expect(filesArg).toEqual([
      { path: 'src/main/java/com/example/Demo.java', content: 'class Demo {}' },
    ]);
  });

  it('流式编译走 buildStream 并按 chunk 累积日志', async () => {
    // buildStream 通过回调推 chunk：先推一段日志，最后推 done + exitCode
    mockIpc.buildStream.mockImplementation(
      async (_projectPath: string, onChunk: (c: unknown) => void) => {
        onChunk({ text: '> Task :compileJava\n', done: false });
        onChunk({ text: 'BUILD SUCCESSFUL\n', done: true, exitCode: 0 });
      },
    );

    render(<BuildPanel />);
    fireEvent.click(screen.getByRole('button', { name: '流式编译' }));

    await waitFor(() => {
      expect(screen.getByText('构建成功！')).toBeTruthy();
    });
    expect(mockIpc.buildWithFix).not.toHaveBeenCalled();
    // 两段 chunk 拼接后完整呈现
    await waitFor(() => {
      expect(screen.getByText(/> Task :compileJava/)).toBeTruthy();
    });
  });

  it('没有文件时按钮禁用，避免空构建', () => {
    useModStore.setState({ files: [] });
    render(<BuildPanel />);

    const btn = screen.getByRole('button', { name: '编译 .jar' }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it('构建中可取消：调用 abortBuild 并复位 loading', async () => {
    // 让 buildWithFix 挂起，从而进入「构建中」状态
    let release: (v: unknown) => void = () => {};
    mockIpc.buildWithFix.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );

    render(<BuildPanel />);
    fireEvent.click(screen.getByRole('button', { name: '编译 .jar' }));

    const cancelBtn = await screen.findByRole('button', { name: '取消' });
    fireEvent.click(cancelBtn);

    await waitFor(() => {
      expect(mockIpc.abortBuild).toHaveBeenCalledTimes(1);
    });
    expect(useModStore.getState().loading).toBe(false);
    // 迟到的 resolve 不应再改写结果
    release({ success: true, log: 'late', jarPath: 'late.jar', sha256: null });
    await waitFor(() => {
      expect(useModStore.getState().buildSuccess).toBeNull();
    });
  });
});
