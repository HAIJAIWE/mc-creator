import { useRef, useState } from 'react';
import { Button, Modal } from '@mc-creator/ui';

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
 * 风格参考 ProjectSaveDialog，统一 mc-* 主题色。外壳已迁到
 * `@mc-creator/ui` 的 `Modal` + `Button`（遮罩、居中、焦点陷阱、
 * Escape/关闭按钮、焦点归还由 ui 组件承担），本文件只保留对话框语义。
 *
 * - prompt 模式：传 `defaultValue` 或 `placeholder`，onConfirm 接收输入值
 * - confirm 模式：不传输入相关 props，onConfirm 接收空字符串
 * - danger 模式：确认按钮变红色（用于删除/清空等不可逆操作）
 *
 * 按 Esc 取消，按 Enter 确认（prompt 模式下由输入框自己消费 Enter）。
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

  const isPrompt = placeholder !== undefined || defaultValue !== undefined;

  const handleConfirm = () => {
    onConfirm(value);
    onClose();
  };

  return (
    <Modal
      open
      title={title}
      onClose={onClose}
      // 原实现点遮罩不关闭（避免误触丢失已输入内容），保持原行为
      closeOnOverlayClick={false}
      {...(isPrompt ? { initialFocusRef: inputRef } : {})}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {cancelLabel}
          </Button>
          <Button variant={danger ? 'danger' : 'primary'} onClick={handleConfirm}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      {message && <p className="mb-3 text-mc-dim">{message}</p>}
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
    </Modal>
  );
}
