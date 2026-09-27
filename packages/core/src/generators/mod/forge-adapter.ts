import type { FileNode, GeneratorContext, Loader } from '@mc-creator/shared';
import { getLoaderVersions } from '@mc-creator/shared';
import type { LoaderAdapter } from './adapter.js';
import { mainClassName, packageName } from './templates.js';
import { BuildCache, hashCategory, type IncrementalResult } from '../../builder/BuildCache.js';
import type { CategoryDescriptor, ModSpecLike } from './mod-common.js';
import {
  forgeMainClass,
  forgeModItemsJava,
  forgeModBlocksJava,
  forgeModFluidsJava,
  forgeModBiomesJava,
  forgeModDimensionsJava,
  forgeModGuisJava,
  forgeModStructuresJava,
  forgeModRecipesJava,
  forgeModEntitiesJava,
  forgeModMachinesJava,
  forgeModCustomCodeJava,
  forgeModMultiblocksJava,
  forgeModEventsJava,
} from './forge-java.js';
// 资源文件 loader 无关，直接复用 NeoForge 的
import { neoforgeMetaJson, neoforgeLangJson, neoforgeItemModels } from './neoforge-assets.js';
import {
  forgeModsToml,
  forgeBuildGradle,
  forgeSettingsGradle,
  forgeGradleProperties,
  forgeWrapperProperties,
} from './forge-gradle.js';
import {
  worldgenBiomeJson,
  worldgenDimensionJson,
  worldgenStructureJson,
} from './worldgen-json-generator.js';

/**
 * Forge Loader Adapter（MinecraftForge 1.20.1 / build 47.x，ForgeGradle 6）。
 *
 * Java 生成复用 NeoForge 20.1（同版本 API 一致，见 forge-java.ts 说明）；
 * 本文件只装配 Forge 特异的构建文件（mods.toml forge 依赖 + FG6 build.gradle）
 * 与 22 类别表（含 worldgen 数据包 JSON）。
 */
export class ForgeAdapter implements LoaderAdapter {
  readonly loader: Loader = 'forge';

  translate(ctx: GeneratorContext): FileNode[] {
    return this.translateWithCache(ctx, new BuildCache()).files;
  }

  translateWithCache(ctx: GeneratorContext, cache: BuildCache): IncrementalResult {
    const { spec, mcVersion } = ctx;
    const pkg = packageName(spec.modId);
    const mainCls = mainClassName(spec.modId);
    const versions = ctx.loaderVersions ?? getLoaderVersions(mcVersion);
    const files: FileNode[] = [];
    let cached = 0;
    let regenerated = 0;

    const prevSnapshot = cache.snapshot();
    const prevFiles = new Map<string, string>();
    for (const entry of Object.values(prevSnapshot)) {
      for (const f of entry.files) {
        prevFiles.set(f.path, f.content);
      }
    }

    for (const cat of this.categories) {
      const hash = hashCategory(cat.hashInputs(spec, mcVersion));
      const key = BuildCache.buildKey(spec.modId, this.loader, cat.name);
      const cachedFiles = cache.getCached(key, hash);
      if (cachedFiles) {
        files.push(...cachedFiles);
        cached++;
      } else {
        const newFiles = cat.generate(spec, pkg, mainCls, mcVersion, versions);
        files.push(...newFiles);
        cache.setCache(key, hash, newFiles);
        regenerated++;
      }
    }

    const filesUnchanged = files.filter((f) => prevFiles.get(f.path) === f.content).length;

    return {
      files,
      stats: {
        total: this.categories.length,
        cached,
        regenerated,
        filesTotal: files.length,
        filesUnchanged,
      },
      cacheSnapshot: cache.snapshot(),
    };
  }

