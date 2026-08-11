import { useState, useCallback, useMemo, useEffect } from 'react';
import Editor from '@monaco-editor/react';
import type { FileNode } from '@mc-creator/shared';
import { McIcon } from '../../assets/mc-ui/McIcon';
import { useModStore } from '../../store/mod-store.js';
import { ipcClient } from '../../lib/ipc-client.js';
import { useToast } from '../useToast.js';
import { DemoteToLowcodeButton } from './DemoteToLowcodeButton.js';

// === 文件路径 → PresetFile 字段推导 ===

/** 根据文件路径推断所属分组（与 GeneratedCodePreview 保持一致） */
function inferFileGroup(path: string): PresetFile['group'] {
  if (path.endsWith('.gradle') || path === 'gradle.properties') return '构建脚本';
  if (path.startsWith('src/main/java/') && path.endsWith('.java')) return 'Java 源码';
  return '资源与配置';
}

/** 根据文件扩展名推断 Monaco 语言 ID */
function inferLanguage(path: string): string {
  if (path.endsWith('.java')) return 'java';
  if (path.endsWith('.json')) return 'json';
  if (path.endsWith('.gradle')) return 'groovy';
  if (path.endsWith('.properties')) return 'properties';
  return 'plaintext';
}

/** 取路径最后一段作为显示文件名 */
function getFileName(path: string): string {
  const idx = path.lastIndexOf('/');
  return idx >= 0 ? path.slice(idx + 1) : path;
}

/** 把 store 中的 FileNode 转换为 PurecodeWorkspace 内部使用的 PresetFile 结构 */
function fileNodeToPresetFile(f: FileNode): PresetFile {
  return {
    path: f.path,
    label: getFileName(f.path),
    group: inferFileGroup(f.path),
    language: inferLanguage(f.path),
    content: f.content,
  };
}

/** 预设文件条目 */
interface PresetFile {
  /** 完整路径（相对项目根） */
  path: string;
  /** 显示名（最后一层文件名） */
  label: string;
  /** 所属分组（用于文件树分区） */
  group: 'Java 源码' | '资源与配置' | '构建脚本';
  /** Monaco 语言 ID */
  language: string;
  /** 默认内容（脚手架模板） */
  content: string;
}

/**
 * 预设文件列表（L3 纯代码模式脚手架）
 *
 * 覆盖一个真实 Fabric Mod 的完整项目结构（共 11 个文件）：
 * - Java 源码：Mod 入口 / 物品注册 / 方块注册 / 事件监听 / 配方占位
 * - 资源与配置：fabric.mod.json / Mixin 配置 / 语言文件
 * - 构建脚本：build.gradle / gradle.properties / settings.gradle
 */
