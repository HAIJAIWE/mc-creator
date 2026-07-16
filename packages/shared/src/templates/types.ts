/**
 * Spec 模板相关类型定义。
 *
 * 模板用于在 UI 中提供常见创作场景的预填描述，
 * 降低用户的创作门槛（点击模板即可填充 description 输入框）。
 */

/**
 * 单个 Spec 模板。
 *
 * @property id          - 唯一 ID（如 'mod-ore-tools'）
 * @property title       - 显示名（如「矿物+工具」）
 * @property description - 预填的描述（点击后填入 description 输入框）
 * @property icon        - 可选 emoji 图标
 */
export interface SpecTemplate {
  id: string;
  title: string;
  description: string;
  icon?: string;
}

/**
 * 生成器类型联合（与 ipc-channels.ts 中的 GeneratorType 保持一致）。
 *
 * 注：此处直接用字符串联合类型，避免从
 * '@mc-creator/shared' 导入导致的循环依赖。
 */
export type GeneratorType =
  | 'mod'
  | 'datapack'
  | 'modpack'
  | 'server'
  | 'resource_pack'
  | 'skin'
  | 'launcher';
