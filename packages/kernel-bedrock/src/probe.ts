/**
 * Bedrock 内容目录探测（§6.1 环境探测）。
 *
 * 本模块**只做探测与降级判定，不做任何导入动作**（不写 com.mojang、不调深链协议、
 * 不触碰 Program Files\WindowsApps\）。后续接线由上层负责。
 *
 * ---------------------------------------------------------------------------
 * 文档依据：设计文档 §6.1「环境探测（关键约束）」逐条对照
 * ---------------------------------------------------------------------------
 * §6.1 原文四条的硬性要求 → 本文件的落实位置：
 *
 * 1) 「内容目录：`%localappdata%\Packages\Microsoft.MinecraftUWP_8wekyb3d8bbwe\
 *     LocalState\games\com.mojang`」
 *    → 仅作为**候选之一**（UWP 旧版），绝不作为唯一路径。见 `DEFAULT_UWP_PACKAGE_NAMES`。
 *
 * 2) 「游戏安装目录在 `Program Files\WindowsApps\` 下，属 **UWP 受保护目录**，
 *     即使用管理员账户也可能无权访问 → **不得依赖直接读写**」
 *    → 本模块只读、且只 stat/列目录目录，不探测写权限、不写任何文件。
 *      读不到时**不抛异常、不谎报「未安装」**，而是走降级路径。
 *
 * 3) 「目录名存在变更（新版 GDK 由 `Microsoft.MinecraftUWP` 改为 `Minecraft for Windows`），
 *     **必须做名称探测 + 多路径回退，不可硬编码**」
 *    → 包名/内容根名全部集中在下方**单一常量数组**（`DEFAULT_UWP_PACKAGE_NAMES` /
 *      `DEFAULT_GDK_APPDATA_ROOTS`），且都可通过 `ProbeOptions` 覆盖或追加。
 *      **新增 GDK 包名只需加一行**，不允许散落成多处硬编码。
 *      ⚠ 文档写的 `Minecraft for Windows` **未获权威来源证实**（见该常量上方注释），
 *      故默认不启用，走 `extraCandidates` 注入。
 *
 * 4) 「权限不足时**降级为「生成合法包 + 引导用户双击导入」**」
 *    → 结果结构显式给出 `degraded` + `reason` + `userHint`（中文可执行指引），
 *      调用方**不需要自己猜布尔值的含义**。
 *
 * ---------------------------------------------------------------------------
 * 关键实现约束（主代理拍板）
 * ---------------------------------------------------------------------------
 * A. 权限探测与存在探测**必须分开**：
 *    `existsSync` 内部吞掉所有错误（只返回 false），无法区分
 *    「目录不存在(ENOENT)」与「目录存在但读不了(EACCES/EPERM)」—— 这两者是
 *    **完全不同的结论**：前者是「未安装」，后者必须降级引导导入（§6.1 第 4 条）。
 *    因此本模块一律用 `fs.statSync` 包 try/catch 并读 `e.code` 拿 errno，
 *    再对**通过 stat 的目录**做一次 `readdirSync` 复核可列目录性
 *    （stat 只证明有元数据，不证明能读内容）。**这是本模块最容易做错的地方。**
 *
 * B. 首个「存在」的候选即判定结果，**不做「存在即可读」的乐观回退**：
 *    否则一个恰好可读的路径会把「存在但受保护」这个信号悄悄掩盖掉，
 *    降级路径就永远不会触发 —— 直接违反 §6.1 第 4 条。
 *
 * C. 降级结论可执行：
 *    不变式 `degraded === (reason !== 'found')` 且 `degraded === (userHint !== null)`，
 *    userHint 一律指向「生成合法包 + 引导用户双击导入」这条路径。
 *
 * D. **绝不尝试写入受保护目录 / 不做写入探测**：
 *    UWP 受保护目录下的写权限探测本身要真实创建并删除文件，
 *    既可能触发杀软/EDR 的行为告警，又会在只读挂载/沙箱里产生无意义的失败；
 *    且写入探测成功也不能证明游戏进程会接受写入。§6.1 要求「不得依赖直接读写」，
 *    正确做法是**永远不写**，由用户双击导入。
 *
 * E. 探测不到任何路径时**不抛异常**：返回 `found: false` + 已试过的候选与逐条 errno
 *    （`tried`），便于排障。
 *
 * ---------------------------------------------------------------------------
 * 来源核实记录（2026-10-06）
 * ---------------------------------------------------------------------------
 * - 旧 UWP 路径 `Microsoft.MinecraftUWP_8wekyb3d8bbwe` 已由微软官方 GDK 迁移文档
 *   （learn.microsoft.com/en-us/minecraft/creator/documents/gdkpcprojectfolder，
 *    ms.date 2025-10-24）明确列为「UWP Build (the old style)」的历史路径。
 * - 同一官方文档给出的**新版 GDK** 内容根是
 *   `%appdata%\Minecraft Bedrock\users\shared\games\com.mojang`
 *   （预览版为 `Minecraft Bedrock Preview\...`），
 *   **不是**任何 `Packages\<包名>\LocalState\...` 形式。→ `DEFAULT_GDK_APPDATA_ROOTS`。
 * - 教育版 UWP 包族名 `Microsoft.MinecraftEducationEdition_8wekyb3d8bbwe`
 *   由官方教育版支持页给出。→ `DEFAULT_UWP_PACKAGE_NAMES`。
 */

