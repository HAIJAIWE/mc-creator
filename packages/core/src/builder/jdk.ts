/**
 * 检测本机 Java 主版本（规格 §5：1.21.x 需 21，26.1 需 25）
 *
 * 解析逻辑转发到 `@mc-creator/devkit` 的 `parseJavaMajorVersion` ——
 * 本文件此前**自己抄了一份正则**，而那份在 Java 8 上解析出 `1`
 * （`1.8.0_402` → 捕获 `1`）。两份副本必然漂移，devkit 是底层，
 * core → devkit 是既有依赖方向，所以权威实现放在 devkit，这里只保留 I/O。
 */
export async function detectJavaVersion(
  run: (cmd: string) => Promise<string> = defaultRun,
): Promise<number | null> {
  const { parseJavaMajorVersion } = await import('@mc-creator/devkit');
  try {
    const out = await run('java -version');
    return parseJavaMajorVersion(out);
  } catch {
    return null;
  }
}

async function defaultRun(cmd: string): Promise<string> {
  const { execa } = await import('execa');
  const r = await execa(cmd.split(' ')[0], cmd.split(' ').slice(1), { reject: false });
  // java -version 输出在 stderr
  return (r.stderr || r.stdout).toString();
}
