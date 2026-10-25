/**
 * 生成器类型描述符注册表（WP5：单一数据源）。
 *
 * 背景：`GeneratorType` 的显示名 / 说明 / 图标 / 输入框占位文案，过去散落在
 * renderer 与 main 两侧共 8 处平行映射里（Dashboard / TopToolbar / AgentPanel /
 * chat-system-message …），新增一种类型要改 8 个文件，且极易漏改——例如
 * `chat-system-message.ts` 的标签表就只覆盖了 13 种里的 7 种。
 *
 * 现在统一收敛到这里：所有消费方都从 `GENERATOR_DESCRIPTORS` 取值。
 *
 * 放在 `src/shared/` 是因为 main 与 renderer 都要引用（两边的 tsconfig include 均含此目录）。
 *
 * 注意：`GENERATOR_TYPES`（ipc-channels.ts）仍是类型联合的唯一来源，
 * 本文件的 `satisfies Record<GeneratorType, GeneratorDescriptor>` 保证漏掉任一类型即编译失败。
 */

import type { GENERATOR_TYPES, GeneratorType } from './ipc-channels.js';
import { LOADERS, type Loader } from '@mc-creator/shared';

/**
 * 生成器下拉里**实际开放选择**的加载器。
 *
 * 产品决策（用户拍板）：只留 Fabric + NeoForge，与启动器侧的加载器支持保持一致。
 *
 * 早先这里是各 UI 手写的字面量，两处各漂各的：`ProjectCreateDialog` 给 6 个
 * （含 `vanilla` —— 而 ModGenerator 没有 vanilla adapter，选完直接抛
 * "does not support loader: vanilla"）；`SettingsPanel` 给 4 个，却漏了
 * 有可用 adapter 的 `forge`。现在统一收到这里。
 *
 * ⚠️ 与 `ModGenerator.loaders` 的区别：那边是**生成器能力**
 * （fabric/neoforge/quilt/legacy_fabric/forge，五个都有真实 adapter），
 * 这里是**产品开放给用户的范围**。范围窄于能力是允许的，反过来不行 ——
 * 同目录的测试断言这里的每一项都在生成器能力里，某个加载器真被移出
 * 生成器时那条测试会立刻红。
 */
export const SUPPORTED_GENERATOR_LOADERS: readonly Loader[] = ['fabric', 'neoforge'];

/** 全部 loader 取值。直接取 `@mc-creator/shared` 的 `LOADERS`，不再手抄一份。 */
const ALL_LOADERS: readonly Loader[] = LOADERS;

/**
 * 加载器展示名。
 *
 * 用 `satisfies Record<Loader, string>` 而不是 `Record<Loader, string>` 注解：
 * 将来 `@mc-creator/shared` 新增 loader 时这里**编译失败**，逼着起名。
 * 否则新项会掉到「显示原始枚举值」的分支，用户看到 `legacy_fabric` 这种字串。
 */
const GENERATOR_LOADER_LABELS = {
  fabric: 'Fabric',
  neoforge: 'NeoForge',
  quilt: 'Quilt',
  legacy_fabric: 'Legacy Fabric',
  forge: 'Forge',
  vanilla: '原版',
} as const satisfies Record<Loader, string>;

/** 该 loader 当前是否开放选择。 */
export function isGeneratorLoaderSupported(loader: string): boolean {
  return (SUPPORTED_GENERATOR_LOADERS as readonly string[]).includes(loader);
}

/**
 * 是不是「认识但已不开放」的 loader。
 *
 * 用于把历史项目的旧值在下拉里显式列出来（标为禁用），而不是过滤掉 ——
 * 过滤掉会让 select 的 value 落在列表外、显示空白，用户既看不到它是什么
 * 也改不回来。
 */
export function isKnownButUnsupportedLoader(loader: string): loader is Loader {
  return (ALL_LOADERS as readonly string[]).includes(loader) && !isGeneratorLoaderSupported(loader);
}

/** 加载器展示名；未知值原样返回（比显示空白好）。 */
export function loaderLabel(loader: string): string {
  return Object.prototype.hasOwnProperty.call(GENERATOR_LOADER_LABELS, loader)
    ? GENERATOR_LOADER_LABELS[loader as keyof typeof GENERATOR_LOADER_LABELS]
    : loader;
}

/** 加载器下拉的一项 */
export interface GeneratorLoaderOption {
  value: string;
  label: string;
  disabled: boolean;
}

/**
 * 构造「项目加载器」下拉的选项列表。
 *
 * 至少三处在用，且它们读写的**是同一个 store 字段**（`mod-store` 的 `loader`）——
 * 列表本来就必须一致，但历史上各自手写，结果各漂各的：
 * `ProjectCreateDialog` 给 6 个（含会抛错的 `vanilla`），`SettingsPanel` 给 4 个
 * （漏了有 adapter 的 `forge`），`CiCdPanel` 给 4 个（又漏了 `vanilla` /
 * `legacy_fabric`）—— 后两个连「原版项目」都显示不出来。现在都从这里取。
 *
 * `current` 传当前值：若它是个「认识但已不开放」的旧加载器，会**补一个禁用项**，
 * 而不是让它落到列表外。否则 select 的 value 不在选项里，浏览器显示空白 ——
 * 用户既看不出项目用的什么，也无从改回来（而重选一个会**改变生成产物**，
 * 只能由用户自己决定）。
 */
