import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { BedrockKernel } from './kernel.js';

const IS_WIN = process.platform === 'win32';
const OVERRIDE_KEY = 'COM_MOJANG_DIR';

describe('BedrockKernel dispatch 只读任务（get_target_state / get_capabilities）', () => {
  const dirs: string[] = [];
  const savedEnv: Array<[string, string | undefined]> = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
    for (const [k, v] of savedEnv.splice(0)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });
  const mkTmp = (): string => {
    const d = mkdtempSync(join(tmpdir(), 'bedrock-kernel-'));
    dirs.push(d);
    return d;
  };
  const setOverride = (value: string | undefined): void => {
    savedEnv.push([OVERRIDE_KEY, process.env[OVERRIDE_KEY]]);
    if (value === undefined) delete process.env[OVERRIDE_KEY];
    else process.env[OVERRIDE_KEY] = value;
  };

  it('未知 kind → ok:false + unknown 分类 + message 含 kind + retryable:false', async () => {
    const handle = new BedrockKernel().dispatch({ id: 'u1', kind: 'nope_xyz', payload: null });
    expect(handle.id).toBe('u1');
    await expect(handle.result()).resolves.toEqual({
      ok: false,
      error: { category: 'unknown', message: '不支持的任务: nope_xyz', retryable: false },
    });
  });

  it('get_capabilities → ok:true + data 透传能力表', async () => {
    const result = await new BedrockKernel()
      .dispatch({ id: 'c1', kind: 'get_capabilities', payload: null })
      .result();
    expect(result.ok).toBe(true);
    expect((result.data as { capabilities: unknown[] }).capabilities.length).toBeGreaterThan(0);
  });

  it('get_target_state 结果形状正确（ok boolean；失败必带 error.message）', async () => {
    const result = await new BedrockKernel()
      .dispatch({ id: 't0', kind: 'get_target_state', payload: null })
      .result();
    expect(typeof result.ok).toBe('boolean');
    if (!result.ok) {
      expect(typeof result.error?.message).toBe('string');
      expect(result.error?.message.length).toBeGreaterThan(0);
    }
  });

  it('非 Windows 直接返回 ok:false + unknown（仅 Windows）；Windows 上跳过此断言', async () => {
    if (IS_WIN) return;
    const result = await new BedrockKernel()
      .dispatch({ id: 't1', kind: 'get_target_state', payload: null })
      .result();
    expect(result).toMatchObject({ ok: false, error: { category: 'unknown', retryable: false } });
    expect(result.error?.message).toMatch(/Windows/);
  });

  it('Windows 上覆盖目录存在 → ok:true；非 Windows 仅断言 unknown 形状', async () => {
    if (!IS_WIN) {
      const result = await new BedrockKernel()
        .dispatch({ id: 't2', kind: 'get_target_state', payload: null })
        .result();
      expect(result.ok).toBe(false);
      return;
    }
    const dir = mkTmp();
    mkdirSync(join(dir, 'com.mojang'), { recursive: true });
    setOverride(join(dir, 'com.mojang'));
    const result = await new BedrockKernel()
      .dispatch({ id: 't2', kind: 'get_target_state', payload: null })
      .result();
    expect(result).toMatchObject({ ok: true });
    const data = result.data as { comMojangDir: string; candidates: string[] };
    expect(data.comMojangDir).toBe(join(dir, 'com.mojang'));
    expect(data.candidates).toContain(join(dir, 'com.mojang'));
  });

  it('Windows 上目录缺失 → validation + message 含降级说明；非 Windows 仅断言形状', async () => {
    if (!IS_WIN) {
      const result = await new BedrockKernel()
        .dispatch({ id: 't3', kind: 'get_target_state', payload: null })
        .result();
      expect(result.ok).toBe(false);
      return;
    }
    setOverride(join(mkTmp(), 'does-not-exist'));
    const result = await new BedrockKernel()
      .dispatch({ id: 't3', kind: 'get_target_state', payload: null })
      .result();
    expect(result).toMatchObject({ ok: false, error: { category: 'validation', retryable: false } });
    expect(result.error?.message).toMatch(/降级/);
  });

  it('cancel 可调不抛错', () => {
    const handle = new BedrockKernel().dispatch({ id: 'x1', kind: 'get_target_state', payload: null });
    expect(() => handle.cancel()).not.toThrow();
  });

  it('progress 为空 AsyncIterable（立即 done）', async () => {
    const handle = new BedrockKernel().dispatch({ id: 'x2', kind: 'get_target_state', payload: null });
    const seen: unknown[] = [];
    for await (const e of handle.progress) seen.push(e);
    expect(seen).toEqual([]);
  });

  it('status() 保持不动：healthy 且 edition=bedrock', () => {
    const s = new BedrockKernel().status();
    expect(s.edition).toBe('bedrock');
    expect(s.healthy).toBe(true);
    expect(typeof s.updatedAt).toBe('string');
  });
});
