/**
 * 生成器**加载器开放范围**的策略测试。
 *
 * （与同目录 `generator-descriptors.test.ts` 分工：那个管描述符注册表本身的完整性，
 * 这个只管「哪些加载器开放给用户选」。）
 *
 * ## 这个文件钉两件事
 *
 * 1. **开放范围 ⊆ 生成器能力**。
 *
 *    这是历史上真实出过的事故：开放范围原先在两处 UI 各手写一份，结果都写歪了 ——
 *    `ProjectCreateDialog` 给了 `vanilla`，而 ModGenerator 没有它的 adapter，
 *    用户选完直接抛 `ModGenerator does not support loader: vanilla`；
 *    `SettingsPanel` 又漏了有可用 adapter 的 `forge`。两份手写列表各漂各的。
 *
 *    现在收敛到 `SUPPORTED_GENERATOR_LOADERS`（产品决策：只留 Fabric + NeoForge），
 *    这条测试保证它永远不会包含生成器做不到的加载器。
 *
 * 2. **范围的宽窄是产品决策，不是能力**。
 *
 *    开放范围窄于生成器的 `loaders` 是允许的（后者 5 个：quilt / legacy_fabric /
 *    forge 也有真实 adapter，只是不开放）；反过来不行 —— 所以断言方向是 ⊆ 不是 ===。
 *
 *    ⚠️ 生成器**移除**了某个已开放的加载器时这条测试会红，那就是要重新决策的信号
 *    （不是把测试改绿就算完）。
 */
import { describe, it, expect } from 'vitest';

import { createDefaultRegistry } from '@mc-creator/core/browser.js';
import type { Loader } from '@mc-creator/shared';
import { LOADERS } from '@mc-creator/shared';
import {
  SUPPORTED_GENERATOR_LOADERS,
  generatorLoaderOptions,
  isGeneratorLoaderSupported,
  isKnownButUnsupportedLoader,
  loaderLabel,
} from './generator-descriptors.js';

/**
 * 生成器真实支持的加载器。
 *
 * 取**默认注册表里实际注册的那个 mod 生成器**，而不是 `new ModGenerator()`：
 * 注册表才是运行时真正被 IPC 路由到的东西，将来换了实现也会被这条测试盯上。
 */
const modGenerator = createDefaultRegistry().get('mod');
if (!modGenerator) {
  throw new Error('默认注册表里没有 mod 生成器 —— 测试前提不成立');
}
const GENERATOR_CAPABILITY: readonly Loader[] = modGenerator.loaders;

describe('生成器加载器开放范围', () => {
  it('开放范围 ⊆ 生成器能力（给用户看的每个选项都真做得出来）', () => {
    for (const loader of SUPPORTED_GENERATOR_LOADERS) {
      expect(
        GENERATOR_CAPABILITY,
        `${loader} 在 UI 里开放，但生成器没有它的 adapter —— 用户选完会抛错`,
      ).toContain(loader);
    }
  });

  it('正好是 Fabric + NeoForge（产品决策，用户拍板）', () => {
    expect([...SUPPORTED_GENERATOR_LOADERS]).toEqual(['fabric', 'neoforge']);
  });

  it('不再开放 quilt / legacy_fabric / forge / vanilla（回归：这里曾手写出错）', () => {
    for (const l of ['quilt', 'legacy_fabric', 'forge', 'vanilla']) {
      expect(SUPPORTED_GENERATOR_LOADERS, `${l} 不应被开放`).not.toContain(l);
    }
  });

  it('生成器做不到 vanilla（所以「不开放 vanilla」不只是产品选择，还是正确性要求）', () => {
    // 反向核实：若生成器其实支持 vanilla，那「不开放 vanilla」就纯属产品口味；
    // 而现在生成器**做不到** vanilla，选它必抛错，所以必须不开放。
    expect(GENERATOR_CAPABILITY).not.toContain('vanilla');
  });

  it('quilt / legacy_fabric / forge 是「做得到但不开放」（钉住范围窄于能力这件事）', () => {
    // 这条让上面那个 ⊆ 断言不至于空转：既证明能力集合非空，
    // 也把「我们主动收窄了范围」这个决策记录下来 ——
    // 生成器若哪天移除了其中某个，这里会红，那就是要重新决策的信号。
    for (const l of ['quilt', 'legacy_fabric', 'forge']) {
      expect(GENERATOR_CAPABILITY, `生成器应仍能产出 ${l}`).toContain(l);
      expect(SUPPORTED_GENERATOR_LOADERS, `${l} 不应被开放`).not.toContain(l);
    }
  });

  it('isGeneratorLoaderSupported 与常量一致', () => {
    for (const l of SUPPORTED_GENERATOR_LOADERS) {
      expect(isGeneratorLoaderSupported(l)).toBe(true);
    }
    for (const l of LOADERS) {
      if (!SUPPORTED_GENERATOR_LOADERS.includes(l)) {
        expect(isGeneratorLoaderSupported(l), `${l} 应判为不开放`).toBe(false);
      }
    }
  });
});

