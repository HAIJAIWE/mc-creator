/**
 * 基岩导入网关（设计文档 §6.2）。
 *
 * ## 这一层只做「识别 + 校验」，不做落盘
 *
 * §6.2 的导入前校验有三条，本模块逐条对应：
 * 1. `manifest.json` 完整性
 * 2. **uuid 唯一性**（既含包内 header/modules 互不冲突，也含与已装内容不冲突）
 * 3. `min_engine_version` 兼容性
 *
 * 落位由 kernel-bedrock 的 install/import 任务做，本模块保持纯函数、无 I/O、无 fs。
 *
 * ## 键名出处（实抓，非凭记忆）
 *
 * 官方参考：<https://learn.microsoft.com/en-us/minecraft/creator/reference/content/addonsreference/packmanifest>
 * （"Add-Ons Reference: manifest.json"，ms.date 2025-08-04，updated_at 2026-04-21）
 *
 * 关键事实，逐条对照原文：
 * - `format_version`：**1 用于 skin packs；2 用于 resource / behavior / world template**；
 *   3 是 preview 引入的新版本。
 * - `header.min_engine_version` 是 **resource 和 behavior pack 的必填字段**
 *   （原文 "This is a required field for resource and behavior packs"）。
 * - `header.uuid` 格式为 `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`，每 x 是十六进制。
 * - `header.version` 决定覆盖语义（原文）：**"The new pack will replace the old one if
 *   the version is higher, and ignored if it's the same or lower."**
 * - `modules[].type` 取值：`resources` / `data` / `world_template` / `script`
 *   （原文枚举；另有示例里的 `client_data`，见下方 CLIENT_DATA 说明）。
 * - `modules[].language` 只在 `type: "script"` 时出现，原文明确
 *   **"The only supported value is `javascript`."**
 * - `dependencies[]` 两类：`uuid`（依赖另一个包）或 `module_name`（内建脚本模块，
 *   原文例子为 `@minecraft/server`）。
 * - `capabilities` 取值：`chemistry` / `editorExtension` / `experimental_custom_ui` /
 *   `raytraced` / `pbr`。
 *
 * `client_data`：官方模块类型枚举表里没列它，但官方 Behavior Pack **示例 JSON 里用了
 * `client_data`**。本模块两者都接受，但在此标注该枚举表未收录它，避免读者误以为是笔误。
 *
 * ## §6.3 Script API 的依赖表述
 *
 * §6.3 把 `@minecraft/server` / `server-ui` / `server-admin` / `server-net` 列为 AI 生成
 * 主战场。**但「实验性 API 需在 manifest 声明」这条本模块不实现**：官方参考里
 * 稳定通道的依赖就是 `dependencies[].module_name = "@minecraft/server" + version`，
 * 而 beta 模块（如 server-gestures 等）走 `@minecraft/server-<version>-beta` 形式的
 * module_name。具体哪些模块在哪个版本转入 beta 随游戏版本变动，属游戏版本事实，
 * **不在本仓静态判定**，故不加这条校验（加了就是猜）。见 MEMORY「不猜着写代码」。
 */
/** §6.2 支持的导入格式。 */
export const IMPORT_FORMATS = ['.mcpack', '.mcaddon', '.mcworld', '.mctemplate'] as const;
export type ImportFormat = (typeof IMPORT_FORMATS)[number];

/** 按扩展名判格式；不认的返回 undefined。 */
export function importFormatOf(path: string): ImportFormat | undefined {
  const lower = path.toLowerCase();
  return IMPORT_FORMATS.find((ext) => lower.endsWith(ext));
}

/** 包类型：由 modules[].type 归纳，供「装到哪」用。 */
export type PackKind = 'behavior' | 'resource' | 'world_template' | 'skinpack' | 'mixed';

export interface ParsedModule {
  type: string;
  uuid: string;
  version: [number, number, number];
  description?: string;
  language?: string;
}

export interface ParsedDependency {
  /** 与另一个包（uuid）依赖，或与内建脚本模块（module_name）依赖。 */
  uuid?: string;
  moduleName?: string;
  version?: [number, number, number];
  versionRaw?: string;
}

