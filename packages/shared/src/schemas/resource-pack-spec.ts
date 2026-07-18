import { z } from 'zod';

const Color = z.string().regex(/^#([0-9a-fA-F]{6})$/);

/** 音效条目（用 base64 编码的 WAV/OGG 数据，或留空生成静音占位） */
export const SoundEntry = z.object({
  id: z.string().regex(/^[a-z0-9_]+$/),
  // 事件名（如 block.stone.hit）或文件名（如 ambience.rain）
  event: z.string().default(''),
  // 可选：base64 编码的音频数据（不提供则生成空 ogg 占位）
  data: z.string().default(''),
  volume: z.number().min(0).max(1).default(1),
  pitch: z.number().min(0).max(2).default(1),
  // 是否可流式播放
  stream: z.boolean().default(false),
});

/** 字体条目（用 Unicode 字符映射到贴图） */
export const FontEntry = z.object({
  id: z.string().regex(/^[a-z0-9_]+$/),
  // 字符（unicode codepoint，如 "\\u0041" 或 "A"）
  char: z.string(),
  // 对应贴图路径（assets/<namespace>/textures/font/<id>.png）
  texture: z.string().default(''),
  // 贴图宽度（像素）
  width: z.number().int().min(1).default(8),
  // 贴图高度（像素）
  height: z.number().int().min(1).default(8),
  // 在贴图中的 x 坐标
  x: z.number().int().min(0).default(0),
  // 在贴图中的 y 坐标
  y: z.number().int().min(0).default(0),
  // 字符显示宽度（advance）
  advance: z.number().int().min(0).default(8),
  // 字符显示高度（ascent，基线偏移）
  ascent: z.number().int().default(7),
});

/** 通用贴图覆盖条目（覆盖原版贴图） */
export const TextureOverrideEntry = z.object({
  // 被覆盖的原版贴图路径（如 block/stone）
  path: z.string(),
  // 新贴图颜色（纯色生成）
  color: Color.default('#FFFFFF'),
  width: z.number().int().min(1).max(1024).default(16),
  height: z.number().int().min(1).max(1024).default(16),
  gradientTo: Color.optional(),
  checkerboard: z.boolean().default(false),
});

/** 模型条目（简单方块/物品模型 JSON，用字符串存） */
export const ModelEntry = z.object({
  // 模型路径（如 block/stone）
  path: z.string(),
  // 模型 JSON 内容（parent + textures）
  json: z.string().default(''),
  // 可选：自动生成简单 cube_all 模型
  autoCubeAll: z.boolean().default(true),
  // 自动生成时用的贴图名（path 同名）
  textureName: z.string().default(''),
});

/** ResourcePackSpec */
export const ResourcePackSpec = z.object({
  packName: z.string(),
  packDescription: z.string().default(''),
  packFormat: z.number().int().default(34), // 1.21.x
  namespace: z
    .string()
    .regex(/^[a-z0-9_]+$/)
    .default('minecraft'),
  // 字体贴图（生成 PNG + font JSON）
  fonts: z.array(FontEntry).default([]),
  // 音效（生成 sounds.json + 占位 ogg）
  sounds: z.array(SoundEntry).default([]),
  // 贴图覆盖（生成 overrides 贴图 PNG）
  textureOverrides: z.array(TextureOverrideEntry).default([]),
  // 模型覆盖
  models: z.array(ModelEntry).default([]),
  // 语言文件覆盖
  langEnUs: z.record(z.string(), z.string()).default({}),
  langZhCn: z.record(z.string(), z.string()).default({}),
});

// 注：Color 类型已由 ./skin-spec.js 导出，此处不重复导出以避免命名冲突。
export type SoundEntry = z.infer<typeof SoundEntry>;
export type FontEntry = z.infer<typeof FontEntry>;
export type TextureOverrideEntry = z.infer<typeof TextureOverrideEntry>;
export type ModelEntry = z.infer<typeof ModelEntry>;
export type ResourcePackSpec = z.infer<typeof ResourcePackSpec>;