import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/* ========================================================================== */
/* 类型                                                                       */
/* ========================================================================== */

/** 候选来源，便于上层区分「用户显式指定」与「系统默认推断」。 */
export type CandidateSource = 'env-override' | 'uwp-localstate' | 'gdk-appdata' | 'extra';

/** 单个候选的探测结论。 */
export type CandidateStatus =
  /** 目录存在且可列目录（可安全读取）。 */
  | 'ok'
  /** ENOENT：不存在。 */
  | 'missing'
  /** ENOTDIR：路径中某段是文件，不是目录。 */
  | 'not-a-directory'
  /** EACCES / EPERM：**存在但读不了**（UWP 受保护目录的典型表现，§6.1 第 4 条）。 */
  | 'permission-denied'
  /** 目录存在但无法列目录，且 errno 非权限类。 */
  | 'unreadable'
  /** 其它未知 errno（非权限、非不存在）。 */
  | 'error';

/**
 * 总体探测结论（机器可读）。
 * - `found`：探测到**存在且可读**的内容目录。
 * - `degraded`：`reason !== 'found'`，即无法依赖直接读写，必须走
 *   「生成合法包 + 引导用户双击导入」（§6.1 第 4 条）。
 */
export type ProbeReason =
  'found' | 'permission-denied' | 'unreadable' | 'not-installed' | 'no-environment' | 'probe-error';

/** 探测用的最小 fs 抽象（**只读**；没有写入方法，因为本模块绝不写）。 */
export interface ProbeFsOps {
  /** 同步 stat；失败时必须抛出带 errno `code` 的异常（Node 语义）。 */
  statSync(path: string): ProbeStatLike;
  /** 同步列目录；失败时同样必须带 errno `code`。 */
  readdirSync(path: string): unknown;
}

/** stat 结果的最小结构（`node:fs.Stats` 天然满足）。 */
export interface ProbeStatLike {
  isDirectory(): boolean;
}

/** 探测选项。所有默认值都可覆盖 —— §6.1「不可硬编码」的落地点。 */
export interface ProbeOptions {
  /** 环境变量来源，默认 `process.env`（测试注入用）。 */
  env?: Record<string, string | undefined>;
  /** fs 实现，默认真实 `node:fs`（测试注入 mock，避免真碰 `C:\Users\...`）。 */
  fs?: ProbeFsOps;
  /** UWP 包族名候选；缺省用 `DEFAULT_UWP_PACKAGE_NAMES`。 */
  uwpPackageNames?: readonly string[];
  /** GDK（Roaming）内容根候选；缺省用 `DEFAULT_GDK_APPDATA_ROOTS`。 */
  gdkAppDataRoots?: readonly string[];
  /**
   * 任意额外候选**全路径**（按字面量使用，不做拼接）。
   * 用于承载拼写待核实的新版 GDK 包名路径等实验性候选。
   */
  extraCandidates?: readonly string[];
}

/** 单个候选的探测明细（含 errno，供排障）。 */
export interface CandidateOutcome {
  readonly path: string;
  readonly source: CandidateSource;
  readonly status: CandidateStatus;
  /** 捕获到的 errno（无异常时为 `null`）。 */
  readonly errno: string | null;
}

