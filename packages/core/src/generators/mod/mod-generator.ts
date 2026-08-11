import type { GeneratorContext, GenerationResult } from '@mc-creator/shared';
import type { Loader, McVersion } from '@mc-creator/shared';
import { MC_VERSIONS } from '@mc-creator/shared';
import type { Generator } from '../types.js';
import type { LoaderAdapter } from './adapter.js';
import { FabricAdapter } from './fabric-adapter.js';
import { LegacyFabricAdapter } from './legacy-fabric-adapter.js';
import { NeoForgeAdapter } from './neoforge-adapter.js';
import { QuiltAdapter } from './quilt-adapter.js';
import { BuildCache, type IncrementalResult } from '../../builder/BuildCache.js';

/**
 * 增量生成结果（P1-4）：在 GenerationResult 基础上增加构建统计与缓存快照。
 */
export interface IncrementalGenerationResult extends GenerationResult {
  /** 构建统计：命中缓存 / 重新生成的类别数等 */
  stats: IncrementalResult['stats'];
  /** 本次构建后的缓存快照（可持久化，下次构建传入以实现增量） */
  cacheSnapshot: ReturnType<BuildCache['snapshot']>;
}

/**
 * Mod 生成器（规格 §3）：实现统一 Generator 接口，按 ctx.loader 路由到对应 LoaderAdapter。
 * 同一 ModSpec 切换 loader 时，重新调 generate 即可产出另一套源码（规格 §3.2）。
 */
export class ModGenerator implements Generator {
  readonly type = 'mod';
  readonly loaders: Loader[] = ['fabric', 'neoforge', 'quilt', 'legacy_fabric'];
  readonly versions: McVersion[] = [...MC_VERSIONS];

  // vanilla 没有 mod adapter（原版无 mod 加载器），故用 Partial。
  private readonly adapters: Partial<Record<Loader, LoaderAdapter>> = {
    fabric: new FabricAdapter(),
    neoforge: new NeoForgeAdapter(),
    quilt: new QuiltAdapter(),
    legacy_fabric: new LegacyFabricAdapter(),
  };

  async generate(ctx: GeneratorContext): Promise<GenerationResult> {
    const adapter = this.adapters[ctx.loader];
    if (!adapter) {
      throw new Error(`ModGenerator does not support loader: ${ctx.loader}`);
    }
    const files = adapter.translate(ctx);
    // P2 dogfood：收集 adapter 翻译过程中的警告（当前 adapter 不产出 warnings，
    // 但保持返回结构一致性，便于未来扩展）
    const warnings = this.validateSpec(ctx);
    return {
      files,
      warnings,
      buildCmd: './gradlew build',
    };
  }

  /** 校验：spec 中各类别是否为空（全空时提醒用户）。generate 与 generateWithCache 共用。 */
  private validateSpec(ctx: GeneratorContext): string[] {
    const warnings: string[] = [];
    const spec = ctx.spec;
    if (
      spec.items.length === 0 &&
      spec.blocks.length === 0 &&
      (spec.recipes?.length ?? 0) === 0 &&
      (spec.entities?.length ?? 0) === 0 &&
      (spec.machines?.length ?? 0) === 0 &&
      (spec.customCode?.length ?? 0) === 0 &&
      (spec.multiblocks?.length ?? 0) === 0 &&
      (spec.eventHandlers?.length ?? 0) === 0
    ) {
      warnings.push('ModSpec 中所有内容字段均为空，生成的项目将仅包含框架代码');
    }
    // 版本感知：26.2 的 NeoForge 尚为 beta（26.1 已发布，版本号为真实值）
    if (ctx.mcVersion === '26.2') {
      warnings.push('MC 26.2 的 NeoForge 版本为 beta（26.2.0.41-beta），正式版发布后请更新版本号');
    }
    return warnings;
  }

  /**
   * P1-4：增量生成（对标 MCreator BuildCache）。
   *
   * 流程：
   * 1. 从传入的 prevSnapshot 恢复缓存
   * 2. 若 adapter 支持 translateWithCache → 真正的类别级增量
   * 3. 否则回退到 translate（全量生成），stats 标记为全量
   * 4. 返回文件 + 统计 + 新的缓存快照
   *
   * 调用方负责持久化 cacheSnapshot（如写入 .mc-creator/build-cache.json），
   * 下次构建时传入以实现跨会话增量。
   *
   * @param ctx 生成上下文
   * @param prevSnapshot 上次构建的缓存快照（首次构建传 undefined）
   */
  async generateWithCache(
    ctx: GeneratorContext,
    prevSnapshot?: ReturnType<BuildCache['snapshot']>,
  ): Promise<IncrementalGenerationResult> {
    const adapter = this.adapters[ctx.loader];
    if (!adapter) {
      throw new Error(`ModGenerator does not support loader: ${ctx.loader}`);
    }

    const cache = new BuildCache();
    cache.load(prevSnapshot);

    // adapter 支持增量 → 类别级增量；否则全量生成
    if (adapter.translateWithCache) {
      const result = adapter.translateWithCache(ctx, cache);
      return {
        files: result.files,
        warnings: this.validateSpec(ctx),
        buildCmd: './gradlew build',
        stats: result.stats,
        cacheSnapshot: result.cacheSnapshot,
      };
    }

    // 回退：全量生成，stats 标记全量重新生成
    const files = adapter.translate(ctx);
    return {
      files,
      warnings: this.validateSpec(ctx),
      buildCmd: './gradlew build',
      stats: {
        total: 0,
        cached: 0,
        regenerated: 0,
        filesTotal: files.length,
        filesUnchanged: 0,
      },
      cacheSnapshot: cache.snapshot(),
    };
  }
}
