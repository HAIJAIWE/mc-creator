import { useCallback, useEffect, type ReactNode } from 'react';
import { Button, Modal } from '@mc-creator/ui';
import { useTranslation } from '../hooks/useTranslation';

interface ConfirmDialogProps {
  /** 是否显示 */
  open: boolean;
  /** 标题 */
  title?: string;
  /** 消息内容（支持 i18n key 或直接文本） */
  message: string;
  /** 确认按钮文本 */
  confirmText?: string;
  /** 取消按钮文本 */
  cancelText?: string;
  /** 是否为危险操作（红色确认按钮） */
  destructive?: boolean;
  /** 点击确认回调 */
  onConfirm: () => void | Promise<void>;
  /** 点击取消/关闭回调 */
  onCancel: () => void;
  /** 确认按钮 loading 状态 */
  confirmLoading?: boolean;
  /** 子组件（可选，用于自定义内容） */
  children?: ReactNode;
}

/**
 * 焦点落在这类元素上时，Enter 由它们自己消费（按钮激活 / 输入框提交），
 * 对话框不再额外插一脚「确认」。
 *
 * 不加这道过滤会出双重触发：Modal 打开时默认把焦点放在**取消**按钮上，
 * 此时按 Enter 既命中浏览器的按钮激活（取消）又命中这里的确认 —— 用户
 * 明明想取消却先执行了删除。
 */
const ENTER_CONSUMING_SELECTOR =
  'a[href], button, input, select, textarea, [role="button"], [contenteditable="true"]';

/**
 * 确认对话框（替代 window.confirm）
 *
 * 实现已迁到 `@mc-creator/ui` 的 `Modal` + `Button`：外壳（遮罩、居中、
 * 焦点陷阱、Escape/关闭按钮、焦点归还）由 ui 组件承担，本文件只保留
 * desktop 侧的语义：i18n 默认文案、`destructive` 危险按钮、`confirmLoading`
 * 禁用态，以及「回车即确认」的快捷键。
 *
 * 用法：
 *   const [showConfirm, setShowConfirm] = useState(false);
 *   const handleDelete = () => setShowConfirm(true);
 *
 *   <ConfirmDialog
 *     open={showConfirm}
 *     message="确定删除该文件吗？"
 *     onConfirm={async () => { await deleteFile(); setShowConfirm(false); }}
 *     onCancel={() => setShowConfirm(false)}
 *   />
 */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmText,
  cancelText,
  destructive = false,
  onConfirm,
  onCancel,
  confirmLoading = false,
  children,
}: ConfirmDialogProps) {
  const { tCommon } = useTranslation();

  const handleConfirm = useCallback(async () => {
    await onConfirm();
  }, [onConfirm]);

  // 回车确认：Modal 只负责 Escape / Tab 焦点循环，「Enter 即确认」是
  // ConfirmDialog 自己的约定，用 document 级监听补上（Modal 没有对外的
  // onKeyDown 插槽）。挂在 document 而非面板上，是为了让焦点停在面板自身
  // （Modal 在无可聚焦子元素时的兜底焦点）时也能触发。
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Enter' || confirmLoading) return;
      // 组合键留给浏览器/上层（Ctrl+Enter 之类可能是别的快捷键）
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      const target = event.target;
      if (target instanceof Element && target.closest(ENTER_CONSUMING_SELECTOR)) return;
      event.preventDefault();
      void handleConfirm();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open, confirmLoading, handleConfirm]);

  // 标题缺省：传了 children（自定义内容）时兜底成 i18n 的「警告」，
  // 与迁移前一致 —— 无标题也无 children 时不显示标题栏。
  const headerTitle = title ?? (children ? tCommon('warning') : undefined);

  return (
    <Modal
      open={open}
      title={headerTitle}
      onClose={onCancel}
      footer={
        <>
          <Button variant="ghost" disabled={confirmLoading} onClick={onCancel}>
            {cancelText ?? tCommon('cancel')}
          </Button>
          <Button
            variant={destructive ? 'danger' : 'primary'}
            loading={confirmLoading}
            disabled={confirmLoading}
            onClick={handleConfirm}
          >
            {confirmLoading ? tCommon('loading') : (confirmText ?? tCommon('confirm'))}
          </Button>
        </>
      }
    >
      {children ?? message}
    </Modal>
  );
}
