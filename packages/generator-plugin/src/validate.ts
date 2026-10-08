/**
 * 插件工程结构校验（纯函数，无 IO）。
 * 供 validate_content / 生成后自检调用；错误文案为中文，直接面向用户与智能体回灌。
 */
import type { FileNode } from '@mc-creator/shared';
import { LEGACY_MANIFEST_PATH, PAPER_MANIFEST_PATH } from './plugin-generator.js';

export interface PluginStructureValidation {
  ok: boolean;
  errors: string[];
  /**
   * 不阻断构建的告警（2026-10 新增）。
   *
   * 与 `errors` 的区别是**是否已由权威源确认**：
   * `errors` 里的每一条都对着可查证的规则（如清单缺 `main`、api-version 格式非法）；
   * `warnings` 收的是「我们无法确认，但产物里写了可能有影响」的情况 ——
   * 典型是 `folia-supported`（§21 #10 核实结论，见下方第 3 条）。
   */
  warnings: string[];
}

/**
 * api-version 格式：<主>.<次>[.<修订>]，兼容 '1.21' 与 '26.1.2'（§7.3）。
 * 注意：此处只校验"格式"，不校验"是否为当前最新版"——版本新鲜度
 * 由调用方运行时拉取保证（§0.5），禁止在本包写死版本表。
 */
export const API_VERSION_PATTERN = /^\d+\.\d+(\.\d+)?$/;

