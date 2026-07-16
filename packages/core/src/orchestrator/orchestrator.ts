import {
  ModSpec,
  DatapackSpec,
  ModpackSpec,
  ServerSpec,
  SkinSpec,
  ResourcePackSpec,
  LauncherSpec,
  type ModSpec as ModSpecType,
} from '@mc-creator/shared';
import type { ModelProvider } from '../model-provider/types.js';
import type { ZodTypeAny } from 'zod';

const MAX_RETRIES = 3;

/** 生成器类型 → 对应 schema 与 prompt 描述（与 desktop 层 GENERATOR_TYPES 对齐） */
export type SpecType = 'mod' | 'datapack' | 'modpack' | 'server' | 'resource_pack' | 'skin' | 'launcher';

interface SpecConfig {
  schema: ZodTypeAny;
  prompt: string;
}

const SPEC_CONFIGS: Record<SpecType, SpecConfig> = {
  mod: {
    schema: ModSpec,
    prompt: `你是 Minecraft Mod 规格生成器。根据描述生成 loader 无关的 ModSpec JSON。
Schema 字段：
- modId: 小写下划线 ^[a-z0-9_]+$
- version: 版本号（默认 1.0.0）
- name: 显示名
- description: 描述
- items[]: 物品列表（id, name, maxStackSize 1-64, rarity common/uncommon/rare/epic, maxDamage, fuelTick, lore）
- blocks[]: 方块列表（id, name, material wood/stone/metal/rock, hardness, miningLevel, lightLevel 0-15, resistance, soundType, dropSelf, dropItem）
- license: 默认 MIT
- authors[]: 作者
- dependencies[]: 依赖（modId, version, mandatory）
只输出 JSON，不要解释。`,
  },
  datapack: {
    schema: DatapackSpec,
    prompt: `你是 Minecraft 数据包规格生成器。根据描述生成 DatapackSpec JSON。
Schema 字段：
- namespace: 小写下划线（默认 minecraft）
- packFormat: 数字（1.21.x 用 48）
- recipes[]: 配方（type shaped/shapeless/smelting, output, items[]）
- tags[]: 标签（namespace, path, values[], replace）
- functions[]: 函数（namespace, path, commands）
- advancements[]: 进度（namespace, path, display, criteria）
- lootTables[]: 战利品表（namespace, path, type, pools[]）
- predicates[]: 谓词（namespace, path, condition）
- itemTags[] / blockTags[]: 物品/方块标签
只输出 JSON，不要解释。`,
  },
  modpack: {
    schema: ModpackSpec,
    prompt: `你是 Minecraft 整合包规格生成器。根据描述生成 ModpackSpec JSON。
Schema 字段：
- name: 整合包名
- version: 版本
- author: 作者
- mcVersion: MC 版本（如 1.21.1）
- loader: fabric 或 neoforge
- format: modrinth 或 curseforge
- mods[]: 模组列表（id, name, version, source modrinth/curseforge/url）
- credits: 致谢
- overrides[]: 覆盖文件（path, content）
- serverOverrides[]: 服务器覆盖文件
- launchMessage: 启动消息
只输出 JSON，不要解释。`,
  },
  server: {
    schema: ServerSpec,
    prompt: `你是 Minecraft 服务器配置规格生成器。根据描述生成 ServerSpec JSON。
Schema 字段：
- serverName: 服务器名
- mcVersion: MC 版本
- motd: MOTD
- maxPlayers: 最大玩家数
- port: 端口（默认 25565）
- gamemode: survival/creative/adventure/spectator
- difficulty: peaceful/easy/normal/hard
- levelName: 世界名
- pvp, onlineMode, whitelist: 布尔
- viewDistance, simulationDistance: 数字
- ops[]: OP 列表（name, level 1-4）
- whitelistEntries[]: 白名单（name, uuid）
- mods[]: 服务端模组（id, version, source）
- eula: 布尔（默认 true）
- startMemory, maxMemory: 内存（如 2G, 4G）
- deployTarget: none/systemd/docker/both
- backupInterval: 备份间隔小时（0=不备份）
- restartOnCrash: 崩溃自动重启
只输出 JSON，不要解释。`,
  },
  resource_pack: {
    schema: ResourcePackSpec,
    prompt: `你是 Minecraft 资源包规格生成器。根据描述生成 ResourcePackSpec JSON。
Schema 字段：
- packName: 资源包名
- packDescription: 描述
- packFormat: 数字（1.21.x 用 34）
- namespace: 小写下划线（默认 minecraft）
- fonts[]: 字体（id, char, texture, width, height, advance, ascent）
- sounds[]: 音效（id, event, volume 0-1, pitch 0-2, stream）
- textureOverrides[]: 贴图覆盖（path, color #RRGGBB, width, height, gradientTo?, checkerboard?）
- models[]: 模型覆盖（path, json, autoCubeAll, textureName）
- langEnUs / langZhCn: 语言覆盖（键值对对象）
颜色用 #RRGGBB 格式。只输出 JSON，不要解释。`,
  },
  skin: {
    schema: SkinSpec,
    prompt: `你是 Minecraft 皮肤规格生成器。根据描述生成 SkinSpec JSON。
Schema 字段：
- playerName: 玩家名
- model: classic 或 slim（Alex 风格手臂 3px）
- skinColor: 皮肤色 #RRGGBB
- hairColor: 头发色
- shirtColor: 上衣色
- pantsColor: 裤子色
- shoesColor: 鞋子色
- generatePreview: 是否生成预览图
颜色用 #RRGGBB 格式。只输出 JSON，不要解释。`,
  },
  launcher: {
    schema: LauncherSpec,
    prompt: `你是 Minecraft 启动器配置规格生成器。根据描述生成 LauncherSpec JSON。
Schema 字段：
- launcherName: 启动器名
- launcherType: official/pcl2/hmcl（默认 official）
- profileName: 配置名（默认 default）
- mcVersion: MC 版本
- loader: fabric/neoforge/quilt/legacy_fabric/vanilla（默认 vanilla）
- javaPath: Java 路径（默认空）
- jvmArgs: JVM 参数（默认 -Xmx2G -Xms1G）
- memoryMin: 最小内存 MB（默认 1024）
- memoryMax: 最大内存 MB（默认 2048）
- accountType: offline/microsoft（默认 offline）
- username: 用户名（默认 Player）
- uuid: UUID（默认空）
- serverAutorun: 服务器自动加入地址（默认空）
- fullscreen: 是否全屏（默认 false）
- resolutionWidth: 分辨率宽（默认 854）
- resolutionHeight: 分辨率高（默认 480）
只输出 JSON，不要解释。`,
  },
};

