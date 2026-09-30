/**
 * Agent 工具系统：定义智能体可调用的工具集。
 * 每个工具有 name、description、parameters（JSON Schema）、execute 函数。
 * 智能体通过 function calling 选择工具，AgentRuntime 调度执行。
 */

import { ipcClient } from './ipc-client.js';
import { generateFilesForType } from './generate-files.js';
import { useModStore } from '../store/mod-store.js';
import type { GeneratorContext, Loader, ModSpec } from '@mc-creator/shared';
import { LOADERS } from '@mc-creator/shared';

function isLoader(v: unknown): v is Loader {
  return typeof v === 'string' && (LOADERS as readonly string[]).includes(v);
}

/** unknown 错误收敛为可展示文案（替代 `(e as Error).message` 断言） */
function toErrorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** extra_params（Record<string, unknown>）的类型守卫读取，避免 `as number/boolean/string` 断言 */
function getNumberParam(obj: Record<string, unknown>, key: string, fallback: number): number {
  const v = obj[key];
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  return fallback;
}

function getBooleanParam(obj: Record<string, unknown>, key: string, fallback: boolean): boolean {
  const v = obj[key];
  if (typeof v === 'boolean') return v;
  return fallback;
}

function getStringParam(obj: Record<string, unknown>, key: string, fallback: string): string {
  const v = obj[key];
  if (typeof v === 'string') return v;
  return fallback;
}

function getStringArrayParam(
  obj: Record<string, unknown>,
  key: string,
  fallback: string[],
): string[] {
  const v = obj[key];
  if (Array.isArray(v) && v.every((i): i is string => typeof i === 'string')) return [...v];
  return fallback;
}

function getEnumParam<T extends string>(
  obj: Record<string, unknown>,
  key: string,
  fallback: T,
  valid: readonly T[],
): T {
  const v = obj[key];
  if (typeof v === 'string') {
    const found = valid.find((x) => x === v);
    if (found !== undefined) return found;
  }
  return fallback;
}

function getNullableNumberParam(
  obj: Record<string, unknown>,
  key: string,
  fallback: number | null,
): number | null {
  const v = obj[key];
  if (v === null || v === undefined) return fallback;
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  return fallback;
}

/**
 * 把生成器结果文件合并写入 store：已有路径则更新内容，新路径则创建。
 * 供各生成工具共用，消除重复的文件合并逻辑。
 */
function mergeFilesIntoStore(files: { path: string; content: string }[]): void {
  const storeState = useModStore.getState();
  const existingPaths = new Set(storeState.files.map((f) => f.path));
  for (const file of files) {
    if (existingPaths.has(file.path)) storeState.updateFileContent(file.path, file.content);
    else storeState.createFile(file.path, file.content);
  }
}

export interface ToolParameter {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  description: string;
  required?: boolean;
  enum?: string[];
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: ToolParameter[];
  /** 执行工具，返回结果字符串（展示给智能体） */
  execute: (args: Record<string, unknown>) => Promise<string>;
  /** 是否需要用户审批才可执行（写入/执行类操作） */
  requiresApproval: boolean;
  /** 工具分类（用于 UI 分组显示） */
  category: 'read' | 'write' | 'execute' | 'search';
}

/**
 * 读取文件内容
 */
const readFileTool: ToolDefinition = {
  name: 'read_file',
  description: '读取项目中指定文件的内容',
  parameters: [
    { name: 'path', type: 'string', description: '文件路径（相对于项目根目录）', required: true },
  ],
  category: 'read',
  requiresApproval: false,
  execute: async (args) => {
    const path = String(args.path);
    const files = useModStore.getState().files;
    const file = files.find((f) => f.path === path);
    if (!file)
      return `错误：文件 "${path}" 不存在于当前项目中。可用文件：${files.map((f) => f.path).join(', ')}`;
    // 截断超长文件
    const maxLen = 8000;
    if (file.content.length > maxLen) {
      return (
        file.content.slice(0, maxLen) + `\n\n... [文件已截断，总长度 ${file.content.length} 字符]`
      );
    }
    return file.content;
  },
};

/**
 * 列出项目文件树
 */
const listFilesTool: ToolDefinition = {
  name: 'list_files',
  description: '列出项目中所有文件的路径和大小',
  parameters: [
    { name: 'directory', type: 'string', description: '目录前缀过滤（可选）', required: false },
  ],
  category: 'read',
  requiresApproval: false,
  execute: async (args) => {
    const dir = args.directory ? String(args.directory).trim() : '';
    const files = useModStore.getState().files;
    // L-11 修复：按目录前缀过滤需以 "/" 结尾匹配，避免 assets 误匹配 assets2 等
    const filtered = dir
      ? files.filter((f) => f.path === dir || f.path.startsWith(dir + '/'))
      : files;
    if (filtered.length === 0) return `没有找到文件${dir ? `（目录前缀：${dir}）` : ''}`;
    return filtered.map((f) => `${f.path} (${f.content.length} 字符)`).join('\n');
  },
};

