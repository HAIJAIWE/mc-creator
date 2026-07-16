import { z } from 'zod';

/** 颜色（hex 格式 #RRGGBB 或 rgba(r,g,b,a)） */
export const Color = z.string().regex(/^#([0-9a-fA-F]{6})$/);

/** 皮肤规格 */
export const SkinSpec = z.object({
  playerName: z.string().default('Player'),
  // 皮肤变体：classic=Steve 风格, slim=Alex 风格（手臂 3px 宽）
  model: z.enum(['classic', 'slim']).default('classic'),
  // 主色（皮肤色）
  skinColor: Color.default('#E0AC69'),
  // 头发色
  hairColor: Color.default('#312718'),
  // 上衣色
  shirtColor: Color.default('#19A6FF'),
  // 裤子色
  pantsColor: Color.default('#3C2A1E'),
  // 鞋子色
  shoesColor: Color.default('#5A3A1E'),
  // 是否生成预览图（额外输出 preview.png）
  generatePreview: z.boolean().default(false),
});

export type Color = z.infer<typeof Color>;
export type SkinSpec = z.infer<typeof SkinSpec>;
