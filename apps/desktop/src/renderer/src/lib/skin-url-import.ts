/**
 * 「按链接导入皮肤」的共用逻辑（SkinTab 与 DownloadTab 各有一个入口）。
 *
 * ## 为什么抽出来
 *
 * 两个入口（皮肤库 tab 的「URL」按钮、下载页皮肤分类的直链导入）过去
 * 各写一遍，而这里有个坑：**链接必须先规范化**。
 *
 * 用户手头的链接多数不是「一张 64×64 PNG」，最常见的是 MC百科 的链接，
 * 两个坑叠在一起：
 * 1. 站上图**全是 WebP**（实测 content-type: image/webp），
 *    皮肤库校验看 PNG magic → 直接报「不是有效的皮肤 PNG」。
 * 2. 从页面复制到的常带 `@宽x高` 缩放后缀，那是缩略图不是原图。
 *
 * 只 A 不 B 会得到「明明是 PNG 还说不是」，只 B 不 A 会得到
 * 「转出来了但尺寸不对」。两处都要，所以放一份实现，别让两个入口各漏一半。
 */
/**
 * ⚠️ 从 `@mc-creator/core/skin/link` 导入，**不要**改成 barrel 或 `/skin`。
 *
 * 这个子路径入口是渲染进程专用（在 core 的 package.json 的 exports 里单独开）：
 * - 从 barrel（`@mc-creator/core`）导入会把 `builder/build-fixer.ts` 拖进浏览器包，
 *   而它 `import { resolve, relative } from 'node:path'` → Vite 报
 *   `"relative" is not exported by __vite-browser-external`。
 * - `@mc-creator/core/skin` 也不行：`mojang.ts` 用了 `Buffer`，渲染进程同样没有。
 *
 * `link.ts` 本身是纯函数（只用 `URL` 与正则），浏览器零依赖。
 * 以后想从渲染层拿 core 的什么，先确认那个模块不碰 `node:*` / `Buffer`。
 */
import { normalizeSkinLink, type SkinLink } from '@mc-creator/core/skin/link';
import { loadSkinPngAsBase64, SkinConvertError } from './skin-image-loader.js';

/** 一个入口需要的行为，抽成参数免得这份逻辑依赖某个组件。 */
export interface UrlImportDeps {
  /** 发 IPC（为了可测，由调用方给）。 */
  addByUrl: (req: {
    url: string;
    name?: string;
    /** 渲染层转好的 PNG（base64），主进程直接用，不再联网。 */
    pngBase64: string;
  }) => Promise<{
    entry?: { id: string; name: string } | null | undefined;
    error?: string | null | undefined;
  }>;
}

/** 把规范化后的链接说成人话，供 UI 提示。 */
export function describeSkinLink(link: SkinLink): string | null {
  switch (link.kind) {
    case 'mcmod-page':
      return '这是 MC百科 的**页面**链接，不是图片。请右键那张皮肤图 →「复制图片地址」，再把图片链接贴进来。';
    case 'invalid':
      return '不是有效的图片链接（应为 http/https 开头的地址）。';
    case 'mcmod-image':
    case 'direct':
    default:
      return null;
  }
}

/**
 * 按链接导入一张皮肤。
 *
 * 顺序是刻意的：先规范化（挡掉页面链接与缩放后缀），再在渲染层转 PNG
 * （挡掉 WebP），最后才落库。任何一步失败都返回一句面向用户的中文错误，
 * 不往上抛 —— 调用方只要显示它。
 */
export async function importSkinFromUrl(
  rawUrl: string,
  deps: UrlImportDeps,
): Promise<{ ok: boolean; error?: string; entryId?: string | undefined }> {
  const link = normalizeSkinLink(rawUrl);
  const hint = describeSkinLink(link);
  if (hint !== null || link.url === null) {
    return { ok: false, error: hint ?? '链接无法处理' };
  }

  let pngBase64: string;
  try {
    // Chromium 原生解 WebP/JPEG/GIF/PNG；顺带把超大图缩进皮肤上限
    pngBase64 = await loadSkinPngAsBase64(link.url);
  } catch (e) {
    return {
      ok: false,
      error: e instanceof SkinConvertError ? e.message : `处理图片失败: ${(e as Error).message}`,
    };
  }

  try {
    const res = await deps.addByUrl({ url: link.url, pngBase64 });
    if (res.error) return { ok: false, error: res.error };
    return { ok: true, entryId: res.entry?.id };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export { normalizeSkinLink };
