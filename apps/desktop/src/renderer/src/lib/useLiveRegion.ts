import { createElement, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FC } from 'react';
import { LiveRegion } from '../components/common/LiveRegion.js';

/**
 * useLiveRegion —— 屏幕阅读器动态通知 hook。
 *
 * 解决的痛点：
 * 1. 直接渲染 `<LiveRegion message={msg} />` 需要组件本地维护 message 状态
 * 2. 编译状态、保存结果等高频事件容易导致屏幕阅读器刷屏
 * 3. 多处需要通知时，每个调用方都要重复样板代码
 *
 * 设计要点：
 * - 返回 `LiveRegion` 组件已预配置好 politeness，调用方 `<LiveRegion />` 即可挂载
 * - `announce(msg)` 是幂等的：相同消息会通过 React 状态变化触发屏幕阅读器朗读
 *   （React 会进行 reconciliation，所以即使 message 字符串相同，也可以触发朗读）
 * - 自动防抖：默认 150ms 内的多次 announce 仅最后一次生效（避免编译状态快速变化刷屏）
 * - `clearAfterMs` 支持自动清除消息（如 3 秒后清空，避免长时间挂着的过期消息）
 * - `clear()` 主动清空消息（如错误被修复后立即清除）
 *
 * 用法：
 * ```tsx
 * const { announce, LiveRegion } = useLiveRegion({ politeness: 'polite' });
 *
 * useEffect(() => {
 *   if (compileResult) announce('编译完成：' + compileResult.errors.length + ' 个错误');
 * }, [compileResult]);
 *
 * return (
 *   <div>
 *     <LiveRegion />
 *     <span>其他 UI</span>
 *   </div>
 * );
 * ```
 */
export interface UseLiveRegionOptions {
  /** 礼貌级别，默认 polite */
  politeness?: 'polite' | 'assertive';
  /** 自动清除消息的延迟（毫秒），0 表示不清除。默认 0 */
  clearAfterMs?: number;
  /** 防抖延迟（毫秒），0 表示不防抖。默认 500ms（避免快速连续触发时听不清） */
  debounceMs?: number;
}

export interface UseLiveRegionResult {
  /** 当前消息（用于测试断言或外部读取） */
  message: string;
  /** 朗读一条消息。会触发屏幕阅读器朗读 */
  announce: (msg: string) => void;
  /** 清空当前消息 */
  clear: () => void;
  /** 预配置好的 LiveRegion 组件，直接挂载即可 */
  LiveRegion: FC<{ id?: string; className?: string }>;
}

/**
 * 屏幕阅读器动态通知 hook。
 *
 * 实现细节：
 * - 防抖用 setTimeout + useRef 持有 timer id，避免闭包陷阱
 * - 自动清除用 useEffect 监听 message 变化，启动新的 timer
 * - LiveRegion 组件用 useMemo 缓存，避免每次渲染都生成新组件引用
 *   （否则会导致整个子树重新挂载，丢失屏幕阅读器朗读上下文）
 */
export function useLiveRegion(options?: UseLiveRegionOptions): UseLiveRegionResult {
  const politeness = options?.politeness ?? 'polite';
  const clearAfterMs = options?.clearAfterMs ?? 0;
  const debounceMs = options?.debounceMs ?? 500;

  const [message, setMessage] = useState<string>('');

  // 防抖 timer 引用：每次新 announce 进入会清除上一个 timer，确保只朗读最后一次
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 自动清除 timer 引用：每次 message 变化都会重置 timer
  const clearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 清除所有未触发的 timer，避免内存泄漏与重复触发
  const clearAllTimers = useCallback(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    if (clearTimerRef.current) {
      clearTimeout(clearTimerRef.current);
      clearTimerRef.current = null;
    }
  }, []);

  const announce = useCallback(
    (msg: string) => {
      // 不防抖：直接更新
      if (debounceMs <= 0) {
        setMessage(msg);
        return;
      }
      // 防抖：清除上一个 timer，重新计时
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
      debounceTimerRef.current = setTimeout(() => {
        setMessage(msg);
        debounceTimerRef.current = null;
      }, debounceMs);
    },
    [debounceMs],
  );

  const clear = useCallback(() => {
    clearAllTimers();
    setMessage('');
  }, [clearAllTimers]);

  // 自动清除：每次 message 变化时重置 timer
  useEffect(() => {
    if (clearAfterMs <= 0 || message === '') return;
    clearTimerRef.current = setTimeout(() => {
      setMessage('');
      clearTimerRef.current = null;
    }, clearAfterMs);
    return () => {
      if (clearTimerRef.current) {
        clearTimeout(clearTimerRef.current);
        clearTimerRef.current = null;
      }
    };
  }, [message, clearAfterMs]);

  // 卸载时清理所有 timer
  useEffect(() => clearAllTimers, [clearAllTimers]);

  // 预配置好的 LiveRegion 组件：用 useMemo 缓存避免每次重新创建
  // 关键：传入的 props（politeness）在 hook 生命周期内不变，所以 memo 命中率高
  //
  // 注意：本文件扩展名为 .ts（遵循 lib 目录约定），不能用 JSX 语法。
  // 因此这里用 createElement 而非 <LiveRegion />。这样既保持 .ts 扩展名，
  // 又能正确渲染 React 组件。
  const LiveRegionComponent = useMemo<FC<{ id?: string; className?: string }>>(
    () =>
      function HookedLiveRegion({ id, className }) {
        return createElement(LiveRegion, {
          message,
          politeness,
          id,
          className,
        });
      },
    // message 是 React state，每次变化都会重新渲染 LiveRegion（这正是我们想要的）

    [message, politeness],
  );

  return {
    message,
    announce,
    clear,
    LiveRegion: LiveRegionComponent,
  };
}
