/**
 * 从下载 URL 里取文件名（去掉查询串，取最后一段）。
 *
 * 列表行的下载按钮只有 URL，没有独立的 filename 字段 —— 源站 URL 的末段
 * 就是文件名（Modrinth 的 `/data/xxx/versions/yyy/file.jar`、CurseForge 的
 * `/files/1234/file.jar`）。取不到时给个兜底名，主进程还会再校验一次。
 */
export function filenameFromUrl(url: string, fallback = 'download.jar'): string {
  const last = url.split('?')[0].split('#')[0].split('/').pop() ?? '';
  return last || fallback;
}

/**
 * 在线内容的公共展示格式化（搜索结果行 + 详情页共用）。
 *
 * 单独拆文件而不是塞在 DownloadTab 里：详情页也要用同一套
 * 分类中文映射、loader 展示名、下载量/时间格式化。两处各写一份，
 * 改了一处忘另一处，界面就会「列表里是中文、详情页是英文」。
 */

/**
 * 分类键 → 中文标签（对齐 PCL 下载页的说法）。
 *
 * 源站给的是英文键（Modrinth `categories` / CurseForge `categories`），
 * 原样显示对中文用户没意义。未收录的键**原样返回** —— 宁可显示原文
 * 也不显示空白，更不猜。
 */
const CATEGORY_ZH: Record<string, string> = {
  performance: '性能优化',
  optimization: '性能优化',
  decoration: '装饰',
  library: '支持库',
  utility: '工具',
  adventure: '冒险',
  technology: '科技',
  magic: '魔法',
  redstone: '红石',
  farming: '农业',
  food: '食物',
  worldgen: '世界元素',
  biomes: '生物群系',
  dimensions: '维度',
  ores: '矿物与资源',
  structures: '天然结构',
  transportation: '管道与物流',
  automation: '自动化',
  energy: '能源',
  storage: '存储',
  mobs: '生物',
  social: '社交',
  equipment: '装备',
  combat: '战斗',
  cosmetic: '外观',
  misc: '杂项',
  'game-mechanics': '游戏机制',
};

/**
 * loader 键 → 展示名（PCL 用 Fabric / NeoForge 这种驼峰）。
 *
 * ⚠️ 这里收的是**外部源返回的 loader 键**（Modrinth / CurseForge），所以
 * 含有 `liteloader` / `rift` —— 那**不是** `@mc-creator/shared` 的 `Loader`
 * 取值。生成器那边的加载器展示名在 `shared/generator-descriptors.ts`，
 * 名字叫 `loaderLabel`，领域不同，别混用（两边都收 `string`，混了也不会报错，
 * 只会显示成对方的名字）。
 */
const SOURCE_LOADER_LABEL: Record<string, string> = {
  fabric: 'Fabric',
  forge: 'Forge',
  neoforge: 'NeoForge',
  quilt: 'Quilt',
  liteloader: 'LiteLoader',
  rift: 'Rift',
};

export function categoryLabel(key: string): string {
  return CATEGORY_ZH[key] ?? key;
}

/** 外部源（Modrinth / CurseForge）的 loader 键 → 展示名。 */
export function sourceLoaderLabel(key: string): string {
  return SOURCE_LOADER_LABEL[key] ?? key.charAt(0).toUpperCase() + key.slice(1);
}

/** 下载量 → PCL 那种「2.43亿」/「1.8万」/「2600」。 */
export function formatDownloads(n: number): string {
  if (n >= 1e8) return `${(n / 1e8).toFixed(2)}亿`;
  if (n >= 1e4) return `${(n / 1e4).toFixed(1)}万`;
  return String(n);
}

/** 毫秒时间戳 → PCL 那种「21 天前」。拿不到就返回 null，由调用方决定不显示。 */
export function formatAgo(ms: number | undefined): string | null {
  if (ms === undefined) return null;
  const days = Math.floor((Date.now() - ms) / 86_400_000);
  if (days <= 0) return '今天';
  if (days === 1) return '昨天';
  if (days < 30) return `${days} 天前`;
  if (days < 365) return `${Math.floor(days / 30)} 个月前`;
  return `${Math.floor(days / 365)} 年前`;
}

/**
 * 支持版本清单 → PCL 那种「1.16+」（取最低版本当起点）。
 *
 * 返回 null 表示这一行不显示 —— 没有数据就少一行，不硬凑 "无"。
 */
export function versionRange(versions: string[]): string | null {
  if (versions.length === 0) return null;
  let low: { major: number; minor: number } | null = null;
  for (const v of versions) {
    const m = /^(\d+)\.(\d+)/.exec(v);
    if (!m) continue;
    const cur = { major: Number(m[1]), minor: Number(m[2]) };
    if (low === null) {
      low = cur;
      continue;
    }
    if (cur.major < low.major || (cur.major === low.major && cur.minor < low.minor)) low = cur;
  }
  return low === null ? null : `${low.major}.${low.minor}+`;
}
