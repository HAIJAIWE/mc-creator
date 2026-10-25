/**
 * 皮肤库 —— 本地 PNG 的存储、导入、应用。
 *
 * ## 目录布局（按 **LauncherService 的两层规则**）
 *
 * ```
 * userData/mc-launcher/
 * └── skins/
 *     ├── library/            ← **全局皮肤库**（不属于任何实例，可复用）
 *     │   ├── <skinId>.png
 *     │   └── ...
 *     └── library.json        ← 库索引
 *
 * userData/mc-launcher/game/<实例名>/          ← **实例作用域**
 *     └── CustomSkinLoader/LocalSkin/skins/<用户名>.png
 * ```
 *
 * | 层 | 位置 | 为什么 |
 * |---|---|---|
 * | 库 | `skins/library/`（全局） | 同一张皮肤要能应用到多个实例/多个玩家名 |
 * | 应用 | `game/<实例>/CustomSkinLoader/...` | CustomSkinLoader 按**实例**的 gameDir 读 |
 *
 * 与 mods 的分层完全同构（版本产物共享 / 游戏数据按实例隔离）。
 *
 * ## 「应用」到底做了什么
 *
 * 把库里的 PNG **复制**到该实例的 `CustomSkinLoader/LocalSkin/skins/<用户名>.png`。
 * CustomSkinLoader（已装的 mod）会读它并显示给那个玩家名 ——
 * 这是 HMCL / PCL 一样的做法，**不需要动启动参数**。
 *
 * ⚠️ Loadlist 顺序：实测确认 CSL 的 `loadlist` 里 **LocalSkin 必须在最前**，
 * 否则皮肤站的皮肤会盖掉本地皮肤。所以应用/取消应用时都要保证这一点
 * （见 `ensureLocalSkinFirst`）。
 *
 * ## 不做的事
 *
 * - **不改玩家模型（classic/slim）的游戏内开关**：那是 Minecraft 自己的设置，
 *   由皮肤文件本身决定，启动器只能在导入时记录一个「这是哪种」的标签供 UI 显示。
 * - **不上传到任何站点**：上传是 Mojang API 的事，且需要正版 token，另有一条链路。
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
  copyFileSync,
  readdirSync,
  statSync,
} from 'node:fs';
import { join, dirname } from 'node:path';

import {
  parseSkinPng,
  localSkinFileName,
  isLegacySkinSize,
  DEFAULT_SKIN_MODEL,
  type SkinModel,
  type SkinSource,
} from '@mc-creator/core';

/** 库索引里的一条。 */
export interface SkinEntry {
  /** 主键（同时也是 `library/<id>.png` 的文件名去扩展名）。 */
  id: string;
  /** 显示名。 */
  name: string;
  /** classic（Steve 4px 手臂）/ slim（Alex 3px 手臂）。PNG 判不出来，导入时记录。
   *  **legacy（`height === 32`）恒为 `classic`** —— 那个格式里 slim 不存在。 */
  model: SkinModel;
  /** 来源：本地文件 / Mojang 正版 / MineSkin 公共库。 */
  source: SkinSource;
  /** 像素宽。 */
  width: number;
  /** 像素高。 */
  height: number;
  /** 字节数。 */
  sizeBytes: number;
  /** 入库时间（epoch ms）。 */
  createdAt: number;
  /** 来源补充信息（如 MineSkin 的数字 id / 正版用户名）。 */
  origin: string | null;
}

export interface SkinLibraryFile {
  version: number;
  entries: SkinEntry[];
}

const REGISTRY_VERSION = 1;

/** PNG 大小写都认（本地文件导入时用户给的什么就是什么）。 */
const PNG_EXTS = ['.png'];

/**
 * 生成一个短 id。
 *
 * 不用 UUID —— 它会进文件名，而 36 字符在 Windows 资源管理器里很难看。
 * 时间戳 + 随机数足够：库是单机的，没有并发合并问题。
 */
