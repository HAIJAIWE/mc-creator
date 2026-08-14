import type {
  FileNode,
  GeneratorContext,
  GenerationResult,
  Loader,
  McVersion,
} from '@mc-creator/shared';
import { MC_VERSIONS } from '@mc-creator/shared';
import { BehaviorEntitySpec, type BpCustomEntitySpec, type BpGoalSpec } from '@mc-creator/shared';
import type { BehaviorEntitySpec as BehaviorEntitySpecType } from '@mc-creator/shared';
import type { Generator } from '../types.js';
import {
  createBuffer,
  encodePng,
  fillGradient,
  setPixel,
  hexToRgb,
  type PixelBuffer,
} from '../../utils/png-encoder.js';

/** 生成简单 UUID v4（基岩版 manifest 需要） */
function generateUUID(): string {
  const b = Buffer.alloc(16);
  for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = b.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** 行为类型 → 基岩版行为组件名 */
const GOAL_COMPONENT: Record<BpGoalSpec['type'], string> = {
  melee: 'minecraft:behavior.melee_attack',
  ranged: 'minecraft:behavior.ranged_attack',
  idle_wander: 'minecraft:behavior.random_stroll',
  look_at_player: 'minecraft:behavior.look_at_player',
  flee_sun: 'minecraft:behavior.flee_sun',
  swim: 'minecraft:behavior.float',
  follow_owner: 'minecraft:behavior.follow_owner',
  panic: 'minecraft:behavior.panic',
};

/** 行为类型显示标签 */
const GOAL_LABEL: Record<BpGoalSpec['type'], string> = {
  melee: '近战',
  ranged: '远程',
  idle_wander: '游荡',
  look_at_player: '注视',
  flee_sun: '避日',
  swim: '游泳',
  follow_owner: '跟随',
  panic: '恐慌',
};

/**
 * BehaviorEntityGenerator：基岩版自定义实体（怪物 AI）生成器。
 *
 * 输出同时包含行为包（BP）与资源包（RP）文件，分别放入基岩版的
 * behavior_packs / resource_packs 目录：
 * - manifest.json（行为包清单）
 * - entities/<id>.behavior.json（实体行为：生命/攻击/移动/AI goals/掉落）
 * - loot_tables/entities/<id>.json（掉落表）
 * - entity/<id>.client_entity.json（客户端实体：内置几何 + 自动纹理 + 生成蛋）
 * - textures/entity/<id>.png（64x64 单色系实体纹理，自动生成）
 * - texts/zh_CN.lang 与 en_US.lang（实体名称本地化）
 *
 * 行为包无需编译，buildCmd 返回空字符串。
 */
export class BehaviorEntityGenerator implements Generator {
  readonly type = 'behavior_entity';
  readonly loaders: Loader[] = ['vanilla'];
  readonly versions: McVersion[] = [...MC_VERSIONS];

  async generate(ctx: GeneratorContext): Promise<GenerationResult> {
    const spec = BehaviorEntitySpec.parse(ctx.spec as unknown as BehaviorEntitySpecType);

    const files: FileNode[] = [];
    const warnings: string[] = [];

    files.push(this.generateManifest(spec));

    for (const entity of spec.entities) {
      files.push({
        path: `entities/${entity.id}.behavior.json`,
        content: this.generateBehaviorFile(spec, entity, warnings),
      });
      files.push({
        path: `entity/${entity.id}.client_entity.json`,
        content: this.generateClientEntityFile(spec, entity),
      });
      files.push({
        path: `textures/entity/${entity.id}.png`,
        content: this.generateEntityTexture(entity).toString('base64'),
      });
      if (entity.drops.length > 0) {
        files.push({
          path: `loot_tables/entities/${entity.id}.json`,
          content: this.generateLootTable(entity),
        });
      }
    }

    const langFiles = this.generateLangFiles(spec);
    for (const f of langFiles) {
      files.push(f);
    }

    if (spec.entities.length === 0) {
      warnings.push('未生成任何实体：spec 中 entities 列表为空');
    }

    return {
      files,
      warnings: [
        '输出同时包含行为包与资源包文件，请将 manifest.json 所在根目录分别放入 behavior_packs 与 resource_packs（包根结构不同，需复制两份）',
        ...warnings,
      ],
      buildCmd: '',
    };
  }

  /** 生成 manifest.json */
  private generateManifest(spec: BehaviorEntitySpecType): FileNode {
    const headerUuid = spec.header.uuid || generateUUID();
    const moduleUuid = generateUUID();
    const version = spec.header.version ?? [1, 0, 0];
    const minEngine = spec.header.min_engine_version ?? spec.mcVersion;
    const manifest = {
      format_version: spec.packFormat,
      header: {
        name: spec.header.name || spec.packName,
        description: spec.header.description || spec.description || 'Custom Entities Pack',
        uuid: headerUuid,
        version,
        min_engine_version: minEngine,
      },
      modules: [
        {
          type: 'data',
          uuid: moduleUuid,
          version,
        },
      ],
      dependencies: spec.dependencies,
    };
    return {
      path: 'manifest.json',
      content: JSON.stringify(manifest, null, 2) + '\n',
    };
  }

  /** 生成实体行为文件 entities/<id>.behavior.json */
  private generateBehaviorFile(
    spec: BehaviorEntitySpecType,
    entity: BpCustomEntitySpec,
    warnings: string[],
  ): string {
    const components: Record<string, unknown> = {
      'minecraft:type_family': { family: [entity.id] },
      'minecraft:health': { value: entity.health, max: entity.health },
      'minecraft:movement': { value: entity.movementSpeed },
      'minecraft:movement.basic': {},
      'minecraft:collision_box': {
        width: Math.round(entity.scale * 0.6 * 100) / 100,
        height: Math.round(entity.scale * 1.8 * 100) / 100,
      },
      'minecraft:nameable': {},
      'minecraft:physics': {},
      'minecraft:pushable': { is_pushable: true, is_pushable_by_piston: true },
      'minecraft:despawn': {
        despawn_from_distance: entity.despawn
          ? { min_distance: 128, max_distance: 256 }
          : { in_despawn_table: false },
      },
    };

    if (entity.scale !== 1) {
      components['minecraft:scale'] = { value: entity.scale };
    }
    if (entity.attackDamage > 0) {
      components['minecraft:attack'] = { damage: entity.attackDamage };
    }
    if (entity.knockbackResistance > 0) {
      components['minecraft:knockback_resistance'] = { value: entity.knockbackResistance };
    }
    if (entity.fireImmune) {
      components['minecraft:fire_immune'] = {};
    }
    components['minecraft:experience_reward'] = { on_death: entity.xp };

    // AI goals
    const hasRanged = entity.goals.some((g) => g.type === 'ranged');
    if (hasRanged) {
      components['minecraft:shooter'] = { def: 'minecraft:arrow' };
    }
    for (const goal of entity.goals) {
      const componentName = GOAL_COMPONENT[goal.type];
      components[componentName] = this.goalToComponent(goal);
    }

    // 敌对目标寻找
    if (entity.hostile && entity.attackDamage > 0) {
      const range = entity.goals.find((g) => g.type === 'ranged')?.attackRange ?? 16;
      components['minecraft:behavior.nearest_attackable_target'] = {
        priority: 2,
        must_see: true,
        reselect_targets: true,
        entity_types: entity.targetTypes.map((family) => ({
          filters: {
            any_of: [
              {
                test: 'is_family',
                subject: 'other',
                value: family,
              },
            ],
          },
          max_dist: range,
        })),
      };
    }

    // 自定义组件（覆盖同名时警告）
    for (const custom of entity.customComponents) {
      const key = Object.keys(custom)[0];
      if (key) {
        if (components[key] !== undefined) {
          warnings.push(`实体 ${entity.id} 的 customComponents 覆盖了组件 ${key}`);
        }
        components[key] = custom[key];
      }
    }

    const json: Record<string, unknown> = {
      format_version: '1.21.0',
      'minecraft:entity': {
        description: {
          identifier: `${spec.packId}:${entity.id}`,
          is_spawnable: true,
          is_summonable: true,
          is_experimental: false,
        },
        components,
      },
    };

    // 自定义事件
    if (Object.keys(entity.customEvents).length > 0) {
      (json['minecraft:entity'] as Record<string, unknown>).events = entity.customEvents;
    }

    return JSON.stringify(json, null, 2) + '\n';
  }

  /** 单个 goal → 行为组件 JSON */
  private goalToComponent(goal: BpGoalSpec): Record<string, unknown> {
    const base: Record<string, unknown> = { priority: goal.priority };
    switch (goal.type) {
      case 'melee':
        return {
          ...base,
          speed_multiplier: goal.speedMultiplier,
          track_target: true,
          require_complete_path: false,
          ...goal.extra,
        };
      case 'ranged':
        return {
          ...base,
          speed_multiplier: goal.speedMultiplier,
          attack_interval_min: Math.max(0.5, (goal.attackInterval ?? 2) * 0.5),
          attack_interval_max: goal.attackInterval ?? 2,
          attack_radius: goal.attackRange ?? 16,
          ...(goal.extra ?? {}),
        };
      case 'idle_wander':
        return { ...base, speed_multiplier: goal.speedMultiplier, ...(goal.extra ?? {}) };
      case 'look_at_player':
        return {
          ...base,
          look_distance: 8,
          probability: 0.02,
          ...(goal.extra ?? {}),
        };
      case 'flee_sun':
        return { ...base, speed_multiplier: goal.speedMultiplier, ...(goal.extra ?? {}) };
      case 'swim':
        return { ...base, ...(goal.extra ?? {}) };
      case 'follow_owner':
        return {
          ...base,
          speed_multiplier: goal.speedMultiplier,
          start_distance: 10,
          stop_distance: 2,
          ...(goal.extra ?? {}),
        };
      case 'panic':
        return { ...base, speed_multiplier: goal.speedMultiplier, ...(goal.extra ?? {}) };
      default:
        return base;
    }
  }

  /** 生成客户端实体 entity/<id>.client_entity.json */
  private generateClientEntityFile(
    spec: BehaviorEntitySpecType,
    entity: BpCustomEntitySpec,
  ): string {
    const json = {
      format_version: '1.10.0',
      'minecraft:client_entity': {
        description: {
          identifier: `${spec.packId}:${entity.id}`,
          materials: { default: 'entity_alphatest' },
          textures: { default: `textures/entity/${entity.id}` },
          geometry: { default: `geometry.${entity.geometry}` },
          render_controllers: ['controller.render.default'],
          spawn_egg: {
            base_color: entity.eggColor ?? entity.mainColor,
            overlay_color: entity.eggColor ?? entity.accentColor,
          },
        },
      },
    };
    return JSON.stringify(json, null, 2) + '\n';
  }

  /** 生成 64x64 实体纹理：主色渐变 + 辅色眼睛与描边 */
  private generateEntityTexture(entity: BpCustomEntitySpec): Buffer {
    const buf = createBuffer(64, 64);
    const [r1, g1, b1] = hexToRgb(entity.mainColor);
    const [r2, g2, b2] = hexToRgb(this.darken(entity.mainColor));
    fillGradient(buf, r1, g1, b1, r2, g2, b2);

    // 眼睛（辅色）：左侧 8x8（前脸）与右侧 8x8（后脑）位置画两个色块
    const [er, eg, eb] = hexToRgb(entity.accentColor);
    this.fillRect(buf, 14, 26, 8, 8, er, eg, eb);
    this.fillRect(buf, 42, 26, 8, 8, er, eg, eb);

    return encodePng(buf);
  }

  /** 生成掉落表 loot_tables/entities/<id>.json */
  private generateLootTable(entity: BpCustomEntitySpec): string {
    const json = {
      pools: [
        {
          rolls: 1,
          entries: entity.drops.map((d) => ({
            type: 'item',
            name: d.item,
            weight: Math.max(1, Math.round((1 - d.chance) * 100)),
            functions:
              d.count > 1
                ? [
                    {
                      function: 'set_count',
                      count: { min: 1, max: d.count },
                    },
                  ]
                : [],
          })),
        },
      ],
    };
    return JSON.stringify(json, null, 2) + '\n';
  }

  /** 生成语言文件（texts/zh_CN.lang 与 en_US.lang） */
  private generateLangFiles(spec: BehaviorEntitySpecType): FileNode[] {
    const linesFor = (locale: string): string[] => {
      const lines: string[] = [`## ${spec.packName || spec.packId}`, ''];
      const entries: Record<string, string> = {};
      for (const entity of spec.entities) {
        entries[`entity.${spec.packId}:${entity.id}.name`] = entity.name;
      }
      const userLang = spec.lang[locale] ?? {};
      const merged = { ...entries, ...userLang };
      for (const [k, v] of Object.entries(merged)) {
        lines.push(`${k}=${v}`);
      }
      return lines;
    };

    const zhLines = linesFor('zh_CN');
    const enLines = linesFor('en_US');
    return [
      { path: 'texts/zh_CN.lang', content: zhLines.join('\n') + '\n' },
      { path: 'texts/en_US.lang', content: enLines.join('\n') + '\n' },
    ];
  }

  private fillRect(
    buf: PixelBuffer,
    x: number,
    y: number,
    w: number,
    h: number,
    r: number,
    g: number,
    b: number,
  ): void {
    for (let dy = 0; dy < h; dy++) {
      for (let dx = 0; dx < w; dx++) {
        setPixel(buf, x + dx, y + dy, r, g, b);
      }
    }
  }

  private darken(hex: string): string {
    const [r, g, b] = hexToRgb(hex);
    const h = (n: number) =>
      Math.round(n * 0.6)
        .toString(16)
        .padStart(2, '0');
    return `#${h(r)}${h(g)}${h(b)}`;
  }
}
