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

/** 调用 Gradle 编译并提取产物 .jar（规格 §2.2 构建器） */
export async function runGradleBuild(
  projectPath: string,
  run: (cmd: string, args: string[], opts: RunOptions) => Promise<RunResult> = defaultRun,
): Promise<BuildResult> {
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
