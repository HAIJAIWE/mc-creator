/**
 * gradle-warmup.ts 测试（按需预热 ForgeGradle 缓存）。
 *
 * 全注入、**绝不联网、绝不真跑 Gradle**（风格照 gradle-bootstrap.test.ts）：
 * - runGradle 注入（假构建：一行 BUILD SUCCESSFUL 就返回，不 spawn 任何进程）；
 * - fs 注入（记录型 fake：既验证「清理真的被调用了」，又能断言「用户工程一个字节没动」）；
 * - existsSyncImpl 注入（forge_gradle 缓存命中与否）；now 注入（elapsedMs 可确定断言）；
 * - platform 注入（win32/posix 的 bin/gradle.bat 之分）。
 * 唯一用真 fs 的是最后一个用例（证明默认真实实现能跑通），它同样不碰 Gradle。
 */
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GradleTaskOutcome, GradleTaskRequest } from './gradle-bootstrap.js';
import {
  DEFAULT_FORGEGRADLE_VERSION,
  DEFAULT_WARMUP_JAVA_VERSION,
  DEFAULT_WARMUP_TASKS,
  forgeGradleCacheVersionDir,
  isPathInside,
  isValidForgeVersion,
  isValidMcVersion,
  probeForgeGradleCache,
  renderWarmupProjectFiles,
  warmForgeGradleCache,
  type GradleWarmupResult,
  type WarmForgeGradleOptions,
  type WarmupFs,
} from './gradle-warmup.js';

const dirs: string[] = [];

afterEach(async () => {
  for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true });
});

async function mkTmp(prefix: string): Promise<string> {
  const d = await mkdtemp(join(tmpdir(), prefix));
  dirs.push(d);
  return d;
}

/* ------------------------------------------------------------------ *
 * 夹具
 * ------------------------------------------------------------------ */

interface FsCalls {
  mkdtemp: string[];
  mkdir: string[];
  writeFile: string[];
  rm: string[];
}

interface FsWrite {
  path: string;
  content: string;
}

/** 记录型 fake fs：把「清理被调用」「没碰用户工程」变成可断言的事实。 */
function fakeFs(
  opts: {
    mkdtempResult?: string;
    mkdtempThrows?: Error;
    writeThrows?: Error;
    rmThrows?: Error;
  } = {},
): { fs: WarmupFs; calls: FsCalls; files: Map<string, string>; writes: FsWrite[] } {
  const calls: FsCalls = { mkdtemp: [], mkdir: [], writeFile: [], rm: [] };
  const files = new Map<string, string>();
  // writes 是「写下去过什么」的流水账，不像 files 那样被 rm 抹掉 —— 断言用内容用它。
  const writes: FsWrite[] = [];
  const fsOps: WarmupFs = {
    async mkdtemp(prefix) {
      calls.mkdtemp.push(prefix);
      if (opts.mkdtempThrows !== undefined) throw opts.mkdtempThrows;
      return opts.mkdtempResult ?? `${prefix}WARM01`;
    },
    async mkdir(dir) {
      calls.mkdir.push(dir);
    },
    async writeFile(path, content) {
      calls.writeFile.push(path);
      writes.push({ path, content });
      if (opts.writeThrows !== undefined) throw opts.writeThrows;
      files.set(path, content);
    },
    async rm(path) {
      calls.rm.push(path);
      if (opts.rmThrows !== undefined) throw opts.rmThrows;
      // 真的删掉该目录下的内容（跟 rm -rf 一致），这样「跑完就干净」是可断言的
      for (const k of [...files.keys()])
        if (k === path || k.startsWith(path + '\\')) files.delete(k);
    },
  };
  return { fs: fsOps, calls, files, writes };
}

/** 假构建：立刻返回，绝不 spawn。onRun 可在「构建过程中」改状态（模拟中断）。 */
function fakeRun(
  outcome: Partial<GradleTaskOutcome> = {},
  onRun?: (req: GradleTaskRequest) => void,
): (req: GradleTaskRequest) => Promise<GradleTaskOutcome> {
  return async (req) => {
    onRun?.(req);
    return {
      ok: true,
      exitCode: 0,
      log: '> Task :compileJava\nBUILD SUCCESSFUL in 3m 14s',
      ...outcome,
    };
  };
}

