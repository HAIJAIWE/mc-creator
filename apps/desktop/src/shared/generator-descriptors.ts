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
   * 该类型是否依赖 loader（fabric/neoforge/…）。
   * 供 UI 判断是否需要展示 loader 选择，目前作为元数据保留。
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
    needsLoader: true,
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
    needsLoader: true,
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
    needsLoader: true,
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
    needsLoader: true,
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
