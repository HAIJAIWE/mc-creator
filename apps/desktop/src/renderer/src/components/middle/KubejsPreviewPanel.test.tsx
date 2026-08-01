// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { KubejsPreviewPanel } from './KubejsPreviewPanel.js';
import { useModStore } from '../../store/mod-store.js';

beforeEach(() => {
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = vi.fn();
  }
  useModStore.setState({
    loader: 'fabric',
    mcVersion: '1.21.11',
    description: '',
    generatorType: 'kubejs',
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

function makeKubejs() {
  return {
    packId: 'my_pack',
    packName: 'My Pack',
    description: 'test',
    packFormat: 48,
    mcVersion: '1.21.11',
    recipes: [
      {
        id: 'iron_block',
        type: 'shaped',
        result: 'minecraft:iron_block',
        count: 1,
        pattern: ['III', 'III', 'III'],
        key: { I: ['minecraft:iron_ingot'] },
      },
    ],
    tags: [],
    events: [],
    tooltips: [{ itemId: 'minecraft:diamond', lines: ['稀有!'], advanced: false }],
    lang: { en_us: { 'item.my_pack.test': 'Test' } },
    registry: [],
  };
}

describe('KubejsPreviewPanel', () => {
  it('无 spec 时显示空态', () => {
    render(<KubejsPreviewPanel />);
    expect(screen.getByText(/尚未生成 KubeJS/)).toBeTruthy();
  });

  it('有 spec 时渲染 tab 与配方', () => {
    useModStore.setState({ spec: makeKubejs() as never });
    render(<KubejsPreviewPanel />);
    // tab 栏存在（可能有多处"配方"文本，取 tab 按钮）
    expect(screen.getAllByText('配方').length).toBeGreaterThan(0);
    expect(screen.getByText('iron_block')).toBeTruthy();
  });

  it('切到工具提示 tab 显示内容', () => {
    useModStore.setState({ spec: makeKubejs() as never });
    render(<KubejsPreviewPanel />);
    // 点击 tab 栏中的"工具提示"按钮（在容器内找 button）
    const tooltipTabs = screen.getAllByText('工具提示');
    const tabBtn = tooltipTabs.find((el) => el.tagName === 'BUTTON') ?? tooltipTabs[0];
    fireEvent.click(tabBtn);
    // 工具提示内容（稀有! 行文本）
    expect(screen.getByText('稀有!')).toBeTruthy();
  });
});