/** 可控时钟：让 elapsedMs 与进度文案变成确定值（不依赖真实时间）。 */
function fakeClock(): { now: () => number; advance: (ms: number) => void } {
  let value = 0;
  return {
    now: () => value,
    advance: (ms) => {
      value += ms;
    },
  };
}

const CWD = join(tmpdir(), 'mc-creator-warmup-WARM01');
const GRADLE_HOME = join(tmpdir(), 'gradle-dist-8.12');
const PROJECT = join(tmpdir(), 'my-mod-project');

/** 缺省注入：永命中「未预热」+ 永不 spawn + 记录 fs。 */
function baseOpts(extra: Partial<WarmForgeGradleOptions> = {}): {
  calls: FsCalls;
  writes: FsWrite[];
  files: Map<string, string>;
  runGradle: ReturnType<typeof vi.fn>;
  progress: string[];
  opts: WarmForgeGradleOptions;
} {
  const { fs, calls, files, writes } = fakeFs();
  const runGradle = vi.fn(fakeRun());
  const progress: string[] = [];
  const clock = fakeClock();
  const opts: WarmForgeGradleOptions = {
    mcVersion: '1.20.1',
    forgeVersion: '47.4.23',
    gradleHome: GRADLE_HOME,
    platform: 'win32',
    fs,
    runGradle,
    existsSyncImpl: () => false,
    now: clock.now,
    onProgress: (m: string) => progress.push(m),
    ...extra,
  };
  return { calls, files, writes, runGradle, progress, opts };
}

/** 取失败原因（成功结果上没有 error，用窄化换取可读性）。 */
function errOf(r: GradleWarmupResult): string {
  if (r.ok) throw new Error('期望失败结果，实际成功');
  return r.error;
}
function codeOf(r: GradleWarmupResult): string {
  if (r.ok) throw new Error('期望失败结果，实际成功');
  return r.code;
}

