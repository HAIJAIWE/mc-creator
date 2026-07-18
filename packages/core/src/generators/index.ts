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
import { GeneratorRegistry } from './registry.js';
import { ModGenerator } from './mod/index.js';
import { DatapackGenerator } from './datapack/index.js';
import { ModpackGenerator } from './modpack/index.js';
import { ServerGenerator } from './server/index.js';
import { SkinGenerator } from './skin/index.js';
import { ResourcePackGenerator } from './resource-pack/index.js';
import { LauncherGenerator } from './launcher/index.js';
import { KubejsGenerator } from './kubejs/index.js';

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
  return registry;
}