/** 探测总结果。 */
export interface ProbeResult {
  /** 探测到存在且可读的内容目录。 */
  readonly found: boolean;
  /** 目录存在且可列目录（仅在 `found` 为 true 时有意义，但独立暴露便于 UI 展示）。 */
  readonly readable: boolean;
  /** 命中的内容目录绝对路径；未命中为 `null`。 */
  readonly contentDir: string | null;
  /** 命中项的来源；未命中为 `null`。 */
  readonly source: CandidateSource | null;
  /** 是否必须降级为「生成合法包 + 引导用户双击导入」。不变式：`reason !== 'found'`。 */
  readonly degraded: boolean;
  /** 机器可读的降级原因。 */
  readonly reason: ProbeReason;
  /** 给用户看的中文指引；不变式：`degraded === (userHint !== null)`。 */
  readonly userHint: string | null;
  /** 本次构造出的全部候选绝对路径（已去重、保序），即使一个都没命中也会返回。 */
  readonly candidates: readonly string[];
  /** 逐候选的探测明细（含 errno），便于排障。 */
  readonly tried: readonly CandidateOutcome[];
}

/* ========================================================================== */
/* 集中常量：§6.1「不可硬编码」的落地点 —— 新增 GDK 包名只需加一行          */
/* ========================================================================== */

/** 环境变量覆盖键，**优先级从高到低**（沿用现状：COM_MOJANG_DIR → BEDROCK_COM_MOJANG_DIR）。 */
export const ENV_OVERRIDE_KEYS = ['COM_MOJANG_DIR', 'BEDROCK_COM_MOJANG_DIR'] as const;

/**
 * UWP（1.21.120 之前的旧版构建）包族名候选。
 *
 * ⚠ **新增 GDK / 新 UWP 包名只需在这里加一行** —— 不要在任何其他地方硬编码包名。
 *
 * 变体来源：
 * - `Microsoft.MinecraftUWP_8wekyb3d8bbwe`：官方 GDK 迁移文档列为旧 UWP 构建路径。
 * - `Microsoft.MinecraftEducationEdition_8wekyb3d8bbwe`：官方教育版支持页给出的包族名。
 *   （设计文档未提及，但同为 UWP 受保护目录，且与主包共用 com.mojang 结构。）
 */
export const DEFAULT_UWP_PACKAGE_NAMES: readonly string[] = [
  'Microsoft.MinecraftUWP_8wekyb3d8bbwe',
  'Microsoft.MinecraftEducationEdition_8wekyb3d8bbwe',
];

/**
 * GDK（1.21.120 起）内容根候选，**位于 `%APPDATA%` 下，不在 `%LOCALAPPDATA%\Packages\` 下**。
 * 来源：learn.microsoft.com/en-us/minecraft/creator/documents/gdkpcprojectfolder
 * （「GDK migration (the new style)」，ms.date 2025-10-24）。
 *
 * ⚠ **新增 GDK 内容根只需在这里加一行。**
 */
export const DEFAULT_GDK_APPDATA_ROOTS: readonly string[] = [
  'Minecraft Bedrock',
  'Minecraft Bedrock Preview',
];

/**
 * ⚠ **拼写待核实**：设计文档 §6.1 称「新版 GDK 由 `Microsoft.MinecraftUWP` 改为
 * `Minecraft for Windows`」（目录名含空格）。**该拼写未获权威来源证实** ——
 * 微软官方 GDK 迁移文档只给出 `%appdata%\Minecraft Bedrock\users\shared\games\com.mojang`，
 * 全文未出现任何 `Packages\<包名>` 形式的 GDK 目录。
 *
 * 因此这里**不硬编码**该字符串，也**不默认启用**。若后续拿到权威来源（或在真实机器上
 * 观测到），把它加入 `DEFAULT_UWP_PACKAGE_NAMES`，或先用
 * `extraCandidates: ['<LOCALAPPDATA>\\Packages\\Minecraft for Windows\\LocalState\\games\\com.mojang']`
 * 注入验证，确认无误后再固化。
 */
export const UNVERIFIED_GDK_PACKAGE_NAME_HINT =
  '设计文档所称的新版 GDK 包名「Minecraft for Windows」尚无权威来源证实；' +
  '请先用 extraCandidates 注入验证，确认后再加入 DEFAULT_UWP_PACKAGE_NAMES。';

