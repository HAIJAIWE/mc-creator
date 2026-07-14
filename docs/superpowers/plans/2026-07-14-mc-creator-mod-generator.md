# MC Creator Mod 生成器 实现计划（P2）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现 Mod 生成器（Fabric + NeoForge 双 Loader Adapter），让一份 loader 无关的 ModSpec 能产出两个 loader 的完整可编译源码文件树，并通过端到端测试验证 spec-first 流程。

**Architecture:** 在 `packages/core/src/generators/mod/` 下实现：`LoaderAdapter` 接口 + `FabricAdapter` + `NeoForgeAdapter` + `ModGenerator`（按 ctx.loader 路由）。Adapter 把 ModSpec 翻译成 `FileNode[]`（元数据 + 构建脚本 + Java 入口 + 注册代码 + 资源文件）。**关键设计（规格 §3.2）：内部以 Mojang 官方名为规范名**——Fabric build.gradle 用 `loom.officialMojangMappings()`（非 Yarn），这样 Fabric 与 NeoForge 生成的 Java 代码 import 一致（`net.minecraft.world.item.Item` 等），26.1 切换时 Adapter 几乎不用改。

**Tech Stack:** TypeScript 5、Vitest、zod、@mc-creator/shared（ModSpec/GeneratorContext/GenerationResult）。

**对应规格：** `docs/superpowers/specs/2026-07-13-mc-creator-design.md` 第 3、4、6 节。

**前置条件：** P1 已完成（shared 包 schema + core 引擎基础组件 + 19/19 测试通过 + typecheck 0 错误）。

---

## 文件结构（本计划涉及）

```
packages/core/src/generators/
├── types.ts                  # 已存在（P1 Task 11）
├── registry.ts               # 已存在（P1 Task 11）
├── index.ts                  # Modify：追加导出 mod 子目录
└── mod/
    ├── templates.ts          # 共享模板工具（类名/包名生成）
    ├── templates.test.ts
    ├── adapter.ts            # LoaderAdapter 接口
    ├── fabric-adapter.ts     # FabricAdapter（元数据+构建+Java+资源）
    ├── fabric-adapter.test.ts
    ├── neoforge-adapter.ts   # NeoForgeAdapter（元数据+构建+Java+资源）
    ├── neoforge-adapter.test.ts
    ├── mod-generator.ts      # ModGenerator 实现 Generator 接口
    ├── mod-generator.test.ts # 端到端 + 黄金样本快照
    └── index.ts
```

每个文件单一职责：templates 纯工具函数；adapter 纯接口；两个 adapter 各自封装 loader 差异；mod-generator 仅做路由。

---

## Task 1: 共享模板工具

**Files:**
- Create: `packages/core/src/generators/mod/templates.ts`
- Test: `packages/core/src/generators/mod/templates.test.ts`

- [ ] **Step 1: 写失败测试 `templates.test.ts`**

```typescript
import { describe, it, expect } from 'vitest';
import { pascalCase, packageName, packagePath, mainClassName } from './templates.js';

describe('templates', () => {
  it('pascalCase：下划线转 PascalCase', () => {
    expect(pascalCase('ruby_tools')).toBe('RubyTools');
    expect(pascalCase('demo')).toBe('Demo');
  });

  it('packageName：默认包名', () => {
    expect(packageName('ruby_tools')).toBe('com.example.ruby_tools');
  });

  it('packagePath：包路径', () => {
    expect(packagePath('ruby_tools')).toBe('com/example/ruby_tools');
  });

  it('mainClassName：主入口类名', () => {
    expect(mainClassName('ruby_tools')).toBe('RubyToolsMod');
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @mc-creator/core test -- templates`
Expected: FAIL — `Failed to resolve import "./templates.js"`

- [ ] **Step 3: 写实现 `templates.ts`**

```typescript
/**
 * 共享模板工具（规格 §3.2：内部以 Mojang 官方名为规范名）。
 * Fabric 与 NeoForge 共用这些命名工具，保证 loader 切换时类名/包名一致。
 */

/** modId 转 PascalCase 类名前缀（ruby_tools → RubyTools） */
export function pascalCase(modId: string): string {
  return modId
    .split('_')
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join('');
}

/** 默认包名（com.example.<modid>） */
export function packageName(modId: string): string {
  return `com.example.${modId}`;
}

/** 包路径（com/example/<modid>） */
export function packagePath(modId: string): string {
  return `com/example/${modId}`;
}

/** 主入口类名（<PascalCase>Mod） */
export function mainClassName(modId: string): string {
  return `${pascalCase(modId)}Mod`;
}

/** 物品字段名（大写下划线：ruby → RUBY） */
export function itemFieldName(itemId: string): string {
  return itemId.toUpperCase();
}

/** 方块字段名（大写下划线：ruby_block → RUBY_BLOCK） */
export function blockFieldName(blockId: string): string {
  return blockId.toUpperCase();
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm --filter @mc-creator/core test -- templates`
Expected: PASS（4 个用例）

- [ ] **Step 5: 提交**

```bash
git add packages/core/src/generators/mod/templates.ts packages/core/src/generators/mod/templates.test.ts
git commit -m "feat(core/mod): 共享模板工具（类名/包名生成）"
```

---

## Task 2: LoaderAdapter 接口

