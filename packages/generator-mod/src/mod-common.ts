/**
 * Fabric / NeoForge Adapter 共享类型与辅助函数。
 *
 * 从 fabric-adapter.ts / neoforge-adapter.ts 提取：
 * - ModSpecLike：adapter 内部消费的 ModSpec 形状（避免与 shared schema 强耦合/循环导入）
 * - CategoryDescriptor：增量构建的类别描述符（P1-4）
 * - 辅助函数：Java 类型映射、标识符清洗、配方映射等（两 adapter 原为各自私有实现，逻辑相同）
 *
 * 使用 shared schema 的推导类型以确保 exactOptionalPropertyTypes 兼容。
 */
import type { FileNode, LoaderVersionConfig } from '@mc-creator/shared';
import type {
  ItemSpec,
  BlockSpec,
  ModDependencySpec,
  ModRecipeSpec,
  EntitySpec,
  MachineSpec,
  CustomCodeSnippetSpec,
  MultiBlockSpec,
  FluidSpec,
  ModBiomeSpec,
  ModDimensionSpec,
  GuiSpec,
  ModStructureSpec,
  EventHandlerSpec,
  ConditionSpec,
  ActionSpec,
  ProcedureSpec,
} from '@mc-creator/shared';

/** 内部用的 ModSpec 形状（避免循环导入，从 GeneratorContext 推导） */
export type ModSpecLike = {
  modId: string;
  version: string;
  name: string;
  description: string;
  mcVersionHint?: string;
  // P10 新增字段（向后兼容：均为可选，由 spec.default 兜底）
  license: string;
  authors: string[];
  credits: string;
  website: string;
  dependencies: ModDependencySpec[];
  items: ItemSpec[];
  blocks: BlockSpec[];
  // === P1.3/P1.4 新增字段（可选，向后兼容） ===
  recipes?: ModRecipeSpec[];
  entities?: EntitySpec[];
  machines?: MachineSpec[];
  customCode?: CustomCodeSnippetSpec[];
  multiblocks?: MultiBlockSpec[];
  fluids?: FluidSpec[];
  biomes?: ModBiomeSpec[];
  dimensions?: ModDimensionSpec[];
  guis?: GuiSpec[];
  structures?: ModStructureSpec[];
  eventHandlers?: EventHandlerSpec[];
  conditions?: ConditionSpec[];
  actions?: ActionSpec[];
  /** P1-3：过程（命名可复用逻辑单元，编译为独立 Java 方法） */
  procedures?: ProcedureSpec[];
};

/**
 * 类别描述符（P1-4 增量构建）：把生成逻辑拆分为可独立缓存的单元。
 *
 * 泛型 S 为 spec 形状（FabricAdapter 用 ModSpecLike，子类可扩展）。
 */
export interface CategoryDescriptor<S = ModSpecLike> {
  /** 类别名（缓存键的一部分：modId::loader::category） */
  name: string;
  /** 从 spec 提取影响该类别的数据（用于计算内容哈希） */
  hashInputs: (spec: S, mcVersion: string) => unknown[];
  /** 生成文件；返回空数组表示该类别当前无产物（如 recipes 为空） */
  generate: (
    spec: S,
    pkg: string,
    mainCls: string,
    mcVersion: string,
    versions: LoaderVersionConfig,
  ) => FileNode[];
}

/** P40：按 Java 类型返回默认值表达式（过程调用参数缺省时回退）。 */
export function defaultValueFor(type: string): string {
  switch ((type ?? '').toLowerCase()) {
    case 'int':
    case 'integer':
      return '0';
    case 'float':
      return '0f';
    case 'double':
    case 'number':
      return '0d';
    case 'long':
      return '0L';
    case 'boolean':
    case 'bool':
      return 'false';
    case 'string':
    case 'text':
    case 'item':
    case 'itemstack':
    case 'block':
    case 'blockstate':
    case 'entity':
    case 'player':
    default:
      return '""';
  }
}

/** P40：把低代码类型名映射为 Java 形参类型（spec 可能写 int/string/boolean/item 等）。 */
export function javaTypeFor(type: string): string {
  switch ((type ?? '').toLowerCase()) {
    case 'int':
    case 'integer':
      return 'int';
    case 'float':
      return 'float';
    case 'double':
    case 'number':
      return 'double';
    case 'long':
      return 'long';
    case 'boolean':
    case 'bool':
      return 'boolean';
    case 'string':
    case 'text':
      return 'String';
    case 'item':
    case 'itemstack':
      return 'net.minecraft.item.ItemStack';
    case 'block':
    case 'blockstate':
      return 'net.minecraft.block.BlockState';
    case 'entity':
      return 'net.minecraft.entity.Entity';
    case 'player':
      return 'net.minecraft.server.network.ServerPlayerEntity';
    default:
      return type;
  }
}

