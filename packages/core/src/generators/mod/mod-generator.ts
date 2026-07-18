import type { GeneratorContext, GenerationResult } from '@mc-creator/shared';
import type { Loader, McVersion } from '@mc-creator/shared';
import type { Generator } from '../types.js';
import type { LoaderAdapter } from './adapter.js';
import { FabricAdapter } from './fabric-adapter.js';
import { LegacyFabricAdapter } from './legacy-fabric-adapter.js';
import { NeoForgeAdapter } from './neoforge-adapter.js';
import { QuiltAdapter } from './quilt-adapter.js';

/**
 * Mod 生成器（规格 §3）：实现统一 Generator 接口，按 ctx.loader 路由到对应 LoaderAdapter。
 * 同一 ModSpec 切换 loader 时，重新调 generate 即可产出另一套源码（规格 §3.2）。
 */
export class ModGenerator implements Generator {
  readonly type = 'mod';
  readonly loaders: Loader[] = ['fabric', 'neoforge', 'quilt', 'legacy_fabric'];
  readonly versions: McVersion[] = ['1.21.11', '1.21.1', '26.1'];

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
    return {
      files,
      warnings: [],
      buildCmd: './gradlew build',
    };
  }
}
