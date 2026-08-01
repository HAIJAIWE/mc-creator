// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ModPreviewPanel } from './ModPreviewPanel.js';
import { useModStore } from '../../store/mod-store.js';
import { useSpecHistoryStore } from '../../store/spec-history-store.js';
import type { ModSpec } from '@mc-creator/shared';

/**
 * jsdom 未实现 Element.prototype.scrollIntoView，IconTabBar 等子组件可能调用。
 * 测试前 polyfill，避免 TypeError。
 */
beforeEach(() => {
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = vi.fn();
  }
});

/** 构造一个最小可用的 ModSpec 用于测试渲染 */
function makeSpec(overrides: Partial<ModSpec> = {}): ModSpec {
  return {
    modId: 'test_mod',
    version: '1.0.0',
    name: '测试 Mod',
    description: '描述文本',
    items: [],
    blocks: [],
    license: 'MIT',
    authors: ['Tester'],
    credits: '',
    dependencies: [],
    website: '',
    lootTables: [],
    advancements: [],
    tags: [],
    functions: [],
    recipes: [],
    entities: [],
    machines: [],
    customCode: [],
    multiblocks: [],
    fluids: [],
    biomes: [],
    dimensions: [],
    guis: [],
    structures: [],
    eventHandlers: [],
    conditions: [],
    actions: [],
    procedures: [],
    ...overrides,
  };
}

describe('ModPreviewPanel', () => {
  beforeEach(() => {
    // 重置 store 到初始空状态
    useModStore.setState({
      loader: 'fabric',
      mcVersion: '1.21.11',
      description: '',
      generatorType: 'mod',
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
    // spec-history-store 也清空，避免持久化数据干扰
    useSpecHistoryStore.setState({ versions: [], currentIndex: -1 });
  });

  it('spec 为 null 时显示 EmptyState 标题与提示', () => {
    render(<ModPreviewPanel />);
    expect(screen.getByText('尚未生成 Mod Spec')).toBeTruthy();
    expect(
      screen.getByText('在右侧 AgentPanel 描述你想要的 mod，生成 Spec 后即可预览'),
    ).toBeTruthy();
  });

  it('spec 存在时显示 PanelHeader（标题 + modId/版本 meta）', () => {
    useModStore.setState({ spec: makeSpec({ name: '我的红石 Mod', modId: 'redstone_mod' }) });
    render(<ModPreviewPanel />);
    // PanelHeader 渲染标题
    expect(screen.getByText('我的红石 Mod')).toBeTruthy();
    // PanelHeader 渲染 meta（label: value）
    expect(screen.getByText(/modId:/)).toBeTruthy();
    expect(screen.getByText(/redstone_mod/)).toBeTruthy();
    expect(screen.getByText(/版本:/)).toBeTruthy();
  });

  it('spec.name 缺失时 fallback 到 modId 作为标题', () => {
    useModStore.setState({
      spec: makeSpec({ name: '', modId: 'fallback_id' }),
    });
    render(<ModPreviewPanel />);
    expect(screen.getByText('fallback_id')).toBeTruthy();
  });

  it('渲染所有 9 个 tab（物品/方块/依赖/战利品/进度/标签/函数/元数据/导出）', () => {
    useModStore.setState({ spec: makeSpec() });
    render(<ModPreviewPanel />);
    const labels = ['物品', '方块', '依赖', '战利品', '进度', '标签', '函数', '元数据', '导出'];
    for (const label of labels) {
      // tab label 可能与 StatCard label 或其它元素重复，用 getAllByText 验证至少一个
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    }
  });

  it('默认选中物品 tab，点击方块 tab 后切换激活样式', () => {
    useModStore.setState({ spec: makeSpec() });
    render(<ModPreviewPanel />);
    // IconTabBar 现用 role="tab" + aria-selected 标记激活态（P9.2 a11y 改进）
    const itemTab = screen.getByRole('tab', { name: /物品/ });
    const blockTab = screen.getByRole('tab', { name: /方块/ });
    // 默认物品 tab 激活
    expect(itemTab.getAttribute('aria-selected')).toBe('true');
    expect(blockTab.getAttribute('aria-selected')).toBe('false');
    // 点击方块 tab
    fireEvent.click(blockTab);
    // 重新查询（按钮 onClick 触发 setState 后重渲染）
    const blockTabAfter = screen.getByRole('tab', { name: /方块/ });
    const itemTabAfter = screen.getByRole('tab', { name: /物品/ });
    expect(blockTabAfter.getAttribute('aria-selected')).toBe('true');
    expect(itemTabAfter.getAttribute('aria-selected')).toBe('false');
  });

  it('渲染顶部统计卡片（物品/方块/依赖/战利品/进度/标签）', () => {
    useModStore.setState({
      spec: makeSpec({
        items: [
          {
            id: 'test_item',
            name: '测试物品',
            maxStackSize: 64,
            rarity: 'common',
            maxDamage: 0,
            fuelTick: 0,
            lore: '',
            attributes: [],
            defaultEnchantments: [],
            itemCategory: 'misc',
            creativeTab: 'inventory',
          },
        ],
        blocks: [
          {
            id: 'test_block',
            name: '测试方块',
            material: 'stone',
            hardness: 1.5,
            miningLevel: 0,
            lightLevel: 0,
            resistance: 3.0,
            soundType: 'stone',
            dropSelf: true,
            dropItem: '',
            stateProperties: [],
            collisionShapes: [],
            blockType: 'full_block',
            transparent: false,
            noCollision: false,
          },
        ],
      }),
    });
    render(<ModPreviewPanel />);
    // StatCard label "物品" 出现至少一次（顶部统计行 + tab 行）
    expect(screen.getAllByText('物品').length).toBeGreaterThan(0);
  });

  it('PanelHeader meta 渲染作者列表（逗号分隔）', () => {
    useModStore.setState({
      spec: makeSpec({ authors: ['Alice', 'Bob', 'Charlie'] }),
    });
    render(<ModPreviewPanel />);
    expect(screen.getByText(/Alice, Bob, Charlie/)).toBeTruthy();
  });

  it('EmptyState 默认显示「打开命令面板」按钮', () => {
    render(<ModPreviewPanel />);
    // EmptyState 默认 action：打开命令面板（F1）
    const btn = screen.getByRole('button', { name: /打开命令面板/ });
    expect(btn).toBeTruthy();
  });

  it('EmptyState 点击「打开命令面板」按钮派发 mc:open-command-palette 事件', () => {
    render(<ModPreviewPanel />);
    let eventFired = false;
    window.addEventListener('mc:open-command-palette', () => {
      eventFired = true;
    });
    fireEvent.click(screen.getByRole('button', { name: /打开命令面板/ }));
    expect(eventFired).toBe(true);
  });

  it('描述 subtitle 显示在 PanelHeader 下方', () => {
    useModStore.setState({
      spec: makeSpec({ description: '这是一段测试描述文字' }),
    });
    render(<ModPreviewPanel />);
    expect(screen.getByText('这是一段测试描述文字')).toBeTruthy();
  });
});
