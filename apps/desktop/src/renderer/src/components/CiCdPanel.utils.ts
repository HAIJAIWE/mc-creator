/** 根据 MC 版本推导建议的 Java 版本（≤1.16.5→8，1.17-1.20.4→17，1.20.5+→21） */
export function suggestJavaVersion(mcVersion: string): number {
  const match = /^(\d+)\.(\d+)(?:\.(\d+))?/.exec(mcVersion);
  if (!match) return 21;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3] ?? 0);
  if (major < 1 || (major === 1 && minor < 17)) return 8;
  if (major === 1 && minor >= 17 && (minor < 20 || (minor === 20 && patch <= 4))) return 17;
  return 21;
}
