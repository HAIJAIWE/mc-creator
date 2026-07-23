// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { listExternalMods, getModItems, type ExternalMod } from './externalModList.js';

describe('externalModList', () => {
  const originalMcApi = (window as { mcApi?: unknown }).mcApi;

  beforeEach(() => {
    (window as { mcApi?: unknown }).mcApi = undefined;
  });

  afterEach(() => {
    (window as { mcApi?: unknown }).mcApi = originalMcApi;
  });

  it('window.mcApi 不存在时用 mock 列表', async () => {
    const mods = await listExternalMods();
    expect(mods.length).toBeGreaterThan(0);
    expect(mods.some((m: ExternalMod) => m.namespace === 'minecraft')).toBe(true);
  });

  it('window.mcApi.listInstalledMods 存在时调用真实 API', async () => {
    (window as { mcApi?: unknown }).mcApi = {
      listInstalledMods: vi
        .fn()
        .mockResolvedValue([
          { namespace: 'create', name: 'Create', version: '0.5.1', installed: true },
        ]),
    };
    const mods = await listExternalMods();
    expect(mods).toHaveLength(1);
    expect(mods[0].namespace).toBe('create');
  });

  it('window.mcApi.listInstalledMods 抛错时回退 mock', async () => {
    (window as { mcApi?: unknown }).mcApi = {
      listInstalledMods: vi.fn().mockRejectedValue(new Error('IPC fail')),
    };
    const mods = await listExternalMods();
    expect(mods.length).toBeGreaterThan(0);
  });

  it('getModItems mock 返回物品列表', async () => {
    const items = await getModItems('minecraft');
    expect(Array.isArray(items)).toBe(true);
    expect(items).toContain('iron_ingot');
  });
});