export interface ParsedManifest {
  formatVersion: number;
  name: string;
  description: string;
  uuid: string;
  version: [number, number, number];
  /** 无 min_engine_version 的包（skin pack / world template 允许）保留 undefined。 */
  minEngineVersion?: [number, number, number];
  packScope?: string;
  modules: ParsedModule[];
  dependencies: ParsedDependency[];
  capabilities: string[];
  /** 已装内容索引（uuid → 版本），用于唯一性/覆盖判定；未提供则跳过该校验。 */
}

export interface ManifestError {
  path: string;
  message: string;
}

/** 官方 uuid 形状：`xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`，x 为十六进制。 */
const UUID_CANONICAL =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/**
 * uuid 判定。
 *
 * 官方参考只认带连字符的规范形状。本仓上一版 kernel-bedrock 用的是
 * `^[0-9a-fA-F-]{32,36}$`（"32/36 位十六进制或带连字符"）—— 那会放过
 * `----------------` 这种零连字符串，是宽松且错的判定，故这里收严到官方形状。
 * 大写十六进制官方允许（原文 "each x is a hexadecimal value (0-9 or a-f)"，
 * 实践中 Windows 工具链产出大写），故接受大小写。
 */
export function isCanonicalUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_CANONICAL.test(value);
}

/** 归一为小写用于比较（Minecraft 比较 uuid 时不区分大小写）。 */
export function normalizeUuid(uuid: string): string {
  return uuid.toLowerCase();
}

function tripleOf(value: unknown): [number, number, number] | undefined {
  if (Array.isArray(value) && value.length === 3) {
    const nums = value.map((n) => (typeof n === 'number' ? n : Number.NaN));
    if (nums.every((n) => Number.isInteger(n) && n >= 0)) {
      return [nums[0] as number, nums[1] as number, nums[2] as number];
    }
  }
  // format_version 3 起官方允许 semver 字符串（如 "1.20.0"）。
  if (typeof value === 'string' && /^\d+(\.\d+){0,2}$/.test(value.trim())) {
    const parts = value
      .trim()
      .split('.')
      .map((n) => Number.parseInt(n, 10));
    return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0];
  }
  return undefined;
}

function tripleToString(t: [number, number, number]): string {
  return t.join('.');
}

