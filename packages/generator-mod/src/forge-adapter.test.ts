import { describe, it, expect } from 'vitest';
import { ForgeAdapter } from './forge-adapter.js';
import { ModGenerator } from './mod-generator.js';
import { FOOJAY_RESOLVER_VERSION } from './forge-gradle.js';
import { ModSpec as ModSpecSchema } from '@mc-creator/shared';
import type { GeneratorContext, ModSpec } from '@mc-creator/shared';

// Forge 与 NeoForge 20.1 同版本 API 一致（见 forge-java.ts 说明），
// 此处只验证 Forge 特异部分（构建文件/注册）+ 关键 Java 行为抽查。

const SPEC: ModSpec = ModSpecSchema.parse({
  modId: 'ruby_tools',
  version: '1.0.0',
  name: 'Ruby Tools',
  description: 'Adds ruby tools',
  items: [
    {
      id: 'ruby',
      name: 'Ruby',
      maxStackSize: 64,
      rarity: 'common',
      maxDamage: 0,
      fuelTick: 0,
      lore: '',
    },
  ],
  blocks: [
    {
      id: 'ruby_block',
      name: 'Ruby Block',
      material: 'metal',
      hardness: 5.0,
      miningLevel: 0,
      lightLevel: 0,
      resistance: 6.0,
      soundType: 'stone',
      dropSelf: true,
      dropItem: '',
    },
  ],
  license: 'MIT',
  authors: [],
  credits: '',
  dependencies: [],
  website: '',
});

const CTX: GeneratorContext = {
  loader: 'forge',
  mcVersion: '1.20.1',
  modId: 'ruby_tools',
  spec: SPEC,
  projectPath: '/proj',
};

describe('ForgeAdapter 元数据与构建脚本', () => {
  const adapter = new ForgeAdapter();
  const files = adapter.translate(CTX);

  it('loader 标识为 forge', () => {
    expect(adapter.loader).toBe('forge');
  });

  it('生成 mods.toml（forge 依赖 + javafml）', () => {
    const toml = files.find((f) => f.path === 'src/main/resources/META-INF/mods.toml');
    expect(toml).toBeDefined();
    expect(toml!.content).toContain('modLoader = "javafml"');
    expect(toml!.content).toContain('loaderVersion = "[47,)"');
    expect(toml!.content).toContain('modId = "ruby_tools"');
    expect(toml!.content).toContain('modId = "forge"');
    expect(toml!.content).toContain('versionRange = "[47,)"');
    expect(toml!.content).toContain('versionRange = "[1.20.1,1.21)"');
    expect(toml!.content).not.toContain('modId = "neoforge"');
  });

  it('生成 build.gradle（ForgeGradle 6 + official 映射 + 实测 Forge 版本）', () => {
    const bg = files.find((f) => f.path === 'build.gradle');
    expect(bg).toBeDefined();
    expect(bg!.content).toContain(`id 'net.minecraftforge.gradle' version '6.0.54'`);
    expect(bg!.content).toContain(`mappings channel: 'official', version: '1.20.1'`);
    expect(bg!.content).toContain(`net.minecraftforge:forge:1.20.1-47.4.23`);
    expect(bg!.content).toContain('JavaLanguageVersion.of(17)');
    expect(bg!.content).not.toContain('net.neoforged.moddev');
  });

  it('生成 gradle.properties（含 forge_version 实测值）', () => {
    const gp = files.find((f) => f.path === 'gradle.properties');
    expect(gp).toBeDefined();
    expect(gp!.content).toContain('mc_version=1.20.1');
    expect(gp!.content).toContain('forge_version=47.4.23');
  });

  it('生成 settings.gradle（含 Forge maven 插件仓库）与 wrapper', () => {
    const paths = files.map((f) => f.path);
    expect(paths).toContain('settings.gradle');
    const sg = files.find((f) => f.path === 'settings.gradle');
    expect(sg!.content).toContain('https://maven.minecraftforge.net/');
    expect(paths).toContain('gradle/wrapper/gradle-wrapper.properties');
  });
});

