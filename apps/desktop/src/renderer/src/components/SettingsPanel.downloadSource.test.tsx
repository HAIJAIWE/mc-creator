/**
 * SettingsPanel 的「下载源」分组。
 *
 * 守四件事（都是"信任边界"上的，不是纯 UI 细节）：
 *  1. 入口存在且能到达 —— 不写进设置界面就等于用户没法把流量切回官方；
 *  2. 默认是**国内镜像优先**（与主进程 `DEFAULT_SOURCE_PREFERENCE` 一致）；
 *  3. 点一下就立刻落盘（`saveSourcePreference`），不需要再点"保存" ——
 *     让用户怀疑"到底切没切"比多写一次 IPC 更糟；
 *  4. 界面上必须说明「切到镜像 ≠ 放弃官方」和「文件仍按哈希校验」——
 *     只给一个开关、不解释后果，用户没法做出知情选择。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { SettingsPanel } from './SettingsPanel.js';

const loadSourcePreference = vi.fn(async () => ({ preferOfficial: false }));
const saveSourcePreference = vi.fn(async (_pref: { preferOfficial: boolean }) => ({
  ok: true as const,
}));

beforeEach(() => {
  // jsdom 没有 matchMedia，而本组件挂载时会读系统配色（themes.ts getEffectiveMode）
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
  loadSourcePreference.mockReset().mockResolvedValue({ preferOfficial: false });
  saveSourcePreference.mockReset().mockResolvedValue({ ok: true });

  (window as unknown as { mcApi: unknown }).mcApi = {
    // 挂载时就会读这些通道；缺一个就是 render 阶段 TypeError（症状隐蔽）
    listModelProfiles: vi.fn(async () => ({ profiles: [], activeId: null })),
    saveModelProfile: vi.fn(async () => ({ ok: true })),
    deleteModelProfile: vi.fn(async () => ({ ok: true })),
    testModelProfile: vi.fn(async () => ({ ok: true, message: 'ok' })),
    saveCurseForgeKey: vi.fn(async () => ({ ok: true })),
    loadCurseForgeConfig: vi.fn(async () => ({ apiKey: '' })),
    loadSourcePreference,
    saveSourcePreference,
    // 依赖预热那一组（面板挂载时就订阅了进度）
    onWarmDepsProgress: vi.fn(() => () => undefined),
    warmDeps: vi.fn(),
    cancelWarmDeps: vi.fn(),
    buildWithFix: vi.fn(),
    checkJava: vi.fn(),
  };
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

/** 切到「下载源」tab。 */
const gotoDownloadSource = () => {
  fireEvent.click(screen.getByRole('button', { name: /下载源|Download Source/ }));
};

describe('SettingsPanel · 下载源', () => {
  it('两个选项都在，且选项文案说清了各自后果', async () => {
    render(<SettingsPanel />);
    gotoDownloadSource();
    const mirror = await screen.findByRole('button', { name: /国内镜像优先|China mirror first/ });
    const official = screen.getByRole('button', { name: /官方源优先|Official first/ });
    // 各自都带说明（`aria-pressed` 的按钮名会包含内部文本，这里只查关键词）
    expect(mirror.textContent).toMatch(/BMCLAPI|MCIM/);
    expect(official.textContent).toMatch(/Mojang|Modrinth/);
  });

  it('主进程说当前是镜像优先 → 镜像那项被标为选中', async () => {
    render(<SettingsPanel />);
    gotoDownloadSource();
    const mirror = await screen.findByRole('button', { name: /国内镜像优先|China mirror first/ });
    expect(mirror.getAttribute('aria-pressed')).toBe('true');
    expect(
      screen
        .getByRole('button', { name: /官方源优先|Official first/ })
        .getAttribute('aria-pressed'),
    ).toBe('false');
    // 只是读回来，不该顺手写回去
    expect(saveSourcePreference).not.toHaveBeenCalled();
  });

  it('切到官方优先：立刻落盘，不要求再点一次保存', async () => {
    render(<SettingsPanel />);
    gotoDownloadSource();
    const official = await screen.findByRole('button', { name: /官方源优先|Official first/ });
    fireEvent.click(official);
    await waitFor(() => {
      expect(saveSourcePreference).toHaveBeenCalledWith({ preferOfficial: true });
    });
    expect(official.getAttribute('aria-pressed')).toBe('true');
    // 没有"保存"按钮（这是即时生效的开关）
    expect(screen.queryByRole('button', { name: /^保存$|^Save$/ })).toBeNull();
  });

  it('重复点同一项不重复写（避免无意义的磁盘写与 IPC）', async () => {
    render(<SettingsPanel />);
    gotoDownloadSource();
    const mirror = await screen.findByRole('button', { name: /国内镜像优先|China mirror first/ });
    fireEvent.click(mirror);
    await Promise.resolve();
    expect(saveSourcePreference).not.toHaveBeenCalled();
  });

  it('界面上写明「镜像不是二选一」与「仍按哈希校验」', async () => {
    render(<SettingsPanel />);
    gotoDownloadSource();
    // 这两句是用户做知情选择的依据，不是装饰文案
    expect(
      await screen.findByText(/兜底|fallback/i),
      '必须说明另一个源仍在候选列表里',
    ).toBeTruthy();
    expect(screen.getByText(/sha1|sha512|校验|verified/i), '必须说明文件会被校验').toBeTruthy();
  });
});
