import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

let tmpDir: string;
let encryptionAvailable = true;

// 简单的可逆 cipher 模拟 safeStorage（与 model-config.test.ts 一致）
const enc = (s: string) => Buffer.from(`ENC(${s})`, 'utf-8');
const dec = (b: Buffer) => {
  const s = b.toString('utf-8');
  return s.startsWith('ENC(') && s.endsWith(')') ? s.slice(4, -1) : '';
};

vi.mock('electron', () => ({
  app: { getPath: () => tmpDir },
  safeStorage: {
    isEncryptionAvailable: () => encryptionAvailable,
    encryptString: (s: string) => enc(s),
    decryptString: (b: Buffer) => dec(b),
  },
}));

import { loadCurseForgeConfig, saveCurseForgeConfig } from './curseforge-config.js';

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'curseforge-cfg-'));
  encryptionAvailable = true;
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('curseforge-config', () => {
  it('无配置文件返回默认 { apiKey: "" }', () => {
    expect(loadCurseForgeConfig()).toEqual({ apiKey: '' });
  });

  it('save → load round-trip', () => {
    saveCurseForgeConfig({ apiKey: 'my-curseforge-key-123' });
    expect(loadCurseForgeConfig()).toEqual({ apiKey: 'my-curseforge-key-123' });
  });

  it('落盘文件 apiKey 以 enc: 前缀存储（密文不可读出明文）', () => {
    saveCurseForgeConfig({ apiKey: 'plaintext-secret' });
    const raw = readFileSync(join(tmpDir, 'curseforge-config.json'), 'utf-8');
    const parsed = JSON.parse(raw);
    expect(parsed.apiKey).toMatch(/^enc:/);
    expect(parsed.apiKey).not.toContain('plaintext-secret');
  });

  it('encryptionAvailable=false 时降级为明文存储', () => {
    encryptionAvailable = false;
    saveCurseForgeConfig({ apiKey: 'plain-key' });
    const raw = readFileSync(join(tmpDir, 'curseforge-config.json'), 'utf-8');
    const parsed = JSON.parse(raw);
    expect(parsed.apiKey).toBe('plain-key');
    expect(loadCurseForgeConfig()).toEqual({ apiKey: 'plain-key' });
  });

  it('空 apiKey 不加密（落盘为空串）', () => {
    saveCurseForgeConfig({ apiKey: '' });
    const raw = readFileSync(join(tmpDir, 'curseforge-config.json'), 'utf-8');
    const parsed = JSON.parse(raw);
    expect(parsed.apiKey).toBe('');
    expect(loadCurseForgeConfig()).toEqual({ apiKey: '' });
  });

  it('文件损坏（非法 JSON）返回默认', () => {
    const file = join(tmpDir, 'curseforge-config.json');
    writeFileSync(file, '{ not valid json', 'utf-8');
    expect(loadCurseForgeConfig()).toEqual({ apiKey: '' });
  });

  it('解密失败返回空 apiKey', () => {
    // 写入一个 enc: 前缀但内容无法被 cipher 还原的文件
    const file = join(tmpDir, 'curseforge-config.json');
    writeFileSync(
      file,
      JSON.stringify({ apiKey: 'enc:bm90LWEtcmVhbC1jaXBoZXI=' }, null, 2),
      'utf-8',
    );
    // 我们的 mock dec 只识别 ENC(...) 格式，base64 解出来不是 ENC(...) → 返回空
    expect(loadCurseForgeConfig()).toEqual({ apiKey: '' });
  });

  it('save 创建 userData 目录（若不存在）', () => {
    // tmpDir 已存在，删除后测试 save 能否重建
    rmSync(tmpDir, { recursive: true, force: true });
    expect(existsSync(tmpDir)).toBe(false);
    saveCurseForgeConfig({ apiKey: 'after-recreate' });
    expect(existsSync(tmpDir)).toBe(true);
    expect(loadCurseForgeConfig()).toEqual({ apiKey: 'after-recreate' });
  });
});
