import type { SpecTemplate } from './types.js';

/**
 * SkinPack 生成器模板（§6.4 基岩皮肤包）。
 *
 * 与 `skin-templates.ts` 的区别：那是 **Java 版单张 64×64 PNG**，
 * 本文件是 **基岩版整包**（manifest + skins.json + textures/*.png + texts/*.lang）。
 * 两者在 contract 的 ALL_KINDS 里也是不同的 kind（skin vs skinpack）。
 */
export const SKINPACK_TEMPLATES: SpecTemplate[] = [
  {
    id: 'skinpack-knight',
    title: '骑士主题',
    icon: '🛡️',
    description:
      '生成一个基岩版皮肤包，serializeName 为 KnightPack，包名「骑士主题」，' +
      '包含两个皮肤：Knight（classic 模型，主色 #334455 深蓝铠甲）与 ' +
      'Squire（customSlim 模型，主色 #8B6914 皮甲），均 type free。' +
      '另含一件披风 Cape（颜色 #402020 深红）。textureSize 用 64。',
  },
  {
    id: 'skinpack-fantasy',
    title: '奇幻角色',
    icon: '🧙',
    description:
      '生成一个基岩版皮肤包，serializeName 为 FantasyPack，包名「奇幻角色」，' +
      '包含三个皮肤：Mage（customSlim，主色 #6A0DAD 紫袍）、' +
      'Ranger（customSlim，主色 #228B22 绿衣）、' +
      'Warrior（classic，主色 #8B0000 重甲），均 type free。' +
      'textureSize 用 128（官方 CSPJ107 允许 64 或 128）。',
  },
  {
    id: 'skinpack-minimal',
    title: '极简单人',
    icon: '👤',
    description:
      '生成一个基岩版皮肤包，serializeName 为 SoloPack，包名「极简单人」，' +
      '只含一个皮肤：Player（classic 模型，主色 #C68642 标准肤色），type free。' +
      '不含披风。textureSize 用 64。',
  },
];