/**
 * 搜索代码（全文搜索）
 */
const searchCodeTool: ToolDefinition = {
  name: 'search_code',
  description: '在项目文件中搜索包含指定文本的文件和行',
  parameters: [
    { name: 'query', type: 'string', description: '搜索关键词或正则表达式', required: true },
    {
      name: 'file_pattern',
      type: 'string',
      description: '文件路径过滤（可选，如 .java）',
      required: false,
    },
  ],
  category: 'search',
  requiresApproval: false,
  execute: async (args) => {
    const query = String(args.query);
    const pattern = args.file_pattern ? String(args.file_pattern) : '';
    const files = useModStore.getState().files;
    const filtered = pattern ? files.filter((f) => f.path.includes(pattern)) : files;

    const results: string[] = [];
    let regex: RegExp;
    try {
      regex = new RegExp(query, 'gi');
    } catch {
      // 非法正则，回退为纯文本搜索
      regex = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    }

    for (const f of filtered) {
      if (f.path.endsWith('.png')) continue; // 跳过二进制文件
      const lines = f.content.split('\n');
      const matches: string[] = [];
      for (let i = 0; i < lines.length; i++) {
        if (regex.test(lines[i])) {
          matches.push(`  L${i + 1}: ${lines[i].trim()}`);
          if (matches.length >= 5) break; // 每文件最多 5 个匹配
        }
        regex.lastIndex = 0;
      }
      if (matches.length > 0) {
        results.push(`${f.path}:\n${matches.join('\n')}`);
      }
    }
    if (results.length === 0) return `没有找到包含 "${query}" 的内容`;
    return results.join('\n\n');
  },
};

/**
 * 写入/创建文件
 */
const writeFileTool: ToolDefinition = {
  name: 'write_file',
  description: '创建或覆盖项目中的文件内容',
  parameters: [
    { name: 'path', type: 'string', description: '文件路径', required: true },
    { name: 'content', type: 'string', description: '文件内容', required: true },
  ],
  category: 'write',
  requiresApproval: true,
  execute: async (args) => {
    const path = String(args.path);
    const content = String(args.content);
    const store = useModStore.getState();
    const existing = store.files.find((f) => f.path === path);
    if (existing) {
      store.updateFileContent(path, content);
      return `已更新文件 "${path}" (${content.length} 字符)`;
    } else {
      store.createFile(path, content);
      return `已创建文件 "${path}" (${content.length} 字符)`;
    }
  },
};

/**
 * 编辑文件（搜索替换）
 */
const editFileTool: ToolDefinition = {
  name: 'edit_file',
  description: '编辑文件中的一部分内容（搜索并替换指定文本段）',
  parameters: [
    { name: 'path', type: 'string', description: '文件路径', required: true },
    { name: 'old_text', type: 'string', description: '要替换的原始文本', required: true },
    { name: 'new_text', type: 'string', description: '替换后的新文本', required: true },
  ],
  category: 'write',
  requiresApproval: true,
  execute: async (args) => {
    const path = String(args.path);
    const oldText = String(args.old_text);
    const newText = String(args.new_text);
    const store = useModStore.getState();
    const file = store.files.find((f) => f.path === path);
    if (!file) return `错误：文件 "${path}" 不存在`;
    // 检测多次出现
    const occurrences = file.content.split(oldText).length - 1;
    if (occurrences > 1) {
      return `错误：文件 "${path}" 中该文本出现了 ${occurrences} 次，请提供更多上下文以唯一定位要替换的文本段`;
    }
    if (!file.content.includes(oldText)) {
      // 尝试模糊匹配：去除首尾空白后搜索
      const trimmedOld = oldText.trim();
      const idx = file.content.indexOf(trimmedOld);
      if (idx === -1) return `错误：文件 "${path}" 中未找到指定的文本段`;
      const newContent =
        file.content.slice(0, idx) + newText + file.content.slice(idx + trimmedOld.length);
      store.updateFileContent(path, newContent);
      return `已编辑文件 "${path}"（模糊匹配替换）`;
    }
    const newContent = file.content.replace(oldText, newText);
    store.updateFileContent(path, newContent);
    return `已编辑文件 "${path}"（精确替换）`;
  },
};

