export * from './types.js';
export * from './registry.js';
export * from './mod/index.js';
export * from './datapack/index.js';
export * from './modpack/index.js';
export * from './server/index.js';
export * from './skin/index.js';
export * from './resource-pack/index.js';
export * from './launcher/index.js';
export * from './kubejs/index.js';
export * from './crafttweaker/index.js';
export * from './behavior-pack/index.js';
export * from './enchantment/index.js';
export * from './behavior-item/index.js';
export * from './behavior-entity/index.js';
import { GeneratorRegistry } from './registry.js';
import { ModGenerator } from './mod/index.js';
import { DatapackGenerator } from './datapack/index.js';
import { ModpackGenerator } from './modpack/index.js';
import { ServerGenerator } from './server/index.js';
import { SkinGenerator } from './skin/index.js';
import { ResourcePackGenerator } from './resource-pack/index.js';
import { LauncherGenerator } from './launcher/index.js';
import { KubejsGenerator } from './kubejs/index.js';
import { CraftTweakerGenerator } from './crafttweaker/index.js';
import { BehaviorPackGenerator } from './behavior-pack/index.js';
import { EnchantmentGenerator } from './enchantment/index.js';
import { BehaviorItemGenerator } from './behavior-item/index.js';
import { BehaviorEntityGenerator } from './behavior-entity/index.js';
// §6.4 基岩皮肤包生成器本体在 @mc-creator/generator-bedrock（与 behavior-pack 等
// 基岩生成器同包），core 依赖该包，故在此注册即可 —— 不需要把文件搬进 core。
import { SkinPackGenerator } from '@mc-creator/generator-bedrock';

/**
 * 创建已注册所有内置生成器的默认注册表。
 * 新增生成器只需在此处 register，ipc 层通过 registry.get(type) 路由，无需改 switch/case。
 */
export function createDefaultRegistry(): GeneratorRegistry {
  const registry = new GeneratorRegistry();
  registry.register(new ModGenerator());
  registry.register(new DatapackGenerator());
  registry.register(new ModpackGenerator());
  registry.register(new ServerGenerator());
  registry.register(new SkinGenerator());
  registry.register(new ResourcePackGenerator());
  registry.register(new LauncherGenerator());
  registry.register(new KubejsGenerator());
  registry.register(new CraftTweakerGenerator());
  registry.register(new BehaviorPackGenerator());
  registry.register(new EnchantmentGenerator());
  registry.register(new BehaviorItemGenerator());
  registry.register(new BehaviorEntityGenerator());
  registry.register(new SkinPackGenerator());
  return registry;
}
