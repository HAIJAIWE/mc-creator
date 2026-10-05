/**
 * `compileCustomNode` 的**沙箱通道回归防线**（本任务的核心）。
 *
 * 修漏洞前这里是：`sandboxed ?? renderMustache(...)`。
 * 主进程一旦因为 `OUTPUT_LIMIT_EXCEEDED` / `BLOCK_DEPTH_EXCEEDED` 返回 `ok:false`，
 * 渲染层就回退到本地渲染 —— 攻击输入在渲染进程里重新无上限生效，
 * `{{field:constructor}}` 真的泄出 `function Object() { [native code] }`。
 * 加固只覆盖了成功路径，回退路径把加固整个抵消掉。
 *
 * 因此本文件的断言全部围绕「**主进程拒绝时绝不落到本地实现**」：
 * 用 `vi.mock` 给本地实现套一层调用记录（spy），逐条证明
 *   - 拒绝 → 抛 `MustacheRenderRejectedError`，且本地渲染器**一次都没被调用**；
 *   - 「通道不存在」（非 Electron 上下文）与「主进程拒绝」是两回事，前者仍兜底；
 *   - 「schema 未注册」这条正常路径不被影响。
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join as joinPath } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { SubgraphNodeData } from '@mc-creator/shared';
import { compileCustomNode, MustacheRenderRejectedError } from './compileCustomNode.js';
import { customNodeRegistry } from '../domain/customNodeRegistry.js';

/**
 * 本地（渲染层兜底）渲染器的调用记录。
 * 用 `vi.hoisted` 提前建好，才能被 `vi.mock` 工厂闭包引用。
 */
const { localRenderCalls } = vi.hoisted(() => ({
  localRenderCalls: [] as Array<{ template: string; fields: Record<string, unknown> }>,
}));

vi.mock('../components/lowcode/custom/mustacheRender.js', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../components/lowcode/custom/mustacheRender.js')>();
  const real = actual.renderMustache;
  return {
    ...actual,
    renderMustache: (...args: Parameters<typeof real>): string => {
      localRenderCalls.push({
        template: String(args[0]),
        fields: args[1] as Record<string, unknown>,
      });
      return real(...args);
    },
  };
});

type BridgeOutcome = { ok: boolean; result?: string; error?: string };

interface StubBridge {
  renderMustache: (t: string, f: Record<string, unknown>) => Promise<BridgeOutcome>;
}

function installBridge(
  impl: (t: string, f: Record<string, unknown>) => Promise<BridgeOutcome>,
): StubBridge {
  const bridge: StubBridge = { renderMustache: impl };
  (globalThis as { sandboxedMustache?: unknown }).sandboxedMustache = bridge;
  return bridge;
}

function removeBridge(): void {
  delete (globalThis as { sandboxedMustache?: unknown }).sandboxedMustache;
}

/** 构造一个 customTypeId 非空的 subgraph 节点数据。 */
function node(
  id: string,
  customTypeId: string | null,
  customFields: Record<string, unknown>,
): SubgraphNodeData {
  return {
    nodeId: id,
    label: 'x',
    note: '',
    disabled: false,
    kind: 'subgraph',
    subgraphId: '',
    subgraphName: '',
    customTypeId,
    customFields,
    collapsed: false,
    codeLocked: false,
    formatVersion: 1,
  };
}

/** 主进程渲染调用记录（用来证明「主进程是唯一真相来源」）。 */
let bridgeCalls: Array<{ template: string; fields: Record<string, unknown> }> = [];

beforeEach(() => {
  customNodeRegistry.clear();
  localRenderCalls.length = 0;
  bridgeCalls = [];
  removeBridge();
});

afterEach(() => {
  removeBridge();
  vi.restoreAllMocks();
});