export function generatorLoaderOptions(current: string): GeneratorLoaderOption[] {
  const options: GeneratorLoaderOption[] = SUPPORTED_GENERATOR_LOADERS.map((l) => ({
    value: l,
    label: loaderLabel(l),
    disabled: false,
  }));
  if (isKnownButUnsupportedLoader(current)) {
    options.push({
      value: current,
      label: `${loaderLabel(current)}（已不在支持列表）`,
      disabled: true,
    });
  }
  return options;
}

/** 中英双语文案（本项目面向中文玩家，同时提供英文） */
export interface LocalizedText {
  zh: string;
  en: string;
}

/** 生成器图标：McIcon 的 scope + 素材名（与 renderer 的 McAssetScope 对齐） */
export interface GeneratorIcon {
  scope: 'pixel' | 'game' | 'mob';
  name: string;
}

/** 一种生成器类型的全部展示元数据 */
export interface GeneratorDescriptor {
  type: GeneratorType;
  /** 工具栏下拉 / 卡片标题的简短名称 */
  label: LocalizedText;
  /** 首页空态卡片的一句话说明 */
  description: LocalizedText;
  /** 像素图标 */
  icon: GeneratorIcon;
  /** 描述输入框占位文案 */
  promptPlaceholder: LocalizedText;
  /**
   * 该类型是否用得上工具栏的 loader 选择。
   *
   * 判定依据是可验证的事实 —— 只有 `ModGenerator` 读取 `ctx.loader`
   * （见 packages/core/src/generators/mod/mod-generator.ts）：ModGenerator 按它路由
   * LoaderAdapter，直接决定产物。其余类型要么用 spec 自带的 `loader` 字段
   * （ModpackSpec / LauncherSpec），要么完全不涉及 loader（数据包/资源包/皮肤/
   * 基岩版/附魔/服务器/KubeJS/CraftTweaker）。
   *
   * 因此 UI 只需为 `mod` 开放 loader 下拉，其余类型下拉置灰。
   */
  needsLoader: boolean;
}

/**
 * 13 种生成器类型的描述符。
 *
 * 用 `satisfies` 而非类型注解：既能对每一项做完整类型检查，
 * 又能保证键集合恰好等于 `GeneratorType`（漏一个或写错一个 → 编译失败）。
 */