/**
 * P40：把低代码类型名映射为 Java 形参类型（Mojang 官方映射版，供 NeoForge/Forge 用）。
 * 与 javaTypeFor 同构，仅 item/block/entity/player 四个走 Mojang 包名。
 */
export function javaTypeForMojang(type: string): string {
  switch ((type ?? '').toLowerCase()) {
    case 'int':
    case 'integer':
      return 'int';
    case 'float':
      return 'float';
    case 'double':
    case 'number':
      return 'double';
    case 'long':
      return 'long';
    case 'boolean':
    case 'bool':
      return 'boolean';
    case 'string':
    case 'text':
      return 'String';
    case 'item':
    case 'itemstack':
      return 'net.minecraft.world.item.ItemStack';
    case 'block':
    case 'blockstate':
      return 'net.minecraft.world.level.block.state.BlockState';
    case 'entity':
      return 'net.minecraft.world.entity.Entity';
    case 'player':
      return 'net.minecraft.server.level.ServerPlayer';
    default:
      return type;
  }
}

/**
 * 把任意字符串转为合法 Java 标识符片段（用于 check_<id>/execute_<id>/handle_<id> 方法名后缀）。
 * 保留原大小写与下划线，仅把非法字符替换为下划线；首字符为数字时加 _ 前缀。
 *
 * P1 dogfood 修复：空字符串/纯特殊字符 → 返回 "unknown"（而非空标识符导致编译错误）。
 */
export function sanitizeIdent(s: string): string {
  if (!s) return 'unknown';
  let sanitized = s.replace(/[^a-zA-Z0-9_]/g, '_');
  if (/^[0-9]/.test(sanitized)) sanitized = `_${sanitized}`;
  sanitized = sanitized.replace(/_+/g, '_'); // 合并连续下划线
  if (!sanitized || sanitized === '_') return 'unknown';
  return sanitized;
}

/** 把任意字符串转为合法 PascalCase Java 标识符（用于方法名后缀、类名） */
export function toPascal(s: string): string {
  const sanitized = s.replace(/[^a-zA-Z0-9_]/g, '_');
  const parts = sanitized.split('_').filter(Boolean);
  if (parts.length === 0) return 'Unknown';
  const pascal = parts.map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join('');
  // 若首字符是数字，前缀下划线
  return /^[0-9]/.test(pascal) ? `_${pascal}` : pascal;
}

/**
 * PortType（节点图端口类型字符串）→ Java 类型映射（Yarn 映射）。
 * 用于 CustomCodeSnippetSpec.inputSignature/outputSignature 的类型转换。
 * 与 yarn mappings 一致，类名含 Yarn 后缀（如 Vec3d 而非 Vec3）。
 */
export function portTypeToJava(portType: string): string {
  const lower = portType.toLowerCase();
  switch (lower) {
    case 'integer':
    case 'int':
    case 'long':
      return 'int';
    case 'number':
    case 'float':
    case 'double':
      return 'double';
    case 'string':
    case 'text':
      return 'String';
    case 'boolean':
    case 'bool':
      return 'boolean';
    case 'void':
    case 'none':
      return 'void';
    case 'item':
    case 'itemstack':
      return 'ItemStack';
    case 'block':
    case 'blockstate':
      return 'BlockState';
    case 'entity':
      return 'Entity';
    case 'player':
      return 'Player';
    case 'vec3':
    case 'vector3':
    case 'pos':
      return 'Vec3';
    case 'nbt':
      return 'NbtCompound';
    default:
      return 'Object';
  }
}

/** T5: 机器配方映射 → Java switch case（输入物品 ID → 输出物品 ID） */
export function machineRecipeCases(m: { recipeMap?: Record<string, string> }): string {
  const entries = Object.entries(m.recipeMap ?? {});
  if (entries.length === 0) {
    return `                // 未配置配方映射，回退原样搬运`;
  }
  return entries
    .map(
      ([input, output]) =>
        `                case "${input}":\n                    return "${output}";`,
    )
    .join('\n');
}
