/**
 * §0.2「三域并列 + 智能体横向贯穿」—— 域定义与面板归属**唯一真源**
 *
 * ## 为什么要这份文件
 *
 * F1 之前，导航层只有 `PanelKind`（core / domain / middle）这一个粗粒度分组：
 * core 是活动栏那 5 个基础设施项，domain 是「所有内容编辑器」，middle 是「没有独立左侧入口的功能」。
 * 这套划分回答的是「这个面板长在哪」，不是「用户在做什么」，所以
 * `game`（启动器）、`kernel`/`nbt`（服务端）、`items`（MC 开发）被塞进同一个 domain 组，
 * 用户在「启动一个游戏」和「写一个物品配方」之间切换时看不出自己在换职责。
 *
 * §0.2 把产品职责重切成三个并列域 + 一个横向贯穿的智能体：
 *
 * | 域         | 中文显示名 | 一句话职责         | 回答的问题                    |
 * | ---------- | ---------- | ------------------ | ----------------------------- |
 * | `launcher` | 启动器     | 把内容跑起来       | 我要让它动起来 / 玩起来        |
 * | `server`   | 服务器     | 长期运行形态       | 我要它一直开着、当生产环境用  |
 * | `dev`      | MC 开发    | 产出内容本身       | 我要造出内容本身（物品/方块…）|
 *
 * 智能体（右侧 AgentPanel）**不属于任何域**：它在三域里都常驻、都可用，所以是横向贯穿的那一根轴。
 *
 * ## 面板为什么这么归（不是按「像不像编辑器」分）
 *
 * 依据是设计文档 §5/§6/§7 对内核职责的划分 —— 每个域对应一套内核链路，归属由「这个面板服务哪条链路」决定：
 *
 * - **launcher**：`game`（拉客户端 + 启动进程）、`packages`（往实例的 mods/ 目录装依赖）、
 *   `skin`（离线皮肤，属于实例外观而非内容产物）。三者都作用在**一个要被跑起来的实例**上。
 * - **server**：`kernel`（§10 只读链路验证屏，服务端侧的链路自检）、`resources`（资源包校验）、
 *   `nbt`（世界/实体数据的低层读写）。三者都作用在**一个要长期运行的服务端实例**上。
 * - **dev**：`items` / `blocks` / `entity` / `audio`（内容编辑器本体）、`cicd`（构建与产出流水线）、
 *   `preview`（内容预览）。三者都作用在**产出的内容本身**上。
 * - **common**（跨域常驻，不属于任何域）：`explorer` / `search` / `git`（文件与版本基础设施）、
 *   `settings`（全局配置）。换域不该把它们藏起来，也不该让它们参与「切域后落到默认面板」的判定。
 *
 * 反例（说明为什么不能按外观分）：`packages` 在 PanelKind 里是 core（基础设施），但它的实际操作对象
 * 是实例目录，所以归 launcher；`preview` 在 PanelKind 里是 middle，但它预览的是内容产物，所以归 dev。
 * **归属与 PanelKind 正交** —— 这也是本文件独立存在、而不是把域塞进 PanelKind 的原因（详见 panels.tsx 头注释）。
 *
 * 本文件是纯数据 + 纯函数，不 import 面板注册表，所以单测不需要先跑 registerAllPanels()。
 */

/** 域 ID（三域并列）。刻意与 PanelKind 分开 —— 见文件头「面板为什么这么归」最后一段。 */
export type DomainId = 'launcher' | 'server' | 'dev';

/** 域顺序 = 顶部切换器从左到右的顺序 */
export const DOMAIN_IDS: readonly DomainId[] = ['launcher', 'server', 'dev'];

/** 域定义 */
export interface DomainDefinition {
  /** 域 ID */
  readonly id: DomainId;
  /** 中文显示名（真源；i18n 的 domains.<id> 必须与它一致，由 domains.test.ts 守住） */
  readonly labelZh: string;
  /** 一句话职责（中文真源） */
  readonly summaryZh: string;
  /** 显示名的 i18n key */
  readonly labelKey: string;
  /** 职责的 i18n key */
  readonly summaryKey: string;
  /** 切到本域且当前面板不适用时，落到的默认面板（**保证属于本域**，见 defaultPanelOfDomain） */
  readonly defaultPanelId: string;
  /** 本域独占面板（不含 common） */
  readonly panelIds: readonly string[];
}

/**
 * 三域定义表。
 *
 * 覆盖 register-all-panels.ts 的全部 16 个已注册面板 id：
 * launcher 3 + server 3 + dev 6 = 12 个域内面板，common 4 个（explorer/search/git/settings），
 * 合计 16 —— 不重不漏由 domains.test.ts 断言。
 */