/**
 * 删除文件
 */
const deleteFileTool: ToolDefinition = {
  name: 'delete_file',
  description: '删除项目中的文件',
  parameters: [{ name: 'path', type: 'string', description: '要删除的文件路径', required: true }],
  category: 'write',
  requiresApproval: true,
  execute: async (args) => {
    const path = String(args.path);
    const store = useModStore.getState();
    if (!store.files.some((f) => f.path === path)) return `错误：文件 "${path}" 不存在`;
    store.deleteFile(path);
    return `已删除文件 "${path}"`;
  },
};

/**
 * 执行 shell 命令（通过终端 PTY IPC 桥接）
 */
const runCommandTool: ToolDefinition = {
  name: 'run_command',
  description: '在终端中执行 shell 命令（如构建、测试、Git 操作）',
  parameters: [
    { name: 'command', type: 'string', description: '要执行的命令', required: true },
    { name: 'cwd', type: 'string', description: '工作目录（可选）', required: false },
  ],
  category: 'execute',
  requiresApproval: true,
  execute: async (args) => {
    const command = String(args.command);
    const cwd = args.cwd ? String(args.cwd) : undefined;
    try {
      // 通过已有终端 IPC spawn 一个临时 PTY 执行命令
      const spawnReq: { cols: number; rows: number; cwd?: string; shell?: string } = {
        cols: 120,
        rows: 24,
      };
      if (cwd) spawnReq.cwd = cwd;
      const { pid } = await ipcClient.terminalSpawn(spawnReq);
      const mcApi = window.mcApi;
      // L-3 修复：订阅 terminal:data / terminal:exit 收集命令输出，而不是固定等待 5s
      // 预览环境（vite mock）下 onTerminalData 是 no-op，事件永不触发，走超时兜底
      let output = '';
      const unsubData = mcApi?.onTerminalData?.((_e, d) => {
        if (d.pid === pid) output += d.data;
      });
      const exitPromise = new Promise<number>((resolve) => {
        const unsubExit = mcApi?.onTerminalExit?.((_e, d) => {
          if (d.pid !== pid) return;
          unsubExit?.();
          resolve(d.exitCode);
        });
      });
      await ipcClient.terminalWrite(pid, command + '\n');
      const timeoutMs = 120_000;
      const exitCode = await Promise.race([
        exitPromise,
        new Promise<number>((r) => setTimeout(() => r(-1), timeoutMs)),
      ]);
      if (exitCode === -1) await ipcClient.terminalKill(pid).catch(() => {});
      unsubData?.();
      const trimmed = output.trim();
      const truncated =
        trimmed.length > 4000 ? trimmed.slice(0, 4000) + '\n...(输出已截断)' : trimmed;
      return `命令已执行，退出码 ${exitCode}${
        truncated ? `：\n${truncated}` : '（无输出）'
      }${exitCode === -1 ? '\n（提示：超时未获取退出码，可能仍在后台运行）' : ''}`;
    } catch {
      return `无法执行命令: ${command}（终端不可用）`;
    }
  },
};

/**
 * 应用 MC 内容模板：一键生成完整内容套件（新矿石/新食物/新维度/新附魔/新效果/新结构/新生物群系）
 */
