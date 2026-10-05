/**
 * closed-loop.ts 单元测试（§10.3/§17）。
 * 全注入 fake（gateway/validate/diagnose），不断网，绝不调真实 zen。
 */
import { describe, expect, it } from 'vitest';
import type { InferRequest, InferResponse } from './infer.js';
import type { StageResult } from './pipeline.js';
import { runClosedLoop, type ClosedLoopStepEvent } from './closed-loop.js';
import type { GeneratePromptInput } from './generate.js';

function basePrompt(): GeneratePromptInput {
  return {
    kind: 'datapack',
    userPrompt: '做一个会说话的村民',
    versionContext: 'mc_version: 1.21.4',
    apiTypes: 'interface Villager {}',
    contextPack: 'installed_mods: jei',
    budgetChars: 8000,
  };
}

function okText(text: string): InferResponse {
  return { ok: true, text };
}

function failGateway(reason: string): InferResponse {
  return { ok: false, error: { code: 'MODEL_ERROR', reason, retryable: false } };
}

/** 按脚本顺序返回 InferResponse 的 fake 网关，并记录收到的 prompt 文本。 */
function scriptGateway(script: InferResponse[]) {
  const seen: string[] = [];
  let calls = 0;
  return {
    seen,
    get calls() {
      return calls;
    },
    gateway: {
      infer: async (req: InferRequest): Promise<InferResponse> => {
        seen.push(req.messages.map((m) => m.content).join('\n'));
        const res = script[Math.min(calls, script.length - 1)] as InferResponse;
        calls += 1;
        return res;
      },
    },
  };
}

describe('runClosedLoop fail-fast（调用方 bug 直接抛中文 Error）', () => {
  it('缺 prompt/gateway/validate 直接抛', async () => {
    await expect(
      runClosedLoop({} as unknown as Parameters<typeof runClosedLoop>[0]),
    ).rejects.toThrow(/缺少 prompt/);
    await expect(
      runClosedLoop({
        prompt: basePrompt(),
        gateway: undefined as unknown as { infer: () => Promise<InferResponse> },
        validate: async () => ({ ok: true }),
      }),
    ).rejects.toThrow(/gateway/);
    await expect(
      runClosedLoop({
        prompt: basePrompt(),
        gateway: { infer: async () => okText('x') },
        validate: undefined as unknown as () => Promise<{ ok: boolean }>,
      }),
    ).rejects.toThrow(/validate/);
  });
});

describe('一轮成功', () => {
  it('generate ok → validate ok → succeed，transcript 原文不改写', async () => {
    const fake = scriptGateway([okText('GOOD-CODE-原文')]);
    const events: ClosedLoopStepEvent[] = [];
    const res = await runClosedLoop({
      prompt: basePrompt(),
      gateway: fake.gateway,
      validate: async (text) =>
        text.includes('GOOD-CODE') ? { ok: true, kind: 'datapack' } : { ok: false, detail: 'bad' },
      diagnose: async () => ({ ok: true, detail: 'n/a' }),
      maxAttempts: 3,
      onStep: (e) => {
        events.push(e);
      },
    });
    expect(res.outcome).toBe('succeed');
    expect(res.history.map((h) => `${h.stage}:${h.ok ? 'ok' : 'fail'}`)).toEqual([
      'generate:ok',
      'validate:ok',
    ]);
    expect(res.transcript).toEqual([{ stage: 'generate', text: 'GOOD-CODE-原文' }]);
    expect(res.attempts).toBe(0);
    expect(fake.calls).toBe(1);
    expect(events.length).toBe(2);
  });
});

