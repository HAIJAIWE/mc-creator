import type { FileNode } from '@mc-creator/shared';

/**
 * B 桥文件的合并策略（纯函数，可独立测试）：
 *
 * 节点图「编译并应用」后，用新生成的文件更新 modStore.files，同时保护用户手改：
 * - 覆盖：generated 中 path 不在 dirtySet 的文件 → 用新内容
 * - 保留：path 在 dirtySet 的生成文件 → 用 existing 旧内容（进入 preserved，供 UI 提示）
 * - 淘汰：existing 有、generated 无、且非 dirty 的文件 → 移除；dirty 的保留
 */
export interface MergeGeneratedFilesResult {
  files: FileNode[];
  /** 被保留的手改文件 path（UI 提示用） */
  preserved: string[];
}

export function mergeGeneratedFiles(
  generated: FileNode[],
  existing: FileNode[],
  dirtySet: Set<string>,
): MergeGeneratedFilesResult {
  const preserved: string[] = [];
  const generatedByPath = new Map(generated.map((f) => [f.path, f]));
  const existingByPath = new Map(existing.map((f) => [f.path, f]));

  const files: FileNode[] = [];

  // 1) 生成产物：非 dirty 用新内容；dirty 保留手改内容
  for (const f of generated) {
    if (dirtySet.has(f.path) && existingByPath.has(f.path)) {
      files.push(existingByPath.get(f.path)!);
      preserved.push(f.path);
    } else {
      files.push(f);
    }
  }

  // 2) 淘汰的旧文件：保留其中被手改过的（防止手改内容丢失）
  for (const [path, f] of existingByPath) {
    if (generatedByPath.has(path)) continue;
    if (dirtySet.has(path)) {
      files.push(f);
      preserved.push(path);
    }
  }

  return { files, preserved };
}
