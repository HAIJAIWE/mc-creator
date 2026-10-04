/**
 * JDK 工具链管理（设计文档 §8.1#1 / §5.1）。
 *
 * - JAVA_HOME 解析：只读环境变量，不做写入、不做自动下载
 *   （下载走 Adoptium API，由调用方按 §5.1 实现，此处仅给选型依据）。
 * - javaVersionFor(mcVersion)：按目标 MC 版本选 JDK 主版本。
 *   映射（§5 注释规格：1.21.x 需 21，26.1 需 25）：
 *     1.20.x → 17 / 1.21.x → 21 / 26.x → 25 / 更老 → 8。
 *   注意：版本号一律由运行时传入，禁止模型凭记忆输出（§0.5#3）。
 */

export type JavaVersion = 8 | 17 | 21 | 25;

/**
 * 按 MC 版本映射所需 JDK 主版本。
 * @example
 * javaVersionFor('1.20.1') // 17
 * javaVersionFor('1.21.4') // 21
 * javaVersionFor('26.1')   // 25
 */
export function javaVersionFor(mcVersion: string): JavaVersion {
  const v = mcVersion.trim();
  // 年份体系 26.x（首个未混淆版本起，见 §8.4）：需 JDK 25
  if (/^26(\.|$)/.test(v)) return 25;
  const m = v.match(/^1\.(\d+)/);
  if (m) {
    const minor = Number(m[1]);
    if (minor <= 16) return 8; // 1.12.2 / 1.16.5 等远古版
    if (minor <= 20) return 17; // 1.17 ~ 1.20.x
    return 21; // 1.21.x 及未知新 1.x：至少 21
  }
  // 非 1.x / 非 26.x 的未知版本号：保守给当前 LTS 高位，调用方应核实（§21#4）
  return 21;
}

/**
 * 解析 JAVA_HOME（纯函数，便于测试）。
 * @param env 默认为 process.env；传空对象可模拟未配置。
 * @returns 去掉首尾空白后的路径；未配置或全空返回 null。
 */
export function resolveJavaHome(env: NodeJS.ProcessEnv = process.env): string | null {
  const raw = env['JAVA_HOME'];
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  return trimmed === '' ? null : trimmed;
}

/**
 * 检测本机 `java` 主版本（保留 packages/core/src/builder/jdk.ts 逻辑）。
 *
 * 正则思路（照搬 core，含其注释中的修复）：
 * `java -version` 输出形如 `openjdk version "21.0.3" ...` 或 `openjdk version "25" ...`
 * （注意输出在 stderr）；原 `(?:\.|$)` 无法匹配 `"25"`（数字后紧跟引号），
 * 故用 `(?:\.|")` 同时覆盖 `21.0.3"` 与 `25"` 两种形态。
 *
 * TODO（多 JDK / toolchain 待补，见 §8.1#1）：
 * - 扫描注册表 / PATH / 常见目录并存多版本，按 javaVersionFor(mcVersion) 自动选择；
 * - Gradle toolchain 自动配置；Adoptium API 按平台拉取缺失版本（§5.1）。
 */
export async function detectJavaVersion(
  run: (cmd: string) => Promise<string> = defaultRun,
): Promise<number | null> {
  try {
    const out = await run('java -version');
    const m = out.match(/version "(\d+)(?:\.|")/);
    return m ? Number(m[1]) : null;
  } catch {
    return null;
  }
}

async function defaultRun(cmd: string): Promise<string> {
  // 零第三方：用 node:child_process 代替 core 的 execa。
  const { execFile } = await import('node:child_process');
  const [file, ...args] = cmd.split(' ');
  return new Promise<string>((resolve) => {
    execFile(file ?? 'java', args, (error, stdout, stderr) => {
      void error;
      // java -version 输出在 stderr
      resolve(`${stderr ?? ''}${stdout ?? ''}`.toString());
    });
  });
}
