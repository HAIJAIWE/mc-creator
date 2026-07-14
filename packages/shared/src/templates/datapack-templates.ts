import type { SpecTemplate } from './types.js';

/**
 * Datapack 生成器模板。
 *
 * 覆盖常见数据包场景：自定义配方、战利品表、进度、函数系统。
 */
export const DATAPACK_TEMPLATES: SpecTemplate[] = [
  {
    id: 'datapack-recipes',
    title: '自定义配方',
    icon: '🛠️',
    description:
      '做一个数据包，添加以下配方：1）九宫格合成：用 9 个铁矿锭合成 1 个钻石（无序合成）；' +
      '2）熔炉烧炼：圆石烧炼成石砖（产物 1）；3）切石机：安山岩切成磨制安山岩台阶（产物 6）；' +
      '4）九宫格压缩：9 个烈焰粉压缩为 1 个烈焰棒。packId 用 custom_recipes，' +
      'packFormat 48，配方 ID 分别为 iron_to_diamond、stone_to_stonebricks、' +
      'andesite_slab_cutting、blaze_powder_to_rod。',
  },
  {
    id: 'datapack-loot-tables',
    title: '战利品表',
    icon: '💰',
    description:
      '做一个数据包，自定义以下战利品表：1）僵尸掉落：50% 概率掉落铁锭 1 个，' +
      '30% 概率掉落胡萝卜 2 个，20% 概率掉落马铃薯 1 个；2）末影龙击杀掉落：' +
      '必掉 1 个龙蛋 + 500 经验球 + 1 个鞘翅（耐久度 50%）；3）村庄箱子战利品：' +
      '2 次抽取，每次 1-3 个绿宝石、10% 概率附魔书。packId 用 better_loot，' +
      '路径分别为 entity/zombie、entity/ender_dragon、chest/village/village_weaponsmith。',
  },
  {
    id: 'datapack-advancements',
    title: '进度',
    icon: '🏆',
    description:
      '做一个数据包，添加以下进度：1）「初探红石」- 获得红石粉触发，奖励经验 10；' +
      '2）「熔岩勇士」- 落入熔岩后存活触发（条件：生命值低于 3 颗心），奖励经验 50；' +
      '3）「收藏家」- 收集所有 16 种羊毛触发，显示 toast 通知，隐藏直到完成；' +
      '4）「末影之主」- 击败末影龙触发，作为最终成就展示。packId 用 custom_advancements，' +
      '进度 ID 分别为 first_redstone、lava_warrior、collector、ender_lord。',
  },
  {
    id: 'datapack-functions',
    title: '函数系统',
    icon: '⚡',
    description:
      '做一个数据包，添加以下函数系统：1）give_tools 函数：给执行者一套钻石装备+钻石剑+20 个末影珍珠；' +
      '2）heal_all 函数：治疗所有在线玩家满血并清除负面效果；' +
      '3）time_noon 函数：设置时间为 6000（正午）并清除附近 50 格内的所有怪物；' +
      '4）函数标签 load：在数据包加载时执行 say 数据包已加载。packId 用 utility_functions，' +
      '函数 ID 分别为 give_tools、heal_all、time_noon，' +
      '标签路径为 minecraft:tags/functions/load.json。',
  },
];
