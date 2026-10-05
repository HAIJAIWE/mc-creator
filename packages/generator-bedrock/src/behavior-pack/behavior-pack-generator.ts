import type {
  FileNode,
  GeneratorContext,
  GenerationResult,
  Loader,
  McVersion,
  UnimplementedItem,
} from '@mc-creator/shared';
import { MC_VERSIONS } from '@mc-creator/shared';
import type { Generator } from '../types.js';
import type {
  BehaviorPackSpec,
  BpEntitySpec,
  BpRecipeSpec,
  BpLootTableSpec,
} from '@mc-creator/shared';
import { generateScriptEntry, SCRIPT_ENTRY_PATH } from '../script-api/script-codegen.js';
import { parseScriptSpec, type BpScriptSpec } from '../script-api/script-spec.js';
import {
  betaVersionSuffix,
  resolveScriptVersions,
  serverApiFamilyOf,
} from '../script-api/script-versions.js';
import {
  isModuleSupported,
  SCRIPT_UNSUPPORTED_REASONS,
  scriptUnimplementedWarning,
  unsupportedModuleReason,
} from '../script-api/unsupported.js';

/**
 * 生成简单的 UUID v4（纯 JS，兼容浏览器和 Node.js）。
 * 使用 Math.random() + Date.now() 确保跨平台可用。
 */
function generateUUID(): string {
  const hex = () => Math.floor(Math.random() * 0x10).toString(16);
  const segment = (n: number) => Array.from({ length: n }, () => hex()).join('');
  // 版本位 4，变体位 8/9/a/b
  return (
    segment(8) +
    '-' +
    segment(4) +
    '-4' +
    segment(3) +
    '-' +
    '89ab'[Math.floor(Math.random() * 4)] +
    segment(3) +
    '-' +
    segment(12)
  );
}

/**
 * 基岩版 manifest 里「声明用到实验性 Script API」的节。
 *
 * ⚠️ 诚实声明：官方 manifest 参考（MS Learn「Add-Ons Reference: manifest.json」
 * 与 minecraft.wiki「Manifest.json」）的顶层字段只有 format_version / header /
 * modules / dependencies / capabilities / metadata / settings，**没有**
 * `experiments` 节；Beta APIs 实验是世界侧的开关（level.dat 里
 * `experiments.gametest` 这个 byte tag，见 minecraft.wiki「Enabling
 * Experiments by Editing NBT」），无法由行为包 manifest 打开。
 *
 * 那么游戏到底靠什么识别「这个包用了实验性 API」？靠**依赖版本号上的 `-beta`
 * 后缀** —— 微软官方 GameTest / Scripting 文档一律用
 * `{ "module_name": "@minecraft/server", "version": "1.13.0-beta" }` 表示
 * 实验性依赖，并要求世界侧开启 Beta APIs。
 *
 * 故本实现分两层，缺一不可：
 * 1. **承重的那层**：依赖版本拼 `-beta` 后缀 + 实体 description 的
 *    `is_experimental: true` —— 这两项游戏真的会读。
 * 2. **可读的那层**：本 `experiments` 节。键名用 `gametest`，与 level.dat 里
 *    Beta APIs 的 byte tag 同名，避免自造标识。它让「用了实验性 API」在产物里
 *    显式可见、可被 grep / 快照测试固定，也与 `is_experimental` 保持同源同值
 *    （三者都由 `spec.script.experimentalApi` 一个字段驱动，不可能漂移）。
 *    若游戏忽略未知顶层键（本仓判断风险极低：manifest 是 NBT compound 反序列化，
 *    未知键被丢弃），这一层只是标记；即便被严格校验拒绝，也不会比不写更糟 ——
 *    不写的话「用了实验性 API」这件事在产物里就彻底不可见了。
 *    ⚠️ 若日后核实游戏会因未知顶层键拒绝加载，删掉本函数即可，
 *    其余两层不受影响（见 `behavior-pack-generator.test.ts` 的对应用例）。
 */
