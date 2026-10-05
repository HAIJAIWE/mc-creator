/**
 * gradle-bootstrap.ts 测试（构建前确保 gradlew/gradlew.bat 存在）。
 *
 * 全注入、不触网、不真下 Gradle、不起真 Gradle 进程：
 * - fetch 注入（jdk-download.test.ts 同款：asFetch 强转 + neverFetch 兜底）
 * - extract 注入（假解压：在缓存目录里造出 bin/gradle.bat 的发行版骨架）
 * - runGradle 注入（假 wrapper 任务：**顺手把 gradle-wrapper.properties 改写成
 *   252B 的“Gradle 风格”**，复现事实④，用来钉住“properties 逐字节不变”）
 * - detectJavaMajor / maxJavaMajorFor 注入（不必真造 JVM）
 * 文件系统用真实临时目录（同 jdk-download.test.ts），只有网络与进程是假的。
 */
import { existsSync } from 'node:fs';
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute as pathIsAbsolute, join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runGradleBuild } from './gradle.js';
import {
  classFileMajorToJavaMajor,
  defaultDistributionUrl,
  defaultToolchainCacheDir,
  ensureGradleWrapper,
  maxJavaMajorForGradle,
  parseDistributionUrl,
  parseGradleVersion,
  runGradleTask,
  wrapperLauncherName,
  type GradleTaskOutcome,
  type GradleTaskRequest,
} from './gradle-bootstrap.js';

const IS_WIN = process.platform === 'win32';
const LAUNCHER = wrapperLauncherName();

const dirs: string[] = [];

afterEach(async () => {
  for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true });
});

async function mkTmp(prefix: string): Promise<string> {
  const d = await mkdtemp(join(tmpdir(), prefix));
  dirs.push(d);
  return d;
}

/** 生成器写出的真实形态（含中文注释 + validateDistributionUrl=true + 转义 `\:`）。 */
const GENERATOR_PROPERTIES = [
  '# 按 MC 版本 1.20.1 选择的 Gradle 版本（8.12）',
  '# 首次构建前在项目目录运行：gradle wrapper --gradle-version 8.12',
  '# （本机需安装 Gradle；该命令生成 gradlew、gradlew.bat 与 gradle-wrapper.jar，之后用 ./gradlew 构建）',
  'distributionBase=GRADLE_USER_HOME',
  'distributionPath=wrapper/dists',
  'distributionUrl=https\\://services.gradle.org/distributions/gradle-8.12-bin.zip',
  'networkTimeout=10000',
  'validateDistributionUrl=true',
  'zipStoreBase=GRADLE_USER_HOME',
  'zipStorePath=wrapper/dists',
  '',
].join('\n');

/** wrapper 任务跑完后被改写成的样子（实测 252B：注释没了、validateDistributionUrl=false）。 */
const REWRITTEN_PROPERTIES = [
  'distributionBase=GRADLE_USER_HOME',
  'distributionPath=wrapper/dists',
  'distributionUrl=https\\://services.gradle.org/distributions/gradle-8.12-bin.zip',
  'networkTimeout=10000',
  'validateDistributionUrl=false',
  'zipStoreBase=GRADLE_USER_HOME',
  'zipStorePath=wrapper/dists',
  '',
].join('\n');

async function makeProject(opts: { properties?: string | null } = {}): Promise<string> {
  const dir = await mkTmp('gradle-boot-');
  const properties = opts.properties === undefined ? GENERATOR_PROPERTIES : opts.properties;
  if (properties !== null) {
    await mkdir(join(dir, 'gradle', 'wrapper'), { recursive: true });
    await writeFile(
      join(dir, 'gradle', 'wrapper', 'gradle-wrapper.properties'),
      properties,
      'utf8',
    );
  }
  return dir;
}

function asFetch(fn: (...args: never[]) => Promise<Response>): typeof fetch {
  return fn as unknown as typeof fetch;
}

function neverFetch(): typeof fetch {
  return asFetch(async () => {
    throw new Error('测试不应触发网络请求');
  });
}

function okFetch(body = 'fake-gradle-zip'): typeof fetch {
  return asFetch(async () => new Response(new Uint8Array(Buffer.from(body)), { status: 200 }));
}

/**
 * 假解压：造出真实 zip 的目录形态（顶层 gradle-<version>/bin/<bin>），
 * 这样发行版根目录解析走的是生产代码路径。
 */
function fakeExtract(): (archivePath: string, destDir: string) => Promise<void> {
  return async (archivePath, destDir) => {
    const version = /gradle-(\d+(?:\.\d+)*)/.exec(archivePath)?.[1] ?? '';
    const home = join(destDir, `gradle-${version}`);
    await mkdir(join(home, 'bin'), { recursive: true });
    await writeFile(join(home, 'bin', IS_WIN ? 'gradle.bat' : 'gradle'), 'stub-dist', 'utf8');
  };
}

