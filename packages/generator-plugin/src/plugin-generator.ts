/**
 * Paper 插件生成器（设计文档 §11 生成阶梯 P1 甜点区 / §7.3 / §10.4）。
 *
 * 输入 PluginSpec，产出 FileNode[]（复用 @mc-creator/shared 的 FileNode 形状，
 * 与 DatapackGenerator 的产出风格一致：纯数据文件列表，不触碰磁盘）。
 * 编译与沙箱验证由 devkit 接管（packages/devkit/src/gradle.ts runGradleBuild +
 * sandbox.ts），本包只负责"生成可构建的工程源文件"。
 *
 * 上下文注入（§10.4）：生成时调用方须按目标注入 Paper API 类型定义与
 * Folia 兼容标记——本包通过 target/foliaSupported 把"平台认知"写进代码
 * （运行时类检测）与清单（folia-supported 硬开关），使产物自带平台声明。
 */
import { VALIDATION_CRITERIA } from '@mc-creator/contract';
import type { FileNode } from '@mc-creator/shared';
import { PluginSpecSchema, type PluginSpec } from './plugin-spec.js';

/** 双清单路径（§7.3：paper-plugin.yml 不是 plugin.yml 的替代，两者共存于同一 JAR）。 */
export const PAPER_MANIFEST_PATH = 'src/main/resources/paper-plugin.yml';
export const LEGACY_MANIFEST_PATH = 'src/main/resources/plugin.yml';

/**
 * 解析最终写入 paper-plugin.yml 的 folia-supported 值：
 * - folia 目标强制 true（§7.3 硬开关，否则无法在 Folia 上运行）；
 * - spigot 目标强制 false（Spigot 无区域化线程模型，不声明 Folia 支持）；
 * - paper 目标透传调用方的 foliaSupported。
 */
export function resolveFoliaSupported(
  spec: Pick<PluginSpec, 'target' | 'foliaSupported'>,
): boolean {
  if (spec.target === 'folia') return true;
  if (spec.target === 'spigot') return false;
  return spec.foliaSupported;
}

/** 主类全限定名（清单 main 字段）。 */
export function mainClassFqn(spec: Pick<PluginSpec, 'namespace' | 'mainClass'>): string {
  return `${spec.namespace}.${spec.mainClass}`;
}

/** 主类源码相对路径。 */
export function mainClassPath(spec: Pick<PluginSpec, 'namespace' | 'mainClass'>): string {
  return `src/main/java/${spec.namespace.replace(/\./g, '/')}/${spec.mainClass}.java`;
}

/** YAML 标量转义（命令/权限的 description 含冒号等时仍能产出合法清单）。 */
function yamlScalar(value: string): string {
  if (value === '') return "''";
  if (/^[A-Za-z0-9_./-]+$/.test(value)) return value;
  return `'${value.replace(/'/g, "''")}'`;
}

function renderCommands(spec: PluginSpec): string {
  if (spec.commands.length === 0) return '';
  const lines = ['commands:'];
  for (const c of spec.commands) {
    lines.push(`  ${c.name}:`);
    if (c.description !== '') lines.push(`    description: ${yamlScalar(c.description)}`);
    lines.push(`    usage: ${yamlScalar(c.usage === '' ? `/${c.name}` : c.usage)}`);
    if (c.permission !== '') lines.push(`    permission: ${yamlScalar(c.permission)}`);
  }
  return lines.join('\n') + '\n';
}

function renderPermissions(spec: PluginSpec): string {
  if (spec.permissions.length === 0) return '';
  const lines = ['permissions:'];
  for (const p of spec.permissions) {
    lines.push(`  ${p.name}:`);
    if (p.description !== '') lines.push(`    description: ${yamlScalar(p.description)}`);
    lines.push(`    default: ${p.default}`);
  }
  return lines.join('\n') + '\n';
}

