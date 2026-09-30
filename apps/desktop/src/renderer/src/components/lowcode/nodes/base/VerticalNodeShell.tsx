import { memo, useMemo, type CSSProperties, type ReactNode } from 'react';
import { Handle, Position } from '@xyflow/react';
import type { NodeCategory } from '@mc-creator/shared';
import { McIcon } from '../../../../assets/mc-ui/McIcon.js';
import { ChevronDown, ChevronUp, Settings, Lock } from 'lucide-react';
import { InlineRowEditor, type InlineEditKind } from './InlineRowEditor.js';

/**
 * 拼图积木外壳（Blockly/MCreator 风格竖式积木）
 *
 * 与 McNodeShell（MC 像素风横式）的区别：
 * - 分类色块体 + 拼图缺口（上）/凸榫（下），控制流上下串联
 * - 数据端口为左右两侧行内小圆点，分支端口在右侧
 * - 事件为帽子块（无缺口），纯数据源为圆角块（无缺口无凸榫）
 */

export type BlockShape = 'hat' | 'stack' | 'reporter';

export interface BlockRow {
  id: string;
  label: string;
  value: string;
  /** 分支端口行（真/假/循环体），右侧菱形标记 */
  branch?: boolean;
  /**
   * 行内编辑描述（仅基础类型数据输入行）。
   * 缺省时该行只读展示，点击头部设置按钮去抽屉编辑。
   */
  edit?: RowEditSpec;
}

/** 行内编辑描述：kind 限定基础三型，与 InlineRowEditor 对齐 */
export interface RowEditSpec {
  kind: InlineEditKind;
  value: string | number | boolean;
  onCommit: (value: string | number | boolean) => void;
  ariaLabel: string;
}

/** 分类配色（Blockly 式高饱和色块） */
export const BLOCK_COLORS: Record<NodeCategory, { bg: string; dark: string }> = {
  event: { bg: '#d43a3a', dark: '#9c2222' },
  getter: { bg: '#1d9db5', dark: '#126b7c' },
  condition: { bg: '#7c5cd6', dark: '#573da3' },
  action: { bg: '#e8832b', dark: '#ad5c12' },
  flow: { bg: '#2fa968', dark: '#1e7446' },
  variable: { bg: '#3b7ddd', dark: '#275795' },
};

const NOTCH_HALF_OUTER = 15;
const NOTCH_HALF_INNER = 9;
const NOTCH_DEPTH = 8;

const O = NOTCH_HALF_OUTER; // 缺口/凸榫外半宽
const I = NOTCH_HALF_INNER; // 缺口/凸榫内半宽
const D = NOTCH_DEPTH; // 缺口深度/凸榫高度
const B = `calc(100% - ${D}px)`; // 底边基线

const cx = (dx: number) => `calc(50% ${dx < 0 ? '-' : '+'} ${Math.abs(dx)}px)`;

function stackPolygon(): string {
  const pts = [
    `0 0`,
    `${cx(-O)} 0`,
    `${cx(-I)} ${D}px`,
    `${cx(I)} ${D}px`,
    `${cx(O)} 0`,
    `100% 0`,
    `100% ${B}`,
    `${cx(O)} ${B}`,
    `${cx(I)} 100%`,
    `${cx(-I)} 100%`,
    `${cx(-O)} ${B}`,
    `0 ${B}`,
  ];
  return `polygon(${pts.join(', ')})`;
}

function hatPolygon(): string {
  const pts = [
    `0 0`,
    `100% 0`,
    `100% ${B}`,
    `${cx(O)} ${B}`,
    `${cx(I)} 100%`,
    `${cx(-I)} 100%`,
    `${cx(-O)} ${B}`,
    `0 ${B}`,
  ];
  return `polygon(${pts.join(', ')})`;
}

export interface VerticalNodeShellProps {
  icon: string;
  title: string;
  category: NodeCategory;
  shape: BlockShape;
  /** 顶部缺口控制目标端口 id（null = 无缺口） */
  notchId: string | null;
  /** 底部凸榫控制源端口 id（null = 无凸榫） */
  tabId: string | null;
  /** 左侧数据/控制输入行 */
  leftRows: BlockRow[];
  /** 右侧数据/分支输出行 */
  rightRows: BlockRow[];
  badge?: string;
  collapsed: boolean;
  selected?: boolean;
  codeLocked?: boolean;
  onToggleCollapse: () => void;
  onOpenDrawer: () => void;
  children?: ReactNode;
}

function rowHandleStyle(side: 'left' | 'right', color: string): CSSProperties {
  return {
    position: 'absolute',
    top: '50%',
    transform: 'translateY(-50%)',
    left: side === 'left' ? -6 : undefined,
    right: side === 'right' ? -6 : undefined,
    width: 12,
    height: 12,
    borderRadius: '50%',
    background: '#fff',
    border: `3px solid ${color}`,
    boxSizing: 'border-box',
  };
}

