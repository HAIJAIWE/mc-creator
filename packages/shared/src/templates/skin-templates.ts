import type { SpecTemplate } from './types.js';

/**
 * Skin 生成器模板。
 *
 * 覆盖常见皮肤生成场景：classic 蓝衣、slim 红发、太空人。
 */
export const SKIN_TEMPLATES: SpecTemplate[] = [
  {
    id: 'skin-classic-blue',
    title: 'classic 蓝衣',
    icon: '🧍',
    description:
      '生成一个 classic 模型的皮肤，玩家名 Player01，' +
      '皮肤色 #E0AC69（标准肤色），头发色 #312718（深棕），' +
      '上衣色 #19A6FF（蓝色 T 恤），裤子色 #3C2A1E（棕色长裤），' +
      '鞋子色 #5A3A1E（棕色鞋），关闭预览图。' +
      'playerName 用 Player01。',
  },
  {
    id: 'skin-slim-red',
    title: 'slim 红发',
    icon: '👩',
    description:
      '生成一个 slim 模型（Alex 风格，手臂 3px 宽）的皮肤，玩家名 Alex02，' +
      '皮肤色 #F1C27D（浅肤色），头发色 #B22222（火红色长发），' +
      '上衣色 #FF69B4（粉色上衣），裤子色 #2F4F4F（深灰长裤），' +
      '鞋子色 #FFFFFF（白色帆布鞋），开启预览图生成。' +
      'playerName 用 Alex02，model 为 slim。',
  },
  {
    id: 'skin-astronaut',
    title: '太空人',
    icon: '🚀',
    description:
      '生成一个 classic 模型的太空人皮肤，玩家名 AstroKid，' +
      '皮肤色 #FFFFFF（白色头盔覆盖），头发色 #000000（隐藏不显眼），' +
      '上衣色 #FFFFFF（白色宇航服），裤子色 #E0E0E0（浅灰裤腿），' +
      '鞋子色 #666666（深灰靴子），开启预览图。' +
      'playerName 用 AstroKid，model 为 classic。',
  },
];