function buildExperimentsSection(experimentalApi: boolean): Record<string, boolean> | undefined {
  if (!experimentalApi) return undefined;
  // gametest = Beta APIs（level.dat experiments 复合标签里的 byte tag 名）
  return { gametest: true };
}

/** 依赖项：既支持按 uuid 依赖别的包，也支持按 module_name 依赖原生模块 */
interface ManifestDependency {
  uuid?: string;
  version: number[] | string;
  module_name?: string;
}

/**
 * 行为包生成器（基岩版 Behavior Pack）。
 * 生成 manifest.json + entities/ + recipes/ + loot_tables/ 下的 JSON 文件。
 * 行为包是基岩版原版功能，不需 loader adapter。
 *
 * Script API（设计文档 §6.3）：spec.script 存在时额外产出
 * `scripts/main.js`，并在 manifest 里补上 `type: "script"` 的模块与
 * `@minecraft/*` 原生模块依赖。**spec.script 缺省时产物与从前逐字节一致**，
 * 这样既有 14 条用例不必改、调用方也无需迁移。
 */
export class BehaviorPackGenerator implements Generator {
  readonly type = 'behavior_pack';
  readonly loaders: Loader[] = ['fabric', 'neoforge'];
  readonly versions: McVersion[] = [...MC_VERSIONS];

  async generate(ctx: GeneratorContext): Promise<GenerationResult> {
    const spec = ctx.spec as unknown as BehaviorPackSpec;
    const files: FileNode[] = [];
    const warnings: string[] = [];
    const unimplemented: UnimplementedItem[] = [];

    // Script API 段：只做局部校验，非法段退化为「未启用」+ 警告，
    // 不把 spec 校验失败变成生成失败（见 parseScriptSpec 注释）。
    const { script, error: scriptError } = parseScriptSpec(ctx.spec);
    if (scriptError) {
      warnings.push(`spec.script 校验失败，已忽略 Script API 生成：${scriptError}`);
    }
    if (script) {
      warnings.push(...collectModuleWarnings(script, unimplemented));
    }

    // manifest：Script API 存在时要追加 script 模块 + 原生模块依赖，
    // 所以先算一次脚本产物，manifest 与 files 共用同一份结果。
    const resolved = resolveScriptVersions(
      ctx.mcVersion,
      script?.serverModuleVersion,
      script?.serverUiModuleVersion,
    );
    if (script && !resolved.known && !script.serverModuleVersion) {
      warnings.push(
        `MC 版本 ${String(ctx.mcVersion)} 不在 Script API 版本表内，已回退到最保守的一档` +
          `（@minecraft/server ${resolved.versions.serverModule}）。` +
          `如需精确版本请显式设置 spec.script.serverModuleVersion。`,
      );
    }
    const scriptOut = script
      ? generateScriptEntry(
          script,
          serverApiFamilyOf(resolved.versions.serverModule),
          spec.header?.name || spec.packName,
        )
      : undefined;

    if (scriptOut) {
      warnings.push(...scriptOut.warnings);
      for (const item of scriptOut.unimplemented) {
        unimplemented.push(item);
      }
    }

    // manifest.json
    files.push(this.generateManifest(ctx, spec, script, scriptOut?.imports));

    if (scriptOut) {
      files.push({ path: SCRIPT_ENTRY_PATH, content: scriptOut.content });
    }

    // 实体行为定义
    for (const entity of spec.entities ?? []) {
      files.push(this.generateEntity(entity, script?.experimentalApi === true));
    }

    // 配方
    for (const recipe of spec.recipes ?? []) {
      files.push(this.generateRecipe(recipe));
    }

    // 战利品表
    for (const lootTable of spec.lootTables ?? []) {
      files.push(this.generateLootTable(lootTable));
    }

    return {
      files,
      warnings,
      buildCmd: '', // 行为包不需要编译
      ...(unimplemented.length > 0 ? { unimplemented } : {}),
    };
  }

