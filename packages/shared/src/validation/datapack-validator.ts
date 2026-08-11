/**
 * 数据包校验器：验证 DatapackSpec 的结构、字段范围、pack_format 兼容性。
 * 返回结构化的校验结果（错误 + 警告），供 UI 展示。
 */

import type {
  DatapackSpec,
  RecipeSpec,
  DimensionTypeSpec,
  BiomeSpec,
  DimensionSpec,
  DatapackEnchantmentSpec,
  StatusEffectSpec,
  StructureSpec,
} from '../schemas/datapack-spec.js';

/** 校验级别 */
export type ValidationLevel = 'error' | 'warning' | 'info';

/** 校验结果条目 */
export interface ValidationIssue {
  level: ValidationLevel;
  /** 内容类型（如 'recipe', 'biome', 'dimension'） */
  type: string;
  /** 内容 ID */
  id: string;
  /** 字段路径（如 'temperature', 'cookingTime'） */
  field: string;
  /** 问题描述 */
  message: string;
}

/** 校验结果 */
export interface ValidationResult {
  valid: boolean;
  issues: ValidationIssue[];
  /** 按级别统计 */
  summary: { errors: number; warnings: number; infos: number };
}

/** pack_format 与 MC 版本对应表 */
const PACK_FORMAT_MAP: Record<number, string> = {
  4: '1.13–1.14.4',
  5: '1.15–1.16.1',
  6: '1.16.2–1.16.5',
  7: '1.17–1.17.1',
  8: '1.18–1.18.2',
  9: '1.19–1.19.2',
  10: '1.19.3',
  11: '1.19.3',
  12: '1.19.4',
  13: '1.19.4',
  14: '1.20–1.20.1',
  15: '1.20.2',
  16: '1.20.3–1.20.4',
  22: '1.20.5–1.20.6',
  26: '1.21–1.21.1',
  28: '1.21.2–1.21.3',
  32: '1.21.4',
  34: '1.21.5',
  42: '1.21.6',
  48: '1.21.7+',
};

/** MC 版本 → 数据包 pack_format（与 PACK_FORMAT_MAP 反向，新增 MC 版本时同步维护） */
const MC_VERSION_TO_PACK_FORMAT: Record<string, number> = {
  '1.20.1': 14, // 1.20–1.20.1
  '1.20.2': 15,
  '1.20.3': 16,
  '1.20.4': 16,
  '1.20.5': 22,
  '1.20.6': 22,
  '1.21.1': 26,
  '1.21.2': 28,
  '1.21.3': 28,
  '1.21.4': 32,
  '1.21.5': 34,
  '1.21.6': 42,
  '1.21.11': 48,
  '26.1': 48, // 26.x 沿用 1.21.7+ 的 48（低版本号始终可被新游戏加载）
  '26.2': 48,
};

/**
 * 按 MC 版本推断数据包 pack_format；未知版本返回 undefined。
 * 生成器用它覆盖 spec 里的默认/占位值，确保 pack.mcmeta 与目标版本匹配。
 */
export function getPackFormatForMcVersion(mcVersion: string): number | undefined {
  return MC_VERSION_TO_PACK_FORMAT[mcVersion];
}

/**
 * 校验整个 DatapackSpec
 */
export function validateDatapack(spec: DatapackSpec): ValidationResult {
  const issues: ValidationIssue[] = [];

  // pack_format 校验
  if (!PACK_FORMAT_MAP[spec.packFormat]) {
    issues.push({
      level: 'warning',
      type: 'pack',
      id: spec.packId,
      field: 'packFormat',
      message: `pack_format ${spec.packFormat} 不在已知版本映射表中，可能不兼容当前 MC 版本`,
    });
  }

  // 配方校验
  for (const recipe of spec.recipes ?? []) {
    validateRecipe(recipe, issues);
  }

  // 维度类型校验
  for (const dt of spec.dimensionTypes ?? []) {
    validateDimensionType(dt, issues);
  }

  // 生物群系校验
  for (const biome of spec.biomes ?? []) {
    validateBiome(biome, issues);
  }

  // 维度校验
  for (const dim of spec.dimensions ?? []) {
    validateDimension(dim, issues);
  }

  // 附魔校验
  for (const ench of spec.enchantments ?? []) {
    validateEnchantment(ench, issues);
  }

  // 效果校验
  for (const eff of spec.effects ?? []) {
    validateStatusEffect(eff, issues);
  }

  // 结构校验
  for (const st of spec.structures ?? []) {
    validateStructure(st, issues);
  }

  // pack_format 与内容类型兼容性
  validatePackFormatCompatibility(spec, issues);

  const errors = issues.filter((i) => i.level === 'error').length;
  const warnings = issues.filter((i) => i.level === 'warning').length;
  const infos = issues.filter((i) => i.level === 'info').length;

  return { valid: errors === 0, issues, summary: { errors, warnings, infos } };
}