const PRESET_FILES: PresetFile[] = [
  {
    path: 'src/main/java/com/example/mod/ModMain.java',
    label: 'ModMain.java',
    group: 'Java 源码',
    language: 'java',
    content: `package com.example.mod;

import net.fabricmc.api.ModInitializer;

/**
 * Mod 入口类（L3 纯代码模式 - 占位模板）
 *
 * 实际开发时在此注册物品/方块/事件监听等。
 */
public class ModMain implements ModInitializer {
    public static final String MOD_ID = "examplemod";

    @Override
    public void onInitialize() {
        ModItems.initialize();
        System.out.println("Initializing " + MOD_ID);
    }
}
`,
  },
  {
    path: 'src/main/java/com/example/mod/ModItems.java',
    label: 'ModItems.java',
    group: 'Java 源码',
    language: 'java',
    content: `package com.example.mod;

import net.minecraft.item.Item;
import net.minecraft.registry.Registries;
import net.minecraft.registry.Registry;
import net.minecraft.util.Identifier;

/**
 * 物品注册（L3 纯代码模式 - 占位模板）
 */
public class ModItems {
    public static final Item EXAMPLE_ITEM = register(
        "example_item",
        new Item(new Item.Settings())
    );

    private static Item register(String name, Item item) {
        return Registry.register(
            Registries.ITEM,
            Identifier.of(ModMain.MOD_ID, name),
            item
        );
    }

    public static void initialize() {
        // 触发类加载以执行静态注册
    }
}
`,
  },
  {
    path: 'src/main/java/com/example/mod/ModBlocks.java',
    label: 'ModBlocks.java',
    group: 'Java 源码',
    language: 'java',
    content: `package com.example.mod;

import net.minecraft.block.AbstractBlock;
import net.minecraft.block.Block;
import net.minecraft.block.Blocks;
import net.minecraft.item.BlockItem;
import net.minecraft.item.Item;
import net.minecraft.registry.Registries;
import net.minecraft.registry.Registry;
import net.minecraft.sound.BlockSoundGroup;
import net.minecraft.util.Identifier;

/**
 * 方块注册（L3 纯代码模式 - 占位模板）
 *
 * 与 ModItems 类似的注册模式：方块本身 + 对应的 BlockItem 一并注册，
 * 避免在 ModItems 中重复登记 BlockItem。
 */
public class ModBlocks {
    public static final Block EXAMPLE_BLOCK = register(
        "example_block",
        new Block(AbstractBlock.Settings.copy(Blocks.IRON_BLOCK).sounds(BlockSoundGroup.METAL))
    );

    private static Block register(String name, Block block) {
        registerBlockItem(name, block);
        return Registry.register(
            Registries.BLOCK,
            Identifier.of(ModMain.MOD_ID, name),
            block
        );
    }

    private static Item registerBlockItem(String name, Block block) {
        return Registry.register(
            Registries.ITEM,
            Identifier.of(ModMain.MOD_ID, name),
            new BlockItem(block, new Item.Settings())
        );
    }

    public static void initialize() {
        // 触发类加载以执行静态注册
    }
}
`,
  },
  {
    path: 'src/main/java/com/example/mod/ModEvents.java',
    label: 'ModEvents.java',
    group: 'Java 源码',
    language: 'java',
    content: `package com.example.mod;

import net.fabricmc.fabric.api.event.lifecycle.v1.ServerTickEvents;
import net.minecraft.server.MinecraftServer;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * 事件监听（L3 纯代码模式 - 占位模板）
 *
 * 使用 Fabric Lifecycle API 监听服务端 tick，作为事件注册示例。
 * 可在 ModMain.onInitialize() 中调用 ModEvents.register() 接入。
 */
public class ModEvents {
    public static final Logger LOGGER = LoggerFactory.getLogger(ModMain.MOD_ID);

    private static int tickCounter = 0;

    public static void register() {
        // 每个服务端 tick 结束时回调：示例 - 每 6000 tick（约 5 分钟）输出日志
        ServerTickEvents.END_SERVER_TICK.register((MinecraftServer server) -> {
            tickCounter++;
            if (tickCounter % 6000 == 0) {
                LOGGER.info("Example mod tick: {}", tickCounter);
            }
        });
    }
}
`,
  },
  {
    path: 'src/main/java/com/example/mod/ModRecipes.java',
    label: 'ModRecipes.java',
    group: 'Java 源码',
    language: 'java',
    content: `package com.example.mod;

import net.minecraft.util.Identifier;

/**
 * 配方注册占位（L3 纯代码模式）
 *
 * Minecraft 1.21+ 推荐使用数据包（Datapack）JSON 定义配方，
 * 路径位于 src/main/resources/data/<modid>/recipe/。
 * 代码侧无需手动注册配方，此处仅提供命名空间工具方法。
 */
public final class ModRecipes {
    /** 配方命名空间（与 MOD_ID 一致） */
    public static final String NAMESPACE = ModMain.MOD_ID;

    private ModRecipes() {
        // 工具类禁止实例化
    }

    /**
     * 构造配方资源 Identifier：data/<modid>/recipe/<name>.json
     */
    public static Identifier recipeId(String name) {
        return Identifier.of(NAMESPACE, name);
    }

    public static void initialize() {
        // 占位：真实配方由 src/main/resources/data/examplemod/recipe/*.json 提供
    }
}
`,
  },
  {
    path: 'src/main/resources/fabric.mod.json',
    label: 'fabric.mod.json',
    group: '资源与配置',
    language: 'json',
    content: `{
  "schemaVersion": 1,
  "id": "examplemod",
  "version": "1.0.0",
  "name": "Example Mod",
  "description": "L3 纯代码模式 - Fabric Mod 描述文件占位",
  "authors": [],
  "contact": {},
  "license": "MIT",
  "environment": "*",
  "entrypoints": {
    "main": ["com.example.mod.ModMain"]
  },
  "depends": {
    "fabricloader": ">=0.15.0",
    "minecraft": "~1.21",
    "java": ">=21"
  }
}
`,
  },
  {
    path: 'src/main/resources/modname.mixins.json',
    label: 'modname.mixins.json',
    group: '资源与配置',
    language: 'json',
    content: `{
  "required": true,
  "minVersion": "0.8",
  "package": "com.example.mod.mixin",
  "compatibilityLevel": "JAVA_21",
  "refmap": "examplemod.refmap.json",
  "mixins": [],
  "client": [],
  "injectors": {
    "defaultRequire": 1
  }
}
`,
  },
  {
    path: 'src/main/resources/assets/examplemod/lang/en_us.json',
    label: 'en_us.json',
    group: '资源与配置',
    language: 'json',
    content: `{
  "item.examplemod.example_item": "Example Item",
  "block.examplemod.example_block": "Example Block",
  "itemGroup.examplemod.example_group": "Example Mod",
  "text.examplemod.info": "Example Mod Info"
}
`,
  },
  {
    path: 'build.gradle',
    label: 'build.gradle',
    group: '构建脚本',
    language: 'groovy',
    content: `plugins {
    id 'fabric-loom' version '1.7-SNAPSHOT'
    id 'java'
}

version = project.mod_version
group = project.maven_group

base {
    archivesName = project.archives_base_name
}

repositories {
    maven { url 'https://maven.fabricmc.net/' }
}

dependencies {
    minecraft "com.mojang:minecraft:\${project.minecraft_version}"
    mappings "net.fabricmc:yarn:\${project.yarn_mappings}:v2"
    modImplementation "net.fabricmc:fabric-loader:\${project.loader_version}"
}

java {
    sourceCompatibility = JavaVersion.VERSION_21
    targetCompatibility = JavaVersion.VERSION_21
    withSourcesJar()
}
`,
  },
  {
    path: 'gradle.properties',
    label: 'gradle.properties',
    group: '构建脚本',
    language: 'properties',
    content: `# Mod 元信息
mod_version=1.0.0
maven_group=com.example
archives_base_name=examplemod

# Minecraft / Yarn / Loader / Fabric API 版本（按目标 MC 版本调整）
minecraft_version=1.21.1
yarn_mappings=1.21.1+build.3
loader_version=0.16.7
fabric_version=0.105.0+1.21.1

# Gradle / Java
org.gradle.jvmargs=-Xmx2G
org.gradle.parallel=true
`,
  },
  {
    path: 'settings.gradle',
    label: 'settings.gradle',
    group: '构建脚本',
    language: 'groovy',
    content: `pluginManagement {
    repositories {
        maven { url 'https://maven.fabricmc.net/' }
        gradlePluginPortal()
        mavenCentral()
    }
}

rootProject.name = 'examplemod'
`,
  },
];

