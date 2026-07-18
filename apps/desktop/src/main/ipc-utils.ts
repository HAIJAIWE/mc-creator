import { resolve, relative } from 'node:path';

/**
 * 校验 target 解析后仍位于 base 目录内，防止路径穿越（如 ../../etc/passwd）。
 * 用于 PREPARE_BUILD_DIR / build-fixer 等把外部传入路径拼接到受控目录的场景。
 */
export function assertWithin(base: string, target: string): void {
  const rel = relative(resolve(base), resolve(base, target));
  if (rel.startsWith('..')) {
    throw new Error(`非法路径：${target} 逃逸出受控目录 ${base}`);
  }
}

/**
 * 解析 `git status --porcelain -b` 输出（## 分支行 + 两字母状态码文件行）。
 * 纯函数，从 registerIpcHandlers 闭包提取到独立模块以便单测。
 */
export function parseGitStatus(raw: string): {
  branch: string | null;
  upstream: string | null;
  ahead: number;
  behind: number;
  files: { x: string; y: string; path: string; origPath?: string }[];
  clean: boolean;
} {
  let branch: string | null = null;
  let upstream: string | null = null;
  let ahead = 0;
  let behind = 0;
  const files: { x: string; y: string; path: string; origPath?: string }[] = [];
  for (const line of raw.split('\n')) {
    if (!line) continue;
    if (line.startsWith('## ')) {
      const rest = line.slice(3);
      const a = rest.match(/ahead (\d+)/);
      const b = rest.match(/behind (\d+)/);
      if (a) ahead = Number(a[1]);
      if (b) behind = Number(b[1]);
      const branchPart = rest.split('...')[0].replace(/\s*\(.*\)\s*$/, '').trim();
      branch = branchPart || null;
      const up = rest.split('...')[1];
      if (up) upstream = up.split(/\s/)[0].replace(/\[.*\]/, '').trim() || null;
      continue;
    }
    const x = line[0];
    const y = line[1];
    let path = line.slice(3);
    let origPath: string | undefined;
    const arrow = path.indexOf(' -> ');
    if (arrow >= 0) {
      origPath = path.slice(0, arrow);
      path = path.slice(arrow + 4);
    }
    files.push({ x, y, path, origPath });
  }
  return { branch, upstream, ahead, behind, files, clean: files.length === 0 };
}