describe('纯函数：缓存探测（要求⑥ 的判据）', () => {
  it('探测路径 = 本机实测的 forge_gradle 目录形状', () => {
    const dir = forgeGradleCacheVersionDir(join('C:', 'Users', 'me', '.gradle'), '1.20.1');
    expect(dir).toBe(
      join(
        'C:',
        'Users',
        'me',
        '.gradle',
        'caches',
        'forge_gradle',
        'minecraft_repo',
        'versions',
        '1.20.1',
      ),
    );
  });

  it('目录存在 → warm=true；不存在 → warm=false（只用 existsSync，不递归统计 385MB）', () => {
    const hit = probeForgeGradleCache({
      gradleUserHome: join('G', 'uh'),
      mcVersion: '1.20.1',
      existsSyncImpl: (p) => p.endsWith(join('versions', '1.20.1')),
    });
    expect(hit.warm).toBe(true);
    expect(hit.probePath).toContain(join('forge_gradle', 'minecraft_repo', 'versions', '1.20.1'));

    const miss = probeForgeGradleCache({
      gradleUserHome: join('G', 'uh'),
      mcVersion: '1.21.1',
      existsSyncImpl: () => false,
    });
    expect(miss.warm).toBe(false);
    // 换个 MC 版本 → 换目录（这正是「按需预热用户选的那一个」的判据）
    expect(miss.probePath).toContain(join('versions', '1.21.1'));
  });

  it('版本形状校验：挡住会污染文件路径的 ../ 与文本注入', () => {
    expect(isValidMcVersion('1.20.1')).toBe(true);
    expect(isValidMcVersion(' 1.21 ')).toBe(true);
    expect(isValidMcVersion('1.7.10')).toBe(true);
    expect(isValidMcVersion('../../evil')).toBe(false);
    expect(isValidMcVersion('1.20.1\nrm -rf')).toBe(false);
    expect(isValidMcVersion('')).toBe(false);
    expect(isValidMcVersion(undefined as never)).toBe(false);

    expect(isValidForgeVersion('47.4.23')).toBe(true);
    expect(isValidForgeVersion('1.7.10-10.13.4.1614-1.12.2')).toBe(true);
    expect(isValidForgeVersion('47.4.23"\ndependencies {')).toBe(false);
    expect(isValidForgeVersion('')).toBe(false);
  });

  it('isPathInside：临时目录不能落在工程内（要求① 的拒绝式保护判据）', () => {
    expect(isPathInside(join(PROJECT, 'warm-1'), PROJECT)).toBe(true);
    expect(isPathInside(PROJECT, PROJECT)).toBe(true);
    expect(isPathInside(join(PROJECT, '..', 'other'), PROJECT)).toBe(false);
    expect(isPathInside(CWD, PROJECT)).toBe(false);
    // 真的越界（少一层）
    expect(isPathInside(join(PROJECT, '..'), PROJECT)).toBe(false);
    expect(isPathInside(join(PROJECT, 'a', '..', '..', 'b'), PROJECT)).toBe(false);
    // 子目录名以 '..' 开头（`..foo`）：路径段意义上的 '..' 只看整段，不是前缀匹配。
    // 旧写法 startsWith('..') 会把它判成「不在里面」→ 放过一次本该被拦下的预热。
    expect(isPathInside(join(PROJECT, '..foo'), PROJECT)).toBe(true);
    expect(isPathInside(join(PROJECT, '..foo', 'warm-1'), PROJECT)).toBe(true);
    // 相对路径输入也要能判
    expect(isPathInside(join(PROJECT, 'a', 'b'), join(PROJECT, 'a'))).toBe(true);
    expect(isPathInside(join(PROJECT, 'a'), join(PROJECT, 'b'))).toBe(false);
  });
});

describe('纯函数：预热工程渲染（要求② 的最小工程，4 个文件）', () => {
  const files = renderWarmupProjectFiles({ mcVersion: '1.20.1', forgeVersion: '47.4.23' });
  const at = (p: string): string => files.find((f) => f.path === p)?.content ?? '';

  it('文件清单：settings/build/gradle.properties + 一个占位类', () => {
    expect(files.map((f) => f.path)).toEqual([
      'settings.gradle',
      'build.gradle',
      'gradle.properties',
      'src/main/java/com/mccreator/warmup/Warmup.java',
    ]);
  });

  it('settings.gradle 带 foojay toolchain 解析器与 Forge maven（少任一条都构建不了）', () => {
    // forge-gradle.ts:26-28 实测：缺 foojay 会报 “No locally installed toolchains match”，
    // 那行报错长得很像依赖问题，极具误导性。
    expect(at('settings.gradle')).toContain('org.gradle.toolchains.foojay-resolver-convention');
    // forge-gradle.ts:120-134：ForgeGradle 不在 Gradle Portal，只能靠这个仓库解析
    expect(at('settings.gradle')).toContain('maven { url "https://maven.minecraftforge.net/" }');
  });

  it('build.gradle 指向目标 MC/Forge，且 toolchain 与生成器一致（17）', () => {
    expect(at('build.gradle')).toContain(
      `id 'net.minecraftforge.gradle' version '${DEFAULT_FORGEGRADLE_VERSION}'`,
    );
    expect(at('build.gradle')).toContain("mappings channel: 'official', version: '1.20.1'");
    expect(at('build.gradle')).toContain("minecraft 'net.minecraftforge:forge:1.20.1-47.4.23'");
    expect(at('build.gradle')).toContain(
      `java.toolchain.languageVersion = JavaLanguageVersion.of(${DEFAULT_WARMUP_JAVA_VERSION})`,
    );
    // 刻意不放的东西：不启动游戏、不生成 wrapper（要求② 省掉重复下载发行版）
    expect(at('build.gradle')).not.toContain('runs {');
    expect(at('settings.gradle')).not.toContain('distributionUrl');
  });

  it('版本可覆盖（不同 MC 版本走不同 toolchain 时由调用方决定）', () => {
    const f = renderWarmupProjectFiles({
      mcVersion: '1.21.1',
      forgeVersion: '47.4.23',
      forgeGradleVersion: '6.0.99',
      javaVersion: 21,
    });
    expect(f.find((x) => x.path === 'build.gradle')?.content).toContain(
      "minecraft 'net.minecraftforge:forge:1.21.1-47.4.23'",
    );
    expect(f.find((x) => x.path === 'build.gradle')?.content).toContain('6.0.99');
    expect(f.find((x) => x.path === 'build.gradle')?.content).toContain(
      'JavaLanguageVersion.of(21)',
    );
    expect(f.find((x) => x.path === 'gradle.properties')?.content).toContain('mc_version=1.21.1');
  });
});