  private generateManifest(
    ctx: GeneratorContext,
    spec: BehaviorPackSpec,
    script: BpScriptSpec | undefined,
    imports: Map<string, Set<string>> | undefined,
  ): FileNode {
    const headerUuid = spec.header.uuid || generateUUID();
    const moduleUuid = generateUUID();
    // packFormat / min_engine_version 一律先查表（§8.4「查表、禁止写死」），
    // spec 显式给的值优先。查表逻辑见 script-versions.ts。
    const resolved = resolveScriptVersions(
      ctx.mcVersion,
      script?.serverModuleVersion,
      script?.serverUiModuleVersion,
    );
    const minEngineVersion = spec.header.min_engine_version ?? resolved.versions.minEngineVersion;
    const formatVersion = spec.packFormat ?? resolved.versions.packFormat;
    const version = spec.header.version || spec.mcVersion;

    const modules: Record<string, unknown>[] = [
      {
        type: 'data',
        uuid: moduleUuid,
        version,
      },
    ];
    const dependencies: ManifestDependency[] = [...(spec.dependencies ?? [])];

    const experiments = buildExperimentsSection(script?.experimentalApi === true);

    if (script && imports) {
      // script 模块：type/language/entry 三者缺一不可。
      // entry 取自 SCRIPT_ENTRY_PATH（与 files 里落盘的路径同一个常量），
      // 从结构上排除「manifest 指向的文件不存在」这类 bug。
      modules.push({
        type: 'script',
        language: 'javascript',
        entry: SCRIPT_ENTRY_PATH,
        uuid: generateUUID(),
        version,
        description: `${spec.header.name || spec.packName} 的 Script API 入口（JS，manifest language 只接受 javascript）`,
      });
      // 原生模块依赖：**只声明产物里真实 import 过的模块**，
      // 依赖表由 imports 反推（而非由 spec.modules 正推），因此不可能出现
      // 「产物引用了却没声明」或「声明了却没引用」的错配。
      for (const moduleName of [...imports.keys()].sort()) {
        dependencies.push({
          module_name: moduleName,
          version: nativeModuleVersion(moduleName, resolved.versions, script.experimentalApi),
        });
      }
    }

    const manifest: Record<string, unknown> = {
      format_version: formatVersion,
      header: {
        name: spec.header.name || spec.packName,
        description: spec.header.description || spec.description,
        uuid: headerUuid,
        version,
        min_engine_version: minEngineVersion,
      },
      modules,
      dependencies,
    };
    if (experiments) {
      manifest.experiments = experiments;
    }

    return {
      path: 'manifest.json',
      content: JSON.stringify(manifest, null, 2),
    };
  }

  private generateEntity(entity: BpEntitySpec, experimental: boolean): FileNode {
    // identifier 格式: namespace:entity_id，提取 entity_id 作为文件名
    const id = entity.identifier.includes(':')
      ? entity.identifier.split(':')[1]
      : entity.identifier;

    const entityObj = {
      format_version: '1.21.0',
      'minecraft:entity': {
        description: {
          identifier: entity.identifier,
          is_spawnable: true,
          is_summonable: true,
          // 不再硬编码 false：与 spec.script.experimentalApi 同源。
          // 该字段控制实体定义在未开启 Beta APIs 的世界里能否加载，
          // 硬编码 false 会让「声明用了实验性 API」的包在普通世界里静默失效。
          is_experimental: experimental,
        },
        components: entity.components,
      },
    };

    // 如果有 events，添加到 minecraft:entity
    if (Object.keys(entity.events).length > 0) {
      (entityObj as Record<string, unknown>)['minecraft:entity'] = {
        ...entityObj['minecraft:entity'],
        events: entity.events,
      };
    }

    return {
      path: `entities/${id}.json`,
      content: JSON.stringify(entityObj, null, 2),
    };
  }