describe('ForgeAdapter toolchain 解析器（settings.gradle）', () => {
  const files = new ForgeAdapter().translate(CTX);
  const sg = files.find((f) => f.path === 'settings.gradle');

  it('build.gradle 用 java.toolchain，故 settings.gradle 必须带 foojay 解析器', () => {
    // 前提：build.gradle 走 java.toolchain（本仓只有 Forge/NeoForge 用 toolchain，
    // fabric/quilt/legacy-fabric 用的是 sourceCompatibility，不需要解析器）
    const bg = files.find((f) => f.path === 'build.gradle');
    expect(bg!.content).toContain('java.toolchain.languageVersion = JavaLanguageVersion.of(17)');
    expect(sg).toBeDefined();
    expect(sg!.content).toContain(
      `id 'org.gradle.toolchains.foojay-resolver-convention' version '${FOOJAY_RESOLVER_VERSION}'`,
    );
  });

  it('foojay 解析器版本钉在实测值 0.10.0（+ Gradle 8.12 验证通过）', () => {
    // 实测：不带这一行 = 干净机器上 "No locally installed toolchains match and
    // toolchain download repositories have not been configured." → BUILD FAILED；
    // 带 0.10.0 则 BUILD SUCCESSFUL 且 Gradle 真的下载了 JDK 17（17.0.20.1+1）。
    // 版本号别随手改，要改先重跑一遍真实构建。
    expect(FOOJAY_RESOLVER_VERSION).toBe('0.10.0');
    expect(sg!.content).toContain("version '0.10.0'");
  });

  it('plugins 块在 pluginManagement 之前（Gradle 要求 settings 的 plugins 块在最前）', () => {
    const pluginsIdx = sg!.content.indexOf('plugins {');
    const pluginManagementIdx = sg!.content.indexOf('pluginManagement {');
    expect(pluginsIdx).toBeGreaterThanOrEqual(0);
    expect(pluginManagementIdx).toBeGreaterThanOrEqual(0);
    expect(pluginsIdx).toBeLessThan(pluginManagementIdx);
    // 且 plugins 块就是文件第一句（前面没有任何 buildscript / pluginManagement）
    expect(sg!.content.startsWith('plugins {')).toBe(true);
  });

  it('既有 pluginManagement 仓库声明完整保留（ForgeGradle 不在 Gradle Portal）', () => {
    // 回归护栏：Forge maven 是 ForgeGradle 插件唯一的解析途径，动它 = 插件拉不到。
    expect(sg!.content).toContain('pluginManagement {');
    expect(sg!.content).toContain('repositories {');
    expect(sg!.content).toContain('gradlePluginPortal()');
    expect(sg!.content).toContain('maven { url "https://maven.minecraftforge.net/" }');
    // pluginManagement 必须仍然完整包住这两条仓库
    const pmBlock = sg!.content.slice(
      sg!.content.indexOf('pluginManagement {'),
      sg!.content.indexOf('rootProject.name'),
    );
    expect(pmBlock).toContain('gradlePluginPortal()');
    expect(pmBlock).toContain('https://maven.minecraftforge.net/');
    expect(sg!.content).toContain("rootProject.name = 'mc-mod'");
  });
});

describe('ForgeAdapter Java（与 NeoForge 20.1 同构）', () => {
  const adapter = new ForgeAdapter();
  const files = adapter.translate(CTX);

  it('生成 @Mod 主类（net.minecraftforge.fml.common.Mod）', () => {
    const main = files.find(
      (f) => f.path === 'src/main/java/com/example/ruby_tools/RubyToolsMod.java',
    );
    expect(main).toBeDefined();
    expect(main!.content).toContain('@Mod("ruby_tools")');
    expect(main!.content).toContain('net.minecraftforge.fml.common.Mod');
    expect(main!.content).toContain('ModItems.register(modEventBus)');
    expect(main!.content).toContain('ModBlocks.register(modEventBus)');
  });

  it('ModItems/ModBlocks 用 DeferredRegister(ForgeRegistries.*)', () => {
    const items = files.find(
      (f) => f.path === 'src/main/java/com/example/ruby_tools/ModItems.java',
    );
    expect(items!.content).toContain('ForgeRegistries.ITEMS');
    expect(items!.content).toContain('RegistryObject<Item> RUBY');
    const blocks = files.find(
      (f) => f.path === 'src/main/java/com/example/ruby_tools/ModBlocks.java',
    );
    expect(blocks!.content).toContain('ForgeRegistries.BLOCKS');
    expect(blocks!.content).toContain('RUBY_BLOCK_ITEM');
  });

  it('无事件内容时不生成 ModEvents.java', () => {
    const paths = files.map((f) => f.path);
    expect(paths).not.toContain('src/main/java/com/example/ruby_tools/ModEvents.java');
  });
});

const SPEC_EVT: ModSpec = ModSpecSchema.parse({
  ...SPEC,
  eventHandlers: [{ handlerId: 'evt_1', eventType: 'block_break', eventArgs: {} }],
  conditions: [
    { conditionId: 'c1', conditionType: 'block_is', args: { block: 'minecraft:stone' } },
  ],
  actions: [{ actionId: 'a1', actionType: 'remove_block', args: {} }],
});

describe('ForgeAdapter 事件（Forge 总线 + Mojang 逻辑）', () => {
  const adapter = new ForgeAdapter();
  const files = adapter.translate({ ...CTX, spec: SPEC_EVT });
  const events = files.find(
    (f) => f.path === 'src/main/java/com/example/ruby_tools/ModEvents.java',
  );

  it('注册走 MinecraftForge.EVENT_BUS（显式泛型见证）', () => {
    expect(events).toBeDefined();
    expect(events!.content).toContain('MinecraftForge.EVENT_BUS');
    expect(events!.content).toContain('net.minecraftforge.event.level.BlockEvent.BreakEvent');
    expect(events!.content).toContain('public static void register()');
  });

  it('条件/动作走 Mojang 映射（is(Block)/setBlock 3 参）', () => {
    expect(events!.content).toContain('ctx.state.is(');
    expect(events!.content).toContain('ctx.level.setBlock(ctx.pos,');
  });

  it('mainClass 调用 ModEvents.register()', () => {
    const main = files.find(
      (f) => f.path === 'src/main/java/com/example/ruby_tools/RubyToolsMod.java',
    );
    expect(main!.content).toContain('ModEvents.register();');
  });
});

describe('ForgeAdapter 版本守卫', () => {
  it('非 1.20.1 给出仅支持 1.20.1 警告', async () => {
    const gen = new ModGenerator();
    const result = await gen.generate({
      loader: 'forge',
      mcVersion: '1.21.11',
      modId: 'ruby_tools',
      spec: SPEC,
      projectPath: '/proj',
    });
    expect(result.warnings.some((w) => w.includes('1.20.1'))).toBe(true);
  });

  it('1.20.1 无版本警告（空内容警告除外）', async () => {
    const gen = new ModGenerator();
    const result = await gen.generate(CTX);
    expect(result.warnings.filter((w) => w.includes('Forge')).length).toBe(0);
  });
});
