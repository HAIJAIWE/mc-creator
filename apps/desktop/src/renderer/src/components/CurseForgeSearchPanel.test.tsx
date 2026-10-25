// @vitest-environment jsdom
/**
 * CurseForgeSearchPanel（模态 · P29）测试。
 *
 * 这个文件此前**没有任何测试**，而这里恰好藏着一份「加载器清单」——
 * 「玩游戏时装哪个加载器」这件事在渲染层曾经手写在三个地方：
 * 下载页的加载器下拉、本面板的文件筛选、mod 详情页的 loader 角标。
 * 三份**当时恰好一致**，所以没有任何测试会红 —— 这正是漂移最危险的形态。
 *
 * 所以这里钉两件事：
 * 1. chips 必须来自 `PLAY_LOADER_FILTERS`（放宽到 Forge/Quilt 会被测出来）。
 * 2. 「拿掉某个选项 ≠ 那个加载器的文件看不见」—— 默认「全部」是**不过滤**，
 *    这是收窄筛选器的**代价边界**，写下来免得以后有人以为筛选器就是搜索范围。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';

const m = vi.hoisted(() => ({
  curseforgeSearch: vi.fn(),
  curseforgeFiles: vi.fn(),
}));

vi.mock('../lib/ipc-client.js', () => ({ ipcClient: m }));

import { CurseForgeSearchPanel } from './CurseForgeSearchPanel.js';
import { PLAY_LOADER_FILTERS } from '../../../shared/play-loaders.js';

const HIT = {
  id: 238222,
  name: 'Just Enough Items',
  summary: '查看物品配方',
  logoUrl: null,
  downloadCount: 100,
  categories: ['map-information'],
};

/** 三种加载器各一个文件 —— 用来验证「只做客户端过滤」这件事 */
const FILES = [
  {
    id: 1,
    displayName: 'JEI 1.21.1 Fabric',
    fileName: 'jei-1.21.1-fabric.jar',
    fileLength: 1024,
    downloadUrl: 'https://example.com/jei-fabric.jar',
    gameVersions: ['1.21.1'],
    modLoaderNames: ['Fabric'],
  },
  {
    id: 2,
    displayName: 'JEI 1.21.1 NeoForge',
    fileName: 'jei-1.21.1-neoforge.jar',
    fileLength: 1024,
    downloadUrl: 'https://example.com/jei-neoforge.jar',
    gameVersions: ['1.21.1'],
    modLoaderNames: ['NeoForge'],
  },
  {
    id: 3,
    displayName: 'JEI 1.20.1 Forge',
    fileName: 'jei-1.20.1-forge.jar',
    fileLength: 1024,
    downloadUrl: 'https://example.com/jei-forge.jar',
    gameVersions: ['1.20.1'],
    modLoaderNames: ['Forge'],
  },
];

/** 搜一次 + 点进某个项目，走到「文件选择」视图（chips 就在那里） */
async function gotoFilePicker() {
  m.curseforgeSearch.mockResolvedValue({ hits: [HIT] });
  m.curseforgeFiles.mockResolvedValue({ files: FILES });

  render(<CurseForgeSearchPanel onPick={() => {}} onClose={() => {}} />);

  fireEvent.change(screen.getByPlaceholderText('输入 mod 名称（如 JEI）'), {
    target: { value: 'JEI' },
  });
  fireEvent.click(screen.getByRole('button', { name: '搜索' }));

  fireEvent.click(await screen.findByRole('button', { name: /Just Enough Items/ }));
  await screen.findByText(/jei-1\.21\.1-fabric\.jar/);
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('CurseForgeSearchPanel · 文件筛选的加载器 chips', () => {
  it('只有「全部 + PLAY_LOADER_FILTERS」，且显示驼峰名（不是小写原始键）', async () => {
    await gotoFilePicker();

    const labels = ['all', ...PLAY_LOADER_FILTERS].map((l) =>
      l === 'all' ? '全部' : l === 'neoforge' ? 'NeoForge' : 'Fabric',
    );
    for (const label of labels) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
    }
    // 被收窄掉的两个不能再出现
    expect(screen.queryByRole('button', { name: 'Forge' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Quilt' })).toBeNull();
  });

  it('默认「全部」= 不过滤：Forge / Quilt 的文件仍然看得见', async () => {
    await gotoFilePicker();

    // 收窄筛选器只影响「能只看谁」，不影响「能看到谁」—— 这是那次收窄的代价边界
    expect(screen.getByText(/jei-1\.20\.1-forge\.jar/)).toBeInTheDocument();
    expect(screen.getByText(/jei-1\.21\.1-neoforge\.jar/)).toBeInTheDocument();
  });

  it('点某个加载器才真的过滤（大小写不敏感）', async () => {
    await gotoFilePicker();

    fireEvent.click(screen.getByRole('button', { name: 'Fabric' }));

    expect(screen.getByText(/jei-1\.21\.1-fabric\.jar/)).toBeInTheDocument();
    expect(screen.queryByText(/jei-1\.21\.1-neoforge\.jar/)).toBeNull();
    expect(screen.queryByText(/jei-1\.20\.1-forge\.jar/)).toBeNull();
  });

  it('项目里有几个文件是搜索时定的，筛选器不重新请求', async () => {
    await gotoFilePicker();
    const before = m.curseforgeFiles.mock.calls.length;

    fireEvent.click(screen.getByRole('button', { name: 'NeoForge' }));

    expect(m.curseforgeFiles.mock.calls.length).toBe(before);
  });
});
