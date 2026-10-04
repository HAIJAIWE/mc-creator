// 官方皮肤 PNG 加载器（构建时 glob 收集，转为可直接加载的 URL）
const modules = import.meta.glob('./official/*.png', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;

/** 取官方皮肤文件 URL，支持 wide-steve / slim-alex 等命名 */
export function officialSkinUrl(name: string): string | null {
  // 先尝试直接匹配
  const direct = modules[`./official/${name}.png`];
  if (direct) return direct;
  // 再尝试 wide/slim 前缀
  for (const prefix of ['wide', 'slim'] as const) {
    const key = `./official/${prefix}-${name}.png`;
    if (modules[key]) return modules[key];
  }
  return null;
}