/** 检测本机 Java 主版本（规格 §5：1.21.x 需 21，26.1 需 25） */
export async function detectJavaVersion(
  run: (cmd: string) => Promise<string> = defaultRun,
): Promise<number | null> {
  try {
    const out = await run('java -version');
    // openjdk version "21.0.3" ... 或 openjdk version "25" ...
    // 注：计划原正则 (?:\.|$) 无法匹配 "25"（数字后紧跟引号），修正为 (?:\.|")
    const m = out.match(/version "(\d+)(?:\.|")/);
    return m ? Number(m[1]) : null;
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
