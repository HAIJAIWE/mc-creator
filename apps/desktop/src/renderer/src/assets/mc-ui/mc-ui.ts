// MC UI 素材加载器
// 自动收集 mc-ui/ 下所有 svg/png/webp，返回 `scope/name` -> URL
// 用法: import { mcAsset } from './assets/mc-ui/mc-ui';
//       const url = mcAsset('mob', 'creeper');  ->  "./mob/creeper.png" 的构建后 URL
const modules = import.meta.glob('./*/*.{svg,png,webp}', {
  eager: true,
  query: '?url',
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

export function listAssets(scope: McAssetScope): string[] {
  const prefix = `./${scope}/`;
  return Object.keys(modules)
    .filter((k) => k.startsWith(prefix))
    .map((k) => k.slice(k.lastIndexOf('/') + 1, k.lastIndexOf('.')));
}
