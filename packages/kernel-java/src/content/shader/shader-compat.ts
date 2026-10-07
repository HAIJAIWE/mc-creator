/**
 * 光影包与加载器组合校验（设计文档 §5.6 光影）。
 *
 * §5.6 原文：
 * > - Iris / OptiFine shaderpack；**Iris + Sodium 组合**
 * > - 与资源包 PBR 贴图协同
 *
 * ## 本仓此前的缺口
 *
 * `kernel-java` 只把 `shader` 类型的文件落到 `instances/<id>/shaderpacks/`
 * ——**只有落位，没有任何格式或组合校验**。于是「装了光影包但没装加载器」
 * 这种最常见的坏 setups 会被静默放过：游戏照常跑，只是光影完全不生效，
 * 用户看不出是缺加载器。
 *
 * ## 判据出处（实抓，非凭记忆）
 *
 * Iris 官方文档 "An Introduction to Shaders" 前置条件段：
 * <https://shaders.properties/current/guides/your-first-shaderpack/0_intro/>
 *
 * > A general understanding of computer graphics is useful but not necessary.
 * > An instance of Minecraft with **Iris, Optifine, or Oculus installed.**
 *
 * 同页 OpenGL/GLSL 段：
 * > Old versions of Minecraft used … OpenGL 2.0. Most older shader packs, for this
 * > reason, were written using **GLSL version 120**. In version 1.17, Minecraft was
 * > updated to use OpenGL 3.2, which targets version 150. However, shader loader mods
 * > like Iris and Optifine **allow the use of any version** of OpenGL/GLSL the user's
 * > hardware supports. … OpenGL 3.3 uses GLSL version 330.
 *
 * Iris 文档 Programs 侧栏（逐条对照）：
 * > setup / **begin** / shadow / **shadowcomp** / prepare / gbuffers / deferred /
 * > composite / final —— 其中 `begin` 与 `shadowcomp` 标注为 **Iris Only**。
 *
 * 另：`RENDERTARGETS` / `DRAWBUFFERS` 标注 **Legacy**。
 *
 * ## 三条硬判据（都可机器判）
 *
 * 1. **有光影包必须有加载器**（Iris / OptiFine / Oculus 之一），否则光影不生效。
 * 2. 用了 **Iris-only 程序**（`begin` / `shadowcomp`）时，加载器不能只是 OptiFine。
 * 3. 光影包的 GLSL 版本须与其目标 MC 版本对得上（1.17+ 走 150 / 330，
 *    更早的包用 120）。
 */

/** 能加载光影包的加载器 mod（Iris 官方前置条件列出的三者）。 */
export const SHADER_LOADERS = ['iris', 'optifine', 'oculus'] as const;
export type ShaderLoader = (typeof SHADER_LOADERS)[number];

/** Iris 独有的着色器程序（Iris 文档 Programs 侧栏标为 "Iris Only"）。 */
export const IRIS_ONLY_PROGRAMS = ['begin', 'shadowcomp'] as const;

/** Legacy 程序（Iris 文档标为 "Legacy"）。 */
export const LEGACY_PROGRAMS = ['RENDERTARGETS', 'DRAWBUFFERS'] as const;

/** 光影包里的着色器程序全集（Iris 文档 Programs 侧栏）。 */
export const SHADER_PROGRAMS = [
  'setup',
  'begin',
  'shadow',
  'shadowcomp',
  'prepare',
  'gbuffers',
  'deferred',
  'composite',
  'final',
] as const;

/** GLSL 版本（Iris 文档 OpenGL/GLSL 段）。 */
export const GLSL_VERSIONS = {
  /** OpenGL 2.0 —— 旧版光影包。 */
  legacy: 120,
  /** OpenGL 3.2 —— MC 1.17 起。 */
  mc117: 150,
  /** OpenGL 3.3 —— Iris/OptiFine 允许用户在支持的硬件上使用。 */
  modern: 330,
} as const;

/** 一个光影包的信息。 */
export interface ShaderPack {
  /** 光影包名（用于报错定位）。 */
  name: string;
  /** 是否使用 Iris-only 程序（`begin` / `shadowcomp`）。 */
  usesIrisOnlyPrograms?: boolean;
  /** 声明的 GLSL 版本（见 GLSL_VERSIONS）。 */
  glslVersion?: number;
  /** 目标 MC 版本，形如 '1.21.1'；用于校验 GLSL 版本是否对得上。 */
  targetMcVersion?: string;
}

/** 已装 mod 的标识（大小写不敏感比较）。 */
export interface InstalledMod {
  id: string;
}

export type ShaderSetupCode =
  | 'NO_LOADER'
  | 'IRIS_ONLY_PROGRAM_WITHOUT_IRIS'
  | 'GLSL_TOO_NEW'
  | 'GLSL_TOO_OLD'
  | 'IRIS_SODIUM_COMBINATION'
  | 'OK';

export interface ShaderSetupIssue {
  level: 'error' | 'warning' | 'info';
  code: ShaderSetupCode;
  message: string;
  /** 相关光影包 / mod 名。 */
  subject?: string;
}

/** MC 版本 → 该版本起使用的 GLSL 版本（150）。低于 1.17 的是 120。 */
export function glslVersionForMcVersion(mcVersion: string): number | undefined {
  const m = /^(\d+)\.(\d+)/.exec(mcVersion);
  if (m === null) return undefined;
  const major = Number(m[1]);
  const minor = Number(m[2]);
  if (!Number.isFinite(major) || !Number.isFinite(minor)) return undefined;
  if (major > 1) return GLSL_VERSIONS.mc117;
  if (major === 1 && minor >= 17) return GLSL_VERSIONS.mc117;
  return GLSL_VERSIONS.legacy;
}