/* ========================================================================== */
/* 中文指引：全部指向「生成合法包 + 引导用户双击导入」（§6.1 第 4 条）        */
/* ========================================================================== */

const MANUAL_IMPORT_TAIL =
  '已切换为手动导入模式：我会把行为包/资源包生成成合法的 .mcpack 文件放到工作目录，' +
  '你只需要双击该文件即可导入到 Minecraft，游戏内「导入」界面也能看到它。';

const USER_HINTS: Record<Exclude<ProbeReason, 'found'>, string> = {
  'permission-denied':
    '已找到 Minecraft 内容目录，但当前账户无读取权限（这是 UWP 受保护目录，' +
    '即使用管理员账户也可能被拒）。' +
    MANUAL_IMPORT_TAIL,
  unreadable:
    '已找到 Minecraft 内容目录，但无法读取其内容（权限或文件系统错误）。' + MANUAL_IMPORT_TAIL,
  'not-installed':
    '未在常见位置探测到 Minecraft 经典内容目录 com.mojang：可能尚未安装/启动过，' +
    '或游戏使用了新版 GDK 的自定义存储位置。' +
    MANUAL_IMPORT_TAIL,
  'no-environment':
    '当前进程环境里没有 LOCALAPPDATA / APPDATA，无法自动定位内容目录。' +
    MANUAL_IMPORT_TAIL +
    '（若你手动知道路径，可设置环境变量 COM_MOJANG_DIR 后重试。）',
  'probe-error':
    '定位 Minecraft 内容目录时遇到文件系统错误，无法确认内容目录状态。' + MANUAL_IMPORT_TAIL,
};

/* ========================================================================== */
/* 探测                                                                       */
/* ========================================================================== */

/** 真实 fs 的默认实现（只读：无任何写入方法）。 */
const NODE_FS: ProbeFsOps = {
  statSync: (path: string) => statSync(path),
  readdirSync: (path: string) => readdirSync(path),
};

/** 权限类 errno：存在但读不了（§6.1 第 4 条的关键区分）。 */
const PERMISSION_ERRNOS: ReadonlySet<string> = new Set(['EACCES', 'EPERM']);

/** 内部使用的候选。 */
interface Candidate {
  readonly path: string;
  readonly source: CandidateSource;
}

/**
 * 按优先级构造候选路径列表：环境变量覆盖 → UWP(旧) → GDK(新版) → 额外注入。
 * 全程去重保序。
 */
function buildCandidates(
  env: Record<string, string | undefined>,
  options: ProbeOptions,
): Candidate[] {
  const out: Candidate[] = [];
  const push = (raw: string | undefined, source: CandidateSource): void => {
    if (typeof raw !== 'string') return;
    const path = raw.trim();
    if (path !== '') out.push({ path, source });
  };

  // 1) 环境变量覆盖优先级最高。
  for (const key of ENV_OVERRIDE_KEYS) push(env[key], 'env-override');

  // 2) 旧 UWP：%LOCALAPPDATA%\Packages\<包族名>\LocalState\games\com.mojang
  const localAppData = env['LOCALAPPDATA'];
  const packageNames = options.uwpPackageNames ?? DEFAULT_UWP_PACKAGE_NAMES;
  if (typeof localAppData === 'string' && localAppData.trim() !== '') {
    for (const name of packageNames) {
      push(
        join(localAppData, 'Packages', name, 'LocalState', 'games', 'com.mojang'),
        'uwp-localstate',
      );
    }
  }

  // 3) 新 GDK：%APPDATA%\<内容根>\users\shared\games\com.mojang
  const appData = env['APPDATA'];
  const gdkRoots = options.gdkAppDataRoots ?? DEFAULT_GDK_APPDATA_ROOTS;
  if (typeof appData === 'string' && appData.trim() !== '') {
    for (const root of gdkRoots) {
      push(join(appData, root, 'users', 'shared', 'games', 'com.mojang'), 'gdk-appdata');
    }
  }

  // 4) 额外注入（含字面量路径，可含空格，如拼写待核实的新版 GDK 包名路径）。
  for (const extra of options.extraCandidates ?? []) push(extra, 'extra');

  const seen = new Set<string>();
  return out.filter((c) => {
    if (seen.has(c.path)) return false;
    seen.add(c.path);
    return true;
  });
}