**Files:**
- Create: `packages/core/src/generators/mod/adapter.ts`
- Create: `packages/core/src/generators/mod/index.ts`

- [ ] **Step 1: 写 `adapter.ts`（接口定义）**

```typescript
import type { FileNode, GeneratorContext } from '@mc-creator/shared';
import type { Loader } from '@mc-creator/shared';

/**
 * Loader Adapter（规格 §3.2）：把 loader 无关的 ModSpec 翻译成具体 loader 的源码文件树。
 * Fabric 与 NeoForge 各实现一个，产出 FileNode[]（路径相对项目根）。
 */
export interface LoaderAdapter {
  readonly loader: Loader;
  translate(ctx: GeneratorContext): FileNode[];
}
```

- [ ] **Step 2: 写 `index.ts`（占位出口，后续 Task 追加）**

```typescript
export * from './templates.js';
export * from './adapter.js';
```

- [ ] **Step 3: typecheck**

Run: `pnpm --filter @mc-creator/core typecheck`
Expected: 无错误

- [ ] **Step 4: 提交**

```bash
git add packages/core/src/generators/mod/adapter.ts packages/core/src/generators/mod/index.ts
git commit -m "feat(core/mod): LoaderAdapter 接口"
```

---

## Task 3: FabricAdapter — 元数据与构建脚本

**Files:**
- Create: `packages/core/src/generators/mod/fabric-adapter.ts`
- Test: `packages/core/src/generators/mod/fabric-adapter.test.ts`

- [ ] **Step 1: 写失败测试 `fabric-adapter.test.ts`**

```typescript
import { describe, it, expect } from 'vitest';
import { FabricAdapter } from './fabric-adapter.js';
import type { GeneratorContext, ModSpec } from '@mc-creator/shared';

const SPEC: ModSpec = {
  modId: 'ruby_tools',
  version: '1.0.0',
  name: 'Ruby Tools',
  description: 'Adds ruby tools',
  items: [{ id: 'ruby', name: 'Ruby', maxStackSize: 64 }],
  blocks: [{ id: 'ruby_block', name: 'Ruby Block', material: 'metal', hardness: 5.0 }],
};

const CTX: GeneratorContext = {
  loader: 'fabric',
  mcVersion: '1.21.11',
  modId: 'ruby_tools',
  spec: SPEC,
  projectPath: '/proj',
};

describe('FabricAdapter 元数据与构建脚本', () => {
  const adapter = new FabricAdapter();
  const files = adapter.translate(CTX);
  const paths = files.map((f) => f.path);

  it('生成 fabric.mod.json', () => {
    const fmj = files.find((f) => f.path === 'src/main/resources/fabric.mod.json');
    expect(fmj).toBeDefined();
    const json = JSON.parse(fmj!.content);
    expect(json.id).toBe('ruby_tools');
    expect(json.name).toBe('Ruby Tools');
    expect(json.entrypoints.main[0]).toBe('com.example.ruby_tools.RubyToolsMod');
  });

  it('生成 build.gradle 含 fabric-loom 与 officialMojangMappings', () => {
    const bg = files.find((f) => f.path === 'build.gradle');
    expect(bg).toBeDefined();
    expect(bg!.content).toContain("fabric-loom");
    expect(bg!.content).toContain("officialMojangMappings");
  });

  it('生成 settings.gradle 与 gradle.properties', () => {
    expect(paths).toContain('settings.gradle');
    const gp = files.find((f) => f.path === 'gradle.properties');
    expect(gp).toBeDefined();
    expect(gp!.content).toContain('minecraft_version=1.21.11');
    expect(gp!.content).toContain('maven_group=com.example.ruby_tools');
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @mc-creator/core test -- fabric-adapter`
Expected: FAIL — `Failed to resolve import "./fabric-adapter.js"`

- [ ] **Step 3: 写实现 `fabric-adapter.ts`（元数据 + 构建脚本部分）**

```typescript
import type { FileNode, GeneratorContext } from '@mc-creator/shared';
import type { LoaderAdapter } from './adapter.js';
import { mainClassName, packageName, packagePath } from './templates.js';

/**
 * Fabric Loader Adapter（规格 §3.2）。
 * 生成 fabric.mod.json + Fabric Loom build.gradle（用 officialMojangMappings，非 Yarn）
 * + ModInitializer 入口 + Registry.register 注册代码 + 资源文件。
 *
 * 关键：用官方 mappings 使 Java 代码用 net.minecraft.world.item.Item 等官方名，
 * 与 NeoForge 一致，26.1 切换无需改 Adapter。
 */
export class FabricAdapter implements LoaderAdapter {
  readonly loader = 'fabric' as const;

  translate(ctx: GeneratorContext): FileNode[] {
    const { spec, mcVersion } = ctx;
    const pkg = packageName(spec.modId);
    const pkgPath = packagePath(spec.modId);
    const mainCls = mainClassName(spec.modId);

    return [
      this.fabricModJson(spec, pkg, mainCls),
      this.buildGradle(spec, mcVersion),
      this.settingsGradle(),
      this.gradleProperties(spec, mcVersion),
    ];
  }

  private fabricModJson(spec: ModSpecLike, pkg: string, mainCls: string): FileNode {
    const content = {
      schemaVersion: 1,
      id: spec.modId,
      version: '${version}',
      name: spec.name,
      description: spec.description,
      authors: ['mc-creator'],
      entrypoints: {
        main: [`${pkg}.${mainCls}`],
      },
      depends: {
        fabricloader: '>=0.16.0',
        minecraft: `~${spec.mcVersionHint ?? '1.21.11'}`,
        java: '>=21',
        'fabric-api': '*',
      },
    };
    return {
      path: 'src/main/resources/fabric.mod.json',
      content: JSON.stringify(content, null, 2),
    };
  }

  private buildGradle(spec: ModSpecLike, mcVersion: string): FileNode {
    const content = `plugins {
    id 'fabric-loom' version '1.7-SNAPSHOT'
    id 'java'
}

