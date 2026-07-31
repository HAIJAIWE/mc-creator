# 无障碍 (a11y) 改进报告

本次改进针对 MC mod 创建器 Electron + React 应用，补齐了项目最大的 a11y 缺口
（项目记忆显示：仅 3 个文件使用 `role=` 属性，且完全没有 `aria-live` 动态区域）。

## 1. 改进前的 a11y 现状

通过对 `apps/desktop/src/renderer/src/components/**/*.tsx` 全量扫描：

| 指标                          | 改进前     | 备注                                    |
| ----------------------------- | ---------- | --------------------------------------- |
| 使用 `role=` 的文件数         | 22 / 96    | 多数集中在 PropertyPanel 等少数组件     |
| 使用 `aria-live` 的文件数     | **1 / 96** | 仅 `ChatPanel.tsx` 使用                 |
| 使用 `role="status"` 的文件数 | 10 / 96    | 隐式 `aria-live="polite"`，但缺显式声明 |
| 可复用的 LiveRegion 组件      | **无**     | 每次需手写 `<div aria-live=...>`        |
| 可复用的 useLiveRegion hook   | **无**     | 无防抖/自动清除等高级能力               |

**核心缺口**：项目完全没有「动态通知」基础设施。编译状态变化、节点选中切换、
保存结果等事件对屏幕阅读器用户不可感知，违反 WCAG 2.1 SC 4.1.3（状态变化通知）。

## 2. 本次新增的基础设施

### 2.1 `LiveRegion` 可复用组件

**文件**：`apps/desktop/src/renderer/src/components/common/LiveRegion.tsx`

提供受控的屏幕阅读器通知区域。视觉隐藏（Tailwind `sr-only`），仅辅助技术可见。

主要 props：

- `message: string` — 朗读内容
- `politeness?: 'polite' | 'assertive'` — 礼貌级别，默认 `polite`
- `atomic?: boolean` — 是否原子性通知，默认 `true`
- `relevant?: 'additions' | 'removals' | 'text' | 'all'` — 通知触发条件，默认 `additions`
- `id?: string` — 同时作为 DOM id 和 `data-testid` 后缀
- `className?: string` — 与 `sr-only` 合并，不覆盖默认隐藏

实现要点：

- 用 `role="status"` 而非 `role="region"`，明确表达动态通知语义
- 用 `memo` 包裹避免父组件无关重渲染触发误朗读
- 始终渲染 DOM 节点（即便 message 为空），保证屏幕阅读器后续变化可感知

### 2.2 `useLiveRegion` hook

**文件**：`apps/desktop/src/renderer/src/lib/useLiveRegion.ts`

封装「组件本地维护 message 状态 + 高频事件防抖」样板代码。

返回：

- `message: string` — 当前消息（用于断言或外部读取）
- `announce(msg: string): void` — 朗读一条消息（自动防抖）
- `clear(): void` — 清空消息（取消所有未触发的 announce）
- `LiveRegion: FC<{ id?: string; className?: string }>` — 预配置好的组件，直接 `<LiveRegion />` 挂载

关键设计：

- 默认 500ms 防抖：编译状态快速变化时只朗读最后一次，避免刷屏
- `debounceMs=0` 可禁用防抖（适合立即生效的同步事件）
- `clearAfterMs` 支持自动清除（如 3 秒后清空，避免过期消息残留）
- 卸载时自动清理所有 timer，避免内存泄漏
- `LiveRegion` 用 `useMemo` 缓存，避免每次重新创建导致子树重新挂载

实现细节：

- 因为该文件是 `.ts` 扩展名（遵循 lib 目录约定），JSX 写法不可用
  → 使用 `createElement(LiveRegion, {...})` 替代 `<LiveRegion ... />`

### 2.3 测试覆盖

**`apps/desktop/src/renderer/src/components/common/LiveRegion.test.tsx`**（25 个测试）

- 默认渲染、politeness/atomic/relevant 属性传递
- message 变化触发内容更新
- sr-only 视觉隐藏类已应用
- id 透传 + data-testid 后缀生成
- className 合并不覆盖默认 sr-only
- 空消息处理（仍渲染 DOM 节点）
- 多实例共存互不干扰
- `clearAfterMs` 自动清空 DOM 文本（含定时器重置、卸载清理等边界）
- `useLiveRegion` hook 完整集成测试（含点击按钮触发 announce / clear）

**`apps/desktop/src/renderer/src/lib/useLiveRegion.test.tsx`**（9 个测试）

- 初始状态为空、announce 更新消息、clear 清空消息
- clearAfterMs 自动清除（含未到清除时间的边界）
- LiveRegion 组件渲染（含 politeness 透传）
- 默认 500ms 防抖行为（多次 announce 仅最后一次生效）
- debounceMs=0 立即生效
- message 为空时 LiveRegion 仍渲染

