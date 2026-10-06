import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  analyzeCrashFile,
  analyzeCrashReport,
  attributeNewestArtifact,
  listCrashArtifacts,
} from './crash-attribution.js';

/* ------------------------------------------------------------------------- *
 * 真实形状的样本（照 MC 实际产物写，不臆造格式）
 * ------------------------------------------------------------------------- */

/** Forge 1.12 形状：header + 异常栈 + `Caused by:` 链 + `-- System Details --` + `-- Mods --`。 */
const FORGE_CRASH = `---- Minecraft Crash Report ----
// Do not remove or edit this line, it is a signature

Time: 2026-02-01T12:00:00+08:00
Description: Exception in server tick loop

java.lang.NullPointerException: Cannot invoke "net.minecraft.world.level.block.BlockBehaviour$BlockStateBase.getBlock()" because "state" is null
	at TRANSFORMER/example.common.util.TickHelper.push(TickHelper.java:64)
	at TRANSFORMER/moda.block.ModMachineBlock.tick(ModMachineBlock.java:88)
Caused by: com.example.moda.core.Explosion: 机器炸了
	at com.example.moda.core.Boom.<init>(Boom.java:20)
	... 12 more

-- System Details --
Details:
	Brand: Example
	Minecraft Version: 1.12.2
	Operating System: Windows 10
-- Mods --
	id: modb  version: 2.0.0  File: /game/mods/modb-2.0.0.jar
	id: moda  version: 1.2.3  File: /game/mods/moda-1.2.3.jar
`;

/** 同一个报告，但栈里没有任何 Mod 类：只有「谁在场」，没有「谁炸的」。 */
const FORGE_CRASH_NO_STACK_EVIDENCE = `---- Minecraft Crash Report ----

Time: 2026-02-01T12:00:00+08:00
Description: Something bad happened

java.lang.NullPointerException: Cannot invoke "x" because "y" is null
	at net.minecraft.world.level.Level.tick(Level.java:412)
	at TRANSFORMER/modb.tick.TheRest.doAll(TheRest.java:9)

-- System Details --
-- Mods --
	id: modb  version: 2.0.0  File: /game/mods/modb-2.0.0.jar
	id: moda  version: 1.2.3  File: /game/mods/moda-1.2.3.jar
`;

/** Fabric 形状：顶部 `Fabric Mods:` + 标准 crash-report。 */
const FABRIC_CRASH = `---- Minecraft Crash Report ----
// This doesn't make any sense!

Time: 2026-02-01T12:00:00+08:00
Description: Exception in server tick loop

Fabric Mods:
	alternate-current: 1.1.0
	polyfabric: 1.0.5

java.lang.RuntimeException: Mod crashed!
	at net.fabricmc.loader.impl.launch.knot.KnotClassLoader.loadClass(KnotClassLoader.java:314)
	at net.polymeta.alternate_current.wire.WireNetworkManager.register(WireNetworkManager.java:41)

-- System Details --
	Minecraft Version: 1.20.1
`;

/** Fabric 形状：只有 `Fabric Mods:`，栈里全是平台类。 */
const FABRIC_CRASH_NO_STACK_EVIDENCE = `---- Minecraft Crash Report ----

Fabric Mods:
	alternate-current: 1.1.0
	polyfabric: 1.0.5

java.lang.RuntimeException: Mod crashed!
	at net.minecraft.client.Minecraft.run(Minecraft.java:1099)
	at net.minecraft.client.main.Main.main(Main.java:205)

-- System Details --
	Minecraft Version: 1.20.1
`;

