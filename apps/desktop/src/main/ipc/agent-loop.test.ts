/**
 * agent-loop.ts 主进程 handler 测试（L2 AI 规格闭环）。
 *
 * 全 mock：electron ipcMain 记录通道；网关按脚本返回文本序列（fake）；
 * 校验走真 validateDatapack + 真 DatapackSpec，不断网、不调真实 zen。
 */

// Mock electron：记录 ipcMain.handle 注册的通道与处理器。
const handlers = new Map<string, (e: unknown, ...args: unknown[]) => unknown>();

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (e: unknown, ...args: unknown[]) => unknown) => {
      handlers.set(channel, handler);
    },
    removeHandler: (channel: string) => {
      handlers.delete(channel);
    },
  },
  app: { getPath: () => 'C:\\mock\\userData' },
}));

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { InferRequest, InferResponse } from '@mc-creator/agent';
import {
  registerAgentLoopHandlers,
  handleAgentRunLoop,
  extractJsonBlock,
  validateGeneratedSpec,
} from './agent-loop.js';
import { AGENT_RUN_LOOP } from '../../shared/ipc/agent-loop.js';

const VALID_SPEC = JSON.stringify({
  packId: 'test_pack',
  packName: 'Test',
  description: 'a test datapack',
  packFormat: 48,
  recipes: [],
  functions: [{ id: 'tick', commands: ['say hi'] }],
});

/** 缺 pattern/key 的有形合成：zod 能过，真 validateDatapack 必报 error。 */
const INVALID_SPEC = JSON.stringify({
  packId: 'bad_pack',
  packName: 'Bad',
  packFormat: 48,
  recipes: [{ id: 'bad_sword', type: 'crafting_shaped', result: 'minecraft:diamond_sword' }],
});

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

/** 经已注册通道调用 handler（证明 AGENT_RUN_LOOP 接线存在）。 */
async function callViaChannel(raw: unknown): Promise<unknown> {
  const h = handlers.get(AGENT_RUN_LOOP);
  if (h === undefined) throw new Error(`通道未注册: ${AGENT_RUN_LOOP}`);
  return h(null, raw);
}

beforeEach(() => {
  handlers.clear();
});

describe('extractJsonBlock（模型散文包裹 JSON 的真实形态）', () => {
  it('纯 JSON 原样返回', () => {
    expect(extractJsonBlock('{"a":1}')).toBe('{"a":1}');
  });

  it('markdown 围栏包裹提取块', () => {
    const out = extractJsonBlock('好的，这是结果：\n```json\n{"a":1}\n```\n以上。');
    expect(out).toBe('{"a":1}');
  });

  it('前后散文提取配平块', () => {
    const out = extractJsonBlock('先说两句 {"a":{"b":[1,2]}} 再说两句');
    expect(out).toBe('{"a":{"b":[1,2]}}');
  });

  it('字符串内花括号与转义引号不干扰配平', () => {
    const out = extractJsonBlock('x {"a":"} \\" {"} y');
    expect(out).toBe('{"a":"} \\" {"}');
  });

  it('无花括号返回 null', () => {
    expect(extractJsonBlock('plain prose, no json')).toBeNull();
  });

  it('未闭合返回 null', () => {
    expect(extractJsonBlock('{"a":1')).toBeNull();
  });
});

describe('validateGeneratedSpec 的截断诊断（真机第三轮 abort 的真因）', () => {
  it('JSON 未闭合时判定为截断，并提示「缩短内容」而非形状错', () => {
    const truncated = '{"packId":"a","packName":"A","packFormat":48,"functions":[{"id":"a/setup"';
    const r = validateGeneratedSpec(truncated, () => {
      throw new Error('不该走到 onAccept');
    });
    expect(r.ok).toBe(false);
    expect(r.detail).toContain('被截断');
    expect(r.detail).toContain('缩短内容');
  });

  it('模型完全没输出 JSON 时仍报「没有配平的 JSON 块」（不误判截断）', () => {
    const r = validateGeneratedSpec('抱歉，我无法完成这个请求。', () => {
      throw new Error('不该走到 onAccept');
    });
    expect(r.ok).toBe(false);
    expect(r.detail).toContain('没有配平的 JSON 块');
  });
});

