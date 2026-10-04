/** 数据驱动内容 → JSON 内容 writer（无实例状态）。 */
import type {
  BannerPatternSpec,
  ChatTypeSpec,
  DamageTypeSpec,
  DatapackEnchantmentSpec,
  FileNode,
  InstrumentSpec,
  JukeboxSongSpec,
  PaintingVariantSpec,
  ParticleSpec,
  StatusEffectSpec,
  TrimMaterialSpec,
  TrimPatternSpec,
  WolfVariantSpec,
} from '@mc-creator/shared';
import { sanitizePathSegment } from './common.js';

/** 自定义附魔 → data/<namespace>/enchantment/<id>.json（1.21+） */
export function generateEnchantment(namespace: string, e: DatapackEnchantmentSpec): FileNode {
  // G-4 修复：1.21+ enchantment JSON 的 min_cost/max_cost 必须是 { base, per_level_above_first } 对象
  //（旧实现直接输出数字，codec 解码失败导致附魔无法加载）；min_level 不是合法字段（移除）。
  // min_cost.base 采用 minLevel，per_level_above_first 由 maxCost/maxLevel 推导。
  const perLevel = Math.max(1, Math.round(e.maxCost / e.maxLevel));
  const obj = {
    description: { translate: e.description },
    supported_items: e.supportedItems,
    weight: e.weight,
    anvil_cost: e.anvilCost,
    min_cost: { base: e.minLevel, per_level_above_first: perLevel },
    max_cost: { base: e.maxCost, per_level_above_first: perLevel },
    max_level: e.maxLevel,
    slots: e.slots,
    ...(e.isCurse ? { is_curse: true } : {}),
    ...(e.isTreasure ? { is_treasure: true } : {}),
  };
  return {
    path: `data/${namespace}/enchantment/${sanitizePathSegment(e.id)}.json`,
    content: JSON.stringify(obj, null, 2),
  };
}

/** 自定义状态效果 → data/<namespace>/effect/<id>.json（1.21+） */
export function generateStatusEffect(namespace: string, e: StatusEffectSpec): FileNode {
  const obj = {
    description: { translate: e.description },
    color: e.color,
    ...(e.instant ? { instant: true } : {}),
    ...(e.beneficial ? {} : { beneficial: false }),
  };
  return {
    path: `data/${namespace}/effect/${sanitizePathSegment(e.id)}.json`,
    content: JSON.stringify(obj, null, 2),
  };
}

/** 自定义损伤类型 → data/<namespace>/damage_type/<id>.json（1.19.4+） */
export function generateDamageType(namespace: string, d: DamageTypeSpec): FileNode {
  // G-4 修复：1.20.5+ damage_type 字段名为 message_id（非 message_type），
  // scaling 取值无命名空间前缀（never/when_caused_by_living_non_player/always）。
  const obj = {
    message_id: d.messageType,
    scaling: d.scaling,
    exhaustion: d.exhaustion,
  };
  return {
    path: `data/${namespace}/damage_type/${sanitizePathSegment(d.id)}.json`,
    content: JSON.stringify(obj, null, 2),
  };
}

/** 自定义粒子 → data/<namespace>/particle/<id>.json */
export function generateParticle(namespace: string, p: ParticleSpec): FileNode {
  const obj = {
    description: { translate: p.description },
    ...(p.override ? { override: true } : {}),
  };
  return {
    path: `data/${namespace}/particle/${sanitizePathSegment(p.id)}.json`,
    content: JSON.stringify(obj, null, 2),
  };
}

/** 盔甲纹饰 → data/<namespace>/trim_pattern/<id>.json（1.20+） */
export function generateTrimPattern(namespace: string, t: TrimPatternSpec): FileNode {
  const obj = {
    template_item: t.templateItem,
    description: { translate: t.description },
    decal: t.decal,
  };
  return {
    path: `data/${namespace}/trim_pattern/${sanitizePathSegment(t.id)}.json`,
    content: JSON.stringify(obj, null, 2),
  };
}

