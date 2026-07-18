import type { SpecTemplate } from './types.js';

/**
 * CraftTweaker 生成器模板。
 *
 * 覆盖常见 CraftTweaker 脚本场景：自定义配方、事件处理、工具提示。
 * CraftTweaker 使用 ZenScript 脚本（.zs 文件），语法与 KubeJS（JavaScript）不同。
 */
export const CRAFTTWEAKER_TEMPLATES: SpecTemplate[] = [
  {
    id: 'crafttweaker-recipes',
    title: '自定义配方',
    icon: '🛠️',
    description:
      '用 CraftTweaker 添加以下自定义配方（ZenScript 脚本）：' +
      '1）九宫格有序合成：用 9 个铁锭合成 1 个钻石，配方 ID 为 iron_to_diamond，' +
      'pattern 为 III/III/III，key 中 I 映射到 minecraft:iron_ingot；' +
      '2）无序合成：4 个圆石合成 1 个石头，配方 ID 为 cobble_to_stone，' +
      'ingredients 为 4 个 minecraft:cobblestone；' +
      '3）熔炉烧炼：铁矿石烧炼成铁块（产物 1），配方 ID 为 iron_ore_to_block；' +
      '4）切石机：安山岩切成磨制安山岩台阶（产物 6），配方 ID 为 andesite_slab_cutting。' +
      'ZenScript 语法：recipes.addShaped(<item:result>, [[<item:key>,...],...])；' +
      'recipes.addShapeless(<item:result>, [<item:ing>,...])；' +
      'furnace.addRecipe(<item:result>, <item:input>)；' +
      'stoneCutter.addRecipe(<item:result>:count, <item:input>)。' +
      'packId 用 custom_recipes，packFormat 48，packName 显示「自定义配方脚本」。',
  },
  {
    id: 'crafttweaker-events',
    title: '事件处理',
    icon: '⚡',
    description:
      '用 CraftTweaker 实现以下事件处理（ZenScript 脚本）：' +
      '1）玩家登录服务器时，发送欢迎消息并给予 1 个金苹果（player.logged_in）；' +
      '2）玩家登出服务器时，在控制台打印登出日志（player.logged_out）；' +
      '3）玩家破坏钻石矿石时，公告给全服玩家并奖励 100 经验值（block.break，目标 minecraft:diamond_ore）；' +
      '4）实体死亡时，掉落额外物品（entity.died）。' +
      'ZenScript 语法：events.onPlayerLoggedIn(function(event as PlayerLoggedInEvent) { ... })；' +
      'events.onPlayerLoggedOut(function(event as PlayerLoggedOutEvent) { ... })。' +
      'handler 字段是 ZenScript 代码字符串，会被嵌入到事件回调函数体中。' +
      'packId 用 server_events，packName 显示「服务器事件脚本」。',
  },
  {
    id: 'crafttweaker-tooltips',
    title: '工具提示',
    icon: '💬',
    description:
      '用 CraftTweaker 为以下物品添加工具提示（ZenScript 脚本）：' +
      '1）钻石剑：显示「传说中能斩断一切的圣剑」+「攻击力 +8」两行；' +
      '2）金苹果：显示「稀有食物，附带生命恢复效果」一行，标记为 advanced；' +
      '3）末影珍珠：显示「可投掷传送」+「使用需谨慎」两行；' +
      '4）下界之星：显示「末影龙掉落的稀有材料」+「装饰与信标之用」两行。' +
      'ZenScript 语法：<item:id>.addTooltip("文本")。' +
      'packId 用 custom_tooltips，packName 显示「物品提示脚本」。',
  },
];
