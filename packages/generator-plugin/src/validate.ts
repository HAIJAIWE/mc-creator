/**
 * 插件工程结构校验（纯函数，无 IO）。
 * 供 validate_content / 生成后自检调用；错误文案为中文，直接面向用户与智能体回灌。
 */
import type { FileNode } from '@mc-creator/shared';
import { LEGACY_MANIFEST_PATH, PAPER_MANIFEST_PATH } from './plugin-generator.js';

export interface PluginStructureValidation {
  ok: boolean;
  errors: string[];
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
  const byPath = new Map<string, string>();
  for (const f of files) byPath.set(f.path, f.content);

  // 1. 双清单并存（§7.3：paper-plugin.yml 不是 plugin.yml 的替代）。
  const paper = byPath.get(PAPER_MANIFEST_PATH);
  const legacy = byPath.get(LEGACY_MANIFEST_PATH);
  if (paper === undefined) {
    errors.push(`缺少 ${PAPER_MANIFEST_PATH}（§7.3 要求 paper-plugin.yml 与 plugin.yml 共存于同一 JAR）`);
  }
  if (legacy === undefined) {
    errors.push(`缺少 ${LEGACY_MANIFEST_PATH}（§7.3 要求 paper-plugin.yml 与 plugin.yml 共存于同一 JAR）`);
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
      errors.push(`${label} 的 api-version "${api}" 格式非法，应为 <主>.<次>[.<修订>]（如 1.21 / 26.1.2）`);
    } else {
      apiVersions.set(label, api);
    }
  }
  const distinctApis = new Set(apiVersions.values());
  if (distinctApis.size > 1) {
    errors.push(`两份清单的 api-version 不一致：${[...apiVersions].map(([k, v]) => `${k}=${v}`).join('，')}`);
  }

  // 3. Folia 硬开关（§7.3）：folia 目标必须声明 folia-supported: true。
  // 目标来源：清单首行 `# target:` 生成器标记；无标记时，若源码含 Folia
  // 运行时检测（RegionizedServer）则视为意图上 Folia，同样要求声明。
  if (paper !== undefined) {
    const marker = readTargetMarker(paper);
    const wantsFolia =
      marker === 'folia' ||
      (marker === null && [...byPath.values()].some((c) => c.includes('RegionizedServer')));
    const declared = (getScalar(paper, 'folia-supported') ?? '').toLowerCase();
    if (wantsFolia && declared !== 'true') {
      errors.push(
        'paper-plugin.yml 未声明 folia-supported: true，但工程目标为 Folia（§7.3 硬开关：不声明则无法在 Folia 上运行）',
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

  return { ok: errors.length === 0, errors };
}
