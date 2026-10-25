/**
 * 离线玩家的皮肤：**用资源包覆盖默认皮肤贴图**（不用装任何 mod）。
 *
 * ## 为什么需要这条路
 *
 * 现在的「应用皮肤」只有一条路：把 PNG 复制到
 * `CustomSkinLoader/LocalSkin/skins/<玩家名>.png`。CSL 是 **mod** ——
 * 实例没装它，皮肤就完全不生效。而本启动器的账号是离线模式（第三方认证闸门
 * fail-closed，见 §1.2/§19），原版一进游戏就是「默认皮肤」，玩家看到的是
 * Steve/Alex，用户点了「应用」却什么都没变。
 *
 * 原版默认皮肤的贴图就在 client.jar 里，**可以被资源包覆盖**（Minecraft Wiki
 * 「Skin」条原文：*"The default skin files in client.jar can also be changed and
 * replaced via a resource pack, but the effects are visible only to players
 * using the resource pack, and affects all players with the default skin."*）。
 * PCL2 也是这么干的（`Modules/Minecraft/ModLaunch.vb`：生成 `resourcepacks/
 * PCL2 Skin.zip` 再把它写进 `options.txt` 的 `resourcePacks`）。
 *
 * 代价要写清楚：**它对所有用默认皮肤的玩家都生效**（联机时别人也看见你的皮肤），
 * 因为它替换的是「默认皮肤」而不是「某个玩家的皮肤」。这正是官方描述的行为。
 *
 * ## 贴图路径：拿三个真 client.jar 逐个列出来的，不是照记忆写的
 *
 * | 版本 | jar 里的默认皮肤贴图 | 覆盖成几份 |
 * |---|---|---|
 * | `1.6.1` – `1.7.10` | （皮肤是 64×32 的旧格式） | 2 |
 * | `1.8` – `1.19.2` | `assets/minecraft/textures/entity/{alex,steve}.png` | 2 |
 * | `1.19.3`+ | `assets/minecraft/textures/entity/player/{wide,slim}/{alex,ari,efe,kai,makena,noor,steve,sunny,zuri}.png` | 18 |
 *
 * 实测方法：拉 `piston-meta.mojang.com` 的版本清单 → 取 `downloads.client.url`
 * → 下载 jar → 解中央目录列 `assets/minecraft/textures/entity/**`。
 * 1.20.4 那格是 18 个文件一个不多一个不少；1.19.2 与 1.12.2 只有
 * `entity/steve.png` + `entity/alex.png`（没有 `entity/player/` 目录）。
 * 切换点与官方 22w45a（1.19.3）「Integrated player skin now stored separately
 * by wide and slim model」一致。
 *
 * ⚠️ 为什么 1.19.3+ 要覆盖 **wide 和 slim 两个目录的 9 个名字**：那个版本的
 * 离线默认皮肤是按 UUID 哈希从这 18 个里挑一个（`floorMod(hash, 18)`），挑中
 * 谁就用谁的贴图。只覆盖 wide 的话，哈希挑到 slim 的玩家仍显示原版皮肤。
 * PCL 同样覆盖全部 18 个（它随包带 `Images/Skins/{wide,slim}-*.png` 共 18 张）。
 *
 * 副作用：哈希挑到 **slim** 默认皮肤的玩家，会用 slim 模型渲染你的贴图
 * （手臂 3px 而贴图是 4px）。这是这条路固有的，无法按玩家指定。
 *
 * ## 版本边界
 *
 * - **< 1.6.1**：没有资源包（资源包 1.6 才取代材质包）→ 不支持。
 * - **1.6.1 – 1.7.10**：皮肤只有 64×32 一种尺寸，我们的 64×64 PNG 得裁掉
 *   下半才能用 —— 仓库里没有 PNG 编码器（`core/skin/png.ts` 只解尺寸不像素），
 *   所以这条路**只接受 64×32 的皮肤**，64×64 明确拒绝并说明原因。
 * - **1.8+**：反过来 —— 默认皮肤贴图按 64×64 布局取，64×32 的旧格式皮肤
 *   左臂左腿的 UV 落在图外（采样会被 clamp 到边缘，画出来是花的），也拒绝。
 *   两种拒绝都说清「改用 CSL 那条路」（CSL 按玩家名发皮肤，旧格式由游戏自己镜像）。
 *
 * ## 放哪：主进程
 *
 * 这一步要写 `<gameDir>/resourcepacks/*.zip` 和 `options.txt`，都是文件系统
 * 动作；`planOfflineSkinPack` / `addResourcePackToOptions` 两个函数保持纯，
 * 让「哪种版本写哪些路径」「properties 怎么改」能脱离磁盘直接断言。
 */