function renderPaperManifest(spec: PluginSpec): string {
  const folia = resolveFoliaSupported(spec);
  const head = [
    `# target: ${spec.target}（生成器标记：供 validatePluginStructure 读取目标，见 §7.3）`,
    `name: ${yamlScalar(spec.name)}`,
    `version: ${yamlScalar(spec.version)}`,
    `main: ${mainClassFqn(spec)}`,
    `api-version: ${yamlScalar(spec.apiVersion)}`,
  ];
  if (spec.author !== '') head.push(`author: ${yamlScalar(spec.author)}`);
  if (spec.description !== '') head.push(`description: ${yamlScalar(spec.description)}`);
  // §7.3 Folia 硬开关：folia 目标强制 true，paper 目标透传，spigot 目标强制 false。
  head.push(`folia-supported: ${folia ? 'true' : 'false'}`);
  const body = [head.join('\n')];
  const commands = renderCommands(spec);
  if (commands !== '') body.push(commands.trimEnd());
  const permissions = renderPermissions(spec);
  if (permissions !== '') body.push(permissions.trimEnd());
  return body.join('\n') + '\n';
}

function renderLegacyManifest(spec: PluginSpec): string {
  // plugin.yml 为 legacy 格式：无 folia-supported 键（硬开关只存在于 paper-plugin.yml），
  // 其余 name/version/main/api-version/commands/permissions 与新清单保持一致。
  const head = [
    `# target: ${spec.target}（生成器标记：与 paper-plugin.yml 共存，见 §7.3）`,
    `name: ${yamlScalar(spec.name)}`,
    `version: ${yamlScalar(spec.version)}`,
    `main: ${mainClassFqn(spec)}`,
    `api-version: ${yamlScalar(spec.apiVersion)}`,
  ];
  if (spec.author !== '') head.push(`author: ${yamlScalar(spec.author)}`);
  if (spec.description !== '') head.push(`description: ${yamlScalar(spec.description)}`);
  const body = [head.join('\n')];
  const commands = renderCommands(spec);
  if (commands !== '') body.push(commands.trimEnd());
  const permissions = renderPermissions(spec);
  if (permissions !== '') body.push(permissions.trimEnd());
  return body.join('\n') + '\n';
}

function renderMainClass(spec: PluginSpec): string {
  const folia = resolveFoliaSupported(spec);
  return `package ${spec.namespace};

import org.bukkit.plugin.java.JavaPlugin;

/**
 * ${spec.name} 主类（生成目标：${spec.target}）。
 * §10.4 上下文注入：生成代码必须知道自己在哪个平台上——
 * isFolia() 在运行时检测 Folia（RegionizedServer 类是否存在），
 * 调度器分支见下方注释（Paper/Spigot 用 BukkitScheduler，
 * Folia 必须用 regionised scheduler）。
 */
public final class ${spec.mainClass} extends JavaPlugin {

    @Override
    public void onEnable() {
        // §10.3 成功判据 grep 点：启动完成标志 + enabled，且无 Exception。
        getLogger().info("${spec.name} enabled for ${spec.target} (folia-supported=${folia ? 'true' : 'false'})");
        if (isFolia()) {
            // Folia 分支：只能使用 getServer().getRegionScheduler() /
            // getServer().getAsyncScheduler()（区域化调度器），
            // BukkitScheduler 会因区域归属检查抛错。
            getLogger().info("Running on Folia, using regionised scheduler");
        } else {
            // Paper/Spigot 分支：getServer().getScheduler()（BukkitScheduler）。
            getLogger().info("Running on Bukkit scheduler");
        }
    }

    @Override
    public void onDisable() {
        // §10.3 判据辅助：优雅停机日志，便于 read_logs 判定生命周期完整。
        getLogger().info("${spec.name} disabled");
    }

    /**
     * Folia 运行时检测（§7.3）：判断
     * io.papermc.paper.threadedregions.RegionizedServer 类是否存在。
     */
    private boolean isFolia() {
        try {
            Class.forName("io.papermc.paper.threadedregions.RegionizedServer");
            return true;
        } catch (ClassNotFoundException e) {
            return false;
        }
    }
}
`;
}

function renderConfig(spec: PluginSpec): string {
  return `# ${spec.name} 默认配置（随插件 JAR 发布，用户可在 plugins/${spec.name}/config.yml 修改）
version: ${yamlScalar(spec.version)}
debug: false
`;
}

