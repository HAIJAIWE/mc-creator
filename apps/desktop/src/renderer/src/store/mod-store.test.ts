import { describe, it, expect, beforeEach } from 'vitest';
import { useModStore } from './mod-store.js';

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
});
