/**
 * 外部 mod 列表适配层（不用 ipcClient.invoke）
 *
 * 优先调 window.mcApi?.listInstalledMods?.()（若可用），
 * 否则用 mock 列表兜底。编辑时不阻塞，编译时才检测依赖。
 */

export interface ExternalMod {
  namespace: string;
  name: string;
  version: string;
  installed: boolean;
}

const MOCK_MODS: ExternalMod[] = [
  { namespace: 'minecraft', name: 'Minecraft', version: '1.20.1', installed: true },
  { namespace: 'forge', name: 'Forge API', version: '47.2.0', installed: true },
  { namespace: 'fabric', name: 'Fabric API', version: '0.90.0', installed: true },
  { namespace: 'jei', name: 'Just Enough Items', version: '15.2.0', installed: true },
  { namespace: 'create', name: 'Create', version: '0.5.1', installed: false },
];

const MOCK_ITEMS: Record<string, string[]> = {
  minecraft: ['iron_ingot', 'gold_ingot', 'diamond', 'stick', 'crafting_table'],
  forge: ['forge:energy', 'forge:fluid'],
  fabric: ['fabric:tags'],
  jei: ['jei:tooltip'],
  create: ['create:cogwheel', 'create:shaft', 'create:mechanical_press'],
};

export async function listExternalMods(): Promise<ExternalMod[]> {
  try {
    const api = (window as { mcApi?: { listInstalledMods?: () => Promise<ExternalMod[]> } }).mcApi;
    if (api?.listInstalledMods) {
      const mods = await api.listInstalledMods();
      return mods.length > 0 ? mods : MOCK_MODS;
    }
  } catch {
    // IPC 失败，回退 mock
  }
  return MOCK_MODS;
}

export async function getModItems(namespace: string): Promise<string[]> {
  try {
    const api = (window as { mcApi?: { getModItems?: (ns: string) => Promise<string[]> } }).mcApi;
    if (api?.getModItems) {
      return await api.getModItems(namespace);
    }
  } catch {
    // 回退 mock
  }
  return MOCK_ITEMS[namespace] ?? [];
}