/** 读取 Node fs 异常的 errno。 */
function errnoOf(err: unknown): string | null {
  if (typeof err === 'object' && err !== null && 'code' in err) {
    const code = (err as { code: unknown }).code;
    if (typeof code === 'string') return code;
  }
  return null;
}

/**
 * 探测单个候选。**存在探测与权限探测分开**（约束 A）：
 * 1. `statSync` + try/catch 读 errno → 区分 ENOENT / EACCES / EPERM / 其他；
 * 2. stat 通过但不是目录 → not-a-directory（继续试下一个候选）；
 * 3. 是目录则再 `readdirSync` 复核可列目录性（stat 成功不代表能读内容）。
 */
function inspect(fs: ProbeFsOps, candidate: Candidate): CandidateOutcome {
  const { path, source } = candidate;
  let isDirectory: boolean;
  try {
    isDirectory = fs.statSync(path).isDirectory();
  } catch (err) {
    const errno = errnoOf(err);
    if (errno !== null && PERMISSION_ERRNOS.has(errno)) {
      return { path, source, status: 'permission-denied', errno };
    }
    if (errno === 'ENOENT') return { path, source, status: 'missing', errno };
    if (errno === 'ENOTDIR') return { path, source, status: 'not-a-directory', errno };
    return { path, source, status: 'error', errno };
  }

  if (!isDirectory) return { path, source, status: 'not-a-directory', errno: null };

  try {
    fs.readdirSync(path);
  } catch (err) {
    const errno = errnoOf(err);
    const permission = errno !== null && PERMISSION_ERRNOS.has(errno);
    // 目录确实存在（stat 成功）却读不了 → 按「存在但读不了」降级，绝不谎报「未安装」。
    return { path, source, status: permission ? 'permission-denied' : 'unreadable', errno };
  }

  return { path, source, status: 'ok', errno: null };
}

/** 组装降级结果（found=false）。 */
function missResult(
  reason: Exclude<ProbeReason, 'found'>,
  candidates: readonly string[],
  tried: readonly CandidateOutcome[],
): ProbeResult {
  return {
    found: false,
    readable: false,
    contentDir: null,
    source: null,
    degraded: true,
    reason,
    userHint: USER_HINTS[reason],
    candidates,
    tried,
  };
}

/**
 * 探测 Bedrock 内容目录（只读；§6.1）。
 *
 * 绝不抛异常：任何失败都转成 `found:false` + `reason` + `tried`（约束 E）。
 */
export function probeContentDirs(options: ProbeOptions = {}): ProbeResult {
  const env = options.env ?? process.env;
  const fs = options.fs ?? NODE_FS;
  const candidates = buildCandidates(env, options);
  const candidatePaths = candidates.map((c) => c.path);
  const tried: CandidateOutcome[] = [];
  let sawUnexpectedError = false;

  for (const candidate of candidates) {
    const outcome = inspect(fs, candidate);
    tried.push(outcome);

    // 首个「存在」的候选即判定结果（约束 B）：不再回退到其它路径，
    // 否则「存在但无权限」的降级信号会被另一个恰好可读的路径掩盖。
    if (outcome.status === 'ok') {
      return {
        found: true,
        readable: true,
        contentDir: outcome.path,
        source: outcome.source,
        degraded: false,
        reason: 'found',
        userHint: null,
        candidates: candidatePaths,
        tried,
      };
    }
    if (outcome.status === 'permission-denied') {
      return {
        found: true,
        readable: false,
        contentDir: outcome.path,
        source: outcome.source,
        degraded: true,
        reason: 'permission-denied',
        userHint: USER_HINTS['permission-denied'],
        candidates: candidatePaths,
        tried,
      };
    }
    if (outcome.status === 'unreadable') {
      return {
        found: true,
        readable: false,
        contentDir: outcome.path,
        source: outcome.source,
        degraded: true,
        reason: 'unreadable',
        userHint: USER_HINTS.unreadable,
        candidates: candidatePaths,
        tried,
      };
    }
    // missing / not-a-directory → 继续试下一个候选。
    if (outcome.status === 'error') sawUnexpectedError = true;
  }

  if (candidates.length === 0) return missResult('no-environment', candidatePaths, tried);
  return missResult(sawUnexpectedError ? 'probe-error' : 'not-installed', candidatePaths, tried);
}