/** hs_err 形状：`Command Line:` + `Libraries:` + `Java frames:`。 */
const HS_ERR = `#  EXCEPTION_ACCESS_VIOLATION (0xc0000005)
#  Problematic frame:
#  C  [jvm.dll+0x00000000000a1b2c]  jni_GetArrayLength

Command Line: (java) -Xmx4G -Djava.library.path=C:\\game\\natives -cp C:\\game\\versions\\1.20.1\\1.20.1.jar;C:\\game\\libraries\\org\\lwjgl\\lwjgl\\3.3.1\\lwjgl-3.3.1.jar;C:\\game\\mods\\jei_1.20-1.0.0.jar;C:\\game\\mods\\machine-tools-3.2.1.jar net.minecraft.client.main.Main

java_command: C:\\Program Files\\Java\\bin\\java.exe -Xmx4G -cp C:\\game\\mods\\machine-tools-3.2.1.jar net.minecraft.client.main.Main

Libraries:
 L0: C:\\game\\libraries\\org\\lwjgl\\lwjgl\\3.3.1\\lwjgl-3.3.1.jar (file: C:\\game\\libraries\\org\\lwjgl\\lwjgl\\3.3.1\\lwjgl-3.3.1.jar)
 L1: C:\\game\\mods\\jei_1.20-1.0.0.jar (file: C:\\game\\mods\\jei_1.20-1.0.0.jar)

Current thread 0x00007ffe1234 (main)

Java frames:
 j  org.lwjgl.system.JNI.<init>(Unknown Source)
 j  net.minecraft.client.main.Main.main(Unknown Source)
`;

/** hs_err 形状：Java frames 里有 Mod 类。 */
const HS_ERR_MOD_FRAME = `#  EXCEPTION_ACCESS_VIOLATION (0xc0000005)

Command Line: (java) -Xmx4G -cp C:\\game\\libraries\\org\\lwjgl\\lwjgl\\3.3.1\\lwjgl-3.3.1.jar;C:\\game\\mods\\jei_1.20-1.0.0.jar;C:\\game\\mods\\machine-tools-3.2.1.jar net.minecraft.client.main.Main

Libraries:
 L0: C:\\game\\mods\\jei_1.20-1.0.0.jar (file: C:\\game\\mods\\jei_1.20-1.0.0.jar)

Java frames:
 j  com.codinghorror.machinetools.block.MinerCrasher.tick(MinerCrasher.java:42)
 j  net.minecraft.world.level.Level.tick(Level.java:412)
`;

/** latest.log 形状：Fabric 加载列表 + 带时间戳前缀的异常栈。 */
const LATEST_LOG = `[12:00:00] [main/INFO]: Loading 2 mods:
[12:00:00] [main/INFO]: 	- jei 15.0.0
[12:00:00] [main/INFO]: 	- mapa 1.2.3
[12:00:01] [main/INFO]: Environment: Environment[sessionHost=https://sessionserver.mojang.com]
[12:00:05] [Render thread/ERROR]: java.lang.IllegalStateException: Registry sync failed
[12:00:05] [Render thread/ERROR]: 	at net.minecraft.client.Minecraft.run(Minecraft.java:1148)
[12:00:05] [Render thread/ERROR]: Caused by: xyz.jns.mapa.WaypointRegistry.bake(WaypointRegistry.java:51)
[12:00:05] [Render thread/ERROR]: 	at xyz.jns.mapa.Waypoint.<init>(Waypoint.java:12)
`;

/* ------------------------------------------------------------------------- *
 * 测试
 * ------------------------------------------------------------------------- */