  private generateRecipe(recipe: BpRecipeSpec): FileNode {
    // identifier 格式: namespace:recipe_id，提取 recipe_id 作为文件名
    const id = recipe.identifier.includes(':')
      ? recipe.identifier.split(':')[1]
      : recipe.identifier;

    let recipeObj: Record<string, unknown>;

    switch (recipe.type) {
      case 'shaped_crafting':
        recipeObj = {
          format_version: '1.21.0',
          'minecraft:recipe_shaped': {
            description: {
              identifier: recipe.identifier,
            },
            tags: ['crafting_table'],
            pattern: recipe.pattern ?? [],
            key: recipe.key ?? {},
            result: {
              item: recipe.result,
              count: recipe.count,
            },
          },
        };
        break;
      case 'shapeless_crafting':
        recipeObj = {
          format_version: '1.21.0',
          'minecraft:recipe_shapeless': {
            description: {
              identifier: recipe.identifier,
            },
            tags: ['crafting_table'],
            ingredients: (recipe.items ?? []).map((i) => ({ item: i })),
            result: {
              item: recipe.result,
              count: recipe.count,
            },
          },
        };
        break;
      case 'furnace':
        recipeObj = {
          format_version: '1.21.0',
          'minecraft:recipe_furnace': {
            description: {
              identifier: recipe.identifier,
            },
            tags: ['furnace'],
            input: recipe.items?.[0] ?? '',
            output: recipe.result,
          },
        };
        break;
    }

    return {
      path: `recipes/${id}.json`,
      content: JSON.stringify(recipeObj, null, 2),
    };
  }

  private generateLootTable(lootTable: BpLootTableSpec): FileNode {
    const lootObj = {
      format_version: '1.21.0',
      'minecraft:loot_table': {
        pools: lootTable.pools.map((p) => ({
          rolls: p.rolls,
          entries: p.entries.map((e) => ({
            type: e.type === 'item' ? 'minecraft:item' : `minecraft:${e.type}`,
            name: e.name,
            weight: e.weight,
            count: e.count,
          })),
        })),
      },
    };

    return {
      path: `loot_tables/${lootTable.path}.json`,
      content: JSON.stringify(lootObj, null, 2),
    };
  }
}

/** 原生模块 → 依赖版本（实验性时拼 -beta 后缀，见 buildExperimentsSection 的说明） */
function nativeModuleVersion(
  moduleName: string,
  versions: { serverModule: string; serverUiModule: string },
  experimentalApi: boolean,
): string {
  const base =
    moduleName === '@minecraft/server-ui' ? versions.serverUiModule : versions.serverModule;
  return experimentalApi ? betaVersionSuffix(base) : base;
}

/**
 * 作者声明用到但本生成器不支持的模块 → 登记未实现清单 + 警告。
 *
 * 绝不为不支持的模块生成 import：那会产出一个在任何玩家端世界都加载失败的包
 * （`@minecraft/server-admin` / `@minecraft/server-net` 均为 BDS 专用 + 仅 beta，
 * 见官方 API Modules 文档），比「不生成」更糟。
 */
function collectModuleWarnings(script: BpScriptSpec, unimplemented: UnimplementedItem[]): string[] {
  const warnings: string[] = [];
  for (const module of script.modules) {
    if (isModuleSupported(module)) continue;
    const reasonKey = unsupportedModuleReason(module);
    if (!reasonKey) continue;
    const item: UnimplementedItem = {
      kind: 'action',
      type: `module:@minecraft/${module}`,
      id: '',
      reason: SCRIPT_UNSUPPORTED_REASONS[reasonKey],
    };
    unimplemented.push(item);
    // 复用统一的文案格式（与 generator-mod 的 unimplementedWarning 同形），
    // 避免 warning 与 unimplemented 两份文本各写一遍而漂移。
    warnings.push(scriptUnimplementedWarning(item));
  }
  if (script.experimentalApi) {
    warnings.push(
      '已按 spec.script.experimentalApi 声明实验性 Script API：manifest 依赖版本已加 -beta 后缀' +
        '、实体 is_experimental 已置 true。注意「Beta APIs」实验是世界侧开关' +
        '（level.dat 的 experiments.gametest），manifest 无法打开，请让使用者在世界设置里开启。',
    );
  }
  return warnings;
}
