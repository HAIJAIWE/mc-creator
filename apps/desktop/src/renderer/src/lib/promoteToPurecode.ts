import type { FileNode } from '@mc-creator/shared';

/**
 * L2 → L3 提升路径：把节点图中的 Code 节点提升为 L3 纯代码模式的脚手架文件
 *
 * 设计参考：
 * - `packages/core/src/generators/mod/templates.ts` 的 pascalCase/packageName/packagePath/mainClassName
 * - `packages/core/src/generators/mod/fabric-adapter.ts` 的 modCustomCodeJava 方法（用户代码嵌入风格）
 * - `apps/desktop/src/renderer/src/components/purecode/PurecodeWorkspace.tsx` 的 PRESET_FILES 文件结构
 *
 * 生成 4 个文件：
 *   1. src/main/java/com/example/<modId>/<MainCls>.java —— ModInitializer 入口
 *   2. src/main/java/com/example/<modId>/ModCustomCode.java —— 包含用户代码方法
 *   3. src/main/resources/fabric.mod.json —— 最小 Fabric 配置
 *   4. build.gradle —— fabric-loom 1.7-SNAPSHOT + Java 21
 *
 * 集成说明：
 *   本模块仅负责生成 FileNode[]，不直接写入 PurecodeWorkspace（避免与集成步骤冲突）。
 *   调用方（如 CodeNodeEditor 的"提升到 L3"按钮）负责把结果交给 useModStore.setFiles 或
 *   window.__promotedFiles，再由 PurecodeWorkspace 在挂载/模式切换时读取并展示。
 */

/** Code 节点的最小数据结构（从 NodeData 中提取需要的字段） */
export interface CodeNodeDataForPromotion {
  /** 节点 ID（用于注释中回溯） */
  nodeId: string;
  /** 节点显示名 */
  label: string;
  /** 节点备注 */
  note: string;
  /** 代码语言（'java' / 'javascript' / 'kotlin'） */
  language: string;
  /** 代码内容（方法体或完整代码） */
  code: string;
  /** JSON 格式的输入签名（{ portId: PortType }） */
  inputSignature: string;
  /** JSON 格式的输出签名 */
  outputSignature: string;
  /** 方法名（如 'process'） */
  methodName: string;
}

/** 提升结果 */
export interface PromotionResult {
  /** 生成的文件列表（Java 源码 + 配置 + 构建脚本） */
  files: FileNode[];
  /** 主类名（PascalCase，如 RubyToolsMod） */
  mainClassName: string;
  /** 包名（如 com.example.ruby_tools） */
  packageName: string;
  /** 提升摘要（用于 toast/通知） */
  summary: string;
}

// === 内部工具 ===

/**
 * 将 modId 转为 PascalCase（ruby_tools → RubyTools）。
 * 与 templates.ts 的 pascalCase 行为一致。
 */
function toPascalCase(modId: string): string {
  const parts = modId
    .split('_')
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length === 0) return 'Untitled';
  return parts.map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join('');
}

/**
 * 把任意字符串清理为合法 Java 标识符片段（用于方法名、参数名）。
 * 保留字母数字与下划线，其余字符替换为下划线；首字符为数字时加 _ 前缀。
 * P1 dogfood 修复：空字符串/纯特殊字符 → 返回 "unknown"。
 */
function sanitizeIdent(s: string): string {
  if (!s) return 'unknown';
  const sanitized = s.replace(/[^a-zA-Z0-9_]/g, '_');
  const result = /^[0-9]/.test(sanitized) ? `_${sanitized}` : sanitized;
  if (!result || result === '_') return 'unknown';
  return result;
}

/**
 * 规范化 modId：仅保留小写字母/数字/下划线，空值回退到 'untitled'。
 * 与 ModSpec.modId 的正则 /^[a-z0-9_]+$/ 对齐。
 */
function safeModId(modId: string): string {
  const trimmed = (modId ?? '').trim().toLowerCase();
  if (!trimmed) return 'untitled';
  // 把非法字符替换为下划线，再合并连续下划线
  const cleaned = trimmed.replace(/[^a-z0-9_]/g, '_').replace(/_+/g, '_');
  return cleaned || 'untitled';
}

