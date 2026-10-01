import type {
  ItemSpec,
  BlockSpec,
  ModRecipeSpec,
  EntitySpec,
  MachineSpec,
  MultiBlockSpec,
  CustomCodeSnippetSpec,
} from '@mc-creator/shared';

// === 阶段 C 辅助函数 ===

/**
 * 收集所有引用的外部 mod 命名空间（排除 'minecraft' 和当前 modId）。
 * P2-3 dogfood 修复：扫描范围扩展至 entities/machines/multiblocks 的 id 字段。
 */
export function collectExternalNamespaces(
  items: ItemSpec[],
  blocks: BlockSpec[],
  recipes: ModRecipeSpec[],
  entities: EntitySpec[],
  machines: MachineSpec[],
  multiblocks: MultiBlockSpec[],
  customCode: CustomCodeSnippetSpec[],
  currentModId: string,
): Set<string> {
  const namespaces = new Set<string>();
  const extractNs = (id: string | undefined) => {
    if (!id || typeof id !== 'string') return;
    const idx = id.indexOf(':');
    if (idx > 0) {
      const ns = id.substring(0, idx);
      if (ns !== 'minecraft' && ns !== currentModId) {
        namespaces.add(ns);
      }
    }
  };
  for (const item of items) extractNs(item.id);
  for (const block of blocks) extractNs(block.id);
  for (const recipe of recipes) {
    extractNs(recipe.output);
    for (const input of recipe.inputs) extractNs(input.item);
  }
  // P2-3 dogfood 修复：扫描 entities/machines/multiblocks 的 id（可能引用外部 mod）
  for (const entity of entities) extractNs(entity.entityId);
  for (const machine of machines) extractNs(machine.machineId);
  for (const mb of multiblocks) extractNs(mb.structureId);
  for (const cc of customCode) {
    // 扫描 import 语句中的包名（com.xxx.yyy → xxx 作为 modid 猜测）
    const importMatches = cc.code.matchAll(/import\s+com\.([a-z0-9_]+)\./gi);
    for (const m of importMatches) {
      namespaces.add(m[1]);
    }
  }
  return namespaces;
}

/** 已安装外部 mod 缓存（由 preload 阶段异步填充，编译器同步读取）；模块内私有 */
let installedExternalModsCache: Set<string> | null = null;

/** 缓存是否已被 preload 填充过（编译器据此决定是否惰性预取） */
export function isExternalModsCacheLoaded(): boolean {
  return installedExternalModsCache !== null;
}

/**
 * 预加载外部 mod 缓存（导出供调用方在编译前异步预取已安装 mod 列表）。
 * 编译器内部用 isExternalModInstalled 同步读缓存。
 */
export function preloadExternalMods(mods: Array<{ namespace: string; installed: boolean }>): void {
  installedExternalModsCache = new Set(mods.filter((m) => m.installed).map((m) => m.namespace));
}

/**
 * 检查外部 mod 是否已安装（同步，读缓存）。
 * 缓存为 null 时（未 preload）默认返回 true（不误报），避免阻塞编译。
 */
export function isExternalModInstalled(namespace: string): boolean {
  if (!installedExternalModsCache) return true; // 未 preload，不误报
  return installedExternalModsCache.has(namespace);
}