function compareTriple(a: [number, number, number], b: [number, number, number]): number {
  for (let i = 0; i < 3; i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/** 官方 `modules[].type` 枚举 + 官方示例里出现的 client_data。 */
const MODULE_TYPES = new Set(['resources', 'data', 'world_template', 'script', 'client_data']);

/** 官方 `capabilities` 枚举。 */
const CAPABILITIES = new Set([
  'chemistry',
  'editorExtension',
  'experimental_custom_ui',
  'raytraced',
  'pbr',
]);

/**
 * 解析并校验 manifest.json。
 *
 * 返回 `{ ok: true, manifest }` 或 `{ ok: false, errors }`。**不做部分接受** ——
 * manifest 有错就是有错，逐条列出全部问题（不是只报第一个）。
 */
export function parseManifest(
  text: string,
  opts: {
    requireMinEngineVersion?: boolean;
    installed?: ReadonlyMap<string, [number, number, number]>;
  } = {},
): { ok: true; manifest: ParsedManifest } | { ok: false; errors: ManifestError[] } {
  const errors: ManifestError[] = [];
  const err = (path: string, message: string): void => {
    errors.push({ path, message });
  };

  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { ok: false, errors: [{ path: 'manifest.json', message: `JSON 解析失败: ${message}` }] };
  }
  if (typeof doc !== 'object' || doc === null || Array.isArray(doc)) {
    return {
      ok: false,
      errors: [{ path: 'manifest.json', message: '顶层不是 JSON 对象（manifest.json 须为对象）' }],
    };
  }
  const root = doc as Record<string, unknown>;

  // --- format_version ---
  const formatVersion = root['format_version'];
  if (typeof formatVersion !== 'number' || !Number.isInteger(formatVersion) || formatVersion < 1) {
    err('format_version', `format_version 缺失或非法: ${JSON.stringify(formatVersion)}`);
  } else if (formatVersion > 3) {
    err(
      'format_version',
      `format_version=${formatVersion} 超出已知范围（官方：1 skin pack / 2 resource·behavior·world template / 3 preview）`,
    );
  }

  // --- header ---
  const headerRaw = root['header'];
  if (typeof headerRaw !== 'object' || headerRaw === null || Array.isArray(headerRaw)) {
    err('header', 'header 缺失或不是对象');
    return { ok: false, errors };
  }
  const header = headerRaw as Record<string, unknown>;

  const name = header['name'];
  if (typeof name !== 'string' || name.trim() === '') {
    err('header.name', 'header.name 缺失或为空（官方：必填字段）');
  }
  const description = header['description'];
  if (typeof description !== 'string' || description.trim() === '') {
    err('header.description', 'header.description 缺失或为空');
  }

  const uuid = header['uuid'];
  if (!isCanonicalUuid(uuid)) {
    err(
      'header.uuid',
      `header.uuid 非法: ${JSON.stringify(uuid)}（官方形状 xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx，x 为十六进制）`,
    );
  }

  const version = tripleOf(header['version']);
  if (version === undefined) {
    err('header.version', `header.version 缺失或非法: ${JSON.stringify(header['version'])}`);
  }

  // min_engine_version：官方规定 resource/behavior 必填，skin pack / world template 可省。
  const minEngineVersion = tripleOf(header['min_engine_version']);
  if (minEngineVersion === undefined && opts.requireMinEngineVersion === true) {
    err(
      'header.min_engine_version',
      'header.min_engine_version 缺失（官方：resource 与 behavior pack 的必填字段）',
    );
  }

  const packScopeRaw = header['pack_scope'];
  if (packScopeRaw !== undefined && !['world', 'global', 'any'].includes(String(packScopeRaw))) {
    err(
      'header.pack_scope',
      `header.pack_scope 非法: ${JSON.stringify(packScopeRaw)}（合法值 world / global / any）`,
    );
  }

  // --- modules ---
  const modulesRaw = root['modules'];
  const modules: ParsedModule[] = [];
  if (!Array.isArray(modulesRaw) || modulesRaw.length === 0) {
    err('modules', 'modules 缺失或为空数组');
  } else {
    const seenModuleUuids = new Map<string, number>();
    modulesRaw.forEach((m, i) => {
      if (typeof m !== 'object' || m === null || Array.isArray(m)) {
        err(`modules[${i}]`, '模块不是对象');
        return;
      }
      const mod = m as Record<string, unknown>;
      const type = mod['type'];
      if (typeof type !== 'string' || !MODULE_TYPES.has(type)) {
        err(
          `modules[${i}].type`,
          `modules[${i}].type 非法: ${JSON.stringify(type)}（官方取值 resources / data / world_template / script）`,
        );
      }
      const modUuid = mod['uuid'];
      if (!isCanonicalUuid(modUuid)) {
        err(`modules[${i}].uuid`, `modules[${i}].uuid 非法: ${JSON.stringify(modUuid)}`);
      } else {
        const norm = normalizeUuid(modUuid);
        const prev = seenModuleUuids.get(norm);
        if (prev !== undefined) {
          err(
            `modules[${i}].uuid`,
            `模块 uuid 与 modules[${prev}] 重复: ${modUuid}（官方：每个模块 uuid 必须互不相同）`,
          );
        } else {
          seenModuleUuids.set(norm, i);
        }
        if (isCanonicalUuid(uuid) && norm === normalizeUuid(uuid)) {
          err(
            `modules[${i}].uuid`,
            `模块 uuid 不得与 header.uuid 相同: ${modUuid}（官方：should be different from the pack's UUID）`,
          );
        }
      }
      const modVersion = tripleOf(mod['version']);
      if (modVersion === undefined) {
        err(
          `modules[${i}].version`,
          `modules[${i}].version 缺失或非法: ${JSON.stringify(mod['version'])}`,
        );
      }
      const language = mod['language'];
      if (language !== undefined) {
        if (type !== 'script') {
          err(
            `modules[${i}].language`,
            `language 只在 type="script" 时允许出现（当前 type=${JSON.stringify(type)}）`,
          );
        } else if (language !== 'javascript') {
          // 官方原文：The only supported value is `javascript`.
          err(
            `modules[${i}].language`,
            `language 非法: ${JSON.stringify(language)}（官方：唯一支持值是 javascript）`,
          );
        }
      }
      modules.push({
        type: String(type ?? ''),
        uuid: typeof modUuid === 'string' ? modUuid : '',
        version: modVersion ?? [0, 0, 0],
        ...(typeof mod['description'] === 'string' ? { description: mod['description'] } : {}),
        ...(typeof language === 'string' ? { language } : {}),
      });
    });
  }

  // --- dependencies ---
  const dependencies: ParsedDependency[] = [];
  const depsRaw = root['dependencies'];
  if (depsRaw !== undefined) {
    if (!Array.isArray(depsRaw)) {
      err('dependencies', 'dependencies 不是数组');
    } else {
      depsRaw.forEach((d, i) => {
        if (typeof d !== 'object' || d === null || Array.isArray(d)) {
          err(`dependencies[${i}]`, '依赖项不是对象');
          return;
        }
        const dep = d as Record<string, unknown>;
        const depUuid = dep['uuid'];
        const moduleName = dep['module_name'];
        if (depUuid === undefined && moduleName === undefined) {
          err(
            `dependencies[${i}]`,
            `dependencies[${i}] 须有 uuid（依赖另一个包）或 module_name（依赖内建脚本模块）`,
          );
          return;
        }
        if (depUuid !== undefined && !isCanonicalUuid(depUuid)) {
          err(
            `dependencies[${i}].uuid`,
            `dependencies[${i}].uuid 非法: ${JSON.stringify(depUuid)}`,
          );
        }
        if (moduleName !== undefined && typeof moduleName !== 'string') {
          err(`dependencies[${i}].module_name`, 'module_name 不是字符串');
        }
        const depVersion = tripleOf(dep['version']);
        dependencies.push({
          ...(typeof depUuid === 'string' ? { uuid: depUuid } : {}),
          ...(typeof moduleName === 'string' ? { moduleName } : {}),
          ...(depVersion === undefined ? {} : { version: depVersion }),
          ...(typeof dep['version'] === 'string' ? { versionRaw: dep['version'] } : {}),
        });
      });
    }
  }

  // --- capabilities ---
  const capabilitiesRaw = root['capabilities'];
  const capabilities: string[] = [];
  if (capabilitiesRaw !== undefined) {
    if (!Array.isArray(capabilitiesRaw)) {
      err('capabilities', 'capabilities 不是数组');
    } else {
      capabilitiesRaw.forEach((c, i) => {
        if (typeof c !== 'string' || !CAPABILITIES.has(c)) {
          err(
            `capabilities[${i}]`,
            `capabilities[${i}] 非法: ${JSON.stringify(c)}（官方取值 chemistry / editorExtension / experimental_custom_ui / raytraced / pbr）`,
          );
        } else {
          capabilities.push(c);
        }
      });
    }
  }

  // --- uuid 唯一性（对已装内容，§6.2）+ 覆盖语义 ---
  if (errors.length > 0) return { ok: false, errors };

  const installed = opts.installed;
  if (installed !== undefined && isCanonicalUuid(uuid) && version !== undefined) {
    const existing = installed.get(normalizeUuid(uuid));
    if (existing !== undefined && compareTriple(version, existing) <= 0) {
      // 官方原文：higher 才替换；same 或 lower 会被忽略。
      err(
        'header.version',
        `已装同 uuid 的包版本 ${tripleToString(existing)} ≥ 本包 ${tripleToString(version)}，` +
          '官方语义：新包版本更高才替换，同级或更低会被忽略（§6.2）',
      );
      return { ok: false, errors };
    }
  }

  const manifest: ParsedManifest = {
    formatVersion: typeof formatVersion === 'number' ? formatVersion : 0,
    name: typeof name === 'string' ? name : '',
    description: typeof description === 'string' ? description : '',
    uuid: typeof uuid === 'string' ? uuid : '',
    version: version ?? [0, 0, 0],
    ...(minEngineVersion === undefined ? {} : { minEngineVersion }),
    ...(typeof packScopeRaw === 'string' ? { packScope: packScopeRaw } : {}),
    modules,
    dependencies,
    capabilities,
  };
  return { ok: true, manifest };
}

/** 由 modules[].type 归纳包类型。 */
export function packKindOf(manifest: ParsedManifest): PackKind {
  // format_version 1 是官方规定的 skin pack 标记。
  if (manifest.formatVersion === 1) return 'skinpack';
  const types = new Set(manifest.modules.map((m) => m.type));
  const isBehavior = types.has('data') || types.has('script') || types.has('client_data');
  const isResource = types.has('resources');
  if (isBehavior && isResource) return 'mixed';
  if (isBehavior) return 'behavior';
  if (isResource) return 'resource';
  if (types.has('world_template')) return 'world_template';
  return 'mixed';
}

/** .mcaddon 必须是行为+资源成对（§6.3「成对」）。 */
export function isAddonPair(manifest: ParsedManifest): boolean {
  return packKindOf(manifest) === 'mixed';
}

export interface CompatibilityResult {
  compatible: boolean;
  /** 不兼容原因（compatible=false 时有值）。 */
  reason?: string;
}

/**
 * `min_engine_version` 兼容性（§6.2）。
 *
 * 官方语义（原文）："This is the minimum version of the game that this pack was
 * written for … This helps the game identify whether any backwards compatibility
 * is needed" —— 即「包要求游戏**至少**这么新」。
 * 所以判据是：`min_engine_version <= 目标版本` 才兼容。
 *
 * 无 min_engine_version 的包（skin pack / world template 允许省略）判为兼容。
 */
export function checkEngineCompatibility(
  manifest: ParsedManifest,
  target: [number, number, number],
): CompatibilityResult {
  const min = manifest.minEngineVersion;
  if (min === undefined) return { compatible: true };
  if (compareTriple(target, min) < 0) {
    return {
      compatible: false,
      reason:
        `包要求引擎 ≥ ${tripleToString(min)}，当前目标 ${tripleToString(target)}，` +
        '低于 min_engine_version 不兼容（§6.2）',
    };
  }
  return { compatible: true };
}

/**
 * 顶层一致性检查：把 §6.2 三条校验串起来。
 *
 * `installed` 提供时额外做 uuid 唯一性/覆盖判定。返回全部问题，不部分接受。
 */
export function inspectPackage(options: {
  manifestText: string;
  /** 目标游戏版本，用于 min_engine_version 判定；不给则跳过该项。 */
  targetVersion?: [number, number, number];
  /** 已装包 uuid → 版本。 */
  installed?: ReadonlyMap<string, [number, number, number]>;
  /** 是否强制要求 min_engine_version（behavior/resource 为 true）。 */
  requireMinEngineVersion?: boolean;
}): { ok: true; manifest: ParsedManifest; kind: PackKind } | { ok: false; errors: string[] } {
  const parsed = parseManifest(options.manifestText, {
    ...(options.requireMinEngineVersion === undefined
      ? {}
      : { requireMinEngineVersion: options.requireMinEngineVersion }),
    ...(options.installed === undefined ? {} : { installed: options.installed }),
  });
  if (!parsed.ok) {
    return { ok: false, errors: parsed.errors.map((e) => `${e.path}: ${e.message}`) };
  }
  const kind = packKindOf(parsed.manifest);
  const requireMin =
    options.requireMinEngineVersion ??
    (kind === 'behavior' || kind === 'resource' || kind === 'mixed');
  // requireMinEngineVersion 参与解析校验，重跑一次以确保它真的生效。
  if (requireMin && parsed.manifest.minEngineVersion === undefined) {
    return {
      ok: false,
      errors: ['header.min_engine_version: 缺失（官方：resource 与 behavior pack 的必填字段）'],
    };
  }
  if (options.targetVersion !== undefined) {
    const compat = checkEngineCompatibility(parsed.manifest, options.targetVersion);
    if (!compat.compatible) {
      return { ok: false, errors: [compat.reason ?? 'min_engine_version 不兼容'] };
    }
  }
  return { ok: true, manifest: parsed.manifest, kind };
}