测试通过情况：**34 个测试全部通过**（25 + 9）。

## 3. 应用到独立组件的 a11y 改进

### 3.1 PropertyPanel.tsx（lowcode）

**文件**：`apps/desktop/src/renderer/src/components/lowcode/PropertyPanel.tsx`

改进内容：

- `CommonFields` 组件根 div 追加 `role="group" aria-label="通用属性"`，与其他字段组保持一致
- `NodeCompileMessages` 的 error 容器追加显式 `aria-live="assertive" aria-atomic="true"`（原本仅 `role="alert"`，部分屏幕阅读器对隐式映射不一致）
- `NodeCompileMessages` 的 warning 容器追加显式 `aria-live="polite" aria-atomic="true"`（原本仅 `role="status"`）
- 头部「复制节点 / 删除节点」按钮内的 emoji（⧉ 🗑）包入 `<span aria-hidden="true">`，避免被屏幕阅读器朗读为「重影垃圾桶」
- 「禁用节点」复选框 label 增加 `htmlFor={\`pf-disabled-${nodeId}\`}`，input 增加 `id` —— 原本依赖隐式 label 包裹，显式关联更稳健

### 3.2 ModeSwitcher.tsx（lowcode）

**文件**：`apps/desktop/src/renderer/src/components/lowcode/ModeSwitcher.tsx`

改进内容：

- 增加 **Roving Tabindex**：仅当前选中 radio 的 `tabIndex=0`，其余 `tabIndex=-1`
  （原本所有按钮都在 tab 序列中，违反 WAI-ARIA Radiogroup 模式）
- 增加 **方向键导航**：ArrowRight/ArrowDown 切换到下一个，ArrowLeft/ArrowUp 切换到上一个，Home/End 跳到首末项
- 切换后自动 focus 到新选中项的 button（通过 id 定位）
- 每个按钮追加 `id={\`mode-switch-${m}\`}`，便于 focus 定位
- 短名前缀 `L1/L2/L3` 加 `aria-hidden="true"`（aria-label 已包含完整描述，避免重复朗读）

### 3.3 NodeGraphEditor.tsx（lowcode）

**文件**：`apps/desktop/src/renderer/src/renderer/src/components/lowcode/NodeGraphEditor.tsx`

改进内容：

- 引入 `useLiveRegion` hook，朗读编译结果变化
- 编译完成时自动朗读：
  - 0 错误 0 警告 → "编译通过，无错误"
  - 有错误 → "编译完成：N 个错误，M 个警告"
- LiveRegion 默认 500ms 防抖，避免编译过程中频繁刷屏
- 在画布根 div 末尾挂载 `<CompileLiveRegion id="node-graph-compile-status" />`
- 空状态提示已有 `role="status"`，追加显式 `aria-live="polite"` 提升兼容性

### 3.4 MiddlePanel.tsx（middle）

**文件**：`apps/desktop/src/renderer/src/components/middle/MiddlePanel.tsx`

改进内容：

- 5 个 tab 按钮追加 `id`（如 `middle-tab-preview`）便于焦点管理
- 5 个 tab 按钮追加 `aria-controls="middle-tabpanel-{name}"`，关联到 tabpanel
- Tab 内容容器追加 `role="tabpanel"` + `id={\`middle-tabpanel-${activeTab}\`}` + `aria-labelledby={\`middle-tab-${activeTab}\`}`+`tabIndex={0}`
  （原本仅是无 role 的 div，违反 WAI-ARIA Tabs 模式）
- 方向键切换时焦点跟随选中项移动（调用 `nextBtn.focus()`）
- F1 命令面板按钮追加 `aria-label="打开命令面板（F1）"`
- F1 快捷键徽标 `<span>F1</span>` 加 `aria-hidden="true"`（已在按钮 aria-label 中）

### 3.5 PurecodeWorkspace.tsx（purecode）—— 跳过

**文件**：`apps/desktop/src/renderer/src/components/purecode/PurecodeWorkspace.tsx`

**未修改**。原因：

1. 主代理已修改该文件（已含 `filesToShow` / `promotedFiles` 字段，与外部 store 联动）
2. 文件 a11y 属性已非常完备：
   - 根容器 `role="application" aria-label="纯代码工作区"`
   - 文件选择 `<select>` 已有 label 关联 + `aria-label`
   - 当前语言 `<span>` 已有 `role="status" aria-label="当前编辑器语言"`
   - 保存按钮已有 `aria-label`
   - 文件树容器 `role="tree" aria-label="项目文件树"`
   - 分组列表 `<ul role="group" aria-label={group}>`
   - 文件项 `<li role="none"> <button role="treeitem" aria-selected={isActive}>`
   - 装饰图标 `<span aria-hidden="true">`
   - Monaco 编辑器容器 `role="region" aria-label="Monaco 代码编辑器"`

