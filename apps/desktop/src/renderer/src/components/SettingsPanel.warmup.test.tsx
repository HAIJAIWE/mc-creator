/**
 * SettingsPanel 的「依赖预热」分组（W3 接线的渲染层部分）。
 *
 * 这个组件**此前没有任何测试文件**，所以这里只测新增分组的四条硬约束，
 * 不去给整个面板补冒烟测试（那是另一件事，别混在一起）：
 *  1. 入口默认不是它 —— 不改变用户既有动线（模型配置仍是第一个 tab）；
 *  2. 代价写在界面上（385MB / 数分钟）—— 用户必须提前知道磁盘占用；
 *  3. 进度推送按 requestId 过滤 —— 切版本后旧版本的进度不能串台；
 *  4. 卸载时退订 —— 否则 setState 打到已卸载组件上。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, act } from '@testing-library/react';
import { SettingsPanel } from './SettingsPanel.js';

type ProgressCb = (p: { requestId: string; text: string }) => void;

let capturedCb: ProgressCb | null = null;
let offFn: ReturnType<typeof vi.fn>;
const onWarmDepsProgress = vi.fn((_cb: ProgressCb) => offFn);
const warmDeps = vi.fn(async (_mc: string, _loader: 'forge') => ({
  ok: true,
  warmed: true,
  aborted: false,
  elapsedMs: 61_000,
  log: '',
  error: null,
}));
const cancelWarmDeps = vi.fn(async (_id: string) => undefined);

beforeEach(() => {
  // jsdom 没有 matchMedia，而本组件读系统配色（themes.ts:296 getEffectiveMode）
  // —— 不打这个桩会在挂载阶段就 TypeError，全部用例假红。
  if (typeof window.matchMedia !== 'function') {
    window.matchMedia = ((q: string) => ({
      matches: false,
      media: q,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
  }
  capturedCb = null;
  offFn = vi.fn();
  onWarmDepsProgress.mockReset().mockImplementation((cb: ProgressCb) => {
    capturedCb = cb;
    return offFn;
  });
  warmDeps.mockReset().mockResolvedValue({
    ok: true,
    warmed: true,
    aborted: false,
    elapsedMs: 61_000,
    log: '',
    error: null,
  });
  cancelWarmDeps.mockReset().mockResolvedValue(undefined);
  // 组件挂载时就会读模型档案与 CF 状态，所以这些既有通道也得给桩。
  // 缺失的表现很隐蔽：render 阶段 TypeError，五条用例一起红，看不出是哪条。
  (window as unknown as { mcApi: unknown }).mcApi = {
    onWarmDepsProgress,
    warmDeps,
    cancelWarmDeps,
    buildWithFix: vi.fn(),
    checkJava: vi.fn(),
    // 形状必须与真实通道一致：SettingsPanel.tsx:245 读的是 r.profiles / r.activeId，
    // 返回 [] 会让 setProfiles(undefined) 抛 TypeError，且**发生在测试之外的微任务里**
    // → 表现为 vitest 的 unhandled rejection，掩盖真正的断言结果。
    listModelProfiles: vi.fn(async () => ({ profiles: [] as { id: string }[], activeId: null })),
    saveModelProfile: vi.fn(async () => ({ ok: true })),
    deleteModelProfile: vi.fn(async () => ({ ok: true })),
    testModelProfile: vi.fn(async () => ({ ok: true, message: 'ok' })),
    saveCurseForgeKey: vi.fn(async () => ({ ok: true })),
    loadCurseForgeConfig: vi.fn(async () => ({ apiKey: '', hasKey: false })),
    loadSourcePreference: vi.fn(async () => ({ preferOfficial: false })),
  };
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function openWarmupTab(): void {
  render(<SettingsPanel />);
  fireEvent.click(screen.getByText('依赖预热'));
}

describe('设置 · 依赖预热分组', () => {
  it('默认停在模型配置，不抢既有动线', () => {
    render(<SettingsPanel />);
    expect(screen.queryByText('Gradle / ForgeGradle 依赖预热')).toBeNull();
  });

  it('点开分组后如实写出代价与适用范围', () => {
    openWarmupTab();
    expect(screen.getByText('Gradle / ForgeGradle 依赖预热')).toBeTruthy();
    // 代价必须写在界面上（385MB / 数分钟），否则用户被磁盘占用惊到
    expect(screen.getByText(/385 MB/)).toBeTruthy();
    // 只支持 Forge，不能给「选哪个都行」的错觉
    expect(screen.getByText(/NeoForge 与 Fabric\/Loom 的缓存布局不同，暂不支持预热/)).toBeTruthy();
  });

  it('点预热走 ipc，并在完成后显示已预热', async () => {
    openWarmupTab();
    fireEvent.click(screen.getByText('预热该版本'));
    await waitFor(() => expect(warmDeps).toHaveBeenCalledWith('1.20.1', 'forge'));
    await waitFor(() => expect(screen.getByText('已预热')).toBeTruthy());
  });

  it('进度推送按 requestId 过滤：别的版本的消息不显示', async () => {
    openWarmupTab();
    expect(capturedCb).not.toBeNull();
    // 先点一次预热，warmMsg 才有渲染槽（空态下 setMsg 写了也看不见）
    await act(async () => {
      fireEvent.click(screen.getByText('预热该版本'));
    });
    // 进度回调是主进程 push 触发的 setState，在测试里必须包 act() ——
    // 否则 React 18 把更新排队不提交，断言看到的是旧树（且报 act 警告）。
    act(() => capturedCb!({ requestId: '1.21.1-forge', text: '别的版本的进度' }));
    expect(screen.queryByText('别的版本的进度')).toBeNull();
    act(() => capturedCb!({ requestId: '1.20.1-forge', text: '反编译中，请勿关窗口' }));
    expect(screen.getByText('反编译中，请勿关窗口')).toBeTruthy();
  });

  it('卸载时退订，避免向已卸载组件 setState', () => {
    openWarmupTab();
    expect(offFn).not.toHaveBeenCalled();
    cleanup();
    expect(offFn).toHaveBeenCalled();
  });
});
