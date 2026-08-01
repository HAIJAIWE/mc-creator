// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { GameLauncherPanel } from './GameLauncherPanel.js';

vi.mock('../lib/ipc-client.js', () => ({
  ipcClient: {
    launcherListVersions: vi.fn(),
    launcherDownload: vi.fn(),
    launcherLaunch: vi.fn(),
    launcherInstallLoader: vi.fn(),
    launcherListMods: vi.fn(),
    launcherRemoveMod: vi.fn(),
    launcherInstallSkin: vi.fn(),
  },
}));

import { ipcClient } from '../lib/ipc-client.js';

const mockList = ipcClient.launcherListVersions as ReturnType<typeof vi.fn>;
const mockDownload = ipcClient.launcherDownload as ReturnType<typeof vi.fn>;
const mockLaunch = ipcClient.launcherLaunch as ReturnType<typeof vi.fn>;
const mockInstallLoader = ipcClient.launcherInstallLoader as ReturnType<typeof vi.fn>;
const mockListMods = ipcClient.launcherListMods as ReturnType<typeof vi.fn>;
const mockInstallSkin = ipcClient.launcherInstallSkin as ReturnType<typeof vi.fn>;

describe('GameLauncherPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockList.mockResolvedValue({
      versions: [
        { id: '26.2', type: 'release', releaseTime: '2026-06-16T00:00:00Z' },
        { id: '1.21.11', type: 'release', releaseTime: '2025-12-09T00:00:00Z' },
      ],
      error: null,
    });
    mockDownload.mockResolvedValue({ ok: true, error: null });
    mockLaunch.mockResolvedValue({ pid: 12345, error: null });
    mockInstallLoader.mockResolvedValue({ ok: true, error: null });
    mockListMods.mockResolvedValue({ mods: ['fabric-api.jar'], error: null });
    mockInstallSkin.mockResolvedValue({ ok: true, error: null });
  });

  it('加载版本清单并选中最新版', async () => {
    render(<GameLauncherPanel />);
    await waitFor(() => {
      expect(screen.getByLabelText('MC 版本')).toBeTruthy();
    });
    expect(mockList).toHaveBeenCalled();
    expect(screen.getByText('共 2 个正式版 · 最新 26.2')).toBeTruthy();
  });

  it('下载按钮调用 launcherDownload', async () => {
    render(<GameLauncherPanel />);
    await waitFor(() => {
      expect(screen.getByText('下载客户端')).toBeTruthy();
    });
    fireEvent.click(screen.getByText('下载客户端'));
    await waitFor(() => {
      expect(mockDownload).toHaveBeenCalledWith({ version: '26.2' });
    });
    expect(screen.getByText('下载完成')).toBeTruthy();
  });

  it('启动按钮调用 launcherLaunch 并显示 PID', async () => {
    render(<GameLauncherPanel />);
    await waitFor(() => {
      expect(screen.getByText('启动游戏')).toBeTruthy();
    });
    fireEvent.change(screen.getByPlaceholderText('离线用户名'), {
      target: { value: 'Alex' },
    });
    fireEvent.click(screen.getByText('启动游戏'));
    await waitFor(() => {
      expect(mockLaunch).toHaveBeenCalledWith({
        version: '26.2',
        username: 'Alex',
        memory: '2G',
      });
    });
    expect(screen.getByText(/游戏已启动/)).toBeTruthy();
  });

  it('版本清单错误时显示错误', async () => {
    mockList.mockResolvedValue({ versions: [], error: '网络错误' });
    render(<GameLauncherPanel />);
    await waitFor(() => {
      expect(screen.getByText('网络错误')).toBeTruthy();
    });
  });

  it('安装 Fabric 加载器', async () => {
    render(<GameLauncherPanel />);
    await waitFor(() => {
      expect(screen.getByText('安装 Fabric')).toBeTruthy();
    });
    fireEvent.click(screen.getByText('安装 Fabric'));
    await waitFor(() => {
      expect(mockInstallLoader).toHaveBeenCalledWith({ version: '26.2', loader: 'fabric' });
    });
  });

  it('加载版本后显示已装 Mod 列表', async () => {
    render(<GameLauncherPanel />);
    await waitFor(() => {
      expect(screen.getByText('fabric-api.jar')).toBeTruthy();
    });
    expect(mockListMods).toHaveBeenCalledWith('26.2');
  });

  it('安装离线皮肤支持', async () => {
    render(<GameLauncherPanel />);
    await waitFor(() => {
      expect(screen.getByText('安装离线皮肤支持')).toBeTruthy();
    });
    fireEvent.click(screen.getByText('安装离线皮肤支持'));
    await waitFor(() => {
      expect(mockInstallSkin).toHaveBeenCalledWith({
        version: '26.2',
        skinApiUrl: 'https://littleskin.cn/api/yggdrasil',
      });
    });
  });
});