const applyContentTemplateTool: ToolDefinition = {
  name: 'apply_content_template',
  description:
    '应用 MC 内容模板：一键生成完整内容套件。支持模板：new_ore（新矿石→全套材料+工具+盔甲+配方+标签），new_food（新食物→生/熟+烟熏/营火配方），new_dimension（新维度→维度类型+生物群系+维度生成），new_enchantment（新附魔→自定义附魔+槽位+权重），new_effect（新状态效果→颜色+即时+有益），new_structure（新结构→jigsaw/random_spread+模板池+生物群系），new_biome（新生物群系→降水+温度+颜色）',
  parameters: [
    {
      name: 'template',
      type: 'string',
      description:
        '模板名称：new_ore | new_food | new_dimension | new_enchantment | new_effect | new_structure | new_biome',
      required: true,
    },
    { name: 'mod_id', type: 'string', description: 'Mod ID（如 my_mod）', required: true },
    {
      name: 'material_name',
      type: 'string',
      description: '材料英文名（如 ruby, copper）',
      required: true,
    },
    {
      name: 'material_name_zh',
      type: 'string',
      description: '材料中文名（如 红宝石, 铜）',
      required: true,
    },
    {
      name: 'extra_params',
      type: 'string',
      description:
        '额外参数 JSON（如附魔的 {"maxLevel":5,"weight":2,"supportedItems":"#minecraft:enchantable/sword"}，效果的 {"color":0xFF0000,"instant":true}，结构的 {"placementType":"jigsaw","biomes":"#minecraft:is_overworld"}，生物群系的 {"precipitation":"snow","temperature":0.0}）',
      required: false,
    },
  ],
  category: 'write',
  requiresApproval: true,
  execute: async (args) => {
    const templateName = String(args.template);
    const modId = String(args.mod_id);
    const materialName = String(args.material_name);
    const materialNameZh = String(args.material_name_zh);
    let extraParams: Record<string, unknown> = {};
    if (args.extra_params) {
      try {
        extraParams = JSON.parse(String(args.extra_params)) as unknown as Record<string, unknown>;
      } catch {
        return '错误：extra_params 不是有效 JSON';
      }
    }

    try {
      const shared = await import('@mc-creator/shared');
      const { DatapackGenerator } =
        await import('@mc-creator/core/generators/datapack/datapack-generator.js');

      const baseParams = { modId, materialName, materialNameZh, packFormat: 48 };
      let specObj: Record<string, unknown>;
      let langKeys: { en: Record<string, string>; zh: Record<string, string> };

      switch (templateName) {
        case 'new_ore':
          specObj = shared.newOreTemplate(baseParams) as Record<string, unknown>;
          langKeys = shared.newOreLangKeys(baseParams);
          break;
        case 'new_food':
          specObj = shared.newFoodTemplate({
            ...baseParams,
            hunger: getNumberParam(extraParams, 'hunger', 4),
            saturation: getNumberParam(extraParams, 'saturation', 0.3),
          }) as Record<string, unknown>;
          langKeys = shared.newFoodLangKeys(baseParams);
          break;
        case 'new_dimension':
          specObj = shared.newDimensionTemplate({
            ...baseParams,
            fixedTime: getNullableNumberParam(extraParams, 'fixedTime', null),
            hasSkyLight: getBooleanParam(extraParams, 'hasSkyLight', true),
            hasCeiling: getBooleanParam(extraParams, 'hasCeiling', false),
            coordinateScale: getNumberParam(extraParams, 'coordinateScale', 1.0),
          }) as Record<string, unknown>;
          langKeys = shared.newDimensionLangKeys(baseParams);
          break;
        case 'new_enchantment':
          specObj = shared.newEnchantmentTemplate({
            ...baseParams,
            maxLevel: getNumberParam(extraParams, 'maxLevel', 3),
            weight: getNumberParam(extraParams, 'weight', 10),
            supportedItems: getStringParam(
              extraParams,
              'supportedItems',
              '#minecraft:enchantable/sword',
            ),
            slots: getStringArrayParam(extraParams, 'slots', ['any']),
          }) as Record<string, unknown>;
          langKeys = shared.newEnchantmentLangKeys(baseParams);
          break;
        case 'new_effect':
          specObj = shared.newEffectTemplate({
            ...baseParams,
            color: getNumberParam(extraParams, 'color', 0xffffff),
            instant: getBooleanParam(extraParams, 'instant', false),
            beneficial: getBooleanParam(extraParams, 'beneficial', true),
          }) as Record<string, unknown>;
          langKeys = shared.newEffectLangKeys(baseParams);
          break;
        case 'new_structure':
          specObj = shared.newStructureTemplate({
            ...baseParams,
            templatePool: getStringParam(extraParams, 'templatePool', 'minecraft:empty'),
            placementType: getEnumParam(extraParams, 'placementType', 'jigsaw', [
              'jigsaw',
              'random_spread',
              'concentric_rings',
            ] as const),
            maxDistance: getNumberParam(extraParams, 'maxDistance', 7),
            size: getNumberParam(extraParams, 'size', 7),
            biomes: getStringParam(extraParams, 'biomes', '#minecraft:is_overworld'),
          }) as Record<string, unknown>;
          langKeys = shared.newStructureLangKeys(baseParams);
          break;
        case 'new_biome':
          specObj = shared.newBiomeTemplate({
            ...baseParams,
            precipitation: getEnumParam(extraParams, 'precipitation', 'rain', [
              'none',
              'rain',
              'snow',
            ] as const),
            temperature: getNumberParam(extraParams, 'temperature', 0.5),
            downfall: getNumberParam(extraParams, 'downfall', 0.4),
            skyColor: getNumberParam(extraParams, 'skyColor', 0x78a7ff),
            waterColor: getNumberParam(extraParams, 'waterColor', 0x3f76e4),
            fogColor: getNumberParam(extraParams, 'fogColor', 0xc0d8ff),
          }) as Record<string, unknown>;
          langKeys = shared.newBiomeLangKeys(baseParams);
          break;
        default:
          return `错误：未知模板 "${templateName}"。可用：new_ore | new_food | new_dimension | new_enchantment | new_effect | new_structure | new_biome`;
      }

      // 用 Zod 校验+填充默认值
      const parsed = shared.DatapackSpec.safeParse(specObj);
      if (!parsed.success) {
        return `错误：模板生成 Spec 校验失败:\n${parsed.error.issues.map((issue) => `  ${issue.path.join('.')}: ${issue.message}`).join('\n')}`;
      }

      // 运行生成器
      const store = useModStore.getState();
      const gen = new DatapackGenerator();

      // DatapackSpec 与 GeneratorContext.spec（ModSpec 类型槽位）结构不同，
      // 经 unknown 中转桥接（与 AgentPanel / project-store 做法一致）；
      // 生成器内部会再转回 DatapackSpec。
      const ctx: GeneratorContext = {
        loader: store.loader,
        mcVersion: store.mcVersion,
        modId,
        spec: parsed.data as unknown as ModSpec,
        projectPath: '',
      };
      const result = await gen.generate(ctx);

      // 写入文件
      mergeFilesIntoStore(result.files);
      const storeState = useModStore.getState();

      // 生成语言文件
      const langEnPath = `assets/${modId}/lang/en_us.json`;
      const langZhPath = `assets/${modId}/lang/zh_cn.json`;
      const existingEn = storeState.files.find((f) => f.path === langEnPath);
      const existingZh = storeState.files.find((f) => f.path === langZhPath);

      const mergedEn = existingEn
        ? {
            ...(JSON.parse(existingEn.content) as unknown as Record<string, string>),
            ...langKeys.en,
          }
        : langKeys.en;
      const mergedZh = existingZh
        ? {
            ...(JSON.parse(existingZh.content) as unknown as Record<string, string>),
            ...langKeys.zh,
          }
        : langKeys.zh;

      if (existingEn) storeState.updateFileContent(langEnPath, JSON.stringify(mergedEn, null, 2));
      else storeState.createFile(langEnPath, JSON.stringify(mergedEn, null, 2));
      if (existingZh) storeState.updateFileContent(langZhPath, JSON.stringify(mergedZh, null, 2));
      else storeState.createFile(langZhPath, JSON.stringify(mergedZh, null, 2));

      // DatapackSpec → store ModSpec 桥接（经 unknown 中转，见上）
      storeState.setSpec(parsed.data as unknown as ModSpec);

      const totalLangKeys = Object.keys(langKeys.en).length;
      return (
        `✅ 模板 "${templateName}" 应用成功！\n` +
        `材料: ${materialNameZh} (${materialName})\n` +
        `生成文件: ${result.files.length} 个 + 2 个语言文件\n` +
        `语言键: ${totalLangKeys} 个 (en_us + zh_cn)\n` +
        `配方: ${parsed.data.recipes.length} | 附魔: ${parsed.data.enchantments.length} | 效果: ${parsed.data.effects.length} | 结构: ${parsed.data.structures.length} | 生物群系: ${parsed.data.biomes.length} | 标签: ${parsed.data.itemTags.length + parsed.data.blockTags.length}`
      );
    } catch (e) {
      return `错误：应用模板失败: ${toErrorMessage(e)}`;
    }
  },
};

