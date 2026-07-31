import { memo, useMemo, type ReactNode } from 'react';
import type { NodePort } from '@mc-creator/shared';
import { McNodeHeader, type NodeDebugState, type NodeErrorState } from './McNodeHeader.js';
import { McNodePort } from './McNodePort.js';

/**
 * McNodeShell 统一节点外壳（契约 §2 最终签名）。
 *
 * 所有节点组件必须使用此签名调用 McNodeShell。
 * - header: McNodeHeader（3D 凸起头部 + 色条 + 图标 + 标题 + 徽章 + 折叠/设置按钮 + 调试/错误标记）
 * - children: 摘要内容（展开时显示在头部下方，折叠时隐藏）
 * - ports: 端口列表，来自 node.ports（store 初始化）
 *
 * P2 无障碍：添加 role="group" + aria-label，使节点可被屏幕阅读器识别。
 * P2 性能：端口过滤使用 useMemo 避免每次渲染重复计算。
 */
export interface McNodeShellProps {
  /** 头部图标名（如 'item'/'block'/'variable'/'loop'） */
  icon: string;
  /** 头部标题（通常用 node.data.label） */
  title: string;
  /** 头部色条 Tailwind class（如 'mc-item'/'mc-block'/'mc-variable'） */
  colorClass: string;
  /** 右上角徽章文本（如 'const'/'forEach'，可选） */
  badge?: string;
  /** 端口列表（来自 node.ports） */
  ports: NodePort[];
  /** 是否折叠 */
  collapsed: boolean;
  /** 是否选中 */
  selected?: boolean;
  /** 调试状态（折叠时在头部显示标记） */
  debugState?: NodeDebugState;
  /** 错误状态（编译错误/警告时头部变色） */
  errorState?: NodeErrorState;
  /** P0-1: 代码锁定状态（对标 MCreator codeLock），锁定时头部显示 🔒 + 外壳黄色边框 */
  codeLocked?: boolean;
  /** 切换折叠回调 */
  onToggleCollapse: () => void;
  /** 打开抽屉回调（双击或点⚙） */
  onOpenDrawer: () => void;
  /** 摘要内容（展开时显示在头部下方） */
  children?: ReactNode;
}

function McNodeShellComponent({
  icon,
  title,
  colorClass,
  badge,
  ports,
  collapsed,
  selected = false,
  debugState,
  errorState,
  codeLocked = false,
  onToggleCollapse,
  onOpenDrawer,
  children,
}: McNodeShellProps) {
  // P2 性能：端口过滤使用 useMemo，仅在 ports 引用变化时重新计算
  const inputPorts = useMemo(() => ports.filter((p) => p.direction === 'in'), [ports]);
  const outputPorts = useMemo(() => ports.filter((p) => p.direction === 'out'), [ports]);

  return (
    <div
      role="group"
      aria-label={`${title} 节点`}
      className={`min-w-[180px] max-w-[280px] border-2 border-t-white border-l-white border-b-black border-r-black bg-mc-surface shadow-[4px_4px_0_rgba(0,0,0,0.5)] ${
        selected ? '!border-mc-accent' : ''
      } ${codeLocked ? '!border-yellow-500' : ''}`}
      style={{
        backgroundImage: 'radial-gradient(rgba(255,255,255,0.03) 1px, transparent 1px)',
        backgroundSize: '3px 3px',
      }}
    >
      <McNodeHeader
        icon={icon}
        title={title}
        colorClass={colorClass}
        badge={badge}
        collapsed={collapsed}
        debugState={debugState}
        errorState={errorState}
        codeLocked={codeLocked}
        onToggleCollapse={onToggleCollapse}
        onOpenDrawer={onOpenDrawer}
      />

      {!collapsed && children && (
        <div className="space-y-0.5 px-3 py-2 text-[11px] text-mc-text">{children}</div>
      )}

      {/* 端口区：展开/折叠均显示输入+输出端口 */}
      {ports.length > 0 && (
        <div
          className="flex justify-between gap-2 border-t-2 border-t-black border-b-white border-l-white border-r-white px-2 py-1"
          role="list"
          aria-label="端口"
        >
          {inputPorts.length > 0 && (
            <div className="flex flex-col gap-1">
              {inputPorts.map((p) => (
                <McNodePort key={p.id} port={p} />
              ))}
            </div>
          )}
          {outputPorts.length > 0 && (
            <div className="flex flex-col gap-1">
              {outputPorts.map((p) => (
                <McNodePort key={p.id} port={p} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export const McNodeShell = memo(McNodeShellComponent);