describe('主进程通道存在：主进程结果是唯一真相来源', () => {
  it('ok:true → 逐字节使用主进程结果，本地渲染器一次都不调用', async () => {
    installBridge(async (template, fields) => {
      bridgeCalls.push({ template, fields });
      return { ok: true, result: 'MAIN_RENDERED' };
    });
    customNodeRegistry.register({
      typeId: 't:main',
      label: 'x',
      description: '',
      icon: '',
      color: '',
      ports: [],
      fields: [{ key: 'speed', label: '速度', type: 'number', required: false }],
      codeTemplate: 'int s = {{field:speed}};',
    });
    const n = node('n1', 't:main', { speed: 3 });
    const out = await compileCustomNode(n, n.customFields);
    expect(out.error).toBeUndefined();
    expect(out.snippet!.code).toBe('MAIN_RENDERED');
    // 主进程收到了净化后的字段（number 强制转换 + 丢弃 schema 外字段）
    expect(bridgeCalls).toEqual([{ template: 'int s = {{field:speed}};', fields: { speed: 3 } }]);
    expect(localRenderCalls).toHaveLength(0);
  });

  it('主进程收到的 fields 已剔除 schema 未定义字段与原型链键', async () => {
    installBridge(async (template, fields) => {
      bridgeCalls.push({ template, fields });
      return { ok: true, result: 'OK' };
    });
    customNodeRegistry.register({
      typeId: 't:sanitize',
      label: 'x',
      description: '',
      icon: '',
      color: '',
      ports: [],
      fields: [
        { key: 'speed', label: '速度', type: 'number', required: false },
        // 导入的自定义节点 JSON 可以声明这种 key（shared schema 是 z.string()），
        // 必须被 sanitizeFields 挡掉，否则 `result['__proto__'] = v` 会污染原型
        { key: '__proto__', label: '恶意', type: 'text', required: false },
        { key: 'constructor', label: '恶意', type: 'text', required: false },
      ],
      codeTemplate: 'X',
    });
    const n = node('n2', 't:sanitize', {
      speed: 'not-a-number',
      __proto__: 'POLLUTED',
      constructor: 'POLLUTED',
      extra: 'LEAK',
    });
    await compileCustomNode(n, n.customFields);
    expect(bridgeCalls[0]!.fields).toEqual({ speed: 0 });
    expect(Object.getPrototypeOf({})).toBe(Object.prototype);
    expect(({} as Record<string, unknown>).POLLUTED).toBeUndefined();
  });

  it('templateParts：全部 part 都走主进程，本地渲染器一次都不调用', async () => {
    installBridge(async (template, fields) => {
      bridgeCalls.push({ template, fields });
      return { ok: true, result: `<${template.length}>` };
    });
    customNodeRegistry.register({
      typeId: 't:parts',
      label: 'x',
      description: '',
      icon: '',
      color: '',
      ports: [],
      fields: [{ key: 'v', label: '值', type: 'text', required: false }],
      templateParts: [{ template: 'A' }, { template: 'B' }, { template: 'C' }],
    });
    const n = node('n3', 't:parts', { v: 'x' });
    const out = await compileCustomNode(n, n.customFields);
    expect(out.snippet!.code).toBe('<1><1><1>');
    expect(bridgeCalls.map((c) => c.template)).toEqual(['A', 'B', 'C']);
    expect(localRenderCalls).toHaveLength(0);
  });
});

// ============================================================
// 核心回归：主进程拒绝 → 抛错，且**绝不**落到本地实现
// ============================================================

