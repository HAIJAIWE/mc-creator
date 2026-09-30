import { memo } from 'react';

interface ErrorRecoveryProps {
  /** 错误文字（falsy 时不渲染） */
  error?: string | undefined;
  /** 修复建议文字 */
  suggestion?: string | undefined;
  /** 一键修复按钮文字（需同时提供 onFix 才渲染按钮） */
  fixLabel?: string | undefined;
  /** 一键修复回调 */
  onFix?: (() => void) | undefined;
}

function ErrorRecoveryComponent({ error, suggestion, fixLabel, onFix }: ErrorRecoveryProps) {
  if (!error) return null;
  return (
    <div
      className="mt-1 rounded-mc border border-red-500/40 bg-red-500/10 px-2 py-1 text-[10px] text-red-300"
      role="alert"
      aria-live="assertive"
    >
      <div>⚠ {error}</div>
      {suggestion && <div className="mt-0.5 text-red-200">建议：{suggestion}</div>}
      {fixLabel && onFix && (
        <button
          type="button"
          onClick={onFix}
          className="mt-1 rounded-mc border border-red-400 bg-red-800/60 px-2 py-0.5 text-red-100 transition-colors hover:bg-red-700/80"
        >
          {fixLabel}
        </button>
      )}
    </div>
  );
}

export const ErrorRecovery = memo(ErrorRecoveryComponent);
