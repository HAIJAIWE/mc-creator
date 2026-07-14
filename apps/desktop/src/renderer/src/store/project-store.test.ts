import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../lib/ipc-client.js', () => ({
  ipcClient: {
    listProjects: vi.fn(),
    getProject: vi.fn(),
    saveProject: vi.fn(),
    deleteProject: vi.fn(),
  },
}));

import { ipcClient } from '../lib/ipc-client.js';
import { useProjectStore } from './project-store.js';
import { useModStore } from './mod-store.js';

const mockIpc = ipcClient as unknown as {
  listProjects: ReturnType<typeof vi.fn>;
  getProject: ReturnType<typeof vi.fn>;
  saveProject: ReturnType<typeof vi.fn>;
  deleteProject: ReturnType<typeof vi.fn>;
};

describe('project-store', () => {
  beforeEach(() => {
    useProjectStore.setState({
      projects: [],
      loading: false,
      error: null,
      view: 'dashboard',
      currentProjectId: null,
    });
    useModStore.setState({
      loader: 'fabric',
      mcVersion: '1.21.11',
      description: '',
      generatorType: 'mod',
      spec: null,
      files: [],
      selectedFile: null,
      buildLog: '',
      buildSuccess: null,
      jarPath: null,
      loading: false,
      error: null,
      fixLog: [],
    });
    mockIpc.listProjects.mockReset();
    mockIpc.getProject.mockReset();
    mockIpc.saveProject.mockReset();
    mockIpc.deleteProject.mockReset();
  });

  it('loadProjects 从 ipcClient 读取并设置 projects', async () => {
    const fake = [
      {
        id: '1',
        name: 'p1',
        generatorType: 'mod',
        loader: 'fabric',
        mcVersion: '1.21',
        description: '',
        spec: {},
        files: [],
        createdAt: '',
        updatedAt: '',
      },
    ];
    mockIpc.listProjects.mockResolvedValue(fake);

    await useProjectStore.getState().loadProjects();

    expect(mockIpc.listProjects).toHaveBeenCalled();
    expect(useProjectStore.getState().projects).toEqual(fake);
    expect(useProjectStore.getState().loading).toBe(false);
  });

  it('saveCurrentAsProject 调用 ipcClient.saveProject 并刷新列表', async () => {
    mockIpc.saveProject.mockResolvedValue({ ok: true });
    mockIpc.listProjects.mockResolvedValue([]);

    await useProjectStore.getState().saveCurrentAsProject('test', {
      generatorType: 'mod',
      loader: 'fabric',
      mcVersion: '1.21',
      description: 'd',
      spec: { modId: 'x' },
      files: [],
    });

    expect(mockIpc.saveProject).toHaveBeenCalled();
    const arg = mockIpc.saveProject.mock.calls[0][0];
    expect(arg.name).toBe('test');
    expect(arg.id).toBeTruthy();
    expect(arg.createdAt).toBe(arg.updatedAt);
    // 刷新列表
    expect(mockIpc.listProjects).toHaveBeenCalled();
  });

  it('deleteProject 调用 ipcClient.deleteProject 并刷新列表', async () => {
    mockIpc.deleteProject.mockResolvedValue({ ok: true });
    mockIpc.listProjects.mockResolvedValue([]);

    await useProjectStore.getState().deleteProject('abc');

    expect(mockIpc.deleteProject).toHaveBeenCalledWith('abc');
    expect(mockIpc.listProjects).toHaveBeenCalled();
  });

  it('setView 切换视图', () => {
    useProjectStore.getState().setView('editor');
    expect(useProjectStore.getState().view).toBe('editor');

    useProjectStore.getState().setView('dashboard');
    expect(useProjectStore.getState().view).toBe('dashboard');
  });

  it('backToDashboard 重置 currentProjectId 并切回 dashboard', () => {
    useProjectStore.setState({ view: 'editor', currentProjectId: 'xyz' });

    useProjectStore.getState().backToDashboard();

    expect(useProjectStore.getState().view).toBe('dashboard');
    expect(useProjectStore.getState().currentProjectId).toBeNull();
  });

  it('loadProject 把项目数据填入 mod-store 并切换视图', async () => {
    const fake = {
      id: 'p2',
      name: 'demo',
      generatorType: 'mod',
      loader: 'neoforge',
      mcVersion: '1.21',
      description: 'hello',
      spec: { modId: 'demo' },
      files: [{ path: 'a.txt', content: 'a' }],
      createdAt: '',
      updatedAt: '',
    };
    mockIpc.getProject.mockResolvedValue(fake);

    await useProjectStore.getState().loadProject('p2');

    const mod = useModStore.getState();
    expect(mod.loader).toBe('neoforge');
    expect(mod.mcVersion).toBe('1.21');
    expect(mod.description).toBe('hello');
    expect(mod.generatorType).toBe('mod');
    expect(mod.files).toHaveLength(1);
    expect(mod.selectedFile).toBe('a.txt');
    expect(useProjectStore.getState().view).toBe('editor');
    expect(useProjectStore.getState().currentProjectId).toBe('p2');
  });
});
