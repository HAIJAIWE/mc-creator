// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PackagesPanel } from './PackagesPanel.js';
import { useModStore } from '../store/mod-store.js';

function setSpec(spec: unknown) {
  useModStore.setState({
    loader: 'fabric',
    mcVersion: '1.21.1',
    generatorType: 'modpack',
    spec: spec as never,
  });
}

describe('PackagesPanel', () => {
  beforeEach(() => {
    useModStore.setState({
      loader: 'fabric',
      mcVersion: '1.21.1',
      generatorType: 'modpack',
      spec: {
        mods: [],
        dependencies: [],
      } as never,
    });
  });

  it('空 spec 时显示无冲突与空模组列表', () => {
    render(<PackagesPanel />);
    expect(screen.getByText('无冲突，依赖关系健康')).toBeTruthy();
    expect(screen.getByText('尚未添加模组')).toBeTruthy();
    expect(screen.getByText('无显式依赖')).toBeTruthy();
  });

  it('环境依赖区展示 loader / MC 版本 / PF', () => {
    render(<PackagesPanel />);
    expect(screen.getByText('fabric')).toBeTruthy();
    expect(screen.getByText('1.21.1')).toBeTruthy();
    expect(screen.getByText('PF 48')).toBeTruthy();
  });

  it('未知 MC 版本显示 PF 未知', () => {
    useModStore.setState({ mcVersion: '1.99.9' as never });
    render(<PackagesPanel />);
    expect(screen.getByText('PF 未知')).toBeTruthy();
  });

  it('缺失依赖被标记为 error', () => {
    setSpec({
      mods: [{ name: 'my-mod', dependencies: ['cloth-config'] }],
      dependencies: [],
    });
    render(<PackagesPanel />);
    expect(screen.getByText(/缺失依赖: cloth-config/)).toBeTruthy();
  });

  it('模组间循环依赖被标记为 warning', () => {
    setSpec({
      mods: [
        { name: 'mod-a', dependencies: ['mod-b'] },
        { name: 'mod-b', dependencies: ['mod-a'] },
      ],
      dependencies: [],
    });
    render(<PackagesPanel />);
    expect(screen.getByText(/模组循环依赖/)).toBeTruthy();
  });

  it('重复依赖声明被标记为 warning', () => {
    setSpec({
      mods: [],
      dependencies: [{ id: 'fabric-api' }, { id: 'fabric-api' }],
    });
    render(<PackagesPanel />);
    expect(screen.getByText(/重复声明 2 次/)).toBeTruthy();
  });

  it('模组列表支持搜索过滤', () => {
    setSpec({
      mods: [
        { name: 'sodium', fileName: 'sodium-0.5.jar' },
        { name: 'lithium', fileName: 'lithium-0.12.jar' },
      ],
      dependencies: [],
    });
    render(<PackagesPanel />);
    expect(screen.getByText('sodium')).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText('搜索 mod…'), {
      target: { value: 'lithium' },
    });
    expect(screen.queryByText('sodium')).toBeNull();
    expect(screen.getByText('lithium')).toBeTruthy();
  });

  it('依赖列表展示已知依赖的友好名称与类型', () => {
    setSpec({
      mods: [],
      dependencies: [{ id: 'cloth-config', version: '11.1.118', type: 'optional' }],
    });
    render(<PackagesPanel />);
    expect(screen.getByText('cloth-config')).toBeTruthy();
    expect(screen.getByText('Cloth Config')).toBeTruthy();
    expect(screen.getByText('可选')).toBeTruthy();
  });

  it('依赖树展示依赖与挂载的子模块', () => {
    setSpec({
      mods: [{ name: 'my-mod', dependencies: ['fabric-api'] }],
      dependencies: [{ id: 'fabric-api', version: '0.100.0', type: 'required' }],
    });
    render(<PackagesPanel />);
    expect(screen.getByText('依赖树')).toBeTruthy();
    expect(screen.getByText('fabric-api')).toBeTruthy();
    expect(screen.getByText('my-mod')).toBeTruthy();
  });
});