function VerticalNodeShellComponent({
  icon,
  title,
  category,
  shape,
  notchId,
  tabId,
  leftRows,
  rightRows,
  badge,
  collapsed,
  selected = false,
  codeLocked = false,
  onToggleCollapse,
  onOpenDrawer,
  children,
}: VerticalNodeShellProps) {
  const colors = BLOCK_COLORS[category];

  const clipPath = useMemo(() => {
    if (shape === 'stack') return stackPolygon();
    if (shape === 'hat') return hatPolygon();
    return undefined;
  }, [shape]);

  const bodyStyle: CSSProperties = {
    background: colors.bg,
    clipPath,
    borderRadius: shape === 'reporter' ? 14 : undefined,
    color: '#fff',
    fontSize: 12,
    minWidth: 208,
    maxWidth: 264,
  };

  // 凸榫深度投影层（同形深色块下移 3px，拼图立体感）
  const depthStyle: CSSProperties = {
    position: 'absolute',
    inset: 0,
    transform: 'translateY(3px)',
    background: colors.dark,
    clipPath,
    borderRadius: shape === 'reporter' ? 14 : undefined,
  };

  const renderRow = (row: BlockRow, side: 'left' | 'right') => (
    <div
      key={row.id}
      data-testid={`block-row-${side}-${row.id}`}
      style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 6, minHeight: 22 }}
    >
      <Handle
        type={side === 'left' ? 'target' : 'source'}
        position={side === 'left' ? Position.Left : Position.Right}
        id={row.id}
        style={rowHandleStyle(side, colors.dark)}
      />
      {row.branch && (
        <span
          aria-hidden
          style={{
            width: 7,
            height: 7,
            transform: 'rotate(45deg)',
            background: '#fff',
            opacity: 0.9,
            flexShrink: 0,
          }}
        />
      )}
      <span style={{ opacity: 0.85, whiteSpace: 'nowrap' }}>{row.label}</span>
      {row.edit ? (
        <InlineRowEditor
          kind={row.edit.kind}
          value={row.edit.value}
          display={row.value}
          onCommit={row.edit.onCommit}
          ariaLabel={row.edit.ariaLabel}
          testId={`${side}-${row.id}`}
        />
      ) : (
        <span
          style={{
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
          }}
        >
          {row.value}
        </span>
      )}
    </div>
  );

  return (
    <div
      role="group"
      aria-label={`${title} 积木`}
      data-testid="puzzle-block"
      data-shape={shape}
      style={{ position: 'relative', width: 'fit-content' }}
      className={selected ? 'block-selected' : undefined}
    >
      {/* 深度投影 */}
      {shape !== 'reporter' && <div aria-hidden style={depthStyle} />}

      {/* 缺口连接点 */}
      {notchId && (
        <Handle
          type="target"
          position={Position.Top}
          id={notchId}
          data-testid="block-notch"
          style={{
            top: -7,
            width: 34,
            height: 18,
            background: 'transparent',
            border: 'none',
            zIndex: 10,
          }}
        />
      )}

      {/* 块体 */}
      <div style={{ ...bodyStyle, position: 'relative' }}>
        {/* 头部 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 10px 5px' }}>
          <McIcon scope="game" name={icon} size={16} />
          <span style={{ fontWeight: 700, whiteSpace: 'nowrap' }}>{title}</span>
          {badge && (
            <span
              style={{
                background: 'rgba(0,0,0,0.28)',
                borderRadius: 8,
                padding: '0 6px',
                fontSize: 10,
              }}
            >
              {badge}
            </span>
          )}
          {codeLocked && <Lock size={12} aria-label="代码已锁定" />}
          <span style={{ marginLeft: 'auto', display: 'flex', gap: 2 }}>
            <button
              type="button"
              aria-label={collapsed ? '展开积木' : '折叠积木'}
              onClick={onToggleCollapse}
              style={{
                background: 'transparent',
                border: 'none',
                color: '#fff',
                cursor: 'pointer',
                padding: 2,
                display: 'flex',
              }}
            >
              {collapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
            </button>
            <button
              type="button"
              aria-label="打开节点设置"
              onClick={onOpenDrawer}
              style={{
                background: 'transparent',
                border: 'none',
                color: '#fff',
                cursor: 'pointer',
                padding: 2,
                display: 'flex',
              }}
            >
              <Settings size={14} />
            </button>
          </span>
        </div>

        {/* 数据行 */}
        {!collapsed && (leftRows.length > 0 || rightRows.length > 0 || children) && (
          <div
            style={{ padding: '2px 12px 8px', display: 'flex', flexDirection: 'column', gap: 2 }}
          >
            {leftRows.map((r) => renderRow(r, 'left'))}
            {rightRows.map((r) => renderRow(r, 'right'))}
            {children}
          </div>
        )}
      </div>

      {/* 凸榫连接点 */}
      {tabId && (
        <Handle
          type="source"
          position={Position.Bottom}
          id={tabId}
          data-testid="block-tab"
          style={{
            bottom: -11,
            width: 34,
            height: 18,
            background: 'transparent',
            border: 'none',
            zIndex: 10,
          }}
        />
      )}

      {/* 选中高光 */}
      {selected && (
        <div
          aria-hidden
          style={{
            position: 'absolute',
            inset: -4,
            borderRadius: 12,
            border: '2px solid #fff',
            boxShadow: '0 0 0 2px rgba(0,0,0,0.4)',
            pointerEvents: 'none',
          }}
        />
      )}
    </div>
  );
}

export const VerticalNodeShell = memo(VerticalNodeShellComponent);
