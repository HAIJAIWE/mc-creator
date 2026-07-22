import type { PortType } from '@mc-creator/shared';

/** PortType → 端口 Handle 颜色（降饱和 MC 配色，hex 值用于内联样式） */
export const PORT_COLORS: Record<PortType, string> = {
  item_stack: '#d88a8a',
  block_state: '#d8a87a',
  entity: '#7ac6c6',
  fluid: '#7a9ac6',
  energy: '#d8c87a',
  redstone: '#c67a7a',
  player: '#7ac68a',
  world: '#9a9a9a',
  boolean: '#a87ac6',
  integer: '#7a8ac6',
  number: '#7a8ac6',
  string: '#d8a87a',
  nbt: '#9a7ac6',
  void: '#9a7ac6',
  any: '#9a9a9a',
};

/** colorClass（如 'mc-item'）→ hex 值，用于节点头部色条/图标内联样式 */
export const NODE_COLORS: Record<string, string> = {
  'mc-item': '#d88a8a',
  'mc-block': '#d8a87a',
  'mc-entity': '#7ac6c6',
  'mc-recipe': '#d8c87a',
  'mc-machine': '#7ac68a',
  'mc-multiblock': '#a87ac6',
  'mc-event': '#9a7ac6',
  'mc-condition': '#7a8ac6',
  'mc-action': '#c67a7a',
  'mc-code': '#9a9a9a',
  'mc-comment': '#d8c87a',
};
