import { memo, useEffect } from 'react';

/**
 * LiveRegion —— 可复用的屏幕阅读器动态通知区域。
 *
 * 设计目的：
 * - 解决项目历史遗留的 a11y 缺口（仅 1 个文件使用 aria-live）
 * - 让编译状态、节点选中、文件保存等动态变化能被屏幕阅读器朗读
 * - 视觉上完全隐藏（sr-only），只对辅助技术可见
 *
 * 实现要点：
 * - 使用 `role="status"` 而非直接在 div 上写 `role="region"`，因为 status
 *   隐式映射到 `aria-live="polite"`，且对辅助技术明确表达「这是动态通知区」
 * - `aria-atomic` 控制每次变化时是朗读整段还是仅变化部分
 * - `aria-relevant` 控制哪些类型的变化会触发朗读
 * - 视觉隐藏用 Tailwind 内置 `sr-only` 类（Tailwind 3.4 已确认内置）
 * - 用 `memo` 包裹避免父组件无关重渲染导致的重复朗读
 * - 可选 `clearAfterMs`：定时自动清空消息（避免长时间挂着的过期消息）
 *
 * 用法：
 * ```tsx
 * <LiveRegion message="编译完成：3 个错误" politeness="polite" />
 * <LiveRegion message="保存失败" politeness="assertive" />
 * <LiveRegion message="已保存" clearAfterMs={3000} />
 * ```
 *
 * 注意：消息内容变化时屏幕阅读器才会朗读。初始空字符串不会触发朗读，
 * 这是为了避免组件首次挂载时朗读「空」消息。
 */
export interface LiveRegionProps {
  /** 消息内容（空字符串时仍渲染但不可见，确保屏幕阅读器能感知后续变化） */
  message: string;
  /** 礼貌级别：polite 等待用户空闲，assertive 立即打断。默认 polite */
  politeness?: 'polite' | 'assertive';
  /** 是否原子性通知（默认 true：每次变化朗读整段，避免只朗读差异导致语义缺失） */
  atomic?: boolean;
  /** 是否仅在内容变化时通知（默认 additions：仅新增内容时通知，避免删除时刷屏） */
  relevant?: 'additions' | 'removals' | 'text' | 'all';
  /** 自动清空消息的延迟（毫秒），0 或不传表示不清空。常用于避免过期消息长期挂载 */
  clearAfterMs?: number;
  /** 用于测试与样式钩子 */
  id?: string;
  /** 自定义类名（默认追加 sr-only 实现视觉隐藏；如需可见可传入覆盖类） */
  className?: string;
}

function LiveRegionComponent({
  message,
  politeness = 'polite',
  atomic = true,
  relevant = 'additions',
  clearAfterMs,
  id,
  className,
}: LiveRegionProps) {
  // clearAfterMs 自动清空：当 message 非空且 clearAfterMs > 0 时，
  // 启动定时器在指定毫秒后清空 DOM 文本（避免屏幕阅读器重复朗读过期消息）。
  // 注意：本组件不持有 state，仅通过 useEffect 直接清空 DOM textContent。
  // 这样可以避免引入受控 state 导致的与父组件 state 不同步问题。
  useEffect(() => {
    if (!clearAfterMs || clearAfterMs <= 0 || message === '') return;
    const timer = setTimeout(() => {
      const el = id
        ? document.getElementById(id)
        : document.querySelector<HTMLElement>(
            `[data-testid="${id ? `live-region-${id}` : 'live-region'}"]`,
          );
      if (el) el.textContent = '';
    }, clearAfterMs);
    return () => clearTimeout(timer);
  }, [message, clearAfterMs, id]);

  // 始终追加 sr-only 让默认视觉隐藏。如果调用方显式传入可见类名，
  // 仍保留 sr-only 兜底（除非传入 contains 'sr-only' 的反义，本组件不支持显式可见）
  // 这里采用「合并类名」策略：默认 sr-only，调用方可追加额外类。
  const combined = className ? `sr-only ${className}` : 'sr-only';

  return (
    <div
      id={id}
      role="status"
      aria-live={politeness}
      aria-atomic={atomic}
      aria-relevant={relevant}
      className={combined}
      data-testid={id ? `live-region-${id}` : 'live-region'}
    >
      {message}
    </div>
  );
}

export const LiveRegion = memo(LiveRegionComponent);
