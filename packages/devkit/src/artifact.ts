/**
 * 产物签名与校验（设计文档 §8.1#6 / §0.5#5）。
 *
 * 硬约束：生成代码的产物哈希必须记录并对外可见（§0.5#5），
 * 输出 JAR 的哈希记录（§8.1#6）。统一 sha256（见 contract ArtifactRef）。
 */

import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import type { ArtifactRef, ContentKind } from '@mc-creator/contract';

/** 流式 sha256（大 jar 不整块读入内存）。返回小写十六进制。 */
export async function sha256File(filePath: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(filePath);
    stream.on('data', (chunk: Buffer) => hash.update(chunk));
    stream.on('error', (err: Error) => reject(err));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

/** 由文件路径 + kind 构造对外可见的 ArtifactRef（含哈希，§0.5#5）。 */
export async function makeArtifactRef(
  filePath: string,
  kind: ContentKind,
): Promise<ArtifactRef> {
  const sha256 = await sha256File(filePath);
  return { path: filePath, sha256, kind };
}