/** 文件分组显示顺序 */
const GROUP_ORDER: PresetFile['group'][] = ['Java 源码', '资源与配置', '构建脚本'];

/**
 * 文件树图标映射：按 Monaco 语言 ID 选择 emoji。
 * 未命中的语言回退到 📄。
 */
const FILE_ICON: Record<string, string> = {
  java: '☕',
  json: '📄',
  groovy: '⚙',
  properties: '🔧',
};

interface PurecodeWorkspaceProps {
  /** 是否只读（预览模式） */
  readOnly?: boolean;
}

/**
 * 纯代码工作区（L3 模式）：左侧文件树 + 中间 Monaco 编辑器 + 顶部工具栏
 *
 * ┌──────────────────────────────────────────────────────┐
 * │  顶部工具栏：图标 + 标题 + 文件下拉 + 保存按钮         │
 * ├────────────┬─────────────────────────────────────────┤
 * │            │                                         │
 * │  文件树     │       Monaco 编辑器（flex-1）            │
 * │  220px     │                                         │
 * │            │                                         │
 * └────────────┴─────────────────────────────────────────┘
 *
 * L3 纯代码模式：跳过节点图，直接编辑 Java/JSON 源码文件。
 * 预置脚手架文件（ModMain.java / ModItems.java / fabric.mod.json / build.gradle），
 * 编辑器语言根据文件扩展名自动切换。
 *
 * 当前为最小可用版本：
 * - 文件树预置（不支持新增/删除）
 * - 保存按钮已接入真实持久化：经 IPC 弹系统保存对话框写盘，并把内容同步回项目 store
 */
