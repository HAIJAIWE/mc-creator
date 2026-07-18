import type { FileNode, GeneratorContext } from '@mc-creator/shared';
import type { LoaderAdapter } from './adapter.js';
import { mainClassName, packageName, packagePath } from './templates.js';

/**
 * NeoForge Loader Adapter（规格 §3.2）。
 * 生成 mods.toml + NeoForge moddev build.gradle + @Mod 入口 + DeferredRegister 注册代码 + 资源。
 * NeoForge 本就用 Mojang 官方名，与 Fabric 的 officialMojangMappings 一致。
 */
export class NeoForgeAdapter implements LoaderAdapter {
  readonly loader = 'neoforge' as const;

  translate(ctx: GeneratorContext): FileNode[] {
    const { spec, mcVersion } = ctx;
    const pkg = packageName(spec.modId);
    const mainCls = mainClassName(spec.modId);

    return [
      this.modsToml(spec, mcVersion),
      this.buildGradle(spec, mcVersion),
      this.settingsGradle(),
      this.gradleProperties(spec, mcVersion),
      this.mainClass(spec, pkg, mainCls),
      this.modItemsJava(spec, pkg, mainCls),
      this.modBlocksJava(spec, pkg, mainCls),
      this.langJson(spec),
      this.metaJson(spec),
    ];
  }

  /**
   * P10：生成 <modId>_meta.json 元数据文件（最小侵入，避免改动 mods.toml）。
   * 汇总所有新增字段（license/authors/credits/dependencies/website + items/blocks 新属性）。
   */
  private metaJson(spec: ModSpecLike): FileNode {
    const meta = {
      modId: spec.modId,
      license: spec.license,
      authors: spec.authors,
      credits: spec.credits,
      website: spec.website,
      dependencies: spec.dependencies,
      items: spec.items.map((it) => ({
        id: it.id,
        rarity: it.rarity,
        maxDamage: it.maxDamage,
        fuelTick: it.fuelTick,
        food: it.food ?? null,
        lore: it.lore,
      })),
      blocks: spec.blocks.map((b) => ({
        id: b.id,
        miningLevel: b.miningLevel,
        lightLevel: b.lightLevel,
        resistance: b.resistance,
        soundType: b.soundType,
        dropSelf: b.dropSelf,
        dropItem: b.dropItem,
      })),
    };
    return {
      path: `src/main/resources/${spec.modId}_meta.json`,
      content: JSON.stringify(meta, null, 2),
    };
  }

  private langJson(spec: ModSpecLike): FileNode {
    const entries: Record<string, string> = {};
    for (const it of spec.items) entries[`item.${spec.modId}.${it.id}`] = it.name;
    for (const b of spec.blocks) entries[`block.${spec.modId}.${b.id}`] = b.name;
    return {
      path: `src/main/resources/assets/${spec.modId}/lang/en_us.json`,
      content: JSON.stringify(entries, null, 2),
    };
  }

  private mainClass(spec: ModSpecLike, pkg: string, mainCls: string): FileNode {
    const content = `package ${pkg};

import net.neoforged.bus.api.IEventBus;
import net.neoforged.fml.common.Mod;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

@Mod("${spec.modId}")
public class ${mainCls} {
    public static final String MOD_ID = "${spec.modId}";
    public static final Logger LOGGER = LoggerFactory.getLogger(MOD_ID);

    public ${mainCls}(IEventBus modEventBus) {
        ModItems.register(modEventBus);
        ModBlocks.register(modEventBus);
        LOGGER.info("Initializing ${spec.name}");
    }
}
`;
    return {
      path: `src/main/java/${packagePath(spec.modId)}/${mainCls}.java`,
      content,
    };
  }

  private modItemsJava(spec: ModSpecLike, pkg: string, mainCls: string): FileNode {
    const fields = spec.items
      .map((it) => `    public static final DeferredItem<Item> ${it.id.toUpperCase()} = ITEMS.registerSimpleItem("${it.id}");`)
      .join('\n');
    const content = `package ${pkg};

import net.minecraft.world.item.Item;
import net.neoforged.bus.api.IEventBus;
import net.neoforged.neoforge.registries.DeferredItem;
import net.neoforged.neoforge.registries.DeferredRegister;

public class ModItems {
    public static final DeferredRegister.Items ITEMS = DeferredRegister.createItems(${mainCls}.MOD_ID);

${fields}

    public static void register(IEventBus modEventBus) {
        ITEMS.register(modEventBus);
    }
}
`;
    return {
      path: `src/main/java/${packagePath(spec.modId)}/ModItems.java`,
      content,
    };
  }

