// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { Project } from '../../../shared/ipc-channels.js';

vi.mock('../lib/ipc-client.js', () => ({
  ipcClient: {
    listProjects: vi.fn(),
    getProject: vi.fn(),
    deleteProject: vi.fn(),
  },
}));

vi.mock('./useToast.js', () => ({
  useToast: () => ({
    toast: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
  }),
}));

import { useProjectStore } from '../store/project-store.js';
import { ipcClient } from '../lib/ipc-client.js';
import { Dashboard } from './Dashboard.js';

const mockIpc = ipcClient as unknown as {
  listProjects: ReturnType<typeof vi.fn>;
};

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 'p1',
    name: '测试项目',
    generatorType: 'mod',
    loader: 'fabric',
    mcVersion: '1.21.11',
    description: '描述',
    spec: {},
    files: [
      { path: 'a.java', content: 'A' },
      { path: 'b.json', content: 'B' },
    ],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
    ...overrides,
  };
}

describe('Dashboard', () => {
  beforeEach(() => {
    useProjectStore.setState({
      projects: [],
      loading: false,
      error: null,
      view: 'dashboard',
      currentProjectId: null,
    });
    mockIpc.listProjects.mockResolvedValue([]);
  });

  it('无项目时显示空态创建引导', async () => {
    render(<Dashboard />);
    await waitFor(() => {
      expect(screen.getByText('选择你要创建的内容类型')).toBeTruthy();
    });
    // 10 种生成器类型卡片
    expect(screen.getByText('Mod')).toBeTruthy();
    expect(screen.getByText('数据包')).toBeTruthy();
    expect(screen.getByText('KubeJS')).toBeTruthy();
    expect(screen.getByText('行为包')).toBeTruthy();
  });

  it('有项目时显示统计条（项目数/文件数/类型统计）', async () => {
    mockIpc.listProjects.mockResolvedValue([
      makeProject({ id: 'a', generatorType: 'mod' }),
      makeProject({ id: 'b', generatorType: 'mod' }),
      makeProject({
        id: 'c',
        generatorType: 'kubejs',
        files: [{ path: 'x.js', content: 'X' }],
      }),
    ]);
    render(<Dashboard />);
    await waitFor(() => {
      expect(screen.getByText('我的项目')).toBeTruthy();
    });
    // 项目数 3、文件数 5
    expect(screen.getByText('3')).toBeTruthy();
    expect(screen.getByText('5')).toBeTruthy();
    // 类型统计标签：Mod: 2、KubeJS: 1
    expect(screen.getByText('Mod: 2')).toBeTruthy();
    expect(screen.getByText('KubeJS: 1')).toBeTruthy();
  });

  it('点击项目卡片打开按钮调用 loadProject', async () => {
    const proj = makeProject();
    mockIpc.listProjects.mockResolvedValue([proj]);
    const getProjectMock = (ipcClient as unknown as { getProject: ReturnType<typeof vi.fn> })
      .getProject;
    getProjectMock.mockResolvedValue(proj);
    render(<Dashboard />);
    await waitFor(() => {
      expect(screen.getByText('测试项目')).toBeTruthy();
    });
    fireEvent.click(screen.getByText('打开'));
    expect(getProjectMock).toHaveBeenCalledWith('p1');
    // view 切换为 editor（loadProject 内部 setView）
    await waitFor(() => {
      expect(useProjectStore.getState().view).toBe('editor');
    });
  });
});
