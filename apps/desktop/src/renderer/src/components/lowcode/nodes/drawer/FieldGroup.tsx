import { memo, useState, useCallback } from 'react';

/** 分组显示标题映射 */
const GROUP_LABELS: Record<string, string> = {
  basic: '基础信息',
  appearance: '外观',
  behavior: '行为',
  advanced: '高级',
};

/** 分组默认展开状态：basic 默认展开，其余折叠 */
const DEFAULT_EXPANDED: Record<string, boolean> = {
  basic: true,
  appearance: false,
  behavior: false,
  advanced: false,
};

interface FieldGroupProps {
  /** 分组键 */
  group: string;
  /** 子元素 */
  children: React.ReactNode;
  /** 是否有错误字段 */
  hasError?: boolean;
}

function FieldGroupComponent({ group, children, hasError }: FieldGroupProps) {
  const [expanded, setExpanded] = useState(() => DEFAULT_EXPANDED[group] ?? true);
  const label = GROUP_LABELS[group] ?? group;

  const toggle = useCallback(() => setExpanded((e) => !e), []);

  return (
    <details className="group/fieldgroup" open={expanded}>
      <summary
        className="flex items-center gap-2 cursor-pointer select-none px-2 py-1.5 rounded-mc bg-mc-btn border border-t-white border-l-white border-b-black border-r-black transition-colors hover:bg-mc-btn-hover"
        onClick={toggle}
        aria-expanded={expanded}
      >
        <span
          className="transition-transform duration-150 group-open/fieldgroup:rotate-90 text-[10px] text-mc-mute"
          aria-hidden="true"
        >
          ▶
        </span>
        <span className="text-[11px] font-medium text-mc-text">{label}</span>
        {hasError && (
          <span className="ml-auto text-[10px] text-red-400" aria-label="该分组有错误字段">
            ⚠
          </span>
        )}
      </summary>
      <div className="mt-1.5 ml-3 space-y-2 border-l border-l-white/20 pl-2 animate-mc-collapse-in">
        {children}
      </div>
    </details>
  );
}

export const FieldGroup = memo(FieldGroupComponent);