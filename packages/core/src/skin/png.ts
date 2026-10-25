/**
 * 玩家皮肤 PNG 的**格式校验与模型判定**。
 *
 * ## 这里只放纯逻辑
 *
 * 读文件、写文件、调网络都在 `main/skin-library.ts`。这里保持纯函数，
 * 这样「什么样的 PNG 算一张有效皮肤」能被单测直接钉住 —— 那是这个功能
 * 最容易出错、且错了最难解释的一层（用户拖一张 32×64 的图进来，
 * 报「文件已损坏」比报「尺寸不对」难查十倍）。
 *
 * ## ⚠️ 经典 / slim 无法从 PNG 判定
 *
 * `classic`（Steve，4px 手臂）与 `slim`（Alex，3px 手臂）的 PNG **尺寸完全
 * 一样**，区别只在手臂那一块的贴图布局。所以：
 *
 * - 本模块**不猜**模型，`model` 永远是调用方给的
 * - 导入时默认 `classic`（Minecraft 默认皮肤），用户可改
 * - 这是 PCL / HMCL 一样的行为
 *
 * ## 两个尺寸：64×64（现代）与 64×32（legacy）
 *
 * Java 版只认这两种；**128×128 是 Bedrock 的**，64×128 哪里都不合法。
 * legacy（64×32）还有两条硬约束，调用方必须一起遵守：
 * - **只有 Steve 模型**（legacy 的 slim 不存在）→ `isLegacySkinSize` 判出来就得锁 `classic`
 * - 没有躯干/手臂/腿的第二层，**左臂左腿由游戏镜像右肢**
 */

/** PNG 文件头（8 字节）。 */
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** 皮肤宽度。Java 版恒为 64（Bedrock 的 128×128 不走这条链路）。 */
export const SKIN_WIDTH = 64;

/**
 * 合法高度，两个都对应 Java 版能读的格式：
 * - `64` 现代格式：有第二层（帽子 / 外套 / 袖 / 裤）
 * - `32` legacy 旧格式（1.7 及更早）：只有 Steve 模型、没有第二层、左肢由游戏镜像
 *
 * ⚠️ 这里是 `[64, 128]` 的时候错了**两个方向**：收了 64×128（哪里都不合法 ——
 * 128 是 Bedrock 的 128×**128**），又把 Java 至今支持的 64×32 拒了。
 * 三条独立出处一致，别再按记忆改：
 * - Java 官方启动器上传报错原文：`Skin images must be 64x64 or 64x32 pixel PNG files`
 * - Minecraft Wiki「Skin」：Java 上传「64×64，或 legacy 64×32」；128×128 明确属 Bedrock
 * - PCL `Modules/Minecraft/ModMinecraft.vb#McSkinSelect` 对着正版接口的预检：
 *   「皮肤图片大小应为 64x32 像素或 64x64 像素！」
 */
export const SKIN_HEIGHTS = [64, 32] as const;

/** legacy 旧格式的高度（64×32）。`SKIN_HEIGHTS` 里那个 32 的名字。 */
export const LEGACY_SKIN_HEIGHT = 32;

/** 是不是 legacy 尺寸（64×32）—— legacy 只能配 Steve 模型、没有第二层。 */
export function isLegacySkinSize(width: number, height: number): boolean {
  return width === SKIN_WIDTH && height === LEGACY_SKIN_HEIGHT;
}

/** 皮肤模型。classic = Steve（4px 手臂），slim = Alex（3px 手臂）。 */
export type SkinModel = 'classic' | 'slim';

/**
 * 皮肤来源。影响 UI 上的标签，不影响存储格式。
 *
 * **如实标注，不合并** —— 用户在库里看到「这张图哪来的」比看到归了类更重要。
 *
 * - `file`：本地 PNG 文件
 * - `url`：粘贴的直链（Mojang texture 或皮肤站直链），来源不可考
 * - `mineskin`：MineSkin 公共库，有 id 可回溯
 *
 * 没有 `mojang`：账号导入与手贴直链走同一个 URL 通道，在磁盘上无从区分，
 * 硬分一个 `mojang` 反而在说谎。
 *
 * 写成 `as const` 数组而不是裸联合：IPC schema（`z.enum`）要从**同一处**
 * 取值，写两遍必然漂移 —— 上一轮就漂了（handler 标 `mineskin`、
 * UI 显示 `mojang`），编译不报错、单测也不报错，只有用户看得见。
 */
export const SKIN_SOURCES = ['file', 'url', 'mineskin'] as const;

export type SkinSource = (typeof SKIN_SOURCES)[number];

export interface SkinPngInfo {
  ok: boolean;
  /** 像素宽；解析失败为 0。 */
  width: number;
  /** 像素高；解析失败为 0。 */
  height: number;
  /** 失败原因。**必须是可以直接展示给用户的中文**，不能是底层异常。 */
  error: string | null;
}

/**
 * 校验一段字节是不是一张可用的玩家皮肤 PNG。
 *
 * 三道检查，顺序刻意如此：
 * 1. **PNG 魔数** —— 挡 jpeg/webp/重命名文件。这一步花了最少成本挡住最多错误。
 * 2. **IHDR 存在** —— 挡被截断的 PNG（只读了文件头）。
 * 3. **宽高** —— 挡 32×32 图标、512×512 大图。
 *
 * 第 3 步最后做：前两步不过时读宽高没有意义。
 */
export function parseSkinPng(buf: Buffer): SkinPngInfo {
  if (buf.length < PNG_MAGIC.length) {
    return { ok: false, width: 0, height: 0, error: '文件太小，不是一张有效的 PNG' };
  }
  if (!buf.subarray(0, PNG_MAGIC.length).equals(PNG_MAGIC)) {
    return { ok: false, width: 0, height: 0, error: '不是 PNG 文件（文件头不匹配）' };
  }
  // PNG: 8 字节签名 + IHDR(chunk)。IHDR 的数据段在 16..24，宽 4 + 高 4
  if (buf.length < 24) {
    return { ok: false, width: 0, height: 0, error: 'PNG 文件被截断了（读不到尺寸信息）' };
  }
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);

  const fail = (msg: string): SkinPngInfo => ({ ok: false, width, height, error: msg });

  if (width !== SKIN_WIDTH) {
    return fail(`皮肤宽度必须是 ${SKIN_WIDTH} 像素，当前是 ${width}`);
  }
  if (!SKIN_HEIGHTS.includes(height as (typeof SKIN_HEIGHTS)[number])) {
    return fail(
      `皮肤高度必须是 ${SKIN_HEIGHTS.join(' 或 ')} 像素，当前是 ${height}` +
        `（Java 版只认 64×64 和 64×32；128×128 是 Bedrock 的）`,
    );
  }
  return { ok: true, width, height, error: null };
}

/**
 * 玩家名 → CustomSkinLoader 的 LocalSkin 文件名。
 *
 * 玩家名直接进路径，所以要挡 `..` / `/` / `\`。
 * Minecraft 的合法玩家名是 `[A-Za-z0-9_]{3,16}`，比放得更宽会让
 * 一些离线模式自造的奇怪名字过不来（离线启动器经常这么干），
 * 所以这里**只挡危险字符、不强制 Minecraft 规则**。
 */
export function localSkinFileName(playerName: string): string | null {
  const name = playerName.trim();
  if (name === '') return null;
  if (name === '.' || name === '..') return null;
  if (/[/\\]/.test(name)) return null;
  if (name.includes('..')) return null;
  return `${name}.png`;
}
