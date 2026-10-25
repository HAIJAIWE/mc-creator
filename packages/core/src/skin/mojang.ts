/**
 * Mojang 官方皮肤：按 UUID 查。
 *
 * ## 为什么只有 UUID，没有玩家名
 *
 * 能用的官方接口是 `sessionserver.mojang.com/session/minecraft/profile/<uuid>`，
 * 实测 **200** 且 `properties` 里带 `textures`。但**名字→UUID 那一环断了**：
 * `api.mojang.com/names/{name}` 已被 Mojang 废弃（实测 ECONNRESET），
 * 离线条的 UUID 虽能自己算出来，但拿它查 sessionserver 查不到线上账号。
 *
 * 第三方替代品实测也全灭（2026-10，见文件末「为什么不给玩家名搜索」）。
 * 所以这一条只能是「输入 UUID」，而不是「输入玩家名」。
 *
 * ## textures 字段怎么解
 *
 * profile 的 `properties` 是一组 `{name, value}`，其中 `name === "textures"`
 * 那一项的 `value` 是 **base64 的 JSON**：
 *
 * ```json
 * { "profileName": "Notch",
 *   "textures": { "SKIN":  { "url": "http://textures.minecraft.net/texture/…",
 *                           "metadata": { "model": "classic" },
 *                           "variant": "classic" },
 *                  "CAPE": { "url": "…" } } }
 * ```
 *
 * 两个坑：
 * - 里面的 URL 是 **`http://`**。不换 https 的话渲染进程会被 CSP 挡掉
 *   （`img-src` 不放行 http），表现就是「下载成功但预览全空」。
 * - `metadata.model` 才是**可靠的**模型来源（classic / slim）。别用
 *   `variant` —— 它有一半是 `unknown`。
 */

import { parseSkinPng, type SkinModel } from './png.js';

const SESSION_URL = 'https://sessionserver.mojang.com/session/minecraft/profile/';

export interface OfficialSkin {
  /** 玩家名（官方返回的，不是我们输入的）。 */
  playerName: string;
  /** 皮肤直链（已换成 https）。 */
  skinUrl: string;
  /** 官方给的模型判定。取不到就是 null，由调用方决定默认值。 */
  model: SkinModel | null;
  /** 有没有正版披风。 */
  hasCape: boolean;
  capeUrl: string | null;
}

/**
 * UUID 归一化 → sessionserver 要的是**无横线**的小写 32 位。
 *
 * 顺手挡掉明显不是 UUID 的输入：这里不做严格校验，只保证格式，
 * 因为 sessionserver 自己会 404/400，我们要把那句原话带给用户。
 */
export function normalizeUuid(input: string): string | null {
  const compact = input.trim().replace(/-/g, '').toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(compact)) return null;
  return compact;
}

function toHttps(url: string): string {
  return url.replace(/^http:\/\//i, 'https://');
}

/** base64 → UTF-8 字符串。浏览器/Node 的 atob 只认 latin1，所以走 Buffer。 */
function decodeBase64(value: string): string {
  return Buffer.from(value, 'base64').toString('utf-8');
}

export async function fetchOfficialSkin(uuid: string): Promise<OfficialSkin> {
  const compact = normalizeUuid(uuid);
  if (compact === null) {
    throw new Error(
      '不是合法的 UUID（应为 32 位或 36 位带横线的十六进制）。' +
        '注意：这里要的是 UUID，不是玩家名 —— 官方的名字→UUID 接口已被废弃。',
    );
  }

  const res = await fetch(`${SESSION_URL}${compact}`, {
    headers: { 'User-Agent': 'MC-Creator/1.0' },
    signal: AbortSignal.timeout(20_000),
  });
  if (res.status === 204 || res.status === 404) {
    throw new Error('Mojang 没有这个 UUID 的正版账号记录。');
  }
  if (!res.ok) {
    throw new Error(`查正版资料失败: HTTP ${res.status}`);
  }

  const profile = (await res.json()) as {
    id?: string;
    name?: string;
    properties?: Array<{ name: string; value: string }>;
  };
  const texturesProp = profile.properties?.find((p) => p.name === 'textures');
  if (texturesProp === undefined || profile.name === undefined) {
    throw new Error('这个账号没有皮肤数据（正版账号也可能在改名字/换皮肤之前）。');
  }

  let parsed: {
    textures?: {
      SKIN?: { url?: string; metadata?: { model?: string } };
      CAPE?: { url?: string };
    };
  };
  try {
    parsed = JSON.parse(decodeBase64(texturesProp.value)) as typeof parsed;
  } catch {
    throw new Error('Mojang 返回的 textures 字段解不开（base64/JSON 格式异常）。');
  }

  const skinUrlRaw = parsed.textures?.SKIN?.url;
  if (skinUrlRaw === undefined || skinUrlRaw === '') {
    throw new Error('这个账号没有皮肤。');
  }
  // 只认 classic / slim；`variant` 有一半是 unknown，别拿它当准
  const modelRaw = parsed.textures?.SKIN?.metadata?.model;
  const model: SkinModel | null =
    modelRaw === 'slim' ? 'slim' : modelRaw === 'classic' ? 'classic' : null;

  const capeUrl = parsed.textures?.CAPE?.url;

  return {
    playerName: profile.name,
    skinUrl: toHttps(skinUrlRaw),
    model,
    hasCape: typeof capeUrl === 'string' && capeUrl !== '',
    capeUrl: capeUrl === undefined || capeUrl === '' ? null : toHttps(capeUrl),
  };
}

/**
 * 拉一张官方皮肤的 PNG 字节。
 *
 * 下载与校验分开，是为了跟 MineSkin 走同一套落库校验 ——
 * `SkinLibrary.add` 只认「真的能用的皮肤 PNG」（64×64 或 legacy 64×32），
 * 官方偶尔会返回占位图或 404 HTML。
 */
export async function downloadOfficialSkinPng(url: string): Promise<Buffer> {
  const res = await fetch(toHttps(url), {
    headers: { 'User-Agent': 'MC-Creator/1.0' },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`下载皮肤失败: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  // 先自己看一眼，别把一个 HTML 错误页塞进皮肤库
  const info = parseSkinPng(buf);
  if (!info.ok) throw new Error(info.error ?? 'Mojang 返回的不是有效的皮肤 PNG');
  return buf;
}
