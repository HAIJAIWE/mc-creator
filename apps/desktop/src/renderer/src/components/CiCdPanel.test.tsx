// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { CiCdPanel, suggestJavaVersion } from './CiCdPanel.js';
import { useModStore } from '../store/mod-store.js';

vi.mock('../lib/ipc-client.js', () => ({
  ipcClient: {
    saveFile: vi.fn(),
  },
}));

import { ipcClient } from '../lib/ipc-client.js';

const mockSaveFile = ipcClient.saveFile as ReturnType<typeof vi.fn>;

describe('suggestJavaVersion', () => {
  it('按 MC 版本推导建议 Java 版本', () => {
    expect(suggestJavaVersion('1.16.5')).toBe(8);
    expect(suggestJavaVersion('1.12.2')).toBe(8);
    expect(suggestJavaVersion('1.19.4')).toBe(17);
    expect(suggestJavaVersion('1.20.1')).toBe(17);
    expect(suggestJavaVersion('1.20.4')).toBe(17);
    expect(suggestJavaVersion('1.20.5')).toBe(21);
    expect(suggestJavaVersion('1.21.1')).toBe(21);
    expect(suggestJavaVersion('garbage')).toBe(21);
  });
});

describe('CiCdPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSaveFile.mockResolvedValue({
      ok: true,
      canceled: false,
      savedPath: 'D:/proj/.github/workflows/build.yml',
    });
    useModStore.setState({ loader: 'neoforge', mcVersion: '1.21.1' });
  });

  it('默认值与 mod-store 联动，Java 版本按建议值初始化', () => {
    render(<CiCdPanel />);
    const selects = document.querySelectorAll('select');
    expect((selects[1] as HTMLSelectElement).value).toBe('neoforge');
    const inputs = document.querySelectorAll('input');
    expect((inputs[0] as HTMLInputElement).value).toBe('1.21.1');
    expect(screen.queryByText(/采用建议/)).toBeNull();
  });

  it('修改 MC 版本后出现采用建议按钮，点击后采用', () => {
    render(<CiCdPanel />);
    const inputs = document.querySelectorAll('input');
    fireEvent.change(inputs[0], { target: { value: '1.16.5' } });
    expect(screen.getByText('采用建议 8')).toBeTruthy();
    fireEvent.click(screen.getByText('采用建议 8'));
    expect(screen.queryByText(/采用建议/)).toBeNull();
  });

  it('切换平台会渲染对应 CI 文件名', () => {
    render(<CiCdPanel />);
    expect(screen.getByText('.github/workflows/build.yml')).toBeTruthy();
    fireEvent.click(screen.getByText('GitLab CI'));
    expect(screen.getByText('.gitlab-ci.yml')).toBeTruthy();
    fireEvent.click(screen.getByText('Jenkins'));
    expect(screen.getByText('Jenkinsfile')).toBeTruthy();
  });

  it('GitHub workflow 包含 loader / MC 版本环境变量', () => {
    render(<CiCdPanel />);
    const pre = document.querySelector('pre')?.textContent ?? '';
    expect(pre).toContain('LOADER: neoforge');
    expect(pre).toContain('MC_VERSION: 1.21.1');
  });

  it('保存按钮调用 saveFile 并展示成功路径', async () => {
    render(<CiCdPanel />);
    fireEvent.click(screen.getByText('保存文件'));
    await waitFor(() => {
      expect(mockSaveFile).toHaveBeenCalledTimes(1);
    });
    const arg = mockSaveFile.mock.calls[0][0] as { path: string; content: string };
    expect(arg.path).toBe('.github/workflows/build.yml');
    expect(arg.content).toContain('name: Build Mod');
    expect(screen.getByText(/已保存至/)).toBeTruthy();
  });

  it('保存失败时展示错误提示', async () => {
    mockSaveFile.mockResolvedValueOnce({ ok: false, canceled: false, savedPath: null });
    render(<CiCdPanel />);
    fireEvent.click(screen.getByText('保存文件'));
    await waitFor(() => {
      expect(screen.getByText(/保存失败/)).toBeTruthy();
    });
  });

  it('复制按钮调用 clipboard', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    render(<CiCdPanel />);
    fireEvent.click(screen.getByText('复制'));
    await waitFor(() => {
      expect(writeText).toHaveBeenCalled();
      expect(screen.getByText('已复制')).toBeTruthy();
    });
  });
});
