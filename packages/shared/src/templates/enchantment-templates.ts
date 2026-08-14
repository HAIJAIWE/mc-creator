import type { SpecTemplate } from './types.js';

/**
 * 附魔包常用模板。
 *
 * 描述会预填到 description 输入框，供 AI 生成 EnchantmentSpec。
 * 附魔为 1.21+ 数据驱动格式（data/<ns>/enchantment/<id>.json）。
 */
export const ENCHANTMENT_TEMPLATES: SpecTemplate[] = [
  {
    id: 'enchantment-weapon',
    title: '武器附魔',
    icon: '⚔️',
    description:
      '用附魔包创建 3 个武器附魔：' +
      '1）烈焰冲击（id fire_dash）：攻击点燃敌人 3 秒，maxLevel 3，damage_bonus 每级 2 对亡灵，' +
      'burning_time 每级 1；supportedItems 为 #minecraft:enchantable/sharp_weapon，slots mainhand，weight 5。' +
      '2）吸血（id vampiric）：攻击时按伤害 20% 治疗自身，maxLevel 5，healing 每级 1；' +
      'supportedItems 为 minecraft:netherite_sword，weight 3，exclusiveSet 为 #minecraft:exclusive_set/damage。' +
      '3）闪电风暴（id storm_strike）：每级 15% 概率召唤闪电，maxLevel 2，weight 2；' +
      '用 customEffects 实现，group 为 minecraft:post_attack，effect 为 {"effect":{"type":"minecraft:run_function","function":"my_pack:storm_strike"}}。' +
      '所有附魔描述放在 description 字段（自动生成语言条目）。' +
      'packId 为 weapon_enchants，packName 显示名「武器附魔包」，packFormat 26。',
  },
  {
    id: 'enchantment-tools',
    title: '工具附魔',
    icon: '⛏️',
    description:
      '用附魔包创建 2 个工具附魔：' +
      '1）熔炼（id auto_smelt）：挖掘方块自动熔炼掉落物（每级 1 经验值，mob_experience 不需要），' +
      '效果用 customEffects，group 为 minecraft:post_attack，effect 为 {"effect":{"type":"minecraft:run_function","function":"my_pack:auto_smelt"}}；' +
      'supportedItems 为 #minecraft:enchantable/mining，slots mainhand，maxLevel 1，weight 10。' +
      '2）幸运矿工（id miner_luck）：挖掘时额外掉落 25% 战利品，loot_bonus 每级 0.25，' +
      'extra.lootTable 用 minecraft:blocks/diamond_ore；supportedItems 为 minecraft:diamond_pickaxe，' +
      'maxLevel 3，weight 5，exclusiveSet 为 #minecraft:exclusive_set/mining。' +
      'packId 为 tool_enchants，packName 显示名「工具附魔包」，packFormat 26。',
  },
  {
    id: 'enchantment-armor',
    title: '护甲附魔',
    icon: '🛡️',
    description:
      '用附魔包创建 2 个护甲附魔：' +
      '1）荆棘反弹（id thorn_rebound）：受击时反弹 3 点伤害，maxLevel 3；' +
      '效果用 customEffects，group 为 minecraft:post_attack，effect 为 {"effect":{"type":"minecraft:damage_bonus","target":{"type":"minecraft:attacker"},"damage":{"type":"minecraft:add","value":{"type":"minecraft:linear","base":2,"per_level":1}}}}，' +
      'enchanted 为 minecraft:victim，affected 为 minecraft:attacker。' +
      '2）疾风（id wind_step）：提升 5% 移动速度每级，attribute 效果，extra.attribute 为 minecraft:movement_speed，' +
      'extra.slot 为 legs，maxLevel 5，weight 5；supportedItems 为 #minecraft:enchantable/armor，slots 为 armor。' +
      'packId 为 armor_enchants，packName 显示名「护甲附魔包」，packFormat 26。',
  },
];
