/**
 * 分层规则的**机器校验**（模式二：单向依赖）。
 *
 * ## 为什么规则要写成测试
 *
 * 分层约定写在文档里必然腐化 —— 加一个新文件时顺手 import 一个上层模块，
 * 没有任何机制阻止。本文把规则变成断言：违反即测试失败。
 *
 * 依赖方向（`core` / `context` 是叶子，不得依赖上层）：
 *
 * ```
 * transport ──► agents ──► core
 *                   ├──► context ──► core
 *                   └──► kernel   （内核访问统一走 adapters）
 * ```
 *
 * 详见 docs/architecture-assessment.md §3.1。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// 本文件就在 src/ 下，同层的层目录是 src/<layer>
const SRC = dirname(fileURLToPath(import.meta.url));

/** 层 → 该层**允许**依赖的层。顺序即依赖方向，越靠后越底层。 */
const LAYERS = ['transport', 'agents', 'kernel', 'context', 'core'] as const;
type Layer = (typeof LAYERS)[number];

const ALLOWED: Record<Layer, readonly Layer[]> = {
  // 传输层可以调一切
  transport: ['transport', 'agents', 'kernel', 'context', 'core'],
  agents: ['agents', 'kernel', 'context', 'core'],
  // 基础设施层只认 contract 接口 + 同层
  kernel: ['kernel'],
  // context 与 core 是叶子：只认同层
  context: ['context', 'core'],
  core: ['core'],
};

/** 递归列出某层的所有 .ts 文件 */
function filesOf(layer: Layer): string[] {
  const dir = join(SRC, layer);
  const out: string[] = [];
  const walk = (d: string) => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (name.endsWith('.ts')) out.push(p);
    }
  };
  walk(dir);
  return out;
}

/** 找出 `from './x.js'` 或 `from '../layer/x.js'` 形式指向的层 */
function referencedLayer(fromFile: string, spec: string): Layer | null {
  if (!spec.startsWith('.')) return null;
  const target = resolve(dirname(fromFile), spec.replace(/\.js$/, ''));
  const rel = relative(SRC, target);
  const first = rel.split(/[\\/]/)[0];
  return (LAYERS as readonly string[]).includes(first) ? (first as Layer) : null;
}

/** 抽取一个文件里所有相对 import 的模块说明符 */
function relativeSpecifiers(source: string): string[] {
  const out: string[] = [];
  const re = /(?:from|import)\s+['"](\.[^'"]*)['"]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) out.push(m[1]!);
  return out;
}

/**
 * 分层规则**只约束生产代码**。
 *
 * 集成测试天然要跨层 —— `context/context-source.test.ts` 通过 `createMcpServer`
 * 驱动真实内核来验证上下文采集，这条路径跨 transport/kernel 是**应该**的。
 * 把规则套到测试上会逼着集成测试造假（比如绕过 transport 直接调 context），
 * 那才是真的伤害测试价值。
 */
function isProduction(file: string): boolean {
  return !file.endsWith('.test.ts');
}

/** 生产代码文件（排除测试） */
function prodFilesOf(layer: Layer): string[] {
  return filesOf(layer).filter(isProduction);
}

describe('agent 包分层规则', () => {
  it('五个层目录都存在（目录名写错也要立刻发现）', () => {
    for (const layer of LAYERS) {
      expect(() => statSync(join(SRC, layer)), `缺少 ${layer}/ 层`).not.toThrow();
    }
  });

  it('没有反向依赖：每层的生产代码 import 都在允许列表内', () => {
    const violations: string[] = [];
    for (const layer of LAYERS) {
      for (const file of prodFilesOf(layer)) {
        const src = readFileSync(file, 'utf-8');
        for (const spec of relativeSpecifiers(src)) {
          const target = referencedLayer(file, spec);
          if (target === null) continue;
          if (!ALLOWED[layer].includes(target)) {
            violations.push(`${layer}/${relative(SRC, file)} → ${target}  (${spec})`);
          }
        }
      }
    }
    expect(violations, `分层违规:\n  ${violations.join('\n  ')}`).toEqual([]);
  });

  it('core 与 context 是叶子：生产代码不得 import 上层', () => {
    // 单列一条，违规时错误信息直接点名，比上面那条泛化断言更易读
    for (const leaf of ['core', 'context'] as const) {
      for (const file of prodFilesOf(leaf)) {
        for (const spec of relativeSpecifiers(readFileSync(file, 'utf-8'))) {
          const target = referencedLayer(file, spec);
          if (target === null) continue;
          expect(
            ['core', 'context'].includes(target),
            `${leaf}/${relative(SRC, file)} 引入了 ${target} 层（叶子不得依赖上层）`,
          ).toBe(true);
        }
      }
    }
  });

  it('transport/agents/context/core 不直接值导入具体内核类（必须走 kernel/adapters）', () => {
    const offenders: string[] = [];
    for (const layer of ['transport', 'agents', 'context', 'core'] as const) {
      for (const file of prodFilesOf(layer)) {
        const src = readFileSync(file, 'utf-8');
        // 只检查会绕过 adapters 的「值导入」（import { X } 而非 import type）
        const valueImports =
          src.match(/^import\s+\{[^}]*\}\s+from\s+'@mc-creator\/kernel-/gm) ?? [];
        for (const line of valueImports) {
          offenders.push(`${layer}/${relative(SRC, file)}: ${line.trim()}`);
        }
      }
    }
    expect(offenders, `应通过 kernel/adapters.ts 访问内核:\n  ${offenders.join('\n  ')}`).toEqual(
      [],
    );
  });

  it('kernel/adapters.ts 是唯一允许值导入具体内核的地方', () => {
    const src = readFileSync(join(SRC, 'kernel', 'adapters.ts'), 'utf-8');
    expect(src).toMatch(/import \{ JavaKernel \}/);
    expect(src).toMatch(/import \{ ServerKernel \}/);
    expect(src).toMatch(/import \{ BedrockKernel \}/);
  });
});
