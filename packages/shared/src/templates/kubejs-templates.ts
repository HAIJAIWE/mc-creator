import type { SpecTemplate } from './types.js';

/**
 * KubeJS 生成器模板。
 *
 * 覆盖常见 KubeJS 脚本场景：自定义配方、事件处理、工具提示、自定义注册表物品。
 */
export const KUBEJS_TEMPLATES: SpecTemplate[] = [
  {
    id: 'kubejs-custom-recipes',
    title: '自定义配方',
    icon: '🛠️',
    description:
      '用 KubeJS 添加以下自定义配方：1）九宫格有序合成：用 9 个铁锭合成 1 个钻石，' +
      '配方 ID 为 iron_to_diamond，pattern 为 III/III/III，key 中 I 映射到 minecraft:iron_ingot；' +
      '2）无序合成：4 个圆石合成 1 个石头，配方 ID 为 cobble_to_stone；' +
      '3）熔炉烧炼：铁矿石烧炼成铁块（产物 1），配方 ID 为 iron_ore_to_block；' +
      '4）切石机：安山岩切成磨制安山岩台阶（产物 6），配方 ID 为 andesite_slab_cutting。' +
      'packId 用 custom_recipes，packFormat 48，packName 显示「自定义配方脚本」。',
  },
  {
    id: 'kubejs-events',
    title: '事件处理',
    icon: '⚡',
    description:
      '用 KubeJS 实现以下事件处理：1）玩家右键石头方块时，在玩家位置生成一道闪电（block.right_click，目标 minecraft:stone）；' +
      '2）玩家登录服务器时，发送欢迎消息并给予 1 个金苹果（player.logged_in）；' +
      '3）玩家破坏钻石矿石时，公告给全服玩家并奖励 100 经验值（block.break，目标 minecraft:diamond_ore）；' +
      '4）每 200 tick 给所有在线玩家恢复 1 点生命值（tick 事件，handler 中包含计数逻辑）。' +
      'packId 用 server_events，packName 显示「服务器事件脚本」。',
  },
  {
    id: 'kubejs-tooltips',
    title: '工具提示',
    icon: '💬',
    description:
      '用 KubeJS 为以下物品添加工具提示：1）钻石剑：显示「传说中能斩断一切的圣剑」+「攻击力 +8」两行；' +
      '2）金苹果：显示「稀有食物，附带生命恢复效果」一行，标记为 advanced；' +
      '3）末影珍珠：显示「可投掷传送」+「使用需谨慎」两行；' +
      '4）下界之星：显示「末影龙掉落的稀有材料」+「装饰与信标之用」两行。' +
      'packId 用 custom_tooltips，packName 显示「物品提示脚本」。',
  },
  {
    id: 'kubejs-registry',
    title: '自定义注册表物品',
    icon: '📦',
    description:
      '用 KubeJS 在启动脚本中注册以下自定义内容：1）注册自定义物品：ruby（红宝石）、ruby_dust（红宝石粉）、ruby_nugget（红宝石粒），' +
      '每个物品有独立的 ID 和显示名；2）注册自定义方块：ruby_ore（红宝石矿石）、ruby_block（红宝石块），' +
      '设置材质和挖掘等级；3）注册自定义流体：molten_ruby（熔融红宝石）；' +
      '4）语言文件：en_us 和 zh_cn 都需要包含以上所有物品/方块/流体的显示名翻译。' +
      'packId 用 custom_registry，packName 显示「自定义注册表脚本」。',
  },
];
