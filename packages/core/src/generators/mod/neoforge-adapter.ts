import type { FileNode, GeneratorContext } from '@mc-creator/shared';
import { getLoaderVersions } from '@mc-creator/shared';
import type { LoaderAdapter } from './adapter.js';
import { mainClassName, packageName } from './templates.js';
import { BuildCache, hashCategory, type IncrementalResult } from '../../builder/BuildCache.js';
import type { CategoryDescriptor, ModSpecLike } from './mod-common.js';
import {
  neoforgeMainClass,
  neoforgeModItemsJava,
  neoforgeModBlocksJava,
  neoforgeModFluidsJava,
  neoforgeModBiomesJava,
  neoforgeModDimensionsJava,
  neoforgeModGuisJava,
  neoforgeModStructuresJava,
  neoforgeModRecipesJava,
  neoforgeModEntitiesJava,
  neoforgeModMachinesJava,
  neoforgeModCustomCodeJava,
  neoforgeModMultiblocksJava,
  neoforgeModEventsJava,
} from './neoforge-java.js';
import { neoforgeMetaJson, neoforgeLangJson, neoforgeItemModels } from './neoforge-assets.js';
import {
  neoforgeModsToml,
  neoforgeBuildGradle,
  neoforgeSettingsGradle,
  neoforgeGradleProperties,
  neoforgeWrapperProperties,
} from './neoforge-gradle.js';

/**
 * NeoForge Loader Adapter（规格 §3.2）。
 * 生成 mods.toml + NeoForge moddev build.gradle + @Mod 入口 + DeferredRegister 注册代码 + 资源。
 * NeoForge 本就用 Mojang 官方名，与 Fabric 的 officialMojangMappings 一致。
 *
 * P1.3/P1.4 扩展：消费 ModSpec 新增字段（recipes/entities/machines/customCode/multiblocks/
 * eventHandlers/conditions/actions/procedures），生成对应的 ModRecipes/ModEntities/ModMachines/
 * ModCodeSnippets/ModMultiblocks/ModEvents Java 类。NeoForge 用 DeferredRegister/RegisterEvent
 * 替代 Fabric 的 Registry.register（实体/方块实体/菜单类型），其余生成模式与 Fabric 类似。
 */
export class NeoForgeAdapter implements LoaderAdapter {
  readonly loader = 'neoforge' as const;

  translate(ctx: GeneratorContext): FileNode[] {
    // P1-4：translate 复用 translateWithCache（传空缓存 = 全量生成），单一数据源避免重复
    return this.translateWithCache(ctx, new BuildCache()).files;
  }