/**
 * 假 wrapper 任务：像真 Gradle 一样产出启动脚本 + wrapper.jar，
 * 并**顺手把 properties 改写成 REWRITTEN_PROPERTIES**（复现事实④）。
 */
function fakeWrapperTask(
  opts: { outcome?: Partial<GradleTaskOutcome>; rewrite?: boolean } = {},
): (req: GradleTaskRequest) => Promise<GradleTaskOutcome> {
  return async (req) => {
    if (opts.outcome?.ok === false || opts.outcome?.exitCode !== undefined) {
      return { ok: false, exitCode: 1, log: '> Task :wrapper FAILED', ...opts.outcome };
    }
    // 真 Gradle 自己会建 gradle/wrapper/ 并写 properties（这里模拟它的改写行为）
    await mkdir(join(req.cwd, 'gradle', 'wrapper'), { recursive: true });
    if (opts.rewrite !== false) {
      await writeFile(
        join(req.cwd, 'gradle', 'wrapper', 'gradle-wrapper.properties'),
        REWRITTEN_PROPERTIES,
        'utf8',
      );
    }
    await writeFile(join(req.cwd, LAUNCHER), 'stub-wrapper', 'utf8');
    await writeFile(join(req.cwd, 'gradle', 'wrapper', 'gradle-wrapper.jar'), 'stub-jar');
    return {
      ok: true,
      exitCode: 0,
      log: '> Task :wrapper\nBUILD SUCCESSFUL in 5s',
      ...opts.outcome,
    };
  };
}

const OK_JVM = { detectJavaMajor: async () => 21 };

describe('纯函数：版本解析 / JVM 上限表 / distributionUrl', () => {
  it('parseGradleVersion：两段补 0、缺参/垃圾串返回 null', () => {
    expect(parseGradleVersion('9.5.1')).toEqual([9, 5, 1]);
    expect(parseGradleVersion('8.12')).toEqual([8, 12, 0]);
    expect(parseGradleVersion(' 8.13 ')).toEqual([8, 13, 0]);
    expect(parseGradleVersion('8.x')).toBeNull();
    expect(parseGradleVersion('')).toBeNull();
  });

  it('maxJavaMajorForGradle 与官方兼容性矩阵一致（实测 8.12 跑不了 JDK 26）', () => {
    // 8.12 官方文档：8~23 可运行，24+ 不支持
    expect(maxJavaMajorForGradle('8.12')).toBe(23);
    expect(maxJavaMajorForGradle('8.13')).toBe(23);
    expect(maxJavaMajorForGradle('8.14')).toBe(24);
    // Java 25 始于 9.1.0、Java 26 始于 9.4.0
    expect(maxJavaMajorForGradle('9.2.1')).toBe(25); // quilt 固定的版本
    expect(maxJavaMajorForGradle('9.5.1')).toBe(26); // 生成器对 1.21.11/26.x 的取值
    // 表里没有的旧版本 → 不知道（null，调用方 fail-open）
    expect(maxJavaMajorForGradle('6.9')).toBeNull();
    expect(maxJavaMajorForGradle('nonsense')).toBeNull();
  });

  it('classFileMajorToJavaMajor：class = 主版本 + 44（实测 70 ↔ JDK 26）', () => {
    expect(classFileMajorToJavaMajor(70)).toBe(26);
    expect(classFileMajorToJavaMajor(67)).toBe(23);
  });

  it('parseDistributionUrl：反解 java properties 的 `\\:` 转义并抽出版本', () => {
    const r = parseDistributionUrl(GENERATOR_PROPERTIES);
    expect(r).toEqual({
      url: 'https://services.gradle.org/distributions/gradle-8.12-bin.zip',
      version: '8.12',
    });
    expect(parseDistributionUrl(REWRITTEN_PROPERTIES)?.version).toBe('8.12');
    // 没有 distributionUrl / 空文件 / 非字符串
    expect(parseDistributionUrl('distributionPath=wrapper/dists\n')).toBeNull();
    expect(parseDistributionUrl('')).toBeNull();
    expect(parseDistributionUrl(undefined as never)).toBeNull();
    // URL 里版本号形状怪时仍给 url（版本另由调用方给）
    expect(parseDistributionUrl('distributionUrl=https\\://x.example/g/custom.zip')).toEqual({
      url: 'https://x.example/g/custom.zip',
      version: '',
    });
  });

  it('defaultDistributionUrl / defaultToolchainCacheDir / wrapperLauncherName', () => {
    expect(defaultDistributionUrl('8.13')).toBe(
      'https://services.gradle.org/distributions/gradle-8.13-bin.zip',
    );
    expect(defaultToolchainCacheDir()).toContain(join('.mc-creator', 'cache'));
    expect(wrapperLauncherName('win32')).toBe('gradlew.bat');
    expect(wrapperLauncherName('linux')).toBe('gradlew');
  });
});

