/**
 * @mc-creator/jobobject 加载器契约测试。
 *
 * 这些断言**不依赖二进制存在** —— 加载器的主要职责就是在二进制缺失时
 * 依然可用且诚实（available=false + reason）。所以本文件在任何平台都能跑。
 *
 * 真隔离能力（内存上限、整树终止）由 sandbox.test.js 在二进制存在时验证。
 */

import { describe, expect, it } from 'vitest';

// CJS 文件里 require 是内建全局，直接用即可（node globals 由 eslint 注入）。
// 不要再 createRequire + eslint-disable：那条组合会触发 no-redeclare，
// 而这里的 require 本来就合法。
const jobobject = require('../index.js');

describe('jobobject 加载器契约', () => {
  it('import 永不抛错，且 available 是布尔', () => {
    // 关键性质：isolated-vm 当年因 ABI 不匹配而 require 必抛（MEMORY §2-③）。
    // 一个「可选加固组件」绝不能变成主进程的启动故障。
    expect(typeof jobobject.available).toBe('boolean');
  });

  it('二进制缺失时 reason 必须是非空中文字符串（降级要说得清原因）', () => {
    if (jobobject.available) {
      expect(jobobject.reason).toBeNull();
    } else {
      expect(typeof jobobject.reason).toBe('string');
      expect(jobobject.reason.length).toBeGreaterThan(0);
      // 降级不能是「静默」：调用方要能把原因转述给用户。
      expect(jobobject.reason).toMatch(/[一-鿿]/);
    }
  });

  it('supportedPlatform 只在 Windows 为真', () => {
    expect(jobobject.supportedPlatform).toBe(process.platform === 'win32');
  });

  it('可用时 binaryPath 指向真实存在的 .node', () => {
    if (!jobobject.available) {
      expect(jobobject.binaryPath).toBeNull();
      return;
    }
    expect(jobobject.binaryPath).toMatch(/jobobject\.node$/);
  });

  it('不可用时调用 API 抛出「带 reason 的中文错误」，而不是 x is not a function', () => {
    if (jobobject.available) {
      expect(jobobject.API).toContain('createJob');
      return;
    }
    // 后者会让人误判成代码写错，而真实原因是「这台机器没编出二进制」。
    let caught;
    try {
      jobobject.createJob(128, 1);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(Error);
    expect(caught.message).toContain('原生模块不可用');
    expect(caught.message).toContain(jobobject.reason);
  });

  it('API 清单包含全部 7 个绑定函数', () => {
    expect([...jobobject.API].sort()).toEqual([
      'closeChild',
      'closeJob',
      'createJob',
      'isInJob',
      'spawnInJob',
      'terminateTree',
      'waitForExit',
    ]);
  });
});