/**
 * 生成数据包内容：接收 DatapackSpec JSON，运行生成器，产出所有文件到 store
 */
const generateDatapackTool: ToolDefinition = {
  name: 'generate_datapack',
  description:
    '生成数据包内容：传入 DatapackSpec JSON，自动运行 DatapackGenerator 产出所有文件（配方/函数/附魔/效果/损伤/结构/粒子/纹饰/乐器/维度/生物群系等）到项目文件列表。这是生成 MC 内容最高效的方式，一次调用即可生成完整数据包。',
  parameters: [
    {
      name: 'spec_json',
      type: 'string',
      description:
        'DatapackSpec JSON 字符串，包含 packId/packName/packFormat/recipes/enchantments/effects/damageTypes/structures/particles/trimPatterns/trimMaterials/instruments/dimensions/dimensionTypes/biomes/noiseSettings/functions/lootTables/predicates/advancements/tags/itemTags/blockTags 等字段',
      required: true,
    },
  ],
  category: 'write',
  requiresApproval: true,
  execute: async (args) => {
    const specJson = String(args.spec_json);
    let specObj: Record<string, unknown>;
    try {
      specObj = JSON.parse(specJson) as unknown as Record<string, unknown>;
    } catch (e) {
      return `错误：spec_json 不是有效的 JSON: ${toErrorMessage(e)}`;
    }

    const store = useModStore.getState();

    // 动态导入生成器（避免循环依赖）
    try {
      const { DatapackGenerator } =
        await import('@mc-creator/core/generators/datapack/datapack-generator.js');
      const { DatapackSpec: DatapackSpecSchema } = await import('@mc-creator/shared');

      // 用 Zod 校验+填充默认值
      const parsed = DatapackSpecSchema.safeParse(specObj);
      if (!parsed.success) {
        return `错误：DatapackSpec 校验失败:\n${parsed.error.issues.map((issue) => `  ${issue.path.join('.')}: ${issue.message}`).join('\n')}`;
      }

      const gen = new DatapackGenerator();
      // DatapackGenerator 内部会做 spec as unknown as DatapackSpec，这里桥接类型

      const ctx: GeneratorContext = {
        loader: store.loader,
        mcVersion: store.mcVersion,
        modId: parsed.data.packId,
        spec: parsed.data as unknown as ModSpec,
        projectPath: '',
      };

      const result = await gen.generate(ctx);

      // 将生成的文件写入 store
      mergeFilesIntoStore(result.files);

      // 更新 spec（DatapackSpec 与 ModSpec 结构不同，需桥接）
      useModStore.getState().setSpec(parsed.data as unknown as ModSpec);

      const summary = [
        `✅ 数据包生成成功！`,
        `packId: ${parsed.data.packId}`,
        `packFormat: ${parsed.data.packFormat}`,
        `生成文件: ${result.files.length} 个`,
        ...Object.entries({
          recipes: parsed.data.recipes.length,
          enchantments: parsed.data.enchantments.length,
          effects: parsed.data.effects.length,
          damageTypes: parsed.data.damageTypes.length,
          structures: parsed.data.structures.length,
          particles: parsed.data.particles.length,
          trimPatterns: parsed.data.trimPatterns.length,
          trimMaterials: parsed.data.trimMaterials.length,
          instruments: parsed.data.instruments.length,
          dimensions: parsed.data.dimensions.length,
          biomes: parsed.data.biomes.length,
          functions: parsed.data.functions.length,
          lootTables: parsed.data.lootTables.length,
          advancements: parsed.data.advancements.length,
        })
          .filter(([, count]) => count > 0)
          .map(([key, count]) => `  ${key}: ${count}`),
      ];
      if (result.warnings.length > 0) {
        summary.push(`警告: ${result.warnings.join(', ')}`);
      }
      return summary.join('\n');
    } catch (e) {
      return `错误：生成数据包失败: ${toErrorMessage(e)}`;
    }
  },
};

