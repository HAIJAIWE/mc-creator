/**
 * MineSkin 公共皮肤库客户端。
 *
 * ## 为什么是 MineSkin
 *
 * 需求里有「浏览/下载皮肤站的公共库」。实测过几个候选，只有它有可用的
 * 公开只读接口：
 *
 * | 源 | 结果 |
 * |---|---|
 * | **MineSkin** `GET /get/list/{page}` | **200，可用**，16 条/页 |
 * | LittleSkin `/api/player/{name}` | 404 —— Yggdrasil 只回答「这个账号的皮肤是什么」 |
 * | Ely.by `/api/skins` | 404 |
 *
 * ## ⚠️ 它给的元数据很少
 *
 * 一条记录只有 `{ id, uuid, url, time }` —— **没有名字、没有作者、没有标签**。
 * 单个皮肤详情端点（`/get/{id}`）也 404。响应里还带
 * `_deprecated: "use list by reference instead"`。
 *
 * 所以 UI 只能用「皮肤 #id」当标签，靠 3D 预览让人挑。这比去爬
 * mineskin.org 的 HTML 拿名字可靠（那页面 405 KB、结构随时变）。
 *
 * ## 下载走 textures.minecraft.net
 *
 * `url` 字段形如
 * `http://textures.minecraft.net/texture/<sha1>`。
 * 实测：https 200、`image/png`、64×64，可直接下。
 *
 * **限流**：MineSkin 没有文档化的配额，但它是免费公共服务，
 * 所以这里做客户端节流 + 分页大小保守。
 */

import type { SkinModel, SkinSource } from './png.js';

/** MineSkin API 根。 */
const API_BASE = 'https://api.mineskin.org';

/** 请求超时。 */
const TIMEOUT_MS = 15_000;

/** 单页条数。源站固定 16，这里是给 UI 用的「一页」概念。 */
export const MINESKIN_PAGE_SIZE = 16;

/** 一条公共库皮肤。 */
export interface MineSkinEntry {
  /** MineSkin 的数字 id（**没有名字，UI 拿它当标签**）。 */
  id: number;
  /** 皮肤 UUID（去掉连字符）。 */
  uuid: string;
  /** `textures.minecraft.net` 直链，可直接下 PNG。 */
  textureUrl: string;
  /** 发布时间（源站给的是秒级 epoch，可能是浮点数）。 */
  time: number | null;
}

export interface MineSkinPage {
  entries: MineSkinEntry[];
  /** 本页在源站的页码（1 起）。 */
  page: number;
  /** 是否还有下一页 —— 由「本页是否满」推断（源站不给总数）。 */
  hasMore: boolean;
}

/** 源站原始响应形状。 */
interface RawSkin {
  id?: number;
  skinUuid?: string;
  uuid?: string;
  url?: string;
  time?: number;
}

/**
 * 取一页公共皮肤。
 *
 * @param page 1 起的页码。第 0 页或负数按第 1 页处理。
 * @throws 网络失败 / 非 2xx / 响应缺 `skins` 时抛错 —— 调用方决定是显示错误
 *   还是静默降级，这里不猜。
 */
export async function fetchMineSkinPage(page: number): Promise<MineSkinPage> {
  const wanted = Number.isFinite(page) && page > 0 ? Math.floor(page) : 1;
  const res = await fetch(`${API_BASE}/get/list/${wanted}`, {
    headers: { 'User-Agent': 'mc-creator/0.2.0' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(`MineSkin 请求失败: HTTP ${res.status}`);
  }
  const json = (await res.json()) as { skins?: RawSkin[] };
  const raw = json.skins;
  if (!Array.isArray(raw)) {
    throw new Error('MineSkin 响应里没有 skins 字段');
  }

  const entries: MineSkinEntry[] = [];
  for (const s of raw) {
    if (typeof s.id !== 'number' || typeof s.url !== 'string' || s.url === '') continue;
    entries.push({
      id: s.id,
      uuid: s.uuid ?? s.skinUuid ?? '',
      // 源站给的是 http://；首页混合内容策略会拦，统一升到 https
      textureUrl: s.url.replace(/^http:\/\//, 'https://'),
      time: typeof s.time === 'number' ? s.time : null,
    });
  }

  return {
    entries,
    page: wanted,
    // 满页就当还有下一页。翻到空页时自然没得显示，不必专门探测末页。
    hasMore: entries.length >= MINESKIN_PAGE_SIZE,
  };
}

/**
 * 下一条公共皮肤的 PNG。
 *
 * 走的是 Mojang 的 textures CDN，不是 MineSkin 自己 —— 这一点在日志里
 * 要能看出来（排查「图裂了」时第一个问题就是「从哪儿下的」）。
 *
 * @param maxBytes 兜底上限。皮肤 PNG 实际几十 KB，给 4 MB 足够拦异常响应。
 */
export async function downloadMineSkinPng(
  entry: MineSkinEntry,
  maxBytes = 4 * 1024 * 1024,
): Promise<Buffer> {
  const res = await fetch(entry.textureUrl, {
    headers: { 'User-Agent': 'mc-creator/0.2.0' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`下载皮肤 PNG 失败: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > maxBytes) throw new Error(`皮肤 PNG 过大（${buf.length} > ${maxBytes} 字节）`);
  return buf;
}

/** 入库时这条记录的来源标签。 */
export const MINESKIN_SOURCE: SkinSource = 'mineskin';

/** 默认模型 —— classic（Minecraft 默认皮肤），与 PCL / HMCL 一致。 */
export const DEFAULT_SKIN_MODEL: SkinModel = 'classic';
