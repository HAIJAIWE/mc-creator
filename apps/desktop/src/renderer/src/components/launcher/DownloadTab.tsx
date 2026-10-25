import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  BookOpen,
  Box,
  ChevronDown,
  ChevronRight,
  Download,
  Loader2,
  RefreshCw,
  Search,
  Server,
  X,
  HardDrive,
  Package,
  Puzzle,
  LayoutGrid,
  Layers,
  Image,
  Sparkles,
  User,
} from 'lucide-react';

import { ipcClient } from '../../lib/ipc-client.js';
import { compareMcVersionsDesc } from '../../lib/mc-version-compare.js';
import { wikiUrlFor } from './wiki-links.js';
import { ErrorBanner } from '../ErrorBanner';
import { ModDetailView } from './ModDetailView.js';
import { SkinDetailView } from './SkinDetailView.js';
import { SkinFrontPreview } from './skin-preview.js';
import {
  categoryLabel,
  sourceLoaderLabel,
  formatDownloads,
  formatAgo,
  versionRange,
  filenameFromUrl,
} from './detail-shared.js';
import { PLAY_LOADER_FILTERS } from '../../../../shared/play-loaders.js';
import type {
  LauncherDownloadProgress,
  ModEntry,
  ContentType,
  ContentKind,
  InstanceSummary,
  WorldInfo,
  LauncherModpackProgress,
  MineSkinEntryT,
  ModLoader,
} from '../../../../shared/ipc/launcher.js';
import { PromptDialog } from '../PromptDialog.js';
import { ConfirmDialog } from '../ConfirmDialog.js';
import { checkInstanceNameAgainst } from '../../../../shared/instance-name.js';

interface VersionEntry {
  id: string;
  type: string;
  releaseTime: string;
}

/**
 * 分组定义 —— 对齐 PCL 下载页的四组（正式版 / 预览版 / 远古版 / 愚人节版）。
 *
 * 分组名沿用中文习惯说法，和 PCL 保持一致：
 * 正式版=release、预览版=snapshot、远古版=old_beta、愚人节版=old_alpha。
 */
const GROUPS: { id: string; label: string; types: string[] }[] = [
  { id: 'release', label: '正式版', types: ['release'] },
  { id: 'snapshot', label: '预览版', types: ['snapshot'] },
  { id: 'old_beta', label: '远古版', types: ['old_beta'] },
  { id: 'old_alpha', label: '愚人节版', types: ['old_alpha'] },
];

const STAGE_LABEL: Record<string, string> = {
  versions: '解析版本',
  client: '客户端 jar',
  assets: '资源',
  libraries: '依赖库',
  server: '服务端 jar',
  instance: '创建实例',
};

/** 整合包安装的阶段标签。`resolve` / `loader` / `mods` 来自主进程。 */
const MODPACK_STAGE_LABEL: Record<string, string> = {
  resolve: '读取整合包清单…',
  loader: '准备游戏与加载器…',
  mods: '下载模组文件…',
  done: '完成',
};

/**
 * 左侧栏的分组。**PCL 原文里「原版游戏」不属于「社区资源」**：
 *
 * ```xml
 * <!-- Pages/PageDownload/PageDownloadLeft.xaml（2026-10 取自 Meloong-Git/PCL） -->
 * <local:MyListItem x:Name="ItemInstall" Title="原版游戏" Checked="True" .../>
 * <TextBlock Text="社区资源" Margin="13,20,5,4" Opacity="0.6" FontSize="12" />
 * <local:MyListItem x:Name="ItemMod" Title="Mod" .../>
 * <local:MyListItem x:Name="ItemPack" Title="整合包" .../>
 * <local:MyListItem x:Name="ItemDataPack" Title="数据包" .../>
 * <local:MyListItem x:Name="ItemResourcePack" Title="资源包" .../>
 * <local:MyListItem x:Name="ItemShader" Title="光影包" .../>
 * ```
 *
 * 也就是说那条「社区资源」标题是**分组用的**，不是装饰：原版游戏走 Mojang
 * 官方清单，后面几类走 Modrinth / CurseForge 源站 —— 来源不同，界面上就该分开。
 * 我们原来七项平铺、没有这条标题，看着像全部同源。
 */
const CATEGORY_GROUPS = { vanilla: '原版游戏', community: '社区资源' } as const;

/** 左侧内容分类 —— 对齐 PCL 下载页左侧六类（含「社区资源」分组）+ 皮肤。 */
interface Category {
  id: string;
  label: string;
  icon: React.ReactNode;
  /** 该分类对应的内容类型（后续 API 用）。 */
  contentType: string;
  /** 分组归属：只有原版游戏不在「社区资源」下（见 `CATEGORY_GROUPS`）。 */
  group: keyof typeof CATEGORY_GROUPS;
}

const CATEGORIES: Category[] = [
  {
    id: 'vanilla',
    label: '原版游戏',
    icon: <Box className="h-4 w-4" />,
    contentType: 'vanilla',
    group: 'vanilla',
  },
  {
    id: 'mod',
    // 拼图 = PCL 的 Mod 图标（`ItemMod` 那条 path 是一个方块的拼图缺口）。
    icon: <Puzzle className="h-4 w-4" />,
    label: 'Mod',
    contentType: 'mod',
    group: 'community',
  },
  {
    id: 'modpack',
    label: '整合包',
    icon: <Layers className="h-4 w-4" />,
    contentType: 'modpack',
    group: 'community',
  },
  {
    id: 'datapack',
    // PCL 的 `ItemDataPack` 是「四象限」图标。这里原来和原版游戏共用 `Box`，
    // 侧栏上两行图标一模一样，等于没有图标。
    icon: <LayoutGrid className="h-4 w-4" />,
    label: '数据包',
    contentType: 'datapack',
    group: 'community',
  },
  {
    id: 'resourcepack',
    label: '资源包',
    icon: <Image className="h-4 w-4" />,
    contentType: 'resourcepack',
    group: 'community',
  },
  {
    id: 'shader',
    label: '光影包',
    icon: <Sparkles className="h-4 w-4" />,
    contentType: 'shader',
    group: 'community',
  },
  // 皮肤：**不走** Modrinth/CF 搜索，走 MineSkin（见下方 SKIN_SOURCES_NOTE）。
  // 它也不能用 LAUNCHER_DOWNLOAD_* —— 皮肤按玩家名索引，没有「落到某个目录」
  // 这回事，所以走皮肤库那套 LAUNCHER_SKIN_* 通道。
  //
  // ⚠️ PCL 的下载页**没有**这一类（左侧只有上表那六项），这是我们自己加的第七类；
  // 它同样属于社区内容，所以挂在「社区资源」分组下。
  {
    id: 'skin',
    label: '皮肤',
    icon: <User className="h-4 w-4" />,
    contentType: 'skin',
    group: 'community',
  },
];

/**
 * 为什么皮肤这一类**只能浏览、不能搜**。
 *
 * 实测（2026-10）：
 * - Modrinth 的 `project_type` 里**根本没有 skin**，分类表里也没有皮肤类目 ——
 *   它的 taxonomy 只覆盖 mod/modpack/datapack/resourcepack/shader。
 * - CurseForge 我们映射的 classId（6/4471/12/6552/6945）里也没有皮肤；那边
 *   老的 Skin 分类是旧 CF 启动器的遗留内容，故**不接**。
 * - MineSkin 能浏览（实测 714 万张、16 条/页），但字段只有
 *   `id/skinUuid/uuid/url/time` —— **无名字、无作者**，没有可搜的文本。
 * - 按玩家名反查皮肤：MineSkin `/api/player/{name}` → 404，
 *   LittleSkin `/api/player/{name}` → 404，Mojang sessionserver 要 UUID
 *   且需正版账号 → 400。
 *
 * 所以这一类的「搜索框」不是还没接，是**源站没有可搜的字段**。界面上照实说，
 * 别留一个按了永远返回全量的输入框。
 */
const SKIN_SOURCE_NOTE =
  '皮肤站不提供按名字搜索（MineSkin 的条目只有编号，没有名字和作者），所以这里只能浏览。' +
  '想按名字找皮肤，可以在「皮肤」里直接粘贴皮肤图片的直链。';