/** 配方校验 */
function validateRecipe(r: RecipeSpec, issues: ValidationIssue[]): void {
  // ID 格式
  if (!/^[a-z0-9_]+$/.test(r.id)) {
    issues.push({
      level: 'error',
      type: 'recipe',
      id: r.id,
      field: 'id',
      message: '配方 ID 只允许小写字母、数字和下划线',
    });
  }

  // 有形合成必须提供 pattern 和 key
  if (r.type === 'crafting_shaped') {
    if (!r.pattern || r.pattern.length === 0) {
      issues.push({
        level: 'error',
        type: 'recipe',
        id: r.id,
        field: 'pattern',
        message: '有形合成必须提供 pattern',
      });
    }
    if (!r.key || Object.keys(r.key).length === 0) {
      issues.push({
        level: 'error',
        type: 'recipe',
        id: r.id,
        field: 'key',
        message: '有形合成必须提供 key',
      });
    }
    // 检查 pattern 中引用的字符是否在 key 中定义
    if (r.pattern && r.key) {
      const usedChars = new Set(r.pattern.join('').replace(/ /g, '').split(''));
      const definedChars = new Set(Object.keys(r.key));
      for (const ch of usedChars) {
        if (!definedChars.has(ch)) {
          issues.push({
            level: 'error',
            type: 'recipe',
            id: r.id,
            field: 'key',
            message: `pattern 引用了未定义的字符 '${ch}'`,
          });
        }
      }
    }
    // S-15 修复：校验 pattern 各行字符数一致，且不超过 3 行 3 列（原版合成限制）
    if (r.pattern && r.pattern.length > 0) {
      const firstWidth = r.pattern[0].length;
      if (r.pattern.some((row) => row.length !== firstWidth)) {
        issues.push({
          level: 'error',
          type: 'recipe',
          id: r.id,
          field: 'pattern',
          message: 'pattern 各行的字符数必须一致',
        });
      }
      if (r.pattern.length > 3 || firstWidth > 3) {
        issues.push({
          level: 'error',
          type: 'recipe',
          id: r.id,
          field: 'pattern',
          message: '有形合成 pattern 最多 3 行、每行最多 3 个字符',
        });
      }
    }
  }

  // 无形合成必须提供 ingredients
  if (r.type === 'crafting_shapeless' && (!r.ingredients || r.ingredients.length === 0)) {
    issues.push({
      level: 'error',
      type: 'recipe',
      id: r.id,
      field: 'ingredients',
      message: '无形合成必须提供 ingredients',
    });
  }

  // 熔炼类必须提供 ingredient
  if (['smelting', 'blasting', 'smoking', 'campfire_cooking'].includes(r.type)) {
    if (!r.ingredient) {
      issues.push({
        level: 'error',
        type: 'recipe',
        id: r.id,
        field: 'ingredient',
        message: `${r.type} 配方必须提供 ingredient`,
      });
    }
    if (r.experience < 0) {
      issues.push({
        level: 'error',
        type: 'recipe',
        id: r.id,
        field: 'experience',
        message: '经验值不能为负',
      });
    }
    if (r.cookingTime < 1) {
      issues.push({
        level: 'error',
        type: 'recipe',
        id: r.id,
        field: 'cookingTime',
        message: '烹饪时间必须 ≥ 1 tick',
      });
    }
  }

  // 锻造台必须提供 template/base/addition
  if (r.type === 'smithing_transform') {
    // S-6 修复：补检 template（此前漏检，缺 template 时生成无效配方）
    if (!r.template)
      issues.push({
        level: 'error',
        type: 'recipe',
        id: r.id,
        field: 'template',
        message: 'smithing_transform 必须提供 template',
      });
    if (!r.base)
      issues.push({
        level: 'error',
        type: 'recipe',
        id: r.id,
        field: 'base',
        message: 'smithing_transform 必须提供 base',
      });
    if (!r.addition)
      issues.push({
        level: 'error',
        type: 'recipe',
        id: r.id,
        field: 'addition',
        message: 'smithing_transform 必须提供 addition',
      });
  }

  // 条件配方：检查 condition JSON 格式
  if (r.condition) {
    try {
      const cond = JSON.parse(r.condition);
      if (!cond.type) {
        issues.push({
          level: 'warning',
          type: 'recipe',
          id: r.id,
          field: 'condition',
          message: '条件缺少 type 字段',
        });
      }
    } catch {
      issues.push({
        level: 'error',
        type: 'recipe',
        id: r.id,
        field: 'condition',
        message: 'condition 不是有效 JSON',
      });
    }
  }
}