describe('① 幂等命中：warmed=false，零 spawn、零临时目录（用户点第二次的热路径）', () => {
  it('调用方已判定已热 → 连 gradleHome 都不要求，一个字节都不写', async () => {
    const { opts, calls, runGradle, progress } = baseOpts({
      alreadyWarm: true,
      gradleHome: '', // 故意不给发行版：热路径不该被参数挡住
    });
    const r = await warmForgeGradleCache(opts);
    expect(r).toMatchObject({ ok: true, warmed: false, aborted: false, tempProjectDir: '' });
    expect(runGradle).not.toHaveBeenCalled();
    expect(calls).toEqual({ mkdtemp: [], mkdir: [], writeFile: [], rm: [] });
    expect(progress.join('\n')).toContain('已就绪');
  });

  it('自己探测到缓存目录存在 → 同样零 spawn、零临时目录', async () => {
    const { opts, calls, runGradle } = baseOpts({
      existsSyncImpl: (p: string) => p.includes(join('forge_gradle', 'minecraft_repo', 'versions')),
      gradleUserHome: join('G', 'uh'),
    });
    const r = await warmForgeGradleCache(opts);
    expect(r).toMatchObject({ ok: true, warmed: false });
    expect(r.log).toContain('minecraft_repo');
    expect(runGradle).not.toHaveBeenCalled();
    expect(calls.mkdtemp).toEqual([]);
    expect(calls.writeFile).toEqual([]);
    expect(calls.rm).toEqual([]);
  });
});

