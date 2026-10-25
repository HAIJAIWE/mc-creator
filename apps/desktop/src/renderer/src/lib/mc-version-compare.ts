/**
 * MC 版本号降序比较：新版本排在前面。
 *
 * 为什么不能只按 `.` 切数字：
 * `26.2-rc-1` 里 `Number('2-rc-1')` 是 NaN，比较函数一旦返回 NaN，
 * `Array.sort` 会把它当 0 —— RC 版本停在原位置，表现成「26.3-rc-1
 * 排在 26.1 后面」。所以先取核心数字段，再把 `-` 后面的预发布后缀
 * 单独比较：同一核心版本里，正式版 > RC / snapshot。
 */
export function compareMcVersionsDesc(a: string, b: string): number {
  const pa = parseMcVersion(a);
  const pb = parseMcVersion(b);

  const length = Math.max(pa.numbers.length, pb.numbers.length);
  for (let i = 0; i < length; i += 1) {
    const diff = (pb.numbers[i] ?? 0) - (pa.numbers[i] ?? 0);
    if (diff !== 0) return diff;
  }

  if (pa.suffix === pb.suffix) return 0;
  // 同核心版本：正式版排在预发布版前面（降序）
  if (pa.suffix === '') return -1;
  if (pb.suffix === '') return 1;
  // rc-2 > rc-1、snapshot-4 > snapshot-3
  return pb.suffix.localeCompare(pa.suffix, undefined, {
    numeric: true,
    sensitivity: 'base',
  });
}

function parseMcVersion(version: string): { numbers: number[]; suffix: string } {
  const [core = '', ...rest] = version.trim().split('-');
  const numbers = core.split('.').map((part) => {
    const parsed = Number.parseInt(part, 10);
    return Number.isFinite(parsed) ? parsed : 0;
  });
  return { numbers, suffix: rest.join('-').toLowerCase() };
}