/**
 * PortType（节点图端口类型字符串）→ Java 类型映射。
 * 与 fabric-adapter.ts 的 portTypeToJava 行为一致（简化版）。
 */
function portTypeToJava(portType: string): string {
  const lower = (portType ?? '').toLowerCase();
  switch (lower) {
    case 'integer':
    case 'int':
    case 'long':
      return 'int';
    case 'number':
    case 'float':
    case 'double':
      return 'double';
    case 'string':
    case 'text':
      return 'String';
    case 'boolean':
    case 'bool':
      return 'boolean';
    case 'void':
    case 'none':
      return 'void';
    case 'item':
    case 'item_stack':
    case 'itemstack':
      return 'ItemStack';
    case 'block':
    case 'block_state':
    case 'blockstate':
      return 'BlockState';
    case 'entity':
      return 'Entity';
    case 'player':
      return 'Player';
    case 'world':
      return 'World';
    case 'fluid':
      return 'FluidState';
    case 'energy':
    case 'redstone':
      return 'int';
    case 'nbt':
      return 'CompoundTag';
    default:
      return 'Object';
  }
}

/**
 * 安全解析 inputSignature/outputSignature JSON 字符串。
 * 解析失败或非对象时返回空对象 {}，绝不抛错。
 */
function parseSignature(sig: string): Record<string, string> {
  if (!sig || !sig.trim()) return {};
  try {
    const parsed: unknown = JSON.parse(sig);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const result: Record<string, string> = {};
      for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
        result[k] = typeof v === 'string' ? v : String(v);
      }
      return result;
    }
  } catch {
    // 忽略解析失败，返回空对象
  }
  return {};
}

/** 缩进一段代码：每行前加 8 个空格（方法体内部缩进） */
function indentBody(code: string): string {
  return code
    .split('\n')
    .map((line) => `        ${line}`)
    .join('\n');
}

// === 文件生成器 ===

/** 生成 ModMain.java：ModInitializer 入口，onInitialize 调用 ModCustomCode.initialize() */
function generateModMainJava(pkg: string, mainCls: string, modId: string): string {
  return `package ${pkg};

import net.fabricmc.api.ModInitializer;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Mod 入口类（从节点图 Code 节点提升生成）
 *
 * 由 L2 混合模式中的 Code 节点提升为 L3 纯代码模式时自动生成。
 * onInitialize 中调用 ModCustomCode.initialize() 触发自定义代码加载。
 */
public class ${mainCls} implements ModInitializer {
    public static final String MOD_ID = "${modId}";
    public static final Logger LOGGER = LoggerFactory.getLogger(MOD_ID);

    @Override
    public void onInitialize() {
        ModCustomCode.initialize();
        LOGGER.info("Initializing ${modId} (promoted from L2 code node)");
    }
}
`;
}

/**
 * 生成 ModCustomCode.java：把每个 Code 节点的方法嵌入为独立静态方法。
 *
 * 每个方法上方保留注释（nodeId/label/note/language/signature），
 * 便于用户在 L3 模式中回溯节点来源。
 */
function generateModCustomCodeJava(
  pkg: string,
  modId: string,
  codeNodes: CodeNodeDataForPromotion[],
): string {
  const methods = codeNodes
    .map((node) => {
      const methodName = sanitizeIdent(node.methodName || 'process');
      const inputSig = parseSignature(node.inputSignature);
      const outputSig = parseSignature(node.outputSignature);

      const inputParams = Object.entries(inputSig)
        .map(([k, v]) => `${portTypeToJava(v)} ${sanitizeIdent(k)}`)
        .join(', ');

      const outputEntries = Object.entries(outputSig);
      let outputType: string;
      if (outputEntries.length === 1) {
        outputType = portTypeToJava(outputEntries[0][1]);
      } else if (outputEntries.length > 1) {
        outputType = 'Object';
      } else {
        outputType = 'void';
      }

      // 处理用户代码：空则用 TODO 占位，否则缩进嵌入方法体
      const userCode = node.code && node.code.trim() ? node.code : '// TODO: 在此实现逻辑';

      return `    // === 从节点图 Code 节点提升生成 ===
    // nodeId: ${node.nodeId}
    // label: ${node.label}
    // note: ${node.note}
    // language: ${node.language}
    // inputSignature:  ${JSON.stringify(inputSig)}
    // outputSignature: ${JSON.stringify(outputSig)}
    public static ${outputType} ${methodName}(${inputParams}) {
${indentBody(userCode)}
    }`;
    })
    .join('\n\n');

  return `package ${pkg};

/**
 * 自定义代码集合（从节点图 Code 节点提升生成）
 *
 * 由 L2 混合模式中的 Code 节点提升为 L3 纯代码模式时自动生成。
 * 每个原 Code 节点对应此处一个静态方法，保留原签名注释（nodeId/label/note/signature），
 * 便于用户在 L3 模式中回溯节点来源。
 *
 * 共 ${codeNodes.length} 个方法。
 */
public class ModCustomCode {
    public static final String MOD_ID = "${modId}";

${methods}

    public static void initialize() {
        // 自定义代码片段已加载（共 ${codeNodes.length} 个方法）
    }
}
`;
}

