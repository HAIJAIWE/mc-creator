import type { ReactNode } from 'react';

/**
 * 从构建日志中提取 jar 产物路径（匹配 build/libs/*.jar）。
 * BuildPanel 与（已删除构建区块的）AgentPanel 共用。
 */
export function extractJarPath(log: string): string | null {
  const match = log.match(/build\/libs\/[^\s"']*\.jar/);
  return match ? match[0] : null;
}

/** 逐行渲染构建日志：错误红色、警告黄色、其他默认色 */
export function renderLog(log: string): ReactNode {
  return log.split('\n').map((line, i) => {
    const isError = /error:|ERROR|FAILED/i.test(line);
    const isWarn = /warning:|WARN/i.test(line);
    const color = isError ? 'text-mc-redstone' : isWarn ? 'text-mc-gold' : 'text-mc-text';
    return (
      <div key={i} className={color}>
        {line || ' '}
      </div>
    );
  });
}