describe('失败→诊断→修复→成功', () => {
  it('validate 失败 → diagnose ok → fix → validate 成功', async () => {
    const fake = scriptGateway([okText('BAD-CODE'), okText('GOOD-CODE-修复后')]);
    const res = await runClosedLoop({
      prompt: basePrompt(),
      gateway: fake.gateway,
      validate: async (text) =>
        text.includes('GOOD-CODE')
          ? { ok: true, kind: 'datapack' }
          : { ok: false, detail: '内容缺村民说话逻辑' },
      diagnose: async (detail) => ({ ok: true, detail: `定位：${detail}` }),
      maxAttempts: 5,
    });
    expect(res.outcome).toBe('succeed');
    expect(res.history.map((h: StageResult) => h.stage)).toEqual([
      'generate',
      'validate',
      'diagnose',
      'fix',
      'validate',
    ]);
    expect(res.history[1]?.ok).toBe(false);
    expect(res.history[2]?.ok).toBe(true);
    expect(res.history[3]?.ok).toBe(true);
    expect(res.history[4]?.ok).toBe(true);
    // transcript 两次原文都不截断
    expect(res.transcript).toEqual([
      { stage: 'generate', text: 'BAD-CODE' },
      { stage: 'fix', text: 'GOOD-CODE-修复后' },
    ]);
    // fix 回灌 prompt：userPrompt 原样保留 + detail 追加进 contextPack（第二次 infer 可见）
    expect(fake.seen[1]).toContain('做一个会说话的村民');
    expect(fake.seen[1]).toContain('内容缺村民说话逻辑');
    expect(res.attempts).toBe(1);
  });
});

describe('超轮次 abort', () => {
  it('validate 永远失败 → 达到 maxAttempts 转 abort', async () => {
    const fake = scriptGateway([okText('BAD-1'), okText('BAD-2'), okText('BAD-3')]);
    const res = await runClosedLoop({
      prompt: basePrompt(),
      gateway: fake.gateway,
      validate: async () => ({ ok: false, detail: '永远失败' }),
      diagnose: async () => ({ ok: true, detail: '定位到原因' }),
      maxAttempts: 2,
    });
    expect(res.outcome).toBe('abort');
    expect(res.attempts).toBeGreaterThanOrEqual(2);
    // 最后一条是失败的 validate（超轮 abort 由 nextStep 判定）
    const last = res.history[res.history.length - 1] as StageResult;
    expect(last.ok).toBe(false);
  });
});

describe('无诊断器 abort', () => {
  it('validate 失败且无 diagnose 注入 → diagnose 默认失败“无诊断器”→ abort', async () => {
    const fake = scriptGateway([okText('BAD-CODE')]);
    const res = await runClosedLoop({
      prompt: basePrompt(),
      gateway: fake.gateway,
      validate: async () => ({ ok: false, detail: '缺逻辑' }),
      maxAttempts: 3,
    });
    expect(res.outcome).toBe('abort');
    const diag = res.history.find((h: StageResult) => h.stage === 'diagnose');
    expect(diag?.ok).toBe(false);
    expect(diag?.detail).toBe('无诊断器');
    // generate 之后只有 validate + diagnose，不会走到 fix（无第二次 infer）
    expect(fake.calls).toBe(1);
  });
});

describe('网关失败转 abort', () => {
  it('infer ok:false 视为当轮失败并按 nextStep 流转，最终 abort，不抛', async () => {
    const fake = scriptGateway([failGateway('网关挂了-1'), failGateway('网关挂了-2')]);
    const res = await runClosedLoop({
      prompt: basePrompt(),
      gateway: fake.gateway,
      validate: async () => ({ ok: true, kind: 'datapack' }),
      diagnose: async () => ({ ok: true, detail: '定位：网关失败' }),
      maxAttempts: 2,
    });
    expect(res.outcome).toBe('abort');
    expect(res.transcript).toEqual([]);
    // generate 失败 + diagnose ok + fix 失败 + diagnose ok + ...（失败 detail 取 error.reason）
    expect(res.history[0]).toMatchObject({ stage: 'generate', ok: false });
    expect(res.history[0]?.detail).toContain('网关挂了');
    expect(res.attempts).toBeGreaterThanOrEqual(2);
  });

  it('运行中异常（validate 抛）收敛为 abort，不抛裸异常', async () => {
    const fake = scriptGateway([okText('GOOD-CODE')]);
    const res = await runClosedLoop({
      prompt: basePrompt(),
      gateway: fake.gateway,
      validate: async () => {
        throw new Error('验证器炸了');
      },
      maxAttempts: 3,
    });
    expect(res.outcome).toBe('abort');
    const last = res.history[res.history.length - 1] as StageResult;
    expect(last.ok).toBe(false);
    expect(last.detail).toContain('验证器炸了');
  });
});
