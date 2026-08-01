// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DatapackPreviewPanel } from './DatapackPreviewPanel.js';
import { useModStore } from '../../store/mod-store.js';

beforeEach(() => {
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = vi.fn();
  }
  useModStore.setState({
    loader: 'fabric',
    mcVersion: '1.21.11',
    description: '',
    generatorType: 'datapack',
    spec: null,
    files: [],
    previousFiles: [],
    selectedFile: null,
    openTabs: [],
    splitFile: null,
    dirtyFiles: new Set<string>(),
    buildLog: '',
    buildSuccess: null,
    jarPath: null,
    loading: false,
    error: null,
    fixLog: [],
  });
});

function makeDatapack() {
  return {
    packId: 'my_pack',
    packName: 'My Pack',
    description: 'test',
    packFormat: 48,
    recipes: [{ id: 'iron_ingot', type: 'smelting', result: 'minecraft:iron_ingot', count: 1 }],
    tags: [],
    functions: [{ id: 'hello', commands: ['say hi'] }],
    advancements: [],
    lootTables: [],
    predicates: [],
    itemTags: [],
    blockTags: [],
    dimensions: [],
    dimensionTypes: [],
    biomes: [],
    noiseSettings: [],
    enchantments: [],
    effects: [],
    damageTypes: [],
    structures: [],
    particles: [],
    trimPatterns: [],
    trimMaterials: [],
    instruments: [],
    structureSets: [],
    configuredFeatures: [],
    placedFeatures: [],
    templatePools: [],
    processorLists: [],
    jukeboxSongs: [],
    paintingVariants: [],
    wolfVariants: [],
    bannerPatterns: [],
    chatTypes: [],
    densityFunctions: [],
    noises: [],
    flatPresets: [],
  };
}

describe('DatapackPreviewPanel', () => {
  it('无 spec 时显示空态', () => {
    render(<DatapackPreviewPanel />);
    expect(screen.getByText(/尚未生成数据包/)).toBeTruthy();
  });

  it('有 spec 时渲染 tab 栏与配方', () => {
    useModStore.setState({ spec: makeDatapack() as never });
    render(<DatapackPreviewPanel />);
    // tab 栏存在
    expect(screen.getByText('配方')).toBeTruthy();
    expect(screen.getByText('函数')).toBeTruthy();
    // 配方 tab 内容
    expect(screen.getByText('iron_ingot')).toBeTruthy();
  });

  it('切到函数 tab 显示函数', () => {
    useModStore.setState({ spec: makeDatapack() as never });
    render(<DatapackPreviewPanel />);
    fireEvent.click(screen.getByText('函数'));
    expect(screen.getByText('hello')).toBeTruthy();
  });
});