describe('主进程明确拒绝：抛错，不回退（漏洞的根因修复）', () => {
  const rejectWith = (error: string) => installBridge(async () => ({ ok: false, error }));

  beforeEach(() => {
    customNodeRegistry.register({
      typeId: 't:reject',
      label: 'x',
      description: '',
      icon: '',
      color: '',
      ports: [],
      fields: [{ key: 'big', label: '大字段', type: 'text', required: false }],
      codeTemplate: 'X{{field:big}}',
    });
  });

  it('OUTPUT_LIMIT_EXCEEDED → 抛 MustacheRenderRejectedError，code 与 message 都在', async () => {
    rejectWith('[OUTPUT_LIMIT_EXCEEDED] 渲染输出超限（最大 5242880 字符 ≈ 5120KiB，已达 6291456）');
    const n = node('n4', 't:reject', { big: 'A'.repeat(6 * 1024 * 1024) });
    await expect(compileCustomNode(n, n.customFields)).rejects.toThrow(MustacheRenderRejectedError);
    const err = await compileCustomNode(n, n.customFields).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(MustacheRenderRejectedError);
    expect((err as MustacheRenderRejectedError).code).toBe('OUTPUT_LIMIT_EXCEEDED');
    expect((err as MustacheRenderRejectedError).message).toContain('OUTPUT_LIMIT_EXCEEDED');
    expect((err as MustacheRenderRejectedError).message).toContain('渲染输出超限');
  });

  it('**关键**：拒绝时本地未加固实现一次都没被调用（回退路径已消除）', async () => {
    // 模板会展开 6MiB、足以把渲染进程堆打爆；旧实现会回退到本地把它渲染出来。
    rejectWith('[OUTPUT_LIMIT_EXCEEDED] 渲染输出超限');
    const n = node('n5', 't:reject', { big: 'A'.repeat(6 * 1024 * 1024) });
    await expect(compileCustomNode(n, n.customFields)).rejects.toThrow();
    expect(localRenderCalls).toHaveLength(0);
  });

  it('BLOCK_DEPTH_EXCEEDED → 抛错并保留 code，本地 0 次调用', async () => {
    rejectWith('[BLOCK_DEPTH_EXCEEDED] 模板块嵌套超限（最大 16 层）');
    const n = node('n6', 't:reject', { big: 'v' });
    const err = await compileCustomNode(n, n.customFields).catch((e: unknown) => e);
    expect((err as MustacheRenderRejectedError).code).toBe('BLOCK_DEPTH_EXCEEDED');
    expect((err as MustacheRenderRejectedError).message).toContain('模板块嵌套超限');
    expect(localRenderCalls).toHaveLength(0);
  });

  it('ITERATION_LIMIT_EXCEEDED → 抛错并保留 code，本地 0 次调用', async () => {
    rejectWith('[ITERATION_LIMIT_EXCEEDED] {{#each}} 迭代数超限（最大 10000 次，实际 999999）');
    const n = node('n7', 't:reject', { big: 'v' });
    const err = await compileCustomNode(n, n.customFields).catch((e: unknown) => e);
    expect((err as MustacheRenderRejectedError).code).toBe('ITERATION_LIMIT_EXCEEDED');
    expect(localRenderCalls).toHaveLength(0);
  });

  it('其他 code（FIELDS_CYCLIC / TEMPLATE_TOO_LARGE …）一律同样处理', async () => {
    for (const code of [
      'FIELDS_CYCLIC',
      'FIELDS_TOO_DEEP',
      'FIELDS_FORBIDDEN_KEY',
      'TEMPLATE_TOO_LARGE',
      'TOKEN_LIMIT_EXCEEDED',
      'TIME_LIMIT_EXCEEDED',
      'UNSUPPORTED_VALUE_TYPE',
      'RENDER_FAILED',
    ]) {
      localRenderCalls.length = 0;
      rejectWith(`[${code}] 拒绝原因`);
      const n = node('n8', 't:reject', { big: 'v' });
      const err = await compileCustomNode(n, n.customFields).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(MustacheRenderRejectedError);
      expect((err as MustacheRenderRejectedError).code).toBe(code);
      expect((err as MustacheRenderRejectedError).message).toContain(`[${code}]`);
      expect(localRenderCalls).toHaveLength(0);
    }
  });

  it('主进程没给 [CODE] 前缀 → code 归一为 UNKNOWN，原始字符串原样保留', async () => {
    rejectWith('something went wrong');
    const n = node('n9', 't:reject', { big: 'v' });
    const err = await compileCustomNode(n, n.customFields).catch((e: unknown) => e);
    expect((err as MustacheRenderRejectedError).code).toBe('UNKNOWN');
    expect((err as MustacheRenderRejectedError).message).toContain('something went wrong');
    expect(localRenderCalls).toHaveLength(0);
  });

  it('主进程 ok:false 但没给 error 说明 → 仍然抛错，不回退', async () => {
    installBridge(async () => ({ ok: false }));
    const n = node('n10', 't:reject', { big: 'v' });
    const err = await compileCustomNode(n, n.customFields).catch((e: unknown) => e);
    expect((err as MustacheRenderRejectedError).code).toBe('UNKNOWN');
    expect(localRenderCalls).toHaveLength(0);
  });

  it('IPC invoke 自身 reject（handler 崩溃 / zod 抛错）→ 视为拒绝，不回退', async () => {
    installBridge(async () => {
      throw new Error('Error invoking remote method: invalid payload');
    });
    const n = node('n11', 't:reject', { big: 'v' });
    const err = await compileCustomNode(n, n.customFields).catch((e: unknown) => e);
    expect((err as MustacheRenderRejectedError).code).toBe('IPC_INVOKE_FAILED');
    expect((err as MustacheRenderRejectedError).message).toContain('invalid payload');
    expect(localRenderCalls).toHaveLength(0);
  });

  it('协议违例（ok:true 却缺 result）→ 抛错，不给主进程开后门', async () => {
    installBridge(async () => ({ ok: true }));
    const n = node('n12', 't:reject', { big: 'v' });
    const err = await compileCustomNode(n, n.customFields).catch((e: unknown) => e);
    expect((err as MustacheRenderRejectedError).code).toBe('MALFORMED_RESPONSE');
    expect(localRenderCalls).toHaveLength(0);
  });

  it('templateParts 中任一 part 被拒 → 整块抛错（不产出拼接一半的代码）', async () => {
    customNodeRegistry.clear();
    customNodeRegistry.register({
      typeId: 't:parts2',
      label: 'x',
      description: '',
      icon: '',
      color: '',
      ports: [],
      fields: [{ key: 'v', label: '值', type: 'text', required: false }],
      templateParts: [
        { template: 'HEADER;' },
        { template: 'REJECTED_BODY;' },
        { template: 'FOOTER;' },
      ],
    });
    installBridge(async (template) =>
      template === 'REJECTED_BODY;'
        ? { ok: false, error: '[OUTPUT_LIMIT_EXCEEDED] 超限' }
        : { ok: true, result: template },
    );
    const n = node('n13', 't:parts2', { v: 'x' });
    const err = await compileCustomNode(n, n.customFields).catch((e: unknown) => e);
    expect((err as MustacheRenderRejectedError).code).toBe('OUTPUT_LIMIT_EXCEEDED');
    // 前面成功的 part 也不会「落回本地补齐」
    expect(localRenderCalls).toHaveLength(0);
  });
});

