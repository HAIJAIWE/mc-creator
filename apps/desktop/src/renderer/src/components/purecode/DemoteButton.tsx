import { useCallback } from 'react';
import type { FileNode } from '@mc-creator/shared';
import { demoteJavaToNodeGraph, type DemoteResult } from '../../lib/demoteFromPurecode.js';

/**
 * 降级按钮：把 L3 纯代码模式（PurecodeWorkspace）中的 Java/JSON 文件反向提取为节点图（L2）。
 *
 * 点击流程：
 * 1. 调用 demoteJavaToNodeGraph(files, modId) 进行反向解析
 * 2. 通过 window.confirm 显示提取统计（物品/方块/实体/配方/事件/代码节点数量）
 * 3. 用户确认后调用 onDemote(result)，由调用方负责写入 node-graph-store 并切换模式
 *
 * 集成说明：
 *   主代理（PurecodeWorkspace）应在顶部工具栏渲染此按钮，并传入 useModStore.files 与
 *   useNodeGraphStore 的 loadGraph + setMode('lowcode') 回调：
 *
 *   <DemoteButton
 *     files={useModStore(s => s.files)}
 *     modId={useNodeGraphStore(s => s.graph?.modId)}
 *     onDemote={(result) => {
 *       useNodeGraphStore.getState().loadGraph(result.graph);
 *       useModeStore.getState().setMode('lowcode');
 *     }}
 *   />
 */

export interface DemoteButtonProps {
  /** 文件列表（从 useModStore.files 传入） */
  files: FileNode[];
  /** 当前 modId（用于生成的 NodeGraph）；空值时由降级器从 fabric.mod.json 推导 */
  modId?: string;
  /** 降级成功后的回调（主代理接入时调用 useNodeGraphStore.getState().loadGraph + setMode('lowcode')） */
  onDemote: (result: DemoteResult) => void;
  /** 按钮文案（默认"⬇ 降级到 L2"） */
  label?: string;
  /** 可选的禁用状态（如 files 为空时） */
  disabled?: boolean;
}

/** 把 DemoteResult.stats 拼接为可读的统计字符串 */
function formatStats(stats: DemoteResult['stats']): string {
  const parts: string[] = [];
  if (stats.items > 0) parts.push(`${stats.items} 个物品`);
  if (stats.blocks > 0) parts.push(`${stats.blocks} 个方块`);
  if (stats.entities > 0) parts.push(`${stats.entities} 个实体`);
  if (stats.recipes > 0) parts.push(`${stats.recipes} 个配方`);
  if (stats.events > 0) parts.push(`${stats.events} 个事件`);
  if (stats.codeNodes > 0) parts.push(`${stats.codeNodes} 个代码节点`);
  if (parts.length === 0) return '未提取到任何可识别元素';
  return `提取到 ${parts.join('、')}`;
}

/**
 * 降级到 L2 模式的按钮组件。
 *
 * 使用原生 button + tailwind 样式，与 PurecodeWorkspace 工具栏风格保持一致。
 */
export function DemoteButton({
  files,
  modId,
  onDemote,
  label = '⬇ 降级到 L2',
  disabled = false,
}: DemoteButtonProps) {
  const handleClick = useCallback(() => {
    if (disabled || files.length === 0) return;

    // 执行反向降级
    const result = demoteJavaToNodeGraph(files, modId);

    // 显示统计确认对话框
    const statsText = formatStats(result.stats);
    const warningNote =
      result.warnings.length > 0 ? `\n\n另有 ${result.warnings.length} 条警告（详见控制台）。` : '';
    const confirmMessage = `${statsText}。确认降级到 L2 节点图模式？${warningNote}`;

    // 把警告打印到控制台，便于开发者排查（用户在 confirm 中只看到数量）
    if (result.warnings.length > 0 && typeof console !== 'undefined') {
      console.warn('[DemoteButton] 降级警告：', result.warnings);
    }

    const confirmed = typeof window !== 'undefined' ? window.confirm(confirmMessage) : true;
    if (!confirmed) return;

    onDemote(result);
  }, [disabled, files, modId, onDemote]);

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={disabled || files.length === 0}
      aria-label="从 Java 代码反向生成节点图"
      title={disabled ? '当前无文件可降级' : '从当前 Java/JSON 文件反向生成节点图（L2 模式）'}
      className="flex items-center gap-1 rounded-mc border border-mc-border bg-mc-surface-2 px-3 py-1 text-[11px] font-medium text-mc-text transition-colors hover:bg-mc-surface hover:border-mc-accent disabled:cursor-not-allowed disabled:opacity-40"
    >
      <span aria-hidden="true">{label}</span>
    </button>
  );
}
