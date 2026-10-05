'use strict';

/**
 * Job Object 原生模块加载器（设计文档 §8.3）。
 *
 * ## 铁律：import 永不抛错
 *
 * 缺失或损坏的二进制**不允许**让 require('@mc-creator/jobobject') 炸掉。
 * 理由有两条，都是本仓踩过的坑：
 *
 * 1. isolated-vm 曾在 Electron 44 上因 ABI 不匹配而 require 必抛（MEMORY §2-③）。
 *    如果加载器在这里就抛，整个主进程起不来 —— 一个「可选的加固组件」
 *    变成了「单点启动故障」。
 * 2. MEMORY §2-④：回退路径是攻击面的组成部分。这里如果静默 fallback 而不告知，
 *    就会重演「加固只覆盖成功路径」的老问题。
 *
 * 所以本模块的契约是：**加载失败 = available=false + 一个说得清的 reason**，
 * 由调用方决定降级策略并把「未强制」如实暴露出去，绝不假装已隔离。
 */

const fs = require('node:fs');
const path = require('node:path');

/** N-API 预编译不带 abi 标签（与 node-pty 同理），故只需 platform-arch 目录。 */
const PREBUILD_DIR = path.join(__dirname, 'prebuilds', `${process.platform}-${process.arch}`);

/**
 * 候选加载顺序：
 * 1. prebuilds/<platform>-<arch>/jobobject.node —— 预编译产物
 * 2. build/Release|Debug/jobobject.node        —— 本机 node-gyp 现场编的
 */
function candidatePaths() {
  return [
    path.join(PREBUILD_DIR, 'jobobject.node'),
    path.join(__dirname, 'build', 'Release', 'jobobject.node'),
    path.join(__dirname, 'build', 'Debug', 'jobobject.node'),
  ];
}

function loadBinding() {
  if (process.platform !== 'win32') {
    return { binding: null, path: null, reason: `平台 ${process.platform} 不支持 Job Object` };
  }
  const tried = [];
  for (const candidate of candidatePaths()) {
    if (!fs.existsSync(candidate)) {
      tried.push(path.relative(__dirname, candidate));
      continue;
    }
    try {
      // 路径是运行时算出来的（prebuilds → build/Release → build/Debug），
      // 所以只能动态 require；no-require-imports 已对本包关闭（见 eslint.config.mjs）。
      return { binding: require(candidate), path: candidate, reason: null };
    } catch (err) {
      // 存在但加载失败（架构不符 / 缺 DLL / 文件损坏）——比「不存在」更值得报警。
      return {
        binding: null,
        path: candidate,
        reason: `加载 ${path.relative(__dirname, candidate)} 失败: ${err.message}`,
      };
    }
  }
  return {
    binding: null,
    path: null,
    reason:
      `未找到已编译的 jobobject.node（试过: ${tried.join(', ')}）。` +
      '在装有 MSVC 的机器上执行 `pnpm --filter @mc-creator/jobobject build:addon` 生成。',
  };
}

const loaded = loadBinding();

/** 平台是否支持（不代表二进制可用）。 */
const supportedPlatform = process.platform === 'win32';

/** 二进制是否真的可用。false 时所有 API 调用都会抛，必须由调用方先判。 */
const available = loaded.binding !== null;

const API = [
  'createJob',
  'spawnInJob',
  'waitForExit',
  'terminateTree',
  'isInJob',
  'closeChild',
  'closeJob',
];

/**
 * 统一入口：不可用时抛出**带原因**的错误，而不是 "x is not a function"。
 * 后者会让人误以为是代码写错，而真实原因是「这台机器没编出二进制」。
 */
function call(name, args) {
  if (!available) {
    throw new Error(`[jobobject] 原生模块不可用（${loaded.reason}），无法调用 ${name}()`);
  }
  return loaded.binding[name](...args);
}

module.exports = {
  available,
  supportedPlatform,
  /** 不可用的具体原因；可用时为 null。 */
  reason: loaded.reason,
  /** 实际加载到的二进制路径；未加载时为 null。便于诊断「装的是哪份」。 */
  binaryPath: loaded.path,
  createJob: (maxMemoryMb, maxCpuCores) => call('createJob', [maxMemoryMb, maxCpuCores]),
  /**
   * @param inheritStdio true 时子进程继承本进程的 stdout/stderr/ stdin。
   *   launcher 必须传 true，否则 Gradle 日志收不到（详见 binding.cc 同名注释）。
   */
  spawnInJob: (job, file, args, cwd, inheritStdio) =>
    call('spawnInJob', [job, file, args, cwd ?? null, inheritStdio === true]),
  /**
   * @param timeoutMs `0` = 立即返回的轮询；`<0` = 无限等；`>0` = 等这么多毫秒。
   *   反过来设计过一次（0 当成无限等），代价是调用方的轮询会永久阻塞。
   */
  waitForExit: (child, timeoutMs) => call('waitForExit', [child, timeoutMs]),
  /** 返回诊断对象 {ok, lastError, activeBefore, activeProcesses}，不是裸 boolean。 */
  terminateTree: (child) => call('terminateTree', [child]),
  isInJob: (child) => call('isInJob', [child]),
  closeChild: (child) => (available ? loaded.binding.closeChild(child) : undefined),
  closeJob: (job) => (available ? loaded.binding.closeJob(job) : undefined),
  API,
};