function newSkinId(): string {
  return `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

export class SkinLibrary {
  constructor(private readonly baseDir: string) {
    // baseDir 是 `.../mc-launcher/skins`
    mkdirSync(this.baseDir, { recursive: true });
  }

  /** 库索引文件路径。 */
  private get indexFile(): string {
    return join(this.baseDir, 'library.json');
  }

  /** PNG 存放目录。 */
  private get blobDir(): string {
    return join(this.baseDir, 'library');
  }

  /**
   * 读索引。损坏时**当空库**而不是抛 —— 一张坏索引不该让整个皮肤功能不可用
   * （PNG 都还在，只是元数据丢了）。调用方可以选择提示用户重建。
   */
  private read(): SkinLibraryFile {
    try {
      const json = JSON.parse(readFileSync(this.indexFile, 'utf-8')) as SkinLibraryFile;
      if (!Array.isArray(json.entries)) return { version: REGISTRY_VERSION, entries: [] };
      return json;
    } catch {
      return { version: REGISTRY_VERSION, entries: [] };
    }
  }

  private write(data: SkinLibraryFile): void {
    mkdirSync(dirname(this.indexFile), { recursive: true });
    writeFileSync(this.indexFile, JSON.stringify(data, null, 2), 'utf-8');
  }

  /** `library/<id>.png` 的绝对路径。 */
  pngPath(id: string): string {
    // id 由本类生成（s<base36><random>），不含路径字符；仍校验一次，防旧数据
    if (id === '' || id.includes('/') || id.includes('\\') || id.includes('..')) {
      throw new Error(`非法的皮肤 id: ${id}`);
    }
    return join(this.blobDir, `${id}.png`);
  }

  list(): SkinEntry[] {
    return this.read().entries;
  }

  get(id: string): SkinEntry | null {
    return this.read().entries.find((e) => e.id === id) ?? null;
  }

  /**
   * 导入一张 PNG。
   *
   * @param png    PNG 字节（调用方负责读盘/下载，这里只管校验与落库）
   * @param name   显示名；空则用来源名或「未命名皮肤」
   * @param model  模型。**PNG 判不出来**，默认 classic；legacy（64×32）恒为 classic
   * @param source 来源
   * @param origin 来源补充信息
   *
   * @throws 校验失败（不是 PNG / 尺寸不对）时抛**可读的中文原因** ——
   *   这类错误必须让用户知道「哪张图、为什么不行」。
   */
  add(input: {
    png: Buffer;
    /** 显示名。缺省/空串 → 用来源名兜底。 */
    name?: string | undefined;
    model?: SkinModel | undefined;
    source: SkinSource;
    origin?: string | null;
  }): SkinEntry {
    const info = parseSkinPng(input.png);
    if (!info.ok) throw new Error(info.error ?? '不是有效的皮肤 PNG');

    const id = newSkinId();
    const dest = this.pngPath(id);
    // 建**父目录**，不是 dest 本身 —— 把 `<id>.png` 建成目录的话
    // writeFileSync 会 EISDIR，而这条错误看不出跟「建错层级」有关。
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, input.png);

    const entry: SkinEntry = {
      id,
      name: input.name?.trim() || `${input.source} 皮肤`,
      // legacy（64×32）只有 Steve 模型，slim 不存在 → 一律锁 classic。
      // UI 那边也会禁用 slim 选项；这层是兜底（官方/MineSkin/URL 导入都会经过这里）。
      model: isLegacySkinSize(info.width, info.height)
        ? 'classic'
        : (input.model ?? DEFAULT_SKIN_MODEL),
      source: input.source,
      width: info.width,
      height: info.height,
      sizeBytes: input.png.length,
      createdAt: Date.now(),
      origin: input.origin ?? null,
    };
    const data = this.read();
    data.entries.unshift(entry); // 新的在前
    this.write(data);
    return entry;
  }

  /** 改显示名 / 模型。**不动 PNG**（改名不该重新下载）。 */
  update(id: string, patch: { name?: string; model?: SkinModel }): SkinEntry | null {
    const data = this.read();
    const idx = data.entries.findIndex((e) => e.id === id);
    const cur = data.entries[idx];
    if (idx === -1 || !cur) return null;
    if (patch.name !== undefined && patch.name.trim() !== '') cur.name = patch.name.trim();
    // legacy（64×32）没有 slim 这一说：改也只会落成 classic。
    // 返回值就是改完的条目，UI 刷新后会显示 classic —— 所以这不是「静默改」，是格式约束。
    if (patch.model !== undefined) {
      cur.model = isLegacySkinSize(cur.width, cur.height) ? 'classic' : patch.model;
    }
    this.write(data);
    return cur;
  }

  /**
   * 从库删除。**不删已应用出去的副本** —— 那些在实例的 gameDir 里，
   * 属于实例数据，删库不该连带删掉用户正在用的皮肤。
   */
  remove(id: string): boolean {
    const data = this.read();
    const before = data.entries.length;
    data.entries = data.entries.filter((e) => e.id !== id);
    if (data.entries.length === before) return false;
    this.write(data);
    rmSync(this.pngPath(id), { force: true });
    return true;
  }

  /** 库里是否已有同名同大小的（用于导入前去重提示，不做强制）。 */
  hasSameAs(png: Buffer, name: string): SkinEntry | null {
    return this.read().entries.find((e) => e.name === name && e.sizeBytes === png.length) ?? null;
  }

  /** 受支持的扩展名（UI 的文件选择器用）。 */
  static supportedExtensions(): readonly string[] {
    return PNG_EXTS;
  }

  /** PNG 是否存在（库损坏自愈：索引在、文件没了）。 */
  pngExists(id: string): boolean {
    try {
      return existsSync(this.pngPath(id));
    } catch {
      return false;
    }
  }
}

/**
 * 把库里的皮肤应用到某个实例的某个玩家名。
 *
 * 放在这里而不是 LauncherService：这一步跨了两个东西（皮肤库 + 游戏目录），
 * 而它自己就是完整的一步（复制 + 保证 loadlist 顺序）。
 *
 * @param instanceGameDir 实例的游戏目录（**不是**整个 baseDir）
 * @param playerName      要应用给的玩家名
 */
export function applySkinToInstance(args: {
  library: SkinLibrary;
  instanceGameDir: string;
  skinId: string;
  playerName: string;
}): { path: string } {
  const fileName = localSkinFileName(args.playerName);
  if (fileName === null) {
    throw new Error(`玩家名不合法，无法作为皮肤文件名: ${args.playerName}`);
  }
  const entry = args.library.get(args.skinId);
  if (!entry) throw new Error(`皮肤不在库里: ${args.skinId}`);
  if (!args.library.pngExists(args.skinId)) {
    throw new Error(`皮肤文件缺失（索引在，PNG 不在）: ${args.skinId}`);
  }

  // CustomSkinLoader 的 LocalSkin 目录（实测确认的路径）
  const destDir = join(args.instanceGameDir, 'CustomSkinLoader', 'LocalSkin', 'skins');
  mkdirSync(destDir, { recursive: true });
  const dest = join(destDir, fileName);
  // 用 copy 而不是 move：库里的原件要留着给别的实例/玩家名用
  copyFileSync(args.library.pngPath(args.skinId), dest);

  // loadlist 里 LocalSkin 必须最前，否则皮肤站的皮肤会盖掉它
  ensureLocalSkinFirst(args.instanceGameDir);

  return { path: dest };
}

/**
 * 取消应用：删掉该玩家名的 LocalSkin 文件。
 *
 * 玩家名非法时**不抛** —— 取消应用本该是幂等的（没有就是没有）。
 */
export function unapplySkinFromInstance(args: {
  instanceGameDir: string;
  playerName: string;
}): void {
  const fileName = localSkinFileName(args.playerName);
  if (fileName === null) return;
  const dest = join(args.instanceGameDir, 'CustomSkinLoader', 'LocalSkin', 'skins', fileName);
  rmSync(dest, { force: true });
}

/**
 * 列出实例上「已应用」的皮肤（LocalSkin/skins/*.png → 玩家名）。
 *
 * 只列文件、不做反向匹配 —— 玩家名 ↔ 库条目是多对多
 * （同一张皮肤可以应用给多个名字），本地文件才是事实来源。
 */
export function listAppliedSkins(
  instanceGameDir: string,
): Array<{ playerName: string; path: string; sizeBytes: number }> {
  const dir = join(instanceGameDir, 'CustomSkinLoader', 'LocalSkin', 'skins');
  const out: Array<{ playerName: string; path: string; sizeBytes: number }> = [];
  if (!existsSync(dir)) return out;
  for (const name of readdirSafe(dir)) {
    if (!name.toLowerCase().endsWith('.png')) continue;
    const p = join(dir, name);
    try {
      out.push({
        playerName: name.slice(0, -'.png'.length),
        path: p,
        sizeBytes: statSyncSafe(p),
      });
    } catch {
      /* 文件在读列表时被删了：跳过 */
    }
  }
  return out;
}

function readdirSafe(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

function statSyncSafe(p: string): number {
  try {
    return statSync(p).size;
  } catch {
    return 0;
  }
}

/**
 * 保证 CustomSkinLoader 的 `loadlist` 里 LocalSkin 在最前。
 *
 * 实测依据：CustomSkinLoader 的 loadlist 按顺序加载，本地皮肤要盖过
 * 皮肤站必须排第一（其 wiki 与多个 mod 分发的说明一致）。
 *
 * 只在**已有配置文件**时改 —— 没有配置文件说明用户还没启用 CSL，
 * 那不该由应用皮肤这个动作顺手替他启用（那是 `installSkinSupport` 的职责，
 * 且要过合规闸门）。
 */
export function ensureLocalSkinFirst(instanceGameDir: string): void {
  const cfgPath = join(instanceGameDir, 'config', 'CustomSkinLoader', 'CustomSkinLoader.json');
  if (!existsSync(cfgPath)) return;

  // 只在配置**存在且可解析**时改。没有配置文件说明用户还没启用 CSL ——
  // 那不该由「应用皮肤」这个动作顺手替他启用（启用要走合规闸门）。
  let cfg: { loadlist?: Array<{ name?: string; type?: string; root?: string }> };
  try {
    cfg = JSON.parse(readFileSync(cfgPath, 'utf-8'));
  } catch {
    return; // 配置坏的：不动它，让上层（安装流程）去重建
  }
  const list = Array.isArray(cfg.loadlist) ? cfg.loadlist : [];
  if (list.some((e) => e?.name === 'LocalSkin')) return;

  cfg.loadlist = [{ name: 'LocalSkin', type: 'Legacy', root: 'LocalSkin/' }, ...list];
  writeFileSync(cfgPath, JSON.stringify(cfg, null, 2), 'utf-8');
}