describe('② 未命中：建临时工程 + 跑一次构建 → warmed:true', () => {
  it('完整通路：mkdtemp → 写 4 个文件 → 跑发行版里的 gradle → 清理 → warmed:true', async () => {
    const { opts, calls, files, writes, runGradle, progress } = baseOpts();
    const r = await warmForgeGradleCache(opts);

    expect(r).toMatchObject({ ok: true, warmed: true, aborted: false, tempProjectDir: CWD });
    // 临时目录来自 mkdtemp（前缀带 mc-creator-warmup-），不是调用方给的任何路径
    expect(calls.mkdtemp).toHaveLength(1);
    expect(calls.mkdtemp[0]).toContain('mc-creator-warmup-');
    // 4 个文件都落在临时目录里（构建期间在，返回后已删）
    expect(writes).toHaveLength(4);
    expect(writes.every((w) => w.path.startsWith(CWD))).toBe(true);
    expect(writes.map((w) => w.path.split('\\').slice(-1)[0])).toEqual([
      'settings.gradle',
      'build.gradle',
      'gradle.properties',
      'Warmup.java',
    ]);
    expect(writes.find((w) => w.path.endsWith('build.gradle'))?.content).toContain(
      'net.minecraftforge:forge:1.20.1-47.4.23',
    );
    expect(files.size).toBe(0); // 清理真的删干净了

    // 跑的是发行版里的 gradle.bat，cwd = 一次性工程，参数是预热任务
    expect(runGradle).toHaveBeenCalledTimes(1);
    const req = runGradle.mock.calls[0]?.[0] as GradleTaskRequest;
    expect(req.command).toBe(join(GRADLE_HOME, 'bin', 'gradle.bat'));
    expect(req.cwd).toBe(CWD);
    expect(req.args).toEqual([...DEFAULT_WARMUP_TASKS]);
    expect(req.args).toContain('build'); // 与生成器真工程同一条任务链
    expect(req.platform).toBe('win32');

    // 清理被调用，且只删自己那个一次性目录（要求③）
    expect(calls.rm).toEqual([CWD]);

    // 结果里带日志与耗时
    expect(r.log).toContain('BUILD SUCCESSFUL in 3m 14s');
    expect(r.log).toContain('一次性工程');
    expect(r.elapsedMs).toBeGreaterThanOrEqual(0);
    expect(progress.length).toBeGreaterThanOrEqual(3);
  });

  it('耗时用注入的时钟算（假装构建花了 194 秒 = 实测冷启 3m14s）', async () => {
    const clock = fakeClock();
    const { fs } = fakeFs();
    const r = await warmForgeGradleCache({
      mcVersion: '1.20.1',
      forgeVersion: '47.4.23',
      gradleHome: GRADLE_HOME,
      platform: 'win32',
      fs,
      runGradle: fakeRun({}, () => {
        clock.advance(194_000);
      }),
      existsSyncImpl: () => false,
      now: clock.now,
    });
    expect(r).toMatchObject({ ok: true, warmed: true });
    expect(r.elapsedMs).toBeGreaterThanOrEqual(194_000);
  });

  it('tmpRoot 由调用方指定时，临时目录建在它下面（父目录会被先建出来）', async () => {
    const tmpRoot = await mkTmp('mc-warmup-root-');
    const { opts, calls } = baseOpts({ tmpRoot: join(tmpRoot, 'nested', 'not-exists-yet') });
    const r = await warmForgeGradleCache(opts);
    expect(r.ok).toBe(true);
    expect(calls.mkdir).toContain(join(tmpRoot, 'nested', 'not-exists-yet'));
    expect(calls.mkdtemp[0]).toContain(join('not-exists-yet', 'mc-creator-warmup-'));
  });

  it('posix 平台跑的是 bin/gradle（不是 .bat），任务参数可覆盖', async () => {
    const { opts, runGradle } = baseOpts({
      platform: 'linux',
      tasks: ['build', '--no-daemon'],
    });
    const r = await warmForgeGradleCache(opts);
    expect(r.ok).toBe(true);
    const req = runGradle.mock.calls[0]?.[0] as GradleTaskRequest;
    expect(req.command).toBe(join(GRADLE_HOME, 'bin', 'gradle'));
    expect(req.args).toEqual(['build', '--no-daemon']);
  });

  it('没给 gradleHome → GRADLE_HOME_MISSING（要求②：本模块不下发行版）', async () => {
    const { opts, runGradle, calls } = baseOpts({ gradleHome: '' });
    const r = await warmForgeGradleCache(opts);
    expect(codeOf(r)).toBe('GRADLE_HOME_MISSING');
    expect(errOf(r)).toContain('ensureGradleWrapper');
    expect(runGradle).not.toHaveBeenCalled();
    expect(calls.mkdtemp).toEqual([]);
  });

  it('版本非法 → 早退，一个文件都不写', async () => {
    const { opts, calls, runGradle } = baseOpts({ mcVersion: '../etc/passwd' });
    expect(codeOf(await warmForgeGradleCache(opts))).toBe('MC_VERSION_INVALID');
    const { opts: o2, calls: c2 } = baseOpts({ forgeVersion: '' });
    expect(codeOf(await warmForgeGradleCache(o2))).toBe('FORGE_VERSION_INVALID');
    expect(calls.mkdtemp).toEqual([]);
    expect(c2.writeFile).toEqual([]);
    expect(runGradle).not.toHaveBeenCalled();
  });
});

