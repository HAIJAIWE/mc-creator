# MC Creator 无障碍（a11y）指南

本指南定义 MC Creator 项目的无障碍标准、本轮修复清单以及未来待改进项。
所有 PR 涉及 UI 时都应参考本指南，并通过 `auditA11y` 工具自检。

---

## 一、本项目 a11y 标准

### 1. role 与语义化

- **页面 landmark**：`role="region"` / `role="application"` / `role="banner"` 必须搭配 `aria-label`，让屏幕阅读器用户能识别区域用途。
- **表单分组**：`role="group" + aria-label="xxx属性"` 用于把同类字段聚成一组。
- **动态通知区**：使用 `<LiveRegion />` 组件，**不要**直接在 `<div role="status">` 上写消息。
- **错误/警告**：错误用 `role="alert"`（即时打断），警告用 `role="status"`（等空闲）。
- **列表**：`<ul role="list">` 显式声明语义（部分浏览器在 `list-style: none` 时丢失默认语义）。
- **tablist**：`role="tablist"` + `role="tab" aria-controls` + `role="tabpanel"`，完整三件套。

### 2. aria-label / aria-labelledby

- **图标按钮**：必须 `aria-label`，否则屏幕阅读器朗读空。
- **input/textarea/select**：必须关联 `<label htmlFor>` 或 `aria-label` 或 `aria-labelledby`。
- **仅装饰图标**：`aria-hidden="true"`，避免被朗读。
- **状态徽章**：`aria-label="xxx"` 描述状态含义。

### 3. aria-live 动态区域

- 使用 `<LiveRegion message={msg} politeness="polite" />` 组件，**不要**手写 `aria-live` div。
- 编译状态、保存结果、节点添加等动态事件应通过 `useLiveRegion` hook 推送。
- `politeness="assertive"` 仅用于「保存失败」等需要立即打断的错误。
- 默认 `clearAfterMs` 不设（消息持续到下次 announce），如需避免重复朗读可设 3000ms。
- `useLiveRegion` 内置 500ms 防抖，避免快速连续触发时听不清。

### 4. 键盘导航

- **可交互元素**：`<button>` / `<a>` 默认支持键盘，不要用 `<div onClick>` 替代。
- **radiogroup**：ArrowLeft/ArrowRight/ArrowUp/ArrowDown/Home/End 在选项间切换，焦点跟随选中项（roving tabindex）。
- **listbox**：ArrowUp/ArrowDown 在选项间移动，Space/Enter 选中。
- **dialog**：Escape 关闭，Tab 在对话框内循环（focus trap）。
- **快捷键**：Ctrl+Z 撤销、Ctrl+Y/Ctrl+Shift+Z 重做、Ctrl+D 复制、Escape 取消选中。
- **跳过链接**：每个 tab/视图都应有可见的 `:focus-visible` 焦点环（已在 `index.css` 设置 2px accent 实线）。

### 5. 焦点管理

- **打开 dialog**：渲染后立即 `focus()` 第一个可交互元素。
- **关闭 dialog**：关闭后焦点返回触发按钮。
- **删除节点**：删除后焦点移到下一个节点或相邻元素。
- **加载状态**：禁用按钮时设 `aria-disabled="true"` 并保留 `tabindex`（不要完全移除）。

---

## 二、本轮修复清单（已完成）

### A. 新建 a11y 基础设施

