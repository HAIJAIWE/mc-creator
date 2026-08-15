import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useModStore } from './mod-store.js';

// 在 import mod-store 之前注入 localStorage，让 persist 走真实 storage 路径
vi.hoisted(() => {
  const mem = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => void mem.set(k, v),
    removeItem: (k: string) => void mem.delete(k),
    clear: () => mem.clear(),
    key: () => null,
    length: 0,
  };
});

describe('mod-store', () => {
  beforeEach(() => {
    // 每次重置到初始状态
    useModStore.setState({
      loader: 'fabric',
      mcVersion: '1.21.11',
      description: '',
      generatorType: 'mod',
      spec: null,
      files: [],
      previousFiles: [],
      selectedFile: null,
      buildLog: '',
      buildSuccess: null,
      jarPath: null,
      loading: false,
      error: null,
    });
  });

  it('初始状态', () => {
    const s = useModStore.getState();
    expect(s.loader).toBe('fabric');
    expect(s.mcVersion).toBe('1.21.11');
    expect(s.spec).toBeNull();
  });

  it('setLoader 切换 loader', () => {
    useModStore.getState().setLoader('neoforge');
    expect(useModStore.getState().loader).toBe('neoforge');
  });

  it('setFiles 自动选中第一个文件', () => {
    useModStore.getState().setFiles([
      { path: 'a.txt', content: 'a' },
      { path: 'b.txt', content: 'b' },
    ]);
    expect(useModStore.getState().selectedFile).toBe('a.txt');
  });

  it('setFiles 备份 previousFiles', () => {
    const store = useModStore.getState();
    store.setFiles([{ path: 'a.txt', content: 'a' }]);
    store.setFiles([{ path: 'a.txt', content: 'a2' }]);
    const s = useModStore.getState();
    expect(s.files[0].content).toBe('a2');
    expect(s.previousFiles[0].content).toBe('a');
    expect(s.previousFiles[0].path).toBe('a.txt');
  });

  it('clearPreviousFiles 清空 previousFiles', () => {
    const store = useModStore.getState();
    store.setFiles([{ path: 'a.txt', content: 'a' }]);
    store.setFiles([{ path: 'a.txt', content: 'a2' }]);
    useModStore.getState().clearPreviousFiles();
    expect(useModStore.getState().previousFiles).toEqual([]);
  });

  it('setGeneratorType 切换类型时清空旧类型的描述/spec/文件残留', () => {
    useModStore.getState().setDescription('附魔包');
    useModStore.getState().setSpec({ packId: 'x', packName: 'X' } as never);
    useModStore.getState().setFiles([{ path: 'enchant.json', content: '{}' }]);
    useModStore.getState().selectFile('enchant.json');

    useModStore.getState().setGeneratorType('behavior_entity');

    const s = useModStore.getState();
    expect(s.generatorType).toBe('behavior_entity');
    expect(s.spec).toBeNull();
    expect(s.files).toEqual([]);
    expect(s.previousFiles).toEqual([]);
    expect(s.openTabs).toEqual([]);
    expect(s.selectedFile).toBeNull();
    expect(s.description).toBe('');
  });

  it('setGeneratorType 切换相同类型时不动现有内容', () => {
    useModStore.getState().setSpec({ modId: 'keep' } as never);
    useModStore.getState().setGeneratorType('mod');
    expect(useModStore.getState().spec).toEqual({ modId: 'keep' });
  });

  it('选择偏好（类型/loader/版本）持久化到 localStorage，且不包含 spec/files', () => {
    localStorage.clear();
    useModStore.getState().setGeneratorType('behavior_item');
    useModStore.getState().setLoader('vanilla');
    useModStore.getState().setMcVersion('1.21.1');

    const raw = localStorage.getItem('mc-creator-ui-state');
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw!) as { state: Record<string, unknown> };
    expect(parsed.state.generatorType).toBe('behavior_item');
    expect(parsed.state.loader).toBe('vanilla');
    expect(parsed.state.mcVersion).toBe('1.21.1');
    // 产出数据不持久化
    expect(parsed.state.spec).toBeUndefined();
    expect(parsed.state.files).toBeUndefined();
  });
});
