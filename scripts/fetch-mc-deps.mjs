#!/usr/bin/env node
/**
 * MC 依赖下载脚本（Task 1.3：大二进制出库）。
 * 按 LOADER_VERSIONS 按需下载 loader/loom/gradle 到 ~/.cache/mc-creator，
 * 支持 MC_CREATOR_MIRROR 环境变量覆盖下载源，带 sha256 校验占位。
 *
 * 用法：
 *   node scripts/fetch-mc-deps.mjs [mcVersion] [loader]
 *   不传参数则下载所有 LOADER_VERSIONS 中的依赖
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, createWriteStream } from 'fs';
import { resolve, join } from 'path';
import { createHash } from 'crypto';
import https from 'https';
import http from 'http';

const ROOT = process.cwd();

// 读取 LOADER_VERSIONS 映射表
const loaderTypes = readFileSync(resolve(ROOT, 'packages/shared/src/types/loader.ts'), 'utf-8');

// 简单解析 LOADER_VERSIONS 对象（实际项目中可直接 import，这里避免 ESM/TS 编译）
function parseLoaderVersions(content) {
  const obj = {};
  const mcVersions = ['1.20.1', '1.20.4', '1.20.6', '1.21.1', '1.21.5', '1.21.11', '26.1', '26.2'];
  for (const mc of mcVersions) {
    const regex = new RegExp(`'${mc}':\\s*\\{([\\s\\S]*?)\\n\\s*\\},`);
    const match = content.match(regex);
    if (match) {
      const inner = match[1];
      const fields = {};
      for (const line of inner.split('\n')) {
        const m = line.match(/^\s*(\w+):\s*['"]([^'"]*)['"],?\s*$/);
        if (m) fields[m[1]] = m[2];
      }
      obj[mc] = fields;
    }
  }
  return obj;
}

const LOADER_VERSIONS = parseLoaderVersions(loaderTypes);

// 镜像配置
const MIRROR = process.env.MC_CREATOR_MIRROR || 'https://maven.fabricmc.net';

// 下载目录
const CACHE_DIR = join(process.env.HOME || process.env.USERPROFILE || '.', '.cache', 'mc-creator');
mkdirSync(CACHE_DIR, { recursive: true });

// 文件下载映射（根据 loader 版本构造 URL）
function buildDownloadUrls(mcVersion, loaderVersionConfig) {
  const urls = [];

  // Fabric
  if (loaderVersionConfig.fabricLoaderVersion) {
    urls.push({
      name: `fabric-loader-${loaderVersionConfig.fabricLoaderVersion}`,
      url: `${MIRROR}/net/fabricmc/fabric-loader/${loaderVersionConfig.fabricLoaderVersion}/fabric-loader-${loaderVersionConfig.fabricLoaderVersion}.jar`,
      sha256: '', // 占位：后续可填入真实校验和
    });
  }
  if (loaderVersionConfig.fabricApiVersion) {
    urls.push({
      name: `fabric-api-${loaderVersionConfig.fabricApiVersion}`,
      url: `${MIRROR}/net/fabricmc/fabric-api/${loaderVersionConfig.fabricApiVersion}/fabric-api-${loaderVersionConfig.fabricApiVersion}.jar`,
      sha256: '',
    });
  }
  if (
    loaderVersionConfig.fabricLoomVersion &&
    !loaderVersionConfig.fabricLoomVersion.includes('SNAPSHOT')
  ) {
    urls.push({
      name: `fabric-loom-${loaderVersionConfig.fabricLoomVersion}`,
      url: `${MIRROR}/net/fabricmc/fabric-loom/${loaderVersionConfig.fabricLoomVersion}/fabric-loom-${loaderVersionConfig.fabricLoomVersion}.jar`,
      sha256: '',
    });
  }

  // NeoForge
  if (
    loaderVersionConfig.neoforgeVersion &&
    !loaderVersionConfig.neoforgeVersion.includes('beta')
  ) {
    urls.push({
      name: `neoforge-${loaderVersionConfig.neoforgeVersion}`,
      url: `https://maven.neoforged.net/releases/net/neoforged/neoforge/${loaderVersionConfig.neoforgeVersion}/neoforge-${loaderVersionConfig.neoforgeVersion}.jar`,
      sha256: '',
    });
  }

  // Quilt
  if (loaderVersionConfig.quiltLoaderVersion) {
    urls.push({
      name: `quilt-loader-${loaderVersionConfig.quiltLoaderVersion}`,
      url: `https://maven.quiltmc.org/repository/release/org/quiltmc/quilt-loader/${loaderVersionConfig.quiltLoaderVersion}/quilt-loader-${loaderVersionConfig.quiltLoaderVersion}.jar`,
      sha256: '',
    });
  }
  if (loaderVersionConfig.quiltApiVersion) {
    urls.push({
      name: `quilt-api-${loaderVersionConfig.quiltApiVersion}`,
      url: `https://maven.quiltmc.org/repository/release/org/quiltmc/quilted-fabric-api/${loaderVersionConfig.quiltApiVersion}/quilted-fabric-api-${loaderVersionConfig.quiltApiVersion}.jar`,
      sha256: '',
    });
  }

  // Gradle Wrapper（按 MC 版本确定 Gradle 版本）
  const gradleVersionMap = {
    '1.20.1': '8.12',
    '1.20.4': '8.12',
    '1.20.6': '8.12',
    '1.21.1': '8.12',
    '1.21.5': '8.13',
    '1.21.11': '9.5.1',
    26.1: '9.5.1',
    26.2: '9.5.1',
  };
  const gradleVersion = gradleVersionMap[mcVersion] || '8.12';
  urls.push({
    name: `gradle-${gradleVersion}-bin`,
    url: `https://services.gradle.org/distributions/gradle-${gradleVersion}-bin.zip`,
    sha256: '',
  });

  return urls;
}

// 计算文件 sha256
function fileSha256(filePath) {
  const content = readFileSync(filePath);
  return createHash('sha256').update(content).digest('hex');
}

// 下载单个文件
function downloadFile(url, destPath, expectedSha256 = '') {
  return new Promise((resolve, reject) => {
    if (existsSync(destPath)) {
      if (expectedSha256) {
        const actual = fileSha256(destPath);
        if (actual === expectedSha256) {
          console.log(`✅ 已存在且校验通过: ${destPath}`);
          return resolve();
        }
        console.warn(`⚠️ 校验不匹配，重新下载: ${destPath}`);
      } else {
        console.log(`⏭️ 已存在，跳过: ${destPath}`);
        return resolve();
      }
    }

    console.log(`⬇️ 下载: ${url}`);
    const client = url.startsWith('https') ? https : http;
    const request = client.get(url, (res) => {
      if (res.statusCode === 302 || res.statusCode === 301) {
        const redirectUrl = res.headers.location;
        console.log(`🔄 重定向到: ${redirectUrl}`);
        return downloadFile(redirectUrl, destPath, expectedSha256).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode}: ${url}`));
      }
      // 确保文件存在（创建空文件）
      writeFileSync(destPath, '');
      const writeStream = createWriteStream(destPath);
      res.pipe(writeStream);
      writeStream.on('finish', () => {
        writeStream.close();
        if (expectedSha256) {
          const actual = fileSha256(destPath);
          if (actual !== expectedSha256) {
            return reject(
              new Error(`SHA256 校验失败: ${destPath} (期望 ${expectedSha256}, 实际 ${actual})`),
            );
          }
          console.log(`✅ 校验通过: ${destPath}`);
        } else {
          console.log(`✅ 下载完成: ${destPath}`);
        }
        resolve();
      });
      writeStream.on('error', reject);
    });
    request.on('error', reject);
    request.setTimeout(120000, () => reject(new Error('下载超时')));
  });
}

// 主流程
async function main() {
  const [, , mcVersionArg] = process.argv;
  console.log('=== MC Creator 依赖下载脚本 ===');
  console.log(`缓存目录: ${CACHE_DIR}`);
  console.log(`镜像源: ${MIRROR}`);
  console.log('');

  const targets = [];
  if (mcVersionArg && LOADER_VERSIONS[mcVersionArg]) {
    targets.push({ mcVersion: mcVersionArg, config: LOADER_VERSIONS[mcVersionArg] });
  } else if (mcVersionArg) {
    console.error(`❌ 未知 MC 版本: ${mcVersionArg}`);
    process.exit(1);
  } else {
    // 下载所有版本
    for (const [mc, config] of Object.entries(LOADER_VERSIONS)) {
      targets.push({ mcVersion: mc, config });
    }
  }

  let success = 0;
  let failed = 0;

  for (const { mcVersion, config } of targets) {
    console.log(`\n--- MC ${mcVersion} ---`);
    const urls = buildDownloadUrls(mcVersion, config);

    for (const { name, url, sha256 } of urls) {
      const destPath = join(CACHE_DIR, `${name}.${url.endsWith('.zip') ? 'zip' : 'jar'}`);
      try {
        await downloadFile(url, destPath, sha256);
        success++;
      } catch (err) {
        console.error(`❌ 下载失败 (${name}): ${err.message}`);
        failed++;
      }
    }
  }

  console.log('\n=== 完成 ===');
  console.log(`成功: ${success}`);
  console.log(`失败: ${failed}`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error('致命错误:', err);
  process.exit(1);
});
