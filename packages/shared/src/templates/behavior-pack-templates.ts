import type { SpecTemplate } from './types.js';

/**
 * Behavior Pack 生成器模板。
 *
 * 覆盖常见基岩版行为包场景：自定义实体、配方、战利品表。
 */
export const BEHAVIOR_PACK_TEMPLATES: SpecTemplate[] = [
  {
    id: 'behavior-pack-custom-entity',
    title: '自定义实体',
    icon: '🧊',
    description:
      '做一个基岩版行为包，添加以下自定义实体：1）红宝石史莱姆：50 血量，近战攻击 5 点伤害，' +
      '被击杀掉落红宝石碎片 1-3 个，跳跃高度 2 格；2）幽灵骑士：100 血量，' +
      '远程攻击（弓箭）8 点伤害，穿戴铁甲，击杀掉落铁锭 0-2 + 附魔书 10% 概率；' +
      '3）矿洞蝙蝠：5 血量，被动生物，发光效果，靠近玩家时发出声音提示。' +
      'packId 用 custom_entities，identifier 格式为 custom_entities:ruby_slime 等。',
  },
  {
    id: 'behavior-pack-recipes',
    title: '自定义配方',
    icon: '🛠️',
    description:
      '做一个基岩版行为包，添加以下配方：1）九宫格合成：用 9 个铁锭合成 1 个钻石块' +
      '（shaped_crafting，3x3 铁锭排列）；2）无序合成：4 个红石粉 + 1 个金锭 = 1 个时钟' +
      '（shapeless_crafting）；3）熔炉烧炼：铁矿石烧炼成铁锭（furnace，经验 0.7）。' +
      'packId 用 custom_recipes，identifier 格式为 custom_recipes:iron_to_diamond_block 等。',
  },
  {
    id: 'behavior-pack-loot',
    title: '自定义战利品表',
    icon: '💰',
    description:
      '做一个基岩版行为包，自定义以下战利品表：1）僵尸掉落：50% 概率掉落铁锭 1 个，' +
      '30% 概率掉落胡萝卜 2 个，20% 概率掉落马铃薯 1 个；2）末影龙击杀掉落：' +
      '必掉 1 个龙蛋 + 1 个鞘翅；3）村庄箱子战利品：' +
      '2 次抽取，每次 1-3 个绿宝石、10% 概率附魔书。' +
      'packId 用 better_loot，路径分别为 entities/zombie、entities/ender_dragon、chests/village。',
  },
];