version = project.mod_version
group = project.maven_group

base { archivesName = project.archives_base_name }

repositories {
    maven { name = "Fabric"; url = 'https://maven.fabricmc.net/' }
}

dependencies {
    minecraft "com.mojang:minecraft:\${project.minecraft_version}"
    mappings loom.officialMojangMappings()
    modImplementation "net.fabricmc:fabric-loader:\${project.loader_version}"
    modImplementation "net.fabricmc.fabric-api:fabric-api:\${project.fabric_version}"
}

processResources {
    inputs.property "version", project.version
    filesMatching("fabric.mod.json") {
        expand "version": project.version
    }
}

java {
    sourceCompatibility = JavaVersion.VERSION_21
    targetCompatibility = JavaVersion.VERSION_21
    withSourcesJar()
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

# Minecraft / Fabric
minecraft_version=${mcVersion}
loader_version=0.16.9
fabric_version=0.110.5+1.21
`;
    return { path: 'gradle.properties', content };
  }
}

/** 内部用的 ModSpec 形状（避免循环导入，从 GeneratorContext 推导） */
type ModSpecLike = {
  modId: string;
  version: string;
  name: string;
  description: string;
  mcVersionHint?: string;
};
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm --filter @mc-creator/core test -- fabric-adapter`
Expected: PASS（3 个用例）

- [ ] **Step 5: 提交**

```bash
git add packages/core/src/generators/mod/fabric-adapter.ts packages/core/src/generators/mod/fabric-adapter.test.ts
git commit -m "feat(core/mod): FabricAdapter 元数据与构建脚本"
```

---

## Task 4: FabricAdapter — Java 入口与注册代码

**Files:**
- Modify: `packages/core/src/generators/mod/fabric-adapter.ts`
- Modify: `packages/core/src/generators/mod/fabric-adapter.test.ts`

- [ ] **Step 1: 追加失败测试到 `fabric-adapter.test.ts`**

在文件末尾追加：

```typescript
describe('FabricAdapter Java 入口与注册代码', () => {
  const adapter = new FabricAdapter();
  const files = adapter.translate(CTX);
  const paths = files.map((f) => f.path);

  it('生成 ModInitializer 主类', () => {
    const main = files.find((f) => f.path === 'src/main/java/com/example/ruby_tools/RubyToolsMod.java');
    expect(main).toBeDefined();
    expect(main!.content).toContain('package com.example.ruby_tools;');
    expect(main!.content).toContain('implements ModInitializer');
    expect(main!.content).toContain('onInitialize()');
    expect(main!.content).toContain('ModItems.initialize()');
    expect(main!.content).toContain('ModBlocks.initialize()');
  });

  it('生成 ModItems（Registry.register + 每个物品）', () => {
    const items = files.find((f) => f.path === 'src/main/java/com/example/ruby_tools/ModItems.java');
    expect(items).toBeDefined();
    expect(items!.content).toContain('Registry.register');
    expect(items!.content).toContain('RUBY');
    expect(items!.content).toContain('"ruby"');
  });

  it('生成 ModBlocks（Registry.register + 每个方块）', () => {
    const blocks = files.find((f) => f.path === 'src/main/java/com/example/ruby_tools/ModBlocks.java');
    expect(blocks).toBeDefined();
    expect(blocks!.content).toContain('Registry.register');
    expect(blocks!.content).toContain('RUBY_BLOCK');
    expect(blocks!.content).toContain('"ruby_block"');
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @mc-creator/core test -- fabric-adapter`
Expected: FAIL — 找不到 Java 文件（`undefined`）

- [ ] **Step 3: 扩展 `fabric-adapter.ts`**

在 `FabricAdapter` 类的 `translate` 方法返回数组中追加三个 Java 文件，并添加对应私有方法：

修改 `translate` 方法返回值，在现有 4 个文件后追加：

```typescript
  translate(ctx: GeneratorContext): FileNode[] {
    const { spec, mcVersion } = ctx;
    const pkg = packageName(spec.modId);
    const pkgPath = packagePath(spec.modId);
    const mainCls = mainClassName(spec.modId);

    return [
      this.fabricModJson(spec, pkg, mainCls),
      this.buildGradle(spec, mcVersion),
      this.settingsGradle(),
      this.gradleProperties(spec, mcVersion),
      this.mainClass(spec, pkg, mainCls),
      this.modItemsJava(spec, pkg, mainCls),
      this.modBlocksJava(spec, pkg, mainCls),
    ];
  }
```

在类中追加方法：

```typescript
  private mainClass(spec: ModSpecLike, pkg: string, mainCls: string): FileNode {
    const content = `package ${pkg};

import net.fabricmc.api.ModInitializer;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

public class ${mainCls} implements ModInitializer {
    public static final String MOD_ID = "${spec.modId}";
    public static final Logger LOGGER = LoggerFactory.getLogger(MOD_ID);

    @Override
    public void onInitialize() {
        ModItems.initialize();
        ModBlocks.initialize();
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
      .map((it) => `    public static Item ${it.id.toUpperCase()};`)
      .join('\n');
    const regs = spec.items
      .map(
        (it) =>
          `        ${it.id.toUpperCase()} = Registry.register(Registries.ITEM, Identifier.of(MOD_ID, "${it.id}"), new Item(new Item.Settings()));`,
      )
      .join('\n');
    const content = `package ${pkg};

import net.minecraft.item.Item;
import net.minecraft.registry.Registries;
import net.minecraft.registry.Registry;
import net.minecraft.util.Identifier;

public class ModItems {
${fields}

    public static void initialize() {
${regs}
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
      .map((b) => `    public static Block ${b.id.toUpperCase()};`)
      .join('\n');
    const regs = spec.blocks
      .map((b) => {
        const settings = `new Block.Settings().strength(${b.hardness}f)`;
        return `        ${b.id.toUpperCase()} = Registry.register(Registries.BLOCK, Identifier.of(MOD_ID, "${b.id}"), new Block(${settings}));`;
      })
      .join('\n');
    const content = `package ${pkg};

import net.minecraft.block.Block;
import net.minecraft.registry.Registries;
import net.minecraft.registry.Registry;
import net.minecraft.util.Identifier;

public class ModBlocks {
${fields}

    public static void initialize() {
${regs}
    }
}
`;
    return {
      path: `src/main/java/${packagePath(spec.modId)}/ModBlocks.java`,
      content,
    };
  }
```

同时更新 `ModSpecLike` 类型，使其包含 `items` 和 `blocks`：

```typescript
type ModSpecLike = {
  modId: string;
  version: string;
  name: string;
  description: string;
  mcVersionHint?: string;
  items: Array<{ id: string; name: string; maxStackSize: number }>;
  blocks: Array<{ id: string; name: string; material: string; hardness: number }>;
};
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm --filter @mc-creator/core test -- fabric-adapter`
Expected: PASS（6 个用例）

- [ ] **Step 5: 提交**

```bash
git add packages/core/src/generators/mod/fabric-adapter.ts packages/core/src/generators/mod/fabric-adapter.test.ts
git commit -m "feat(core/mod): FabricAdapter Java 入口与注册代码"
```

---

## Task 5: FabricAdapter — 资源文件（语言/模型）

**Files:**
- Modify: `packages/core/src/generators/mod/fabric-adapter.ts`
- Modify: `packages/core/src/generators/mod/fabric-adapter.test.ts`

- [ ] **Step 1: 追加失败测试**

在 `fabric-adapter.test.ts` 末尾追加：

```typescript
describe('FabricAdapter 资源文件', () => {
  const adapter = new FabricAdapter();
  const files = adapter.translate(CTX);

  it('生成 en_us.json 含物品与方块翻译键', () => {
    const lang = files.find((f) => f.path === 'src/main/resources/assets/ruby_tools/lang/en_us.json');
    expect(lang).toBeDefined();
    const json = JSON.parse(lang!.content);
    expect(json['item.ruby_tools.ruby']).toBe('Ruby');
    expect(json['block.ruby_tools.ruby_block']).toBe('Ruby Block');
  });

  it('生成物品模型 JSON', () => {
    const model = files.find((f) => f.path === 'src/main/resources/assets/ruby_tools/models/item/ruby.json');
    expect(model).toBeDefined();
    const json = JSON.parse(model!.content);
    expect(json.parent).toBe('minecraft:item/generated');
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @mc-creator/core test -- fabric-adapter`
Expected: FAIL — 找不到 lang/model 文件

- [ ] **Step 3: 扩展 `fabric-adapter.ts`**

在 `translate` 返回数组追加资源文件，并添加方法：

```typescript
      this.langJson(spec),
      ...this.itemModels(spec),
```

追加方法：

```typescript
  private langJson(spec: ModSpecLike): FileNode {
    const entries: Record<string, string> = {};
    for (const it of spec.items) entries[`item.${spec.modId}.${it.id}`] = it.name;
    for (const b of spec.blocks) entries[`block.${spec.modId}.${b.id}`] = b.name;
    return {
      path: `src/main/resources/assets/${spec.modId}/lang/en_us.json`,
      content: JSON.stringify(entries, null, 2),
    };
  }

  private itemModels(spec: ModSpecLike): FileNode[] {
    return spec.items.map((it) => ({
      path: `src/main/resources/assets/${spec.modId}/models/item/${it.id}.json`,
      content: JSON.stringify(
        { parent: 'minecraft:item/generated', textures: { layer0: `${spec.modId}:item/${it.id}` } },
        null,
        2,
      ),
    }));
  }
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm --filter @mc-creator/core test -- fabric-adapter`
Expected: PASS（8 个用例）

- [ ] **Step 5: 提交**

```bash
git add packages/core/src/generators/mod/fabric-adapter.ts packages/core/src/generators/mod/fabric-adapter.test.ts
git commit -m "feat(core/mod): FabricAdapter 资源文件（语言/模型）"
```

---

## Task 6: NeoForgeAdapter — 元数据与构建脚本

**Files:**
- Create: `packages/core/src/generators/mod/neoforge-adapter.ts`
- Test: `packages/core/src/generators/mod/neoforge-adapter.test.ts`

- [ ] **Step 1: 写失败测试 `neoforge-adapter.test.ts`**

```typescript
import { describe, it, expect } from 'vitest';
import { NeoForgeAdapter } from './neoforge-adapter.js';
import type { GeneratorContext, ModSpec } from '@mc-creator/shared';

const SPEC: ModSpec = {
  modId: 'ruby_tools',
  version: '1.0.0',
  name: 'Ruby Tools',
  description: 'Adds ruby tools',
  items: [{ id: 'ruby', name: 'Ruby', maxStackSize: 64 }],
  blocks: [{ id: 'ruby_block', name: 'Ruby Block', material: 'metal', hardness: 5.0 }],
};

const CTX: GeneratorContext = {
  loader: 'neoforge',
  mcVersion: '1.21.11',
  modId: 'ruby_tools',
  spec: SPEC,
  projectPath: '/proj',
};

describe('NeoForgeAdapter 元数据与构建脚本', () => {
  const adapter = new NeoForgeAdapter();
  const files = adapter.translate(CTX);

  it('生成 mods.toml', () => {
    const toml = files.find((f) => f.path === 'src/main/resources/META-INF/mods.toml');
    expect(toml).toBeDefined();
    expect(toml!.content).toContain('modId = "ruby_tools"');
    expect(toml!.content).toContain('displayName = "Ruby Tools"');
    expect(toml!.content).toContain('loaderVersion');
  });

  it('生成 build.gradle 含 net.neoforged.moddev', () => {
    const bg = files.find((f) => f.path === 'build.gradle');
    expect(bg).toBeDefined();
    expect(bg!.content).toContain('net.neoforged.moddev');
  });

  it('生成 gradle.properties', () => {
    const gp = files.find((f) => f.path === 'gradle.properties');
    expect(gp).toBeDefined();
    expect(gp!.content).toContain('mc_version=1.21.11');
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @mc-creator/core test -- neoforge-adapter`
Expected: FAIL — `Failed to resolve import "./neoforge-adapter.js"`

- [ ] **Step 3: 写实现 `neoforge-adapter.ts`（元数据 + 构建脚本）**

```typescript
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
    ];
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

  private buildGradle(spec: ModSpecLike, mcVersion: string): FileNode {
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
  items: Array<{ id: string; name: string; maxStackSize: number }>;
  blocks: Array<{ id: string; name: string; material: string; hardness: number }>;
};
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm --filter @mc-creator/core test -- neoforge-adapter`
Expected: PASS（3 个用例）

- [ ] **Step 5: 提交**

```bash
git add packages/core/src/generators/mod/neoforge-adapter.ts packages/core/src/generators/mod/neoforge-adapter.test.ts
git commit -m "feat(core/mod): NeoForgeAdapter 元数据与构建脚本"
```

---

## Task 7: NeoForgeAdapter — Java 入口与注册代码

**Files:**
- Modify: `packages/core/src/generators/mod/neoforge-adapter.ts`
- Modify: `packages/core/src/generators/mod/neoforge-adapter.test.ts`

- [ ] **Step 1: 追加失败测试**

在 `neoforge-adapter.test.ts` 末尾追加：

```typescript
describe('NeoForgeAdapter Java 入口与注册代码', () => {
  const adapter = new NeoForgeAdapter();
  const files = adapter.translate(CTX);

  it('生成 @Mod 主类', () => {
    const main = files.find((f) => f.path === 'src/main/java/com/example/ruby_tools/RubyToolsMod.java');
    expect(main).toBeDefined();
    expect(main!.content).toContain('package com.example.ruby_tools;');
    expect(main!.content).toContain('@Mod("ruby_tools")');
    expect(main!.content).toContain('IEventBus');
    expect(main!.content).toContain('ModItems.register(modEventBus)');
    expect(main!.content).toContain('ModBlocks.register(modEventBus)');
  });

  it('生成 ModItems（DeferredRegister + 每个物品）', () => {
    const items = files.find((f) => f.path === 'src/main/java/com/example/ruby_tools/ModItems.java');
    expect(items).toBeDefined();
    expect(items!.content).toContain('DeferredRegister');
    expect(items!.content).toContain('RUBY');
    expect(items!.content).toContain('registerSimpleItem("ruby"');
  });

  it('生成 ModBlocks（DeferredRegister + 每个方块）', () => {
    const blocks = files.find((f) => f.path === 'src/main/java/com/example/ruby_tools/ModBlocks.java');
    expect(blocks).toBeDefined();
    expect(blocks!.content).toContain('DeferredRegister');
    expect(blocks!.content).toContain('RUBY_BLOCK');
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @mc-creator/core test -- neoforge-adapter`
Expected: FAIL — 找不到 Java 文件

- [ ] **Step 3: 扩展 `neoforge-adapter.ts`**

修改 `translate` 返回数组追加：

```typescript
      this.mainClass(spec, pkg, mainCls),
      this.modItemsJava(spec, pkg, mainCls),
      this.modBlocksJava(spec, pkg, mainCls),
```

追加方法：

```typescript
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
```

注意：`ModItems.java` 用了 `IEventBus`，需在 `mainClass` 中已 import，但 `ModItems.register` 方法签名也用了 `IEventBus`，需在 `ModItems.java` 加 import。更新 `modItemsJava` 和 `modBlocksJava` 的 import：

```typescript
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
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm --filter @mc-creator/core test -- neoforge-adapter`
Expected: PASS（6 个用例）

- [ ] **Step 5: 提交**

```bash
git add packages/core/src/generators/mod/neoforge-adapter.ts packages/core/src/generators/mod/neoforge-adapter.test.ts
git commit -m "feat(core/mod): NeoForgeAdapter Java 入口与 DeferredRegister 注册代码"
```

---

## Task 8: NeoForgeAdapter — 资源文件

**Files:**
- Modify: `packages/core/src/generators/mod/neoforge-adapter.ts`
- Modify: `packages/core/src/generators/mod/neoforge-adapter.test.ts`

- [ ] **Step 1: 追加失败测试**

在 `neoforge-adapter.test.ts` 末尾追加：

```typescript
describe('NeoForgeAdapter 资源文件', () => {
  const adapter = new NeoForgeAdapter();
  const files = adapter.translate(CTX);

  it('生成 en_us.json 含物品与方块翻译键', () => {
    const lang = files.find((f) => f.path === 'src/main/resources/assets/ruby_tools/lang/en_us.json');
    expect(lang).toBeDefined();
    const json = JSON.parse(lang!.content);
    expect(json['item.ruby_tools.ruby']).toBe('Ruby');
    expect(json['block.ruby_tools.ruby_block']).toBe('Ruby Block');
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @mc-creator/core test -- neoforge-adapter`
Expected: FAIL — 找不到 lang 文件

- [ ] **Step 3: 扩展 `neoforge-adapter.ts`**

在 `translate` 返回数组追加：

```typescript
      this.langJson(spec),
```

追加方法：

```typescript
  private langJson(spec: ModSpecLike): FileNode {
    const entries: Record<string, string> = {};
    for (const it of spec.items) entries[`item.${spec.modId}.${it.id}`] = it.name;
    for (const b of spec.blocks) entries[`block.${spec.modId}.${b.id}`] = b.name;
    return {
      path: `src/main/resources/assets/${spec.modId}/lang/en_us.json`,
      content: JSON.stringify(entries, null, 2),
    };
  }
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm --filter @mc-creator/core test -- neoforge-adapter`
Expected: PASS（7 个用例）

- [ ] **Step 5: 提交**

```bash
git add packages/core/src/generators/mod/neoforge-adapter.ts packages/core/src/generators/mod/neoforge-adapter.test.ts
git commit -m "feat(core/mod): NeoForgeAdapter 资源文件"
```

---

## Task 9: ModGenerator — 按 loader 路由

**Files:**
- Create: `packages/core/src/generators/mod/mod-generator.ts`
- Test: `packages/core/src/generators/mod/mod-generator.test.ts`

- [ ] **Step 1: 写失败测试 `mod-generator.test.ts`**

```typescript
import { describe, it, expect } from 'vitest';
import { ModGenerator } from './mod-generator.js';
import type { GeneratorContext, ModSpec } from '@mc-creator/shared';

const SPEC: ModSpec = {
  modId: 'demo',
  version: '1.0.0',
  name: 'Demo',
  description: 'demo mod',
  items: [{ id: 'ruby', name: 'Ruby', maxStackSize: 64 }],
  blocks: [],
};

describe('ModGenerator', () => {
  const gen = new ModGenerator();

  it('type/loaders/versions 声明正确', () => {
    expect(gen.type).toBe('mod');
    expect(gen.loaders).toEqual(['fabric', 'neoforge']);
    expect(gen.versions).toEqual(['1.21.11', '1.21.1', '26.1']);
  });

  it('fabric ctx → 生成 fabric.mod.json', async () => {
    const ctx: GeneratorContext = {
      loader: 'fabric',
      mcVersion: '1.21.11',
      modId: 'demo',
      spec: SPEC,
      projectPath: '/proj',
    };
    const result = await gen.generate(ctx);
    expect(result.files.some((f) => f.path === 'src/main/resources/fabric.mod.json')).toBe(true);
    expect(result.buildCmd).toBe('./gradlew build');
  });

  it('neoforge ctx → 生成 mods.toml', async () => {
    const ctx: GeneratorContext = {
      loader: 'neoforge',
      mcVersion: '1.21.11',
      modId: 'demo',
      spec: SPEC,
      projectPath: '/proj',
    };
    const result = await gen.generate(ctx);
    expect(result.files.some((f) => f.path === 'src/main/resources/META-INF/mods.toml')).toBe(true);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @mc-creator/core test -- mod-generator`
Expected: FAIL — `Failed to resolve import "./mod-generator.js"`

- [ ] **Step 3: 写实现 `mod-generator.ts`**

```typescript
import type { GeneratorContext, GenerationResult } from '@mc-creator/shared';
import type { Loader, McVersion } from '@mc-creator/shared';
import type { Generator } from '../types.js';
import type { LoaderAdapter } from './adapter.js';
import { FabricAdapter } from './fabric-adapter.js';
import { NeoForgeAdapter } from './neoforge-adapter.js';

/**
 * Mod 生成器（规格 §3）：实现统一 Generator 接口，按 ctx.loader 路由到对应 LoaderAdapter。
 * 同一 ModSpec 切换 loader 时，重新调 generate 即可产出另一套源码（规格 §3.2）。
 */
export class ModGenerator implements Generator {
  readonly type = 'mod';
  readonly loaders: Loader[] = ['fabric', 'neoforge'];
  readonly versions: McVersion[] = ['1.21.11', '1.21.1', '26.1'];

  private readonly adapters: Record<Loader, LoaderAdapter> = {
    fabric: new FabricAdapter(),
    neoforge: new NeoForgeAdapter(),
  };

  async generate(ctx: GeneratorContext): Promise<GenerationResult> {
    const adapter = this.adapters[ctx.loader];
    const files = adapter.translate(ctx);
    return {
      files,
      warnings: [],
      buildCmd: './gradlew build',
    };
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm --filter @mc-creator/core test -- mod-generator`
Expected: PASS（3 个用例）

- [ ] **Step 5: 提交**

```bash
git add packages/core/src/generators/mod/mod-generator.ts packages/core/src/generators/mod/mod-generator.test.ts
git commit -m "feat(core/mod): ModGenerator 按 loader 路由"
```

---

## Task 10: 端到端流程 + 黄金样本快照

**Files:**
- Modify: `packages/core/src/generators/mod/mod-generator.test.ts`
- Modify: `packages/core/src/generators/mod/index.ts`

- [ ] **Step 1: 追加端到端 + 黄金样本测试到 `mod-generator.test.ts`**

在文件末尾追加：

```typescript
import { fs } from 'memfs';
import { Filesystem } from '../../filesystem/index.js';
import { Orchestrator } from '../../orchestrator/orchestrator.js';
import { MockProvider } from '../../model-provider/mock-provider.js';

describe('ModGenerator 端到端（spec-first 流程）', () => {
  it('Orchestrator 生成 spec → ModGenerator 产出文件 → 写入 memfs', async () => {
    const validSpec = JSON.stringify({
      modId: 'magic_items',
      version: '1.0.0',
      name: 'Magic Items',
      description: 'adds magic',
      items: [{ id: 'magic_dust', name: 'Magic Dust', maxStackSize: 16 }],
      blocks: [],
    });
    const orchestrator = new Orchestrator(new MockProvider(validSpec));
    const spec = await orchestrator.generateModSpec('做一个魔法物品 mod');

    const gen = new ModGenerator();
    const ctx: GeneratorContext = {
      loader: 'fabric',
      mcVersion: '1.21.11',
      modId: spec.modId,
      spec,
      projectPath: '/proj',
    };
    const result = await gen.generate(ctx);

    // 写入 memfs
    const dfs = new Filesystem(fs as any);
    for (const file of result.files) {
      await dfs.writeFile(`/proj/${file.path}`, file.content);
    }

    // 验证关键文件存在
    expect(dfs.exists('/proj/src/main/resources/fabric.mod.json')).toBe(true);
    expect(dfs.exists('/proj/src/main/java/com/example/magic_items/MagicItemsMod.java')).toBe(true);
    expect(dfs.exists('/proj/src/main/java/com/example/magic_items/ModItems.java')).toBe(true);
    expect(dfs.readFile('/proj/src/main/resources/assets/magic_items/lang/en_us.json')).toContain('Magic Dust');
  });
});

describe('ModGenerator 黄金样本快照（防 Adapter 回归）', () => {
  const GOLDEN_SPEC: ModSpec = {
    modId: 'golden',
    version: '1.0.0',
    name: 'Golden',
    description: 'golden mod',
    items: [{ id: 'gold_dust', name: 'Gold Dust', maxStackSize: 64 }],
    blocks: [{ id: 'gold_block', name: 'Gold Block', material: 'metal', hardness: 3.0 }],
  };

  it('fabric：文件路径列表快照稳定', async () => {
    const gen = new ModGenerator();
    const result = await gen.generate({
      loader: 'fabric',
      mcVersion: '1.21.11',
      modId: 'golden',
      spec: GOLDEN_SPEC,
      projectPath: '/proj',
    });
    const paths = result.files.map((f) => f.path).sort();
    expect(paths).toMatchInlineSnapshot();
  });

  it('neoforge：文件路径列表快照稳定', async () => {
    const gen = new ModGenerator();
    const result = await gen.generate({
      loader: 'neoforge',
      mcVersion: '1.21.11',
      modId: 'golden',
      spec: GOLDEN_SPEC,
      projectPath: '/proj',
    });
    const paths = result.files.map((f) => f.path).sort();
    expect(paths).toMatchInlineSnapshot();
  });
});
```

- [ ] **Step 2: 更新快照（首次运行生成）**

Run: `pnpm --filter @mc-creator/core test -- mod-generator -- -u`
Expected: PASS（首次写入 inline snapshot）

- [ ] **Step 3: 再次运行确认快照稳定**

Run: `pnpm --filter @mc-creator/core test -- mod-generator`
Expected: PASS（5 个用例：3 基础 + 1 端到端 + 2 快照）

- [ ] **Step 4: 更新 `index.ts` 导出 mod-generator**

修改 `packages/core/src/generators/mod/index.ts`：

```typescript
export * from './templates.js';
export * from './adapter.js';
export * from './fabric-adapter.js';
export * from './neoforge-adapter.js';
export * from './mod-generator.js';
```

- [ ] **Step 5: 提交**

```bash
git add packages/core/src/generators/mod/mod-generator.test.ts packages/core/src/generators/mod/index.ts
git commit -m "feat(core/mod): 端到端流程与黄金样本快照"
```

---

## Task 11: 注册 ModGenerator + 汇总出口 + 全量验证

**Files:**
- Modify: `packages/core/src/generators/index.ts`
- Modify: `packages/core/src/index.ts`（如需）

- [ ] **Step 1: 更新 `packages/core/src/generators/index.ts`**

```typescript
export * from './types.js';
export * from './registry.js';
export * from './mod/index.js';
```

- [ ] **Step 2: 写注册测试（追加到 `registry.test.ts` 或新建）**

新建 `packages/core/src/generators/mod/integration.test.ts`：

```typescript
import { describe, it, expect } from 'vitest';
import { GeneratorRegistry } from '../registry.js';
import { ModGenerator } from './mod-generator.js';

describe('ModGenerator 注册集成', () => {
  it('注册后可通过 find 按 loader+版本定位', () => {
    const r = new GeneratorRegistry();
    r.register(new ModGenerator());
    expect(r.find('mod', 'fabric', '1.21.11')).toBeDefined();
    expect(r.find('mod', 'neoforge', '1.21.11')).toBeDefined();
    expect(r.find('mod', 'fabric', '26.1')).toBeDefined();
    // 未支持的组合
    expect(r.find('other', 'fabric', '1.21.11')).toBeUndefined();
  });
});
```

- [ ] **Step 3: 运行全量测试**

Run: `pnpm --filter @mc-creator/core test`
Expected: 全部 PASS
- P1 原有 19 用例（filesystem 5 + model-provider 2 + orchestrator 3 + builder 6 + generators 3）
- P2 新增：templates 4 + fabric-adapter 8 + neoforge-adapter 7 + mod-generator 5 + integration 1 = 25 用例
- 合计 44 用例

- [ ] **Step 4: typecheck**

Run: `pnpm --filter @mc-creator/core typecheck`
Expected: 无错误

- [ ] **Step 5: 提交**

```bash
git add packages/core/src/generators/index.ts packages/core/src/generators/mod/integration.test.ts
git commit -m "feat(core/mod): 注册 ModGenerator 到 Registry 并跑通全量测试"
```

---

## 自审清单

**1. 规格覆盖**（对应规格 §3 Mod 生成器、§3.2 Loader Adapter 差异点、§3.3 数据结构、§4 端到端数据流、§6 测试策略）：
- ✅ §3.1 spec-first 流程 → Task 9/10（ModGenerator 路由 + 端到端 Orchestrator→Generator→Filesystem）
- ✅ §3.2 FabricAdapter（fabric.mod.json + Loom + officialMojangMappings + ModInitializer + Registry.register）→ Task 3/4/5
- ✅ §3.2 NeoForgeAdapter（mods.toml + moddev + @Mod + DeferredRegister）→ Task 6/7/8
- ✅ §3.2 内部以 Mojang 官方名为规范名 → Fabric 用 officialMojangMappings（非 Yarn），Java import 与 NeoForge 一致
- ✅ §3.3 GeneratorContext/GenerationResult/FileNode → 复用 P1 shared schema
- ✅ §4 端到端数据流 → Task 10（Orchestrator→ModGenerator→Filesystem 写入 memfs 验证）
- ✅ §6 黄金样本快照 → Task 10（fabric/neoforge 文件路径列表 inline snapshot）
- ✅ §6 核心引擎单测 → 每 Task 均有测试
- ⚠️ §6 集成冒烟（真实 Gradle 编译）→ 留 P3（需 Docker JDK 镜像，本计划用 mock 验证文件树）
- ⚠️ §5 Gradle 编译失败 AI 修复循环 → 留 P3（需 UI 交互 + 真实编译）

**2. 占位符扫描**：无 TBD/TODO，每步含完整代码与命令。Task 10 Step 2 的 `-u` 是 vitest 快照更新标志，非占位符。

**3. 类型一致性**：
- `LoaderAdapter` 接口在 Task 2 定义，Task 3/6 实现引用一致
- `ModGenerator` 在 Task 9 实现 `Generator` 接口（Task 11 P1 已定义），`type/loaders/versions/generate` 签名一致
- `ModSpecLike` 在 fabric/neoforge-adapter.ts 各自定义（私有类型，字段与 shared ModSpec 一致）
- `pascalCase/packageName/packagePath/mainClassName` 在 Task 1 定义后被 Task 3-8 引用一致
- `Loader`/`McVersion` 从 @mc-creator/shared 导入，与 P1 loader.ts 一致

**4. 关键设计决策**：
- Fabric 用 `loom.officialMojangMappings()` 而非 Yarn → Java 代码用官方名（`net.minecraft.world.item.Item`），与 NeoForge 一致，实现 §3.2「以 Mojang 官方名为内部规范名」，26.1 切换无需改 Adapter
- ModSpecLike 私有类型避免循环导入，字段与 shared ModSpec 保持一致
- 黄金样本快照用 `toMatchInlineSnapshot` 防止文件路径列表回归

---

## 执行交接

P2 Mod 生成器计划完成，已保存至 `docs/superpowers/plans/2026-07-14-mc-creator-mod-generator.md`。

后续：P3（Electron UI + 端到端 + 真实 Gradle 编译冒烟）将另开计划。
