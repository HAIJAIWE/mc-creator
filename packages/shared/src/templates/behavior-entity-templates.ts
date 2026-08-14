import type { SpecTemplate } from './types.js';

/**
 * 行为包自定义实体（怪物 AI）常用模板。
 *
 * 描述会预填到 description 输入框，供 AI 生成 BehaviorEntitySpec。
 * 生成 BP entities/<id>.behavior.json + RP client_entity（内置几何 + 自动纹理 + 生成蛋）。
 */
export const BEHAVIOR_ENTITY_TEMPLATES: SpecTemplate[] = [
  {
    id: 'behavior-entity-hostile-goblin',
    title: '敌对哥布林',
    icon: '👹',
    description:
      '用行为包创建 1 个敌对哥布林怪物：生命 24、攻击 4、速度 0.3，模型用 zombie 几何，主色绿 #4a7c2f、辅色黄 #ffdd00，体型 0.9。AI 行为：近战攻击（优先级 3，速度倍率 1.1）、注视玩家（优先级 4）、随机游荡（优先级 5，速度倍率 0.8）。会主动攻击玩家和村民。掉落骨头（80% 概率 2 个）和绿宝石（10% 概率 1 个）。击杀经验 8。',
  },
  {
    id: 'behavior-entity-ranged-archer',
    title: '远程弩手',
    icon: '🏹',
    description:
      '用行为包创建 1 个远程弩手怪物：生命 30、攻击 3、速度 0.25，模型用 skeleton 几何，主色深灰 #2c2f36、辅色紫 #7c5cff。AI 行为：远程射箭（优先级 2，射程 20，间隔 2.5 秒）、逃离阳光（优先级 3，速度倍率 1.2）、游泳（优先级 4）、随机游荡（优先级 6）。攻击玩家。掉落箭矢（3 个）和弓（15% 概率）。击退抗性 0.3，击杀经验 12。',
  },
  {
    id: 'behavior-entity-passive-pet',
    title: '宠物绵羊',
    icon: '🐑',
    description:
      '用行为包创建 1 个被动宠物：名为棉花糖，生命 16、不攻击、速度 0.2，模型用 slime 几何，主色米白 #f5f0e1、辅色粉 #ff9ec7，体型 1.1。AI 行为：跟随主人（优先级 3，速度倍率 1.2）、注视玩家（优先级 5）、随机游荡（优先级 7）。免疫火焰，不会消失，无经验。掉落白色羊毛（50% 概率 2 个）。',
  },
];