/**
 * 生成 Mod 内容：接收 ModSpec JSON，运行 ModGenerator（Fabric/NeoForge），产出所有 Mod 源文件到 store
 */
const generateModTool: ToolDefinition = {
  name: 'generate_mod',
  description:
    '生成 Mod 内容：传入 ModSpec JSON，自动运行 ModGenerator 产出所有文件（Java 源码 + fabric.mod.json/mods.toml + 资源文件）到项目文件列表。支持 Fabric/NeoForge loader。这是生成 Mod 最高效的方式。',
  parameters: [
    {
      name: 'spec_json',
      type: 'string',
      description:
        'ModSpec JSON 字符串，包含 modId/version/name/description/items/blocks/recipes/entities/machines/multiblocks/eventHandlers/conditions/actions/procedures/customCode 等字段',
      required: true,
    },
    {
      name: 'loader',
      type: 'string',
      description: '加载器：fabric（默认）或 neoforge',
      required: false,
    },
  ],
  category: 'write',
  requiresApproval: true,
  execute: async (args) => {
    const specJson = String(args.spec_json);
    // loader 经守卫收敛为 Loader（非法输入回退 fabric，而非 String 强转）
    const loader: Loader = isLoader(args.loader) ? args.loader : 'fabric';
    let specObj: Record<string, unknown>;
    try {
      specObj = JSON.parse(specJson) as unknown as Record<string, unknown>;
    } catch (e) {
      return `错误：spec_json 不是有效的 JSON: ${toErrorMessage(e)}`;
    }

    try {
      const { ModGenerator } = await import('@mc-creator/core/generators/mod/mod-generator.js');
      const { ModSpec: ModSpecSchema } = await import('@mc-creator/shared');

      // 用 Zod 校验+填充默认值
      const parsed = ModSpecSchema.safeParse(specObj);
      if (!parsed.success) {
        return `错误：ModSpec 校验失败:\n${parsed.error.issues.map((issue) => `  ${issue.path.join('.')}: ${issue.message}`).join('\n')}`;
      }

      const gen = new ModGenerator();
      const ctx: GeneratorContext = {
        loader,
        // 使用当前项目选择的 MC 版本（而非硬编码 1.21.11）
        mcVersion: useModStore.getState().mcVersion,
        modId: parsed.data.modId,
        spec: parsed.data,
        projectPath: '',
      };

      const result = await gen.generate(ctx);

      // 将生成的文件写入 store
      mergeFilesIntoStore(result.files);

      useModStore.getState().setSpec(parsed.data);

      const summary = [
        `✅ Mod 生成成功！`,
        `modId: ${parsed.data.modId} | loader: ${loader}`,
        `生成文件: ${result.files.length} 个`,
        ...Object.entries({
          items: parsed.data.items.length,
          blocks: parsed.data.blocks.length,
          recipes: parsed.data.recipes.length,
          entities: parsed.data.entities.length,
          machines: parsed.data.machines.length,
          multiblocks: parsed.data.multiblocks.length,
          eventHandlers: parsed.data.eventHandlers.length,
          procedures: parsed.data.procedures.length,
          customCode: parsed.data.customCode.length,
        })
          .filter(([, count]) => count > 0)
          .map(([key, count]) => `  ${key}: ${count}`),
      ];
      if (result.warnings.length > 0) {
        summary.push(`警告: ${result.warnings.join(', ')}`);
      }
      return summary.join('\n');
    } catch (e) {
      return `错误：生成 Mod 失败: ${toErrorMessage(e)}`;
    }
  },
};

