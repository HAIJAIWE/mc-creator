import { memo, type ReactNode } from 'react';
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
  onToggleCollapse,
  onOpenDrawer,
  children,
}: McNodeShellProps) {
  const inputPorts = ports.filter((p) => p.direction === 'in');
  const outputPorts = ports.filter((p) => p.direction === 'out');

  return (
    <div
      className={`min-w-[180px] max-w-[280px] border-2 border-t-white border-l-white border-b-black border-r-black bg-mc-surface shadow-[4px_4px_0_rgba(0,0,0,0.5)] ${
        selected ? '!border-mc-accent' : ''
      }`}
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
        onToggleCollapse={onToggleCollapse}
        onOpenDrawer={onOpenDrawer}
      />

      {!collapsed && children && (
        <div className="space-y-0.5 px-3 py-2 text-[11px] text-mc-text">{children}</div>
      )}

      {/* 端口区：折叠时只显示输出端口（右对齐），展开时左右分列 */}
      {ports.length > 0 && (
        <div
          className={`flex ${
            collapsed ? 'justify-end' : 'justify-between'
          } gap-2 border-t-2 border-t-black border-b-white border-l-white border-r-white px-2 py-1`}
        >
          {!collapsed && inputPorts.length > 0 && (
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