describe('崩溃归因 · crash-report（-- Mods --）', () => {
  it('栈里命中 moda 包名 → suspect=moda 且 evidence 非空', () => {
    const r = analyzeCrashReport(FORGE_CRASH, { file: 'crash-2026-02-01-1-client.txt' });

    expect(r.kind).toBe('crash-report');
    expect(r.format).toBe('minecraft-crash-report');
    expect(r.status).toBe('attributed');
    expect(r.exception).toBe('java.lang.NullPointerException');
    expect(r.message).toContain('because "state" is null');

    // 已加载列表（在场 ≠ 元凶）
    expect(r.loadedMods.map((m) => m.modId).sort()).toEqual(['moda', 'modb']);
    expect(r.loadedMods.find((m) => m.modId === 'moda')).toEqual({
      modId: 'moda',
      version: '1.2.3',
      file: '/game/mods/moda-1.2.3.jar',
      origin: 'mods-section',
    });

    // 归因
    expect(r.suspect).not.toBeNull();
    expect(r.suspect?.modId).toBe('moda');
    expect(r.suspect?.basis).toBe('stack-trace');
    expect(r.suspect?.confidence).toBe('medium');
    expect(r.suspect?.inLoadedList).toBe(true);
    // 要求 2：判据必须可解释
    expect(r.suspect?.evidence.length).toBeGreaterThan(0);
    expect(r.evidence.length).toBeGreaterThan(0);
    expect(r.evidence.join('\n')).toContain('moda');
    // Caused by 链里的 Mod 类是直接判据
    expect(r.evidence.join('\n')).toContain('com.example.moda.core.Explosion');
    expect(r.reason).toBeNull();
  });

  // ⚠ 钉住设计要求 3：只有加载列表、没有直接判据 → 绝不给 suspect。
  it('只有加载列表没有判据 → suspect 必须为 null，只给 candidates（钉住要求③）', () => {
    const r = analyzeCrashReport(FORGE_CRASH_NO_STACK_EVIDENCE);

    expect(r.suspect).toBeNull();
    expect(r.status).toBe('candidates-only');
    expect(r.candidates.map((c) => c.modId).sort()).toEqual(['moda', 'modb']);
    expect(r.loadedMods).toHaveLength(2);
    expect(r.reason).toContain('仅加载列表');
    expect(r.reason).toContain('无法定位元凶');
    expect(r.evidence.length).toBeGreaterThan(0);
    expect(r.evidence.join('\n')).toContain('没有任何直接判据');
  });

  it('栈里只有平台类 → 不把 vanilla 类算到任何 Mod 头上（modId 叫 client 也不扣帽子）', () => {
    const report = `---- Minecraft Crash Report ----
java.lang.NullPointerException: tick
	at net.minecraft.client.Minecraft.run(Minecraft.java:1099)
-- Mods --
	id: client  version: 1.0  File: /game/mods/client.jar
`;
    const r = analyzeCrashReport(report);
    expect(r.suspect).toBeNull();
    expect(r.status).toBe('candidates-only');
    expect(r.candidates.map((c) => c.modId)).toEqual(['client']);
  });

  it('同分命中 → 不猜，candidates 列出全部同分 Mod', () => {
    const report = `---- Minecraft Crash Report ----
java.lang.RuntimeException: boom
	at a.b.alpha.DoIt.run(DoIt.java:1)
	at a.b.beta.Other.go(Other.java:2)
-- Mods --
	id: alpha  version: 1.0  File: /game/mods/alpha.jar
	id: beta  version: 1.0  File: /game/mods/beta.jar
`;
    const r = analyzeCrashReport(report);
    expect(r.suspect).toBeNull();
    expect(r.candidates.map((c) => c.modId).sort()).toEqual(['alpha', 'beta']);
    expect(r.reason).toContain('同分');
  });

  it('1.13+ Forge 的 `Mod List:` + `files:` 也能解析出已加载列表', () => {
    const report = `---- Minecraft Crash Report ----
java.lang.NullPointerException: x
-- System Details --
	Mod List:
		mapa 1.2.3 files: [mapa-1.2.3.jar]
		jei 15.0.0 files: [jei-15.0.0.jar]
`;
    const r = analyzeCrashReport(report);
    expect(r.loadedMods.map((m) => `${m.modId}@${m.version}`).sort()).toEqual([
      'jei@15.0.0',
      'mapa@1.2.3',
    ]);
    expect(r.loadedMods.find((m) => m.modId === 'mapa')?.file).toBe('mapa-1.2.3.jar');
    expect(r.suspect).toBeNull();
  });

  it('消息里的类引用（NoClassDefFoundError a/b/C）算直接判据', () => {
    const report = `---- Minecraft Crash Report ----
java.lang.NoClassDefFoundError: com/example/modb/block/BlockMissing
	at net.minecraft.server.MinecraftServer.tick(MinecraftServer.java:812)
-- Mods --
	id: modb  version: 2.0.0  File: /game/mods/modb-2.0.0.jar
`;
    const r = analyzeCrashReport(report);
    expect(r.suspect?.modId).toBe('modb');
    expect(r.evidence.join('\n')).toContain('com.example.modb.block.BlockMissing');
  });

  it('Caused by 里的 Mod 类优先级高于其它 Mod 的单次栈帧', () => {
    const report = `---- Minecraft Crash Report ----
java.lang.RuntimeException: outer
	at x.y.modc.Helper.go(Helper.java:1)
Caused by: x.y.moda.Boom: inner
	at x.y.moda.Boom.<init>(Boom.java:2)
-- Mods --
	id: modc  version: 1.0  File: /game/mods/modc.jar
	id: moda  version: 1.0  File: /game/mods/moda.jar
`;
    const r = analyzeCrashReport(report);
    expect(r.suspect?.modId).toBe('moda');
  });

  it('Mixin 崩溃的 `Mod File:` 指示 → basis=mod-file + confidence=high', () => {
    const report = `---- Minecraft Crash Report ----
org.spongepowered.asm.mixin.transformer.errors.MixinApplyError: Mixin apply failed
	at org.spongepowered.asm.mixin.transformer.ClassInfo.writeClass(ClassInfo.java:509)
	at x.y.mapa.mixin.MixinFoo$1.apply(MixinFoo.java:17)
Mod File: mapa-1.2.3.jar

-- System Details --
	Mod List:
		mapa 1.2.3 files: [mapa-1.2.3.jar]
		jei 15.0.0 files: [jei-15.0.0.jar]
`;
    const r = analyzeCrashReport(report);
    expect(r.suspect?.modId).toBe('mapa');
    expect(r.suspect?.basis).toBe('mod-file');
    expect(r.suspect?.confidence).toBe('high');
    expect(r.suspect?.inLoadedList).toBe(true);
  });

  it('报告显式 `Suspected Mods:` → basis=report-hint，即使该 Mod 不在加载列表里', () => {
    const report = `---- Minecraft Crash Report ----
Suspected Mods: ghostmod
java.lang.RuntimeException: boom
-- Mods --
	id: moda  version: 1.0  File: /game/mods/moda.jar
`;
    const r = analyzeCrashReport(report);
    expect(r.suspect?.modId).toBe('ghostmod');
    expect(r.suspect?.basis).toBe('report-hint');
    expect(r.suspect?.confidence).toBe('high');
    expect(r.suspect?.inLoadedList).toBe(false);
    expect(r.signals).toContain('Suspected Mods:');
  });
});

