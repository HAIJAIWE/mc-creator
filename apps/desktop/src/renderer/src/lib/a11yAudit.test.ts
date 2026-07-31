// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  auditA11y,
  auditA11yErrors,
  formatA11yIssues,
  type A11yIssueWithRule,
} from './a11yAudit.js';

/**
 * a11yAudit 测试：覆盖各规则触发/不触发情况
 *
 * 测试策略：
 * - 每条规则单独测试「应触发」和「不应触发」两种情况
 * - 用真实 DOM（jsdom）渲染 HTML 后调用 auditA11y
 * - 测试公共工具函数（auditA11yErrors / formatA11yIssues）
 */

beforeEach(() => {
  // 确保每个用例都从干净 DOM 开始
  document.body.innerHTML = '';
});

afterEach(() => {
  document.body.innerHTML = '';
});

/** 创建容器并返回 */
function mount(html: string): HTMLElement {
  const container = document.createElement('div');
  container.innerHTML = html;
  document.body.appendChild(container);
  return container;
}

/** 提取某 ruleId 的所有问题 */
function findIssues(issues: A11yIssueWithRule[], ruleId: string): A11yIssueWithRule[] {
  return issues.filter((i) => i.ruleId === ruleId);
}

describe('auditA11y — button 检查', () => {
  it('1. 仅图标按钮无 aria-label → 触发 icon-only-button-no-label (error)', () => {
    const root = mount(`
      <button>
        <svg aria-hidden="true"><path /></svg>
      </button>
    `);
    const issues = auditA11y(root);
    const iconIssues = findIssues(issues, 'icon-only-button-no-label');
    expect(iconIssues.length).toBeGreaterThanOrEqual(1);
    expect(iconIssues[0].severity).toBe('error');
  });

  it('2. 仅图标按钮有 aria-label → 不触发', () => {
    const root = mount(`
      <button aria-label="保存">
        <svg aria-hidden="true"><path /></svg>
      </button>
    `);
    const issues = auditA11y(root);
    const iconIssues = findIssues(issues, 'icon-only-button-no-label');
    expect(iconIssues.length).toBe(0);
  });

  it('3. 按钮有可见文本 → 不触发 button-no-label', () => {
    const root = mount(`<button>保存</button>`);
    const issues = auditA11y(root);
    const btnIssues = findIssues(issues, 'button-no-label');
    expect(btnIssues.length).toBe(0);
  });

  it('4. 空按钮（无文本无 aria-label 无子元素）→ 触发 button-no-label (error)', () => {
    const root = mount(`<button></button>`);
    const issues = auditA11y(root);
    // 空按钮既可能命中 icon-only（空）也可能命中 button-no-label，至少有一个 error
    const errors = issues.filter((i) => i.severity === 'error');
    expect(errors.length).toBeGreaterThanOrEqual(1);
  });
});

describe('auditA11y — input/textarea/select 检查', () => {
  it('5. input 无 label → 触发 input-no-label (error)', () => {
    const root = mount(`<input type="text" />`);
    const issues = auditA11y(root);
    const inpIssues = findIssues(issues, 'input-no-label');
    expect(inpIssues.length).toBe(1);
    expect(inpIssues[0].severity).toBe('error');
  });

  it('6. input 有 aria-label → 不触发', () => {
    const root = mount(`<input type="text" aria-label="用户名" />`);
    const issues = auditA11y(root);
    expect(findIssues(issues, 'input-no-label').length).toBe(0);
  });

  it('7. input 由 <label for> 关联 → 不触发', () => {
    const root = mount(`
      <label for="username">用户名</label>
      <input type="text" id="username" />
    `);
    const issues = auditA11y(root);
    expect(findIssues(issues, 'input-no-label').length).toBe(0);
  });

  it('8. input 被包裹在 <label> 内 → 不触发', () => {
    const root = mount(`
      <label>
        邮箱
        <input type="email" />
      </label>
    `);
    const issues = auditA11y(root);
    expect(findIssues(issues, 'input-no-label').length).toBe(0);
  });

  it('9. input type=hidden/submit/button/reset 不检查', () => {
    const root = mount(`
      <input type="hidden" name="csrf" />
      <input type="submit" value="提交" />
      <input type="button" value="按钮" />
      <input type="reset" value="重置" />
    `);
    const issues = auditA11y(root);
    expect(findIssues(issues, 'input-no-label').length).toBe(0);
  });

  it('10. textarea 无 label → 触发 textarea-no-label', () => {
    const root = mount(`<textarea></textarea>`);
    const issues = auditA11y(root);
    expect(findIssues(issues, 'textarea-no-label').length).toBe(1);
  });

  it('11. select 无 label → 触发 select-no-label', () => {
    const root = mount(`<select><option>A</option></select>`);
    const issues = auditA11y(root);
    expect(findIssues(issues, 'select-no-label').length).toBe(1);
  });

  it('12. select 有 aria-labelledby → 不触发', () => {
    const root = mount(`
      <span id="lbl">国家</span>
      <select aria-labelledby="lbl"><option>CN</option></select>
    `);
    const issues = auditA11y(root);
    expect(findIssues(issues, 'select-no-label').length).toBe(0);
  });
});

