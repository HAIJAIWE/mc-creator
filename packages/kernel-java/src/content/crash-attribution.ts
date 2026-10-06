/**
 * 崩溃归因（设计文档 §5.3 · 「崩溃归因」：latest.log / hs_err_pid / crash-report → 映射到具体 Mod）。
 *
 * 设计要求（主代理拍板，逐条落在这里；出处均标注）：
 *
 * 1. **纯函数 + 文件读取分离**（出处：设计要求 1）
 *    - `analyzeCrashReport(text)` 是纯函数：输入一段文本、输出一份结构化 `CrashAttribution`，
 *      不读文件、不碰内核运行态、不启进程、可直接单测。
 *    - 读文件那层（`listCrashArtifacts` / `analyzeCrashFile` / `attributeNewestArtifact`）
 *      只有 `node:fs` 的薄薄一层，把文本喂给同一个纯函数。
 *    - 服务端侧的日志读取在 `packages/kernel-server/src/kernel.ts:1988-1989`
 *      （`join(dataDir, serverId, 'logs', 'latest.log')`），与本文件无关，
 *      **不要去动 kernel-server**；本文件负责的是 Java 内核（客户端实例）侧的崩溃归因。
 *
 * 2. **归因结论必须可解释**（出处：设计要求 2）
 *    返回结构带 `evidence: string[]`（「凭什么认为是它」），`suspect` 还带 `basis`（判据来源）
 *    与 `score`。无法归因时返回明确的 `status: 'unattributable'` + `reason`，**不猜一个 modId 出来**。
 *
 * 3. **不许把「加载了」当「元凶」**（出处：设计要求 3 —— 本任务最容易做错的地方）
 *    报告里列出 40 个 Mod 只说明「它们在场」，不说明「谁炸的」。所以：
 *    - **只有拿到直接判据才产出 `suspect`**：报告显式 `Suspected Mod(s):` 提示、
 *      Mixin/Forge 崩溃尾部的 `Mod File: xxx.jar` 指示、异常栈/`Caused by:` 链里的 Mod 类名。
 *    - 否则 `suspect = null`：有已加载列表就降级放进 `candidates`，`reason` 写明
 *      「仅加载列表，无法定位元凶」。
 *    - 同分命中（两个 Mod 各命中一次栈帧）视为无法唯一确定 → 同样不给 suspect，只给 candidates。
 *    - 反向护栏：栈里出现了某个包名、但产物里**没有 Mod 列表**时，无法把类名映射回 modId，
 *      此时也判 unattributable（宁可说不知道，也不按包名硬猜一个 Mod）。
 *
 * 4. **解析必须容错**（出处：设计要求 4 —— 本任务的核心风险是「解析器崩」）
 *    MC 崩溃产物格式随版本变过好几轮（`-- Mods --` / `Mod List:` / `Fabric Mods:` /
 *    日志里的 `Loading N mods:` / `hs_err` 的 `Libraries:`）。任何一段缺失、截断、乱码都不能抛：
 *    - 所有正则走 `safeMatch`（内部 try/catch，返回 null）；
 *    - 逐行解析对每一行单独兜底，一行炸了不影响后面；
 *    - `analyzeCrashReport` 外层再兜一层 try/catch，走 `unattributable()` 降级分支。
 *
 * 5. 覆盖三类输入（出处：设计要求 5）
 *    - `crash-reports/crash-<timestamp>-<client|server>.txt`（`-- System Details --` / `-- Mods --`）
 *    - `hs_err_pid<pid>.log`（`Command Line:` / `Libraries:` / `Java frames:`）
 *    - `logs/latest.log`（可能只有异常栈、没有 Mods 段）
 *
 * 已知产物形状（照真实格式写，不臆造）：
 *   - crash-report：`---- Minecraft Crash Report ----`、`-- System Details --`、`-- Mods --`，
 *     Mods 行 `id: modid  version: 1.2.3  File: /path/to/mod.jar`；1.13+ 是 `Mod List:` 下的
 *     `modid 1.2.3 files: [a.jar, b.jar]`。
 *   - Fabric crash-report 顶部 `Fabric Mods:`，行 `fabric-api: 0.90.0+1.20.1`。
 *   - `hs_err_pid*.log`：`Command Line:`（含 classpath）、`Libraries:`（` L1: path (file: ...)`）、`Java frames:`。
 *   - `latest.log`：`[12:00:00] [Render thread/ERROR]: java.lang.RuntimeException: ...` + `\tat moda.Foo.bar(Foo.java:10)`。
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import type { Dirent, Stats } from 'node:fs';
import { join } from 'node:path';

/* ------------------------------------------------------------------------- *
 * 类型
 * ------------------------------------------------------------------------- */

/** 输入来源类型。 */
export type CrashSourceKind = 'crash-report' | 'hs_err' | 'log';

/** 识别出来的产物格式（`unknown` = 完全不认识）。 */
export type CrashFormat =
  | 'minecraft-crash-report'
  | 'fabric-crash-report'
  | 'forge-modlist'
  | 'hs_err'
  | 'game-log'
  | 'unknown';

/**
 * 归因状态：
 * - `attributed`：有 `suspect`（必须来自直接判据，见要求 3）
 * - `candidates-only`：只拿到已加载列表 / 同分无法唯一确定，没有元凶
 * - `unattributable`：无法归因（格式不认识，或既无 Mod 列表又无可映射的判据）
 */
