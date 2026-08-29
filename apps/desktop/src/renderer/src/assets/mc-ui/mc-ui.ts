// MC UI 素材加载器
// 自动收集 mc-ui/ 下所有 svg/png/webp，返回 `scope/name` -> URL
// 用法: import { mcAsset } from './assets/mc-ui/mc-ui';
//       const url = mcAsset('mob', 'creeper');  ->  "./mob/creeper.png" 的构建后 URL
const modules = import.meta.glob('./*/*.{svg,png,webp}', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;

/** SVG 原样加载（供内联渲染以继承 currentColor，解决 <img> 无法着色的问题） */
const rawSvgs = import.meta.glob('./*/*.svg', {
  eager: true,
  query: '?raw',
  import: 'default',
}) as Record<string, string>;

export type McAssetScope = 'pixel' | 'game' | 'mob';

const EXT = ['svg', 'png', 'webp'] as const;

export function mcAsset(scope: McAssetScope, name: string): string {
  for (const ext of EXT) {
    const key = `./${scope}/${name}.${ext}`;
    if (modules[key]) return modules[key];
  }
  return '';
}

/** 取 SVG 的原始字符串；非 svg 或不存在返回空串 */
export function mcAssetRaw(scope: McAssetScope, name: string): string {
  return rawSvgs[`./${scope}/${name}.svg`] ?? '';
}

export function listAssets(scope: McAssetScope): string[] {
  const prefix = `./${scope}/`;
  return Object.keys(modules)
    .filter((k) => k.startsWith(prefix))
    .map((k) => k.slice(k.lastIndexOf('/') + 1, k.lastIndexOf('.')));
}