describe('① 热路径：wrapper 已存在 → 零下载零 spawn（每次构建都会走这里）', () => {
  it('gradlew(.bat) 已存在时 created=false，且 fetch/解压/任务/探测一个都不调', async () => {
    const dir = await makeProject();
    await writeFile(join(dir, IS_WIN ? 'gradlew.bat' : 'gradlew'), 'existing-wrapper', 'utf8');
    const cacheDir = await mkTmp('gradle-boot-cache-');
    const fetchImpl = vi.fn(neverFetch());
    const extract = vi.fn(fakeExtract());
    const runGradle = vi.fn(fakeWrapperTask());
    const detectJavaMajor = vi.fn(async () => 21);

    const r = await ensureGradleWrapper({
      projectPath: dir,
      cacheDir,
      fetchImpl,
      extract,
      runGradle,
      detectJavaMajor,
    });

    expect(r).toMatchObject({ ok: true, created: false, source: 'existing' });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(extract).not.toHaveBeenCalled();
    expect(runGradle).not.toHaveBeenCalled();
    expect(detectJavaMajor).not.toHaveBeenCalled();
    // 热路径不读 properties（不碰磁盘内容），原始字节当然不变
    expect(
      await readFile(join(dir, 'gradle', 'wrapper', 'gradle-wrapper.properties'), 'utf8'),
    ).toBe(GENERATOR_PROPERTIES);
  });

  it('只有别的平台的启动脚本时不算“已存在”（判据与 spawn 方一致）', async () => {
    const dir = await makeProject();
    // 造一个“非本平台”的脚本：win32 下只有 gradlew，posix 下只有 gradlew.bat
    await writeFile(join(dir, IS_WIN ? 'gradlew' : 'gradlew.bat'), 'other-platform', 'utf8');
    const cacheDir = await mkTmp('gradle-boot-cache-');
    const runGradle = vi.fn(fakeWrapperTask());
    const r = await ensureGradleWrapper({
      projectPath: dir,
      cacheDir,
      fetchImpl: okFetch(),
      extract: fakeExtract(),
      runGradle,
      ...OK_JVM,
    });
    expect(r).toMatchObject({ ok: true, created: true });
    expect(runGradle).toHaveBeenCalledTimes(1);
  });
});

