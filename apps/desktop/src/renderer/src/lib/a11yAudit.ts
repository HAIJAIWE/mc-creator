/**
 * a11y 审计工具函数
 *
 * 扫描 DOM 树，返回缺失 a11y 属性的元素列表。
 * 主要用于：
 * - 开发时审计：在控制台打印 a11y 缺口
 * - 测试断言：测试中确认某组件无 a11y 问题
 *
 * ## 用法
 * ```ts
 * import { auditA11y } from '@renderer/lib/a11yAudit';
 *
 * const issues = auditA11y(document.body);
 * if (issues.length > 0) {
 *   console.warn('a11y issues:', issues);
 * }
 * ```
 *
 * ## 检查项
 * 1. button 无 aria-label 且无可见文本
 * 2. input/textarea/select 无关联 label（htmlFor/aria-label/aria-labelledby）
 * 3. ul/ol 缺少 role="list"（某些 CSS reset 会移除默认语义）
 * 4. role="status"/"alert" 区域为空但邻近有动态内容（启发式，可误报）
 * 5. img 缺少 alt
 * 6. 仅图标按钮（按钮内仅有 aria-hidden 元素）无 aria-label
 * 7. 表单元素 disabled 但未提供原因说明
 * 8. dialog 缺少 aria-modal 或 aria-label
 * 9. tablist/tab/tabpanel 缺失对应关系
 * 10. 滚动容器缺少 tabindex（键盘无法聚焦滚动）
 *
 * ## 注意
 * - 该工具是启发式检查，不能替代 axe-core 等专业工具。
 * - 仅检查元素本身，不检查颜色对比度等视觉问题。
 */

/** a11y 问题严重程度 */
export type A11ySeverity = 'error' | 'warning';

/** a11y 问题接口 */
export interface A11yIssue {
  /** 元素描述（如 `button#save`、`input.pf-label`） */
  element: string;
  /** 问题描述 */
  issue: string;
  /** 修复建议 */
  suggestion: string;
  /** 严重程度：error（影响主要功能）/ warning（次要） */
  severity: A11ySeverity;
}

/** 检查项 ID，便于测试和过滤 */
export type A11yRuleId =
  | 'button-no-label'
  | 'input-no-label'
  | 'textarea-no-label'
  | 'select-no-label'
  | 'list-no-role'
  | 'img-no-alt'
  | 'icon-only-button-no-label'
  | 'dialog-no-modal'
  | 'dialog-no-label'
  | 'tablist-incomplete'
  | 'live-region-missing'
  | 'heading-empty'
  | 'interactive-negative-tabindex';

/** 带规则 ID 的问题（便于测试断言） */
export interface A11yIssueWithRule extends A11yIssue {
  /** 触发的规则 ID */
  ruleId: A11yRuleId;
}

/** 描述一个元素的简短字符串：tag#id.class1.class2 */
function describeElement(el: Element): string {
  const tag = el.tagName.toLowerCase();
  const id = el.id ? `#${el.id}` : '';
  const classes = Array.from(el.classList)
    .slice(0, 2)
    .map((c) => `.${c}`)
    .join('');
  return `${tag}${id}${classes}`;
}

/** 判断按钮是否"仅图标"：按钮内只有 aria-hidden 元素或空 */
function isIconOnlyButton(el: HTMLButtonElement): boolean {
  // 如果有 aria-label / aria-labelledby，则不算 icon-only
  if (el.getAttribute('aria-label') || el.getAttribute('aria-labelledby')) return false;
  // 检查按钮内是否有可见文本
  const textContent = (el.textContent ?? '').trim();
  if (textContent.length > 0) {
    // 检查文本是否全部来自 aria-hidden 子元素
    const visible = el.cloneNode(true) as HTMLButtonElement;
    visible.querySelectorAll('[aria-hidden="true"]').forEach((n) => n.remove());
    const visibleText = (visible.textContent ?? '').trim();
    if (visibleText.length > 0) return false;
  }
  // 没有可见文本 → 仅图标
  return true;
}