function renderBuildGradle(spec: PluginSpec): string {
  return `// ${spec.name} 构建脚本（paperweight 占位）。
// 真实构建由 devkit 接管：packages/devkit/src/gradle.ts runGradleBuild
// （Gradle daemon 常驻 + 依赖缓存 + 超时杀进程），本文件仅保证生成工程
// 可被 Gradle 识别、不手写完整工具链。
// §0.5：paper-api 版本必须运行时拉取，禁止写死——下方版本号为调用方
// 传入 apiVersion (${spec.apiVersion}) 的直接映射，不是"最新版"承诺。
plugins {
    id 'java'
}

repositories {
    mavenCentral()
    maven { url = 'https://repo.papermc.io/repository/maven-public/' }
}

dependencies {
    compileOnly "io.papermc.paper:paper-api:${spec.apiVersion}-R0.1-SNAPSHOT"
}

java {
    toolchain {
        // 按目标 MC 版本选择 JDK（映射见 devkit jdk.ts），此处仅占位。
        languageVersion = JavaLanguageVersion.of(21)
    }
}
`;
}

function renderReadme(spec: PluginSpec): string {
  const criterion = VALIDATION_CRITERIA['server-plugin'] ?? '';
  const folia = resolveFoliaSupported(spec);
  const commandList =
    spec.commands.length === 0 ? '（无）' : spec.commands.map((c) => `/${c.name}`).join('、');
  return `# ${spec.name}

Paper 插件工程（生成目标：${spec.target}，folia-supported: ${folia ? 'true' : 'false'}，api-version: ${spec.apiVersion}）。
由 @mc-creator/generator-plugin 生成（设计文档 §7.3 / §11 P1）。

## 工程结构

- \`${mainClassPath(spec)}\`：插件主类（含 onEnable/onDisable 日志行，供 §10.3 判据 grep）
- \`${PAPER_MANIFEST_PATH}\`：Paper 新清单（含 \`folia-supported\` 硬开关）
- \`${LEGACY_MANIFEST_PATH}\`：legacy 清单（与新清单共存于同一 JAR，§7.3）
- \`config.yml\`：默认配置
- \`build.gradle\`：paperweight 占位（真实构建由 devkit 接管）

## 命令

${commandList}

## 部署验证闭环（MCP 工具链）

1. \`build_project\`（devkit 编译，产物哈希记录备查）
2. \`deploy_plugin\` 部署到沙箱服务端（§8.3：产物永不自动加载进正式服，先在一次性沙箱验证）
3. \`restart_server\` 重启沙箱服务端
4. \`read_logs\` 读取日志，按 §10.3 成功判据判定：${criterion}
5. 失败则把日志回灌给智能体修复，循环直到判据通过；人工确认后方可进正式服

## Folia 说明

${spec.target === 'folia' ? '本工程目标为 Folia：清单已强制声明 `folia-supported: true`，主类在运行时检测 RegionizedServer 并走 regionised scheduler 分支。' : spec.target === 'paper' ? '本工程目标为 Paper：folia 支持按生成参数透传（当前为 ' + (folia ? 'true' : 'false') + '）；如需上 Folia，须重新生成并声明支持（§7.3 硬开关）。' : '本工程目标为 Spigot：不声明 Folia 支持，不可在 Folia 上运行。'}
`;
}

/**
 * 生成 Paper 插件工程源文件（纯函数，不触碰磁盘、不触发构建）。
 * @param spec 插件规格（apiVersion 必填，调用方须运行时拉取，见 §0.5）
 */
export function generatePlugin(spec: PluginSpec): FileNode[] {
  const parsed = PluginSpecSchema.parse(spec);
  return [
    { path: mainClassPath(parsed), content: renderMainClass(parsed) },
    { path: PAPER_MANIFEST_PATH, content: renderPaperManifest(parsed) },
    { path: LEGACY_MANIFEST_PATH, content: renderLegacyManifest(parsed) },
    { path: 'config.yml', content: renderConfig(parsed) },
    { path: 'build.gradle', content: renderBuildGradle(parsed) },
    { path: 'README.md', content: renderReadme(parsed) },
  ];
}