| 文件                                                                  | 用途                                                                                                                                                              |
| --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/desktop/src/renderer/src/components/common/LiveRegion.tsx`      | 可复用 aria-live 区域组件，支持 `politeness` / `atomic` / `relevant` / `id` / `className` / `clearAfterMs` props                                                  |
| `apps/desktop/src/renderer/src/lib/useLiveRegion.ts`                  | hook：`{ message, announce, clear, LiveRegion }`，500ms 防抖                                                                                                      |
| `apps/desktop/src/renderer/src/components/common/useLiveRegion.ts`    | re-export `lib/useLiveRegion.ts`（保留路径兼容）                                                                                                                  |
| `apps/desktop/src/renderer/src/components/common/LiveRegion.test.tsx` | 25 个测试覆盖组件渲染、politeness、atomic、relevant、id、className、空消息、多实例、clearAfterMs 自动清空、防抖、清空、卸载清理                                   |
| `apps/desktop/src/renderer/src/lib/a11yAudit.ts`                      | a11y 审计函数 `auditA11y(root)` + `auditA11yErrors` + `formatA11yIssues`，检查 button/input/textarea/select/list/img/dialog/tablist/heading/tabindex 共 12 类规则 |
| `apps/desktop/src/renderer/src/lib/a11yAudit.test.ts`                 | 28 个测试覆盖每条规则的触发与不触发                                                                                                                               |
| `docs/a11y-guidelines.md`                                             | 本指南                                                                                                                                                            |

### B. 修改的 4 个独立组件

| 组件                  | 修改内容                                                                                                                                                                                                               |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PropertyPanel.tsx`   | 顶层加 `role="region" aria-label="节点属性面板"`（其余 a11y 已存在：role="alert" 错误、role="status" 警告、Field label htmlFor、role="group" 分组、aria-hidden 图标、aria-label 图标按钮）                             |
| `NodePalette.tsx`     | 节点列表加 `role="listbox" aria-label="可用节点列表" aria-orientation="vertical"`；节点项加 `role="option" aria-selected="false"`（保留原有 role="search" / role="group" 分类 / aria-label 节点项 / aria-hidden 图标） |
| `ModeSwitcher.tsx`    | （另一个 Agent 已增强）`role="radiogroup"` + `role="radio" aria-checked` + roving tabindex + ArrowLeft/Right/Up/Down/Home/End 键盘导航 + aria-hidden 短名前缀                                                          |
| `NodeGraphEditor.tsx` | （另一个 Agent 已集成 useLiveRegion 朗读编译结果）追加 `aria-activedescendant={selectedNodeId ?? undefined}` 指向当前选中节点，让屏幕阅读器朗读画布焦点                                                                |

### C. 测试通过情况

```
Test Files  5 passed (5)
     Tests  77 passed (77)
  - LiveRegion.test.tsx: 25 tests
  - a11yAudit.test.ts: 28 tests
  - LowcodeWorkspace.test.tsx: 9 tests（无回归）
  - CodeNodeEditor.test.tsx: 6 tests（无回归）
  - GeneratedCodePreview.test.tsx: 9 tests（无回归）
```

---

## 三、LiveRegion / useLiveRegion 用法示例

### 受控模式（外部持有 message）

```tsx
import { useState } from 'react';
import { LiveRegion } from '@renderer/components/common/LiveRegion';

function SaveButton() {
  const [msg, setMsg] = useState('');
  return (
    <>
      <LiveRegion message={msg} politeness="polite" clearAfterMs={3000} />
      <button
        onClick={async () => {
          await save();
          setMsg('已保存');
        }}
      >
        保存
      </button>
    </>
  );
}
```

### 封装模式（hook 自动管理 state）

```tsx
import { useLiveRegion } from '@renderer/lib/useLiveRegion';

function CompileStatus() {
  const { announce, LiveRegion: Region } = useLiveRegion({
    politeness: 'polite',
    clearAfterMs: 0, // 不自动清空
  });

  useEffect(() => {
    if (compileResult) {
      announce(`编译完成：${compileResult.errors.length} 个错误`);
    }
  }, [compileResult, announce]);

  return <Region id="compile-status" />;
}
```

### 在 LowcodeWorkspace 集成建议

主代理可在以下位置加 aria-live：

1. **编译状态条**：在工具栏右侧编译徽章旁加 `<LiveRegion message={compileMsg} clearAfterMs={3000} />`，让屏幕阅读器朗读「编译中...」「编译通过：0 错误」「编译失败：3 个错误」。
2. **导入导出提示**：导入 JSON 成功/失败时 `announce('已导入 N 个节点')` / `announce('导入失败：JSON 格式错误')`。
3. **节点统计**：画布右下角节点数变化时 `announce(\`当前 ${count} 个节点\`)`，但应设较长 `clearAfterMs`（如 5000ms）避免频繁打断。
4. **模式切换**：`ModeSwitcher` 切换时 `announce(\`已切换到 ${modeLabel} 模式\`)`。
5. **节点选中**：`selectNode(id)` 后 `announce(\`已选中 ${nodeKind} 节点\`)`，让屏幕阅读器用户感知画布焦点。

集成示例：

```tsx
// LowcodeWorkspace.tsx
import { useLiveRegion } from '@renderer/lib/useLiveRegion';

function LowcodeWorkspace() {
  const { announce, LiveRegion } = useLiveRegion({ politeness: 'polite' });
  const compileResult = useNodeGraphStore((s) => s.compileResult);

  useEffect(() => {
    if (!compileResult) return;
    const e = compileResult.errors.length;
    const w = compileResult.warnings.length;
    announce(e === 0 && w === 0 ? '编译通过' : `编译完成：${e} 错误 ${w} 警告`);
  }, [compileResult, announce]);

  return (
    <div>
      <LiveRegion id="workspace-status" />
      {/* ...原有 UI */}
    </div>
  );
}
```