/** 维度类型校验 */
function validateDimensionType(dt: DimensionTypeSpec, issues: ValidationIssue[]): void {
  if (dt.height < 16 || dt.height > 4096) {
    issues.push({
      level: 'error',
      type: 'dimensionType',
      id: dt.id,
      field: 'height',
      message: '高度必须在 16–4096 之间',
    });
  }
  if (dt.minY < -2032 || dt.minY > 2031) {
    issues.push({
      level: 'error',
      type: 'dimensionType',
      id: dt.id,
      field: 'minY',
      message: 'minY 必须在 -2032–2031 之间',
    });
  }
  if (dt.minY + dt.height > 2032) {
    issues.push({
      level: 'error',
      type: 'dimensionType',
      id: dt.id,
      field: 'minY+height',
      message: 'minY + height 不能超过 2032',
    });
  }
  if (dt.logicalHeight > dt.height) {
    issues.push({
      level: 'warning',
      type: 'dimensionType',
      id: dt.id,
      field: 'logicalHeight',
      message: 'logicalHeight 不应超过 height',
    });
  }
  if (dt.coordinateScale <= 0) {
    issues.push({
      level: 'error',
      type: 'dimensionType',
      id: dt.id,
      field: 'coordinateScale',
      message: '坐标缩放必须 > 0',
    });
  }
}

/** 生物群系校验 */
function validateBiome(b: BiomeSpec, issues: ValidationIssue[]): void {
  if (b.temperature < -2 || b.temperature > 2) {
    issues.push({
      level: 'error',
      type: 'biome',
      id: b.id,
      field: 'temperature',
      message: '温度必须在 -2–2 之间',
    });
  }
  if (b.downfall < 0 || b.downfall > 1) {
    issues.push({
      level: 'error',
      type: 'biome',
      id: b.id,
      field: 'downfall',
      message: '降雨量必须在 0–1 之间',
    });
  }
  // 颜色范围校验（0x000000–0xFFFFFF）
  const maxColor = 0xffffff;
  if (b.skyColor < 0 || b.skyColor > maxColor)
    issues.push({
      level: 'warning',
      type: 'biome',
      id: b.id,
      field: 'skyColor',
      message: '天空颜色超出有效范围',
    });
  if (b.waterColor < 0 || b.waterColor > maxColor)
    issues.push({
      level: 'warning',
      type: 'biome',
      id: b.id,
      field: 'waterColor',
      message: '水颜色超出有效范围',
    });
  if (b.waterFogColor < 0 || b.waterFogColor > maxColor)
    issues.push({
      level: 'warning',
      type: 'biome',
      id: b.id,
      field: 'waterFogColor',
      message: '水雾颜色超出有效范围',
    });
  if (b.fogColor < 0 || b.fogColor > maxColor)
    issues.push({
      level: 'warning',
      type: 'biome',
      id: b.id,
      field: 'fogColor',
      message: '雾颜色超出有效范围',
    });
}

/** 维度校验 */
function validateDimension(d: DimensionSpec, issues: ValidationIssue[]): void {
  if (!d.dimensionType) {
    issues.push({
      level: 'error',
      type: 'dimension',
      id: d.id,
      field: 'dimensionType',
      message: '必须指定维度类型',
    });
  }
  if (d.generatorType === 'noise' && d.biomes.length === 0) {
    issues.push({
      level: 'error',
      type: 'dimension',
      id: d.id,
      field: 'biomes',
      message: 'noise 生成器至少需要 1 个生物群系',
    });
  }
}

