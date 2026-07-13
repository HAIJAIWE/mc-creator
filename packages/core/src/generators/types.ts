import type { GeneratorContext, GenerationResult } from '@mc-creator/shared';
import type { Loader, McVersion } from '@mc-creator/shared';

export interface Generator {
  readonly type: string;              // 'mod' | 'datapack' | ...
  readonly loaders: Loader[];         // 支持的 loader
  readonly versions: McVersion[];     // 支持的 MC 版本
  generate(ctx: GeneratorContext): Promise<GenerationResult>;
}
