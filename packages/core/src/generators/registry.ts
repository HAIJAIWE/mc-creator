import type { Generator } from './types.js';
import type { Loader, McVersion } from '@mc-creator/shared';

/** 生成器注册表：按类型路由，能力声明匹配（规格 §2.2） */
export class GeneratorRegistry {
  private map = new Map<string, Generator>();

  register(g: Generator): void {
    this.map.set(g.type, g);
  }

  get(type: string): Generator | undefined {
    return this.map.get(type);
  }

  /** 找到支持指定 loader+版本 的生成器 */
  find(type: string, loader: Loader, version: McVersion): Generator | undefined {
    const g = this.map.get(type);
    if (!g) return undefined;
    if (!g.loaders.includes(loader)) return undefined;
    if (!g.versions.includes(version)) return undefined;
    return g;
  }

  list(): Generator[] {
    return [...this.map.values()];
  }
}
