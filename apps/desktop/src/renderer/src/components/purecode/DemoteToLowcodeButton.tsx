import { useCallback } from 'react';
import { demoteJavaToNodeGraphSimple, type DemotionResult } from '../../lib/demoteFromPurecode.js';
import { useModStore } from '../../store/mod-store.js';
import { useNodeGraphStore } from '../../store/node-graph-store.js';
import { useEditorModeStore } from '../../store/editor-mode-store.js';

/**
 * L3 → L2 反向降级按钮（spec-compliant 版本，与 DemoteButton 并存）。
 *
 * 与同级 Agent 创建的 `DemoteButton` 区别：
 * - `DemoteButton`：受控组件，Props 由父组件传入 files/modId/onDemote；调用
 *   `demoteJavaToNodeGraph(files, modId?)`，回调后由父组件写入 store 并切换到 `lowcode`。
 * - `DemoteToLowcodeButton`：自包含组件，仅暴露 `className`；内部直接从
 *   `useModStore.files` 读取、调用 `demoteJavaToNodeGraphSimple(files)`，并通过
 *   `useNodeGraphStore.getState().loadGraph + commit + setMode('hybrid')` 完成闭环。
 *
 * 点击流程：
 *   1. 从 `useModStore.getState().files` 读取当前 L3 纯代码文件列表
 *   2. 调用 `demoteJavaToNodeGraphSimple(files)` 反向解析为节点图
 *   3. `window.confirm` 显示提取摘要，等待用户确认
 *   4. 确认后：`useNodeGraphStore.getState().loadGraph(result.graph)` + `commit()`
 *      → `useEditorModeStore.getState().setMode('hybrid')` 切换到 L2 混合模式
 *   5. `window.alert` 提示最终摘要（含 warnings/unsupported 数量）
 *
 * 无障碍：
 *   - `aria-label="从 Java 代码反向生成节点图并切换到混合模式"`
 *   - `aria-disabled` 同步 `disabled` 状态，便于屏幕阅读器感知
 *
 * 集成说明：
 *   主代理（PurecodeWorkspace）仅需在工具栏渲染：
 *     <DemoteToLowcodeButton />
 *   无需传入任何 props，按钮内部自包含所有逻辑。
 */

export interface DemoteToLowcodeButtonProps {
  /** 可选的额外 className（与现有工具栏按钮风格保持一致） */
  className?: string;
}

/** 把 ExtractionSummary 拼接为可读的统计字符串（用于 confirm/alert） */
function formatExtracted(summary: DemotionResult['extracted']): string {
  const parts: string[] = [];
  if (summary.items > 0) parts.push(`${summary.items} 个物品`);
  if (summary.blocks > 0) parts.push(`${summary.blocks} 个方块`);
  if (summary.entities > 0) parts.push(`${summary.entities} 个实体`);
  if (summary.recipes > 0) parts.push(`${summary.recipes} 个配方`);
  if (summary.code > 0) parts.push(`${summary.code} 个代码节点`);
  if (parts.length === 0) return '未提取到任何可识别元素';
  return `提取到 ${parts.join('、')}`;
}

/**
 * 自包含的降级到 L2 混合模式按钮。
 *
 * 使用原生 button + tailwind 样式，与 PurecodeWorkspace 工具栏风格保持一致。
 */
export function DemoteToLowcodeButton({ className }: DemoteToLowcodeButtonProps) {
  // 响应式订阅 files 长度，用于 disabled 状态计算（空列表时禁用）
  const filesLength = useModStore((s) => s.files.length);

  const handleClick = useCallback(() => {
    // 1. 从 useModStore 读取当前文件列表（用 getState 取最新值，避免闭包陈旧）
    const files = useModStore.getState().files;
    if (files.length === 0) return;

    // 2. 调用 spec-compliant 反向降级纯函数
    const result = demoteJavaToNodeGraphSimple(files);

    // 把警告/不支持文件打印到控制台，便于开发者排查（用户在 confirm 中只看到数量）
    if (result.warnings.length > 0 && typeof console !== 'undefined') {
      console.warn('[DemoteToLowcodeButton] 降级警告：', result.warnings);
    }
    if (result.unsupported.length > 0 && typeof console !== 'undefined') {
      console.info('[DemoteToLowcodeButton] 未识别文件：', result.unsupported);
    }

    // 3. confirm 显示提取摘要，等待用户确认
    const statsText = formatExtracted(result.extracted);
    const warningNote =
      result.warnings.length > 0 ? `\n\n另有 ${result.warnings.length} 条警告（详见控制台）。` : '';
    const unsupportedNote =
      result.unsupported.length > 0
        ? `\n另有 ${result.unsupported.length} 个未识别文件（详见控制台）。`
        : '';
    const confirmMessage = `${statsText}。确认降级到 L2 混合模式？${warningNote}${unsupportedNote}`;

    const confirmed = typeof window !== 'undefined' ? window.confirm(confirmMessage) : true;
    if (!confirmed) return;

    // 4. 确认后：写入 node-graph-store + commit 到撤销栈 + 切换到 hybrid 模式
    useNodeGraphStore.getState().loadGraph(result.graph);
    useNodeGraphStore.getState().commit();
    useEditorModeStore.getState().setMode('hybrid');

    // 5. alert 提示最终摘要（让用户感知切换成功）
    if (typeof window !== 'undefined') {
      const successMessage = `已切换到 L2 混合模式。\n${statsText}。`;
      window.alert(successMessage);
    }
  }, []);

  const disabled = filesLength === 0;

  // 合并 className：默认工具栏按钮样式 + 用户传入的额外样式
  const combinedClassName = [
    'flex items-center gap-1 rounded-mc border border-mc-border bg-mc-surface-2 px-3 py-1 text-[11px] font-medium text-mc-text transition-colors hover:bg-mc-surface hover:border-mc-accent disabled:cursor-not-allowed disabled:opacity-40',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={disabled}
      aria-label="从 Java 代码反向生成节点图并切换到混合模式"
      aria-disabled={disabled}
      title={disabled ? '当前无文件可降级' : '从当前 Java/JSON 文件反向生成节点图（L2 混合模式）'}
      className={combinedClassName}
    >
      <span aria-hidden="true">⬇ 降级到 L2</span>
    </button>
  );
}
