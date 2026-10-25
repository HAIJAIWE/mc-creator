// @vitest-environment jsdom
/**
 * SettingsPanel · CurseForge key 的「测试」按钮。
 *
 * 这条链路的关键不是按钮存在，而是**测的是用户填的 key**：
 * 主进程强制官方根，不能被「下载源 = 国内镜像」偷偷换掉。否则用户会看到
 * 「测试成功」，实际用的却是镜像自带的 key —— 自己那把可能早就失效了。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { SettingsPanel } from './SettingsPanel.js';

const curseforgeTestKey = vi.fn();

beforeEach(() => {
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

  curseforgeTestKey.mockReset();

  (window as unknown as { mcApi: unknown }).mcApi = {
    listModelProfiles: vi.fn(async () => ({ profiles: [], activeId: null })),
    saveModelProfile: vi.fn(async () => ({ ok: true })),
    deleteModelProfile: vi.fn(async () => ({ ok: true })),
    testModelProfile: vi.fn(async () => ({ ok: true, message: 'ok' })),
    loadCurseForgeConfig: vi.fn(async () => ({ apiKey: '' })),
    saveCurseForgeConfig: vi.fn(async () => ({ ok: true })),
    curseforgeTestKey,
    loadSourcePreference: vi.fn(async () => ({ preferOfficial: false })),
    saveSourcePreference: vi.fn(async () => ({ ok: true })),
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

const gotoCurseForge = () => {
  fireEvent.click(screen.getByRole('button', { name: 'CurseForge' }));
};

const keyInput = () => screen.getByPlaceholderText('$2a$10$...');

describe('SettingsPanel · CurseForge key 测试', () => {
  it('测试前先 trim，并把结果（成功）显示出来', async () => {
    curseforgeTestKey.mockResolvedValue({ ok: true, error: null });
    render(<SettingsPanel />);
    gotoCurseForge();

    fireEvent.change(keyInput(), { target: { value: '  $2a$10$abc  ' } });
    fireEvent.click(screen.getByRole('button', { name: '测试' }));

    await waitFor(() => {
      expect(curseforgeTestKey).toHaveBeenCalledWith({ apiKey: '$2a$10$abc' });
    });
    expect(await screen.findByText(/key 可用/)).toBeTruthy();
  });

  it('失败原因原样显示，不谎报成功', async () => {
    curseforgeTestKey.mockResolvedValue({ ok: false, error: 'HTTP 403 Forbidden' });
    render(<SettingsPanel />);
    gotoCurseForge();

    fireEvent.change(keyInput(), { target: { value: 'bad-key' } });
    fireEvent.click(screen.getByRole('button', { name: '测试' }));

    expect(await screen.findByText('HTTP 403 Forbidden')).toBeTruthy();
    expect(screen.queryByText(/key 可用/)).toBeNull();
  });

  it('key 为空时按钮禁用，不发请求', () => {
    render(<SettingsPanel />);
    gotoCurseForge();
    expect((screen.getByRole('button', { name: '测试' }) as HTMLButtonElement).disabled).toBe(true);
    expect(curseforgeTestKey).not.toHaveBeenCalled();
  });
});