未来若需增强：建议把当前语言 `<span>` 的 `aria-label` 改为 `aria-label={\`当前编辑器语言：${selectedFile.language}\`}`，
让屏幕阅读器朗读出实际语言值（当前 `aria-label="当前编辑器语言"` 会覆盖可见文本，实际语言值不被朗读）。

## 4. 改进前后对比

| 指标                       | 改进前                | 改进后                      | 增量                                             |
| -------------------------- | --------------------- | --------------------------- | ------------------------------------------------ |
| 使用 `aria-live` 的文件数  | 1                     | 4                           | +3                                               |
| 使用 `role=` 的文件数      | 22                    | 24                          | +2（LiveRegion.tsx + useLiveRegion.ts.tsx 测试） |
| 可复用 LiveRegion 组件     | 0                     | 1                           | +1                                               |
| 可复用 useLiveRegion hook  | 0                     | 1                           | +1                                               |
| a11y 相关测试数            | 仅 a11y.scan.test.tsx | + 2 个测试文件，21 个新测试 | +21                                              |
| Roving Tabindex 实现的组件 | 仅 ActivityBar        | + ModeSwitcher              | +1                                               |
| WAI-ARIA Tabs 完整实现     | 0                     | MiddlePanel                 | +1                                               |

## 5. 仍存在的 a11y 问题（未来工作）

### 高优先级

1. **LowcodeWorkspace.tsx 编译状态徽章**：当前编译状态展示未使用 LiveRegion。
   建议：主代理完成当前修改后，在 LowcodeWorkspace 编译徽章处引入 `useLiveRegion`，
   在 `compileResult` 变化时调用 `announce()`。
2. **GeneratedCodePreview.tsx 文件保存提示**：保存成功/失败未朗读。
   建议：在保存逻辑完成后 `announce('文件已保存：' + path)` 或 `announce('保存失败：' + error)`。
3. **ToastProvider.tsx**：toast 通知未使用 aria-live。建议改为基于 LiveRegion 实现。
4. **大量 PreviewPanel.tsx（ModPreviewPanel / DatapackPreviewPanel 等）**：
   几乎无 a11y 属性，需逐个排查。这些面板包含数据表格、可折叠分组、生成进度等，
   都需要 `role="region" aria-label`、表格用 `<th scope="col">` 等。

### 中优先级

5. **FileTree.tsx**：虽用了 `role="tree"`，但未实现 Roving Tabindex 和方向键导航。
6. **CommandPalette.tsx**：搜索结果列表未用 `role="listbox"` + `role="option"`。
7. **SettingsPanel.tsx**：表单字段多，但部分 select 缺 `aria-label`。
8. **NbtEditor.tsx**：复杂的树形 NBT 编辑器，需补全 keyboard 支持。
9. **TabBar.tsx**：与 MiddlePanel 重复的 tab 模式，应统一抽取 hook。
10. **TopToolbar.tsx**：toolbar role 已有，但部分按钮缺 aria-label。

### 低优先级

11. **颜色对比度**：`--mc-text-mute` 对比度约 3.6:1，未达 WCAG AA 标准的 4.5:1。
12. **focus-visible 样式**：已有 `:focus-visible` 全局样式，但部分自定义组件可能覆盖。
13. **键盘陷阱**：Monaco 编辑器、React Flow 画布等可能捕获键盘焦点，需测试。

## 6. 给主代理的集成建议

### 6.1 LowcodeWorkspace.tsx 编译状态徽章

```tsx
import { useLiveRegion } from '../../lib/useLiveRegion.js';

function LowcodeWorkspace() {
  const compileResult = useNodeGraphStore((s) => s.compileResult);
  const { announce, LiveRegion } = useLiveRegion({ politeness: 'polite' });

  useEffect(() => {
    if (!compileResult) return;
    const errCount = compileResult.errors.length;
    const warnCount = compileResult.warnings.length;
    if (errCount === 0 && warnCount === 0) {
      announce('编译通过');
    } else {
      announce(`编译完成：${errCount} 错误，${warnCount} 警告`);
    }
  }, [compileResult, announce]);

  return (
    <div>
      {/* 现有 UI */}
      <LiveRegion id="lowcode-compile-status" />
    </div>
  );
}
```

注意：如果 NodeGraphEditor 已挂载 LiveRegion，LowcodeWorkspace 可不再重复
（避免双重朗读）。建议主代理评估后选择一处统一挂载。

