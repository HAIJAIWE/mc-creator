/**
 * 皮肤链接的规范化与识别。
 *
 * ## 为什么需要这一层
 *
 * 用户手头拿到的皮肤链接，绝大多数**不是**一张 64×64 PNG。最常见的是
 * MC百科（mcmod.cn）的链接，而它有两个坑，两个都能让「按链接导入」静默出错：
 *
 * 1. **站上所有图都是 WebP**。实测 `i.mcmod.cn` 返回
 *    `content-type: image/webp` —— 我们的 PNG 校验（看 magic）会拒绝它，
 *    报「不是有效的皮肤 PNG」。用户看到的是「链接没问题啊为什么不认」。
 *
 * 2. **缩略图带 `@宽x高` 后缀**。实测站内图片 URL 形如
 *    `https://i.mcmod.cn/class/cover/…_sbCO.jpg@480x300.jpg`。
 *    从页面直接复制到的常是这种缩放版 —— 拿它当皮肤会得到 480×300 的图，
 *    尺寸校验直接拒，而错误信息同样只说「尺寸不对」。
 *
 * 所以导入前必须先规范化，且要能识别「这是 MC百科 页面链接」——
 * 那种要另走解析，不能当图片直链 fetch。
 *
 * ## 好消息：可以直接 fetch
 *
 * 实测 `i.mcmod.cn` 响应 `access-control-allow-origin: *`，
 * 所以渲染层可以自己拉下来转 PNG（Chromium 的 `<img>` / `createImageBitmap`
 * 原生解 WebP，不需要装 sharp 这类原生依赖）。
 */

/** 链接的类别，决定导入走哪条路。 */
export type SkinLinkKind =
  /** MC百科 词条 / 教程页，要解析页面拿图。 */
  | 'mcmod-page'
  /** MC百科 的图床直链（i.mcmod.cn）。 */
  | 'mcmod-image'
  /** 其它直链（含 Mojang texture、任意图床）。 */
  | 'direct'
  /** 连 URL 都不是。 */
  | 'invalid';

export interface SkinLink {
  /** 原始输入（原样保留，错误信息里要引用）。 */
  raw: string;
  kind: SkinLinkKind;
  /**
   * 规范化后的 URL。
   *
   * - 去掉了 MC百科 的 `@宽x高` 缩放后缀
   * - 统一转成 https
   *
   * `kind === 'mcmod-page'` 或 `'invalid'` 时为 null。
   */
  url: string | null;
  /** 是否动过（主要是为了测试与调试时能说清改了什么）。 */
  normalized: boolean;
}

/**
 * MC百科 的 `@宽x高.扩展名` 缩放后缀。
 *
 * 例：`…_sbCO.jpg@480x300.jpg` → `…_sbCO.jpg`
 * 只认这个形状，不会把正常 URL 里带 `@` 的（如 email 风格的路径）误伤。
 */
const RESIZE_SUFFIX = /@\d+x\d+\.(?:png|jpe?g|webp|gif|avif)$/i;

/** MC百科 图床域名。 */
const MCMOD_IMAGE_HOST = 'i.mcmod.cn';

/** MC百科 站点域名（词条 / 教程页）。 */
const MCMOD_SITE_HOSTS = ['mcmod.cn', 'www.mcmod.cn', 'bbs.mcmod.cn'];

function toHttps(url: string): string {
  return url.replace(/^http:\/\//i, 'https://');
}

/** 能不能解析成 URL（顺手判掉空串和明显不是 URL 的输入）。 */
export function parseHttpUrl(input: string): URL | null {
  const s = input.trim();
  if (s === '') return null;
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return null;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  return u;
}

/**
 * 判断一个 URL 是不是 MC百科 的**页面**链接。
 *
 * 词条 `/class/<id>.html`、教程 `/post/<id>.html` 之类。这类链接
 * 不能当图片 fetch —— fetch 回来的会是 HTML。
 */
export function isMcmodPageUrl(input: string): boolean {
  const u = parseHttpUrl(input);
  if (u === null) return false;
  return MCMOD_SITE_HOSTS.includes(u.hostname);
}

/**
 * 规范化皮肤链接。
 *
 * 这是导入前必过的一步，不是「锦上添花」：不 strip `@宽x高` 就会下到缩放
 * 缩略图，不识别页面链接就会把 HTML 当成图片去解。两者都会报错，
 * 但错误信息（"不是有效的皮肤 PNG"）完全指不到真正的原因。
 */
export function normalizeSkinLink(input: string): SkinLink {
  const raw = input;
  const u = parseHttpUrl(input);
  if (u === null) return { raw, kind: 'invalid', url: null, normalized: false };

  if (MCMOD_SITE_HOSTS.includes(u.hostname)) {
    return { raw, kind: 'mcmod-page', url: null, normalized: false };
  }

  // 后缀整段追加在原图名后面（`…_sbCO.jpg` + `@480x300.jpg`），所以整段删掉，
  // 别把扩展名再拼回去 —— 那会得到 `…_sbCO.jpgjpg`。
  // ⚠️ 只动 **pathname**：缩放后缀带 `$` 锚点，而 URL 末尾可能是 query
  // （`…@64x64.png?x=1`），把 query 一起拿去匹配就永远strip不掉。
  const strippedPath = u.pathname.replace(RESIZE_SUFFIX, '');
  const https = toHttps(`${u.origin}${strippedPath}${u.search}`);

  return {
    raw,
    kind: u.hostname === MCMOD_IMAGE_HOST ? 'mcmod-image' : 'direct',
    url: https,
    normalized: https !== input.trim(),
  };
}

/**
 * 从 MC百科 页面 HTML 里挑出图片候选。
 *
 * ⚠️ 返回的是**候选**，不是「那张皮肤」：一页里通常有十几张图（截图、
 * 教程步骤图），我们无法从 HTML 判断哪张是皮肤。所以调用方要么让用户挑，
 * 要么在只有一张图时直接用 —— 不要赌。
 */
export function extractMcmodImageUrls(html: string): string[] {
  const out = new Set<string>();
  // 只认图床域名，且要带扩展名。页面里也有 www.mcmod.cn 的静态图（logo 等），
  // 那些不是用户上传的内容。
  const re = /https?:\/\/i\.mcmod\.cn\/[^"'\s\\)]+\.(?:png|jpe?g|webp)/gi;
  for (const m of html.matchAll(re)) {
    const link = normalizeSkinLink(m[0]);
    if (link.url !== null) out.add(link.url);
  }
  return [...out];
}
