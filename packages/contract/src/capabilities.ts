/**
 * 各内核能力声明（§3 EditionCapability）。
 * 薄契约只有类型，此处提供“建议默认值”纯数据函数，不含任何实现，
 * 内核实现时可直接返回本表（允许按需覆盖 supported/note）。
 */

import type { ContentKind, Edition, EditionCapability } from './contract.js';

function all(names: readonly ContentKind[], supported: ContentKind[], notes?: Partial<Record<ContentKind, string>>): EditionCapability[] {
  return names.map((kind) => ({
    kind,
    supported: supported.includes(kind),
    ...(notes?.[kind] ? { note: notes[kind] } : {}),
  }));
}

const ALL_KINDS: readonly ContentKind[] = [
  'game-version', 'java-runtime', 'account', 'cape',
  'instance', 'world', 'world-template',
  'modpack', 'mod', 'resourcepack', 'shader', 'datapack',
  'addon', 'skinpack', 'texturepack',
  'skin', 'soundpack', 'languagepack', 'font', 'structure',
  'server', 'server-config', 'server-plugin', 'proxy', 'proxy-plugin',
  'proxy-config', 'server-backup', 'server-task',
  'mod-project', 'plugin-project', 'build-artifact',
  'dev-toolchain', 'mapping-set', 'test-harness',
];

/** Java 内核：客户端实例（§5）。 */
export function javaCapabilities(): EditionCapability[] {
  return all(
    ALL_KINDS,
    [
      'game-version', 'java-runtime', 'account', 'cape',
      'instance', 'world', 'world-template',
      'modpack', 'mod', 'resourcepack', 'shader', 'datapack',
      'skin', 'soundpack', 'languagepack', 'font', 'structure',
    ],
    {
      skin: 'Java 64×64 classic/slim；基岩 HD/Persona 另见 bedrock',
    },
  );
}

/** Bedrock 内核：内容网关（§6），不做通用文件管理。 */
export function bedrockCapabilities(): EditionCapability[] {
  return all(
    ALL_KINDS,
    ['game-version', 'instance', 'world', 'world-template', 'addon', 'skinpack', 'texturepack', 'skin', 'soundpack', 'languagepack', 'font', 'structure', 'server'],
    {
      server: '仅 BDS / Realms 相关',
      skin: '基岩 skinpack + Persona，HD/Persona 字段见 §21 待核实',
    },
  );
}

/** 服务端内核：长期托管进程（§7）。 */
export function serverCapabilities(): EditionCapability[] {
  return all(
    ALL_KINDS,
    [
      'game-version', 'java-runtime', 'instance', 'world', 'world-template',
      'modpack', 'mod', 'datapack',
      'server', 'server-config', 'server-plugin', 'proxy', 'proxy-plugin',
      'proxy-config', 'server-backup', 'server-task',
    ],
    {
      mod: '服务端形态 Mod（Forge/NeoForge/Fabric 服务端）',
      datapack: '服务端侧数据包装载对象',
    },
  );
}

/** 开发内核 devkit：构建沙箱与工具链（§8）。 */
export function devkitCapabilities(): EditionCapability[] {
  return all(
    ALL_KINDS,
    ['java-runtime', 'mod-project', 'plugin-project', 'build-artifact', 'dev-toolchain', 'mapping-set', 'test-harness'],
  );
}

export function capabilitiesFor(edition: Edition): EditionCapability[] {
  switch (edition) {
    case 'java': return javaCapabilities();
    case 'bedrock': return bedrockCapabilities();
    case 'server': return serverCapabilities();
    case 'devkit': return devkitCapabilities();
  }
}

/**
 * 现有 13 种生成器 → ContentKind 映射（改造保留依据）。
 * 现状 packages/core/src/generators/* 全部可保留，逐步迁入新 generator-* 包：
 * - generator-datapack ← datapack / kubejs / crafttweaker / enchantment（数据驱动）
 * - generator-bedrock ← behavior-pack / behavior-item / behavior-entity
 * - generator-mod ← mod（客户端 Mod，P2，见 §11 阶梯最后）
 * - generator-plugin ← 新增（Paper/Folia，P1 甜点区，现状缺失）
 * - modpack / server / resource-pack / skin / launcher → java 内核内容管理（§5）
 */
export const LEGACY_GENERATOR_TO_KIND = {
  mod: 'mod',
  datapack: 'datapack',
  modpack: 'modpack',
  server: 'server-config',
  resource_pack: 'resourcepack',
  skin: 'skin',
  launcher: 'instance',
  kubejs: 'datapack',
  crafttweaker: 'datapack',
  behavior_pack: 'addon',
  enchantment: 'datapack',
  behavior_item: 'addon',
  behavior_entity: 'addon',
} as const satisfies Record<string, ContentKind>;

/** MCP 权限分级（§10.6）。R=只读免确认 / W=写实例可配置免确认 / X=执行须弹窗。 */
export type PermissionLevel = 'R' | 'W' | 'X';

export const MCP_TOOL_PERMISSIONS: Record<string, PermissionLevel> = {
  get_capabilities: 'R',
  list_versions: 'R',
  get_target_state: 'R',
  read_config: 'R',
  read_logs: 'R',
  search_content: 'R',
  list_instances: 'R',
  list_servers: 'R',
  get_context_pack: 'R',
  validate_content: 'R',
  install_modpack: 'W',
  install_mod: 'W',
  install_addon: 'W',
  import_package: 'W',
  apply_skin: 'W',
  uninstall_content: 'W',
  launch_instance: 'X',
  create_instance: 'X',
  delete_instance: 'X',
  build_project: 'X',
  deploy_plugin: 'X',
  restart_server: 'X',
  stop_server: 'X',
  rollback_build: 'X',
  generate_content: 'X',
};

/** 生成验证成功判据（§10.3），机器可判定。 */
export const VALIDATION_CRITERIA: Record<string, string> = {
  datapack: '/reload 无报错 且 /datapack list 含目标命名空间',
  addon: 'manifest 校验通过 且 事件回调触发（脚本日志出现）',
  'server-plugin': '日志出现启动完成标志 且 插件 enabled（无 Exception）',
  'server-mod': '无 FATAL / Exception 且 端口监听成功',
  'client-mod': '日志无崩溃 且 目标功能可观测（需图形环境，成本最高）',
};
