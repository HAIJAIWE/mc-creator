import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync, writeFileSync } from 'fs';
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

import {
  loadModelConfig,
  saveModelConfig,
  loadModelProfiles,
  saveModelProfiles,
  testModelConnection,
} from './model-config.js';

describe('model-config（多套配置 + safeStorage 加密）', () => {
  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'mc-mc-'));
    encryptionAvailable = true;
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('无配置文件：profiles 为空，loadModelConfig 返回默认', () => {
    expect(loadModelProfiles().profiles).toHaveLength(0);
    const cfg = loadModelConfig();
    expect(cfg.name).toBe('OpenAI');
    expect(cfg.modelId).toBe('gpt-4o-mini');
    expect(cfg.apiKey).toBe('');
  });

  it('saveModelConfig → loadModelConfig round-trip 保留所有字段（apiKey 明文还原）', async () => {
    await saveModelConfig({
      name: 'DeepSeek',
      modelId: 'deepseek-chat',
      baseURL: 'https://api.deepseek.com/v1',
      apiKey: 'sk-secret-123',
    });
    const cfg = loadModelConfig();
    expect(cfg.name).toBe('DeepSeek');
    expect(cfg.modelId).toBe('deepseek-chat');
    expect(cfg.apiKey).toBe('sk-secret-123');
    // 迁移后的 active profile id = default
    expect(loadModelProfiles().activeId).toBe('default');
  });

  it('落盘文件为 profiles 结构，apiKey 以 enc: 前缀存储（非明文）', async () => {
    await saveModelConfig({ name: 'x', modelId: 'm', baseURL: 'u', apiKey: 'sk-plain' });
    const raw = readFileSync(join(tmpDir, 'model-config.json'), 'utf-8');
    const stored = JSON.parse(raw);
    expect(Array.isArray(stored.profiles)).toBe(true);
    expect(stored.profiles[0].apiKey).toMatch(/^enc:/);
    expect(stored.profiles[0].apiKey).not.toContain('sk-plain');
    expect(stored.activeId).toBe('default');
  });

  it('多套配置并存：saveModelProfiles 保留多套，按 activeId 切换生效', async () => {
    await saveModelProfiles(
      [
        {
          id: 'p1',
          name: 'DeepSeek',
          modelId: 'deepseek-chat',
          baseURL: 'https://api.deepseek.com/v1',
          apiKey: 'k1',
        },
        {
          id: 'p2',
          name: '通义',
          modelId: 'qwen-plus',
          baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
          apiKey: 'k2',
        },
      ],
      'p1',
    );
    expect(loadModelProfiles().profiles).toHaveLength(2);
    expect(loadModelConfig().modelId).toBe('deepseek-chat');

    await saveModelProfiles(loadModelProfiles().profiles, 'p2');
    expect(loadModelConfig().modelId).toBe('qwen-plus');
    // 多套的 key 均加密存储
    const raw = JSON.parse(readFileSync(join(tmpDir, 'model-config.json'), 'utf-8'));
    for (const p of raw.profiles) {
      expect(p.apiKey).toMatch(/^enc:/);
    }
  });

  it('saveModelConfig 更新已有 active profile（不新增重复项）', async () => {
    await saveModelConfig({
      name: 'DeepSeek',
      modelId: 'deepseek-chat',
      baseURL: 'u',
      apiKey: 'k1',
    });
    await saveModelConfig({
      name: 'DeepSeek',
      modelId: 'deepseek-reasoner',
      baseURL: 'u',
      apiKey: 'k2',
    });
    const { profiles } = loadModelProfiles();
    expect(profiles).toHaveLength(1);
    expect(profiles[0].modelId).toBe('deepseek-reasoner');
  });

  it('旧单配置文件自动迁移为 default profile', () => {
    writeFileSync(
      join(tmpDir, 'model-config.json'),
      JSON.stringify({
        name: '旧版',
        modelId: 'gpt-4o',
        baseURL: 'https://api.openai.com/v1',
        apiKey: 'enc:ABC',
      }),
      'utf-8',
    );
    const { profiles, activeId } = loadModelProfiles();
    expect(profiles).toHaveLength(1);
    expect(profiles[0].name).toBe('旧版');
    expect(profiles[0].modelId).toBe('gpt-4o');
    expect(activeId).toBe('default');
  });

  it('encryptionAvailable=false 时退化为明文存储', async () => {
    encryptionAvailable = false;
    await saveModelProfiles(
      [{ id: 'x', name: 'x', modelId: 'm', baseURL: 'u', apiKey: 'sk-plain' }],
      'x',
    );
    const raw = JSON.parse(readFileSync(join(tmpDir, 'model-config.json'), 'utf-8'));
    expect(raw.profiles[0].apiKey).toBe('sk-plain');
    expect(loadModelConfig().apiKey).toBe('sk-plain');
  });

  it('空 apiKey 不加密（保持空串）', async () => {
    await saveModelConfig({ name: 'x', modelId: 'm', baseURL: 'u', apiKey: '' });
    const raw = JSON.parse(readFileSync(join(tmpDir, 'model-config.json'), 'utf-8'));
    expect(raw.profiles[0].apiKey).toBe('');
  });

  it('文件损坏时返回空 profiles 与默认配置', () => {
    writeFileSync(join(tmpDir, 'model-config.json'), '{ not json', 'utf-8');
    expect(loadModelProfiles().profiles).toHaveLength(0);
    expect(loadModelConfig().name).toBe('OpenAI');
  });

  it('解密失败（enc: 前缀但内容非法）时返回空 apiKey', () => {
    writeFileSync(
      join(tmpDir, 'model-config.json'),
      JSON.stringify({
        profiles: [
          { id: 'd', name: 'x', modelId: 'm', baseURL: 'u', apiKey: 'enc:!!!invalid-base64!!!' },
        ],
        activeId: 'd',
      }),
      'utf-8',
    );
    expect(loadModelConfig().apiKey).toBe('');
    expect(loadModelConfig().name).toBe('x');
  });

  it('save 创建 userData 目录（如不存在）', async () => {
    await expect(
      saveModelConfig({ name: 'a', modelId: 'b', baseURL: 'c', apiKey: 'd' }),
    ).resolves.not.toThrow();
    expect(existsSync(join(tmpDir, 'model-config.json'))).toBe(true);
  });

  it('testModelConnection：200 返回成功与模型名', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ model: 'deepseek-chat' }),
    }));
    vi.stubGlobal('fetch', fetchMock);
    const r = await testModelConnection('https://api.deepseek.com/v1', 'deepseek-chat', 'sk-x');
    expect(r.ok).toBe(true);
    expect(r.message).toContain('deepseek-chat');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.deepseek.com/v1/chat/completions',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer sk-x' }),
      }),
    );
    vi.unstubAllGlobals();
  });

  it('testModelConnection：HTTP 401 返回失败与错误详情', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 401,
        json: async () => ({ error: { message: 'Invalid API key' } }),
      })),
    );
    const r = await testModelConnection('u', 'm', 'bad');
    expect(r.ok).toBe(false);
    expect(r.message).toContain('401');
    expect(r.message).toContain('Invalid API key');
    vi.unstubAllGlobals();
  });

  it('testModelConnection：网络错误返回失败信息', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Promise.reject(new Error('ECONNREFUSED'))),
    );
    const r = await testModelConnection('u', 'm', 'x');
    expect(r.ok).toBe(false);
    expect(r.message).toContain('ECONNREFUSED');
    vi.unstubAllGlobals();
  });
});
