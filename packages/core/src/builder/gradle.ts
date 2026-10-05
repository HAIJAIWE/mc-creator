export interface BuildResult {
  success: boolean;
  jarPath: string | null;
  log: string;
}

/** execa 调用选项（结构性类型，避免引入完整 execa Options 类型负担） */
export interface RunOptions {
  cwd?: string;
  reject?: boolean;
  [key: string]: unknown;
}

export interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/**
 * wrapper 自举注入点（与下面 `run` 同一套注入风格）。
 *
 * 为什么要注入而不是直接调：既有单测用假工程路径 `/proj` + mock runner，
 * 默认实现会去**真的下载 130MB Gradle 发行版** —— 测试就变成联网测试了。
 * 注入后单测保持完全离线，而生产走真实现。
 */
export type EnsureWrapperFn = (projectPath: string) => Promise<{ ok: boolean; error?: string }>;

/** 调用 Gradle 编译并提取产物 .jar（规格 §2.2 构建器） */
export async function runGradleBuild(
  projectPath: string,
  run: (cmd: string, args: string[], opts: RunOptions) => Promise<RunResult> = defaultRun,
  ensureWrapper: EnsureWrapperFn = defaultEnsureWrapper,
): Promise<BuildResult> {
  // 构建前确保 gradlew/gradlew.bat 存在：生成器只写 gradle-wrapper.properties，
  // 不写启动脚本，而下面拉起的正是它们 → 干净机器上必 ENOENT（实测阻断）。
  // 幂等（devkit 实现第一行就短路），所以对既有工程零成本。
  const boot = await ensureWrapper(projectPath);
  if (!boot.ok) {
    return {
      success: false,
      jarPath: null,
      log: `Gradle wrapper 准备失败: ${boot.error ?? '未知原因'}`,
    };
  }
  // C-2 修复：Windows 下只有 gradlew.bat（./gradlew 会 ENOENT）
  const gradlew = process.platform === 'win32' ? 'gradlew.bat' : './gradlew';
  const r = await run(gradlew, ['build', '--quiet'], { cwd: projectPath });
  const log = `${r.stdout}\n${r.stderr}`;
  if (r.exitCode !== 0) return { success: false, jarPath: null, log };
  // C-2 修复：产物在 build/libs/*.jar，排除 -sources / -javadoc 附属 jar
  const jar =
    [...log.matchAll(/build\/libs\/([^\s]+\.jar)/g)]
      .map((m) => m[0])
      .find((j) => !/-(?:sources|javadoc)\.jar$/.test(j)) ?? null;
  return { success: true, jarPath: jar, log };
}

async function defaultRun(cmd: string, args: string[], opts: RunOptions): Promise<RunResult> {
  const e = await import('execa');
  const r = await e.execa(cmd, args, { ...opts, reject: false });
  return {
    stdout: (r.stdout ?? '').toString(),
    stderr: (r.stderr ?? '').toString(),
    exitCode: r.exitCode ?? 0,
  };
}

/** 生产默认：走 devkit 的自举（幂等 + 宿主 JVM 预检 + properties 还原都在那边）。 */
async function defaultEnsureWrapper(projectPath: string): Promise<{ ok: boolean; error?: string }> {
  const devkit = await import('@mc-creator/devkit');
  const r = await devkit.ensureGradleWrapper({ projectPath });
  return r.ok ? { ok: true } : { ok: false, error: r.error };
}