/** 生成 fabric.mod.json：最小 Fabric 配置（schemaVersion 1，entrypoints 指向主类） */
function generateFabricModJson(pkg: string, mainCls: string, modId: string): string {
  const content = {
    schemaVersion: 1,
    id: modId,
    // L-1 修复：反斜杠转义，输出字面量 ${version} 供 gradle processResources expand 占位替换
    version: '${version}',
    name: `${modId} (promoted)`,
    description: '从 L2 Code 节点提升生成的 L3 纯代码 Mod',
    authors: ['mc-creator'],
    entrypoints: {
      main: [`${pkg}.${mainCls}`],
    },
    depends: {
      fabricloader: '>=0.16.0',
      minecraft: '~1.21',
      java: '>=21',
      'fabric-api': '*',
    },
  };
  return JSON.stringify(content, null, 2);
}

/** 生成 build.gradle：fabric-loom 1.7-SNAPSHOT + Java 21（与 fabric-adapter.ts 风格一致） */
function generateBuildGradle(): string {
  return `plugins {
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
}

// === 对外 API ===

/**
 * 将单个 Code 节点提升为 L3 纯代码模式的脚手架文件
 *
 * 生成内容：
 * - ModMain.java：ModInitializer 入口（包含 initialize 调用）
 * - ModCustomCode.java：包含用户在 Code 节点中写的方法（保留原签名注释）
 * - fabric.mod.json：最小 Fabric 配置
 * - build.gradle：最小构建脚本
 *
 * @param codeNode 从节点图选中的 code 节点数据
 * @param modId 当前 modId（用于包名和文件路径；空值回退到 'untitled'）
 */
export function promoteCodeNodeToPurecode(
  codeNode: CodeNodeDataForPromotion,
  modId: string,
): PromotionResult {
  return promoteMultipleCodeNodes([codeNode], modId);
}

/**
 * 将多个 Code 节点合并提升为一个 L3 项目
 *
 * 所有 Code 节点的方法都放在同一个 ModCustomCode.java 中，
 * ModMain.onInitialize 仅调用一次 ModCustomCode.initialize()。
 *
 * @param codeNodes 多个 code 节点数据（按数组顺序生成方法）
 * @param modId 当前 modId
 */
export function promoteMultipleCodeNodes(
  codeNodes: CodeNodeDataForPromotion[],
  modId: string,
): PromotionResult {
  const safeId = safeModId(modId);
  const pkg = `com.example.${safeId}`;
  const mainCls = `${toPascalCase(safeId)}Mod`;
  const packagePath = `com/example/${safeId}`;

  const files: FileNode[] = [
    {
      path: `src/main/java/${packagePath}/${mainCls}.java`,
      content: generateModMainJava(pkg, mainCls, safeId),
    },
    {
      path: `src/main/java/${packagePath}/ModCustomCode.java`,
      content: generateModCustomCodeJava(pkg, safeId, codeNodes),
    },
    {
      path: 'src/main/resources/fabric.mod.json',
      content: generateFabricModJson(pkg, mainCls, safeId),
    },
    {
      path: 'build.gradle',
      content: generateBuildGradle(),
    },
  ];

  return {
    files,
    mainClassName: mainCls,
    packageName: pkg,
    summary: `已将 ${codeNodes.length} 个 Code 节点提升为 L3 纯代码模式（生成 ${files.length} 个文件，主类 ${mainCls}）`,
  };
}
