/**
 * 把任意图片 URL 拉下来转成 **PNG**（base64）。
 *
 * ## 为什么非要有这一步
 *
 * 用户手头的皮肤链接多数不是 PNG。实测 MC百科（mcmod.cn）图床
 * `access-control-allow-origin: *` 能直接 fetch，但**它站上图全是 WebP**
 * （`content-type: image/webp`）—— 而皮肤库只认 PNG（校验看 magic），
 * 于是每一条 MC百科 链接都会报「不是有效的皮肤 PNG」。用户看到的是
 * 「链接是好的啊为什么不认」。
 *
 * ## 为什么在渲染层转，不装 sharp
 *
 * sharp 是原生依赖（平台二进制 ~10MB+），为一个 WebP 转换引进来不划算。
 * 而 Chromium 的 `createImageBitmap` **原生支持 WebP**，渲染进程里本来就有。
 * 代价是一次渲染→主进程的字节回传，换来零新依赖。
 *
 * ## 为什么顺手降采样
 *
 * Java 皮肤只有两种合法尺寸：**64×64**（现代）与 **64×32**（legacy 旧格式）；
 * 校验在 `packages/core/src/skin/png.ts`（唯一来源）。而皮肤站上常见的是它们的
 * **整数倍放大版**（128×128 / 256×256 的所谓 HD 皮肤）。直接下发一张 4096×4096
 * 的图会让校验报「尺寸不对」，而那个错误完全不指向真正的原因（图太大）。这里在
 * 超过上限时先缩回 64 宽，让校验失败只发生在**内容**不对时。
 *
 * ⚠️ 不用 `Buffer`：渲染进程不一定开 nodeIntegration。这里全程用浏览器 API，
 * 最后拿 `canvas.toDataURL()` 的 base64（主进程再自己转回 Buffer）。
 */

/** 皮肤贴图的合法宽（缩放后的目标宽）。 */
const SKIN_W = 64;

/**
 * 缩放的**天花板**（128），不是合法高度 —— 合法高度只有 64 与 32。
 *
 * 留在 128 而不是 64 是有意的：比例 >1 的畸形图（如 256×384）缩完高度会 >64，
 * 于是**仍然是非法高度、被校验挡住**；若天花板改成 64，它会被缩成 64×64 反而蒙混过关。
 */
const SKIN_MAX_H = 128;

/** 单张图上限。超过就当链接指向了别的东西，别把几十 MB 拖进 IPC。 */
const MAX_BYTES = 16 * 1024 * 1024;

const PNG_DATA_URL_PREFIX = 'data:image/png;base64,';

export class SkinConvertError extends Error {}

/**
 * fetch 图片 → PNG 的 base64（**不带** data URL 前缀）。
 *
 * 失败一律抛 `SkinConvertError`，消息面向用户：这条链上每个环节（网络、
 * 格式、尺寸）出错都要说清是哪一环，不能只说「导入失败」。
 */
export async function loadSkinPngAsBase64(url: string): Promise<string> {
  let res: Response;
  try {
    res = await fetch(url);
  } catch {
    throw new SkinConvertError(`拉不到这张图片（网络或链接无效）：${url}`);
  }
  if (!res.ok) {
    throw new SkinConvertError(`拉取图片失败: HTTP ${res.status}`);
  }

  const blob = await res.blob();
  if (blob.size > MAX_BYTES) {
    throw new SkinConvertError(
      `图片太大（${(blob.size / 1024 / 1024).toFixed(1)} MB），不像一张皮肤贴图`,
    );
  }

  // Chromium 原生解 WebP / JPEG / GIF / AVIF / PNG
  let bmp: ImageBitmap;
  try {
    bmp = await createImageBitmap(blob);
  } catch {
    throw new SkinConvertError('当前浏览器解不了这张图片（格式不受支持或文件损坏）');
  }

  try {
    // 只把超过上限的一边缩进上限；本来就在 64×64 / 64×32 里的原样输出。
    // imageSmoothingEnabled=false 保证不做插值 —— 皮肤必须保留硬像素边。
    const tooBig = bmp.width > SKIN_W || bmp.height > SKIN_MAX_H;
    const w = tooBig ? SKIN_W : bmp.width;
    const h = tooBig
      ? Math.min(SKIN_MAX_H, Math.max(1, Math.round((bmp.height / bmp.width) * SKIN_W)))
      : bmp.height;

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (ctx === null) throw new SkinConvertError('当前环境没有 canvas，无法转换图片');
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(bmp, 0, 0, w, h);

    const dataUrl = canvas.toDataURL('image/png');
    if (!dataUrl.startsWith(PNG_DATA_URL_PREFIX)) {
      throw new SkinConvertError('转成 PNG 失败');
    }
    return dataUrl.slice(PNG_DATA_URL_PREFIX.length);
  } finally {
    bmp.close();
  }
}