/**
 * AI 编排器（规格 §2.4）：spec-first 流程的薄编排层。
 * 负责调用模型 → JSON Schema 校验 → 失败带错误回灌重试。
 */
export class Orchestrator {
  constructor(private provider: ModelProvider) {}

  async generateModSpec(description: string): Promise<ModSpecType> {
    let lastError = '';
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      const prompt = this.buildPrompt(description, lastError);
      const raw = await this.provider.complete(prompt);
      const parsed = this.tryParse(raw);
      if (parsed.ok) {
        const result = ModSpec.safeParse(parsed.value);
        if (result.success) return result.data;
        lastError = result.error.message;
      } else {
        lastError = parsed.error;
      }
    }
    throw new Error(`ModSpec 校验失败（重试 ${MAX_RETRIES} 次）：${lastError}`);
  }

  /** 按 generatorType 生成对应 Spec（P16：优化 prompt，按类型注入 schema 约束） */
  async generateSpecByType(description: string, generatorType: SpecType): Promise<unknown> {
    const config = SPEC_CONFIGS[generatorType];
    if (!config) throw new Error(`不支持的生成器类型：${generatorType}`);
    let lastError = '';
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      const prompt = this.buildTypedPrompt(description, config.prompt, lastError);
      const raw = await this.provider.complete(prompt);
      const parsed = this.tryParse(raw);
      if (parsed.ok) {
        const result = config.schema.safeParse(parsed.value);
        if (result.success) return result.data;
        lastError = result.error.message;
      } else {
        lastError = parsed.error;
      }
    }
    throw new Error(`${generatorType} Spec 校验失败（重试 ${MAX_RETRIES} 次）：${lastError}`);
  }

  private buildPrompt(desc: string, err: string): string {
    const base = `你是 Minecraft mod 规格生成器。根据描述生成 loader 无关的 ModSpec JSON。
描述：${desc}
只输出 JSON，不要解释。Schema：modId(小写下划线), version, name, description, items[], blocks[]。`;
    return err ? `${base}\n上次错误：${err}\n请修正。` : base;
  }

  private buildTypedPrompt(desc: string, schemaPrompt: string, err: string): string {
    const base = `${schemaPrompt}

用户描述：${desc}

只输出合法 JSON，不要 markdown 代码块，不要解释。`;
    return err ? `${base}\n\n上次错误：${err}\n请修正后重新输出完整 JSON。` : base;
  }

  private tryParse(raw: string): { ok: true; value: unknown } | { ok: false; error: string } {
    try {
      return { ok: true, value: JSON.parse(raw) };
    } catch (e) {
      return { ok: false, error: `JSON 解析失败：${(e as Error).message}` };
    }
  }
}
