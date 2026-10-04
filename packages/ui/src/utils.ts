/**
 * className 拼接工具。
 *
 * 组件库统一「语义 className（mc-*）+ 调用方覆盖」的组合方式：
 * 基础 class 由组件决定，调用方传入的 `className` 永远拼在最后，
 * 因此 Tailwind 的后写规则（同样 specificity 下后者胜）让调用方能覆盖
 * 库里的默认值，而不需要 `!important`。
 *
 * 只接受字符串与假值（`false` / `null` / `undefined` / `''`），
 * 不做数组/对象递归 —— 保持零依赖且行为可预测。
 */
export type ClassValue = string | false | null | undefined;

export function cx(...parts: ClassValue[]): string {
  let out = '';
  for (const part of parts) {
    if (!part) continue;
    out = out ? `${out} ${part}` : part;
  }
  return out;
}
