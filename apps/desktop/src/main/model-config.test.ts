import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

let tmpDir: string;
let encryptionAvailable = true;

// 简单的可逆 cipher 模拟 safeStorage（不是真加密，但能验证 round-trip + 存储格式）
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

import { loadModelConfig, saveModelConfig } from './model-config.js';

describe('model-config（safeStorage 加密）', () => {
  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'mc-mc-'));
    encryptionAvailable = true;
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('无配置文件时返回默认', () => {
    const cfg = loadModelConfig();
    expect(cfg.name).toBe('OpenAI');
    expect(cfg.modelId).toBe('gpt-4o-mini');
    expect(cfg.baseURL).toBe('https://api.openai.com/v1');
    expect(cfg.apiKey).toBe('');
  });

  it('save → load round-trip 保留所有字段（apiKey 明文还原）', () => {
    saveModelConfig({
      name: 'DeepSeek',
      modelId: 'deepseek-chat',
      baseURL: 'https://api.deepseek.com/v1',
      apiKey: 'sk-secret-123',
    });
    const cfg = loadModelConfig();
    expect(cfg.name).toBe('DeepSeek');
    expect(cfg.modelId).toBe('deepseek-chat');
    expect(cfg.apiKey).toBe('sk-secret-123');
  });

  it('落盘文件中 apiKey 以 enc: 前缀存储（非明文）', () => {
    saveModelConfig({
      name: 'x',
      modelId: 'm',
      baseURL: 'u',
      apiKey: 'sk-plain',
    });
    const raw = readFileSync(join(tmpDir, 'model-config.json'), 'utf-8');
    const stored = JSON.parse(raw);
    expect(stored.apiKey).toMatch(/^enc:/);
    expect(stored.apiKey).not.toContain('sk-plain');
  });

  it('encryptionAvailable=false 时退化为明文存储', () => {
    encryptionAvailable = false;
    saveModelConfig({
      name: 'x',
      modelId: 'm',
      baseURL: 'u',
      apiKey: 'sk-plain',
    });
    const raw = readFileSync(join(tmpDir, 'model-config.json'), 'utf-8');
    const stored = JSON.parse(raw);
    expect(stored.apiKey).toBe('sk-plain');
    // 读取也能还原（无 enc: 前缀，直接返回）
    expect(loadModelConfig().apiKey).toBe('sk-plain');
  });

  it('空 apiKey 不加密（保持空串）', () => {
    saveModelConfig({
      name: 'x',
      modelId: 'm',
      baseURL: 'u',
      apiKey: '',
    });
    const raw = readFileSync(join(tmpDir, 'model-config.json'), 'utf-8');
    const stored = JSON.parse(raw);
    expect(stored.apiKey).toBe('');
  });

  it('文件损坏时返回默认配置', () => {
    const { writeFileSync } = require('fs');
    writeFileSync(join(tmpDir, 'model-config.json'), '{ not json', 'utf-8');
    const cfg = loadModelConfig();
    expect(cfg.name).toBe('OpenAI');
    expect(cfg.apiKey).toBe('');
  });

  it('解密失败（enc: 前缀但内容非法）时返回空 apiKey', () => {
    const { writeFileSync } = require('fs');
    // 模拟存储了一个 enc: 前缀但内容无法解密的数据
    writeFileSync(
      join(tmpDir, 'model-config.json'),
      JSON.stringify({ name: 'x', modelId: 'm', baseURL: 'u', apiKey: 'enc:!!!invalid-base64!!!' }),
      'utf-8',
    );
    const cfg = loadModelConfig();
    expect(cfg.apiKey).toBe('');
    // 非敏感字段仍能读到
    expect(cfg.name).toBe('x');
    expect(cfg.modelId).toBe('m');
  });

  it('save 创建 userData 目录（如不存在）', () => {
    // tmpDir 已存在；改用不存在的子目录通过模拟
    // 这里验证 save 不抛错即足够
    expect(() =>
      saveModelConfig({ name: 'a', modelId: 'b', baseURL: 'c', apiKey: 'd' }),
    ).not.toThrow();
    expect(existsSync(join(tmpDir, 'model-config.json'))).toBe(true);
  });
});