/** 附魔校验 */
function validateEnchantment(e: DatapackEnchantmentSpec, issues: ValidationIssue[]): void {
  if (e.minLevel < 1) {
    issues.push({
      level: 'error',
      type: 'enchantment',
      id: e.id,
      field: 'minLevel',
      message: '最小等级必须 ≥ 1',
    });
  }
  if (e.maxLevel < e.minLevel) {
    issues.push({
      level: 'error',
      type: 'enchantment',
      id: e.id,
      field: 'maxLevel',
      message: '最大等级不能小于最小等级',
    });
  }
  if (e.weight < 1 || e.weight > 1024) {
    issues.push({
      level: 'warning',
      type: 'enchantment',
      id: e.id,
      field: 'weight',
      message: '权重建议在 1–1024 之间',
    });
  }
  if (e.anvilCost < 0) {
    issues.push({
      level: 'error',
      type: 'enchantment',
      id: e.id,
      field: 'anvilCost',
      message: '铁砧消耗不能为负',
    });
  }
}

/** 状态效果校验 */
function validateStatusEffect(e: StatusEffectSpec, issues: ValidationIssue[]): void {
  if (e.color < 0 || e.color > 0xffffff) {
    issues.push({
      level: 'warning',
      type: 'effect',
      id: e.id,
      field: 'color',
      message: '颜色超出有效范围 (0x000000–0xFFFFFF)',
    });
  }
}

/** 结构校验 */
function validateStructure(s: StructureSpec, issues: ValidationIssue[]): void {
  if (s.maxDistance < 1 || s.maxDistance > 128) {
    issues.push({
      level: 'warning',
      type: 'structure',
      id: s.id,
      field: 'maxDistance',
      message: '最大距离建议在 1–128 之间',
    });
  }
  if (s.size < 1 || s.size > 128) {
    issues.push({
      level: 'warning',
      type: 'structure',
      id: s.id,
      field: 'size',
      message: '生成范围建议在 1–128 之间',
    });
  }
  // startHeight JSON 校验
  try {
    JSON.parse(s.startHeight);
  } catch {
    issues.push({
      level: 'error',
      type: 'structure',
      id: s.id,
      field: 'startHeight',
      message: 'startHeight 不是有效 JSON',
    });
  }
}

/** pack_format 与内容类型兼容性检查 */
function validatePackFormatCompatibility(spec: DatapackSpec, issues: ValidationIssue[]): void {
  const pf = spec.packFormat;

  // 附魔/效果 需要 pack_format ≥ 26（1.21+）
  if (pf < 26) {
    if (spec.enchantments?.length > 0) {
      issues.push({
        level: 'error',
        type: 'enchantment',
        id: '',
        field: 'packFormat',
        message: `自定义附魔需要 pack_format ≥ 26（1.21+），当前 ${pf}`,
      });
    }
    if (spec.effects?.length > 0) {
      issues.push({
        level: 'error',
        type: 'effect',
        id: '',
        field: 'packFormat',
        message: `自定义效果需要 pack_format ≥ 26（1.21+），当前 ${pf}`,
      });
    }
  }

  // 损伤类型需要 pack_format ≥ 9（1.19.4+）
  if (pf < 9 && spec.damageTypes?.length > 0) {
    issues.push({
      level: 'error',
      type: 'damageType',
      id: '',
      field: 'packFormat',
      message: `损伤类型需要 pack_format ≥ 9（1.19.4+），当前 ${pf}`,
    });
  }

  // 纹饰需要 pack_format ≥ 14（1.20+）
  if (pf < 14) {
    if (spec.trimPatterns?.length > 0 || spec.trimMaterials?.length > 0) {
      issues.push({
        level: 'error',
        type: 'trim',
        id: '',
        field: 'packFormat',
        message: `盔甲纹饰需要 pack_format ≥ 14（1.20+），当前 ${pf}`,
      });
    }
  }

  // 乐器需要 pack_format ≥ 9（1.19+）
  if (pf < 9 && spec.instruments?.length > 0) {
    issues.push({
      level: 'error',
      type: 'instrument',
      id: '',
      field: 'packFormat',
      message: `乐器需要 pack_format ≥ 9（1.19+），当前 ${pf}`,
    });
  }

  // 结构需要 pack_format ≥ 6（1.16.2+）
  if (pf < 6 && spec.structures?.length > 0) {
    issues.push({
      level: 'warning',
      type: 'structure',
      id: '',
      field: 'packFormat',
      message: `自定义结构建议 pack_format ≥ 6（1.16.2+），当前 ${pf}`,
    });
  }

  // 条件配方需要 pack_format ≥ 12（1.19.4+）
  if (pf < 12 && spec.recipes?.some((r) => r.condition)) {
    issues.push({
      level: 'warning',
      type: 'recipe',
      id: '',
      field: 'packFormat',
      message: '条件配方建议 pack_format ≥ 12（1.19.4+）',
    });
  }
}