/** ISO 时间 → PCL 那种「2026/09/15 19:23」。解析失败就原样返回，绝不显示 Invalid Date。 */
function formatReleaseTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = (n: number): string => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ` +
    `${p(d.getHours())}:${p(d.getMinutes())}`
  );
}

/** 每页条数。20 这个数比与 PCL 接近，也在 Modrinth 限流（300/分）能撑住的范围内。 */
const PAGE_SIZE = 20;

/**
 * 输入里有没有中文（CJK 统一表意文字 + 扩展 A）。
 *
 * 只有中文才值得去 MC百科 查别名 —— 纯 ASCII 词查了也白查，
 * 而 MC百科 限流很凶（实测连续几个请求就 429），不能随便消耗。
 */
function containsCjk(s: string): boolean {
  return /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/.test(s);
}

/** 哪个版本带「最新正式版 / 最新预览版」角标 */
function pickLatest(versions: VersionEntry[], type: string): VersionEntry | null {
  return versions.find((v) => v.type === type) ?? null;
}

/**
 * 默认安装目标。
 *
 * 不能无脑取 `instances[0]`：实例列表按目录/创建顺序返回，第一条很可能是
 * 一个还没下载客户端的原版实例。mod 装进原版实例不会报错，但游戏根本不加载，
 * 表现就是「下载成功了却没效果」。
 *
 * 优先级：
 *   1. 最近启动过的 Fabric/NeoForge 实例（用户实际在玩的）；
 *   2. 任一已就绪的 Fabric/NeoForge 实例；
 *   3. 最近启动过的实例（可能原版）；
 *   4. 任一已就绪实例；
 *   5. 第一条。
 */
function pickDefaultInstanceId(instances: InstanceSummary[]): string {
  if (instances.length === 0) return '';
  const modded = instances.filter((i) => i.loader !== 'vanilla');
  const byLastLaunched = (list: InstanceSummary[]): InstanceSummary | undefined =>
    [...list].sort((a, b) => (b.lastLaunchedAt ?? 0) - (a.lastLaunchedAt ?? 0))[0];

  const picked =
    byLastLaunched(modded) ??
    modded.find((i) => i.clientReady) ??
    byLastLaunched(instances) ??
    instances.find((i) => i.clientReady) ??
    instances[0];
  return picked?.id ?? '';
}

export function DownloadTab(): JSX.Element {
  const [versions, setVersions] = useState<VersionEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  /** 当前选中的左侧分类；默认 'vanilla'（原版游戏），对齐 PCL 默认选中第一项。 */
  const [activeCategory, setActiveCategory] = useState<string>('vanilla');
  const [job, setJob] = useState<{ id: string; kind: 'client' | 'server' | 'instance' } | null>(
    null,
  );
  /** 下载完成后的补充说明（目前只有服务端 jar 的形态需要交代）。 */
  const [notice, setNotice] = useState<string | null>(null);
  const [progress, setProgress] = useState<LauncherDownloadProgress | null>(null);

  // ===== 在线内容搜索（Mod / 整合包 / 数据包 / 资源包 / 光影包）=====
  const [modQuery, setModQuery] = useState('');
  const [modResults, setModResults] = useState<ModEntry[]>([]);
  const [modTotal, setModTotal] = useState(0);
  const [modLoading, setModLoading] = useState(false);
  const [modError, setModError] = useState<string | null>(null);
  const [modGameVersion, setModGameVersion] = useState('');
  const [modPage, setModPage] = useState(0);
  /**
   * 加载器筛选。
   *
   * 默认 **不过滤**（空串）：本启动器只装 NeoForge / Fabric（见
   * `shared/play-loaders.ts`），但用户搜「有哪些 mod」时不该被预选的加载器
   * 挡住 —— 默认给 Fabric 会让一进页面就看不到 NeoForge 的独占内容。
   *
   * Forge 仍留在选项里（老版本 1.12.2 那档有大量 Forge 专属 mod）与
   * 服务端场景还在用，只是不再是默认推荐。
   *
   * ⚠️ 这条注释曾经写反了（说「默认 fabric」），而代码是空串 —— 注释骗人。
   * 现在按代码改注释，不是按注释改行为。
   */
  const [modLoader, setModLoader] = useState('');
  const [modDownloading, setModDownloading] = useState<string | null>(null);
  /**
   * 当前结果列表的镜像（跟随 `modResults`）。
   *
   * 为什么不用 state 直接读：`loadMods` 是 `useCallback`，闭包里的 `modResults`
   * 是**创建回调那一刻**的快照。连续点两次「加载更多」，两次回调都读到同一份
   * 旧数组，第二页的结果会把第一页挤掉。用 ref 读永远拿到最新值。
   */
  const modResultsRef = useRef<ModEntry[]>([]);
  /** 当前打开的详情页条目（null = 在搜索结果列表）。点结果行进入，返回键清空。 */
  const [detailEntry, setDetailEntry] = useState<ModEntry | null>(null);
  const [modSource, setModSource] = useState<'all' | 'modrinth' | 'curseforge'>('all');
  /**
   * CurseForge 是否已配 key（由主进程在搜索响应里带回）。
   *
   * 只用于**用户主动选了 CurseForge** 时的就地引导。默认「全部」不显示任何
   * 提示 —— 见 modSource 那行的注释。
   */
  const [cfConfigured, setCfConfigured] = useState(true);
  const [modCategory, setModCategory] = useState('');
  /**
   * 中文别名查询的提示（"「钠」→ Sodium"）。
   *
   * 有它用户才知道**为什么中文能搜到英文结果** —— 否则链接点进去是
   * "Sodium"，跟用户输入的"钠"对不上，很容易以为搜错了东西。
   * 没有就是纯英文搜索，不需要解释。
   */
  const [cnAliasHint, setCnAliasHint] = useState<string | null>(null);

  // ===== 整合包安装 =====
  /**
   * 正在安装的整合包版本 id；null = 没在装。
   *
   * 单独一个 state 而不是复用 `modDownloading`：两者的耗时量级差着两个数量级
   * （单个 mod 几秒，整合包要下客户端 + 55 个文件，几分钟），UI 上要显示的
   * 东西也完全不同（进度条 vs 转圈图标）。
   */
  const [modpackInstalling, setModpackInstalling] = useState<string | null>(null);
  /**
   * 待确认的覆盖安装（同名同版本）。
   *
   * 用应用内 Modal 而不是 `window.confirm`：系统弹窗的标题是进程名（开发模式
   * 显示「Electron」），也不属于这个应用的视觉体系；纯文本里写 Markdown 还会
   * 原样显示成 `**覆盖**`。
   */
  const [confirmOverwrite, setConfirmOverwrite] = useState<{
    versionId: string;
    mcVersion: string;
    loader: string;
  } | null>(null);
  const [modpackProgress, setModpackProgress] = useState<LauncherModpackProgress | null>(null);
  /** 已经点了「取消安装」，等主进程把正在进行的请求停下来。 */
  const [modpackCancelling, setModpackCancelling] = useState(false);

  // ===== 下载目标实例 =====
  /**
   * mod 下载**必须**落到某个实例，不能落到一个全局共享目录 ——
   * 后者没有任何代码会读它，而且多实例必然互相串。
   *
   * 所以这里维护「当前安装到哪个实例」，两个下载入口都读它。
   */
  const [instances, setInstances] = useState<InstanceSummary[]>([]);
  const [targetInstance, setTargetInstance] = useState('');

  /**
   * 数据包的目标世界。
   *
   * 数据包比其他三类多一步：原版**没有**实例级的数据包目录，只有
   * `saves/<世界>/datapacks/`。网上说的「全局数据包目录」
   * （`<gameDir>/datapacks/`）来自 CurseForge 上 *Global Datapacks* 这个
   * mod，不是原版功能 —— 1.20.2 / 1.21 的更新日志里都没有这条。
   *
   * 所以装数据包必须选世界；没有世界就如实说，不把文件塞到 `mods/`（那会被
   * 加载器当 mod 扫并炸掉）。
   */
  const [worlds, setWorlds] = useState<WorldInfo[]>([]);
  const [targetWorld, setTargetWorld] = useState('');

  // ===== 皮肤分类（MineSkin 浏览）=====
  /**
   * 皮肤这一类的浏览状态。
   *
   * 独立于 `modResults` 而不是复用：两者来源、条目形状、翻页语义都不同
   * （MineSkin 是 uuid 锚点分页，Modrinth/CF 是页码），塞进同一个 state 只会
   * 让两边互相覆盖。
   */
  const [skinBrowse, setSkinBrowse] = useState<MineSkinEntryT[]>([]);
  const [skinPage, setSkinPage] = useState(1);
  const [skinHasMore, setSkinHasMore] = useState(false);
  const [skinLoading, setSkinLoading] = useState(false);
  const [skinError, setSkinError] = useState<string | null>(null);
  /**
   * 是否**成功读到过** MineSkin。
   *
   * 和 `SkinTab` 同一条教训：`entries.length === 0` 分不清「读到了、确实没有」
   * 和「压根没读到」。不区分的话，网络不通时会同时显示红色错误**和**
   * 「没有内容（或网络通）」—— 一边承认出错一边说「其实没有」。
   */
  const [skinLoaded, setSkinLoaded] = useState(false);
  /** 正在导入的皮肤编号（用来只在那一条上转圈）。 */
  const [skinImporting, setSkinImporting] = useState<number | null>(null);
  /** UUID 导入的输入框 + 进行中状态。 */
  const [officialUuid, setOfficialUuid] = useState('');
  const [officialImporting, setOfficialImporting] = useState(false);
  /** 正在查看详情的皮肤条目（null = 在列表）。点条目进入，返回键清空。 */
  const [skinDetail, setSkinDetail] = useState<MineSkinEntryT | null>(null);
  /**
   * 应用皮肤的目标玩家名。
   *
   * 皮肤按**玩家名**索引（LocalSkin 的文件名就是玩家名），所以「装到实例」
   * 这件事对皮肤还差一个玩家名。默认取所选实例的 username，用户可改。
   */
  const [skinPlayer, setSkinPlayer] = useState('');
  /** 玩家名不合法时禁用应用 —— 与 SkinTab 的判定保持一致 */
  const skinPlayerOk =
    skinPlayer.trim().length > 0 && !/[/\\]/.test(skinPlayer) && !skinPlayer.includes('..');

  /** 「安装到」这一栏当前实际指向哪里 —— 提示语要说得具体，不能只说实例名。 */
  const installTargetLabel =
    activeCategory === 'datapack'
      ? targetWorld
        ? `${targetInstance} 的世界「${targetWorld}」`
        : `${targetInstance}（尚未选择世界）`
      : targetInstance;

  /**
   * 当前选中的实例。用 id 反查而不是再存一份对象，实例列表刷新后自动跟上。
   */
  const selectedInstance = instances.find((i) => i.id === targetInstance);

  /**
   * 原版实例装 mod 是**静默无效**的：文件会写进 `mods/`，但原版客户端不读。
   * 与其让用户下载完才发现没效果，不如当场拦下来并说清楚。
   */
  const modTargetIsVanilla = activeCategory === 'mod' && selectedInstance?.loader === 'vanilla';

  /**
   * 现在能不能下载。
   *
   * 数据包必须先有世界 —— 没有世界时按钮**禁用**并给出原因，
   * 而不是让用户点了再弹一句「必须指定世界」。PCL 也是这么拦的。
   * 原版实例装 mod 同样禁用（见上）。
   */
  const canDownloadHere =
    targetInstance !== '' &&
    (activeCategory !== 'datapack' || targetWorld !== '') &&
    !modTargetIsVanilla;

  /**
   * 拉实例列表。
   *
   * 失败**不设 error**：实例列表只是下载目标的下拉，拉不到不该让整个搜索区
   * 变成错误态（搜索本身没问题）。真到下载时再报错。
   *
   * 选中的实例若已不存在（比如被删了），回落到「最近在玩的、非原版」实例 ——
   * 留着失效 id 会让每次下载都在主进程炸 `assertVersionId`。
   */
  const loadInstances = useCallback(async () => {
    try {
      const res = await ipcClient.launcherListInstances();
      if (res.error || !res.instances) return;
      setInstances(res.instances);
      setTargetInstance((cur) =>
        res.instances!.some((i) => i.id === cur) ? cur : pickDefaultInstanceId(res.instances!),
      );
    } catch {
      // 同上：拉不到就不动，保持上一次的已知状态。
    }
  }, []);

  /** 根据当前分类筛选版本。目前只有 vanilla 有数据，其它分类返回空。 */
  const filteredVersions = useMemo(() => {
    if (activeCategory === 'vanilla') return versions;
    return [];
  }, [versions, activeCategory]);

  /**
   * 内容搜索的版本候选：常用版本 + 现有实例的版本 + 用户当前输入。
   *
   * 26.x 刚发布时静态表里不一定有；实例列表是最可靠的「用户关心哪些版本」来源。
   * 输入框用 `<datalist>` 做建议，但仍然允许手打任意版本号（源站以后新增的版本
   * 不需要改代码才能筛）。
   */
  const modVersionSuggestions = useMemo(() => {
    const seen = new Set<string>([
      '1.21.11',
      '1.21.10',
      '1.21.9',
      '1.21.5',
      '1.21.1',
      '1.21',
      '1.20.6',
      '1.20.4',
      '1.20.1',
      '1.20',
      '1.19.4',
      '1.19.2',
      '1.18.2',
      '1.17.1',
      '1.16.5',
      '1.12.2',
    ]);
    for (const instance of instances) seen.add(instance.versionId);
    const current = modGameVersion.trim();
    if (current) seen.add(current);
    return [...seen].sort(compareMcVersionsDesc);
  }, [instances, modGameVersion]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await ipcClient.launcherListVersions();
      if (res.error) setError(res.error);
      else setVersions(res.versions ?? []);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // 实例列表在两处会变：进页面时、以及本页「下载游戏」建出新实例后
  // （下载页自己就能建实例，不跳走，所以必须在这里重拉）。
  useEffect(() => {
    void loadInstances();
  }, [loadInstances]);

  /**
   * 数据包需要世界列表 —— 只在「数据包」分类时才拉。
   *
   * 条件加载而不是一进页面就拉：世界解析要读每个存档的 `level.dat`，
   * 存档多时不是免费的；而其余五个分类用不到它。
   */
  useEffect(() => {
    if (activeCategory !== 'datapack' || !targetInstance) {
      setWorlds([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const res = await ipcClient.launcherListWorlds({ instance: targetInstance });
        if (cancelled) return;
        const list = res.worlds ?? [];
        setWorlds(list);
        // 默认选第一个 —— 数据包必须有世界才能装，默认空着等于每次都要手动选
        setTargetWorld((cur) =>
          list.some((w) => w.dirName === cur) ? cur : (list[0]?.dirName ?? ''),
        );
      } catch {
        if (!cancelled) setWorlds([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeCategory, targetInstance]);

  /**
   * 加载搜索结果。
   *
   * `append` 决定是**追加**还是**替换**：点「加载更多」时为 true，把新一页
   * 接在已有结果后面 —— 列表因此能一直往下长，而不是永远只有一页 20 条、
   * 翻页就把前面挤掉（PCL 是追加式，不是分页式）。
   *
   * 排序固定走 'downloads'：PCL 那个界面上没有排序控件，列表默认按下载量
   * 排（截图里 Sodium / Iris Shaders / Entity Culling 都是百万级下载量的项目）。
   */
  /**
   * 页码的同步镜像。
   *
   * 存在的原因很具体：`loadMods` 原本把 `modPage` 放在 useCallback 依赖里，
   * 而下面那个「条件变了就重跑第一页」的 useEffect 又依赖 `loadMods`。
   * 于是点一次「加载更多」会同时发生两件事：
   *   1. onClick 里 `loadMods(true)` —— 追加
   *   2. `setModPage` 让 `loadMods` 换身份 → effect 触发 `loadMods(false)` —— **替换**
   * 后者赢，于是「加载更多」实际是把列表换成第 N 页，前面的全没了 ——
   * 整个追加式设计（见上面 loadBrowse/loadMods 的注释）形同虚设，
   * 而现象只是「怎么刷都只有一页」，很难联想到是这个依赖关系的问题。
   *
   * 改成把 page 作为**参数**传进来，`modPage` 就不再进依赖，
   * 翻页自然不会触发自动重跑。
   */
  const modPageRef = useRef(0);
  modPageRef.current = modPage;

  const loadMods = useCallback(
    async (append: boolean, page: number = modPageRef.current) => {
      if (activeCategory === 'vanilla') return;
      setModLoading(true);
      setModError(null);
      try {
        /**
         * 中文词 → 英文名。
         *
         * Modrinth / CurseForge 都只有英文名，直接搜「钠」什么都出不来。
         * MC百科 有中文名（实测 `?key=钠` → Sodium），但它不托管任何文件，
         * 所以**只拿它查词**，然后拿英文名去 Modrinth/CF 搜 —— 数据仍走
         * 那两家的 JSON API（快），中文只是查词时多一次请求。
         *
         * 只在「看起来是中文」时才查：纯英文词查了也是白查，还会白撞限流
         * （MC百科 实测连续几个请求就 429）。
         * 查失败**不打断搜索** —— 用英文照常搜得到，只是少个中文提示。
         */
        let query = modQuery;
        if (containsCjk(modQuery)) {
          try {
            const alias = await ipcClient.launcherModCnAlias({ key: modQuery });
            if (alias.englishNames.length > 0) {
              // 有中文名可用：换成最可信的那个英文名去搜
              query = alias.englishNames[0]!;
              setCnAliasHint(
                `「${modQuery}」→ ${alias.englishNames[0]}` +
                  (alias.englishNames.length > 1
                    ? `（还有 ${alias.englishNames.length - 1} 个候选：${alias.englishNames.slice(1).join('、')}）`
                    : ''),
              );
            } else {
              setCnAliasHint(null);
            }
          } catch {
            // 别名查不动就用原词搜，只是搜不到而已，不该整个搜索失败
            setCnAliasHint(null);
          }
        } else {
          setCnAliasHint(null);
        }

        const res = await ipcClient.launcherSearchMods({
          query,
          contentType: activeCategory as ContentType,
          gameVersion: modGameVersion || undefined,
          loader: modLoader === '' ? undefined : (modLoader as ModLoader),
          // 类型筛选（下面对应的那个下拉）。空串 = 不过滤，所以不传。
          ...(modCategory === '' ? {} : { category: modCategory }),
          page,
          limit: PAGE_SIZE,
          sort: 'downloads',
          source: modSource,
        });
        // 主进程每次都带回真实配置状态，别靠本地缓存猜 —— 用户可能刚在设置里填了
        setCfConfigured(res.curseForgeConfigured);
        if (res.error) {
          // 主进程把「缺 CurseForge key」之类的**部分失败**也放进 error，
          // 但 results 同时是有效的（Modrinth 那半边）。所以不因为 error 清空列表，
          // 只在列表为空时才把 error 显示成"没有结果"的样子。
          setModError(res.error);
          if (res.mods.length > 0) {
            // 部分失败：Modrinth 那半边仍然可用，照常渲染（error 只是旁边一条提示）
            if (append) {
              const prev = modResultsRef.current;
              const seen = new Set(prev.map((m) => m.id));
              const merged = [...prev, ...res.mods.filter((m) => !seen.has(m.id))];
              modResultsRef.current = merged;
              setModResults(merged);
            } else {
              modResultsRef.current = res.mods;
              setModResults(res.mods);
            }
            setModTotal(res.total);
          } else if (!append) {
            modResultsRef.current = [];
            setModResults([]);
          }
        } else if (append) {
          // 追加要去重：源站排序在翻页间可能变动，同一项目会在两页都出现。
          //
          // 读的是 **ref** 不是 state：state 值在本回调创建时就被捕获了，
          // 连点两次「加载更多」时两次都会拿到同一份旧数组，后一页直接被覆盖。
          const prev = modResultsRef.current;
          const seen = new Set(prev.map((m) => m.id));
          const merged = [...prev, ...res.mods.filter((m) => !seen.has(m.id))];
          modResultsRef.current = merged;
          setModResults(merged);
          setModTotal(res.total);
        } else {
          modResultsRef.current = res.mods;
          setModResults(res.mods);
          setModTotal(res.total);
        }
      } catch (e) {
        setModError((e as Error).message);
        if (!append) {
          modResultsRef.current = [];
          setModResults([]);
        }
      } finally {
        setModLoading(false);
      }
    },
    [activeCategory, modQuery, modGameVersion, modLoader, modSource, modCategory],
  );

  /**
   * 翻一页 MineSkin。
   *
   * 皮肤不走 `loadMods`：源站不同（没有 Modrinth 皮肤），条目形状也不同。
   * 复用同一个 `modPage` 会让两边的翻页语义互相污染。
   */
  const loadSkinPage = useCallback(async (page: number) => {
    setSkinLoading(true);
    setSkinError(null);
    try {
      const res = await ipcClient.launcherSkinMineskinPage({ page });
      if (res.error) {
        setSkinLoaded(false);
        setSkinError(res.error);
        setSkinBrowse([]);
        return;
      }
      setSkinBrowse(res.entries ?? []);
      setSkinLoaded(true);
      setSkinPage(res.page);
      setSkinHasMore(res.hasMore);
    } catch (e) {
      setSkinLoaded(false);
      setSkinError((e as Error).message);
      setSkinBrowse([]);
    } finally {
      setSkinLoading(false);
    }
  }, []);

  /**
   * 导入 MineSkin 皮肤到皮肤库，可选**顺手应用**到当前玩家名。
   *
   * 「下载」对皮肤的含义是「存进皮肤库」—— 不是落进某个目录（皮肤按玩家名
   * 索引，见 shared/ipc/launcher.ts 的 ContentKind 注释）。所以即使用户没填
   * 玩家名，导入本身也算成功，只是还没生效；这一点必须说清楚，否则用户会以为
   * 装完就能在游戏里看到。
   */
  const importSkin = useCallback(
    async (mineskinId: number, alsoApply: boolean) => {
      setSkinError(null);
      setSkinImporting(mineskinId);
      try {
        const res = await ipcClient.launcherSkinAddMineskin({ mineskinId });
        if (res.error || !res.entry) {
          setSkinError(res.error ?? '导入失败');
          return;
        }
        let appliedTo: string | null = null;
        if (alsoApply) {
          const ap = await ipcClient.launcherSkinApply({
            skinId: res.entry.id,
            instance: targetInstance,
            playerName: skinPlayer,
          });
          if (ap.error) {
            // 库里有、但没装上 —— 两件事分开说，别报成「导入失败」。
            // ⚠️ 这里必须**直接返回**：下面还有一次 setNotice（成功分支的文案），
            // 不 return 就会把它覆盖掉，用户只会看到「已存进皮肤库」而不知道
            // 应用其实失败了 —— 那正是最容易误判成「装好了」的时刻。
            setNotice(`皮肤已存进皮肤库，但应用到玩家「${skinPlayer}」失败：${ap.error}`);
            return;
          }
          appliedTo = skinPlayer;
        }
        setNotice(
          appliedTo === null
            ? `皮肤已存进皮肤库${res.entry.name}。填好玩家名后点「导入并应用」才能在游戏里显示。`
            : `皮肤已存进皮肤库并应用到玩家「${appliedTo}」。`,
        );
      } catch (e) {
        setSkinError((e as Error).message);
      } finally {
        setSkinImporting(null);
      }
    },
    [targetInstance, skinPlayer],
  );

  /**
   * 按 UUID 导入正版皮肤。
   *
   * ⚠️ 只收 UUID，不收玩家名 —— Mojang 的 `api.mojang.com/names/{name}`
   * 已废弃（实测 ECONNRESET），名字→UUID 这一环断了，所以这里连猜都不猜，
   * 输入不合法就刚刚好告诉用户「要 UUID 不是名字」。
   *
   * 成功时把 Mojang 返回的**玩家名**报出来，让用户能确认「这 UUID 是不是我
   * 要找的那个人」—— 光说「导入成功」是没法核对的。
   */
  const importOfficialByUuid = useCallback(async () => {
    const uuid = officialUuid.trim();
    if (uuid === '') return;
    setSkinError(null);
    setOfficialImporting(true);
    try {
      const res = await ipcClient.launcherSkinAddOfficial({ uuid });
      if (res.error || !res.entry) {
        setSkinError(res.error ?? '导入失败');
        return;
      }
      const who = res.playerName ?? '';
      setNotice(
        (who === '' ? '正版皮肤已存进皮肤库' : `已导入 ${who} 的正版皮肤并存进皮肤库`) +
          (res.hasCape ? '（该账号有披风，但本启动器现在只导皮肤）' : '') +
          '。填好玩家名后点对应皮肤的「应用」才能在游戏里显示。',
      );
      // 导入完顺便刷新第一页 —— 列表可能刚好被顶掉，用户找不到新的那张
      await loadSkinPage(1);
    } catch (e) {
      setSkinError((e as Error).message);
    } finally {
      setOfficialImporting(false);
    }
  }, [officialUuid, loadSkinPage]);

  useEffect(() => {
    if (activeCategory === 'skin') {
      void loadSkinPage(1);
      return;
    }
    if (activeCategory !== 'vanilla') {
      // 切分类 / 改筛选条件 → 替换（modPage 已在上游被重置为 0）
      void loadMods(false);
    }
  }, [activeCategory, loadMods, loadSkinPage]);

  // 整合包安装进度。装完 / 失败都要清掉，否则进度条会一直挂在界面上。
  useEffect(() => ipcClient.onLauncherModpackProgress(setModpackProgress), []);

  /**
   * 取消当前整合包安装。
   *
   * 主进程只回「信号发出去了没有」，真正的收尾在 `startModpackInstall` 的
   * 返回值里处理 —— 这样取消和正常失败不会各说一套。
   */
  const cancelModpackInstall = async (): Promise<void> => {
    if (modpackInstalling === null || modpackCancelling) return;
    setModpackCancelling(true);
    try {
      const res = await ipcClient.launcherCancelModpack({
        modId: detailEntry?.id ?? '',
        versionId: modpackInstalling,
      });
      if (!res.ok) {
        // 安装可能刚好在点击前完成。不要再写提示：安装返回值马上会给出
        // 真实结果，两条提示互相覆盖只会让用户看到错的那条。
        setModpackCancelling(false);
      }
      // 受理成功时保持「正在取消…」和禁用状态，直到安装返回值收尾
      // （startModpackInstall 的 finally 负责复位）。
    } catch (e) {
      setModpackCancelling(false);
      setError((e as Error).message);
    }
  };

  /**
   * 真正开始装（进度、notice、错误都在这里）。
   *
   * 单独抽出来是因为「同名同版本」要先弹应用内确认框，确认回调里再调它 ——
   * 不能用 `window.confirm`：那个弹的是系统窗口，标题写死成进程名（开发模式
   * 下是「Electron」），而且 Markdown 星号会原样显示。
   */
  const startModpackInstall = async (versionId: string): Promise<void> => {
    setModpackInstalling(versionId);
    setModpackCancelling(false);
    setError(null);
    setNotice(null);
    setModpackProgress(null);
    try {
      const res = await ipcClient.launcherInstallModpack({
        modId: detailEntry?.id ?? '',
        versionId,
        instanceName: detailEntry?.name,
      });
      // 取消不是失败：已经写进去的文件保留，实例也已经建出来了。把「装到哪」
      // 说清楚，用户才知道是重新安装补全，还是直接去实例里看看。
      if (res.cancelled) {
        setNotice(
          res.instanceId
            ? `已取消安装。已写入的 ${res.installed ?? 0} 个文件保留在实例「${res.instanceId}」（${res.gameDir}），该实例可能不完整，重新安装可以补全。`
            : '已取消安装，还没有创建实例，也没有写入任何文件。',
        );
        await loadInstances();
        return;
      }
      if (res.error && !res.installed) {
        setError(res.error);
        return;
      }
      // 没装上的可能很多（整合包自带文件、CF 重定向、18 个语言包…），
      // 全列出来会把整条 notice 撑爆，反而看不出重点 → 列前 5 条 + 总数。
      const failed = res.failed ?? [];
      const shown = failed
        .slice(0, 5)
        .map((f) => `${f.name}（${f.error ?? '未知原因'}）`)
        .join('、');
      setNotice(
        `整合包已装到实例 ${res.instanceId}（${res.gameDir}）。` +
          `已铺 ${res.installed} 个文件（含整合包自带的配置）。` +
          (failed.length > 0
            ? `另有 ${failed.length} 项没装上：${shown}` +
              (failed.length > 5 ? ` 等 ${failed.length} 项` : '') +
              '。'
            : ''),
      );
      await loadInstances();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setModpackInstalling(null);
      setModpackCancelling(false);
      setModpackProgress(null);
    }
  };

  /**
   * 安装整合包（**新建**一个实例，实例名 = 整合包名字）。
   *
   * ⚠️ 覆盖只发生在「同名 + 同 MC 版本」的实例上（重装 / 更新同一个整合包）。
   * 同名但版本不同 → 主进程另起一个 `(2)` 名字，谁也不覆盖。
   *
   * 覆盖必须让用户知道，不能静默做掉：整合包装完是要直接开玩的，
   * 覆盖掉别人手工加的 mod 会让人白玩很久。所以这里先查、先问。
   */
  const installModpack = async (versionId: string, _versionLabel: string): Promise<void> => {
    const detailRes = await ipcClient.launcherGetModDetail({
      modId: detailEntry?.id ?? '',
      contentType: 'modpack',
    });
    /**
     * 用**这个版本**的 MC 版本，而不是项目级的 `detail.gameVersions[0]`：
     * 项目级是「所有版本支持的 MC 的并集」（旧→新排），装旧版本时它会
     * 指向列表里最新的那个版本号 —— 于是确认框要么不弹、要么弹错版本。
     * 主进程建实例用的是清单里那个版本的 MC 版本，这里必须同源。
     */
    const selectedVersion = detailRes.detail?.versions.find((v) => v.id === versionId);
    const mcVersion = selectedVersion?.gameVersions?.[0] ?? detailRes.detail?.gameVersions?.[0];
    const packName = detailEntry?.name ?? '';
    if (mcVersion) {
      /**
       * 装整合包 = 建一个**以整合包名字命名**的实例（实例名 = 目录名，见
       * `instance-registry`）。所以真正会被覆盖的只有「同名的同版本实例」——
       * 主进程也按这条规则走：同名不同版本会另起一个不撞的名字（`(2)`），
       * 不覆盖任何东西。
       *
       * 以前这里查的是 `id === mcVersion`（把 MC 版本号当实例 id），那是
       * 单实例时代的写法 —— 多实例下永远查不到，等于这道闸门从来没生效过。
       */
      const existing = instances.find((i) => i.name === packName && i.versionId === mcVersion);
      if (existing) {
        setConfirmOverwrite({ versionId, mcVersion, loader: existing.loader });
        return;
      }
    }
    await startModpackInstall(versionId);
  };

  const doDownloadMod = async (mod: ModEntry): Promise<void> => {
    if (!canDownloadHere) {
      setError(
        activeCategory === 'datapack'
          ? '数据包只能装进某个世界。请先选择（或创建）一个世界。'
          : '还没有可安装的实例。请先在「原版游戏」里下载一个 MC 版本。',
      );
      return;
    }
    setModDownloading(mod.id);
    setError(null);
    try {
      const res = await ipcClient.launcherDownloadMod({
        modId: mod.id,
        targetInstance,
        contentKind: activeCategory as ContentKind,
        ...(activeCategory === 'datapack' ? { world: targetWorld || undefined } : {}),
      });
      if (res.error) {
        setError(res.error);
      } else if (res.path) {
        setNotice(`「${mod.name}」已安装到 ${installTargetLabel}`);
      }
      // 有没补齐的前置 → 如实说。少一个 Fabric API 就会启动崩，
      // 静默成功只会让用户以为装好了。
      if (res.missingDependencies && res.missingDependencies.length > 0) {
        setNotice(
          `「${mod.name}」已下载，但还有前置没补上：` +
            res.missingDependencies.join('、') +
            '。缺前置会导致启动失败，请手动安装。',
        );
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setModDownloading(null);
    }
  };

  /**
   * 下载某个具体文件（用 URL 直下，不走 modId 解析版本）。
   *
   * 与 `doDownloadMod` 的区别：详情页一个项目有几十个版本 / 多个文件，
   * 用户点的是**那一行的那一个文件**，此时源站 URL 已经在手上，
   * 再绕道 modId → 解析 → 取 latest 反而会下错版本。
   *
   * 但**依赖仍然要下**，所以 `modId` 照样传 —— 主进程用它把 URL 定位回
   * 版本对象，再递归 required 前置（与 `LAUNCHER_DOWNLOAD_MOD` 共用实现）。
   *
   * @param modId 该文件属于的项目（`mr_`/`cf_` 前缀）；拿不到就不传，
   *   主进程会把「无法核对前置」如实回报，不会静默跳过。
   */
  /**
   * 按 URL 装一个文件（详情页每一行、搜索结果行都走这里）。
   *
   * @param modId 主进程靠它把 URL 定位回版本对象，才能递归 required 前置
   * @param expected 清单给的 `sha1` / `size`。**能给就给**：下载按候选源取
   *   （官方 / 国内镜像），不校验就只能信「HTTP 200 等于文件是对的」。
   */
  const doDownloadFile = async (
    url: string,
    filename: string,
    label: string,
    modId?: string,
    expected?: { sha1?: string; size?: number },
  ): Promise<void> => {
    if (!canDownloadHere) {
      setError(
        activeCategory === 'datapack'
          ? '数据包只能装进某个世界。请先选择（或创建）一个世界。'
          : '还没有可安装的实例。请先在「原版游戏」里下载一个 MC 版本。',
      );
      return;
    }
    setModDownloading(filename);
    setError(null);
    try {
      const res = await ipcClient.launcherDownloadUrl({
        url,
        filename,
        targetInstance,
        contentKind: activeCategory as ContentKind,
        ...(activeCategory === 'datapack' ? { world: targetWorld || undefined } : {}),
        // ⚠️ 必须传：主进程要靠 modId 把 URL 定位回版本对象，才能递归 required
        // 前置。列表行的下载按钮几乎总是走这条 URL 通道（搜索结果已填好
        // downloadUrl），不传就等于「下载 Sodium 不带 Fabric API」，
        // 装进实例起不来而界面一声不吭。
        ...(modId === undefined ? {} : { modId }),
        ...(expected?.sha1 === undefined ? {} : { sha1: expected.sha1 }),
        ...(expected?.size === undefined ? {} : { size: expected.size }),
      });
      if (res.error) setError(res.error);
      else if (res.path) setNotice(`已安装到 ${installTargetLabel}`);
      if (res.missingDependencies && res.missingDependencies.length > 0) {
        setNotice(
          `「${label}」已下载，但前置没有一起装上：` +
            res.missingDependencies.join('、') +
            '。缺前置会导致启动失败，请手动安装。',
        );
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setModDownloading(null);
    }
  };

  // 进度订阅：失败也会发 finished:true，所以这里只管收口，不管成败。
  // ref 用来在回调里读到最新任务而不必重建订阅。
  const jobRef = useRef<{ id: string; kind: 'client' | 'server' | 'instance' } | null>(null);
  jobRef.current = job;
  useEffect(
    () =>
      ipcClient.onLauncherDownloadProgress((p) => {
        setProgress(p);
        const cur = jobRef.current;
        if (p.finished && cur && p.version === cur.id) {
          setJob(null);
          setProgress(null);
          // 客户端下载完成 = 多了一个实例，mod 的安装目标列表要跟着更新
          if (cur.kind === 'client') void loadInstances();
        }
      }),
    [loadInstances],
  );

  const grouped = useMemo(
    () =>
      GROUPS.map((g) => ({
        ...g,
        items: filteredVersions.filter((v) => g.types.includes(v.type)),
      })).filter((g) => g.items.length > 0),
    [filteredVersions],
  );

  // 「最新版本」卡片：PCL 把最新正式版与最新预览版并排放在最上面，
  // 而不是让人自己在长列表里翻。
  const latestRelease = pickLatest(filteredVersions, 'release');
  const latestSnapshot = pickLatest(filteredVersions, 'snapshot');

  /**
   * 下载客户端前的「起名」弹框。
   *
   * 之前这里直接 `launcherDownload({ version })`，实例名就默认成了版本号
   * （`1.21.1`）。但实例名**同时是磁盘目录名**（`game/<名字>/`），而
   * `shared/instance-name.ts` 的文件头写明了设计意图：
   * 「下载原版时弹框让用户起名，输入非法字符立刻红字提示，用户改到合法为止」
   * —— 这样「目录名 = 显示名」是 100% 成立的。主进程侧 `instanceName`
   * 一直是支持的，只是渲染层从没传过。
   */
  const [namePromptFor, setNamePromptFor] = useState<string | null>(null);

  const doDownload = (id: string): void => {
    setNamePromptFor(id);
  };

  const startDownload = async (id: string, instanceName: string): Promise<void> => {
    setJob({ id, kind: 'client' });
    setProgress(null);
    setError(null);
    setNotice(null);
    const res = await ipcClient.launcherDownload({ version: id, instanceName });
    if (res.error) setError(res.error);
    // 成功路径的收口交给进度事件（finished:true），这里不重复置态
  };

  /**
   * 下载服务端 jar（PCL 版本行上的第三个按钮）。
   *
   * 按钮**始终显示**、点下去才判断有没有 —— 与 PCL 一致。原因是
   * `listVersions()` 只返回顶层清单，而 `downloads.server` 在**每个版本各自的**
   * JSON 里；预判就得为 200 多个版本各发一次请求，那不是"顺手"的事。
   * 所以这里把判定推到点击时，并且失败要说人话（远古版确实没有服务端）。
   */
  const doDownloadServer = async (id: string): Promise<void> => {
    setJob({ id, kind: 'server' });
    setProgress(null);
    setError(null);
    setNotice(null);
    const res = await ipcClient.launcherDownloadServer({ version: id });
    if (res.error) {
      setError(res.error);
      return;
    }
    // 下载完成 ≠ 能跑：1.18 起的服务端 jar 是引导器，首次启动才去下本体。
    // 这个形态是主进程**实测** jar 头部得出的，不是按版本号猜的。
    if (res.kind === 'bundler') {
      setNotice(
        `${id} 的服务端已下载到 ${res.path ?? ''}。` +
          `它是引导器（bundler）：首次启动会自行下载服务端本体与依赖，需要联网且耗时较长。`,
      );
    } else if (res.kind === 'standalone') {
      setNotice(`${id} 的服务端已下载到 ${res.path ?? ''}，可直接 java -jar 启动。`);
    } else {
      setNotice(`${id} 的服务端已下载到 ${res.path ?? ''}。`);
    }
  };

  const doCreateServerInstance = async (id: string): Promise<void> => {
    setJob({ id, kind: 'instance' });
    setProgress(null);
    setError(null);
    setNotice(null);
    // 先弹 EULA 确认对话框（不能代用户同意）
    const confirmed = window.confirm(
      `即将为 ${id} 创建服务端实例。\n\n` +
        `⚠️ 你需要接受 Minecraft EULA：\n` +
        `https://aka.ms/MinecraftEULA\n\n` +
        `点击「确定」表示你已阅读并同意 EULA。`,
    );
    if (!confirmed) {
      setJob(null);
      return;
    }
    const res = await ipcClient.launcherCreateServerInstance({
      serverId: id,
      version: id,
      acceptEula: true,
    });
    if (res.error) {
      setError(res.error);
      setJob(null);
      return;
    }
    setNotice(
      `${id} 的服务端实例已创建于 ${res.serverDir ?? ''}。` +
        `${res.jarLinked ? '（jar 为硬链接，不占额外空间）' : '（jar 已复制）'}`,
    );
  };

  const renderRow = (v: VersionEntry) => {
    const busy = job !== null;
    const clientBusy = job?.id === v.id && job.kind === 'client';
    const serverBusy = job?.id === v.id && job.kind === 'server';
    const instanceBusy = job?.id === v.id && job.kind === 'instance';
    return (
      <li
        key={v.id}
        className="flex items-center gap-3 border-b border-mc-border px-3 py-2 last:border-b-0"
      >
        <span className="flex-1 font-mono text-xs">{v.id}</span>
        <span className="text-[10px] text-mc-text-dim">{formatReleaseTime(v.releaseTime)}</span>
        {/* 更新日志：按版本走，各自指向自己的 MC Wiki 页 */}
        <a
          href={wikiUrlFor(v.id)}
          target="_blank"
          rel="noreferrer"
          className="mc-btn-ghost"
          aria-label={`查看 ${v.id} 的更新日志`}
          title={`查看 ${v.id} 的更新日志`}
        >
          <BookOpen className="h-3 w-3" />
        </a>
        {/* 下载服务端：远古版没有，点了会给出明确原因（见 doDownloadServer） */}
        <button
          onClick={() => void doDownloadServer(v.id)}
          disabled={busy}
          className="mc-btn-ghost"
          aria-label={`下载 ${v.id} 的服务端`}
          title={`下载 ${v.id} 的服务端`}
        >
          {serverBusy ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <Server className="h-3 w-3" />
          )}
        </button>
        {/* 创建服务端实例：把已下载的 server.jar 变成能启动的实例 */}
        <button
          onClick={() => void doCreateServerInstance(v.id)}
          disabled={busy}
          className="mc-btn-ghost"
          aria-label={`为 ${v.id} 创建服务端实例`}
          title={`为 ${v.id} 创建服务端实例（需先下载服务端 jar）`}
        >
          {instanceBusy ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <HardDrive className="h-3 w-3" />
          )}
        </button>
        <button
          onClick={() => doDownload(v.id)}
          disabled={busy}
          className="mc-btn-ghost"
          aria-label={`下载 ${v.id}`}
        >
          {clientBusy ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <Download className="h-3 w-3" />
          )}
        </button>
      </li>
    );
  };

  const latestCard = (v: VersionEntry, label: string) => (
    <div className="flex items-start gap-3 px-3 py-2" key={v.id}>
      <div className="flex-1">
        <div className="font-mono text-sm">{v.id}</div>
        <div className="text-[11px] text-mc-text-dim">
          {label}，发布于 {formatReleaseTime(v.releaseTime)}
        </div>
      </div>
      <a
        href={wikiUrlFor(v.id)}
        target="_blank"
        rel="noreferrer"
        className="mc-btn-ghost"
        aria-label={`查看 ${v.id} 的更新日志`}
        title={`查看 ${v.id} 的更新日志`}
      >
        <BookOpen className="h-3 w-3" />
      </a>
      <button
        onClick={() => void doDownloadServer(v.id)}
        disabled={job !== null}
        className="mc-btn-ghost"
        aria-label={`下载 ${v.id} 的服务端`}
        title={`下载 ${v.id} 的服务端`}
      >
        {job?.id === v.id && job.kind === 'server' ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : (
          <Server className="h-3 w-3" />
        )}
      </button>
      <button
        onClick={() => void doCreateServerInstance(v.id)}
        disabled={job !== null}
        className="mc-btn-ghost"
        aria-label={`为 ${v.id} 创建服务端实例`}
        title={`为 ${v.id} 创建服务端实例（需先下载服务端 jar）`}
      >
        {job?.id === v.id && job.kind === 'instance' ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : (
          <HardDrive className="h-3 w-3" />
        )}
      </button>
      <button
        onClick={() => doDownload(v.id)}
        disabled={job !== null}
        className="mc-btn-ghost"
        aria-label={`下载最新版本 ${v.id}`}
      >
        {job?.id === v.id && job.kind === 'client' ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : (
          <Download className="h-3 w-3" />
        )}
      </button>
    </div>
  );

  return (
    <div className="flex flex-col gap-3 h-full" aria-label="下载">
      {error && <ErrorBanner message={error} onClose={() => setError(null)} />}
      {notice && (
        <div
          className="flex items-start gap-2 px-1 text-[11px] text-mc-text-dim"
          aria-live="polite"
        >
          <Server className="mt-0.5 h-3 w-3 shrink-0" />
          <span className="flex-1">{notice}</span>
          <button
            onClick={() => setNotice(null)}
            className="mc-btn-ghost"
            aria-label="关闭提示"
            title="关闭提示"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      )}

      {/* 主内容区：左侧分类 + 右侧列表 */}
      <div className="flex-1 flex overflow-hidden">
        {/* 左侧分类栏 —— 对齐 PCL 下载页左侧六类（含「社区资源」分组标题）*/}
        <aside className="w-40 flex-shrink-0 border-r border-mc-border bg-mc-surface-2 p-2">
          <nav aria-label="内容分类" className="flex flex-col gap-1">
            {CATEGORIES.map((cat, idx) => (
              <Fragment key={cat.id}>
                {/* 分组标题：只在**分组切换处**渲染（PCL 在「原版游戏」与「Mod」
                    之间有一条 TextBlock，其余项直接连排）。 */}
                {idx > 0 && CATEGORIES[idx - 1]!.group !== cat.group && (
                  <p className="mt-3 mb-0.5 px-2 text-[11px] text-mc-text-dim opacity-60">
                    {CATEGORY_GROUPS[cat.group]}
                  </p>
                )}
                <button
                  onClick={() => {
                    setActiveCategory(cat.id);
                    // ⚠️ 切分类必须一起做这三件事，少一件都会出问题：
                    //
                    // 1. `setModPage(0)` —— 不清页码的话，在整合包翻到第 3 页再切到
                    //    Mod，会去要 Mod 的第 3 页（用户明明只翻过整合包）。
                    // 2. 清掉结果 + 总数 —— 否则旧分类的结果会一直挂在屏幕上，
                    //    直到新数据回来才"突然"变成新分类。用户看到的就是
                    //    「点了 Mod 却没反应，要等一会才切换」。
                    // 3. 清掉详情页 —— `detailEntry` 不跟着分类走，从整合包详情页
                    //    切到 Mod 会继续显示那个整合包的详情（连内容都是错的）。
                    setModPage(0);
                    setModResults([]);
                    setModTotal(0);
                    setDetailEntry(null);
                    setSkinDetail(null);
                  }}
                  className={`flex items-center gap-2 w-full px-2 py-1.5 rounded-mc text-xs text-left transition-colors ${
                    activeCategory === cat.id
                      ? 'bg-mc-accent/15 text-mc-accent'
                      : 'text-mc-text-dim hover:bg-mc-hover'
                  }`}
                  aria-pressed={activeCategory === cat.id}
                >
                  <span className="flex-shrink-0">{cat.icon}</span>
                  <span className="truncate">{cat.label}</span>
                </button>
              </Fragment>
            ))}
          </nav>
        </aside>

        {/* 右侧内容区 */}
        <div className="flex-1 flex flex-col overflow-hidden min-w-0">
          {activeCategory === 'vanilla' ? (
            <>
              <div className="flex items-center gap-2 border-b border-mc-border px-3 py-1.5">
                <span className="text-xs text-mc-text-dim">
                  版本清单每次都从 Mojang 实时拉取，不做本地缓存
                </span>
                <button
                  onClick={() => void load()}
                  disabled={loading}
                  className="mc-btn-ghost ml-auto"
                  title="刷新版本清单"
                  aria-label="刷新版本清单"
                >
                  <RefreshCw className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} />
                </button>
              </div>

              {/* 最新版本 */}
              {(latestRelease || latestSnapshot) && (
                <section className="mc-card m-3">
                  <h3 className="mc-section-title px-3 pt-2">最新版本</h3>
                  <div className="divide-y divide-mc-border">
                    {latestRelease && latestCard(latestRelease, '最新正式版')}
                    {latestSnapshot && latestCard(latestSnapshot, '最新预览版')}
                  </div>
                </section>
              )}

              {/* 全部分组 */}
              {grouped.map((g) => {
                const expanded = open[g.id] ?? false;
                return (
                  <section className="mc-card" key={g.id}>
                    <button
                      onClick={() => setOpen((s) => ({ ...s, [g.id]: !expanded }))}
                      className="flex w-full items-center gap-2 px-3 py-2 text-left"
                      aria-expanded={expanded}
                      aria-label={`${g.label} 分组`}
                    >
                      {expanded ? (
                        <ChevronDown className="h-3 w-3" />
                      ) : (
                        <ChevronRight className="h-3 w-3" />
                      )}
                      <span className="text-xs font-medium">{g.label}</span>
                      <span className="text-[10px] text-mc-text-dim">{g.items.length}</span>
                    </button>
                    {expanded && (
                      <ul className="border-t border-mc-border">{g.items.map(renderRow)}</ul>
                    )}
                  </section>
                );
              })}

              {filteredVersions.length === 0 && !loading && (
                <div className="flex items-center gap-2 px-3 py-4 text-xs text-mc-text-dim">
                  <AlertTriangle className="h-3 w-3" />
                  没拿到版本清单。若刚启动，可能是网络不通。
                </div>
              )}
            </>
          ) : (
            <>
              {/* 详情页：点搜索结果行进入，整块替换掉搜索栏 + 列表（对齐 PCL 的独立详情窗口） */}
              {detailEntry !== null ? (
                <ModDetailView
                  entry={detailEntry}
                  contentType={activeCategory as ContentType}
                  onBack={() => setDetailEntry(null)}
                  onDownloadFile={(url, filename, expected) =>
                    void doDownloadFile(
                      url,
                      filename,
                      detailEntry?.name ?? filename,
                      detailEntry?.id,
                      expected,
                    )
                  }
                  {...(activeCategory === 'modpack'
                    ? {
                        onInstallModpack: (versionId: string, label: string) =>
                          void installModpack(versionId, label),
                        installingId: modpackInstalling,
                      }
                    : {})}
                  downloadingId={modDownloading}
                />
              ) : (
                <>
                  {/* 安装目标：下载必须落到某个具体实例，不能落在一个
                      谁也不读的全局目录。多实例时这一栏就是「装到哪个游戏里」。 */}
                  <div className="flex items-center gap-2 border-b border-mc-border px-3 py-2">
                    <HardDrive className="h-3.5 w-3.5 shrink-0 text-mc-text-dim" />
                    <span className="shrink-0 text-[11px] text-mc-text-dim">安装到</span>
                    {instances.length === 0 ? (
                      <span className="text-[11px] text-mc-text-dim">
                        还没有实例 —— 先到「原版游戏」下载一个 MC 版本，才能安装 mod。
                      </span>
                    ) : (
                      <select
                        value={targetInstance}
                        onChange={(e) => setTargetInstance(e.target.value)}
                        className="mc-select flex-1"
                        aria-label="安装到"
                        title="安装到"
                      >
                        {instances.map((i) => (
                          <option key={i.id} value={i.id}>
                            {i.name} · MC {i.versionId} · {i.loader}
                            {i.clientReady ? '' : '（未下载）'}
                          </option>
                        ))}
                      </select>
                    )}
                    <button
                      onClick={() => void loadInstances()}
                      className="mc-btn-ghost shrink-0"
                      aria-label="刷新实例列表"
                      title="刷新实例列表"
                    >
                      <RefreshCw className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  {modTargetIsVanilla && (
                    <div
                      role="status"
                      className="flex items-start gap-2 border-b border-mc-border bg-mc-surface-2 px-3 py-1.5 text-[11px] text-mc-redstone"
                    >
                      <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                      <span>
                        这个实例是原版（vanilla），mod 会被下载进 <code>mods/</code>{' '}
                        但游戏不会加载。 请改选 Fabric / NeoForge 实例，或先给这个实例安装加载器。
                      </span>
                    </div>
                  )}
                  {/* 数据包的目标世界。必须单独一行且**显眼**：
                      原版只有 saves/<世界>/datapacks/，装错地方要么不生效，
                      要么被加载器当 mod 扫。 */}
                  {activeCategory === 'datapack' && (
                    <div className="flex items-center gap-2 border-b border-mc-border px-3 py-2">
                      <HardDrive className="h-3.5 w-3.5 shrink-0 text-mc-text-dim" />
                      <span className="shrink-0 text-[11px] text-mc-text-dim">装进世界</span>
                      {worlds.length === 0 ? (
                        <span className="text-[11px] text-mc-text-dim">
                          {targetInstance
                            ? '这个实例还没有世界。数据包只能装进某个世界，请先创建世界。'
                            : '请先选择一个实例。'}
                        </span>
                      ) : (
                        <select
                          value={targetWorld}
                          onChange={(e) => setTargetWorld(e.target.value)}
                          className="mc-select flex-1"
                          aria-label="装进世界"
                          title="数据包会被放进这个世界的 datapacks/ 目录"
                        >
                          {worlds.map((w) => (
                            <option key={w.dirName} value={w.dirName}>
                              {w.levelName}
                              {w.dirName !== w.levelName ? `（${w.dirName}）` : ''}
                            </option>
                          ))}
                        </select>
                      )}
                    </div>
                  )}
                  {/* ===== 皮肤分类：整块换掉搜索栏 + 结果列表 =====
                      不是「也能搜」的第六类变体：源站只有 MineSkin，条目无名字，
                      所以下面没有搜索框，只有一句把限制说清楚的话。 */}
                  {activeCategory === 'skin' ? (
                    <>
                      {/*
                        玩家名栏放在**详情与列表的外面** —— 不是因为好看，是因为
                        功能：详情里的「导入并应用」要用它。把它塞进 else 分支的话，
                        一进详情玩家名输入框就消失了，而「导入并应用」永远禁用，
                        用户只能退回列表 —— 详情里的那个按钮就成了摆设。
                      */}
                      <div className="flex flex-wrap items-center gap-2 border-b border-mc-border px-3 py-2">
                        <span className="shrink-0 text-[11px] text-mc-text-dim">应用到玩家</span>
                        <input
                          value={skinPlayer}
                          onChange={(e) => setSkinPlayer(e.target.value)}
                          className="mc-input w-40"
                          aria-label="应用到玩家"
                          placeholder="玩家名（如 Steve）"
                          title={
                            skinPlayerOk
                              ? '皮肤会复制到该实例的 CustomSkinLoader/LocalSkin/skins/'
                              : '玩家名不能为空，也不能含 / \\ 或 ..'
                          }
                        />
                        <span className="shrink-0 text-[10px] text-mc-text-dim">
                          皮肤按玩家名生效（实例 {targetInstance || '未选择'}）
                        </span>
                        {skinDetail === null && (
                          <div className="ml-auto flex items-center gap-2">
                            <button
                              onClick={() => void loadSkinPage(Math.max(1, skinPage - 1))}
                              disabled={skinLoading || skinPage <= 1}
                              className="mc-btn-ghost"
                            >
                              上一页
                            </button>
                            <span className="text-[11px] text-mc-text-dim">第 {skinPage} 页</span>
                            <button
                              onClick={() => void loadSkinPage(skinPage + 1)}
                              disabled={skinLoading || !skinHasMore}
                              className="mc-btn-ghost"
                            >
                              下一页
                            </button>
                          </div>
                        )}
                      </div>

                      {/*
                        UUID 导入：这是目前**唯一**能拿到「某个具体的人」皮肤的
                        路子。放在分类置顶、跟浏览列表分开，是因为它跟浏览是两件事 ——
                        一个是按 UUID 精确取，一个是匿名浏览。

                        ⚠️ 只收 UUID，不收玩家名：Mojang 的 names 接口已废弃，
                        名字→UUID 断了，所以这里连猜都不猜（见 importOfficialByUuid）。
                      */}
                      <div className="flex flex-wrap items-center gap-2 border-b border-mc-border px-3 py-2">
                        <span className="shrink-0 text-[11px] text-mc-text-dim">正版 UUID</span>
                        <input
                          value={officialUuid}
                          onChange={(e) => setOfficialUuid(e.target.value)}
                          className="mc-input w-72"
                          aria-label="正版 UUID"
                          placeholder="32 位或带横线，例如 069a79f444e94726a5befca90e38aaf5"
                          title="Mojang 正版账号的 UUID。不能填玩家名 —— 官方的名字→UUID 接口已废弃"
                        />
                        <button
                          onClick={() => void importOfficialByUuid()}
                          disabled={officialImporting || officialUuid.trim() === ''}
                          className="mc-btn"
                        >
                          {officialImporting ? (
                            <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Download className="mr-1 h-3.5 w-3.5" />
                          )}
                          导入正版皮肤
                        </button>
                      </div>

                      {/* 详情：整块替换掉浏览列表（与 mod 侧点行进详情一致） */}
                      {skinDetail !== null ? (
                        <SkinDetailView
                          skin={skinDetail}
                          targetInstance={targetInstance}
                          playerNameOk={skinPlayerOk}
                          importing={skinImporting !== null}
                          onBack={() => setSkinDetail(null)}
                          onImport={(id, alsoApply) => void importSkin(id, alsoApply)}
                          onRefresh={() => void loadSkinPage(skinPage)}
                        />
                      ) : (
                        <>
                          <div className="border-b border-mc-border px-3 py-2 text-[10px] text-mc-text-dim">
                            {SKIN_SOURCE_NOTE}
                          </div>

                          {skinError && (
                            <div className="border-b border-mc-border px-3 py-2 text-[11px] text-mc-redstone">
                              {skinError}
                            </div>
                          )}

                          <div className="flex-1 overflow-y-auto p-3">
                            {skinLoading && skinBrowse.length === 0 ? (
                              <div className="py-8 text-center text-xs text-mc-text-dim">
                                加载中…
                              </div>
                            ) : skinBrowse.length === 0 ? (
                              <div className="py-8 text-center text-xs text-mc-text-dim">
                                {skinLoaded ? '这一页没有内容。' : '正在读取…'}
                              </div>
                            ) : (
                              <div className="space-y-2">
                                {skinBrowse.map((s) => (
                                  <div
                                    key={s.id}
                                    role="button"
                                    tabIndex={0}
                                    onClick={() => setSkinDetail(s)}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter' || e.key === ' ') {
                                        e.preventDefault();
                                        setSkinDetail(s);
                                      }
                                    }}
                                    aria-label={`查看皮肤 #${s.id} 的详情`}
                                    className="mc-card flex cursor-pointer items-center gap-3 p-3 text-left transition-colors hover:bg-mc-hover"
                                  >
                                    {/*
                                  正面预览，不是整张贴图缩略。
                                  皮肤贴图左上角是全透明的帽子层，直接缩略
                                  出来就是一堆噪声（见 skin-preview.shared.ts 头注）。
                                  点这一行可以进详情看 3D（模型自动判 slim/classic）。
                                */}
                                    <SkinFrontPreview
                                      url={s.textureUrl}
                                      alt={`MineSkin #${s.id} 的正面预览`}
                                    />
                                    <span className="min-w-0 flex-1 text-xs">#{s.id}</span>
                                    <button
                                      onClick={(e) => {
                                        // 行本身可点（进详情），按钮必须阻断冒泡 ——
                                        // 否则「导入」会连带把详情也打开，两个动作互相打架
                                        e.stopPropagation();
                                        void importSkin(s.id, false);
                                      }}
                                      disabled={skinImporting !== null}
                                      className="mc-btn-ghost shrink-0"
                                      aria-label={`导入皮肤 #${s.id}`}
                                      title="存进皮肤库（不应用）"
                                    >
                                      {skinImporting === s.id ? (
                                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                      ) : (
                                        <Download className="h-3.5 w-3.5" />
                                      )}
                                    </button>
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        void importSkin(s.id, true);
                                      }}
                                      disabled={
                                        skinImporting !== null ||
                                        !skinPlayerOk ||
                                        targetInstance === ''
                                      }
                                      className="mc-btn-primary shrink-0"
                                      aria-label={`导入并应用皮肤 #${s.id}`}
                                      title={
                                        targetInstance === ''
                                          ? '请先选择一个实例'
                                          : !skinPlayerOk
                                            ? '请先填一个合法的玩家名'
                                            : '存进皮肤库，并复制到该实例的 LocalSkin/skins/'
                                      }
                                    >
                                      导入并应用
                                    </button>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        </>
                      )}
                    </>
                  ) : (
                    <>
                      {/* 搜索栏 + 筛选器 */}
                      {/* 筛选栏：对齐 PCL 的「名称 / 版本 / 来源 / 类型」。
                    注意：没有加载器和排序下拉。PCL 也没有——加载器在详情页
                    里按 loader 分组展开，列表只给你看「项目支持哪些 loader」。搜索层再加一个
                    加载器筛选，就会越过「哪个版本适合当前 loader」这个信息丢掉。 */}
                      <div className="space-y-2 border-b border-mc-border px-3 py-2">
                        <div className="flex items-center gap-2">
                          <Search className="h-3.5 w-3.5 shrink-0 text-mc-text-dim" />
                          <input
                            type="text"
                            value={modQuery}
                            onChange={(e) => {
                              setModQuery(e.target.value);
                              setModPage(0);
                            }}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                setModPage(0);
                                void loadMods(false);
                              }
                            }}
                            placeholder="搜索… （中文也可以）"
                            className="mc-input min-w-0 flex-1"
                            aria-label="名称"
                            title="搜中文时会先用 MC百科 查出对应的英文项目名，再去 Modrinth / CurseForge 搜"
                          />
                          <button
                            onClick={() => {
                              setModPage(0);
                              void loadMods(false);
                            }}
                            disabled={modLoading}
                            className="mc-btn-primary shrink-0"
                          >
                            搜索
                          </button>
                          <button
                            onClick={() => {
                              // 重置条件：清空关键词 + 筛选并重跑第一页。
                              // 不转回 vanilla 分类，那是另一个页面的事。
                              setModQuery('');
                              setModGameVersion('');
                              setModLoader('');
                              setModSource('all');
                              setModCategory('');
                              setModPage(0);
                              void loadMods(false);
                            }}
                            disabled={modLoading}
                            className="mc-btn-ghost shrink-0"
                          >
                            重置条件
                          </button>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          {cnAliasHint && (
                            <span
                              className="shrink-0 text-[10px] text-mc-text-dim"
                              title="Modrinth / CurseForge 只有英文名，这个中文名来自 MC百科"
                            >
                              {cnAliasHint}
                            </span>
                          )}
                          <select
                            value={modLoader}
                            onChange={(e) => {
                              setModLoader(e.target.value);
                              setModPage(0);
                            }}
                            className="mc-select w-28"
                            aria-label="加载器"
                            title="加载器"
                          >
                            <option value="">全部加载器</option>
                            {/* 只列 NeoForge + Fabric。清单与依据在
                          `shared/play-loaders.ts`（含「为什么只有两个」的实测数据），
                          这里只管渲染 —— 同一件事写在两个地方就会各漂各的。 */}
                            {PLAY_LOADER_FILTERS.map((l) => (
                              <option key={l} value={l}>
                                {sourceLoaderLabel(l)}
                              </option>
                            ))}
                          </select>
                          <input
                            type="text"
                            value={modGameVersion}
                            onChange={(e) => {
                              setModGameVersion(e.target.value);
                              setModPage(0);
                            }}
                            list="mod-game-version-options"
                            className="mc-input w-36"
                            aria-label="版本"
                            placeholder="全部版本"
                            title="可直接输入版本号（例如 26.3）；下拉里是常用版本和现有实例的版本"
                          />
                          <datalist id="mod-game-version-options">
                            {modVersionSuggestions.map((v) => (
                              <option key={v} value={v} />
                            ))}
                          </datalist>
                          <select
                            value={modSource}
                            onChange={(e) => {
                              setModSource(e.target.value as 'all' | 'modrinth' | 'curseforge');
                              setModPage(0);
                            }}
                            className="mc-select w-28"
                            aria-label="来源"
                            title="来源"
                          >
                            <option value="all">全部</option>
                            <option value="curseforge">CurseForge</option>
                            <option value="modrinth">Modrinth</option>
                          </select>
                          {/* 选了 CurseForge 但没配 key → 就地说明，不再让用户去猜。
                        默认「全部」**不提示**：Modrinth 匿名可用、实测 16.3 万项目，
                        单它就够日常用，没必要让默认路径看起来是残缺的。 */}
                          {modSource === 'curseforge' && !cfConfigured && (
                            <div
                              role="status"
                              className="flex w-full items-center gap-2 rounded-mc border border-mc-border bg-mc-surface-2 px-3 py-1.5 text-[11px] text-mc-text-dim"
                            >
                              <AlertTriangle className="h-3 w-3 shrink-0" />
                              <span className="flex-1">
                                没配 CurseForge API Key —— 仍然能搜：走国内镜像时用的是镜像自己的
                                key（PCL 同款）。想让流量只走官方源就去
                                <a
                                  href="https://console.curseforge.com/"
                                  target="_blank"
                                  rel="noreferrer"
                                  className="mx-1 text-mc-accent hover:underline"
                                >
                                  console.curseforge.com
                                </a>
                                免费申请后填到「设置 → CurseForge」（key 只会发给官方地址）。
                              </span>
                            </div>
                          )}
                          <select
                            value={modCategory}
                            onChange={(e) => {
                              setModCategory(e.target.value);
                              setModPage(0);
                            }}
                            className="mc-select w-28"
                            aria-label="类型"
                            // 这一筛选用的是 **Modrinth 的分类键**（下面前 8 个）：
                            // 主进程把它拼进 Modrinth 的 facets。CurseForge 那边要的是
                            // 它自己的数字分类 id（`categoryId`），和这些键不是一套 ——
                            // 没有一个不用猜的映射，所以这里只对 Modrinth 生效。
                            title="按 Modrinth 分类筛选（对 Modrinth 生效）"
                          >
                            <option value="">全部</option>
                            {/* value 必须是源站的英文分类键 —— API 只认英文，中文只做展示 */}
                            <option value="worldgen">世界元素</option>
                            <option value="biomes">生物群系</option>
                            <option value="dimensions">维度</option>
                            <option value="ores">矿物与资源</option>
                            <option value="structures">天然结构</option>
                            <option value="technology">科技</option>
                            <option value="transportation">管道与物流</option>
                            <option value="automation">自动化</option>
                            <option value="energy">能源</option>
                            <option value="redstone">红石</option>
                            <option value="food">食物与烹饪</option>
                            <option value="farming">农业</option>
                            <option value="game-mechanics">游戏机制</option>
                          </select>
                        </div>
                      </div>

                      {/* 搜索结果 */}
                      <div className="flex-1 overflow-y-auto p-3 space-y-2">
                        {/* 部分源不可用：有结果时只作**提示条**，不遮住列表。
                        （缺 CurseForge key 时 results 仍来自 Modrinth，
                          用红色错误块会把还能用的那一半也一起废掉。） */}
                        {modError && modResults.length > 0 && (
                          <div
                            role="status"
                            className="flex items-start gap-2 rounded-mc border border-mc-border bg-mc-surface-2 px-3 py-2 text-[11px] text-mc-text-dim"
                          >
                            <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                            <span className="flex-1">{modError}</span>
                            <button
                              onClick={() => setModError(null)}
                              className="mc-btn-ghost shrink-0"
                              aria-label="关闭提示"
                            >
                              <X className="h-3 w-3" />
                            </button>
                          </div>
                        )}
                        {modLoading && modResults.length === 0 ? (
                          <div className="flex items-center justify-center gap-2 py-8 text-xs text-mc-text-dim">
                            {/*
                              转圈图标：切分类时结果是空的，只写字容易看成"没反应"。
                              有图标至少说明"在动"。
                            */}
                            <Loader2 className="h-4 w-4 animate-spin" />
                            加载中…
                          </div>
                        ) : modError && modResults.length === 0 ? (
                          <div className="rounded-mc border border-mc-redstone/30 bg-mc-redstone/10 px-3 py-2 text-xs text-mc-redstone">
                            {modError}
                          </div>
                        ) : modResults.length === 0 ? (
                          <div className="py-8 text-center text-xs text-mc-text-dim">
                            没有找到结果，试试换个关键词或筛选条件
                          </div>
                        ) : (
                          <>
                            {/*
                              「正在刷新」放在结果**内部**而不是替换掉结果：
                              替换的话翻页（加载中但有结果）时整个列表会消失一下，看着像点错了。
                              放顶部当横幅，列表始终在位。
                            */}
                            {modLoading && (
                              <div className="flex items-center gap-2 pb-2 text-[10px] text-mc-text-dim">
                                <Loader2 className="h-3 w-3 animate-spin" />
                                正在刷新…
                              </div>
                            )}
                            {/* 标题区分「浏览」与「搜索」：空关键词时列的是该分类的
                            热门内容（PCL 切标签就是这个效果），有关键词才是搜索结果。 */}
                            <div className="text-[10px] text-mc-text-dim">
                              {modQuery.trim() === ''
                                ? `${CATEGORIES.find((c) => c.id === activeCategory)?.label ?? '内容'} · 按下载量排序，共 ${modTotal} 个`
                                : `找到 ${modTotal} 个与「${modQuery.trim()}」相关的结果`}
                            </div>
                            {modResults.map((mod) => {
                              const tags = (mod.categories ?? []).slice(0, 1);
                              const vr = versionRange(mod.gameVersions);
                              const loaders = mod.loaders.map(sourceLoaderLabel);
                              const ago = formatAgo(mod.updatedAt);
                              return (
                                <div
                                  key={mod.id}
                                  role="button"
                                  tabIndex={0}
                                  onClick={() => setDetailEntry(mod)}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter' || e.key === ' ') {
                                      e.preventDefault();
                                      setDetailEntry(mod);
                                    }
                                  }}
                                  className="mc-card flex w-full cursor-pointer items-center gap-3 p-3 text-left transition-colors hover:bg-mc-hover"
                                  aria-label={`查看 ${mod.name} 的详情`}
                                >
                                  {mod.iconUrl ? (
                                    <img
                                      src={mod.iconUrl}
                                      alt=""
                                      loading="lazy"
                                      className="h-10 w-10 shrink-0 rounded-mc object-cover"
                                    />
                                  ) : (
                                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-mc bg-mc-surface">
                                      <Package className="h-5 w-5 text-mc-text-dim" />
                                    </div>
                                  )}
                                  <div className="min-w-0 flex-1">
                                    <div className="flex items-center gap-1.5">
                                      <span className="truncate text-xs font-medium text-mc-text">
                                        {mod.name}
                                      </span>
                                      {tags.map((t) => (
                                        <span
                                          key={t}
                                          className="mc-tag shrink-0 text-[9px] bg-mc-accent/15 text-mc-accent"
                                          title={t}
                                        >
                                          {categoryLabel(t)}
                                        </span>
                                      ))}
                                    </div>
                                    {mod.summary && (
                                      <p className="mt-0.5 line-clamp-1 text-[10px] text-mc-text-dim">
                                        {mod.summary}
                                      </p>
                                    )}
                                    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[9px] text-mc-text-dim">
                                      {(loaders.length > 0 || vr) && (
                                        <span className="text-mc-text">
                                          {loaders.join(' / ')}
                                          {loaders.length > 0 && vr ? ' ' : ''}
                                          {vr}
                                        </span>
                                      )}
                                      {mod.downloads !== undefined && (
                                        <span>{formatDownloads(mod.downloads)} 下载</span>
                                      )}
                                      {ago && <span>{ago}</span>}
                                      <span
                                        className={
                                          mod.source === 'modrinth'
                                            ? 'text-mc-green'
                                            : 'text-mc-orange'
                                        }
                                      >
                                        {mod.source === 'modrinth' ? 'Modrinth' : 'CurseForge'}
                                      </span>
                                    </div>
                                  </div>
                                  <button
                                    onClick={() =>
                                      // 有 downloadUrl 就直接下**已按当前版本筛选挑好**的那一个文件。
                                      // 没有（补拉失败）才退回按 modId 让主进程解析最新版。
                                      // 两条路都会带上 modId —— URL 那条靠它解析前置。
                                      mod.downloadUrl
                                        ? void doDownloadFile(
                                            mod.downloadUrl,
                                            filenameFromUrl(mod.downloadUrl),
                                            mod.name,
                                            mod.id,
                                            // 搜索行也带 sha1（主进程从版本主文件填的）
                                            mod.sha1 === undefined ? undefined : { sha1: mod.sha1 },
                                          )
                                        : void doDownloadMod(mod)
                                    }
                                    disabled={modDownloading !== null || !canDownloadHere}
                                    className="mc-btn-ghost flex-shrink-0"
                                    aria-label={`下载 ${mod.name}`}
                                    title={
                                      !canDownloadHere
                                        ? modTargetIsVanilla
                                          ? '原版实例不会加载 mod，请改选 Fabric / NeoForge 实例'
                                          : activeCategory === 'datapack' &&
                                              targetInstance !== '' &&
                                              targetWorld === ''
                                            ? '数据包必须先选一个世界'
                                            : '还没有可安装的实例'
                                        : mod.latestVersion
                                          ? `下载 ${mod.latestVersion}`
                                          : `下载 ${mod.name}`
                                    }
                                  >
                                    {modDownloading === mod.id ? (
                                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                    ) : (
                                      <Download className="h-3.5 w-3.5" />
                                    )}
                                  </button>
                                </div>
                              );
                            })}
                            {/* 加载更多：追加式而非翻页式。PCL 往下滚就能取到更多，
                    不是“翻一页就把前面挤掉”。modResults.length < modTotal 才显示，
                    数据都提了但只有一页时不显示，避免给人一个按了没反应的按钮。 */}
                            {modResults.length < modTotal && (
                              <div className="flex items-center justify-center gap-2 pt-2">
                                <button
                                  onClick={() => {
                                    const next = modPage + 1;
                                    setModPage(next);
                                    // 页码显式传进去（不走 ref 的默认值）：此时
                                    // setModPage 还没生效，默认值会是旧页码。
                                    void loadMods(true, next);
                                  }}
                                  disabled={modLoading}
                                  className="mc-btn-ghost"
                                >
                                  {modLoading ? (
                                    <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                                  ) : null}
                                  加载更多
                                </button>
                                <span className="text-[10px] text-mc-text-dim">
                                  已加载 {modResults.length} / {modTotal}
                                </span>
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    </>
                  )}
                </>
              )}
            </>
          )}

          {/* 整合包安装进度。整合包要走「新建实例 → 装加载器 → 下 55 个文件」，
              实测好几分钟；没有进度条的话用户会以为按钮坏了。 */}
          {modpackInstalling !== null && (
            <section className="mc-card m-3 px-3 py-2" aria-label="整合包安装进度">
              <div className="mb-1 flex items-center justify-between text-[11px]">
                <span className="flex min-w-0 items-center gap-1">
                  <Package className="h-3 w-3 shrink-0" />
                  <span className="truncate">
                    {modpackCancelling
                      ? '正在取消安装…'
                      : modpackProgress?.current
                        ? `正在处理：${modpackProgress.current}`
                        : MODPACK_STAGE_LABEL[modpackProgress?.stage ?? 'resolve']}
                  </span>
                </span>
                <span className="shrink-0 text-mc-text-dim">
                  {modpackProgress && modpackProgress.total > 0
                    ? `${modpackProgress.done} / ${modpackProgress.total}`
                    : ''}
                </span>
              </div>
              <div className="h-1 w-full overflow-hidden rounded bg-mc-border">
                <div
                  className="h-full bg-mc-accent transition-all"
                  style={{
                    width:
                      modpackProgress && modpackProgress.total > 0
                        ? `${Math.round((modpackProgress.done / modpackProgress.total) * 100)}%`
                        : '30%',
                  }}
                />
              </div>
              <div className="mt-1 flex items-end justify-between gap-2">
                <p className="text-[10px] text-mc-text-dim">
                  会用一个以整合包名字命名的实例（同名同版本 =
                  重装覆盖）并安装对应加载器。可以随时取消，已下载的文件会保留。
                </p>
                <button
                  type="button"
                  onClick={() => void cancelModpackInstall()}
                  disabled={modpackCancelling}
                  className="mc-btn-ghost shrink-0 text-[10px] disabled:opacity-50"
                >
                  {modpackCancelling ? (
                    <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                  ) : (
                    <X className="mr-1 h-3 w-3" />
                  )}
                  {modpackCancelling ? '正在取消…' : '取消安装'}
                </button>
              </div>
            </section>
          )}

          {/* 进度：下载动辄几分钟，没有它界面就是死的 */}
          {progress && job && (
            <section className="mc-card px-3 py-2 m-3" aria-label="下载进度">
              <div className="mb-1 flex items-center justify-between text-[11px]">
                <span>
                  {job.id} ·{' '}
                  {job.kind === 'server'
                    ? '服务端'
                    : job.kind === 'instance'
                      ? '创建实例'
                      : '客户端'}{' '}
                  · {STAGE_LABEL[progress.stage] ?? progress.stage}
                </span>
                <span className="text-mc-text-dim">
                  {progress.total > 0 ? `${progress.done} / ${progress.total}` : ''}
                </span>
              </div>
              <div className="h-1 w-full overflow-hidden rounded bg-mc-border">
                <div
                  className="h-full bg-mc-accent transition-all"
                  style={{
                    width:
                      progress.total > 0
                        ? `${Math.round((progress.done / progress.total) * 100)}%`
                        : '100%',
                  }}
                />
              </div>
            </section>
          )}

          {/*
            覆盖安装的确认框（同名 + 同 MC 版本 = 重装同一个整合包）。
            用应用内 Modal：标题、按钮文案都是中文，且不会出现「Electron」窗口。
          */}
          {confirmOverwrite !== null && (
            <ConfirmDialog
              open
              title="重装同名整合包？"
              message=""
              confirmText="覆盖安装"
              cancelText="取消"
              onCancel={() => setConfirmOverwrite(null)}
              onConfirm={() => {
                const versionId = confirmOverwrite.versionId;
                setConfirmOverwrite(null);
                void startModpackInstall(versionId);
              }}
            >
              <p>
                已经有一个叫「{detailEntry?.name ?? ''}」的实例了（MC {confirmOverwrite.mcVersion}，
                {confirmOverwrite.loader}）。
              </p>
              <p className="mt-2">
                继续会把整合包的模组与配置重新铺一遍（重装同一个整合包通常正是想要的）。
                你自己手动放进 mods 的 jar 不会被删，存档也不动。
              </p>
              <p className="mt-2">要继续吗？</p>
            </ConfirmDialog>
          )}

          {/*
            下载原版前的起名弹框。
            校验走 `checkInstanceNameAgainst`：格式非法 / 撞上别的 MC 版本的实例
            都会被**挡住**（不是自动改名 —— 名字就是目录名，改了就对不上）。
          */}
          {namePromptFor !== null && (
            <PromptDialog
              title="给这个实例起个名字"
              message={`名字同时用作磁盘目录名（game/<名字>/）。要下载的是 MC ${namePromptFor}。`}
              defaultValue={namePromptFor}
              confirmLabel="开始下载"
              validate={(v) => checkInstanceNameAgainst(v, namePromptFor, instances)}
              onClose={() => setNamePromptFor(null)}
              onConfirm={(name) => void startDownload(namePromptFor, name)}
            />
          )}
        </div>
      </div>
    </div>
  );
}
