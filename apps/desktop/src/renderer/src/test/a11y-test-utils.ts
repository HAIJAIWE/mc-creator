// @vitest-environment jsdom
import 'axe-core'; // 副作用导入：在 jsdom 下挂载 window.axe
import type * as AxeTypes from 'axe-core';

/**
 * a11y 自动化扫描工具（P9.3）。
 *
 * 基于 axe-core，在 vitest + jsdom 环境下扫描组件 ARIA/WCAG 违规。
 *
 * axe-core 是 IIFE 格式，CJS `module.exports = axe` 在 vitest ESM 下 `import axe from 'axe-core'`
 * 会返回 undefined。正确做法是副作用导入 `import 'axe-core'`，然后从 `window.axe` 读取
 * （jsdom 下 window.getComputedStyle 存在时 axe-core 会自动挂载）。
 *
 * 注意 axe-core 的两套 rules 类型：
 * - `axe.run(context, options: RunOptions)` 的 `options.rules` 是 `RuleObject`（对象），
 *   key 为 rule ID，value 为 `{ enabled: boolean }`。用于在运行时启用/禁用规则。
 * - `axe.configure(spec: Spec)` 的 `spec.rules` 是 `Rule[]`（数组），
 *   用于注册新规则或修改规则元数据，不能用来禁用规则。
 *   因此本工具不提供 configureAxeForJest——禁用规则应通过 axe.run 的 options 完成。
 *
 * jsdom 已知限制（必须禁用的 axe 规则）：
 * - color-contrast：jsdom 不计算 CSS 实际渲染样式，会误报
 * - region / landmark-one-main / page-has-heading-one：单组件渲染时不构成完整页面，会误报
 * - tabindex：jsdom 对 tabindex 的计算与浏览器有差异，且 IconTabBar 的 roving tabindex 是设计意图
 * - focus-order-semantics：单组件脱离页面上下文，焦点顺序无法正确评估
 * - target-size：jsdom 不支持完整 CSS 布局，触摸目标检测不可靠
 *
 * 用法：
 *   import { assertA11y } from '../test/a11y-test-utils';
 *   import { render } from '@testing-library/react';
 *
 *   it('无 a11y 违规', async () => {
 *     const { container } = render(<MyComponent />);
 *     await assertA11y(container);
 *   });
 */

type Axe = typeof AxeTypes;

function getAxe(): Axe {
  const axe = (window as unknown as { axe?: Axe }).axe;
  if (!axe) throw new Error('window.axe 未挂载，请确认 axe-core 已正确导入');
  return axe;
}

/**
 * axe 配置：禁用 jsdom 不适用或单组件上下文不适用的规则。
 *
 * 注意：必须是对象 Record<string, {enabled: boolean}>，不能是数组——
 * 数组会被 axe 内部 Object.keys() 解析为 ["0","1",...] 作为 rule ID，导致 unknown rule '0' 错误。
 */
export const A11Y_RULES_DISABLE: AxeTypes.RuleObject = {
  // jsdom 不计算 CSS，颜色对比度无法检测
  'color-contrast': { enabled: false },
  // 单组件渲染不构成完整页面，landmark/region 规则会误报
  region: { enabled: false },
  'landmark-one-main': { enabled: false },
  'page-has-heading-one': { enabled: false },
  // tabindex 在 jsdom 下的计算与浏览器不一致，且 roving tabindex 是设计意图
  tabindex: { enabled: false },
  // 单组件脱离页面上下文，焦点顺序无法评估
  'focus-order-semantics': { enabled: false },
  // jsdom 不支持完整 CSS 布局，target-size 触摸目标检测不可靠
  'target-size': { enabled: false },
};

/**
 * 断言容器内无 a11y 违规。
 *
 * 失败时输出可读的违规清单（含 selector / failureSummary / helpUrl）。
 *
 * @param container 渲染容器
 * @param extraRules 额外禁用的规则（与 A11Y_RULES_DISABLE 合并）
 */
export async function assertA11y(
  container: HTMLElement,
  extraRules?: AxeTypes.RuleObject,
): Promise<void> {
  const axe = getAxe();
  const rules: AxeTypes.RuleObject = extraRules
    ? { ...A11Y_RULES_DISABLE, ...extraRules }
    : A11Y_RULES_DISABLE;
  const results = await axe.run(container, {
    rules,
    runOnly: {
      type: 'tag',
      values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'],
    },
  });

  if (results.violations.length > 0) {
    const lines = results.violations.map((v) => {
      const nodes = v.nodes
        .map((n) => {
          const target = Array.isArray(n.target) ? n.target.join(', ') : String(n.target);
          return `    - target: ${target}\n      ${n.failureSummary ?? '(no summary)'}`;
        })
        .join('\n');
      return `[${v.id}] ${v.help}\n  impact: ${v.impact}\n  help: ${v.helpUrl}\n  nodes:\n${nodes}`;
    });
    throw new Error(
      `axe-core 发现 ${results.violations.length} 个 a11y 违规：\n${lines.join('\n\n')}`,
    );
  }
}

/**
 * 获取违规清单（不断言，用于调试）。
 */
export async function getA11yViolations(container: HTMLElement): Promise<AxeTypes.Result[]> {
  const axe = getAxe();
  const results = await axe.run(container, {
    rules: A11Y_RULES_DISABLE,
    runOnly: {
      type: 'tag',
      values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'],
    },
  });
  return results.violations;
}