import JSZip from 'jszip';

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { resourcePackFormatForAnyMcVersion, usesMinMaxFormat } from '@mc-creator/shared';

/** 资源包文件名。用 ASCII：它要进 `options.txt`，Java Properties 会把非 ASCII 转义成 \uXXXX（能读，但难排查）。 */
export const OFFLINE_PACK_FILE_NAME = 'MC Creator Skin.zip';

/** `options.txt` 里引用资源包的前缀（`file/<文件名>`）。 */
const OPTIONS_PACK_PREFIX = 'file/';

/** 1.19.3+ 默认皮肤的文件名（9 个），来自真 jar 的实际清单。 */
export const DEFAULT_SKIN_NAMES = [
  'alex',
  'ari',
  'efe',
  'kai',
  'makena',
  'noor',
  'steve',
  'sunny',
  'zuri',
] as const;

/** 1.19.3+ 的两个模型目录名。 */
const PLAYER_SKIN_MODELS = ['wide', 'slim'] as const;

/** 1.19.3 之前默认皮肤贴图的前缀（`entity/steve.png` / `entity/alex.png`）。 */
const ENTITY_TEXTURE_PREFIX = 'assets/minecraft/textures/entity/';

/** 1.19.3 之前在 `entity/` 下的两个文件名。 */
const PRE_1193_SKIN_NAMES = ['steve', 'alex'] as const;

/** 把一个条目加到 options.txt 时是否要先有 `"vanilla"`（1.13 起游戏要求列表含它）。 */
const VANILLA_REQUIRED_SINCE = [1, 13, 0] as const;

/**
 * options.txt 里 `resourcePacks` 那一行。
 *
 * ## 分隔符是**冒号**，不是等号（拿真实 options.txt 数出来的）
 *
 * options.txt 是 `key:value` 格式。实例里那份 FO（26.3）的 options.txt 一共
 * 210 行，**210 行全是冒号、零行等号**（`resourcePacks:[]`、`fov:0.0`…）。
 *
 * 早先这里只认 `=`，后果是实测出来的，不是推的：
 * 1. 找不到游戏自己写的那行 → 在文件末尾**追加**一行 `resourcePacks=[…]`；
 * 2. 游戏读到直接丢掉：`Skipping bad option: resourcePacks=["vanilla","file/…"]`
 *    （26.3 实测日志），`Reloading ResourceManager` 里没有我们的包 → 皮肤不生效。
 *
 * 所以：**两种分隔符都认**（旧版本可能已经往用户文件里追加过等号行，得能找出来
 * 清掉），**新写的一行一律用冒号**（游戏原生写法）。
 *
 * 捕获组：分隔符 / 列表文本 / **行尾的 `\r`（可能没有）**。最后一组为了行尾
 * 原样写回 —— Java 在 Windows 上写 CRLF，别把用户的文件搞成混合行尾。
 */
const RESOURCE_PACKS_LINE = /^resourcePacks([:=])(.*?)(\r?)$/;

/** 解析后的 MC 版本。三段补零，如 `1.8` → [1,8,0]、`26.2` → [26,2,0]。 */
type McVersion = readonly [number, number, number];

/** 解析失败 / 计划不可行。原因是**可以直接展示给用户的中文**。 */
export interface OfflineSkinPlanFailure {
  ok: false;
  reason: string;
}

/** 计划：写哪些文件 + `options.txt` 里那一行怎么改。 */
export interface OfflineSkinPlan {
  ok: true;
  /** 覆盖的贴图路径（相对 zip 根）。 */
  entries: Array<{ path: string; bytes: Uint8Array }>;
  /** `pack.mcmeta` 的文本内容。 */
  packMcmeta: string;
  /** `resourcePacks` 列表里的一项，如 `file/MC Creator Skin.zip`。 */
  optionsEntry: string;
}