describe('agent-loop 一轮过', () => {
  it('首轮模型返回合法 spec 即 succeed，transcript 收原文、attempts 为 0', async () => {
    const fake = scriptGateway([okText(VALID_SPEC)]);
    registerAgentLoopHandlers({ createGateway: () => fake.gateway });
    const res = (await callViaChannel({
      prompt: '做一个会说话的村民数据包',
      kind: 'datapack',
      mcVersion: '1.21.11',
      maxAttempts: 3,
    })) as { ok: boolean; spec: { packId: string }; transcript: unknown[]; attempts: number };
    expect(res.ok).toBe(true);
    expect(res.spec.packId).toBe('test_pack');
    expect(res.transcript).toHaveLength(1);
    expect(res.attempts).toBe(0);
    expect(fake.calls).toBe(1);
  });
});

describe('agent-loop 修复后过', () => {
  it('首轮校验失败→错误回灌→次轮合法 spec 成功，次轮 prompt 含 issues 原文', async () => {
    const fake = scriptGateway([okText(INVALID_SPEC), okText(VALID_SPEC)]);
    const res = await handleAgentRunLoop(
      { prompt: '做一把红宝石剑配方', kind: 'datapack', maxAttempts: 3 },
      { createGateway: () => fake.gateway },
    );
    expect(res.ok).toBe(true);
    expect((res.spec as { packId: string }).packId).toBe('test_pack');
    expect(res.transcript).toHaveLength(2);
    expect(res.attempts).toBeGreaterThan(0);
    expect(fake.calls).toBe(2);
    // 错误回灌有料：次轮 prompt 含真 validateDatapack 的 issues 原文
    expect(fake.seen[1]).toContain('有形合成必须提供 pattern');
  });
});

describe('agent-loop 超轮次', () => {
  it('轮轮非法 spec 且 maxAttempts=1 时 abort，error 含 issues 原文', async () => {
    const fake = scriptGateway([okText(INVALID_SPEC)]);
    const res = await handleAgentRunLoop(
      { prompt: '永远做不对的配方', kind: 'datapack', maxAttempts: 1 },
      { createGateway: () => fake.gateway },
    );
    expect(res.ok).toBe(false);
    expect(res.error).toContain('有形合成必须提供 pattern');
  });

  it('模型返回非 JSON 时 detail 注明原因+原文前 200 字', async () => {
    // 主代理裁决：提块后“无配平块”与“块非法”是两种 detail，前者由本用例覆盖
    // （输入花括号未闭合），后者由 extractJsonBlock 单测覆盖；意图不变。
    const fake = scriptGateway([okText('not json at all {{{')]);
    const res = await handleAgentRunLoop(
      { prompt: '乱说话', kind: 'datapack', maxAttempts: 1 },
      { createGateway: () => fake.gateway },
    );
    expect(res.ok).toBe(false);
    expect(res.error).toContain('没有配平的 JSON 块');
    expect(res.error).toContain('not json at all');
  });
});

describe('agent-loop 网关挂', () => {
  it('infer 持续失败收敛为 abort 不抛，error 透传网关原因', async () => {
    const fake = scriptGateway([failGateway('免费通道拒绝（403）FreeTierError，终态失败')]);
    const res = await handleAgentRunLoop(
      { prompt: '网关挂了', kind: 'datapack', maxAttempts: 3 },
      { createGateway: () => fake.gateway },
    );
    expect(res.ok).toBe(false);
    expect(res.error).toContain('免费通道拒绝（403）');
  });
});

describe('agent-loop 非 datapack kind', () => {
  it('kind=mod 直接返回明确不支持错，不调网关', async () => {
    const fake = scriptGateway([okText(VALID_SPEC)]);
    const res = await handleAgentRunLoop(
      { prompt: '做个 mod', kind: 'mod' },
      { createGateway: () => fake.gateway },
    );
    expect(res.ok).toBe(false);
    expect(res.error).toContain('不支持的 kind');
    expect(fake.calls).toBe(0);
  });
});
