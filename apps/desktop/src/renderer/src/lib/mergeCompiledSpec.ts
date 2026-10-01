import type { ModSpec } from '@mc-creator/shared';

/**
 * 把节点图编译结果合并回原 spec（「编译并应用」的落库口径）。
 *
 * ## 为什么需要
 *
 * compileNodeGraph 只从画布读取内容，它产出的 spec 中：
 * - 模组元信息（name/description/version/license/authors/credits/dependencies/website）
 * - 数据包类内容（lootTables/advancements/tags/functions/structures）
 * 恒为固定值或空数组（画布没有对应节点类型/字段）。
 *
 * 若直接用编译结果覆盖整个 spec，这些内容会被静默删除 —— 用户用 AI/表单
 * 生成它们之后，只要在画布点一次「编译并应用」就会永久丢失。
 *
 * ## 口径
 *
 * - 「画布拥有」的字段以编译结果为准（用户在画布上的增删改必须生效）
 * - 其余字段从 base 透传（画布无法表达，保留原值）
 *
 * 实现上先展开 base 再覆盖画布字段：将来 ModSpec 新增字段时默认走
 * 「保留 base」，而不是被悄悄丢弃。
 */
export function mergeCompiledSpec(base: ModSpec, compiled: ModSpec): ModSpec {
  return {
    ...base,
    // —— 画布拥有：以编译结果为准 ——
    modId: compiled.modId,
    items: compiled.items,
    blocks: compiled.blocks,
    recipes: compiled.recipes,
    entities: compiled.entities,
    machines: compiled.machines,
    customCode: compiled.customCode,
    multiblocks: compiled.multiblocks,
    fluids: compiled.fluids,
    biomes: compiled.biomes,
    dimensions: compiled.dimensions,
    guis: compiled.guis,
    eventHandlers: compiled.eventHandlers,
    conditions: compiled.conditions,
    actions: compiled.actions,
    procedures: compiled.procedures,
  };
}