/**
 * 通用生成工具：按生成器类型 + spec JSON 生成全部文件。
 * 覆盖除 mod/datapack（有专用工具）外的其余 11 种生成器，也支持全部 13 种。
 */
const generateFilesTool: ToolDefinition = {
  name: 'generate_files',
  description:
    '按生成器类型生成内容文件：传入 generator_type 和 spec_json（该类型 spec 的 JSON），自动运行对应生成器产出全部文件到项目文件列表。生成器类型: mod(Java 模组,也可用 generate_mod) | datapack(数据包,也可用 generate_datapack) | modpack(整合包) | server(服务器) | resource_pack(资源包) | skin(皮肤) | launcher(启动器) | kubejs(KubeJS) | crafttweaker(CraftTweaker) | behavior_pack(基岩行为包) | behavior_item(基岩自定义物品) | behavior_entity(基岩自定义实体) | enchantment(数据包附魔)。',
  parameters: [
    {
      name: 'generator_type',
      type: 'string',
      description:
        '生成器类型：mod | datapack | modpack | server | resource_pack | skin | launcher | kubejs | crafttweaker | behavior_pack | behavior_item | behavior_entity | enchantment',
      required: true,
    },
    {
      name: 'spec_json',
      type: 'string',
      description:
        '该生成器类型的 spec JSON 字符串（packId/packName 或 modId/name 或 serverName 等）',
      required: true,
    },
    {
      name: 'loader',
      type: 'string',
      description: '加载器：fabric | neoforge（可选，默认取当前项目选择）',
      required: false,
    },
    {
      name: 'mc_version',
      type: 'string',
      description: 'MC 版本号（可选，默认取当前项目选择）',
      required: false,
    },
  ],
  category: 'write',
  requiresApproval: true,
  execute: async (args) => {
    const type = String(args.generator_type);
    let specObj: Record<string, unknown>;
    try {
      specObj = JSON.parse(String(args.spec_json)) as unknown as Record<string, unknown>;
    } catch (e) {
      return `错误：spec_json 不是有效的 JSON: ${toErrorMessage(e)}`;
    }

    try {
      const store = useModStore.getState();
      const loaderOpt = typeof args.loader === 'string' ? args.loader : store.loader;
      const mcVersionOpt = typeof args.mc_version === 'string' ? args.mc_version : store.mcVersion;
      const result = await generateFilesForType(type, specObj, {
        loader: loaderOpt,
        mcVersion: mcVersionOpt,
      });

      // 合并文件到 store（已有则更新，新增则创建）
      mergeFilesIntoStore(result.files);
      useModStore.getState().setSpec(result.spec as unknown as ModSpec);

      const summary = [`✅ ${type} 生成成功！`, `生成文件: ${result.files.length} 个`];
      const spec = result.spec as unknown as Record<string, unknown>;
      const counts = Object.entries(spec)
        .filter(([, v]) => Array.isArray(v) && v.length > 0)
        .map(([k, v]) => `  ${k}: ${(v as unknown[]).length}`);
      if (counts.length > 0) summary.push(...counts);
      if (result.warnings.length > 0) {
        summary.push(`警告: ${result.warnings.join(', ')}`);
      }
      return summary.join('\n');
    } catch (e) {
      return `错误：${toErrorMessage(e)}`;
    }
  },
};