describe('③ 可中断：结构化结果 + 不留半截临时目录', () => {
  it('进入前就已中断 → ABORTED，连临时目录都不建', async () => {
    const c = new AbortController();
    c.abort();
    const { opts, calls, runGradle } = baseOpts({ signal: c.signal });
    const r = await warmForgeGradleCache(opts);
    expect(r).toMatchObject({ ok: false, warmed: false, aborted: true, code: 'ABORTED' });
    expect(errOf(r)).toContain('取消');
    expect(calls.mkdtemp).toEqual([]);
    expect(runGradle).not.toHaveBeenCalled();
  });

  it('构建中被中断 → ABORTED（不是「构建失败」），且临时目录被清理', async () => {
    const c = new AbortController();
    const { fs, calls } = fakeFs();
    const runGradle = vi.fn(
      fakeRun({ ok: false, exitCode: null, log: '[mc-creator] 预热任务被取消' }, () => {
        c.abort(); // 模拟用户在界面上点了取消
      }),
    );
    const r = await warmForgeGradleCache({
      mcVersion: '1.20.1',
      forgeVersion: '47.4.23',
      gradleHome: GRADLE_HOME,
      platform: 'win32',
      fs,
      runGradle,
      existsSyncImpl: () => false,
      signal: c.signal,
    });
    expect(r).toMatchObject({ ok: false, aborted: true, warmed: false, code: 'ABORTED' });
    expect(calls.rm).toEqual([CWD]); // 不留半截目录
    // signal 一路透给执行器（由 runGradleTask 负责杀整棵树）
    const req = runGradle.mock.calls[0]?.[0] as GradleTaskRequest;
    expect(req.signal).toBe(c.signal);
  });
});

