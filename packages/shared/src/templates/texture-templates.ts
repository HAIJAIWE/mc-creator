import type { SpecTemplate } from './types.js';

/**
 * Texture 生成器模板。
 *
 * 覆盖常见材质生成场景：纯色方块、渐变工具、棋盘格测试材质。
 */
export const TEXTURE_TEMPLATES: SpecTemplate[] = [
  {
    id: 'texture-solid-blocks',
    title: '纯色方块',
    icon: '🟦',
    description:
      '生成一组纯色方块材质，16x16 像素，用于自定义方块：' +
      '1）红色方块 color #FF0000；2）绿色方块 color #00FF00；' +
      '3）蓝色方块 color #0000FF；4）紫色方块 color #8A2BE2。' +
      'packName「Solid Color Blocks」，packDescription「纯色方块材质包」，' +
      'modId 用 colored_blocks，材质 ID 分别为 red_block、green_block、' +
      'blue_block、purple_block，type 为 block。',
  },
  {
    id: 'texture-gradient-tools',
    title: '渐变工具',
    icon: '🌈',
    description:
      '生成一组渐变工具材质，16x16 像素，type 为 item：' +
      '1）彩虹剑：color #FF0000 渐变到 #0000FF，id 为 rainbow_sword；' +
      '2）翡翠镐：color #50C878 渐变到 #003D2B，id 为 emerald_pickaxe；' +
      '3）金色斧：color #FFD700 渐变到 #B8860B，id 为 golden_axe。' +
      'packName「Gradient Tools」，modId 用 gradient_tools，' +
      'packDescription「渐变工具材质包」。',
  },
  {
    id: 'texture-checkerboard',
    title: '棋盘格',
    icon: '🔲',
    description:
      '生成一组棋盘格测试材质，16x16 像素，开启 checkerboard 模式，' +
      '用于资源包调试：1）红白棋盘格 color #FF0000，id 为 red_checker；' +
      '2）黑白棋盘格 color #000000，id 为 black_checker；' +
      '3）紫白棋盘格 color #8A2BE2，id 为 purple_checker。' +
      'packName「Checkerboard Test」，modId 用 checker_textures，' +
      'type 为 block，packDescription「棋盘格测试材质包」。',
  },
];