  private categories: CategoryDescriptor<ModSpecLike>[] = [
    {
      name: 'modsToml',
      hashInputs: (s, mcVersion) => [s.modId, s.name, s.description, s.version, mcVersion],
      generate: (s, _pkg, _mainCls, mcVersion, versions) => [forgeModsToml(s, mcVersion, versions)],
    },
    {
      name: 'buildGradle',
      hashInputs: (s, mcVersion) => [s.modId, s.version, mcVersion],
      generate: (s, _pkg, _mainCls, mcVersion, versions) => [
        forgeBuildGradle(s, mcVersion, versions),
      ],
    },
    {
      name: 'settingsGradle',
      hashInputs: () => [],
      generate: () => [forgeSettingsGradle()],
    },
    {
      name: 'gradleProperties',
      hashInputs: (s, mcVersion) => [s.modId, s.version, mcVersion],
      generate: (s, _pkg, _mainCls, mcVersion, versions) => [
        forgeGradleProperties(s, mcVersion, versions),
      ],
    },
    {
      name: 'wrapperProperties',
      hashInputs: (s, mcVersion) => [mcVersion],
      generate: (s, _pkg, _mainCls, mcVersion) => [forgeWrapperProperties(mcVersion)],
    },
    {
      name: 'mainClass',
      hashInputs: (s) => [
        s.modId,
        s.name,
        s.items.length > 0,
        s.blocks.length > 0,
        (s.recipes?.length ?? 0) > 0,
        (s.entities?.length ?? 0) > 0,
        (s.fluids?.length ?? 0) > 0,
        (s.biomes?.length ?? 0) > 0,
        (s.dimensions?.length ?? 0) > 0,
        (s.guis?.length ?? 0) > 0,
        (s.structures?.length ?? 0) > 0,
        (s.machines?.length ?? 0) > 0,
        (s.customCode?.length ?? 0) > 0,
        (s.multiblocks?.length ?? 0) > 0,
        (s.eventHandlers?.length ?? 0) > 0 ||
          (s.conditions?.length ?? 0) > 0 ||
          (s.actions?.length ?? 0) > 0 ||
          (s.procedures?.length ?? 0) > 0,
      ],
      generate: (s, pkg, mainCls) => [forgeMainClass(s, pkg, mainCls)],
    },
    {
      name: 'items',
      hashInputs: (s) => s.items,
      generate: (s, pkg, mainCls) => [forgeModItemsJava(s, pkg, mainCls)],
    },
    {
      name: 'blocks',
      hashInputs: (s) => s.blocks,
      generate: (s, pkg, mainCls) => [forgeModBlocksJava(s, pkg, mainCls)],
    },
    {
      name: 'fluids',
      hashInputs: (s) => s.fluids ?? [],
      generate: (s, pkg, mainCls) =>
        s.fluids?.length ? [forgeModFluidsJava(s, pkg, mainCls)] : [],
    },
    {
      name: 'biomes',
      hashInputs: (s) => s.biomes ?? [],
      generate: (s, pkg) => (s.biomes?.length ? [forgeModBiomesJava(s, pkg)] : []),
    },
    {
      name: 'dimensions',
      hashInputs: (s) => s.dimensions ?? [],
      generate: (s, pkg) => (s.dimensions?.length ? [forgeModDimensionsJava(s, pkg)] : []),
    },
    {
      name: 'guis',
      hashInputs: (s) => s.guis ?? [],
      generate: (s, pkg, mainCls) => (s.guis?.length ? [forgeModGuisJava(s, pkg, mainCls)] : []),
    },
    {
      name: 'structures',
      hashInputs: (s) => s.structures ?? [],
      generate: (s, pkg) => (s.structures?.length ? [forgeModStructuresJava(s, pkg)] : []),
    },
    {
      name: 'recipes',
      hashInputs: (s) => s.recipes ?? [],
      generate: (s, pkg) => (s.recipes?.length ? [forgeModRecipesJava(s, pkg)] : []),
    },
    {
      name: 'entities',
      hashInputs: (s) => s.entities ?? [],
      generate: (s, pkg, mainCls) =>
        s.entities?.length ? [forgeModEntitiesJava(s, pkg, mainCls)] : [],
    },
    {
      name: 'machines',
      hashInputs: (s) => s.machines ?? [],
      generate: (s, pkg, mainCls) =>
        s.machines?.length ? [forgeModMachinesJava(s, pkg, mainCls)] : [],
    },
    {
      name: 'customCode',
      hashInputs: (s) => s.customCode ?? [],
      generate: (s, pkg) => (s.customCode?.length ? [forgeModCustomCodeJava(s, pkg)] : []),
    },
    {
      name: 'multiblocks',
      hashInputs: (s) => s.multiblocks ?? [],
      generate: (s, pkg) => (s.multiblocks?.length ? [forgeModMultiblocksJava(s, pkg)] : []),
    },
    {
      name: 'events',
      hashInputs: (s) => [
        s.eventHandlers ?? [],
        s.conditions ?? [],
        s.actions ?? [],
        s.procedures ?? [],
      ],
      generate: (s, pkg, mainCls) =>
        s.eventHandlers?.length || s.conditions?.length || s.actions?.length || s.procedures?.length
          ? [forgeModEventsJava(s, pkg, mainCls)]
          : [],
    },
    {
      // 世界生成 datapack JSON（生物群系/维度/结构；动态注册表不走 Java 注册）
      name: 'worldgen',
      hashInputs: (s) => [s.biomes ?? [], s.dimensions ?? [], s.structures ?? []],
      generate: (s) => [
        ...worldgenBiomeJson(s),
        ...worldgenDimensionJson(s),
        ...worldgenStructureJson(s),
      ],
    },
    {
      name: 'lang',
      hashInputs: (s) => [
        s.modId,
        s.items.map((i) => i.id + i.name),
        s.blocks.map((b) => b.id + b.name),
      ],
      generate: (s) => [neoforgeLangJson(s)],
    },
    {
      name: 'models',
      hashInputs: (s) => [s.modId, s.items.map((i) => i.id)],
      generate: (s) => neoforgeItemModels(s),
    },
    {
      name: 'metaJson',
      hashInputs: (s) => [
        s.modId,
        s.license,
        s.authors,
        s.credits,
        s.website,
        s.dependencies,
        s.items.map((i) => ({
          id: i.id,
          rarity: i.rarity,
          maxDamage: i.maxDamage,
          fuelTick: i.fuelTick,
          food: i.food ?? null,
          lore: i.lore,
        })),
        s.blocks.map((b) => ({
          id: b.id,
          miningLevel: b.miningLevel,
          lightLevel: b.lightLevel,
          resistance: b.resistance,
          soundType: b.soundType,
          dropSelf: b.dropSelf,
          dropItem: b.dropItem,
        })),
      ],
      generate: (s) => [neoforgeMetaJson(s)],
    },
  ];
}