---

## 四、a11yAudit 工具用法

### 开发时审计

```ts
import { auditA11y, formatA11yIssues } from '@renderer/lib/a11yAudit';

// 在浏览器控制台
const issues = auditA11y(document.body);
console.warn(formatA11yIssues(issues));
```

### 测试断言

```ts
import { auditA11y } from '@renderer/lib/a11yAudit';

it('组件渲染后无 a11y 问题', () => {
  const { container } = render(<MyComponent />);
  const issues = auditA11y(container);
  expect(issues).toEqual([]);
});
```

### 检查的规则

| 规则 ID                         | 触发条件                                   | 严重程度      |
| ------------------------------- | ------------------------------------------ | ------------- |
| `icon-only-button-no-label`     | 按钮内仅有 aria-hidden 元素且无 aria-label | error         |
| `button-no-label`               | 按钮无可见文本无 aria-label                | error         |
| `input-no-label`                | input 无 label 关联                        | error         |
| `textarea-no-label`             | textarea 无 label 关联                     | error         |
| `select-no-label`               | select 无 label 关联                       | error         |
| `list-no-role`                  | ul/ol 缺 role="list"                       | warning       |
| `img-no-alt`                    | img 缺 alt                                 | error         |
| `dialog-no-modal`               | role="dialog" 缺 aria-modal                | warning       |
| `dialog-no-label`               | 对话框缺 aria-label                        | error         |
| `tablist-incomplete`            | tablist 缺 tab 子元素或缺 aria-controls    | error/warning |
| `heading-empty`                 | 标题元素无文本                             | error         |
| `interactive-negative-tabindex` | 交互元素 tabindex="-1"                     | warning       |

---

## 五、未来待改进项

### 优先级高

1. **React Flow 节点 id 同步**：当前 `NodeGraphEditor` 的 `aria-activedescendant={selectedNodeId}` 指向的 id 与 React Flow 内部节点 DOM id 不完全匹配。应在自定义节点组件（`nodes/ItemNode.tsx` 等）根 div 上加 `id={`flow-node-${nodeId}`}`，让 `aria-activedescendant` 能正确指向。
2. **节点图键盘导航**：当前画布节点无法用键盘 Tab/Arrow 浏览。应实现 roving tabindex，让用户用方向键在节点间移动选中。
3. **focus trap**：`CodeNodeEditor` 对话框打开时焦点会逃逸到背后画布。应用 focus-trap-react 限制 Tab 在对话框内循环。
4. **颜色对比度审计**：`auditA11y` 当前不检查对比度。引入 `axe-core`（已在 devDependencies）做完整审计。

### 优先级中

5. **PropertyPanel 字段验证消息**：当前 `pattern` 验证失败时浏览器原生提示，未用 `aria-live` 朗读。应捕获 invalid 事件并通过 LiveRegion 朗读。
6. **拖拽 a11y**：`NodePalette` 拖拽到画布对键盘用户不可达。应提供「点击添加」的等价路径（已部分实现：`onNodeClick` 回调），但应在文档中明确说明。
7. **快捷键提示**：`ShortcutHelpDialog` 应可通过 `?` 键打开，并在按钮上加 `aria-keyshortcuts`。
8. **Toast 通知 a11y**：`ToastProvider` 应使用 `role="status"` 而非默认 div，让屏幕阅读器朗读 toast 内容。

### 优先级低

9. **国际化**：所有 `aria-label` 当前是硬编码中文，未来 i18n 时应通过 `t('a11y.xxx')` 取值。
10. **reduced-motion**：动画应在 `prefers-reduced-motion: reduce` 时禁用（`mc-panel-in` / `mc-dialog-in` 等）。
11. **高对比度主题**：`SettingsPanel` 的主题切换应保证文字与背景对比度 ≥ 4.5:1（WCAG AA）。
12. **屏幕阅读器测试**：当前测试覆盖 DOM 属性，未在 NVDA / JAWS / VoiceOver 实测。应建立手动测试清单。

---

## 六、参考资源

- [WAI-ARIA Authoring Practices 1.2](https://www.w3.org/WAI/ARIA/apg/)
- [MDN Web Accessibility](https://developer.mozilla.org/zh-CN/docs/Web/Accessibility)
- [WCAG 2.1 Quick Reference](https://www.w3.org/WAI/WCAG21/quickref/)
- [axe-core Documentation](https://github.com/dequelabs/axe-core)
- [React Accessibility](https://react.dev/reference/react-dom/components/common#common-caveats)