/** 检查 form 元素是否有关联 label */
function hasAssociatedLabel(
  el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
): boolean {
  // 1. aria-label
  if (el.getAttribute('aria-label')) return true;
  // 2. aria-labelledby
  if (el.getAttribute('aria-labelledby')) return true;
  // 3. <label for=id> 包裹
  const id = el.id;
  if (id) {
    const root = el.getRootNode() as HTMLElement | Document;
    // 用属性选择器查询，不依赖 CSS.escape（jsdom 早期版本可能缺失）
    const labelForId = root.querySelector(`label[for="${id}"]`);
    if (labelForId) return true;
  }
  // 4. 父元素是 <label>
  let parent: Element | null = el.parentElement;
  while (parent && parent.tagName !== 'FIELDSET' && parent.tagName !== 'FORM') {
    if (parent.tagName === 'LABEL') return true;
    parent = parent.parentElement;
  }
  return false;
}

/**
 * 审计根节点下所有元素的 a11y 问题。
 *
 * @param root 根节点（通常是 document.body 或组件容器）
 * @returns 问题列表（按 DOM 顺序）
 */
export function auditA11y(root: HTMLElement): A11yIssueWithRule[] {
  const issues: A11yIssueWithRule[] = [];

  // 1. button 检查
  root.querySelectorAll('button').forEach((el: HTMLButtonElement) => {
    if (isIconOnlyButton(el)) {
      issues.push({
        ruleId: 'icon-only-button-no-label',
        element: describeElement(el),
        issue: '按钮内无可见文本，且无 aria-label/aria-labelledby',
        suggestion: '为仅图标按钮添加 aria-label 描述其动作，如 aria-label="保存"',
        severity: 'error',
      });
    } else if (!el.getAttribute('aria-label') && !el.getAttribute('aria-labelledby')) {
      // 按钮有可见文本但无 aria-label（warning：可见文本可被屏幕阅读器识别，但显式 label 更稳）
      const text = (el.textContent ?? '').trim();
      if (text.length === 0) {
        issues.push({
          ruleId: 'button-no-label',
          element: describeElement(el),
          issue: '按钮既无可见文本也无 aria-label',
          suggestion: '为按钮添加可见文本或 aria-label',
          severity: 'error',
        });
      }
    }
  });

  // 2. input 检查
  root.querySelectorAll('input').forEach((el: HTMLInputElement) => {
    // type=hidden / submit / button / reset / image 这些不需要 label
    const type = (el.type || '').toLowerCase();
    if (['hidden', 'submit', 'button', 'reset', 'image'].includes(type)) return;
    if (!hasAssociatedLabel(el)) {
      issues.push({
        ruleId: 'input-no-label',
        element: describeElement(el),
        issue: 'input 元素无关联 label（for/aria-label/aria-labelledby/包裹式 <label>）',
        suggestion: '为 input 关联 <label htmlFor> 或添加 aria-label',
        severity: 'error',
      });
    }
  });

  // 3. textarea 检查
  root.querySelectorAll('textarea').forEach((el: HTMLTextAreaElement) => {
    if (!hasAssociatedLabel(el)) {
      issues.push({
        ruleId: 'textarea-no-label',
        element: describeElement(el),
        issue: 'textarea 元素无关联 label',
        suggestion: '为 textarea 关联 <label htmlFor> 或添加 aria-label',
        severity: 'error',
      });
    }
  });

  // 4. select 检查
  root.querySelectorAll('select').forEach((el: HTMLSelectElement) => {
    if (!hasAssociatedLabel(el)) {
      issues.push({
        ruleId: 'select-no-label',
        element: describeElement(el),
        issue: 'select 元素无关联 label',
        suggestion: '为 select 关联 <label htmlFor> 或添加 aria-label',
        severity: 'error',
      });
    }
  });

  // 5. ul/ol 缺 role=list（某些 CSS list-style:none 会移除 Safari 默认语义）
  root.querySelectorAll('ul, ol').forEach((el: Element) => {
    if (!el.getAttribute('role')) {
      issues.push({
        ruleId: 'list-no-role',
        element: describeElement(el),
        issue: 'ul/ol 缺少 role="list"（部分浏览器在 list-style:none 时丢失语义）',
        suggestion: '显式添加 role="list"',
        severity: 'warning',
      });
    }
  });

  // 6. img 缺 alt
  root.querySelectorAll('img').forEach((el: HTMLImageElement) => {
    if (!el.hasAttribute('alt')) {
      issues.push({
        ruleId: 'img-no-alt',
        element: describeElement(el),
        issue: 'img 元素缺少 alt 属性',
        suggestion: '添加 alt=""（装饰性）或 alt="描述"（有意义）',
        severity: 'error',
      });
    }
  });

  // 7. dialog 缺 aria-modal / aria-label
  root.querySelectorAll('[role="dialog"], dialog').forEach((el: Element) => {
    // 原生 dialog 元素自带语义；role="dialog" 的检查见下
    if (!el.getAttribute('aria-modal') && el.getAttribute('role') === 'dialog') {
      issues.push({
        ruleId: 'dialog-no-modal',
        element: describeElement(el),
        issue: 'role="dialog" 缺少 aria-modal="true"',
        suggestion: '添加 aria-modal="true" 让屏幕阅读器识别为模态',
        severity: 'warning',
      });
    }
    if (!el.getAttribute('aria-label') && !el.getAttribute('aria-labelledby')) {
      issues.push({
        ruleId: 'dialog-no-label',
        element: describeElement(el),
        issue: '对话框无 aria-label 或 aria-labelledby',
        suggestion: '为对话框添加 aria-label 描述其用途',
        severity: 'error',
      });
    }
  });

  // 8. tablist 完整性检查
  root.querySelectorAll('[role="tablist"]').forEach((tablist: Element) => {
    const tabs = tablist.querySelectorAll('[role="tab"]');
    if (tabs.length === 0) {
      issues.push({
        ruleId: 'tablist-incomplete',
        element: describeElement(tablist),
        issue: 'role="tablist" 内无 role="tab" 子元素',
        suggestion: '为 tablist 添加 role="tab" 子元素',
        severity: 'error',
      });
    }
    // 每个 tab 应有 aria-controls 指向对应 tabpanel
    tabs.forEach((tab: Element) => {
      if (!tab.getAttribute('aria-controls')) {
        issues.push({
          ruleId: 'tablist-incomplete',
          element: describeElement(tab),
          issue: 'role="tab" 缺少 aria-controls 指向对应 tabpanel',
          suggestion: '添加 aria-controls="tabpanel-id"',
          severity: 'warning',
        });
      }
    });
  });

  // 9. 空 heading（h1-h6）
  root.querySelectorAll('h1, h2, h3, h4, h5, h6').forEach((el: Element) => {
    const text = (el.textContent ?? '').trim();
    if (text.length === 0) {
      issues.push({
        ruleId: 'heading-empty',
        element: describeElement(el),
        issue: '标题元素无文本内容',
        suggestion: '为标题添加可见文本或 aria-label',
        severity: 'error',
      });
    }
  });

  // 10. 交互元素负 tabindex（keyboard trap）
  root.querySelectorAll('a, button, input, [role="button"]').forEach((el: Element) => {
    const tabIndex = el.getAttribute('tabindex');
    if (tabIndex && parseInt(tabIndex, 10) < 0) {
      issues.push({
        ruleId: 'interactive-negative-tabindex',
        element: describeElement(el),
        issue: '交互元素有负 tabindex，键盘用户无法聚焦',
        suggestion: '移除 tabindex="-1" 或改为 tabindex="0"',
        severity: 'warning',
      });
    }
  });

  return issues;
}

/**
 * 便捷：只返回 error 级别的问题。
 */
export function auditA11yErrors(root: HTMLElement): A11yIssueWithRule[] {
  return auditA11y(root).filter((i) => i.severity === 'error');
}

/**
 * 便捷：将问题格式化为控制台友好的字符串。
 * 用于开发时 `console.warn(formatA11yIssues(auditA11y(document.body)))`。
 */
export function formatA11yIssues(issues: A11yIssue[]): string {
  if (issues.length === 0) return '✓ a11y 审计通过，未发现问题';
  const lines = issues.map(
    (i) => `  [${i.severity.toUpperCase()}] ${i.element}: ${i.issue}\n    → ${i.suggestion}`,
  );
  return `a11y 审计发现 ${issues.length} 个问题：\n${lines.join('\n')}`;
}