describe('崩溃归因 · Fabric crash-report', () => {
  it('`Fabric Mods:` 段能出候选，栈命中包名时给出 suspect', () => {
    const r = analyzeCrashReport(FABRIC_CRASH);
    expect(r.format).toBe('fabric-crash-report');
    expect(r.loadedMods.map((m) => `${m.modId}@${m.version}`).sort()).toEqual([
      'alternate-current@1.1.0',
      'polyfabric@1.0.5',
    ]);
    expect(r.suspect?.modId).toBe('alternate-current');
    expect(r.suspect?.inLoadedList).toBe(true);
  });

  it('只有 `Fabric Mods:` 而栈里只有平台类 → 只给 candidates，不给 suspect', () => {
    const r = analyzeCrashReport(FABRIC_CRASH_NO_STACK_EVIDENCE);
    expect(r.suspect).toBeNull();
    expect(r.status).toBe('candidates-only');
    expect(r.candidates.map((c) => c.modId).sort()).toEqual(['alternate-current', 'polyfabric']);
    expect(r.reason).toContain('仅加载列表');
  });
});

describe('崩溃归因 · hs_err_pid*.log', () => {
  it('`Libraries:` + `Command Line:` → 解析出已加载 jar，只有平台帧时不给 suspect', () => {
    const r = analyzeCrashReport(HS_ERR, { file: 'hs_err_pid1234.log' });
    expect(r.kind).toBe('hs_err');
    expect(r.format).toBe('hs_err');
    expect(r.loadedMods.map((m) => m.modId).sort()).toEqual([
      'jei_1.20-1.0.0.jar',
      'machine-tools-3.2.1.jar',
    ]);
    expect(r.loadedMods[0]?.file).toMatch(/mods\\/);
    expect(r.suspect).toBeNull();
    expect(r.status).toBe('candidates-only');
    expect(r.reason).toContain('仅加载列表');
  });

  it('`Java frames:` 里出现 Mod 包名 → 归因到对应 jar', () => {
    const r = analyzeCrashReport(HS_ERR_MOD_FRAME, { file: 'hs_err_pid4321.log' });
    expect(r.suspect?.modId).toBe('machine-tools-3.2.1.jar');
    expect(r.suspect?.basis).toBe('stack-trace');
    expect(r.evidence.join('\n')).toContain('machinetools');
  });

  it('只有 Libraries 段、没有 Command Line 也能工作（缺段不炸）', () => {
    const r = analyzeCrashReport('Libraries:\n L0: /g/mods/solo.jar (file: /g/mods/solo.jar)\n');
    expect(r.loadedMods.map((m) => m.modId)).toEqual(['solo.jar']);
    expect(r.suspect).toBeNull();
  });
});