/** 取 YAML 顶层 `key: value` 标量（忽略注释行与缩进块；值两侧引号自动剥离）。 */
function getScalar(content: string, key: string): string | null {
  const re = new RegExp(`^${key}\\s*:\\s*(.+?)\\s*$`, 'm');
  const hit = re.exec(content);
  if (hit === null || hit[1] === undefined) return null;
  const raw = hit[1].trim();
  if (raw === "''" || raw === '""') return '';
  const quoted = /^(['"])(.*)\1$/.exec(raw);
  return quoted?.[2] ?? raw.split(/\s+#/)[0]?.trim() ?? raw;
}

/** 生成器写入的 `# target: <paper|folia|spigot>` 标记行（无标记时回退启发式）。 */
function readTargetMarker(content: string): 'paper' | 'folia' | 'spigot' | null {
  const hit = /^#\s*target:\s*(paper|folia|spigot)\b/m.exec(content);
  const v = hit?.[1];
  return v === 'paper' || v === 'folia' || v === 'spigot' ? v : null;
}

export function validatePluginStructure(files: FileNode[]): PluginStructureValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  const byPath = new Map<string, string>();
  for (const f of files) byPath.set(f.path, f.content);

  // 1. 双清单并存（§7.3：paper-plugin.yml 不是 plugin.yml 的替代）。
  const paper = byPath.get(PAPER_MANIFEST_PATH);
  const legacy = byPath.get(LEGACY_MANIFEST_PATH);
  if (paper === undefined) {
    errors.push(
      `缺少 ${PAPER_MANIFEST_PATH}（§7.3 要求 paper-plugin.yml 与 plugin.yml 共存于同一 JAR）`,
    );
  }
  if (legacy === undefined) {
    errors.push(
      `缺少 ${LEGACY_MANIFEST_PATH}（§7.3 要求 paper-plugin.yml 与 plugin.yml 共存于同一 JAR）`,
    );
  }

  // 2. api-version 格式（兼容 26.1.2）+ 双清单一致。
  const apiVersions = new Map<string, string>();
  for (const [label, content] of [
    [PAPER_MANIFEST_PATH, paper],
    [LEGACY_MANIFEST_PATH, legacy],
  ] as const) {
    if (content === undefined) continue;
    const api = getScalar(content, 'api-version');
    if (api === null || api === '') {
      errors.push(`${label} 缺少 api-version（§7.3 必填，调用方须运行时拉取值）`);
    } else if (!API_VERSION_PATTERN.test(api)) {
      errors.push(
        `${label} 的 api-version "${api}" 格式非法，应为 <主>.<次>[.<修订>]（如 1.21 / 26.1.2）`,
      );
    } else {
      apiVersions.set(label, api);
    }
  }
  const distinctApis = new Set(apiVersions.values());
  if (distinctApis.size > 1) {
    errors.push(
      `两份清单的 api-version 不一致：${[...apiVersions].map(([k, v]) => `${k}=${v}`).join('，')}`,
    );
  }

  // 3. Folia 声明检查（§7.3）。
  //
  // ⚠️ **这一条曾经是「硬失败」，现已降级为告警**（2026-10，§21 #10 核实后）。
  //
  // 原实现：工程目标为 Folia 而清单未声明 `folia-supported: true` 即校验失败。
  // 问题不在于「要不要写这个键」，而在于**我无法从任何可达的权威源确认这个键存在**。
  //
  // 核实范围（全部实查，均为「不存在」）：
  //   - Paper 官方文档 paper-plugins 页        → 无
  //   - Folia 官方文档                          → 无
  //   - Paper 源码 org/bukkit/plugin/PluginDescriptionFile.java（plugin.yml 的 22 个
  //     权威键常量：name/provides/version/main/commands/class-loader-of/depend/
  //     softdepend/loadbefore/website/description/load/authors/author/contributors/
  //     default-permission/awareness/api-version/libraries/paper-plugin-loader/
  //     paper-skip-libraries/permissions/prefix/order）  → 无
  //   - Paper 源码 io/papermc/paper/plugin/configuration/PluginMeta.java
  //     （paper-plugin.yml 的模型类，只有 getAPIVersion()） → 无
  //   - Paper 仓库全树 5520 个文件              → 相关候选均无
  //   - paper-api jar（26.3-pre-2，2345 class）与 Paper 服务端 jar（26.3-159）
  //     的 class 常量池                         → 无
  //   - Folia 仓库（默认分支 ver/26.2.x，仅 71 条，是版本分支，Paper 为上游）
  //     → 无法 grep
  //
  // 与 MEMORY §7.2（velocity `config.json` 造键）、§6.4（MER 贴图）同类：
  // **凭「大家都这么写」或凭记忆认定一个字段存在，然后拿它当硬门禁。**
  // 一旦字段不存在，被卡住的是用户的构建，而报错文案还会「自信」地解释原因。
  //
  // 为什么**保留**生成但不**保留**门禁：
  //   - 写进去的成本极低且无害 —— YAML 解析器忽略未知键，Paper/Folia 不会因此报错；
  //   - 万一该键真实存在（社区广泛使用），写进去是对的；
  //   - 但在无法确认它被识别之前，**不能拿它否决别人的构建**。
  // 所以：仍然生成 `folia-supported`（best-effort），缺失时给 warning 而非 error。
  if (paper !== undefined) {
    const marker = readTargetMarker(paper);
    const wantsFolia =
      marker === 'folia' ||
      (marker === null && [...byPath.values()].some((c) => c.includes('RegionizedServer')));
    const declared = (getScalar(paper, 'folia-supported') ?? '').toLowerCase();
    if (wantsFolia && declared !== 'true') {
      warnings.push(
        'paper-plugin.yml 未声明 folia-supported: true，但工程目标为 Folia。' +
          '注意：该键无法从 Paper/Folia 官方文档或源码确认存在（见本文件 §21 #10 核实记录），' +
          '因此此处只告警不判失败；若你在 Folia 上运行后被拒绝加载，请手动确认该键是否受支持。',
      );
    } else if (wantsFolia) {
      warnings.push(
        '已声明 folia-supported: true，但该键未经官方源确认（Folia 侧判读逻辑未能在可达源码中定位）。' +
          '若 Folia 仍拒绝加载该插件，请以其实际报错为准。',
      );
    }
  }

  // 4. main 类路径与清单一致：两份清单 main 相同，且对应源码文件存在、包名相符。
  if (paper !== undefined && legacy !== undefined) {
    const mainA = getScalar(paper, 'main');
    const mainB = getScalar(legacy, 'main');
    if (mainA === null || mainA === '') {
      errors.push(`${PAPER_MANIFEST_PATH} 缺少 main（主类全限定名）`);
    }
    if (mainB === null || mainB === '') {
      errors.push(`${LEGACY_MANIFEST_PATH} 缺少 main（主类全限定名）`);
    }
    if (mainA !== null && mainA !== '' && mainB !== null && mainB !== '' && mainA !== mainB) {
      errors.push(`两份清单的 main 不一致：paper-plugin.yml=${mainA}，plugin.yml=${mainB}`);
    }
    const main = mainA !== null && mainA !== '' ? mainA : mainB;
    if (main !== null && main !== '') {
      const expectedPath = `src/main/java/${main.replace(/\./g, '/')}.java`;
      const java = byPath.get(expectedPath);
      if (java === undefined) {
        errors.push(`清单 main=${main} 对应的源码文件缺失（应为 ${expectedPath}）`);
      } else {
        const lastDot = main.lastIndexOf('.');
        const pkg = main.slice(0, lastDot);
        const cls = main.slice(lastDot + 1);
        if (!new RegExp(`^package\\s+${pkg.replace(/\./g, '\\.')}\\s*;`, 'm').test(java)) {
          errors.push(`${expectedPath} 的 package 声明与清单 main 的包名 ${pkg} 不符`);
        }
        if (!new RegExp(`\\bclass\\s+${cls}\\b`).test(java)) {
          errors.push(`${expectedPath} 未定义类 ${cls}（与清单 main 的类名不符）`);
        }
      }
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}