export type AttributionStatus = 'attributed' | 'candidates-only' | 'unattributable';

/** 判据来源：报告显式提示 / Mixin·Forge 的 Mod File 指示 / 异常栈类名命中。 */
export type AttributionBasis = 'report-hint' | 'mod-file' | 'stack-trace';

/** 已加载 Mod 记录的来源段落。 */
export type LoadedModOrigin =
  | 'mods-section'
  | 'mod-list'
  | 'fabric-mods'
  | 'log-loaded-mods'
  | 'hs-err-libraries'
  | 'command-line'
  | 'report-hint'
  | 'mod-file';

export interface LoadedMod {
  /** modId。`hs_err` 只有 jar 文件名、没有 modId 时退化为文件名本身（不瞎编）。 */
  modId: string;
  version: string | null;
  /** jar 路径（crash-report 的 `File:` / `files:`，或 `hs_err` 的 `Libraries:` 路径）。 */
  file: string | null;
  origin: LoadedModOrigin;
}

export interface CrashSuspect {
  modId: string;
  version: string | null;
  /** `high` = 报告自己点名（Suspected Mods / Mod File:）；`medium` = 栈帧类名推断。 */
  confidence: 'high' | 'medium';
  basis: AttributionBasis;
  /** 是否在产物给出的已加载 Mod 列表里被交叉验证到。 */
  inLoadedList: boolean;
  /** 归因打分（只用于解释与排序，不对外承诺语义）。 */
  score: number;
  /** 这个 modId 为什么被选中。 */
  evidence: string[];
}

export interface CrashAttribution {
  kind: CrashSourceKind;
  format: CrashFormat;
  status: AttributionStatus;
  /** 首个异常/崩溃的类名（如 `java.lang.NullPointerException`）。 */
  exception: string | null;
  /** 异常消息（截断到 200 字符）。 */
  message: string | null;
  /** 已加载 Mod（「在场」清单，**不是**元凶清单，见要求 3）。 */
  loadedMods: LoadedMod[];
  /** 元凶；null = 没有直接判据或无法唯一确定。 */
  suspect: CrashSuspect | null;
  /** 候选；`suspect` 为 null 且确有可疑对象时才非空。 */
  candidates: LoadedMod[];
  /** 判据说明（「凭什么这么判」）。无法归因时也非空：说明看到了什么、缺了什么。 */
  evidence: string[];
  /** 无法归因的原因（`status !== 'attributed'` 时给出）。 */
  reason: string | null;
  /** 产物里识别到的格式标记，便于排障。 */
  signals: string[];
}

/* ------------------------------------------------------------------------- *
 * 解析内部结构
 * ------------------------------------------------------------------------- */

/** 解析阶段的单位：在 LoadedMod 之外带上匹配用的 alias 集合。 */
interface Unit extends LoadedMod {
  aliases: string[];
}

/** 归因打分条目。 */
interface ScoreEntry {
  unit: Unit;
  score: number;
  evidence: string[];
  /** 已命中判据里优先级最高的一个（report-hint > mod-file > stack-trace）。 */
  basis: AttributionBasis | null;
}

interface ParseResult {
  format: CrashFormat;
  /** 全部栈帧类名（权重 1）。 */
  frameClasses: string[];
  /** 异常头类名：`Caused by:` 链 / 首个异常行 / 消息里的类引用（权重 3）。 */
  headerClasses: string[];
  exception: string | null;
  message: string | null;
  /** `Suspected Mod(s):` 这类报告显式提示的原始值。 */
  hints: string[];
  /** `Mod File: xxx.jar`（Mixin / Forge 崩溃里的元凶指示）。 */
  modFiles: string[];
  units: Unit[];
  signals: string[];
  /** 栈里出现过、但因为没有 Mod 列表而无法映射到 modId 的类名。 */
  unmappedStackClasses: string[];
}

type Section = 'none' | 'mods' | 'modlist' | 'fabric' | 'libraries' | 'command' | 'loadingmods';

/* ------------------------------------------------------------------------- *
 * 容错工具（要求 4：解析器不许崩）
 * ------------------------------------------------------------------------- */

/**
 * 所有正则调用都走这里。单个正则不该抛，但输入可能是任意乱码/截断文本，
 * 统一兜底后异常收敛成「这一段没匹配上」，而不是整个归因失败。
 */
function safeMatch(re: RegExp, input: string): RegExpExecArray | null {
  try {
    return re.exec(input);
  } catch {
    return null;
  }
}

/** 收集一段文本里所有匹配（内部新建正则，避免 lastIndex 跨调用污染）。 */
function matchAll(re: RegExp, input: string): string[] {
  try {
    return [...input.matchAll(re)].map((m) => m[1] ?? m[0]);
  } catch {
    return [];
  }
}

/** 去掉日志行前缀：`[12:00:00] [Render thread/ERROR]: ` → `java.lang...`（`:` 不能漏） */
const LOG_PREFIX_RE = /^\s*(?:\[[^\]]{0,200}\]\s*:?\s*)+/;

/** 栈帧：`at a.b.c.Foo.bar(Foo.java:12)` / `\tat moda.Handler.run(Handler.java:9)` */
const FRAME_RE = /^\s*at\s+([\w$.]{1,200})\.([\w$<>]{1,80})\((.*)\)\s*$/;
/**
 * `hs_err` 的 Java 帧：没有 `at`，而是原生态标记列
 * （`j` 解释执行 / `J` 编译执行 / `v`、`V` native / `s` / `i`）。
 */