describe('崩溃归因 · latest.log', () => {
  it('带时间戳前缀的异常栈 + `Loading N mods:` → suspect=命中包名的 Mod', () => {
    const r = analyzeCrashReport(LATEST_LOG, { file: 'latest.log' });
    expect(r.kind).toBe('log');
    expect(r.format).toBe('game-log');
    expect(r.exception).toBe('java.lang.IllegalStateException');
    expect(r.loadedMods.map((m) => `${m.modId}@${m.version}`).sort()).toEqual([
      'jei@15.0.0',
      'mapa@1.2.3',
    ]);
    expect(r.suspect?.modId).toBe('mapa');
    expect(r.evidence.join('\n')).toContain('xyz.jns.mapa');
  });

  it('latest.log 只有异常栈、没有 Mods 段 → 无法把类名映射到 modId，明确说不知道', () => {
    const r = analyzeCrashReport(
      `[12:00:05] [Render thread/ERROR]: java.lang.IllegalStateException: boom
[12:00:05] [Render thread/ERROR]: 	at xyz.jns.mapa.Waypoint.<init>(Waypoint.java:12)
`,
    );
    expect(r.suspect).toBeNull();
    expect(r.status).toBe('unattributable');
    expect(r.reason).toContain('缺少已加载 Mod 列表');
    expect(r.evidence.join('\n')).toContain('xyz.jns.mapa.Waypoint');
  });
});

