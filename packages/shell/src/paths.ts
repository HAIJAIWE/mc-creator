/**
 * packages/shell · 路径工具
 * 设计文档 §14（长路径 / Unicode 全链路）+ §4.2（路径工具）。
 *
 * 参考 apps/desktop path-manager.ts 的 `isSafePath` / `isPathInWorkspace`
 * 语义（resolve + startsWith），在此收敛为无 Electron 依赖的纯函数，
 * 并修复两处可移植性缺口：
 * 1. 显式处理 Windows 跨盘符（`C:\ws` vs `D:\evil` 必为 false，
 *    不依赖 startsWith 隐式成立）；
 * 2. Windows 下大小写不敏感比较，且分隔符用 `sep` 而非硬编码 `/`。
 */

import { mkdir } from 'node:fs/promises';
import { parse, resolve, sep } from 'node:path';

const DRIVE_LETTER_RE = /^[a-zA-Z]:[\\/]/;
const DRIVE_ONLY_RE = /^[a-zA-Z]:$/;

function driveOf(p: string): string | undefined {
  const m = /^\s*([a-zA-Z]):/.exec(p);
  return m ? m[1]?.toLowerCase() : undefined;
}

function isInsideBase(resolvedBase: string, normalized: string): boolean {
  if (resolvedBase === '' || normalized === '') return false;
  // 跨盘符显式拒绝：先做盘符字母比对（与平台无关，保证单测可移植），
  // 再在 Windows 上比对 parse.root（覆盖 UNC 等形态）。
  const baseDrive = driveOf(resolvedBase);
  const targetDrive = driveOf(normalized);
  if (baseDrive !== undefined || targetDrive !== undefined) {
    if (baseDrive !== targetDrive) return false;
  }
  if (process.platform === 'win32') {
    const baseRoot = parse(resolvedBase).root.toLowerCase();
    const targetRoot = parse(normalized).root.toLowerCase();
    if (baseRoot !== targetRoot) return false;
    const b = resolvedBase.toLowerCase();
    const n = normalized.toLowerCase();
    const prefix = b.endsWith(sep) ? b : b + sep;
    return n === b || n.startsWith(prefix);
  }
  const prefix = resolvedBase.endsWith(sep) ? resolvedBase : resolvedBase + sep;
  return normalized === resolvedBase || normalized.startsWith(prefix);
}

/**
 * 安全路径检查：`target`（相对或绝对）解析后是否落在 `base` 内（含等于）。
 * 空字符串视为不安全。
 */
export function isSafePath(target: string, base: string): boolean {
  if (target === '' || base === '') return false;
  const resolvedBase = resolve(base);
  const normalized = resolve(resolvedBase, target);
  return isInsideBase(resolvedBase, normalized);
}

/**
 * 工作区包含检查：候选路径是否落在工作区根内（含等于）。
 * 与 path-manager `isPathInWorkspace` 同语义，但工作区根由调用方显式传入
 * （shell 层无 Electron / profile 依赖）。
 */
export function isPathInWorkspace(candidatePath: string, workspaceRoot: string): boolean {
  if (candidatePath === '' || workspaceRoot === '') return false;
  const resolvedBase = resolve(workspaceRoot);
  const normalized = resolve(resolvedBase, candidatePath);
  return isInsideBase(resolvedBase, normalized);
}

/** 条目名是否为裸盘符段（如 `C:`），zip/路径校验共用。 */
export function isDriveSegment(segment: string): boolean {
  return DRIVE_ONLY_RE.test(segment);
}

/** 是否 Windows 绝对路径（含盘符与 UNC），与平台无关的纯文本判定。 */
export function isWindowsAbsolute(p: string): boolean {
  return p.startsWith('\\\\') || DRIVE_LETTER_RE.test(p);
}

/** 确保目录存在（递归创建），返回解析后的绝对路径。 */
export async function ensureDir(dir: string): Promise<string> {
  const resolved = resolve(dir);
  await mkdir(resolved, { recursive: true });
  return resolved;
}