  private modBlocksJava(spec: ModSpecLike, pkg: string, mainCls: string): FileNode {
    const fields = spec.blocks
      .map((b) => `    public static final DeferredBlock<Block> ${b.id.toUpperCase()} = BLOCKS.registerSimpleBlock("${b.id}");`)
      .join('\n');
    const content = `package ${pkg};

import net.minecraft.world.level.block.Block;
import net.neoforged.bus.api.IEventBus;
import net.neoforged.neoforge.registries.DeferredBlock;
import net.neoforged.neoforge.registries.DeferredRegister;

public class ModBlocks {
    public static final DeferredRegister.Blocks BLOCKS = DeferredRegister.createBlocks(${mainCls}.MOD_ID);

${fields}

    public static void register(IEventBus modEventBus) {
        BLOCKS.register(modEventBus);
    }
}
`;
    return {
      path: `src/main/java/${packagePath(spec.modId)}/ModBlocks.java`,
      content,
    };
  }

  private modsToml(spec: ModSpecLike, mcVersion: string): FileNode {
    const content = `modLoader = "javafml"
loaderVersion = "[4,)"
license = "MIT"

[[mods]]
modId = "${spec.modId}"
version = "${spec.version}"
displayName = "${spec.name}"
description = "${spec.description}"

[[dependencies.${spec.modId}]]
    modId = "neoforge"
    type = "required"
    versionRange = "[21.1,)"
    ordering = "NONE"
    side = "BOTH"

[[dependencies.${spec.modId}]]
    modId = "minecraft"
    type = "required"
    versionRange = "[${mcVersion},)"
    ordering = "NONE"
    side = "BOTH"
`;
    return { path: 'src/main/resources/META-INF/mods.toml', content };
  }

  private buildGradle(spec: ModSpecLike, _mcVersion: string): FileNode {
    const content = `plugins {
    id 'net.neoforged.moddev' version '1.0.21'
}

version = '${spec.version}'
group = 'com.example.${spec.modId}'

base { archivesName = '${spec.modId}' }

java.toolchain.languageVersion = JavaLanguageVersion.of(21)

neoForge {
    version = "21.1.1"
    runs {
        client { client() }
        server { server() }
    }
    mods {
        "${spec.modId}" {
            sourceSet sourceSets.main
        }
    }
}

repositories {
    mavenCentral()
}
`;
    return { path: 'build.gradle', content };
  }

  private settingsGradle(): FileNode {
    return {
      path: 'settings.gradle',
      content: `rootProject.name = 'mc-mod'\n`,
    };
  }

  private gradleProperties(spec: ModSpecLike, mcVersion: string): FileNode {
    const content = `# Mod
mod_version=${spec.version}
maven_group=com.example.${spec.modId}
archives_base_name=${spec.modId}

# Minecraft / NeoForge
mc_version=${mcVersion}
neoforge_version=21.1.1
`;
    return { path: 'gradle.properties', content };
  }
}

type ModSpecLike = {
  modId: string;
  version: string;
  name: string;
  description: string;
  // P10 新增字段（向后兼容：均为可选，由 spec.default 兜底）
  license: string;
  authors: string[];
  credits: string;
  website: string;
  dependencies: Array<{ modId: string; version: string; mandatory: boolean }>;
  items: Array<{
    id: string;
    name: string;
    maxStackSize: number;
    rarity: 'common' | 'uncommon' | 'rare' | 'epic';
    maxDamage: number;
    fuelTick: number;
    food?: { hunger: number; saturation: number };
    lore: string;
  }>;
  blocks: Array<{
    id: string;
    name: string;
    material: string;
    hardness: number;
    miningLevel: number;
    lightLevel: number;
    resistance: number;
    soundType: 'wood' | 'stone' | 'metal' | 'grass' | 'sand' | 'glass';
    dropSelf: boolean;
    dropItem: string;
  }>;
};
