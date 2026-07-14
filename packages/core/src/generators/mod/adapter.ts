import type { FileNode, GeneratorContext } from '@mc-creator/shared';
import type { Loader } from '@mc-creator/shared';

/**
 * Loader Adapter（规格 §3.2）：把 loader 无关的 ModSpec 翻译成具体 loader 的源码文件树。
 * Fabric 与 NeoForge 各实现一个，产出 FileNode[]（路径相对项目根）。
 */
export interface LoaderAdapter {
  readonly loader: Loader;
  translate(ctx: GeneratorContext): FileNode[];
}
