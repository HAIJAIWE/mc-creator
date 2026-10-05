#!/usr/bin/env node
'use strict';

/**
 * 编译原生模块（设计文档 §8.3）。
 *
 * ## 铁律：本脚本永远 exit 0
 *
 * `pnpm install` 挂掉会连带整条 CI 挂掉，而这里的失败模式是「某台机器没装
 * MSVC」这种与代码质量无关的环境问题。仓里已有先例：electron-builder 的
 * `npmRebuild: false` 就是为了「在无 MSVC 工具链的机器与 CI 上开着会让
 * 打包直接失败」（见 apps/desktop/electron-builder.yml）。
 *
 * 所以：**编不出来不是错误，降级才是正确行为**。加载器会把 available 置 false
 * 并给出中文原因，由执行器把「未强制」如实暴露到返回值/UI —— 而不是崩掉，
 * 也不是假装已隔离（MEMORY §2-④：回退路径是攻击面的组成部分）。
 *
 * 用法：
 *   node scripts/install.js           # 缺产物时才编（install 钩子）
 *   node scripts/install.js --force   # 强制重编（改了 C++ 之后）
 */

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const PKG_ROOT = path.resolve(__dirname, '..');
const FORCE = process.argv.includes('--force');

function log(msg) {
  process.stdout.write(`[jobobject] ${msg}\n`);
}

/** 依次尝试：本地 devDep → npm 内置 → PATH。 */
function resolveNodeGyp() {
  const attempts = [];

  try {
    attempts.push(require.resolve('node-gyp/bin/node-gyp.js', { paths: [PKG_ROOT] }));
  } catch {
    /* 未安装为 devDep */
  }

  // npm 自带 node-gyp：沿 node 可执行文件位置找，pnpm/npm 生命周期里都可用。
  const npmBundled = path.join(
    path.dirname(process.execPath),
    'node_modules',
    'npm',
    'node_modules',
    'node-gyp',
    'bin',
    'node-gyp.js',
  );
  if (fs.existsSync(npmBundled)) attempts.push(npmBundled);

  for (const candidate of attempts) {
    if (fs.existsSync(candidate)) return { cmd: process.execPath, args: [candidate] };
  }

  const onPath = spawnSync('node-gyp', ['--version'], { encoding: 'utf8', shell: false });
  if (onPath.status === 0) return { cmd: 'node-gyp', args: [] };
  return null;
}

function main() {
  if (process.platform !== 'win32') {
    log(`跳过：Job Object 是 Windows 专有机制（当前 ${process.platform}）。`);
    return;
  }

  const release = path.join(PKG_ROOT, 'build', 'Release', 'jobobject.node');
  const prebuilt = path.join(
    PKG_ROOT,
    'prebuilds',
    `${process.platform}-${process.arch}`,
    'jobobject.node',
  );
  if (!FORCE && (fs.existsSync(release) || fs.existsSync(prebuilt))) {
    log('已存在编译产物，跳过（改过 C++ 请用 build:addon 强制重编）。');
    return;
  }

  const gyp = resolveNodeGyp();
  if (gyp === null) {
    log(
      '跳过：找不到 node-gyp。装 MSVC 构建工具后执行 `pnpm --filter @mc-creator/jobobject build:addon`。',
    );
    return;
  }

  log('编译 jobobject.node …');
  const r = spawnSync(gyp.cmd, [...gyp.args, 'rebuild'], {
    cwd: PKG_ROOT,
    stdio: 'inherit',
    shell: false,
  });

  if (r.status === 0 && fs.existsSync(release)) {
    log(`编译成功：${path.relative(PKG_ROOT, release)}`);
    return;
  }

  // 故意不 exit(1)：见文件头「铁律」。
  log(
    `编译未成功（退出码 ${r.status}）。这通常是没装 MSVC C++ 工具链。` +
      '应用仍可运行，但 §8.3 的内存/CPU 上限与整树终止会降级为未强制。',
  );
}

try {
  main();
} catch (err) {
  log(`install 钩子异常（已忽略）：${err.message}`);
}
process.exit(0);