  /**
   * P1-4：增量构建（对标 MCreator BuildCache）。
   *
   * 按"类别"拆分生成逻辑，每个类别独立计算内容哈希：
   * - 哈希相同 → 复用缓存的 FileNode，跳过代码生成
   * - 哈希不同 → 重新生成该类别文件，更新缓存
   *
   * 传入空缓存（new BuildCache()）等价于全量生成（所有类别未命中）。
   * 返回 IncrementalResult，包含文件列表、命中统计、缓存快照。
   */
  translateWithCache(ctx: GeneratorContext, cache: BuildCache): IncrementalResult {
    const { spec, mcVersion } = ctx;
    const pkg = packageName(spec.modId);
    const mainCls = mainClassName(spec.modId);
    // P2 dogfood：从 GeneratorContext 获取版本配置，未提供时回退到默认映射
    const versions = ctx.loaderVersions ?? getLoaderVersions(mcVersion);
    const files: FileNode[] = [];
    let cached = 0;
    let regenerated = 0;

    // 保存上次的文件内容快照，用于文件级增量统计
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

    // 文件级增量统计：产物中与上次内容相同的文件数（用于磁盘写入优化）
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

  /**
   * 类别描述符表：把 translate 的生成逻辑拆分为可独立缓存的类别。
   *
   * 每个类别包含：
   * - name：类别名（缓存键的一部分）
   * - hashInputs：从 spec 提取影响该类别的数据（用于计算哈希）
   * - generate：生成文件（返回空数组表示该类别当前无产物，如 recipes 为空）
   *
   * 顺序与原 translate 的文件输出顺序保持一致（测试不依赖顺序，但保持稳定）。
   */
  private categories: CategoryDescriptor<ModSpecLike>[] = [
    {
      name: 'modsToml',
      hashInputs: (s, mcVersion) => [s.modId, s.name, s.description, s.version, mcVersion],
      generate: (s, _pkg, _mainCls, mcVersion, versions) => [
        neoforgeModsToml(s, mcVersion, versions),
      ],
    },
    {
      name: 'buildGradle',
      hashInputs: (s, mcVersion) => [s.modId, s.version, mcVersion],
      generate: (s, _pkg, _mainCls, mcVersion, versions) => [
        neoforgeBuildGradle(s, mcVersion, versions),
      ],
    },
    {
      name: 'settingsGradle',
      hashInputs: () => [],
      generate: () => [neoforgeSettingsGradle()],
    },
    {
      name: 'gradleProperties',
      hashInputs: (s, mcVersion) => [s.modId, s.version, mcVersion],
      generate: (s, _pkg, _mainCls, mcVersion, versions) => [
        neoforgeGradleProperties(s, mcVersion, versions),
      ],
    },
    {
      name: 'wrapperProperties',
      hashInputs: (s, mcVersion) => [mcVersion],
      generate: (s, _pkg, _mainCls, mcVersion) => [neoforgeWrapperProperties(mcVersion)],
    },
    {
      // mainClass 依赖 modId/name + 各类别是否非空（决定 registerCalls/initCalls）
      name: 'mainClass',
      hashInputs: (s) => [
        s.modId,
        s.name,
        s.items.length > 0,
        s.blocks.length > 0,
        (s.recipes?.length ?? 0) > 0,
        (s.entities?.length ?? 0) > 0,
        (s.machines?.length ?? 0) > 0,
        (s.customCode?.length ?? 0) > 0,
        (s.multiblocks?.length ?? 0) > 0,
        (s.eventHandlers?.length ?? 0) > 0 ||
          (s.conditions?.length ?? 0) > 0 ||
          (s.actions?.length ?? 0) > 0 ||
          (s.procedures?.length ?? 0) > 0,
      ],
      generate: (s, pkg, mainCls) => [neoforgeMainClass(s, pkg, mainCls)],
    },
    {
      name: 'items',
      hashInputs: (s) => s.items,
      generate: (s, pkg, mainCls) => [neoforgeModItemsJava(s, pkg, mainCls)],
    },
    {
      name: 'blocks',
      hashInputs: (s) => s.blocks,
      generate: (s, pkg, mainCls) => [neoforgeModBlocksJava(s, pkg, mainCls)],
    },
    {
      name: 'fluids',
      hashInputs: (s) => s.fluids ?? [],
      generate: (s, pkg, mainCls) =>
        s.fluids?.length ? [neoforgeModFluidsJava(s, pkg, mainCls)] : [],
    },
    {
      name: 'biomes',
      hashInputs: (s) => s.biomes ?? [],
      generate: (s, pkg, mainCls) =>
        s.biomes?.length ? [neoforgeModBiomesJava(s, pkg, mainCls)] : [],
    },
    {
      name: 'dimensions',
      hashInputs: (s) => s.dimensions ?? [],
      generate: (s, pkg) => (s.dimensions?.length ? [neoforgeModDimensionsJava(s, pkg)] : []),
    },
    {
      name: 'guis',
      hashInputs: (s) => s.guis ?? [],
      generate: (s, pkg) => (s.guis?.length ? [neoforgeModGuisJava(s, pkg)] : []),
    },
    {
      name: 'structures',
      hashInputs: (s) => s.structures ?? [],
      generate: (s, pkg) => (s.structures?.length ? [neoforgeModStructuresJava(s, pkg)] : []),
    },
    {
      name: 'recipes',
      hashInputs: (s) => s.recipes ?? [],
      generate: (s, pkg) => (s.recipes?.length ? [neoforgeModRecipesJava(s, pkg)] : []),
    },
    {
      name: 'entities',
      hashInputs: (s) => s.entities ?? [],
      generate: (s, pkg, mainCls) =>
        s.entities?.length ? [neoforgeModEntitiesJava(s, pkg, mainCls)] : [],
    },
    {
      name: 'machines',
      hashInputs: (s) => s.machines ?? [],
      generate: (s, pkg, mainCls) =>
        s.machines?.length ? [neoforgeModMachinesJava(s, pkg, mainCls)] : [],
    },
    {
      name: 'customCode',
      hashInputs: (s) => s.customCode ?? [],
      generate: (s, pkg) => (s.customCode?.length ? [neoforgeModCustomCodeJava(s, pkg)] : []),
    },
    {
      name: 'multiblocks',
      hashInputs: (s) => s.multiblocks ?? [],
      generate: (s, pkg) => (s.multiblocks?.length ? [neoforgeModMultiblocksJava(s, pkg)] : []),
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
          ? [neoforgeModEventsJava(s, pkg, mainCls)]
          : [],
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
      // P1 dogfood 修复：NeoForge 也需要 item model JSON（与 Fabric 一致）
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