describe('崩溃归因 · 容错（核心风险：解析器崩）', () => {
  it('空串 / 纯空白 / 垃圾文本都不抛，且一律无法归因', () => {
    for (const text of [
      '',
      '   \n\t\n  ',
      '??????\n%%%%%%\n@@@@',
      '这是一段普通中文日志，不是崩溃报告。',
    ]) {
      const r = analyzeCrashReport(text);
      expect(r.suspect).toBeNull();
      expect(r.status).toBe('unattributable');
      expect(r.reason).toBeTruthy();
      expect(r.evidence.length).toBeGreaterThan(0);
    }
  });

  it('二进制/控制字符/超长行/未闭合段落都不抛', () => {
    const nasty = [
      '\u0000\u0001\u0002\uFFFD\uFEFF',
      `-- Mods --\n\u0000 id: \u0000 version:`,
      `at ${'a'.repeat(5000)}.B.c(D.java:1)`,
      `Command Line: ${';'.repeat(500)}`,
      `Libraries:\n${'L1: /g/mods/x.jar (file: /g/mods/x.jar)\n'.repeat(50)}`,
      '---- Minecraft Crash Report ----\n-- Mods --',
    ].join('\n');
    const r = analyzeCrashReport(nasty);
    expect(['attributed', 'candidates-only', 'unattributable']).toContain(r.status);
  });

  it('截断到任意长度都不抛（逐段截断扫一遍）', () => {
    const sources = [FORGE_CRASH, FABRIC_CRASH, HS_ERR, LATEST_LOG];
    for (const src of sources) {
      for (let i = 0; i < src.length; i += 37) {
        const r = analyzeCrashReport(src.slice(0, i));
        expect(['attributed', 'candidates-only', 'unattributable']).toContain(r.status);
        expect(Array.isArray(r.loadedMods)).toBe(true);
      }
    }
  });

  it('非字符串入参（JS 调用方传了 undefined）不抛', () => {
    const r = analyzeCrashReport(undefined as unknown as string);
    expect(r.suspect).toBeNull();
    expect(r.status).toBe('unattributable');
  });
});

describe('崩溃归因 · 文件读取薄层', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });
  const mkTmp = (): string => {
    const d = mkdtempSync(join(tmpdir(), 'crash-attr-'));
    dirs.push(d);
    return d;
  };

  it('列出实例目录下 crash-reports / hs_err_pid / logs 三类产物，按 mtime 新→旧', () => {
    const dir = mkTmp();
    mkdirSync(join(dir, 'crash-reports'), { recursive: true });
    mkdirSync(join(dir, 'logs'), { recursive: true });
    const crashFile = join(dir, 'crash-reports', 'crash-2026-02-01-1-client.txt');
    const hsFile = join(dir, 'hs_err_pid1234.log');
    const logFile = join(dir, 'logs', 'latest.log');
    writeFileSync(crashFile, FORGE_CRASH);
    writeFileSync(hsFile, HS_ERR);
    writeFileSync(logFile, LATEST_LOG);
    // 固定 mtime，避免不同平台时间精度导致的顺序抖动
    utimesSync(crashFile, 3_000_000, 3_000_000);
    utimesSync(hsFile, 2_000_000, 2_000_000);
    utimesSync(logFile, 1_000_000, 1_000_000);

    const list = listCrashArtifacts(dir);
    expect(list.map((a) => a.kind)).toEqual(['crash-report', 'hs_err', 'log']);
    expect(list.map((a) => a.name)).toEqual([
      'crash-2026-02-01-1-client.txt',
      'hs_err_pid1234.log',
      'latest.log',
    ]);
    expect(list[0]?.origin).toBe('crash-reports');
    expect(list[2]?.origin).toBe('logs/latest.log');

    // 单文件归因
    expect(analyzeCrashFile(crashFile).suspect?.modId).toBe('moda');
    expect(analyzeCrashFile(hsFile).kind).toBe('hs_err');

    // 最新产物：crash-report 优先于 latest.log
    const newest = attributeNewestArtifact(dir);
    expect(newest.suspect?.modId).toBe('moda');
    expect(newest.status).toBe('attributed');
  });

  it('实例目录不存在 / 产物不可读 → 返回无法归因，不抛', () => {
    expect(listCrashArtifacts(join(tmpdir(), 'definitely-not-here-9f3a'))).toEqual([]);
    const r = attributeNewestArtifact(join(tmpdir(), 'definitely-not-here-9f3a'));
    expect(r.status).toBe('unattributable');
    expect(r.suspect).toBeNull();
    expect(r.reason).toContain('没有找到任何崩溃产物');

    const missing = analyzeCrashFile(join(tmpdir(), 'nope-9f3a', 'crash-x.txt'));
    expect(missing.status).toBe('unattributable');
    expect(missing.reason).toContain('不可读');
  });
});