function parseMcVersion(version: string): McVersion | null {
  const m = /^(\d+)\.(\d+)(?:\.(\d+))?$/.exec(version.trim());
  if (m === null) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3] ?? 0)];
}

function cmp(a: McVersion, b: McVersion): number {
  for (let i = 0; i < 3; i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/** 玩家皮肤贴图的目标路径（1.19.3+）。 */
export function playerDefaultSkinPath(model: string, name: string): string {
  return `${ENTITY_TEXTURE_PREFIX}player/${model}/${name}.png`;
}

/**
 * 算这份皮肤要写进资源包的哪些路径。
 *
 * 纯函数 —— 这里只做「哪种版本 → 写哪几份」的决策，不碰磁盘。
 * 尺寸不对、版本不认识、版本太老，一律返回**可读中文理由**，由调用方
 * 决定要不要把 CSL 那条路的结果照常返回给用户（写不进资源包不等于失败）。
 */
export function planOfflineSkinPack(input: {
  mcVersion: string;
  /** 皮肤 PNG 的宽。 */
  width: number;
  /** 皮肤 PNG 的高（64 现代 / 32 legacy）。 */
  height: number;
  /** PNG 字节。所有条目共用同一份（覆盖贴图本来就是同一张图）。 */
  png: Uint8Array;
}): OfflineSkinPlan | OfflineSkinPlanFailure {
  const v = parseMcVersion(input.mcVersion);
  if (v === null) {
    return { ok: false, reason: `认不出这个 MC 版本号：${input.mcVersion}` };
  }

  const packFormat = resourcePackFormatForAnyMcVersion(input.mcVersion);
  if (packFormat === undefined) {
    // 表从 1.6.1 起有值（资源包 1.6 才出现），走到这里就是更老的版本
    return {
      ok: false,
      reason: `${input.mcVersion} 还没有资源包（资源包是 1.6 才有的），皮肤只能靠 CustomSkinLoader mod`,
    };
  }

  const in1193 = cmp(v, [1, 19, 3]) >= 0;
  const in18plus = cmp(v, [1, 8, 0]) >= 0;

  if (in18plus && input.height === 32) {
    return {
      ok: false,
      reason:
        '64×32 的旧格式皮肤不能走这条路：左臂左腿的贴图在 1.8+ 的布局里位于图外，画出来是花的。请用 CustomSkinLoader（按玩家名发皮肤，旧格式由游戏自己镜像）',
    };
  }
  if (!in18plus && input.height !== 32) {
    return {
      ok: false,
      reason: `${input.mcVersion} 只支持 64×32 的旧格式皮肤；这张是 64×64，没有裁剪工具可用（仓库里没有 PNG 编码器）`,
    };
  }

  const entries: OfflineSkinPlan['entries'] = [];
  if (in1193) {
    // 18 份：wide/slim × 9 个名字（真 jar 清单，见文件头表格）
    for (const model of PLAYER_SKIN_MODELS) {
      for (const name of DEFAULT_SKIN_NAMES) {
        entries.push({ path: playerDefaultSkinPath(model, name), bytes: input.png });
      }
    }
  } else {
    for (const name of PRE_1193_SKIN_NAMES) {
      entries.push({ path: `${ENTITY_TEXTURE_PREFIX}${name}.png`, bytes: input.png });
    }
  }

  const description = 'MC Creator 离线皮肤（替换默认皮肤）';
  /**
   * `pack_format` / `min_format`+`max_format` 的取舍，按官方 pack.mcmeta 文档
   * （minecraft.wiki，1.21.9 / 25w31a 那一节）：
   *
   * - 1.21.9 之前：只有 `pack_format`。
   * - 1.21.9 起：`min_format` / `max_format` **必填**，`pack_format` 只在
   *   「本包也支持旧格式（资源包 < 65）」时才允许出现 —— 我们这份包只在自己
   *   的目标版本上生效，所以**不能**写 `pack_format`。
   * - 整数语义（两条都是官方原文）：
   *   * `min_format: 97` ≡ `[97, 0]`；
   *   * `max_format: 97` ≡ 「主版本 97，次版本任意」。
   *   所以我们写 **主版本整数**就够了：既盖住 `[97, 1]` 这种带次版本的版本
   *   （如 26.3），也不会因为写成 `97.1` 这个**浮点数**被游戏当成非法值。
   */
  const packMcmeta = usesMinMaxFormat(input.mcVersion)
    ? `${JSON.stringify({ pack: { description, min_format: packFormat, max_format: packFormat } }, null, 2)}\n`
    : `${JSON.stringify({ pack: { pack_format: packFormat, description } }, null, 2)}\n`;

  return {
    ok: true,
    entries,
    packMcmeta,
    optionsEntry: `${OPTIONS_PACK_PREFIX}${OFFLINE_PACK_FILE_NAME}`,
  };
}

/**
 * 把 `<entry>` 加进 options.txt 的 `resourcePacks` 列表（`["vanilla","file/…"]`）。
 *
 * 幂等：已有同项时**不重复加**。1.13 起还要保证 `"vanilla"` 在列表里
 * （游戏要求；插在最前）。其它行**原样保留** —— options.txt 由游戏全权管理，
 * 我们只动这一行。
 *
 * 两个容易踩的坑，这里都按「不破坏游戏文件」处理：
 *
 * - **行尾**：Java 的 `Properties.store` 在 Windows 上写 `\r\n`，所以真实
 *   options.txt 是 CRLF。改这一行时把原行尾原样带回去，别把文件搞成混合行尾。
 * - **末行没换行**：文件最后一行可能没有 `\n`，直接往后接会把两个键粘成一行
 *   （`resourcePacks=[…]` 会变成上一个键值的一部分），游戏读到就乱了。
 */
export function addResourcePackToOptions(text: string, entry: string, mcVersion: string): string {
  const v = parseMcVersion(mcVersion);
  const needsVanilla = v !== null && cmp(v, VANILLA_REQUIRED_SINCE) >= 0;
  const lines = splitOptionsLines(text);
  const firstIndex = lines.findIndex((line) => RESOURCE_PACKS_LINE.test(line.body));
  const first = firstIndex === -1 ? null : RESOURCE_PACKS_LINE.exec(lines[firstIndex]!.body);
  const current = first === null ? [] : parsePackList(first[2] ?? '');
  const next = current.filter((e) => e !== entry);
  if (needsVanilla && !next.includes('vanilla')) next.unshift('vanilla');
  next.push(entry);
  // 一律写冒号：游戏只认冒号（等号行会被 `Skipping bad option` 丢掉）
  const newLine = `resourcePacks:[${next.map((e) => JSON.stringify(e)).join(',')}]`;
  if (firstIndex === -1) {
    const sep = text === '' || text.endsWith('\n') ? '' : '\n';
    return `${text}${sep}${newLine}\n`;
  }
  return lines
    .map((line, index) => {
      if (index === firstIndex) return `${newLine}${line.eol}`;
      // 旧版本用等号追加过重复行：整行丢掉（游戏本来也不认它）
      if (RESOURCE_PACKS_LINE.test(line.body)) return '';
      return `${line.body}${line.eol}`;
    })
    .join('');
}

/** 从 options.txt 的 `resourcePacks` 列表里删掉 `<entry>`。没有这一项就原样返回。 */
export function removeResourcePackFromOptions(text: string, entry: string): string {
  const lines = splitOptionsLines(text);
  const firstIndex = lines.findIndex((line) => RESOURCE_PACKS_LINE.test(line.body));
  if (firstIndex === -1) return text;
  const first = RESOURCE_PACKS_LINE.exec(lines[firstIndex]!.body)!;
  const next = parsePackList(first[2] ?? '').filter((e) => e !== entry);
  const newLine = `resourcePacks:[${next.map((e) => JSON.stringify(e)).join(',')}]`;
  return lines
    .map((line, index) => {
      if (index === firstIndex) return `${newLine}${line.eol}`;
      if (RESOURCE_PACKS_LINE.test(line.body)) return '';
      return `${line.body}${line.eol}`;
    })
    .join('');
}

/** options.txt 的一行。`eol` 单独留着，改动时原样还回去。 */
interface OptionsLine {
  body: string;
  eol: string;
}

/**
 * 按行切分 options.txt，**保留每行自己的行尾**（`\r\n` / `\n` / 末行没有行尾）。
 *
 * 不用正则整篇替换，是因为还要处理「同一键出现多次」的历史遗留行：
 * 按行遍历才能干净地整行删掉、又不碰其它行的行尾。
 */
function splitOptionsLines(text: string): OptionsLine[] {
  if (text === '') return [];
  const raw = text.split('\n');
  const out: OptionsLine[] = [];
  for (let i = 0; i < raw.length; i++) {
    const last = i === raw.length - 1;
    if (last && raw[i] === '') break; // 末尾换行之后没有新行
    let body = raw[i] ?? '';
    let eol = last ? '' : '\n';
    if (!last && body.endsWith('\r')) {
      body = body.slice(0, -1);
      eol = '\r\n';
    }
    out.push({ body, eol });
  }
  return out;
}

/** 解析 `["a","b"]` / `[]` / 空字符串。解析不出来按空列表（宁可重写也不抛）。 */
function parsePackList(raw: string): string[] {
  const out: string[] = [];
  const re = /"((?:[^"\\]|\\.)*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) out.push((m[1] ?? '').replace(/\\"/g, '"'));
  return out;
}

/**
 * 写资源包 + 改 options.txt。
 *
 * 返回一句**可直接给用户看的话**：说明写成了、还是这条路走不通（以及为什么）。
 * 写不成**不抛** —— 调用方已经把 CSL 那条路走完了，资源包只是补一条
 * 「没装 mod 也能显示」的路，失败该把原因说清楚，而不是让整个「应用」红掉。
 */
export async function writeOfflineSkinPack(args: {
  instanceGameDir: string;
  mcVersion: string;
  width: number;
  height: number;
  png: Uint8Array;
}): Promise<{ note: string; packPath: string | null }> {
  const plan = planOfflineSkinPack(args);
  if (!plan.ok) return { note: plan.reason, packPath: null };

  const zip = new JSZip();
  zip.file('pack.mcmeta', plan.packMcmeta);
  for (const e of plan.entries) zip.file(e.path, e.bytes);
  const buf = await zip.generateAsync({ type: 'nodebuffer' });

  const packDir = join(args.instanceGameDir, 'resourcepacks');
  mkdirSync(packDir, { recursive: true });
  const packPath = join(packDir, OFFLINE_PACK_FILE_NAME);
  writeFileSync(packPath, buf);

  const optionsPath = join(args.instanceGameDir, 'options.txt');
  const text = existsSync(optionsPath) ? readFileSync(optionsPath, 'utf-8') : '';
  writeFileSync(
    optionsPath,
    addResourcePackToOptions(text, plan.optionsEntry, args.mcVersion),
    'utf-8',
  );

  return {
    note: `已写离线皮肤资源包 ${OFFLINE_PACK_FILE_NAME}（覆盖 ${plan.entries.length} 份默认皮肤贴图，对用默认皮肤的玩家都生效）`,
    packPath,
  };
}

/**
 * 反悔：删资源包 + 从 options.txt 里摘掉引用。
 *
 * 什么时候调由调用方判断（本仓的策略：实例上**没有已应用皮肤**时才删，
 * 见 `listAppliedSkins`）。理由写在这里：资源包是**按实例**覆盖默认皮肤，
 * 不是按玩家名，所以「最后一个已应用皮肤没了」才是它该消失的时刻。
 */
export async function removeOfflineSkinPack(args: {
  instanceGameDir: string;
}): Promise<{ note: string; packPath: string | null }> {
  const packDir = join(args.instanceGameDir, 'resourcepacks');
  const packPath = join(packDir, OFFLINE_PACK_FILE_NAME);
  const optionsPath = join(args.instanceGameDir, 'options.txt');
  const entry = `${OPTIONS_PACK_PREFIX}${OFFLINE_PACK_FILE_NAME}`;

  let hadPack = false;
  if (existsSync(packPath)) {
    rmSync(packPath, { force: true });
    hadPack = true;
  }
  if (existsSync(optionsPath)) {
    const text = readFileSync(optionsPath, 'utf-8');
    writeFileSync(optionsPath, removeResourcePackFromOptions(text, entry), 'utf-8');
  }
  return { note: hadPack ? `已删除离线皮肤资源包 ${OFFLINE_PACK_FILE_NAME}` : '', packPath: null };
}