export const DOMAINS: readonly DomainDefinition[] = [
  {
    id: 'launcher',
    labelZh: '启动器',
    summaryZh: '把内容跑起来：拉客户端、装依赖、启动游戏实例。',
    labelKey: 'domains.launcher',
    summaryKey: 'domains.summary.launcher',
    // game = 这个域的「门面」：用户说「我要跑起来」时最该看到的就是启动器面板
    defaultPanelId: 'game',
    panelIds: ['game', 'packages', 'skin'],
  },
  {
    id: 'server',
    labelZh: '服务器',
    summaryZh: '长期运行形态：服务端实例、世界数据与资源包的持续运维。',
    labelKey: 'domains.server',
    summaryKey: 'domains.summary.server',
    // kernel = 服务端链路的自检屏，切进 server 域先看「链路通没通」
    defaultPanelId: 'kernel',
    panelIds: ['kernel', 'resources', 'nbt'],
  },
  {
    id: 'dev',
    labelZh: 'MC 开发',
    summaryZh: '产出内容本身：物品、方块、实体、音效与它们的构建流水线。',
    labelKey: 'domains.dev',
    summaryKey: 'domains.summary.dev',
    // items = 内容编辑器里最基础的一个，作为 MC 开发域门面
    defaultPanelId: 'items',
    panelIds: ['items', 'blocks', 'entity', 'audio', 'cicd', 'preview'],
  },
];

/**
 * 跨域常驻面板：换域不隐藏、不参与「切域后落到默认面板」判定。
 * 依据：explorer/search/git 是文件与版本基础设施，settings 是全局配置 —— 三域都要用。
 */
const COMMON_PANEL_IDS: readonly string[] = ['explorer', 'search', 'git', 'settings'];

/**
 * 全量已注册面板 id 白名单（本任务点名的 16 个）。
 * 只用于「归属表不许偷偷长出/漏掉面板」的完整性断言，以及给未知 id 一个可解释的兜底。
 */
const KNOWN_PANEL_IDS: readonly string[] = [
  ...DOMAINS.flatMap((d) => d.panelIds),
  ...COMMON_PANEL_IDS,
];

/** 域定义表按 id 索引 */
const DOMAIN_BY_ID: ReadonlyMap<DomainId, DomainDefinition> = new Map(
  DOMAINS.map((d) => [d.id, d]),
);

/** 类型守卫：值是否为合法域 ID（用于 store 反序列化时挡掉脏数据） */
export function isDomainId(value: unknown): value is DomainId {
  return typeof value === 'string' && DOMAIN_BY_ID.has(value as DomainId);
}

/** 取域定义（未知 id 抛错 —— 域是编译期字面量联合，跑出未知值说明有 bug） */
export function getDomain(domainId: DomainId): DomainDefinition {
  const def = DOMAIN_BY_ID.get(domainId);
  if (!def) throw new Error(`[domains] 未知域: ${domainId}`);
  return def;
}

/** 该域独占面板 id（不含 common，返回拷贝防外部改写） */
export function panelsOfDomain(domainId: DomainId): readonly string[] {
  return [...getDomain(domainId).panelIds];
}

/** 跨域常驻面板 id（返回拷贝防外部改写） */
export function commonPanelIds(): readonly string[] {
  return [...COMMON_PANEL_IDS];
}

/** 面板是否是跨域常驻面板 */
export function isCommonPanel(panelId: string): boolean {
  return COMMON_PANEL_IDS.includes(panelId);
}

/**
 * 面板归属的域；跨域常驻面板与未知 id 返回 null。
 * 「null = 不属于任何域」是刻意的：切域判定要把 common 与「属于别的域」区分开。
 */
export function domainOfPanel(panelId: string): DomainId | null {
  if (isCommonPanel(panelId)) return null;
  return DOMAINS.find((d) => d.panelIds.includes(panelId))?.id ?? null;
}

/** 该域的默认面板 id —— **保证属于该域**（domains.test.ts 对三域各断言一次） */
export function defaultPanelOfDomain(domainId: DomainId): string {
  return getDomain(domainId).defaultPanelId;
}

/** 面板是否适用于该域（common 视为适用；域内面板适用；其它域的/未知面板不适用） */
export function panelBelongsToDomain(panelId: string, domainId: DomainId): boolean {
  return isCommonPanel(panelId) || domainOfPanel(panelId) === domainId;
}

/**
 * 面板 → PanelKind 的旧分组，仅用于「换域后不选错面板」的兜底提示与调试。
 * 刻意不参与归属判定：归属真源是上面的 DomainDefinition（见文件头）。
 */
/** 全量已注册面板 id（拷贝），供完整性断言/命令面板等复用 */
export function knownPanelIds(): readonly string[] {
  return [...KNOWN_PANEL_IDS];
}

/**
 * 无项目时按域给的空态文案。
 * 三域的「无项目」含义不同 —— launcher 是「还没选实例」、server 是「还没建服务端」、
 * dev 才是「还没打开项目」，所以文案必须分开，否则用户在服务器域点「打开项目」是误导。
 */
export function emptyStateHintOfDomain(domainId: DomainId): string {
  switch (domainId) {
    case 'launcher':
      return '选择或创建一个实例';
    case 'server':
      return '创建一个服务端';
    case 'dev':
      return '打开或新建项目';
  }
}
