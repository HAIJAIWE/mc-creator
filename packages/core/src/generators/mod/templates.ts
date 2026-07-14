/**
 * 共享模板工具（规格 §3.2：内部以 Mojang 官方名为规范名）。
 * Fabric 与 NeoForge 共用这些命名工具，保证 loader 切换时类名/包名一致。
 */

/** modId 转 PascalCase 类名前缀（ruby_tools → RubyTools） */
export function pascalCase(modId: string): string {
  return modId
    .split('_')
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join('');
}

/** 默认包名（com.example.<modid>） */
export function packageName(modId: string): string {
  return `com.example.${modId}`;
}

/** 包路径（com/example/<modid>） */
export function packagePath(modId: string): string {
  return `com/example/${modId}`;
}

/** 主入口类名（<PascalCase>Mod） */
export function mainClassName(modId: string): string {
  return `${pascalCase(modId)}Mod`;
}

/** 物品字段名（大写下划线：ruby → RUBY） */
export function itemFieldName(itemId: string): string {
  return itemId.toUpperCase();
}

/** 方块字段名（大写下划线：ruby_block → RUBY_BLOCK） */
export function blockFieldName(blockId: string): string {
  return blockId.toUpperCase();
}
