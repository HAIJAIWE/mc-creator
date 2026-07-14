import type { SpecTemplate } from './types.js';

/**
 * Resource Pack 生成器模板。
 *
 * 覆盖常见资源包场景：石头改色、自定义字体、音效替换。
 */
export const RESOURCE_PACK_TEMPLATES: SpecTemplate[] = [
  {
    id: 'resourcepack-stone-recolor',
    title: '石头改色',
    icon: '🪨',
    description:
      '做一个资源包，覆盖原版石头类方块贴图为彩色版本，' +
      '1）石头（block/stone）改为浅蓝色 #5DADE2 纯色 16x16；' +
      '2）圆石（block/cobblestone）改为深灰色 #5D6D7E 纯色 16x16；' +
      '3）苔石（block/mossy_cobblestone）改为深绿色 #27AE60 纯色 16x16；' +
      '4）深板岩（block/deepslate）改为深紫色 #6C3483 纯色 16x16。' +
      'packName「Recolored Stones」，namespace minecraft，' +
      'packDescription「石头改色资源包」。',
  },
  {
    id: 'resourcepack-custom-font',
    title: '自定义字体',
    icon: '🔤',
    description:
      '做一个资源包，添加自定义字体贴图，' +
      '1）字符 A 映射到 font/letter_a.png，8x8 像素，advance 8，ascent 7；' +
      '2）字符 B 映射到 font/letter_b.png，8x8 像素，advance 8，ascent 7；' +
      '3）字符 C 映射到 font/letter_c.png，8x8 像素，advance 8，ascent 7。' +
      'packName「Custom Letters」，namespace mc_letters，' +
      'packDescription「自定义字母贴图资源包」。',
  },
  {
    id: 'resourcepack-sound-replace',
    title: '音效替换',
    icon: '🔊',
    description:
      '做一个资源包，替换原版音效为静音占位 ogg 文件，' +
      '1）替换 block.stone.hit 音效为静音（volume 1.0，pitch 1.0）；' +
      '2）替换 entity.creeper.primed 音效为静音（volume 0.5，pitch 1.2）；' +
      '3）替换 ambient.weather.rain 音效为静音（volume 0.3，pitch 1.0，开启 stream）。' +
      'packName「Silent Sounds」，namespace minecraft，' +
      'packDescription「静音音效替换资源包」。',
  },
];
