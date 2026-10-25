/**
 * DomainTabs —— 中栏顶部常驻的域面板 tab 条
 *
 * ## 这个组件解决什么
 *
 * 阶段 0 的可达性测试（`panel-reachability.test.ts`）锁住了 8 个注册但点不到的面板：
 * `skin` `resources` `nbt` `blocks` `entity` `audio` `cicd` `preview`。
 *
 * 根因不是「没做 tab 条」，而是 `activeLeftPanel` 的写入点只有三处，
 * 域面板一个都没有 —— 详见 `docs/frontend-workbench-architecture.md` §1.3。
 *
 * 本组件按 IDE 通行形态提供第四个写入点：**内容区顶部常驻 tab 条**。
 * 依据：VS Code / IntelliJ 的编辑器区都是 tab 条（VS Code 官方明确
 * 「Open files in each editor are displayed with tabbed headers (Tabs) at the top of
 * the editor region」），业务面板与文档并列切换。
 *
 * ## 为什么 tab 列表从注册表派生而不是写死
 *
 * 写死的话每加一个面板要改两处，漏改不会报错 —— 只让面板静默失联。
 * 这里直接用 `panelsOfDomain(domain)`，它是注册表的投影（`domains.ts` 已改派生）。
 *
 * ## 为什么 tabpanel 由本组件渲染
 *
 * WAI-ARIA Tabs 模式要求每个 tab 的 `aria-controls` 指向一个**真实存在**的
 * `role="tabpanel"` 元素。若把 tabpanel 留在 App.tsx 里单独渲染，
 * 两者之间就没有结构约束 —— 改一边忘另一边，a11y 立刻坏掉
 * （`aria-valid-attr-value` 违规），而且只在运行时才发现。
 *
 * 所以本组件同时负责：tab 条 + 对应的 tabpanel 容器。
 * 未激活的 tabpanel 全部渲染但 `hidden`，这既满足 a11y 语义，
 * 也让面板状态不因切换而丢失（IDE 的 tab 行为）。
 *
 * ## 键盘导航
 *
 * 遵循 WAI-ARIA Tabs 模式：
 * - ArrowRight / ArrowLeft 在 tab 间循环移动
 * - Home / End 跳到首/末
 * - Roving tabindex：只有选中的 tab tabindex=0，其余 -1
 * - 切换后 focus 跟随到新选中的 tab
 */
import { useCallback, useRef, type ReactNode } from 'react';
import { useWorkbenchStore, resolveActivePanel, selectSelectPanel } from './workbench-store.js';
import { panelsOfDomain } from './domains.js';
import { getPanel } from './panels.js';
import { PanelHost } from './PanelHost.js';
import { useTranslation } from '../hooks/useTranslation.js';

interface DomainTabsProps {
  /**
   * 跨域常驻面板（explorer/search/git/packages/settings）的渲染器。
   * 它们不属于任何域（`domain === null`），所以不在 tab 条里 ——
   * 但激活时仍然需要内容区，所以由调用方通过这个 prop 提供。
   *
   * 不传则跨域常驻面板激活时内容区为空（仅测试/独立使用场景）。
   */
  commonPanelContent?: ReactNode;
}

