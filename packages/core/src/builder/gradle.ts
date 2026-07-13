import type { execa } from 'execa';

export interface BuildResult {
  success: boolean;
  jarPath: string | null;
  log: string;
}

/** 调用 Gradle 编译并提取产物 .jar（规格 §2.2 构建器） */
export async function runGradleBuild(
  projectPath: string,
  run: (cmd: string, args: string[], opts: any) => Promise<{ stdout: string; stderr: string; exitCode: number }> = defaultRun,
): Promise<BuildResult> {
  const r = await run('./gradlew', ['build', '--quiet'], { cwd: projectPath });
  const log = `${r.stdout}\n${r.stderr}`;
  if (r.exitCode !== 0) return { success: false, jarPath: null, log };
  // 产物在 build/libs/*.jar（排除 sources/javadoc）
  const jar = log.match(/build\/libs\/([^\s]+\.jar)/)?.[0] ?? null;
  return { success: true, jarPath: jar, log };
}

async function defaultRun(cmd: string, args: string[], opts: any) {
  const e = await import('execa');
  const r = await e.execa(cmd, args, { ...opts, reject: false });
  return { stdout: r.stdout.toString(), stderr: r.stderr.toString(), exitCode: r.exitCode ?? 0 };
}