describe('② 不存在 → 下载发行版 + 跑 wrapper 任务 + 产出判定', () => {
  it('完整通路：URL 取自 properties，命令带 --no-validate-url，结果 created=true', async () => {
    const dir = await makeProject();
    const cacheDir = await mkTmp('gradle-boot-cache-');
    const fetchImpl = vi.fn(okFetch());
    const extract = vi.fn(fakeExtract());
    const runGradle = vi.fn(fakeWrapperTask());

    const r = await ensureGradleWrapper({
      projectPath: dir,
      cacheDir,
      fetchImpl,
      extract,
      runGradle,
      ...OK_JVM,
    });

    expect(r).toMatchObject({
      ok: true,
      created: true,
      gradleVersion: '8.12',
      source: 'download',
      distributionUrl: 'https://services.gradle.org/distributions/gradle-8.12-bin.zip',
    });
    if (!r.ok) throw new Error('unreachable');
    // 下载的是 properties 里那个地址（反转义后）
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(String(fetchImpl.mock.calls[0]?.[0])).toBe(
      'https://services.gradle.org/distributions/gradle-8.12-bin.zip',
    );
    // 发行版落在 <cacheDir>/gradle/<version>/ 且带 .ready
    expect(r.distributionHome).toBe(join(cacheDir, 'gradle', '8.12', 'gradle-8.12'));
    expect(existsSync(join(cacheDir, 'gradle', '8.12', '.ready'))).toBe(true);
    // 下载用的 .part 临时文件无残留
    expect((await readdir(cacheDir)).filter((f) => f.endsWith('.part'))).toEqual([]);
    // wrapper 任务：cwd=工程目录、命令=发行版里的 gradle、参数含 --no-validate-url
    const req = runGradle.mock.calls[0]?.[0] as GradleTaskRequest;
    expect(req.cwd).toBe(dir);
    expect(req.command).toBe(join(r.distributionHome, 'bin', IS_WIN ? 'gradle.bat' : 'gradle'));
    expect(req.args).toEqual(['wrapper', '--gradle-version', '8.12', '--no-validate-url']);
    // 脚本真的出现了，且日志透出
    expect(existsSync(join(dir, LAUNCHER))).toBe(true);
    expect(r.log).toContain('Gradle 8.12');
    expect(r.log).toContain('BUILD SUCCESSFUL');

    // 二次调用：wrapper 已在 → 热路径；发行版缓存命中也无需再跑任务
    fetchImpl.mockClear();
    const r2 = await ensureGradleWrapper({
      projectPath: dir,
      cacheDir,
      fetchImpl,
      extract,
      runGradle,
      ...OK_JVM,
    });
    expect(r2).toMatchObject({ ok: true, created: false });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(runGradle).toHaveBeenCalledTimes(1); // 没有第二次
  });

  it('properties 缺失时按显式 gradleVersion 走官方地址', async () => {
    const dir = await makeProject({ properties: null });
    const cacheDir = await mkTmp('gradle-boot-cache-');
    const fetchImpl = vi.fn(okFetch());
    const r = await ensureGradleWrapper({
      projectPath: dir,
      cacheDir,
      gradleVersion: '9.5.1',
      fetchImpl,
      extract: fakeExtract(),
      runGradle: fakeWrapperTask(),
      ...OK_JVM,
    });
    expect(r).toMatchObject({ ok: true, created: true, gradleVersion: '9.5.1' });
    expect(String(fetchImpl.mock.calls[0]?.[0])).toBe(defaultDistributionUrl('9.5.1'));
  });

  it('properties 与显式版本都没有 → GRADLE_VERSION_UNKNOWN，且不触网', async () => {
    const dir = await makeProject({ properties: null });
    const cacheDir = await mkTmp('gradle-boot-cache-');
    const fetchImpl = vi.fn(neverFetch());
    const r = await ensureGradleWrapper({
      projectPath: dir,
      cacheDir,
      fetchImpl,
      extract: fakeExtract(),
      runGradle: fakeWrapperTask(),
      ...OK_JVM,
    });
    expect(r).toMatchObject({ ok: false, code: 'GRADLE_VERSION_UNKNOWN' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('任务成功但 gradlew 仍不存在 → WRAPPER_NOT_GENERATED（不谎报成功）', async () => {
    const dir = await makeProject();
    const cacheDir = await mkTmp('gradle-boot-cache-');
    const r = await ensureGradleWrapper({
      projectPath: dir,
      cacheDir,
      fetchImpl: okFetch(),
      extract: fakeExtract(),
      // 只改 properties，不产出脚本
      runGradle: async (req) => {
        await writeFile(
          join(req.cwd, 'gradle', 'wrapper', 'gradle-wrapper.properties'),
          REWRITTEN_PROPERTIES,
          'utf8',
        );
        return { ok: true, exitCode: 0, log: 'BUILD SUCCESSFUL' };
      },
      ...OK_JVM,
    });
    expect(r).toMatchObject({ ok: false, code: 'WRAPPER_NOT_GENERATED' });
  });
});

describe('③ 失败一律返回结构化 error，不抛裸异常', () => {
  it('下载 500 → 重试 3 次后 DISTRIBUTION_DOWNLOAD，不跑 wrapper 任务', async () => {
    const dir = await makeProject();
    const cacheDir = await mkTmp('gradle-boot-cache-');
    const fetchImpl = vi.fn(asFetch(async () => new Response('boom', { status: 500 })));
    const runGradle = vi.fn(fakeWrapperTask());
    const r = await ensureGradleWrapper({
      projectPath: dir,
      cacheDir,
      fetchImpl,
      extract: fakeExtract(),
      runGradle,
      ...OK_JVM,
    });
    expect(r).toMatchObject({ ok: false, code: 'DISTRIBUTION_DOWNLOAD' });
    expect(fetchImpl).toHaveBeenCalledTimes(3); // 默认重试 2 次
    expect(runGradle).not.toHaveBeenCalled();
  });

  it('下载 404 → 不重试（只 1 次），仍是结构化 error', async () => {
    const dir = await makeProject();
    const cacheDir = await mkTmp('gradle-boot-cache-');
    const fetchImpl = vi.fn(asFetch(async () => new Response('nope', { status: 404 })));
    const r = await ensureGradleWrapper({
      projectPath: dir,
      cacheDir,
      fetchImpl,
      extract: fakeExtract(),
      runGradle: fakeWrapperTask(),
      ...OK_JVM,
    });
    expect(r).toMatchObject({ ok: false, code: 'DISTRIBUTION_DOWNLOAD' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('解压失败 → DISTRIBUTION_DOWNLOAD 且清掉半成品目录（下次会重下）', async () => {
    const dir = await makeProject();
    const cacheDir = await mkTmp('gradle-boot-cache-');
    const r = await ensureGradleWrapper({
      projectPath: dir,
      cacheDir,
      fetchImpl: okFetch(),
      extract: async () => {
        throw new Error('不是有效的 zip 压缩包（未找到 EOCD）');
      },
      runGradle: fakeWrapperTask(),
      ...OK_JVM,
    });
    expect(r).toMatchObject({ ok: false, code: 'DISTRIBUTION_DOWNLOAD' });
    expect(r.ok === false && r.error).toContain('解压');
    expect(existsSync(join(cacheDir, 'gradle', '8.12'))).toBe(false);
  });

  it('wrapper 任务失败 → WRAPPER_TASK_FAILED，错误里带退出码与任务日志', async () => {
    const dir = await makeProject();
    const cacheDir = await mkTmp('gradle-boot-cache-');
    const r = await ensureGradleWrapper({
      projectPath: dir,
      cacheDir,
      fetchImpl: okFetch(),
      extract: fakeExtract(),
      runGradle: async () => ({
        ok: false,
        exitCode: 1,
        log: "Execution failed for task ':wrapper'.\n> Test of distribution url failed.",
      }),
      ...OK_JVM,
    });
    expect(r).toMatchObject({ ok: false, code: 'WRAPPER_TASK_FAILED' });
    expect(r.ok === false && r.error).toContain('exit=1');
    expect(r.ok === false && r.error).toContain('Test of distribution url failed');
  });

  it('任务执行器抛异常也被收敛成 WRAPPER_TASK_FAILED（不外泄裸异常）', async () => {
    const dir = await makeProject();
    const cacheDir = await mkTmp('gradle-boot-cache-');
    const r = await ensureGradleWrapper({
      projectPath: dir,
      cacheDir,
      fetchImpl: okFetch(),
      extract: fakeExtract(),
      runGradle: async () => {
        throw new Error('spawn ENOENT');
      },
      ...OK_JVM,
    });
    expect(r).toMatchObject({ ok: false, code: 'WRAPPER_TASK_FAILED' });
    expect(r.ok === false && r.error).toContain('spawn ENOENT');
  });

  it('⑧ 兜底：预检漏掉的 “Unsupported class file major version 70” 被翻译成人话', async () => {
    const dir = await makeProject();
    const cacheDir = await mkTmp('gradle-boot-cache-');
    const r = await ensureGradleWrapper({
      projectPath: dir,
      cacheDir,
      fetchImpl: okFetch(),
      extract: fakeExtract(),
      runGradle: async () => ({
        ok: false,
        exitCode: 1,
        log:
          "BUG! exception in phase 'semantic analysis' in source unit '_BuildScript_' " +
          'Unsupported class file major version 70',
      }),
      // 显式把上限抬到 30，模拟“表没覆盖到/预检没拦住”
      maxJavaMajorFor: () => 30,
      ...OK_JVM,
    });
    expect(r).toMatchObject({ ok: false, code: 'WRAPPER_TASK_FAILED' });
    expect(r.ok === false && r.error).toContain('跑不了 JDK 26');
  });

  it('projectPath 为空 → PROJECT_PATH_MISSING', async () => {
    const r = await ensureGradleWrapper({ projectPath: '   ' });
    expect(r).toMatchObject({ ok: false, code: 'PROJECT_PATH_MISSING' });
  });
});

describe('⑤ 宿主 JVM 预检：太新就早退，查不到就放行', () => {
  it('JDK 26 + Gradle 8.12 → 提前拒绝，且一字节都没下载', async () => {
    const dir = await makeProject();
    const cacheDir = await mkTmp('gradle-boot-cache-');
    const fetchImpl = vi.fn(neverFetch());
    const extract = vi.fn(fakeExtract());
    const runGradle = vi.fn(fakeWrapperTask());

    const r = await ensureGradleWrapper({
      projectPath: dir,
      cacheDir,
      fetchImpl,
      extract,
      runGradle,
      detectJavaMajor: async () => 26, // 本机 JAVA_HOME 就是 JDK 26
    });

    expect(r).toMatchObject({ ok: false, code: 'JVM_TOO_NEW' });
    expect(r.ok === false && r.error).toContain('Gradle 8.12 不支持 JDK 26');
    expect(r.ok === false && r.error).toContain('JDK 23 或更低');
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(extract).not.toHaveBeenCalled();
    expect(runGradle).not.toHaveBeenCalled();
  });

  it('JDK 26 + Gradle 9.5.1 → 放行（9.4.0 起官方支持 Java 26）', async () => {
    const dir = await makeProject({
      properties: GENERATOR_PROPERTIES.replace('gradle-8.12-bin.zip', 'gradle-9.5.1-bin.zip'),
    });
    const cacheDir = await mkTmp('gradle-boot-cache-');
    const runGradle = vi.fn(fakeWrapperTask());
    const r = await ensureGradleWrapper({
      projectPath: dir,
      cacheDir,
      fetchImpl: okFetch(),
      extract: fakeExtract(),
      runGradle,
      detectJavaMajor: async () => 26,
    });
    expect(r).toMatchObject({ ok: true, created: true, gradleVersion: '9.5.1' });
    expect(runGradle).toHaveBeenCalledTimes(1);
  });

  it('查不到 JVM 版本 → fail-open 继续跑（宁可尝试也不误杀）', async () => {
    const dir = await makeProject();
    const cacheDir = await mkTmp('gradle-boot-cache-');
    const runGradle = vi.fn(fakeWrapperTask());
    const r = await ensureGradleWrapper({
      projectPath: dir,
      cacheDir,
      fetchImpl: okFetch(),
      extract: fakeExtract(),
      runGradle,
      detectJavaMajor: async () => null, // 没 java / 输出不认识
    });
    expect(r).toMatchObject({ ok: true, created: true });
    expect(runGradle).toHaveBeenCalledTimes(1);
  });

  it('Gradle 版本不在上限表里 → 同样 fail-open', async () => {
    const dir = await makeProject({
      properties: GENERATOR_PROPERTIES.replace('gradle-8.12-bin.zip', 'gradle-6.9-bin.zip'),
    });
    const cacheDir = await mkTmp('gradle-boot-cache-');
    const r = await ensureGradleWrapper({
      projectPath: dir,
      cacheDir,
      fetchImpl: okFetch(),
      extract: fakeExtract(),
      runGradle: fakeWrapperTask(),
      detectJavaMajor: async () => 26,
    });
    expect(r).toMatchObject({ ok: true, created: true, gradleVersion: '6.9' });
  });

  it('上限函数可注入（单测不必真造 JVM）', async () => {
    const dir = await makeProject();
    const cacheDir = await mkTmp('gradle-boot-cache-');
    const maxJavaMajorFor = vi.fn(() => 20);
    const r = await ensureGradleWrapper({
      projectPath: dir,
      cacheDir,
      fetchImpl: neverFetch(),
      extract: fakeExtract(),
      runGradle: fakeWrapperTask(),
      detectJavaMajor: async () => 21,
      maxJavaMajorFor,
    });
    expect(maxJavaMajorFor).toHaveBeenCalledWith('8.12');
    expect(r).toMatchObject({ ok: false, code: 'JVM_TOO_NEW' });
  });
});

describe('④ properties 逐字节不变（wrapper 任务会重写它 —— 实测 509B → 252B）', () => {
  it('任务把它改写成“Gradle 风格”后，内容与原始字节完全一致', async () => {
    const dir = await makeProject();
    const propsPath = join(dir, 'gradle', 'wrapper', 'gradle-wrapper.properties');
    const before = await readFile(propsPath);
    const cacheDir = await mkTmp('gradle-boot-cache-');

    const r = await ensureGradleWrapper({
      projectPath: dir,
      cacheDir,
      fetchImpl: okFetch(),
      extract: fakeExtract(),
      runGradle: fakeWrapperTask({ rewrite: true }), // 假装真 Gradle 重写了它
      ...OK_JVM,
    });

    expect(r).toMatchObject({ ok: true, created: true });
    const after = await readFile(propsPath);
    expect(after.equals(before)).toBe(true);
    expect(after.toString('utf8')).toBe(GENERATOR_PROPERTIES);
    // 关键行没被翻成 false
    expect(after.toString('utf8')).toContain('validateDistributionUrl=true');
  });

  it('任务失败时也还原（失败不该留下被改写的 properties）', async () => {
    const dir = await makeProject();
    const propsPath = join(dir, 'gradle', 'wrapper', 'gradle-wrapper.properties');
    const before = await readFile(propsPath);
    const cacheDir = await mkTmp('gradle-boot-cache-');

    const r = await ensureGradleWrapper({
      projectPath: dir,
      cacheDir,
      fetchImpl: okFetch(),
      extract: fakeExtract(),
      runGradle: async (req) => {
        await writeFile(
          join(req.cwd, 'gradle', 'wrapper', 'gradle-wrapper.properties'),
          REWRITTEN_PROPERTIES,
          'utf8',
        );
        return { ok: false, exitCode: 1, log: 'FAILED' };
      },
      ...OK_JVM,
    });

    expect(r).toMatchObject({ ok: false, code: 'WRAPPER_TASK_FAILED' });
    expect((await readFile(propsPath)).equals(before)).toBe(true);
  });

  it('properties 不存在时不凭空造一个（让 wrapper 任务自己写）', async () => {
    const dir = await makeProject({ properties: null });
    const cacheDir = await mkTmp('gradle-boot-cache-');
    const r = await ensureGradleWrapper({
      projectPath: dir,
      cacheDir,
      gradleVersion: '8.12',
      fetchImpl: okFetch(),
      extract: fakeExtract(),
      runGradle: fakeWrapperTask({ rewrite: false }),
      ...OK_JVM,
    });
    expect(r).toMatchObject({ ok: true, created: true });
    expect(existsSync(join(dir, 'gradle', 'wrapper', 'gradle-wrapper.properties'))).toBe(false);
  });
});

describe('runGradleTask 默认执行器（真 spawn，但用 node/脚本当 gradle：不触网、不下 Gradle）', () => {
  it('退出码 0 → ok=true，cwd 真的生效', async () => {
    const dir = await mkTmp('gradle-boot-run-');
    const ok = await runGradleTask({
      command: process.execPath,
      args: ['-e', 'process.stdout.write(process.cwd())'],
      cwd: dir,
      timeoutMs: 15_000,
    });
    expect(ok.ok).toBe(true);
    expect(ok.exitCode).toBe(0);
    expect(ok.log).toContain(dir); // cwd 传到了子进程
  });

  it('非 0 退出 → ok=false 且带退出码与输出', async () => {
    const dir = await mkTmp('gradle-boot-run2-');
    // 用脚本文件而不是 `node -e "…"`：shell:true 时 cmd 会把 -e 的引号/分号吃掉，
    // 退出码不可信（实测拿到 1）。这正是真 Gradle 的形态（.bat/.sh）。
    const script = join(dir, IS_WIN ? 'gradle.bat' : 'gradle');
    if (IS_WIN) {
      await writeFile(script, '@echo off\r\necho boom 1>&2\r\nexit /b 3\r\n', 'utf8');
    } else {
      await writeFile(script, '#!/bin/sh\necho boom 1>&2\nexit 3\n', {
        encoding: 'utf8',
        mode: 0o755,
      });
      await chmod(script, 0o755);
    }
    const r = await runGradleTask({
      command: script,
      args: ['wrapper', '--gradle-version', '8.12', '--no-validate-url'],
      cwd: dir,
      timeoutMs: 15_000,
    });
    expect(r.ok).toBe(false);
    expect(r.exitCode).toBe(3);
    expect(r.log).toContain('boom');
  });

  it('命令路径含空格也必须能跑通（Windows shell:true 不转义 → 必须自己加引号）', async () => {
    const dir = await mkTmp('gradle-boot-space-');
    // 在**带空格的子目录**里放一个“假 gradle”，验证 cmd 不会把路径截断
    const binDir = join(dir, 'my dist', 'bin');
    await mkdir(binDir, { recursive: true });
    const script = join(binDir, IS_WIN ? 'gradle.bat' : 'gradle');
    if (IS_WIN) {
      await writeFile(script, '@echo off\r\necho wrapper ok\r\nexit /b 0\r\n', 'utf8');
    } else {
      await writeFile(script, '#!/bin/sh\necho "wrapper ok"\n', { encoding: 'utf8', mode: 0o755 });
      await chmod(script, 0o755);
    }
    const r = await runGradleTask({
      command: script,
      args: ['wrapper', '--gradle-version', '8.12', '--no-validate-url'],
      cwd: dir,
      timeoutMs: 15_000,
    });
    expect(r.ok).toBe(true);
    expect(r.log).toContain('wrapper ok');
  });

  it('超时 → 杀进程并 ok=false（日志里写明超时）', async () => {
    const dir = await mkTmp('gradle-boot-to-');
    // 慢进程夹具：与 devkit.test.ts 同款（Windows 用 ping -n 倒数当 sleep，
    // 不用 timeout.exe —— 它的 stdin 被管道重定向时会直接报错退出）。
    const script = join(dir, IS_WIN ? 'gradle.bat' : 'gradle');
    if (IS_WIN) {
      await writeFile(script, '@echo off\r\nping -n 30 127.0.0.1 >nul\r\n', 'utf8');
    } else {
      await writeFile(script, '#!/bin/sh\nsleep 30\n', { encoding: 'utf8', mode: 0o755 });
      await chmod(script, 0o755);
    }
    const r = await runGradleTask({
      command: script,
      args: ['wrapper'],
      cwd: dir,
      timeoutMs: 800,
    });
    expect(r.ok).toBe(false);
    expect(r.log).toContain('wrapper 任务超时');
  });

  it('可执行文件不存在 → ok=false 而不是挂住', async () => {
    const dir = await mkTmp('gradle-boot-enoent-');
    const r = await runGradleTask({
      command: join(dir, 'no-such-gradle'),
      args: ['wrapper'],
      cwd: dir,
      timeoutMs: 15_000,
    });
    // Windows shell:true 时是 cmd 的非 0 退出 + 原生报错文本，posix 是 ENOENT 'error' 事件
    expect(r.ok).toBe(false);
    expect(r.log.length).toBeGreaterThan(0);
  });

  it('signal 取消 → ok=false 且日志写明取消', async () => {
    const dir = await mkTmp('gradle-boot-abort-');
    const script = join(dir, IS_WIN ? 'gradle.bat' : 'gradle');
    if (IS_WIN) {
      await writeFile(script, '@echo off\r\nping -n 30 127.0.0.1 >nul\r\n', 'utf8');
    } else {
      await writeFile(script, '#!/bin/sh\nsleep 30\n', { encoding: 'utf8', mode: 0o755 });
      await chmod(script, 0o755);
    }
    const c = new AbortController();
    setTimeout(() => c.abort(), 500);
    const r = await runGradleTask({
      command: script,
      args: ['wrapper'],
      cwd: dir,
      timeoutMs: 15_000,
      signal: c.signal,
    });
    expect(r.ok).toBe(false);
    expect(r.log).toContain('wrapper 任务被取消');
  });
});

describe('缓存目录约定（复用 jdk-download 风格）', () => {
  it('defaultToolchainCacheDir 形如 <home>/.mc-creator/cache（发行版再加 gradle/<version>/）', () => {
    const root = defaultToolchainCacheDir();
    expect(root.endsWith(join('.mc-creator', 'cache'))).toBe(true);
    expect(pathIsAbsolute(root)).toBe(true);
  });
});

describe('gradle.ts 接线：spawn 之前先确保 wrapper，既有失败语义不变', () => {
  /** 与 devkit.test.ts 同款的假 gradlew 夹具（那里一字未改，这里只验证接线不打扰它）。 */
  async function makeFakeGradlewProject(): Promise<string> {
    const dir = await mkTmp('gradle-boot-wire-');
    if (IS_WIN) {
      await writeFile(
        join(dir, 'gradlew.bat'),
        '@echo off\r\necho %* > args.txt\r\nexit /b 0\r\n',
        'utf8',
      );
    } else {
      const p = join(dir, 'gradlew');
      await writeFile(p, '#!/bin/sh\necho "$@" > args.txt\n', { encoding: 'utf8', mode: 0o755 });
      await chmod(p, 0o755);
    }
    return dir;
  }

  it('启动脚本已存在 → 幂等短路，构建照常跑（零下载、零自举日志）', async () => {
    const dir = await makeFakeGradlewProject();
    const r = await runGradleBuild(dir, {
      timeoutMs: 15_000,
      // 缓存目录指向工程内：万一自举真的去下载/解压，这里会立刻暴露而不是悄悄联网。
      wrapperCacheDir: join(dir, 'no-such-cache-root'),
    });
    expect(r.success).toBe(true);
    expect(r.exitCode).toBe(0);
    expect(r.log).not.toContain('wrapper bootstrap failed');
    expect(r.log).not.toContain('正在生成 Gradle wrapper'); // created=false → 不拼过程日志
    // 子进程确实收到了参数（说明 spawn 正常发生，没有被自举拦掉）
    expect(await readFile(join(dir, 'args.txt'), 'utf8')).toContain('build');
  });

  it('缺 wrapper 且版本读不出 → 走既有失败路径（success=false/exitCode=null/timedOut=false）', async () => {
    // 工程里既没有启动脚本也没有 gradle-wrapper.properties → GRADLE_VERSION_UNKNOWN，
    // 零网络零 spawn：验证“失败时把 error 交给既有失败路径”，而不是新造异常。
    const dir = await mkTmp('gradle-boot-nofw-');
    const r = await runGradleBuild(dir, { timeoutMs: 5_000, wrapperCacheDir: dir });
    expect(r).toMatchObject({ success: false, jarPath: null, exitCode: null, timedOut: false });
    expect(r.log).toContain('gradle wrapper bootstrap failed');
    expect(r.log).toContain('读不到 Gradle 版本');
  });

  it('ensureWrapper:false → 完全不碰自举，行为与改动前一致（缺 gradlew 的老失败路径）', async () => {
    const dir = await mkTmp('gradle-boot-optout-');
    const r = await runGradleBuild(dir, { timeoutMs: 5_000, ensureWrapper: false });
    expect(r.success).toBe(false);
    expect(r.log).not.toContain('wrapper bootstrap failed');
    // 注意 Windows 上 shell:true 时缺 gradlew.bat 是 cmd.exe 的非 0 退出 + 原生报错文本，
    // 不是 node 的 'spawn error' 事件（实测）——所以这里只钉住“没走自举”。
    expect(r.log).toMatch(/spawn error|gradlew/);
  });
});
