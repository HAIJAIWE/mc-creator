import { memo, useEffect, useRef, useState } from 'react';

/** 行内可编辑的值类型（仅基础类型；复杂类型回抽屉编辑） */
export type InlineEditKind = 'text' | 'number' | 'boolean';

export interface InlineRowEditorProps {
  kind: InlineEditKind;
  /** 当前值（number 类型为数值，其余为字符串/布尔） */
  value: string | number | boolean;
  /** 显示用文本（未编辑态） */
  display: string;
  /** 提交回调（number 非法时不调用，直接回退） */
  onCommit: (value: string | number | boolean) => void;
  /** 无障碍标签（如端口名） */
  ariaLabel: string;
  /** 测试 id 后缀 */
  testId: string;
}

const pillStyle: React.CSSProperties = {
  marginLeft: 'auto',
  background: 'rgba(0,0,0,0.28)',
  borderRadius: 10,
  padding: '1px 8px',
  maxWidth: 120,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  fontFamily: 'monospace',
  fontSize: 11,
  color: '#fff',
  border: '1px solid transparent',
  cursor: 'text',
  textAlign: 'right' as const,
};

const inputStyle: React.CSSProperties = {
  ...pillStyle,
  cursor: 'auto',
  outline: '1px solid #fff',
  background: 'rgba(0,0,0,0.55)',
  width: 110,
};

/**
 * 积木行内值编辑器（click-to-edit）
 *
 * - text/number：点击值 → 输入框（nodrag 防拖拽误触），Enter/失焦提交，Esc 取消
 * - boolean：开关按钮，点击直接提交取反值
 * - number 非法输入（NaN/空）不提交，直接回退显示旧值
 */
function InlineRowEditorComponent({
  kind,
  value,
  display,
  onCommit,
  ariaLabel,
  testId,
}: InlineRowEditorProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  // 进入编辑态时聚焦并全选；值变化时若未在编辑则无需同步（display 由父组件驱动）
  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  if (kind === 'boolean') {
    const checked = value === true;
    return (
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={ariaLabel}
        data-testid={`inline-bool-${testId}`}
        className="nodrag"
        onClick={(e) => {
          e.stopPropagation();
          onCommit(!checked);
        }}
        style={{
          ...pillStyle,
          cursor: 'pointer',
          minWidth: 44,
        }}
      >
        {checked ? 'true' : 'false'}
      </button>
    );
  }

  if (!editing) {
    return (
      <button
        type="button"
        aria-label={`编辑${ariaLabel}`}
        data-testid={`inline-value-${testId}`}
        className="nodrag"
        onClick={(e) => {
          e.stopPropagation();
          setDraft(String(value));
          setEditing(true);
        }}
        style={pillStyle}
      >
        {display}
      </button>
    );
  }

  const commit = () => {
    setEditing(false);
    if (kind === 'number') {
      if (draft.trim() === '') return;
      const n = Number(draft);
      if (!Number.isFinite(n)) return;
      onCommit(n);
      return;
    }
    onCommit(draft);
  };

  return (
    <input
      ref={inputRef}
      type={kind === 'number' ? 'number' : 'text'}
      aria-label={ariaLabel}
      data-testid={`inline-input-${testId}`}
      className="nodrag"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit();
        else if (e.key === 'Escape') setEditing(false);
        e.stopPropagation();
      }}
      onClick={(e) => e.stopPropagation()}
      style={inputStyle}
    />
  );
}

export const InlineRowEditor = memo(InlineRowEditorComponent);