export function DomainTabs({ commonPanelContent }: DomainTabsProps = {}) {
  const { t } = useTranslation();
  const domain = useWorkbenchStore((s) => s.domain);
  const panelId = useWorkbenchStore((s) => s.panelId);
  const selectPanel = useWorkbenchStore(selectSelectPanel);
  const activePanel = resolveActivePanel({ domain, panelId });

  // 当前域的面板列表 —— 从注册表派生，新增面板只需在注册时声明 domain
  const panelIds = panelsOfDomain(domain);
  const selectedIndex = panelIds.indexOf(activePanel);
  const tablistRef = useRef<HTMLDivElement>(null);

  /**
   * 方向键 / Home / End 导航
   *
   * 先在 tab id 数组上算出新索引（含首尾循环），再调用 selectPanel 写入 store。
   * 不用 DOM 查询来定位「下一个」，因为 DOM 只是投影 —— 真源是 panelIds。
   */
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (panelIds.length === 0) return;

      let nextIdx: number;
      // 当前没有选中 tab（激活的是跨域常驻面板）时，从首项开始算
      const cur = selectedIndex === -1 ? 0 : selectedIndex;

      switch (e.key) {
        case 'ArrowRight':
          e.preventDefault();
          nextIdx = (cur + 1) % panelIds.length;
          break;
        case 'ArrowLeft':
          e.preventDefault();
          nextIdx = (cur - 1 + panelIds.length) % panelIds.length;
          break;
        case 'Home':
          e.preventDefault();
          nextIdx = 0;
          break;
        case 'End':
          e.preventDefault();
          nextIdx = panelIds.length - 1;
          break;
        default:
          return; // 其它键不处理
      }

      const nextId = panelIds[nextIdx];
      selectPanel(nextId);
      // 切换后 focus 到新选中的 tab（Roving Tabindex 要求）。
      // 同步 focus 而非 requestAnimationFrame：后者在 jsdom 里不会自动推进，
      // 而键盘导航场景下「按下方向键焦点就该已经在目标 tab 上」才是正确语义。
      const el = document.getElementById(`domain-tab-${nextId}`);
      el?.focus();
    },
    [panelIds, selectedIndex, selectPanel],
  );

  // 当前激活面板不属于本域时（例如跨域常驻面板），没有 tab 被选中
  // 对应 IDE 里「未打开任何编辑器」的状态
  const activeTabId = selectedIndex !== -1 ? activePanel : null;
  const isCommonPanelActive = selectedIndex === -1;

  return (
    <>
      <div
        ref={tablistRef}
        role="tablist"
        aria-label="工作面板"
        className="flex items-center gap-0.5 border-b border-mc-border bg-mc-surface px-2 py-1"
        onKeyDown={handleKeyDown}
      >
        {panelIds.map((id) => {
          const registration = getPanel(id);
          if (!registration) return null;

          const isSelected = id === activeTabId;
          const label = t(registration.title);

          return (
            <button
              key={id}
              id={`domain-tab-${id}`}
              role="tab"
              aria-selected={isSelected}
              aria-controls={`domain-tabpanel-${id}`}
              aria-label={label}
              tabIndex={isSelected ? 0 : -1}
              onClick={() => selectPanel(id)}
              className={`mc-tab flex items-center gap-1.5 !px-3 !py-1 ${
                isSelected ? 'mc-tab-selected' : 'mc-tab-idle'
              }`}
              title={label}
            >
              {registration.icon}
              <span>{label}</span>
              {isSelected && <span className="mc-active-bar" aria-hidden="true" />}
            </button>
          );
        })}
      </div>

      {/*
       * Tabpanel 容器：每个 tab 一个，全部渲染、未激活的 `hidden`。

       * ⚠️ **外层 div 上不能带任何 display 类**（`flex` 等）。
       * Tailwind 的 `.flex` 是作者样式表规则，会覆盖 UA 样式表的 `[hidden]{display:none}`
       * （同优先级时作者样式胜出）—— 于是 `hidden` 属性被静默忽略，
       * 未激活的面板照样占位（实测：3 个面板各占 1/3 高度，其余是空黑区）。
       * 所以布局交给内层的 `.flex h-full`：外层保持无 display 类，`hidden` 才生效。
       */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {panelIds.map((id) => {
          const isSelected = id === activeTabId;
          return (
            <div
              key={id}
              role="tabpanel"
              id={`domain-tabpanel-${id}`}
              aria-labelledby={`domain-tab-${id}`}
              tabIndex={0}
              hidden={!isSelected}
              className="min-h-0 flex-1 overflow-hidden"
            >
              <div className="flex h-full flex-col overflow-hidden">
                {isSelected && <PanelHost panelId={id} />}
              </div>
            </div>
          );
        })}

        {isCommonPanelActive && (
          <div
            role="tabpanel"
            id={`domain-tabpanel-${activePanel}`}
            aria-label={t(getPanel(activePanel)?.title ?? activePanel)}
            tabIndex={0}
            className="flex min-h-0 flex-1 flex-col overflow-hidden"
          >
            {commonPanelContent}
          </div>
        )}
      </div>
    </>
  );
}