describe('④ 任何一步失败都返回中文原因，不抛裸异常', () => {
  it('构建失败 → BUILD_FAILED，错误里带退出码与日志尾部', async () => {
    const { opts, calls } = baseOpts({
      runGradle: fakeRun({
        ok: false,
        exitCode: 1,
        log: "Execution failed for task ':compileJava'.\n> Could not resolve net.minecraftforge:forge",
      }),
    });
    const r = await warmForgeGradleCache(opts);
    expect(codeOf(r)).toBe('BUILD_FAILED');
    expect(errOf(r)).toContain('exit=1');
    expect(errOf(r)).toContain('Could not resolve');
    expect(r.log).toContain('一次性工程');
    expect(calls.rm).toEqual([CWD]); // 失败也要清理
  });

  it('执行器自己抛异常 → 同样收敛成 BUILD_FAILED（不外泄裸异常）', async () => {
    const { opts } = baseOpts({
      runGradle: async () => {
        throw new Error('spawn ENOENT');
      },
    });
    const r = await warmForgeGradleCache(opts);
    expect(codeOf(r)).toBe('BUILD_FAILED');
    expect(errOf(r)).toContain('spawn ENOENT');
    expect(r.log).toContain('spawn ENOENT');
  });

  it('“Unsupported class file major version 70” 被翻译成 JDK 人话（class = 主版本 + 44）', async () => {
    const { opts } = baseOpts({
      runGradle: fakeRun({
        ok: false,
        exitCode: 1,
        log: "BUG! exception in phase 'semantic analysis' Unsupported class file major version 70",
      }),
    });
    const r = await warmForgeGradleCache(opts);
    expect(errOf(r)).toContain('JDK 过新');
    expect(errOf(r)).toContain('主版本 26'); // 70 - 44 = 26
    expect(errOf(r)).toContain('JDK 25 或更低');
  });

  it('toolchain 缺失那行误导性报错 → 换成「缺 JDK」的话（forge-gradle.ts:26-28 实测原文）', async () => {
    const { opts } = baseOpts({
      runGradle: fakeRun({
        ok: false,
        exitCode: 1,
        log: 'No locally installed toolchains match and toolchain download repositories have not been configured.',
      }),
    });
    expect(errOf(await warmForgeGradleCache(opts))).toContain(
      `缺 Java ${DEFAULT_WARMUP_JAVA_VERSION} 工具链`,
    );
  });

  it('ForgeGradle 插件拉不下来 → 给网络/代理提示', async () => {
    const { opts } = baseOpts({
      runGradle: fakeRun({
        ok: false,
        exitCode: 1,
        log: 'Could not resolve net.minecraftforge.gradle:ForgeGradle\n> Could not GET https://maven.minecraftforge.net/',
      }),
    });
    expect(errOf(await warmForgeGradleCache(opts))).toContain('网络或代理');
  });

  it('写预热工程失败 → PROJECT_WRITE，且临时目录被清理', async () => {
    const { fs, calls } = fakeFs({ writeThrows: new Error('EACCES: permission denied') });
    const r = await warmForgeGradleCache({
      mcVersion: '1.20.1',
      forgeVersion: '47.4.23',
      gradleHome: GRADLE_HOME,
      platform: 'win32',
      fs,
      runGradle: vi.fn(fakeRun()),
      existsSyncImpl: () => false,
    });
    expect(codeOf(r)).toBe('PROJECT_WRITE');
    expect(errOf(r)).toContain('permission denied');
    expect(calls.rm).toEqual([CWD]);
  });

  it('临时目录建不出来 → TEMP_DIR_CREATE，不 spawn', async () => {
    const { fs, calls } = fakeFs({ mkdtempThrows: new Error('ENOSPC: no space left on device') });
    const runGradle = vi.fn(fakeRun());
    const r = await warmForgeGradleCache({
      mcVersion: '1.20.1',
      forgeVersion: '47.4.23',
      gradleHome: GRADLE_HOME,
      platform: 'win32',
      fs,
      runGradle,
      existsSyncImpl: () => false,
    });
    expect(codeOf(r)).toBe('TEMP_DIR_CREATE');
    expect(errOf(r)).toContain('no space left on device');
    expect(runGradle).not.toHaveBeenCalled();
    expect(calls.writeFile).toEqual([]);
  });

  it('清理失败不把成功结果变成异常，只在日志里留一句（用户可手动删）', async () => {
    const { fs } = fakeFs({ rmThrows: new Error('EBUSY: resource busy') });
    const r = await warmForgeGradleCache({
      mcVersion: '1.20.1',
      forgeVersion: '47.4.23',
      gradleHome: GRADLE_HOME,
      platform: 'win32',
      fs,
      runGradle: fakeRun(),
      existsSyncImpl: () => false,
    });
    expect(r).toMatchObject({ ok: true, warmed: true });
    expect(r.log).toContain('清理预热临时目录');
    expect(r.log).toContain('EBUSY');
  });

  it('onProgress 自己抛错也不影响预热结果（调用方 UI 崩了不是预热的错）', async () => {
    const { fs } = fakeFs();
    const r = await warmForgeGradleCache({
      mcVersion: '1.20.1',
      forgeVersion: '47.4.23',
      gradleHome: GRADLE_HOME,
      platform: 'win32',
      fs,
      runGradle: fakeRun(),
      existsSyncImpl: () => false,
      onProgress: () => {
        throw new Error('renderer crashed');
      },
    });
    expect(r).toMatchObject({ ok: true, warmed: true });
  });
});

describe('⑤ 进度可流：这几分钟不能一声不吭', () => {
  it('至少回调三次，且覆盖「准备工程 / 反编译 / 完成」三个阶段', async () => {
    const { opts, progress } = baseOpts();
    await warmForgeGradleCache(opts);
    const all = progress.join('\n');
    expect(progress.length).toBeGreaterThanOrEqual(3);
    expect(all).toContain('准备预热工程');
    expect(all).toContain('反编译 Minecraft 1.20.1');
    expect(all).toContain('请勿关闭窗口'); // 明确告诉用户「不是卡死」
    expect(all).toContain('预热完成');
  });

  it('失败路径也给出进度（用户看到的是「哪一步没成」而不是静默）', async () => {
    const { opts, progress } = baseOpts({ runGradle: fakeRun({ ok: false, exitCode: 1 }) });
    await warmForgeGradleCache(opts);
    expect(progress.join('\n')).toContain('反编译 Minecraft 1.20.1');
    // 失败时不再喊「预热完成」
    expect(progress.join('\n')).not.toContain('预热完成');
  });
});

