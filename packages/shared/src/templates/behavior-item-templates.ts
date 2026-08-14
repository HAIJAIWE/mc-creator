import type { SpecTemplate } from './types.js';

/**
 * 行为包自定义物品常用模板。
 *
 * 描述会预填到 description 输入框，供 AI 生成 BehaviorItemSpec。
 * 生成基岩版 items/<id>.json（minecraft:item 定义 + 自动纹理）。
 */
export const BEHAVIOR_ITEM_TEMPLATES: SpecTemplate[] = [
  {
    id: 'behavior-item-weapons',
    title: '武器套装',
    icon: '⚔️',
    description:
      '用行为包创建 3 件自定义武器：' +
      '1）烈焰之剑（id fire_sword）：攻击伤害 8、攻速 1.6、耐久 1561、附魔能力 15、发光，' +
      '主色 #e74c3c 辅色 #c0392b（红色系，category weapons）。' +
      '2）冰霜战斧（id frost_axe）：攻击伤害 10、攻速 0.9、耐久 2500，' +
      '主色 #3498db 辅色 #2980b9（蓝色系，category weapons）。' +
      '3）闪电匕首（id volt_dagger）：攻击伤害 5、攻速 2.2、附魔能力 15，' +
      '主色 #f1c40f 辅色 #d4ac0d（黄色系，category weapons）。' +
      'packId 为 legendary_weapons，packName 显示名「传奇武器包」，packFormat 2。',
  },
  {
    id: 'behavior-item-armor',
    title: '盔甲套装',
    icon: '🛡️',
    description:
      '用行为包创建 4 件自定义盔甲（对应四个栏位）：' +
      '1）秘银头盔（id mithril_helmet）：防护 3、head 栏位、耐久 363、主色 #bdc3c7。' +
      '2）秘银胸甲（id mithril_chestplate）：防护 8、chest 栏位、耐久 528、主色 #bdc3c7。' +
      '3）秘银护腿（id mithril_leggings）：防护 6、legs 栏位、耐久 495、主色 #95a5a6。' +
      '4）秘银靴子（id mithril_boots）：防护 3、feet 栏位、耐久 429、主色 #95a5a6。' +
      '每件附魔能力 12、category equipment。' +
      'packId 为 mithril_set，packName 显示名「秘银盔甲套」，packFormat 2。',
  },
  {
    id: 'behavior-item-tools',
    title: '工具套装',
    icon: '⛏️',
    description:
      '用行为包创建 3 件自定义工具：' +
      '1）黑曜石镐（id obsidian_pickaxe）：挖掘等级 4（钻石级）、效率 8、耐久 2500、' +
      '攻击伤害 3，主色 #2c3e50 辅色 #1a252f。' +
      '2）紫水晶斧（id amethyst_axe）：挖掘等级 3、效率 7、耐久 2200、攻击伤害 7，' +
      '主色 #9b59b6 辅色 #8e44ad。' +
      '3）翡翠铲（id jade_shovel）：挖掘等级 3、效率 6、耐久 1800、攻击伤害 4，' +
      '主色 #27ae60 辅色 #1e8449。' +
      '工具 tags 默认包含矿镐/锄/铲/斧标签（minecraft:is_pickaxe 等），category tools。' +
      'packId 为 gem_tools，packName 显示名「宝石工具包」，packFormat 2。',
  },
];
