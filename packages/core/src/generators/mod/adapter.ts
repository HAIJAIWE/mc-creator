import type { FileNode, GeneratorContext } from '@mc-creator/shared';
import type { Loader } from '@mc-creator/shared';
import type { BuildCache, IncrementalResult } from '../../builder/BuildCache.js';

/**
 * Loader Adapter（规格 §3.2）：把 loader 无关的 ModSpec 翻译成具体 loader 的源码文件树。
 * Fabric 与 NeoForge 各实现一个，产出 FileNode[]（路径相对项目根）。
 */
export interface LoaderAdapter {
  readonly loader: Loader;
  translate(ctx: GeneratorContext): FileNode[];
  /**
   * P1-4：增量构建（对标 MCreator BuildCache）。
   *
   * 按"类别"对比内容哈希，未变更类别复用缓存，变更类别重新生成。
   * 传入空缓存等价于全量生成。
   *
   * 可选方法：未实现的 adapter 回退到 translate（全量生成）。
   * FabricAdapter 已实现真正增量；NeoForge/Quilt/LegacyFabric 可后续补齐。
   */
  translateWithCache?(ctx: GeneratorContext, cache: BuildCache): IncrementalResult;
}