export const GENERATOR_DESCRIPTORS = {
  mod: {
    type: 'mod',
    label: { zh: '模组', en: 'Mod' },
    description: { zh: '创建 Fabric/NeoForge 模组', en: 'Create Fabric/NeoForge mods' },
    icon: { scope: 'pixel', name: 'gen-mod' },
    promptPlaceholder: { zh: '描述你想要的 mod…', en: 'Describe the mod you want…' },
    needsLoader: true,
  },
  datapack: {
    type: 'datapack',
    label: { zh: '数据包', en: 'Datapack' },
    description: { zh: '创建自定义数据包', en: 'Create custom datapacks' },
    icon: { scope: 'pixel', name: 'gen-datapack' },
    promptPlaceholder: { zh: '描述你想要的数据包…', en: 'Describe the datapack you want…' },
    needsLoader: false,
  },
  modpack: {
    type: 'modpack',
    label: { zh: '整合包', en: 'Modpack' },
    description: { zh: '创建整合包配置', en: 'Create modpack configuration' },
    icon: { scope: 'pixel', name: 'gen-modpack' },
    promptPlaceholder: { zh: '描述你想要的整合包…', en: 'Describe the modpack you want…' },
    needsLoader: false,
  },
  server: {
    type: 'server',
    label: { zh: '服务器', en: 'Server' },
    description: { zh: '创建服务器配置', en: 'Create server configuration' },
    icon: { scope: 'pixel', name: 'gen-server' },
    promptPlaceholder: {
      zh: '描述你想要的服务器配置…',
      en: 'Describe the server configuration you want…',
    },
    needsLoader: false,
  },
  resource_pack: {
    type: 'resource_pack',
    label: { zh: '资源包', en: 'Resource Pack' },
    description: { zh: '创建资源包', en: 'Create resource packs' },
    icon: { scope: 'pixel', name: 'gen-resource' },
    promptPlaceholder: { zh: '描述你想要的资源包…', en: 'Describe the resource pack you want…' },
    needsLoader: false,
  },
  skin: {
    type: 'skin',
    label: { zh: '皮肤', en: 'Skin' },
    description: { zh: '创建玩家皮肤', en: 'Create player skins' },
    icon: { scope: 'pixel', name: 'gen-skin' },
    promptPlaceholder: { zh: '描述你想要的皮肤…', en: 'Describe the skin you want…' },
    needsLoader: false,
  },
  launcher: {
    type: 'launcher',
    label: { zh: '启动器', en: 'Launcher' },
    description: { zh: '创建启动器配置', en: 'Create launcher profiles' },
    icon: { scope: 'pixel', name: 'gen-launcher' },
    promptPlaceholder: {
      zh: '描述你想要的启动器配置…',
      en: 'Describe the launcher profile you want…',
    },
    needsLoader: false,
  },
  kubejs: {
    type: 'kubejs',
    label: { zh: 'KubeJS', en: 'KubeJS' },
    description: { zh: '创建 KubeJS 脚本', en: 'Create KubeJS scripts' },
    icon: { scope: 'pixel', name: 'gen-kubejs' },
    promptPlaceholder: {
      zh: '描述你想要的 KubeJS 脚本…',
      en: 'Describe the KubeJS script you want…',
    },
    needsLoader: false,
  },
  crafttweaker: {
    type: 'crafttweaker',
    label: { zh: 'CraftTweaker', en: 'CraftTweaker' },
    description: { zh: '创建 ZenScript 脚本', en: 'Create ZenScript scripts' },
    icon: { scope: 'pixel', name: 'gen-crafttweaker' },
    promptPlaceholder: {
      zh: '描述你想要的 CraftTweaker 脚本…',
      en: 'Describe the CraftTweaker script you want…',
    },
    needsLoader: false,
  },
  behavior_pack: {
    type: 'behavior_pack',
    label: { zh: '行为包', en: 'Behavior Pack' },
    description: { zh: '创建基岩版行为包', en: 'Create Bedrock behavior packs' },
    icon: { scope: 'pixel', name: 'gen-behaviorpack' },
    promptPlaceholder: { zh: '描述你想要的行为包…', en: 'Describe the behavior pack you want…' },
    needsLoader: false,
  },
  enchantment: {
    type: 'enchantment',
    label: { zh: '附魔', en: 'Enchantment' },
    description: { zh: '创建数据驱动附魔（1.21+）', en: 'Create data-driven enchantments (1.21+)' },
    icon: { scope: 'pixel', name: 'gen-enchantment' },
    promptPlaceholder: { zh: '描述你想要的附魔…', en: 'Describe the enchantment you want…' },
    needsLoader: false,
  },
  behavior_item: {
    type: 'behavior_item',
    label: { zh: '行为包物品', en: 'Behavior Item' },
    description: { zh: '创建基岩版自定义物品', en: 'Create Bedrock custom items' },
    icon: { scope: 'pixel', name: 'gen-behavioritem' },
    promptPlaceholder: {
      zh: '描述你想要的自定义物品…',
      en: 'Describe the custom item you want…',
    },
    needsLoader: false,
  },
  behavior_entity: {
    type: 'behavior_entity',
    label: { zh: '行为包实体', en: 'Behavior Entity' },
    description: { zh: '创建基岩版自定义实体', en: 'Create Bedrock custom entities' },
    icon: { scope: 'pixel', name: 'gen-behaviorentity' },
    promptPlaceholder: {
      zh: '描述你想要的自定义怪物…',
      en: 'Describe the custom mob you want…',
    },
    needsLoader: false,
  },
  skinpack: {
    type: 'skinpack',
    label: { zh: '基岩皮肤包', en: 'Bedrock Skin Pack' },
    description: {
      zh: '创建基岩版皮肤包（manifest + skins.json + 贴图 + 语言文件）',
      en: 'Create Bedrock skin pack (manifest + skins.json + textures + lang)',
    },
    icon: { scope: 'pixel', name: 'gen-skinpack' },
    promptPlaceholder: {
      zh: '描述你想要的皮肤包（如：骑士主题，含披风）…',
      en: 'Describe the skin pack you want (e.g. knight theme with cape)…',
    },
    needsLoader: false,
  },
} satisfies Record<GeneratorType, GeneratorDescriptor>;

/**
 * 按类型取描述符。
 *
 * 入参为 `string`（如 IPC 传来的原始字符串），未知类型返回 `undefined`，
 * 由调用方决定回退文案。
 */
export function getGeneratorDescriptor(type: string): GeneratorDescriptor | undefined {
  if (!Object.prototype.hasOwnProperty.call(GENERATOR_DESCRIPTORS, type)) return undefined;
  return GENERATOR_DESCRIPTORS[type as GeneratorType];
}

/** 从双语文案按当前语言取值（非中文一律取英文） */
export function pickLocalized(text: LocalizedText, locale: string): string {
  return locale.startsWith('zh') ? text.zh : text.en;
}

/** 编译期对齐检查：描述符键集合必须与 GENERATOR_TYPES 完全一致 */
type _AssertDescriptorKeysMatch =
  (typeof GENERATOR_TYPES)[number] extends keyof typeof GENERATOR_DESCRIPTORS
    ? keyof typeof GENERATOR_DESCRIPTORS extends (typeof GENERATOR_TYPES)[number]
      ? true
      : never
    : never;
const _descriptorKeysAligned: _AssertDescriptorKeysMatch = true;
void _descriptorKeysAligned;

// Re-export GENERATOR_TYPES for consumers
export { GENERATOR_TYPES } from './ipc-channels.js';
