/** 解析 Gradle 编译错误日志，定位文件与行号（规格 §5 构建修复循环） */
export interface BuildError {
  file: string;
  line: number;
  message: string;
}

export function parseGradleErrors(log: string): BuildError[] {
  const errors: BuildError[] = [];
  // 形如：/path/Item.java:12: error: ';' expected
  const re = /^(.*?\.java):(\d+):\s*error:\s*(.+)$/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(log))) errors.push({ file: m[1], line: Number(m[2]), message: m[3] });
  return errors;
}