describe('⑥ 绝不用用户工程做预热', () => {
  it('预热目录在 tmpRoot 之下，不是 projectPath；用户工程一个字节没被写/删', async () => {
    const tmpRoot = await mkTmp('mc-warm-guard-');
    const project = await mkTmp('mc-warm-user-project-');
    await writeFile(join(project, 'build.gradle'), 'ORIGINAL', 'utf8');

    const { fs, calls } = fakeFs({ mkdtempResult: join(tmpRoot, 'mc-creator-warmup-abc123') });
    const r = await warmForgeGradleCache({
      mcVersion: '1.20.1',
      forgeVersion: '47.4.23',
      gradleHome: GRADLE_HOME,
      platform: 'win32',
      tmpRoot,
      projectPath: project,
      fs,
      runGradle: fakeRun(),
      existsSyncImpl: () => false,
    });

    expect(r).toMatchObject({ ok: true, warmed: true });
    expect(r.tempProjectDir).toBe(join(tmpRoot, 'mc-creator-warmup-abc123'));
    expect(r.tempProjectDir).not.toBe(project);
    // 没有一次写/删落在用户工程里
    expect(calls.writeFile.every((p) => p.startsWith(tmpRoot))).toBe(true);
    expect(calls.rm.every((p) => p.startsWith(tmpRoot))).toBe(true);
    expect([...calls.mkdir].some((p) => p.startsWith(project))).toBe(false);
    // 用户的 build.gradle 逐字节不变（真实磁盘上验证）
    expect(await readFile(join(project, 'build.gradle'), 'utf8')).toBe('ORIGINAL');
  });

  it('调用方把 tmpRoot 配到工程里 → 拒绝预热并说明原因（宁可失败也不污染工程）', async () => {
    const project = await mkTmp('mc-warm-misconfig-');
    const { fs, calls } = fakeFs({ mkdtempResult: join(project, 'mc-creator-warmup-oops') });
    const runGradle = vi.fn(fakeRun());
    const r = await warmForgeGradleCache({
      mcVersion: '1.20.1',
      forgeVersion: '47.4.23',
      gradleHome: GRADLE_HOME,
      platform: 'win32',
      tmpRoot: project,
      projectPath: project,
      fs,
      runGradle,
      existsSyncImpl: () => false,
    });
    expect(codeOf(r)).toBe('TEMP_DIR_CREATE');
    expect(errOf(r)).toContain('拒绝在用户工程目录内预热');
    expect(runGradle).not.toHaveBeenCalled();
    expect(calls.writeFile).toEqual([]);
    expect(calls.rm).toEqual([join(project, 'mc-creator-warmup-oops')]); // 自己建的要自己删
  });
});

describe('默认真实 fs 通路（仍不跑 Gradle：runGradle 注入）', () => {
  it('真实 mkdtemp/写文件/删除：构建时读得到 build.gradle，返回后目录已不存在', async () => {
    const seen: string[] = [];
    let existedDuringRun = false;
    const r = await warmForgeGradleCache({
      mcVersion: '1.20.1',
      forgeVersion: '47.4.23',
      gradleHome: GRADLE_HOME,
      platform: process.platform,
      runGradle: fakeRun({}, (req) => {
        seen.push(req.cwd);
        existedDuringRun = existsSync(join(req.cwd, 'build.gradle'));
      }),
      existsSyncImpl: () => false, // 缓存里没有这个 MC 版本 → 真跑预热
    });

    expect(r).toMatchObject({ ok: true, warmed: true });
    expect(seen).toEqual([r.tempProjectDir]);
    expect(existedDuringRun).toBe(true); // 构建期间文件真的在
    expect(existsSync(r.tempProjectDir)).toBe(false); // 返回后已删
  });
});