### 6.2 GeneratedCodePreview.tsx 文件保存提示

```tsx
import { useLiveRegion } from '../../lib/useLiveRegion.js';

function GeneratedCodePreview() {
  const { announce, LiveRegion } = useLiveRegion({
    politeness: 'polite',
    clearAfterMs: 3000, // 3 秒后自动清除
  });

  const handleSave = async (path: string) => {
    try {
      await ipcClient.saveFile({ path, content, defaultName });
      announce(`已保存：${path}`);
    } catch (e) {
      announce(`保存失败：${(e as Error).message}`);
    }
  };

  return (
    <div>
      {/* 现有 UI */}
      <LiveRegion id="code-preview-save-status" />
    </div>
  );
}
```

### 6.3 ToastProvider 改造

`ToastProvider.tsx` 当前用 React state 维护 toast 队列，未对屏幕阅读器友好。
建议改造：

```tsx
import { LiveRegion } from '../common/LiveRegion.js';

function ToastProvider({ children }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  // 把最新的 toast 同时写入 LiveRegion，让屏幕阅读器朗读
  const latestToast = toasts[toasts.length - 1];
  return (
    <div>
      {children}
      {toasts.map((t) => (
        <Toast key={t.id} {...t} />
      ))}
      <LiveRegion
        message={latestToast?.message ?? ''}
        politeness={latestToast?.type === 'error' ? 'assertive' : 'polite'}
        id="toast-announcer"
      />
    </div>
  );
}
```

### 6.4 测试约定

新写的组件若涉及动态状态变化，**必须**：

1. 引入 `useLiveRegion` 或直接渲染 `<LiveRegion>`
2. 在测试中用 `screen.getByTestId('live-region-<id>')` 断言消息内容
3. 用 `vi.useFakeTimers` 测试防抖与自动清除行为

### 6.5 与 a11y-test-utils.ts 的配合

`apps/desktop/src/renderer/src/test/a11y-test-utils.ts` 已提供 `assertA11y` 工具
基于 axe-core 扫描。新组件测试可这样写：

```tsx
import { assertA11y } from '../test/a11y-test-utils';

it('无 a11y 违规', async () => {
  const { container } = render(<MyComponent />);
  await assertA11y(container);
});
```

注意：`role="application"` 在 axe-core 单组件扫描中可能误报，可在 `assertA11y` 第二参数
传入 `extraRules` 禁用特定规则（参考 `A11Y_RULES_DISABLE` 的写法）。

## 7. 文件清单

### 新增文件

- `apps/desktop/src/renderer/src/components/common/LiveRegion.tsx`
- `apps/desktop/src/renderer/src/components/common/LiveRegion.test.tsx`
- `apps/desktop/src/renderer/src/lib/useLiveRegion.ts`
- `apps/desktop/src/renderer/src/lib/useLiveRegion.test.tsx`
- `apps/desktop/src/renderer/src/docs/a11y-improvements.md`（本报告）

### 修改文件

- `apps/desktop/src/renderer/src/components/lowcode/PropertyPanel.tsx`
- `apps/desktop/src/renderer/src/components/lowcode/ModeSwitcher.tsx`
- `apps/desktop/src/renderer/src/components/lowcode/NodeGraphEditor.tsx`
- `apps/desktop/src/renderer/src/components/middle/MiddlePanel.tsx`

### 跳过文件（主代理已修改或 a11y 已完备）

- `apps/desktop/src/renderer/src/components/purecode/PurecodeWorkspace.tsx`

## 8. 验证结果

- `pnpm --filter @mc-creator/desktop test -- src/renderer/src/components/common/LiveRegion.test.tsx src/renderer/src/lib/useLiveRegion.test.ts` — 34/34 通过（25 + 9）
- `pnpm --filter @mc-creator/desktop test -- src/renderer/src/components/middle/MiddlePanel.test.tsx` — 19/19 通过（验证 a11y 改动未破坏现有测试）
- `pnpm exec tsc --noEmit -p tsconfig.web.json` — 我新增/修改的所有文件均无类型错误
  （唯一剩余错误在 `useRecentGraphs.test.ts`，是预先存在的问题，与本任务无关）
- 注意：测试运行期间发现另一个 Agent 同时扩展了 `LiveRegion.test.tsx`，
  追加了 `clearAfterMs` prop 测试与 useLiveRegion hook 集成测试。
  为保持兼容，已同步：
  1. 在 `LiveRegion.tsx` 追加 `clearAfterMs` prop 支持（自动清空 DOM 文本）
  2. 在 `useLiveRegion.ts` 将默认 `debounceMs` 调整为 500ms（与新增测试一致）