// ============================================================
// 「通道不存在」≠「主进程拒绝」：既有 null 语义保留
// ============================================================

describe('通道不存在（非 Electron 上下文）：既有兜底语义保留，但兜底实现自带防线', () => {
  it('无 bridge → 走渲染层兜底，结果与加固前逐字节一致', async () => {
    removeBridge();
    customNodeRegistry.register({
      typeId: 't:local',
      label: 'x',
      description: '',
      icon: '',
      color: '',
      ports: [],
      fields: [
        { key: 'speed', label: '速度', type: 'number', required: false },
        { key: 'glow', label: '发光', type: 'segmented', required: false },
        { key: 'items', label: '物品', type: 'nbt', required: false },
      ],
      codeTemplate:
        'int s={{field:speed}};{{#if glow}}GLOW;{{/if}}{{#each items}}"{{this}}",{{/each}}',
    });
    const n = node('n14', 't:local', { speed: 7, glow: true, items: ['a', 'b'] });
    const out = await compileCustomNode(n, n.customFields);
    expect(out.snippet!.code).toBe('int s=7;GLOW;"a","b",');
    expect(localRenderCalls).toHaveLength(1);
  });

  it('无 bridge + 原型链攻击模板 → 不泄露 Object 构造函数（兜底实现自己有防线）', async () => {
    removeBridge();
    customNodeRegistry.register({
      typeId: 't:proto',
      label: 'x',
      description: '',
      icon: '',
      color: '',
      ports: [],
      fields: [],
      codeTemplate: 'A{{field:constructor}}B{{field:__proto__}}C{{this.constructor}}D',
    });
    const n = node('n15', 't:proto', {});
    const out = await compileCustomNode(n, n.customFields);
    expect(out.snippet!.code).not.toContain('[native code]');
    expect(out.snippet!.code).not.toContain('function Object');
    expect(out.snippet!.code).toBe(
      'A{{field:constructor}}B{{field:__proto__}}C{{this.constructor}}D',
    );
  });

  it('无 bridge + 超大字段 → 兜底实现自己抛（不再无上限拼字符串）', async () => {
    removeBridge();
    customNodeRegistry.register({
      typeId: 't:huge',
      label: 'x',
      description: '',
      icon: '',
      color: '',
      ports: [],
      fields: [{ key: 'big', label: '大字段', type: 'text', required: false }],
      codeTemplate: 'X{{field:big}}',
    });
    const n = node('n16', 't:huge', { big: 'A'.repeat(6 * 1024 * 1024) });
    // 兜底实现的 MustacheRenderError 直接向上冒泡（compileAll 会记进 errors）
    await expect(compileCustomNode(n, n.customFields)).rejects.toThrow(
      /OUTPUT_LIMIT_EXCEEDED|渲染输出超限/,
    );
    expect(localRenderCalls).toHaveLength(1);
  });

  it('无 bridge + 超深嵌套 → 兜底实现自己抛 BLOCK_DEPTH_EXCEEDED', async () => {
    removeBridge();
    customNodeRegistry.register({
      typeId: 't:deep',
      label: 'x',
      description: '',
      icon: '',
      color: '',
      ports: [],
      fields: [{ key: 'a', label: 'a', type: 'segmented', required: false }],
      codeTemplate: '{{#if a}}'.repeat(17) + 'X' + '{{/if}}'.repeat(17),
    });
    const n = node('n17', 't:deep', { a: true });
    await expect(compileCustomNode(n, n.customFields)).rejects.toThrow(/模板块嵌套超限/);
  });
});