/** 盔甲材质 → data/<namespace>/trim_material/<id>.json（1.20+） */
export function generateTrimMaterial(namespace: string, t: TrimMaterialSpec): FileNode {
  const obj = {
    material_item: t.materialItem,
    color: t.color,
    description: { translate: t.description },
  };
  return {
    path: `data/${namespace}/trim_material/${sanitizePathSegment(t.id)}.json`,
    content: JSON.stringify(obj, null, 2),
  };
}

/** 乐器 → data/<namespace>/instrument/<id>.json（1.19+） */
export function generateInstrument(namespace: string, i: InstrumentSpec): FileNode {
  const obj: Record<string, unknown> = {
    sound_event: i.soundEvent,
    use_duration: i.useDuration,
    range: i.range,
  };
  if (i.description) obj.description = { translate: i.description };
  return {
    path: `data/${namespace}/instrument/${sanitizePathSegment(i.id)}.json`,
    content: JSON.stringify(obj, null, 2),
  };
}

/** 唱片机歌曲 → data/<namespace>/jukebox_song/<id>.json（1.21+） */
export function generateJukeboxSong(namespace: string, js: JukeboxSongSpec): FileNode {
  const obj: Record<string, unknown> = {
    song_item: js.songItem,
    sound_event: js.soundEvent,
    length_in_seconds: js.lengthInSeconds,
    comparator_output: js.comparatorOutput,
  };
  if (js.description) {
    obj.description = js.description;
  }
  return {
    path: `data/${namespace}/jukebox_song/${sanitizePathSegment(js.id)}.json`,
    content: JSON.stringify(obj, null, 2),
  };
}

/** 画作变体 → data/<namespace>/painting_variant/<id>.json（1.21+） */
export function generatePaintingVariant(namespace: string, pv: PaintingVariantSpec): FileNode {
  const obj = {
    asset_id: pv.assetId,
    width: pv.width,
    height: pv.height,
  };
  return {
    path: `data/${namespace}/painting_variant/${sanitizePathSegment(pv.id)}.json`,
    content: JSON.stringify(obj, null, 2),
  };
}

/** 狼变体 → data/<namespace>/wolf_variant/<id>.json（1.21+） */
export function generateWolfVariant(namespace: string, wv: WolfVariantSpec): FileNode {
  const obj: Record<string, unknown> = {
    wild_texture: wv.wildTexture,
    tame_texture: wv.tameTexture,
    angry_texture: wv.angryTexture,
  };
  if (wv.biomes) {
    obj.biomes = wv.biomes;
  }
  return {
    path: `data/${namespace}/wolf_variant/${sanitizePathSegment(wv.id)}.json`,
    content: JSON.stringify(obj, null, 2),
  };
}

/** 旗帜图案 → data/<namespace>/banner_pattern/<id>.json（1.21+） */
export function generateBannerPattern(namespace: string, bp: BannerPatternSpec): FileNode {
  const obj: Record<string, unknown> = {
    asset_id: bp.assetId,
  };
  if (bp.translationKey) {
    obj.translation_key = bp.translationKey;
  }
  return {
    path: `data/${namespace}/banner_pattern/${sanitizePathSegment(bp.id)}.json`,
    content: JSON.stringify(obj, null, 2),
  };
}

/** 聊天类型 → data/<namespace>/chat_type/<id>.json（1.20.3+） */
export function generateChatType(namespace: string, ct: ChatTypeSpec): FileNode {
  // schema 用 camelCase（translationKey/parameters），MC JSON 需 snake_case（translation_key）
  const chat = {
    translation_key: ct.chat.translationKey,
    parameters: ct.chat.parameters,
  };
  const narration = {
    translation_key: ct.narration.translationKey,
    parameters: ct.narration.parameters,
  };
  const obj = { chat, narration };
  return {
    path: `data/${namespace}/chat_type/${sanitizePathSegment(ct.id)}.json`,
    content: JSON.stringify(obj, null, 2),
  };
}
