import { useState, useEffect, useRef } from 'react';
import { McIcon } from '../assets/mc-ui/McIcon';

interface PromptDialogProps {
  /** 标题 */
  title: string;
  /** 正文说明 */
  message?: string;
  /** 输入框 placeholder（仅 prompt 模式生效） */
  placeholder?: string;
  /** 输入框默认值（仅 prompt 模式生效） */
  defaultValue?: string;
  /** 确认按钮文字，默认 "确定" */
  confirmLabel?: string;
  /** 取消按钮文字，默认 "取消" */
  cancelLabel?: string;
  /** 危险操作（如清空），确认按钮显示为红色 */
  danger?: boolean;
  /** 关闭对话框（取消或确认后都会调用） */
  onClose: () => void;
  /** 确认回调；返回 string 时为 prompt 模式（值可能为空字符串），返回 void 时为 confirm 模式 */
  onConfirm: (value: string) => void;
}

/**
 * 通用对话框：替代 window.prompt / window.confirm。
 *
 * 风格参考 ProjectSaveDialog，统一 mc-* 主题色。
 *
 * - prompt 模式：传 `defaultValue` 或 `placeholder`，onConfirm 接收输入值
 * - confirm 模式：不传输入相关 props，onConfirm 接收空字符串
 * - danger 模式：确认按钮变红色（用于删除/清空等不可逆操作）
 *
 * 按 Esc 取消，按 Enter 确认。
 */
export function PromptDialog({
  title,
  message,
  placeholder,
  defaultValue,
  confirmLabel = '确定',
  cancelLabel = '取消',
  danger = false,
  onClose,
  onConfirm,
}: PromptDialogProps) {
  const [value, setValue] = useState(defaultValue ?? '');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    // autoFocus 在某些情况下不稳定，用 ref + setTimeout 确保 focus
    const t = setTimeout(() => inputRef.current?.focus(), 0);
    return () => clearTimeout(t);
  }, []);

  const isPrompt = placeholder !== undefined || defaultValue !== undefined;

  const handleConfirm = () => {
    onConfirm(value);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="prompt-dialog-title"
        className="w-[420px] max-w-full rounded-mc-lg border border-mc-border-strong bg-mc-surface p-6 text-mc-text shadow-mc-pop animate-mc-dialog-in"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 id="prompt-dialog-title" className="font-display text-lg font-bold">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-mc-mute transition-colors hover:text-mc-text"
            aria-label="关闭"
          >
            <McIcon scope="pixel" name="close" size={16} />
          </button>
        </div>

        {message && <p className="mb-3 text-sm text-mc-dim">{message}</p>}

        {isPrompt && (
          <input
            ref={inputRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleConfirm();
            }}
            className="mc-input"
            placeholder={placeholder}
            aria-label={title}
          />
        )}

        <div className="mt-5 flex justify-end gap-3">
          <button type="button" onClick={onClose} className="mc-btn-ghost">
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            className={danger ? 'mc-btn-danger' : 'mc-btn-primary'}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
