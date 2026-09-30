#!/usr/bin/env node
/**
 * 包体积检查脚本（Task 3.2 性能预算）。
 * 解析构建产物，检查单 chunk < 1.5MB、总 JS < 8MB。
 */

import { existsSync, readdirSync, statSync } from 'fs';
import { resolve, join } from 'path';

const OUT_DIR = resolve('apps/desktop/out/renderer');

// 阈值配置
const MAX_CHUNK_SIZE = 1.5 * 1024 * 1024; // 1.5 MB
const MAX_TOTAL_JS_SIZE = 8 * 1024 * 1024; // 8 MB

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function scanDir(dir) {
  const files = [];
  if (!statSync(dir).isDirectory()) return files;

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...scanDir(fullPath));
    } else if (entry.isFile() && (entry.name.endsWith('.js') || entry.name.endsWith('.mjs'))) {
      const size = statSync(fullPath).size;
      files.push({ path: fullPath, size, name: entry.name });
    }
  }
  return files;
}

function main() {
  console.log('=== 包体积检查 ===');
  console.log(`输出目录: ${OUT_DIR}`);
  console.log(`单 chunk 阈值: ${formatBytes(MAX_CHUNK_SIZE)}`);
  console.log(`总 JS 阈值: ${formatBytes(MAX_TOTAL_JS_SIZE)}`);
  console.log('');

  if (!existsSync(OUT_DIR)) {
    console.error(`❌ 构建产物目录不存在: ${OUT_DIR}`);
    console.log('请先运行 `pnpm --filter @mc-creator/desktop build`');
    process.exit(1);
  }

  const jsFiles = scanDir(OUT_DIR);

  if (jsFiles.length === 0) {
    console.error('❌ 未找到任何 JS 文件');
    process.exit(1);
  }

  let totalSize = 0;
  let oversizedChunks = [];

  for (const file of jsFiles) {
    totalSize += file.size;
    if (file.size > MAX_CHUNK_SIZE) {
      oversizedChunks.push(file);
    }
  }

  console.log(`JS 文件数: ${jsFiles.length}`);
  console.log(`总大小: ${formatBytes(totalSize)}`);
  console.log('');

  // 单 chunk 检查
  if (oversizedChunks.length > 0) {
    console.error('❌ 超大 chunk 检测:');
    for (const chunk of oversizedChunks) {
      console.error(
        `  - ${chunk.name}: ${formatBytes(chunk.size)} (阈值: ${formatBytes(MAX_CHUNK_SIZE)})`,
      );
    }
  } else {
    console.log('✅ 所有 chunk 均在阈值内');
  }

  // 总大小检查
  if (totalSize > MAX_TOTAL_JS_SIZE) {
    console.error(
      `❌ 总 JS 大小超标: ${formatBytes(totalSize)} > ${formatBytes(MAX_TOTAL_JS_SIZE)}`,
    );
  } else {
    console.log(
      `✅ 总 JS 大小在阈值内: ${formatBytes(totalSize)} <= ${formatBytes(MAX_TOTAL_JS_SIZE)}`,
    );
  }

  console.log('');
  console.log('=== Top 10 最大文件 ===');
  jsFiles
    .sort((a, b) => b.size - a.size)
    .slice(0, 10)
    .forEach((f, i) => {
      console.log(`  ${i + 1}. ${f.name}: ${formatBytes(f.size)}`);
    });

  if (oversizedChunks.length > 0 || totalSize > MAX_TOTAL_JS_SIZE) {
    console.log('');
    console.error('❌ 包体积检查失败');
    process.exit(1);
  } else {
    console.log('');
    console.log('✅ 包体积检查通过');
    process.exit(0);
  }
}

main();
