import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ModSpec } from '@mc-creator/shared';
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

  it('applyGeneratedFiles 覆盖非手改文件、保护手改文件', () => {
    const store = useModStore.getState();
    store.setFiles([
      { path: 'a.java', content: 'oldA' },
      { path: 'b.json', content: 'oldB' },
    ]);
    // 模拟用户在代码 tab 手改 a.java（dirty）
    store.updateFileContent('a.java', '手改A');
    expect(useModStore.getState().dirtyFiles.has('a.java')).toBe(true);

    const preserved = store.applyGeneratedFiles([
      { path: 'a.java', content: 'genA' },
      { path: 'b.json', content: 'genB' },
      { path: 'c.json', content: 'genC' },
    ]);

    const s = useModStore.getState();
    const a = s.files.find((f) => f.path === 'a.java');
    const b = s.files.find((f) => f.path === 'b.json');
    expect(a?.content).toBe('手改A'); // 手改保留
    expect(b?.content).toBe('genB'); // 覆盖
    expect(s.files.map((f) => f.path)).toContain('c.json'); // 新增
    expect(preserved).toEqual(['a.java']);
    // 应用后手改已作为新基准，dirty 清空
    expect(s.dirtyFiles.size).toBe(0);
  });

  it('applyGeneratedFiles 保留 openTabs 与选中文件', () => {
    const store = useModStore.getState();
    store.setFiles([
      { path: 'a.java', content: 'A' },
      { path: 'b.java', content: 'B' },
    ]);
    store.selectFile('b.java');

    store.applyGeneratedFiles([
      { path: 'a.java', content: 'A2' },
      { path: 'b.java', content: 'B2' },
    ]);
    const s = useModStore.getState();
    expect(s.openTabs).toEqual(['a.java', 'b.java']);
    expect(s.selectedFile).toBe('b.java');
  });

  it('updateItem 合并补丁且锁定 id（改 id 必须走 renameItemId）', () => {
    const store = useModStore.getState();
    store.setSpec(
      ModSpec.parse({ modId: 't', name: 'T', items: [{ id: 'ruby', name: 'Ruby' }] }),
    );
    store.updateItem('ruby', { maxStackSize: 16, id: 'hacked' } as never);
    const item = useModStore.getState().spec?.items[0];
    expect(item?.maxStackSize).toBe(16);
    expect(item?.id).toBe('ruby'); // id 未被补丁改写
  });

  it('updateItem 可设置/清空可选字段（food/tool/armor）', () => {
    const store = useModStore.getState();
    store.setSpec(
      ModSpec.parse({ modId: 't', name: 'T', items: [{ id: 'apple', name: 'Apple' }] }),
    );
    store.updateItem('apple', {
      food: { hunger: 5, saturation: 0.8, effects: [], canAlwaysEat: false },
    });
    expect(useModStore.getState().spec?.items[0].food?.hunger).toBe(5);
    store.updateItem('apple', { food: undefined });
    expect(useModStore.getState().spec?.items[0].food).toBeUndefined();
  });

  it('renameItemId 改 id 并同步配方 output/inputs 引用与 blocks.dropItem', () => {
    const store = useModStore.getState();
    store.setSpec(
      ModSpec.parse({
        modId: 't',
        name: 'T',
        items: [{ id: 'ruby', name: 'Ruby' }],
        blocks: [{ id: 'ruby_block', name: 'RB', dropSelf: false, dropItem: 'ruby' }],
        recipes: [
          {
            recipeId: 'r1',
            recipeType: 'crafting_shaped',
            inputs: [{ item: 'ruby', count: 1, slot: '' }],
            output: 'ruby_block',
            outputCount: 1,
          },
        ],
      }),
    );
    store.renameItemId('ruby', 'ruby_gem');
    const s = useModStore.getState();
    expect(s.spec?.items[0].id).toBe('ruby_gem');
    expect(s.spec?.recipes[0].inputs[0].item).toBe('ruby_gem');
    expect(s.spec?.blocks[0].dropItem).toBe('ruby_gem');
  });

  it('renameItemId 目标已存在时拒绝改名（配方引用保持不动）', () => {
    const store = useModStore.getState();
    store.setSpec(
      ModSpec.parse({
        modId: 't',
        name: 'T',
        items: [
          { id: 'a', name: 'A' },
          { id: 'b', name: 'B' },
        ],
        recipes: [
          {
            recipeId: 'r1',
            recipeType: 'crafting_shapeless',
            inputs: [{ item: 'a', count: 1, slot: '' }],
            output: 'b',
            outputCount: 1,
          },
        ],
      }),
    );
    store.renameItemId('a', 'b');
    const s = useModStore.getState();
    expect(s.spec?.items.map((i) => i.id)).toEqual(['a', 'b']);
    expect(s.spec?.recipes[0].inputs[0].item).toBe('a');
  });

  it('addBlock/updateBlock/removeBlock 管理方块', () => {
    const store = useModStore.getState();
    store.setSpec(ModSpec.parse({ modId: 't', name: 'T' }));
    store.addBlock({
      id: 'ruby_block',
      name: 'Ruby Block',
      material: 'metal',
      hardness: 5,
      miningLevel: 2,
      lightLevel: 0,
      resistance: 30,
      soundType: 'metal',
      dropSelf: true,
      dropItem: '',
      stateProperties: [],
      collisionShapes: [],
      blockType: 'full_block',
      transparent: false,
      noCollision: false,
    });
    expect(useModStore.getState().spec?.blocks).toHaveLength(1);
    store.updateBlock('ruby_block', { hardness: 8, friction: 0.9, toolRequired: true });
    const b = useModStore.getState().spec?.blocks[0];
    expect(b?.hardness).toBe(8);
    expect(b?.friction).toBe(0.9);
    expect(b?.toolRequired).toBe(true);
    store.removeBlock('ruby_block');
    expect(useModStore.getState().spec?.blocks).toEqual([]);
  });

  it('renameBlockId 改方块 id 并同步配方 output 引用', () => {
    const store = useModStore.getState();
    store.setSpec(
      ModSpec.parse({
        modId: 't',
        name: 'T',
        blocks: [{ id: 'old_block', name: 'Old' }],
        recipes: [
          {
            recipeId: 'r1',
            recipeType: 'crafting_shaped',
            inputs: [{ item: 'minecraft:stone', count: 1, slot: '' }],
            output: 'old_block',
            outputCount: 1,
          },
        ],
      }),
    );
    store.renameBlockId('old_block', 'new_block');
    const s = useModStore.getState();
    expect(s.spec?.blocks[0].id).toBe('new_block');
    expect(s.spec?.recipes[0].output).toBe('new_block');
  });
});