const HS_FRAME_RE = /^\s*[jJvviIsz]\s{1,4}([\w$.]{1,200})\.([\w$<>]{1,80})\((.*)\)\s*$/;
/** 异常头：`java.lang.NullPointerException: msg` / `Exception in thread "main" ...` */
const EXC_RE =
  /^(?:Exception in thread "[^"]{0,80}":\s*)?((?:[A-Za-z_$][\w$]{0,60}\.){1,40}[A-Z][\w$]{0,60}(?:Exception|Error|Throwable|Crash))\b(?:\s*:\s*(.*))?$/;
/**
 * `Caused by:` 行：链头就是「谁抛的」，所以这里**不要求**类名以 Exception/Error 收尾
 * （`Caused by: com.example.moda.Boom: inner` 这种自定义 Throwable 很常见）。
 */
const CAUSED_BY_RE =
  /^Caused by:\s*([A-Za-z_$][\w$]{0,60}(?:\.[A-Za-z_$][\w$]{0,60}){1,40})\b\s*(?::\s*(.*))?$/;
/** 消息里的类引用：`NoClassDefFoundError: a/b/C`、`NoSuchMethodError: a.b.C` */
const MSG_CLASS_RE = /\b((?:[A-Za-z_$][\w$]{0,60}[./]){1,40}[A-Z][\w$]{0,60})\b/g;
/** `hs_err` 的 Libraries 行：` L1: C:/x/base.zip (file: C:/x/base.zip)` */
const LIB_LINE_RE = /^L\d{1,6}:\s*(.+?)\s*\(file:/;

/* ------------------------------------------------------------------------- *
 * 归因护栏
 * ------------------------------------------------------------------------- */

/**
 * 平台与加载器自身的包前缀：出现在栈里不代表某个 Mod 的锅，直接跳过。
 * 这条是防止「随便什么 Mod 都被扣帽子」的关键（例如 modId 叫 `client` 时，
 * 不该把 `net.minecraft.client.Minecraft` 算成它的责任）。
 */
const VENDOR_PREFIXES: readonly string[] = [
  'net.minecraft',
  'net.minecraftforge',
  'net.neoforged',
  'net.fabricmc',
  'net.fabricmc.loader',
  'cpw.mods',
  'modlauncher',
  'securejarhandler',
  'org.spongepowered',
  'org.spongepowered.asm',
  'org.joml',
  'org.lwjgl',
  'org.slf4j',
  'org.apache.logging.log4j',
  'org.bouncycastle',
  'org.jetbrains',
  'com.mojang',
  'com.google.common',
  'com.google.gson',
  'it.unimi.dsi',
  'kotlin',
  'kotlinx',
  'java',
  'javax',
  'sun',
  'jdk',
  'com.oracle',
  'osgi',
];

/** jar 文件名里没信息量的词，别拿它们当 modId 去匹配包名。 */
const NOISE_ALIASES: ReadonlySet<string> = new Set([
  'jar',
  'lib',
  'libs',
  'mod',
  'mods',
  'main',
  'api',
  'common',
  'core',
  'client',
  'release',
  'final',
  'build',
  'the',
  'version',
  'tmp',
]);

/** jar 名里的版本号片段（`1`, `2`, `v1_0`…），不当 alias。 */
const VERSION_TOKEN_RE = /^v?\d+(?:[._]\d+)*$/;

function isVendorClass(cls: string): boolean {
  const lower = cls.toLowerCase();
  for (const p of VENDOR_PREFIXES) {
    if (lower === p || lower.startsWith(`${p}.`)) return true;
  }
  return false;
}

/** 归一化成可用于包名匹配的 alias；返回 null 表示这个 token 没资格当 modId。 */
function normalizeAlias(raw: string): string | null {
  const t = raw.trim().toLowerCase();
  if (t.length < 3 || t.length > 64) return null;
  if (NOISE_ALIASES.has(t)) return null;
  if (VERSION_TOKEN_RE.test(t)) return null;
  return t;
}

/**
 * 一个 Mod 可能被以多种形式提及（modId、`ns:modid`、jar 文件名 `moda-1.2.3.jar`），
 * 全部归一成 alias 集合，用于和栈里的类名 segment 做匹配。
 */
function buildAliases(modId: string, file: string | null): string[] {
  const out = new Set<string>();
  const push = (s: string | null | undefined): void => {
    const a = normalizeAlias(s ?? '');
    if (a) out.add(a);
  };
  push(modId);
  const colon = modId.indexOf(':');
  if (colon > 0) push(modId.slice(colon + 1));
  for (const part of modId.split(/[^A-Za-z0-9_]+/)) push(part);
  if (file) {
    const base = file.split(/[\\/]/).pop() ?? file;
    const stem = base.replace(/\.[A-Za-z]{1,8}$/, '');
    for (const part of stem.split(/[^A-Za-z0-9]+/)) push(part);
  }
  return [...out].sort();
}

function unitKey(u: { modId: string; file: string | null }): string {
  return `${u.modId}|${u.file ?? ''}`;
}

function basename(p: string): string {
  return p.split(/[\\/]/).pop() ?? p;
}

/* ------------------------------------------------------------------------- *
 * 解析：单趟扫描，任何段落缺失都只是「少一段」
 * ------------------------------------------------------------------------- */

function toLines(text: string): string[] {
  // \r\n / \n / \r 都按行断；超长行也不影响，split 不会炸。
  return text.split(/\r\n|\n|\r/);
}

function parseCrashText(text: string): ParseResult {
  const lines = toLines(text);
  const frameClasses: string[] = [];
  const headerClasses: string[] = [];
  const hints: string[] = [];
  const modFiles: string[] = [];
  const units: Unit[] = [];
  const unitIndex = new Map<string, Unit>();
  const signals: string[] = [];
  const allJars: string[] = [];
  const modJars: string[] = [];

  let exception: string | null = null;
  let message: string | null = null;
  let section: Section = 'none';
  let hsSignal = false;
  let crashReportSignal = false;
  let fabricSignal = false;
  let modListSignal = false;
  let logModsSignal = false;
  let anyExcLine = false;
  let anyFrame = false;

  const note = (s: string): void => {
    if (!signals.includes(s)) signals.push(s);
  };

  const addUnit = (
    modId: string,
    version: string | null,
    file: string | null,
    origin: LoadedModOrigin,
  ): Unit => {
    const id = modId.trim();
    if (!id) return { modId: '', version, file, origin, aliases: [] };
    const key = unitKey({ modId: id, file });
    const existing = unitIndex.get(key);
    if (existing) {
      if (!existing.version && version) existing.version = version;
      if (!existing.file && file) {
        existing.file = file;
        existing.aliases = buildAliases(existing.modId, file);
      }
      return existing;
    }
    const unit: Unit = {
      modId: id,
      version,
      file,
      origin,
      aliases: buildAliases(id, file),
    };
    unitIndex.set(key, unit);
    units.push(unit);
    return unit;
  };

  const collectJars = (line: string): void => {
    for (const jar of matchAll(/([^;,\s"']{1,300}?\.jar)/g, line)) {
      if (jar) allJars.push(jar);
    }
  };

  for (const raw of lines) {
    const line = raw.replace(LOG_PREFIX_RE, '');
    const trimmed = line.trim();
    if (!trimmed) {
      // 空行是各段落的天然结束符（`Libraries:` / `Fabric Mods:` / `Mods` 都是列表形态）。
      section = 'none';
      continue;
    }

    /* ---- 全局：栈帧 / 异常头 / 提示 / Mod File（与段落无关） ---- */
    const frame = safeMatch(FRAME_RE, trimmed) ?? safeMatch(HS_FRAME_RE, trimmed);
    if (frame) {
      frameClasses.push(frame[1]);
      anyFrame = true;
    }

    // `Caused by:` 优先：链头就是「谁抛的」，优先级和首个异常同级（权重 3）。
    const causedBy = safeMatch(CAUSED_BY_RE, trimmed);
    const exc = causedBy ? null : safeMatch(EXC_RE, trimmed);
    const headerCls = causedBy ? (causedBy[1] ?? null) : exc ? (exc[1] ?? null) : null;
    const headerMsg = causedBy ? (causedBy[2] ?? null) : exc ? (exc[2] ?? null) : null;
    if (headerCls) {
      headerClasses.push(headerCls);
      anyExcLine = true;
      if (!exception) {
        exception = headerCls;
        message = headerMsg ? headerMsg.trim().slice(0, 200) : null;
      }
      // 消息里的类引用（NoClassDefFoundError / NoSuchMethodError 的 a.b.C）也是直接判据。
      for (const raw2 of matchAll(MSG_CLASS_RE, headerMsg ?? '')) {
        const cls = raw2.replace(/[./]/g, '.');
        if (cls.includes('.') && !isVendorClass(cls)) headerClasses.push(cls);
      }
    }

    const modFileM = safeMatch(/^Mod File:\s*(.+)$/i, trimmed);
    if (modFileM) {
      const name = modFileM[1].trim();
      if (name) {
        modFiles.push(name);
        note('Mod File:');
      }
    }

    const hintM = safeMatch(
      /^(?:Suspected Mods?|Suspect Mods?|Suspected mods?)\s*[:=]\s*(.+)$/i,
      trimmed,
    );
    if (hintM) {
      const v = hintM[1].trim();
      if (v) {
        hints.push(v);
        note('Suspected Mods:');
      }
    }

    /* ---- 段落标题 ---- */
    const dashes = safeMatch(/^--\s*(.+?)\s*--$/, trimmed);
    if (dashes) {
      const title = dashes[1].trim();
      note(`-- ${title} --`);
      if (title.toLowerCase() === 'mods') {
        section = 'mods';
      } else {
        if (title.toLowerCase() === 'system details') crashReportSignal = true;
        section = 'none';
      }
      continue;
    }
    if (/^fabric mods:?$/i.test(trimmed)) {
      section = 'fabric';
      fabricSignal = true;
      note('Fabric Mods:');
      continue;
    }
    if (/^mod list:?$/i.test(trimmed)) {
      section = 'modlist';
      modListSignal = true;
      note('Mod List:');
      continue;
    }
    if (/^libraries:?$/i.test(trimmed)) {
      section = 'libraries';
      hsSignal = true;
      note('Libraries:');
      continue;
    }
    const cmdM = safeMatch(/^(?:Command Line|java_command)\s*:\s*(.*)$/i, trimmed);
    if (cmdM) {
      hsSignal = true;
      note('Command Line:');
      section = 'command';
      if (cmdM[1].trim()) collectJars(cmdM[1]);
      continue;
    }
    if (/^loading\s+\d{1,6}\s+mods:?$/i.test(trimmed)) {
      section = 'loadingmods';
      logModsSignal = true;
      note('Loading N mods:');
      continue;
    }
    const structural = safeMatch(
      /^(Internal Error|Current thread|Java frames|VM Arguments|Environment Variables|siginfo|VM flags|unhandled exceptions|Stack:)/i,
      trimmed,
    );
    if (structural) {
      if (/^(Internal Error|Java frames|VM Arguments|siginfo)/i.test(trimmed)) hsSignal = true;
      section = 'none';
      continue;
    }

    /* ---- 段落内容 ---- */
    if (section === 'command') {
      collectJars(trimmed);
      continue;
    }

    if (section === 'libraries') {
      const libM = safeMatch(LIB_LINE_RE, trimmed);
      collectJars(libM ? (libM[1] ?? '') : trimmed);
      continue;
    }

    if (section === 'fabric') {
      // Fabric: `fabric-api: 0.90.0+1.20.1`
      const fM = safeMatch(/^([A-Za-z0-9_.-]{1,80}):\s*([^\s]{1,80})$/, trimmed);
      if (fM) addUnit(fM[1], fM[2], null, 'fabric-mods');
      continue;
    }

    if (section === 'loadingmods') {
      // Fabric 日志：`- alternate-current 1.1.0`
      const lM = safeMatch(/^-?\s*([A-Za-z0-9_.:+-]{1,80})\s+(\d[^\s]{0,60})$/, trimmed);
      if (lM) addUnit(lM[1], lM[2], null, 'log-loaded-mods');
      continue;
    }

    if (section === 'modlist') {
      if (/^state\b/i.test(trimmed)) {
        section = 'none';
        continue;
      }
      // 1.13+ Forge：`modid 1.2.3 files: [a.jar, b.jar]`
      const fM = safeMatch(
        /^([A-Za-z0-9_.:+-]{1,80})\s+(\S{1,60})\s+files:\s*\[(.*)\]\s*$/i,
        trimmed,
      );
      if (fM) {
        const one = safeMatch(/^\s*([^,\]]{1,300}\.jar)\s*$/, fM[3] ?? '');
        addUnit(fM[1], fM[2], one ? (one[1] ?? '').trim() : null, 'mod-list');
        continue;
      }
      // `modid 1.2.3`
      const vM = safeMatch(/^([A-Za-z0-9_.:+-]{1,80})\s+(v?\d[^\s]{0,60})$/, trimmed);
      if (vM) addUnit(vM[1], vM[2], null, 'mod-list');
      continue;
    }

    if (section === 'mods') {
      // 1.7+ Forge：`id: modid  version: 1.2.3  File: /path/to/mod.jar`
      const fM = safeMatch(
        /^id:\s*([A-Za-z0-9_.:+-]{1,80})\s+version:\s*(\S{1,60})(?:\s+File:\s*(.+?))?\s*$/i,
        trimmed,
      );
      if (fM) {
        addUnit(fM[1], fM[2], fM[3] ? fM[3].trim() : null, 'mods-section');
        continue;
      }
      // `-- Mods --` 里的子标题（如 `Active Mods:`）后跟裸 modId 的形态：标题本身结束本段
      if (safeMatch(/^[A-Za-z][\w ]{0,40}:$/, trimmed)) {
        section = 'none';
        continue;
      }
      // 兼容 `modid: 1.2.3`
      const kM = safeMatch(/^([A-Za-z0-9_.:+-]{1,80}):\s*(\S{1,60})$/, trimmed);
      if (kM) {
        addUnit(kM[1], kM[2], null, 'mods-section');
        continue;
      }
      // 裸 modId 一行一个
      const bareM = safeMatch(/^([A-Za-z0-9_.:+-]{1,80})$/, trimmed);
      if (bareM) addUnit(bareM[1], null, null, 'mods-section');
      continue;
    }
  }

  /* ---- hs_err：把 jar 路径转成「已加载单位」（只有文件名，没有 modId 就是没有 modId） ---- */
  if (allJars.length > 0) {
    for (const jar of allJars) {
      const norm = jar.replace(/\\/g, '/');
      if (/(^|\/)mods\/[^/]+\.jar$/i.test(norm)) modJars.push(jar);
    }
    // 没有 mods/ 目录时，退而取非 libraries 的 jar（MC 自带依赖都在 libraries/ 下）。
    const picked = modJars.length
      ? modJars
      : allJars.filter((j) => !/(^|\/)libraries\//i.test(j.replace(/\\/g, '/')));
    const seen = new Set<string>();
    for (const jar of picked) {
      const key = jar.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      addUnit(basename(jar), null, jar, 'hs-err-libraries');
    }
  }

  /* ---- 格式判定 ---- */
  let format: CrashFormat = 'unknown';
  if (hsSignal) format = 'hs_err';
  // `Fabric Mods:` 段是加载器自报，比「长得像 vanilla 报告」更能定性
  else if (fabricSignal) format = 'fabric-crash-report';
  else if (crashReportSignal) format = 'minecraft-crash-report';
  else if (modListSignal && !logModsSignal) format = 'minecraft-crash-report';
  else if (logModsSignal) format = 'game-log';
  else if (anyExcLine || anyFrame) format = 'game-log';

  if (anyExcLine) note('exception line');
  if (anyFrame) note('stack frames');

  /* ---- 栈里出现、但没有 Mod 列表可比对的类名（要求 3 的反向护栏） ---- */
  const unmappedStackClasses: string[] = [];
  if (units.length === 0) {
    for (const cls of [...headerClasses, ...frameClasses]) {
      if (isVendorClass(cls)) continue;
      if (!unmappedStackClasses.includes(cls)) unmappedStackClasses.push(cls);
      if (unmappedStackClasses.length >= 20) break;
    }
  }

  return {
    format,
    frameClasses,
    headerClasses,
    exception,
    message,
    hints,
    modFiles,
    units,
    signals,
    unmappedStackClasses,
  };
}

/* ------------------------------------------------------------------------- *
 * 归因：只认「直接判据」
 * ------------------------------------------------------------------------- */

const BASIS_RANK: Record<AttributionBasis, number> = {
  'stack-trace': 1,
  'mod-file': 2,
  'report-hint': 3,
};

function betterBasis(cur: AttributionBasis | null, next: AttributionBasis): AttributionBasis {
  if (!cur) return next;
  return BASIS_RANK[next] > BASIS_RANK[cur] ? next : cur;
}

/** 类名 segment 是否命中某个 alias。命中返回命中的 alias，否则 null。 */
function matchClass(cls: string, aliases: readonly string[]): string | null {
  if (isVendorClass(cls)) return null;
  const segs = cls.split('.');
  // 从第 1 段开始：第 0 段是根包名（com/net/dev/…），不可能是 modId。
  for (let i = 1; i < segs.length; i += 1) {
    const seg = (segs[i] ?? '').toLowerCase().replace(/\$[a-z0-9_]+$/, '');
    if (!seg) continue;
    for (const alias of aliases) {
      if (seg === alias) return alias;
      // 驼峰包段：`modaBlock` 之于 modId `moda`；alias 太短容易误伤，只在 ≥5 字时启用。
      if (alias.length >= 5 && seg.length > alias.length && seg.startsWith(alias)) return alias;
    }
  }
  return null;
}

/** 把 `Suspected Mods: a, b` / `Mod File: a.jar` 里的 token 解析成单位。 */
function resolveToken(
  token: string,
  units: readonly Unit[],
  aliasIndex: ReadonlyMap<string, Unit>,
  origin: LoadedModOrigin,
): Unit {
  const raw = token.trim();
  const base =
    raw
      .replace(/\.jar$/i, '')
      .split(/[\s(,;@|]+/)
      .filter(Boolean)
      .pop() ?? raw;
  for (const u of units) {
    if (u.modId.toLowerCase() === base.toLowerCase()) return u;
  }
  // jar 名 `mapa-1.2.3` → 依次试 `mapa-1.2.3` / `mapa`（modId 侧只有 `-`/`_` 才是合法分隔，
  // 版本号里的 `.` 不能当分隔符）。
  const head = base.toLowerCase();
  const candidates = [head, head.split(/[^A-Za-z0-9_:]/)[0] ?? '', head.split(/[._-]/)[0] ?? ''];
  for (const cand of candidates) {
    if (!cand) continue;
    const hit = aliasIndex.get(cand);
    if (hit) return hit;
  }
  // 产物没给 Mod 列表：造一个「只来自提示」的单位，`inLoadedList` 会是 false。
  return {
    modId: base,
    version: null,
    file: raw || null,
    origin,
    aliases: buildAliases(base, raw || null),
  };
}

function buildAliasIndex(units: readonly Unit[]): Map<string, Unit> {
  const idx = new Map<string, Unit>();
  for (const u of units) {
    for (const a of u.aliases) {
      if (!idx.has(a)) idx.set(a, u);
    }
  }
  return idx;
}

interface AttributionOutcome {
  suspect: CrashSuspect | null;
  /** 内部阶段仍是 Unit（带 alias），对外出口统一转成 LoadedMod。 */
  candidates: Unit[];
  evidence: string[];
  reason: string | null;
}

/**
 * 把解析结果收敛成结论。
 *
 * ⚠ 要求 3 的落点：这个函数**只会**因为 `entries` 非空才给出 suspect，
 * 而 `entries` 只接受三类直接判据（报告点名 / Mod File / 栈帧类名命中）。
 * 「已加载 Mod 列表」本身不产生任何 entry —— 所以只有加载列表时永远给不出元凶。
 */
function attributeUnits(parse: ParseResult): AttributionOutcome {
  const { units } = parse;
  const aliasIndex = buildAliasIndex(units);
  const entries = new Map<string, ScoreEntry>();
  const addScore = (unit: Unit, score: number, basis: AttributionBasis, why: string): void => {
    const key = unitKey(unit);
    const cur = entries.get(key);
    if (cur) {
      cur.score += score;
      cur.basis = betterBasis(cur.basis, basis);
      if (!cur.evidence.includes(why)) cur.evidence.push(why);
      return;
    }
    entries.set(key, { unit, score, basis, evidence: [why] });
  };

  /* 判据 1：报告显式点名（Suspected Mods: xxx）—— 置信度 high */
  for (const hint of parse.hints) {
    for (const token of hint.split(/[,;]/)) {
      const t = token.trim();
      if (!t) continue;
      const unit = resolveToken(t, units, aliasIndex, 'report-hint');
      addScore(unit, 1000, 'report-hint', `报告显式声明 Suspected Mods: ${hint}`);
    }
  }

  /* 判据 2：Mixin / Forge 崩溃尾部的 `Mod File: xxx.jar` —— 置信度 high */
  for (const mf of parse.modFiles) {
    const unit = resolveToken(mf, units, aliasIndex, 'mod-file');
    addScore(unit, 500, 'mod-file', `报告指示 Mod File: ${mf}`);
  }

  /* 判据 3：异常栈 / Caused by 链里的 Mod 类 —— 置信度 medium */
  for (const cls of parse.headerClasses) {
    for (const u of units) {
      const alias = matchClass(cls, u.aliases);
      if (alias) {
        addScore(
          u,
          3,
          'stack-trace',
          `异常头/Caused by 链出现类 ${cls}，与 ${u.modId} 的「${alias}」段命中`,
        );
      }
    }
  }
  for (const cls of parse.frameClasses) {
    for (const u of units) {
      const alias = matchClass(cls, u.aliases);
      if (alias) {
        addScore(u, 1, 'stack-trace', `栈帧出现类 ${cls}，与 ${u.modId} 的「${alias}」段命中`);
      }
    }
  }

  const ranked = [...entries.values()].sort((a, b) => b.score - a.score);

  if (ranked.length === 0) {
    // —— 明确「无法归因」，而不是从加载列表里随便挑一个（要求 3）。
    if (units.length > 0) {
      const origins = [...new Set(units.map((u) => u.origin))].join('/');
      return {
        suspect: null,
        candidates: units,
        evidence: [
          `只从 ${origins} 段落读到 ${units.length} 个已加载 Mod，没有任何直接判据` +
            '（异常栈类名命中 / Suspected Mods 提示 / Mod File 指示），加载 ≠ 出错',
        ],
        reason: `仅加载列表（${units.length} 个 Mod），无法定位元凶：报告未给出栈或提示类判据`,
      };
    }
    if (parse.unmappedStackClasses.length > 0) {
      return {
        suspect: null,
        candidates: [],
        evidence: [
          `异常栈出现 ${parse.unmappedStackClasses.slice(0, 3).join(' / ')}，` +
            '但崩溃产物里没有 Mod 列表，无法把类名映射回 modId',
        ],
        reason: '缺少已加载 Mod 列表，无法把异常类名映射到具体 Mod',
      };
    }
    const seen =
      parse.signals.length > 0 ? parse.signals.slice(0, 4).join('；') : '无任何已知格式标记';
    return {
      suspect: null,
      candidates: [],
      evidence: [`未识别到 Mod 列表或可归因的异常栈；看到的标记：${seen}`],
      reason: '无法归因：崩溃产物格式无法识别，且没有可用的 Mod 线索',
    };
  }

  const top = ranked[0] as ScoreEntry;
  const second = ranked[1];
  if (second && second.score === top.score) {
    // 同分 = 无法唯一确定，同样不给 suspect（要求 3）。
    const tied = ranked.filter((e) => e.score === top.score);
    const evidence = [
      `${tied.length} 个 Mod 命中同分判据（score=${top.score}），无法唯一确定元凶：`,
    ];
    for (const e of tied) {
      evidence.push(`${e.unit.modId}: ${e.evidence.join('；')}`);
    }
    return {
      suspect: null,
      candidates: tied.map((e) => e.unit),
      evidence,
      reason: `${tied.length} 个 Mod 判据同分，无法唯一确定元凶`,
    };
  }

  const basis: AttributionBasis = top.basis ?? 'stack-trace';
  return {
    suspect: {
      modId: top.unit.modId,
      version: top.unit.version,
      confidence: basis === 'stack-trace' ? 'medium' : 'high',
      basis,
      inLoadedList: units.some((u) => unitKey(u) === unitKey(top.unit)),
      score: top.score,
      evidence: top.evidence,
    },
    candidates: [top.unit],
    evidence: top.evidence,
    reason: null,
  };
}

/* ------------------------------------------------------------------------- *
 * 对外：纯函数
 * ------------------------------------------------------------------------- */

function unattributable(kind: CrashSourceKind, reason: string): CrashAttribution {
  return {
    kind,
    format: 'unknown',
    status: 'unattributable',
    exception: null,
    message: null,
    loadedMods: [],
    suspect: null,
    candidates: [],
    evidence: [reason],
    reason,
    signals: [],
  };
}

function toLoaded(u: Unit): LoadedMod {
  return { modId: u.modId, version: u.version, file: u.file, origin: u.origin };
}

/**
 * 崩溃归因纯函数（要求 1）。**任何输入都不抛**（要求 4）：
 * 空串、乱码、截断报告、未知格式，一律收敛成 `status: 'unattributable'` 的结构化结果。
 *
 * 归因门槛（要求 3）：只有直接判据才给 `suspect`；
 * 只有加载列表 → `candidates` + `reason` 说明「仅加载列表，无法定位」。
 */
export function analyzeCrashReport(
  text: string,
  options?: { file?: string | null },
): CrashAttribution {
  const kind = detectSourceKind(text, options?.file ?? null);
  let parse: ParseResult;
  try {
    parse = parseCrashText(typeof text === 'string' ? text : String(text ?? ''));
  } catch {
    return unattributable(kind, '解析崩溃产物时发生内部错误，已降级为无法归因');
  }

  let outcome: AttributionOutcome;
  try {
    outcome = attributeUnits(parse);
  } catch {
    return unattributable(kind, '归因阶段发生内部错误，已降级为无法归因');
  }

  const status: AttributionStatus = outcome.suspect
    ? 'attributed'
    : parse.units.length > 0 || outcome.candidates.length > 0
      ? 'candidates-only'
      : 'unattributable';

  return {
    kind,
    format: parse.format,
    status,
    exception: parse.exception,
    message: parse.message,
    loadedMods: parse.units.map(toLoaded),
    suspect: outcome.suspect,
    candidates: outcome.candidates.map(toLoaded),
    evidence: outcome.evidence,
    reason: outcome.reason,
    signals: parse.signals,
  };
}

/** 从文件名 + 内容判断输入类型。 */
export function detectSourceKind(text: string, file: string | null): CrashSourceKind {
  const safeText = typeof text === 'string' ? text : '';
  if (file) {
    const base = basename(file);
    if (/^hs_err_pid\d+/i.test(base) || /^hs_err/i.test(base)) return 'hs_err';
    if (/^crash-.*\.(txt|log)$/i.test(base)) return 'crash-report';
    // latest.log / debug.log 一类
    if (/\.log$/i.test(base)) return 'log';
  }
  if (/----\s*Minecraft Crash Report\s*----/.test(safeText)) return 'crash-report';
  if (/^--\s+System Details\s+--$/m.test(safeText)) return 'crash-report';
  if (
    LIB_LINE_RE.test(safeText) ||
    /^\s*(?:Command Line|java_command)\s*:/im.test(safeText) ||
    /^\s*Internal Error/m.test(safeText)
  ) {
    return 'hs_err';
  }
  // 行首带日志时间戳/线程标签 → latest.log 形态
  if (/^\[[^\]\n]{0,60}\][^:\n]{0,80}:/m.test(safeText)) return 'log';
  if (/^\s*(?:Caused by:|at\s|Exception in thread)/m.test(safeText)) return 'log';
  return 'crash-report';
}

/* ------------------------------------------------------------------------- *
 * 对外：文件读取薄层（要求 1）
 * ------------------------------------------------------------------------- */

export interface CrashArtifactRef {
  /** 完整路径。 */
  file: string;
  /** 文件名。 */
  name: string;
  kind: CrashSourceKind;
  /** 位置标记：`crash-reports` / `hs_err_pid*.log` / `logs/latest.log`。 */
  origin: string;
  mtimeMs: number;
  size: number;
}

function safeStat(file: string): Stats | null {
  try {
    return statSync(file);
  } catch {
    return null;
  }
}

/**
 * 列出实例目录下的崩溃产物（只读，不启进程）：
 * `<实例>/crash-reports/crash-*.txt`、`<实例>/hs_err_pid*.log`、`<实例>/logs/latest.log`。
 * 按 mtime 从新到旧排序。目录不存在 / 无权限 → 返回空数组，**不抛**（要求 4）。
 */
export function listCrashArtifacts(instanceDir: string): CrashArtifactRef[] {
  const out: CrashArtifactRef[] = [];
  const push = (file: string, origin: string, kind: CrashSourceKind): void => {
    const st = safeStat(file);
    if (!st || !st.isFile()) return;
    out.push({ file, name: basename(file), kind, origin, mtimeMs: st.mtimeMs, size: st.size });
  };

  let entries: Dirent[] = [];
  try {
    entries = readdirSync(instanceDir, { withFileTypes: true });
  } catch {
    // 实例目录不存在 → 空列表（要求 4：不抛）
    entries = [];
  }
  for (const e of entries) {
    if (e.isDirectory()) {
      if (e.name === 'crash-reports') {
        let files: string[] = [];
        try {
          files = readdirSync(join(instanceDir, e.name));
        } catch {
          files = [];
        }
        for (const f of files) {
          if (/^crash-.*\.(txt|log)$/i.test(f)) {
            push(join(instanceDir, e.name, f), 'crash-reports', 'crash-report');
          }
        }
      }
      continue;
    }
    if (/^hs_err_pid\d+/i.test(e.name)) push(join(instanceDir, e.name), e.name, 'hs_err');
  }

  push(join(instanceDir, 'logs', 'latest.log'), 'logs/latest.log', 'log');

  return out.sort((a, b) => b.mtimeMs - a.mtimeMs || a.name.localeCompare(b.name));
}

/** 读单个崩溃产物并归因；读失败 → 返回 unattributable 结果，不抛。 */
export function analyzeCrashFile(file: string): CrashAttribution {
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    return unattributable(detectSourceKind('', file), `崩溃产物不可读：${file}`);
  }
  return analyzeCrashReport(text, { file });
}

/**
 * 取实例目录下最新的崩溃产物做归因；没有任何产物 → 返回 unattributable 结果，不抛。
 * 排序上 crash-report / hs_err 优先于 latest.log：前两者带 Mod 列表，归因质量更高。
 */
export function attributeNewestArtifact(instanceDir: string): CrashAttribution {
  const artifacts = listCrashArtifacts(instanceDir);
  const best = artifacts.find((a) => a.kind !== 'log') ?? artifacts[0];
  if (!best) return unattributable('log', `实例目录下没有找到任何崩溃产物：${instanceDir}`);
  return analyzeCrashFile(best.file);
}