// ============================================================
// 「schema 未注册」这条正常路径不受影响
// ============================================================

describe('schema 未注册：与「主进程拒绝」严格区分', () => {
  it('schema 未注册 → 返回 { error }，且一次都不调主进程、不调本地', async () => {
    installBridge(async () => ({ ok: true, result: 'SHOULD_NOT_BE_USED' }));
    const n = node('n18', 'unregistered:type', {});
    const out = await compileCustomNode(n, n.customFields);
    expect(out.snippet).toBeUndefined();
    expect(out.error).toContain('未注册');
    expect(bridgeCalls).toHaveLength(0);
    expect(localRenderCalls).toHaveLength(0);
  });

  it('schema 未注册 + 无 bridge → 同样返回 { error }（既有语义不变）', async () => {
    removeBridge();
    const n = node('n19', 'unregistered:type', {});
    const out = await compileCustomNode(n, n.customFields);
    expect(out.error).toContain('未注册');
    expect(localRenderCalls).toHaveLength(0);
  });

  it('customTypeId 为 null → 返回 { error }，不碰任何渲染路径', async () => {
    installBridge(async () => ({ ok: true, result: 'X' }));
    const n = node('n20', null, {});
    const out = await compileCustomNode(n, n.customFields);
    expect(out.error).toContain('customTypeId');
    expect(bridgeCalls).toHaveLength(0);
    expect(localRenderCalls).toHaveLength(0);
  });

  it('required 字段缺失 → 返回 { error }，不碰任何渲染路径', async () => {
    installBridge(async () => ({ ok: true, result: 'X' }));
    customNodeRegistry.register({
      typeId: 't:req',
      label: 'x',
      description: '',
      icon: '',
      color: '',
      ports: [],
      fields: [{ key: 'speed', label: '速度', type: 'number', required: true }],
      codeTemplate: 'int s={{field:speed}};',
    });
    const n = node('n21', 't:req', {});
    const out = await compileCustomNode(n, n.customFields);
    expect(out.error).toContain('speed');
    expect(bridgeCalls).toHaveLength(0);
    expect(localRenderCalls).toHaveLength(0);
  });
});

// ============================================================
// 结构性防线：源码里不许再出现「拒绝即回退」的形态
// ============================================================

describe('结构性防线：拒绝回退的代码形态已被移除', () => {
  const src = readFileSync(
    joinPath(dirname(fileURLToPath(import.meta.url)), 'compileCustomNode.ts'),
    'utf8',
  );
  // 去掉注释后再断言：注释里可以（也应该）引用「曾经长什么样」，不该被算成代码
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

  it('不再有 `sandboxed ?? renderMustache(...)` 形态：本地实现只有一个调用点，且只在「无桥」时可达', () => {
    // 旧代码：`((await renderMustacheSandboxed(t, f)) ?? renderMustache(t, f))` —— 两个调用点，
    // 且第二个在「主进程拒绝」时可达。现在第二个调用点被收敛到「bridge === null」这条分支上。
    // `bridge.renderMustache(...)`（IPC 调用）不算；这里只数**本地**渲染实现的调用点
    const callSites = code.match(/(?<![.\w])renderMustache\(/g) ?? [];
    expect(callSites).toHaveLength(1);
    expect(src).toContain('if (bridge === null) return null;');
    expect(src).toContain('return viaMain ?? renderMustache(template, sanitizedFields);');
    // 旧的辅助函数名（其语义就是「失败回退」）整体消失
    expect(src).not.toContain('renderMustacheSandboxed');
    expect(src).not.toContain('回退本地渲染');
    // 拒绝路径不再「只 warn 不报错」
    expect(src).not.toContain('console.warn');
  });

  it('拒绝路径必须抛（构造 MustacheRenderRejectedError），不吞异常', () => {
    expect(src).toContain('throw new MustacheRenderRejectedError(');
    expect(src).toContain('主进程拒绝渲染');
    expect(src).toContain('REJECTED_CODE_RE');
  });

  it('原型链取值判定一律 Object.hasOwn（不再有裸 `in`）', () => {
    expect(code).not.toMatch(/\b\w+ in (fields|sanitizedFields)\b/);
    expect(code).toContain('Object.hasOwn');
  });
});