export function PurecodeWorkspace({ readOnly = false }: PurecodeWorkspaceProps) {
  const toast = useToast();
  // 从 useModStore 读取提升后的文件（如 L2→L3 提升流程写入的文件）
  // 非空时优先使用 store 中的文件；为空时回退到 PRESET_FILES 脚手架
  const promotedFiles = useModStore((s) => s.files);

  // 脚手架模式下用户新建/删除的文件（PRESET_FILES 不可变，改动只保存在本地）
  const createFile = useModStore((s) => s.createFile);
  const deleteFile = useModStore((s) => s.deleteFile);
  const isPresetMode = promotedFiles.length === 0;
  // 脚手架模式：PRESET_FILES 中删除的文件集合
  const [removedPresetPaths, setRemovedPresetPaths] = useState<Set<string>>(new Set());
  // 脚手架模式：新建的文件（追加到 PRESET_FILES 之后，按分组归类）
  const [addedPresetFiles, setAddedPresetFiles] = useState<PresetFile[]>([]);

  // 当前展示的文件列表：store 中的提升文件优先，否则用预置脚手架
  const filesToShow = useMemo<PresetFile[]>(() => {
    if (promotedFiles.length > 0) return promotedFiles.map(fileNodeToPresetFile);
    const presets = PRESET_FILES.filter((f) => !removedPresetPaths.has(f.path));
    return [...presets, ...addedPresetFiles];
  }, [promotedFiles, removedPresetPaths, addedPresetFiles]);

  const [selectedPath, setSelectedPath] = useState<string>(filesToShow[0]?.path ?? '');
  // 文件内容缓存：path → 当前编辑器内容
  const [fileContents, setFileContents] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const f of filesToShow) init[f.path] = f.content;
    return init;
  });

  // 当 filesToShow 变化（如提升后的文件首次写入 store）时：
  // 1. 把新文件的内容写入 fileContents 缓存（保留用户对已有文件的修改）
  // 2. 若当前 selectedPath 不在新文件列表中，重置为第一个文件
  useEffect(() => {
    setFileContents((prev) => {
      const next = { ...prev };
      for (const f of filesToShow) {
        // 仅当缓存中不存在该文件时才写入（避免覆盖用户编辑）
        if (!(f.path in next)) {
          next[f.path] = f.content;
        }
      }
      return next;
    });
    if (filesToShow.length > 0 && !filesToShow.some((f) => f.path === selectedPath)) {
      setSelectedPath(filesToShow[0].path);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filesToShow]);

  const selectedFile = useMemo(
    () => filesToShow.find((f) => f.path === selectedPath) ?? filesToShow[0],
    [filesToShow, selectedPath],
  );

  const currentContent = selectedFile ? (fileContents[selectedFile.path] ?? '') : '';

  const handleSelectFile = useCallback((path: string) => {
    setSelectedPath(path);
  }, []);

  const handleEditorChange = useCallback(
    (value: string | undefined) => {
      if (readOnly || !selectedFile) return;
      setFileContents((prev) => ({ ...prev, [selectedFile.path]: value ?? '' }));
    },
    [readOnly, selectedFile],
  );

  // 保存：经 IPC 弹系统保存对话框将当前文件写盘，并把编辑内容同步回项目 store
  const handleSave = useCallback(async () => {
    if (!selectedFile) return;
    const content = fileContents[selectedFile.path] ?? '';
    useModStore.getState().updateFileContent(selectedFile.path, content);
    const res = await ipcClient.saveFile({
      path: selectedFile.path,
      content,
      defaultName: selectedFile.path.split('/').pop() || 'file.txt',
    });
    if (res.ok) {
      useModStore.getState().markFileClean(selectedFile.path);
      toast.success(`已保存：${selectedFile.label}`);
    } else if (!res.canceled) {
      toast.error('保存失败');
    }
  }, [selectedFile, fileContents, toast]);

  // 新建文件：脚手架模式改本地 addedPresetFiles，提升模式直接写 store
  const handleNewFile = useCallback(() => {
    if (readOnly) return;
    const name = prompt('请输入文件名（含扩展名，如 new-item.java）', 'new-file.txt');
    if (!name) return;
    const path = name;
    // 重名检测：完整路径或文件名相撞都算重名（预设文件位于子目录）
    const isDuplicate = filesToShow.some(
      (f) => f.path === path || getFileName(f.path) === getFileName(path),
    );
    if (isDuplicate) {
      toast.error(`文件已存在：${path}`);
      return;
    }
    if (isPresetMode) {
      setAddedPresetFiles((prev) => [
        ...prev,
        {
          path,
          label: getFileName(path),
          group: inferFileGroup(path),
          language: inferLanguage(path),
          content: '',
        },
      ]);
    } else {
      createFile(path, '');
    }
    setFileContents((prev) => ({ ...prev, [path]: '' }));
    setSelectedPath(path);
  }, [readOnly, filesToShow, isPresetMode, createFile, toast]);

  // 删除文件：脚手架模式（预设文件记入 removedPresetPaths，新建文件从 addedPresetFiles 移除），提升模式直接走 store
  const handleDeleteFile = useCallback(
    (path: string) => {
      if (readOnly) return;
      if (!confirm(`确定删除 ${path}？`)) return;
      if (isPresetMode) {
        if (PRESET_FILES.some((f) => f.path === path)) {
          setRemovedPresetPaths((prev) => new Set(prev).add(path));
        } else {
          setAddedPresetFiles((prev) => prev.filter((f) => f.path !== path));
        }
      } else {
        deleteFile(path);
      }
      // 选中的文件被删除时回退到第一个剩余文件（filesToShow 的 effect 也会兜底）
      if (selectedPath === path) {
        const rest = filesToShow.filter((f) => f.path !== path);
        setSelectedPath(rest[0]?.path ?? '');
      }
    },
    [readOnly, isPresetMode, deleteFile, selectedPath, filesToShow],
  );

  // 按分组组织文件树
  const groupedFiles = useMemo(() => {
    const groups: Record<PresetFile['group'], PresetFile[]> = {
      'Java 源码': [],
      资源与配置: [],
      构建脚本: [],
    };
    for (const f of filesToShow) groups[f.group].push(f);
    return groups;
  }, [filesToShow]);

  // 边界情况：filesToShow 为空（理论上不会发生，PRESET_FILES 兜底）
  if (!selectedFile) {
    return (
      <div
        className="flex h-full items-center justify-center bg-mc-bg text-xs text-mc-mute"
        role="application"
        aria-label="纯代码工作区"
      >
        暂无文件可编辑
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-mc-bg" role="application" aria-label="纯代码工作区">
      {/* 顶部工具栏 */}
      <div className="flex items-center gap-3 border-b border-mc-border bg-mc-surface px-3 py-1.5">
        <div className="flex items-center gap-2">
          <McIcon
            scope="pixel"
            name="terminal"
            size={16}
            className="text-mc-accent"
            aria-hidden="true"
          />
          <span className="text-xs font-medium text-mc-text">纯代码编辑器</span>
        </div>

        <div className="mx-2 h-4 w-px bg-mc-border" aria-hidden="true" />

        {/* 文件选择下拉框 */}
        <label className="text-[11px] text-mc-dim" htmlFor="purecode-file-select">
          当前文件
        </label>
        <select
          id="purecode-file-select"
          value={selectedPath}
          onChange={(e) => handleSelectFile(e.target.value)}
          disabled={readOnly}
          aria-label="选择当前编辑的文件"
          className="rounded-mc border border-mc-border bg-mc-surface-2 px-2 py-0.5 text-[11px] text-mc-text outline-none focus:border-mc-accent disabled:opacity-60"
        >
          {filesToShow.map((f) => (
            <option key={f.path} value={f.path}>
              {f.label}
            </option>
          ))}
        </select>

        <div className="ml-auto flex items-center gap-2">
          {/* 当前语言标识 */}
          <span
            className="rounded-mc bg-mc-surface-2 px-2 py-0.5 text-[10px] text-mc-mute"
            role="status"
            aria-label="当前编辑器语言"
          >
            {selectedFile.language}
          </span>

          {/* L3 → L2 反向降级：从 Java 代码提取节点图并切换到混合模式 */}
          <DemoteToLowcodeButton className="rounded-mc px-2 py-1 text-[11px] text-mc-mute transition-colors hover:bg-mc-surface-2 hover:text-mc-text" />

          {/* 保存按钮 */}
          <button
            type="button"
            onClick={handleSave}
            disabled={readOnly}
            aria-label="保存当前文件"
            title="保存当前文件"
            className="flex items-center gap-1 rounded-mc bg-mc-accent px-3 py-1 text-[11px] font-medium text-white transition-colors hover:bg-mc-accent/80 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <McIcon scope="pixel" name="save" size={12} className="text-white" aria-hidden="true" />
            保存
          </button>
        </div>
      </div>

      {/* 内容区：左侧文件树 + 右侧 Monaco 编辑器 */}
      <div className="flex flex-1 overflow-hidden">
        {/* 左侧：文件树 */}
        <div
          className="shrink-0 overflow-y-auto border-r border-mc-border bg-mc-surface"
          style={{ width: 220 }}
          role="tree"
          aria-label="项目文件树"
        >
          <div className="flex items-center justify-between px-3 py-2">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-mc-mute">
              项目文件
            </div>
            {!readOnly && (
              <button
                type="button"
                onClick={handleNewFile}
                aria-label="新建文件"
                title="新建文件"
                className="rounded-mc p-0.5 text-mc-mute transition-colors hover:bg-mc-surface-3 hover:text-mc-text"
              >
                <McIcon scope="pixel" name="plus" size={12} aria-hidden="true" />
              </button>
            )}
          </div>
          {GROUP_ORDER.map((group) => (
            <div key={group} className="mb-2">
              <div className="px-3 py-1 text-[10px] font-medium uppercase tracking-wider text-mc-dim">
                {group}
              </div>
              <ul role="group" aria-label={group}>
                {groupedFiles[group].map((f) => {
                  const isActive = f.path === selectedPath;
                  return (
                    <li key={f.path} role="none">
                      <div
                        className={`group flex w-full items-center gap-1.5 px-3 py-1 text-left text-[11px] transition-colors ${
                          isActive
                            ? 'bg-mc-surface-2 text-mc-text'
                            : 'text-mc-dim hover:bg-mc-surface-2/60 hover:text-mc-text'
                        }`}
                      >
                        <button
                          type="button"
                          role="treeitem"
                          aria-selected={isActive}
                          title={f.path}
                          onClick={() => handleSelectFile(f.path)}
                          className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
                        >
                          <span aria-hidden="true" className="text-[10px]">
                            {FILE_ICON[f.language] ?? '📄'}
                          </span>
                          <span className="truncate">{f.label}</span>
                        </button>
                        {!readOnly && (
                          <button
                            type="button"
                            onClick={() => handleDeleteFile(f.path)}
                            aria-label={`删除 ${f.label}`}
                            title="删除文件"
                            className="hidden shrink-0 rounded-mc p-0.5 text-mc-mute transition-colors hover:text-mc-redstone group-hover:block"
                          >
                            <McIcon scope="pixel" name="trash" size={11} aria-hidden="true" />
                          </button>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>

        {/* 中间：Monaco 编辑器 */}
        <div
          className="flex-1 overflow-hidden"
          data-testid="purecode-monaco-container"
          role="region"
          aria-label="Monaco 代码编辑器"
        >
          <Editor
            height="100%"
            language={selectedFile.language}
            value={currentContent}
            onChange={handleEditorChange}
            theme="vs-dark"
            options={{
              readOnly,
              minimap: { enabled: false },
              fontSize: 12,
              tabSize: 4,
              automaticLayout: true,
              scrollBeyondLastLine: false,
              wordWrap: 'on',
              lineNumbers: 'on',
              renderLineHighlight: 'all',
              bracketPairColorization: { enabled: true },
            }}
          />
        </div>
      </div>
    </div>
  );
}