/**
 * 获取项目上下文（spec + 文件结构概览）
 */
const getProjectContextTool: ToolDefinition = {
  name: 'get_project_context',
  description: '获取项目整体上下文：spec 信息、文件树、当前选中的文件',
  parameters: [],
  category: 'read',
  requiresApproval: false,
  execute: async () => {
    const state = useModStore.getState();
    const lines: string[] = [];
    lines.push(`=== 项目概览 ===`);
    lines.push(`生成器类型: ${state.generatorType}`);
    lines.push(`Loader: ${state.loader}`);
    lines.push(`MC 版本: ${state.mcVersion}`);
    lines.push(`描述: ${state.description}`);
    if (state.spec) {
      lines.push(`\n=== Spec ===`);
      const specStr = JSON.stringify(state.spec, null, 2);
      // 显示完整 spec（上限 4000 字符，足以覆盖大部分场景）
      lines.push(specStr.length > 4000 ? specStr.slice(0, 4000) + '\n... (截断)' : specStr);
      // Spec 内容摘要
      const spec = state.spec as unknown as Record<string, unknown>;
      lines.push(`\n=== Spec 内容摘要 ===`);
      const countFields = [
        'recipes',
        'functions',
        'advancements',
        'lootTables',
        'predicates',
        'itemTags',
        'blockTags',
        'enchantments',
        'effects',
        'damageTypes',
        'structures',
        'particles',
        'trimPatterns',
        'trimMaterials',
        'instruments',
        'dimensions',
        'dimensionTypes',
        'biomes',
        'noiseSettings',
      ];
      for (const field of countFields) {
        const arr = spec[field];
        if (Array.isArray(arr) && arr.length > 0) {
          lines.push(`  ${field}: ${arr.length} 个`);
        }
      }
      lines.push(`\n=== 可生成内容类型 ===`);
      lines.push(
        `配方(crafting_shaped/shapeless/smelting/blasting/smoking/campfire_cooking/stonecutting/smithing_transform/smithing_trim/brewing)`,
      );
      lines.push(
        `附魔(enchantments,1.21+) | 状态效果(effects,1.21+) | 损伤类型(damageTypes,1.19.4+)`,
      );
      lines.push(
        `结构(structures) | 粒子(particles) | 盔甲纹饰(trimPatterns/trimMaterials,1.20+) | 乐器(instruments,1.19+)`,
      );
      lines.push(
        `维度(dimensions) | 维度类型(dimensionTypes) | 生物群系(biomes) | 噪声设置(noiseSettings)`,
      );
      lines.push(
        `函数(functions) | 战利品表(lootTables) | 谓词(predicates) | 进度(advancements) | 标签(tags/itemTags/blockTags)`,
      );
    }
    lines.push(`\n=== 文件列表 (${state.files.length} 个) ===`);
    for (const f of state.files) {
      lines.push(
        `  ${f.path} (${f.content.length} 字符)${state.dirtyFiles.has(f.path) ? ' [已修改]' : ''}`,
      );
    }
    if (state.selectedFile) {
      lines.push(`\n当前选中文件: ${state.selectedFile}`);
    }
    return lines.join('\n');
  },
};

/**
 * 所有可用工具的注册表
 */
export const agentTools: ToolDefinition[] = [
  readFileTool,
  listFilesTool,
  searchCodeTool,
  writeFileTool,
  editFileTool,
  deleteFileTool,
  runCommandTool,
  applyContentTemplateTool,
  generateDatapackTool,
  generateModTool,
  generateFilesTool,
  getProjectContextTool,
];

/**
 * 根据工具名查找工具定义
 */
export function findTool(name: string): ToolDefinition | undefined {
  return agentTools.find((t) => t.name === name);
}

/**
 * 将工具定义转换为 AI function calling 格式（OpenAI 兼容）
 */
export function toolsToFunctionDefinitions(): Array<{
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, unknown>;
      required: string[];
    };
  };
}> {
  return agentTools.map((tool) => ({
    type: 'function' as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: {
        type: 'object',
        properties: Object.fromEntries(
          tool.parameters.map((p) => [
            p.name,
            {
              type: p.type,
              description: p.description,
              ...(p.enum ? { enum: p.enum } : {}),
            },
          ]),
        ),
        required: tool.parameters.filter((p) => p.required).map((p) => p.name),
      },
    },
  }));
}