/**
 * 判断已装 mod 里有哪些光影加载器。
 *
 * 按 mod id 匹配（大小写不敏感）。Oculus 与 Iris 都是 mod id 直接叫这个；
 * OptiFine 的 mod id 通常是 `optifine`。**刻意不做 jar 文件名猜测** ——
 * 文件名可被用户随意改，按文件名判会给出错误的「已装加载器」结论。
 */
export function detectShaderLoaders(mods: readonly InstalledMod[]): ShaderLoader[] {
  const ids = new Set(mods.map((m) => m.id.toLowerCase()));
  return SHADER_LOADERS.filter((l) => ids.has(l));
}

/**
 * 加载器是否支持 Iris-only 程序。
 *
 * Iris 与 Oculus 都支持：`begin` / `shadowcomp` 这两个程序是 Iris 的加载层提供的，
 * Oculus 是 Sodium 与 Iris 合并的分支，继承同一套着色器加载实现。
 * **OptiFine 不支持** —— 它有自己的着色器实现，不执行 Iris 专有程序。
 */
export function supportsIrisOnlyPrograms(loader: ShaderLoader): boolean {
  return loader === 'iris' || loader === 'oculus';
}

/** 判断是否装了 Sodium（§5.6 的「Iris + Sodium 组合」）。 */
export function hasSodium(mods: readonly InstalledMod[]): boolean {
  return mods.some((m) => m.id.toLowerCase() === 'sodium');
}

/**
 * 校验「光影包 + 已装 mod」组合（§5.6）。
 *
 * 三条判据见文件头；每条都给了可执行的修复提示，不只说「不兼容」。
 */
export function checkShaderSetup(
  shaderPacks: readonly ShaderPack[],
  mods: readonly InstalledMod[],
): ShaderSetupIssue[] {
  const issues: ShaderSetupIssue[] = [];
  const loaders = detectShaderLoaders(mods);

  // 判据 1：有光影包必须有加载器。
  if (shaderPacks.length > 0 && loaders.length === 0) {
    issues.push({
      level: 'error',
      code: 'NO_LOADER',
      subject: shaderPacks.map((p) => p.name).join(', '),
      message:
        `已放入光影包（${shaderPacks.map((p) => p.name).join('、')}）但实例里没有任何光影加载器，` +
        '光影不会生效且没有任何报错。Iris 官方前置条件要求安装 Iris、OptiFine 或 Oculus 之一。' +
        '修复：安装 iris 或 optifine 后重启客户端。',
    });
  }

  for (const pack of shaderPacks) {
    // 判据 2：Iris-only 程序需要 Iris 系加载器。
    if (
      pack.usesIrisOnlyPrograms === true &&
      loaders.length > 0 &&
      !loaders.some(supportsIrisOnlyPrograms)
    ) {
      issues.push({
        level: 'error',
        code: 'IRIS_ONLY_PROGRAM_WITHOUT_IRIS',
        subject: pack.name,
        message:
          `光影包「${pack.name}」使用了 Iris 专有程序（${IRIS_ONLY_PROGRAMS.join(' / ')}），` +
          `但当前加载器是 ${loaders.join(' / ')}。这些程序在非 Iris 加载器下不会被执行，` +
          '结果是编译失败或画面异常。修复：改用 Iris 加载，或换一份不含 Iris-only 程序的光影包。',
      });
    }

    // 判据 3：GLSL 版本与目标 MC 版本对得上。
    if (pack.glslVersion !== undefined && pack.targetMcVersion !== undefined) {
      const want = glslVersionForMcVersion(pack.targetMcVersion);
      if (want !== undefined) {
        if (pack.glslVersion > want) {
          issues.push({
            level: 'error',
            code: 'GLSL_TOO_NEW',
            subject: pack.name,
            message:
              `光影包「${pack.name}」声明 GLSL ${pack.glslVersion}，高于目标 MC ${pack.targetMcVersion} ` +
              `所需的 ${want}（该版本起 MC 用 OpenGL 3.2）。着色器会编译失败。`,
          });
        } else if (pack.glslVersion < want) {
          issues.push({
            level: 'warning',
            code: 'GLSL_TOO_OLD',
            subject: pack.name,
            message:
              `光影包「${pack.name}」声明 GLSL ${pack.glslVersion}（旧版 OpenGL 2.0 写法），` +
              `低于目标 MC ${pack.targetMcVersion} 的 ${want}。加载器通常仍能跑，但会失去部分特性。`,
          });
        }
      }
    }
  }

  // §5.6 点名的「Iris + Sodium 组合」：给一条确认性提示，不报错。
  if (loaders.includes('iris') && hasSodium(mods) && shaderPacks.length > 0) {
    issues.push({
      level: 'info',
      code: 'IRIS_SODIUM_COMBINATION',
      message: `Iris + Sodium 组合已就绪（§5.6 点名的组合），当前 ${shaderPacks.length} 个光影包可正常启用。`,
    });
  }

  return issues;
}

/** 是否有阻断级问题（光影实际不会生效）。 */
export function hasBlockingShaderIssue(issues: readonly ShaderSetupIssue[]): boolean {
  return issues.some((i) => i.level === 'error');
}

/** 组合问题 → 中文一行摘要。 */
export function summarizeShaderSetup(issues: readonly ShaderSetupIssue[]): string {
  if (issues.length === 0) return '光影组合无问题';
  return issues.map((i) => `[${i.code}] ${i.message}`).join('；');
}

/** 供 UI / agent 用的加载器中文名。 */
export const SHADER_LOADER_LABELS: Record<ShaderLoader, string> = {
  iris: 'Iris',
  optifine: 'OptiFine',
  oculus: 'Oculus',
};