/**
 * 已存在的项目可能存着不再开放的加载器。UI 不能把它过滤掉 ——
 * 那样 select 的 value 落在列表外，浏览器显示空白，用户既看不出它是什么
 * 也改不回来（而重新选一个会**改变生成产物**，必须用户自己决定）。
 * 所以要能识别「认识但不开放」，把旧值显式列成禁用项。
 */
describe('历史项目的旧加载器', () => {
  it('认识但已不开放的 loader 能被识别（用于下拉里显示成禁用项）', () => {
    for (const l of ['quilt', 'legacy_fabric', 'forge', 'vanilla']) {
      expect(isKnownButUnsupportedLoader(l), `${l} 应判为「认识但不开放」`).toBe(true);
    }
  });

  it('开放中的不算「不开放」', () => {
    for (const l of SUPPORTED_GENERATOR_LOADERS) {
      expect(isKnownButUnsupportedLoader(l)).toBe(false);
    }
  });

  it('完全不认识的返回值不冒充「认识但不开放」', () => {
    expect(isKnownButUnsupportedLoader('完全不认识的加载器')).toBe(false);
    expect(isKnownButUnsupportedLoader('')).toBe(false);
  });
});

describe('generatorLoaderOptions（三处下拉共用的选项构造）', () => {
  it('开放项正好是 Fabric + NeoForge，顺序稳定', () => {
    expect(generatorLoaderOptions('fabric').map((o) => o.value)).toEqual(['fabric', 'neoforge']);
    expect(generatorLoaderOptions('fabric').map((o) => o.label)).toEqual(['Fabric', 'NeoForge']);
    expect(generatorLoaderOptions('fabric').every((o) => !o.disabled)).toBe(true);
  });

  it('当前值是旧加载器时补一个禁用项（而不是让它落到列表外）', () => {
    for (const l of ['quilt', 'legacy_fabric', 'forge', 'vanilla']) {
      const opts = generatorLoaderOptions(l);
      const legacy = opts.find((o) => o.value === l);
      expect(legacy, `${l} 必须列出来，否则 select 显示空白`).toBeTruthy();
      expect(legacy?.disabled, `${l} 旧值必须是禁用的`).toBe(true);
      expect(legacy?.label).toContain(loaderLabel(l));
      // 开放项不受影响
      expect(opts.filter((o) => !o.disabled).map((o) => o.value)).toEqual(['fabric', 'neoforge']);
    }
  });

  it('当前值已开放时不重复补项（避免 select 出现两个同 value 的 option）', () => {
    for (const l of SUPPORTED_GENERATOR_LOADERS) {
      const values = generatorLoaderOptions(l).map((o) => o.value);
      expect(new Set(values).size, `${l}: ${values.join(',')}`).toBe(values.length);
    }
  });

  it('当前值完全未知时也不补项（不冒充「认识的旧加载器」）', () => {
    const values = generatorLoaderOptions('压根不存在的加载器').map((o) => o.value);
    expect(values).toEqual(['fabric', 'neoforge']);
  });
});

describe('loaderLabel', () => {
  it('每个 loader 都有可读的名字（不允许掉落成原始枚举值）', () => {
    for (const l of LOADERS) {
      expect(loaderLabel(l), `${l} 没有标签`).not.toBe(l);
    }
  });

  it('fabric / neoforge 的显示名与启动器侧一致', () => {
    expect(loaderLabel('fabric')).toBe('Fabric');
    expect(loaderLabel('neoforge')).toBe('NeoForge');
  });

  it('生造的值原样返回（比空白好）', () => {
    expect(loaderLabel('未来新增的加载器')).toBe('未来新增的加载器');
  });
});
