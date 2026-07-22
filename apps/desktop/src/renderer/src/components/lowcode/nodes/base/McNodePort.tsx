import { memo } from 'react';
import { Handle, Position } from 'reactflow';
import type { NodePort } from '@mc-creator/shared';
import { PORT_COLORS } from './portColors.js';

interface McNodePortProps {
  port: NodePort;
}

/**
 * 单个端口：带标签的 Handle，MC 风格凹陷方块。
 * - 输入端口：左侧 Handle + 标签
 * - 输出端口：标签 + 右侧 Handle
 * - Handle 为 6×6 方块，inset shadow 模拟 MC 凹陷感
 */
function McNodePortComponent({ port }: McNodePortProps) {
  const color = PORT_COLORS[port.type];
  const isInput = port.direction === 'in';
  const position = isInput ? Position.Left : Position.Right;

  const handleStyle: React.CSSProperties = {
    width: 8,
    height: 8,
    borderRadius: 0,
    background: color,
    border: '1px solid rgba(0,0,0,0.8)',
    boxShadow: 'inset 2px 2px 0 rgba(0,0,0,0.6)',
  };

  return (
    <div className="flex items-center gap-1 text-[10px] text-mc-text">
      {isInput && <Handle type="target" position={position} id={port.id} style={handleStyle} />}
      <span className="select-none">
        {port.required && <span className="text-red-400">*</span>}
        {port.label}
      </span>
      {!isInput && <Handle type="source" position={position} id={port.id} style={handleStyle} />}
    </div>
  );
}

export const McNodePort = memo(McNodePortComponent);