describe('auditA11y — 列表/图片/对话框检查', () => {
  it('13. ul 缺 role=list → 触发 list-no-role (warning)', () => {
    const root = mount(`<ul><li>a</li></ul>`);
    const issues = auditA11y(root);
    const listIssues = findIssues(issues, 'list-no-role');
    expect(listIssues.length).toBe(1);
    expect(listIssues[0].severity).toBe('warning');
  });

  it('14. ul 有 role=list → 不触发', () => {
    const root = mount(`<ul role="list"><li>a</li></ul>`);
    const issues = auditA11y(root);
    expect(findIssues(issues, 'list-no-role').length).toBe(0);
  });

  it('15. img 缺 alt → 触发 img-no-alt (error)', () => {
    const root = mount(`<img src="x.png" />`);
    const issues = auditA11y(root);
    const imgIssues = findIssues(issues, 'img-no-alt');
    expect(imgIssues.length).toBe(1);
    expect(imgIssues[0].severity).toBe('error');
  });

  it('16. img alt="" 视为装饰性，不触发', () => {
    const root = mount(`<img src="bg.png" alt="" />`);
    const issues = auditA11y(root);
    expect(findIssues(issues, 'img-no-alt').length).toBe(0);
  });

  it('17. role="dialog" 缺 aria-modal 和 aria-label → 触发两条', () => {
    const root = mount(`<div role="dialog"></div>`);
    const issues = auditA11y(root);
    expect(findIssues(issues, 'dialog-no-modal').length).toBe(1);
    expect(findIssues(issues, 'dialog-no-label').length).toBe(1);
  });

  it('18. role="dialog" 完整 → 不触发', () => {
    const root = mount(`<div role="dialog" aria-modal="true" aria-label="确认删除"></div>`);
    const issues = auditA11y(root);
    expect(findIssues(issues, 'dialog-no-modal').length).toBe(0);
    expect(findIssues(issues, 'dialog-no-label').length).toBe(0);
  });
});

describe('auditA11y — tablist/标题/tabindex 检查', () => {
  it('19. role="tablist" 无 role="tab" 子元素 → 触发 tablist-incomplete', () => {
    const root = mount(`<div role="tablist"></div>`);
    const issues = auditA11y(root);
    expect(findIssues(issues, 'tablist-incomplete').length).toBeGreaterThanOrEqual(1);
  });

  it('20. role="tab" 缺 aria-controls → 触发 tablist-incomplete (warning)', () => {
    const root = mount(`
      <div role="tablist">
        <button role="tab">标签1</button>
      </div>
    `);
    const issues = auditA11y(root);
    const tabIssues = findIssues(issues, 'tablist-incomplete');
    // 应只命中"缺 aria-controls"这一条（不是 tablist 为空）
    expect(tabIssues.length).toBe(1);
    expect(tabIssues[0].severity).toBe('warning');
  });

  it('21. 空标题（h1 无文本）→ 触发 heading-empty', () => {
    const root = mount(`<h1></h1>`);
    const issues = auditA11y(root);
    const hIssues = findIssues(issues, 'heading-empty');
    expect(hIssues.length).toBe(1);
    expect(hIssues[0].severity).toBe('error');
  });

  it('22. 有文本的标题 → 不触发', () => {
    const root = mount(`<h2>章节标题</h2>`);
    const issues = auditA11y(root);
    expect(findIssues(issues, 'heading-empty').length).toBe(0);
  });

  it('23. 交互元素 tabindex="-1" → 触发 interactive-negative-tabindex (warning)', () => {
    const root = mount(`<a href="#" tabindex="-1">链接</a>`);
    const issues = auditA11y(root);
    const tIssues = findIssues(issues, 'interactive-negative-tabindex');
    expect(tIssues.length).toBe(1);
    expect(tIssues[0].severity).toBe('warning');
  });

  it('24. tabindex="0" 不触发 interactive-negative-tabindex', () => {
    const root = mount(`<div tabindex="0">div</div>`);
    const issues = auditA11y(root);
    expect(findIssues(issues, 'interactive-negative-tabindex').length).toBe(0);
  });
});

describe('auditA11y — 工具函数', () => {
  it('25. auditA11yErrors 只返回 error 级别问题', () => {
    const root = mount(`
      <input type="text" />
      <ul><li>a</li></ul>
    `);
    const all = auditA11y(root);
    const errorsOnly = auditA11yErrors(root);
    expect(errorsOnly.length).toBeLessThanOrEqual(all.length);
    expect(errorsOnly.every((i) => i.severity === 'error')).toBe(true);
  });

  it('26. formatA11yIssues 空数组返回通过消息', () => {
    const s = formatA11yIssues([]);
    expect(s).toContain('通过');
    expect(s).toContain('✓');
  });

  it('27. formatA11yIssues 包含元素名和建议', () => {
    const issues: A11yIssueWithRule[] = [
      {
        ruleId: 'input-no-label',
        element: 'input#username',
        issue: 'input 元素无关联 label',
        suggestion: '为 input 关联 <label htmlFor> 或添加 aria-label',
        severity: 'error',
      },
    ];
    const s = formatA11yIssues(issues);
    expect(s).toContain('input#username');
    expect(s).toContain('aria-label');
    expect(s).toContain('ERROR');
  });

  it('28. 干净的 a11y 友好 DOM 应返回空列表', () => {
    const root = mount(`
      <div role="region" aria-label="表单">
        <label for="name">姓名</label>
        <input id="name" type="text" />
        <button aria-label="保存"><svg aria-hidden="true"></svg></button>
        <ul role="list"><li>项1</li></ul>
        <img src="logo.png" alt="Logo" />
      </div>
    `);
    const issues = auditA11y(root);
    expect(issues.length).toBe(0);
  });
});
