import { useState, useEffect, useMemo } from 'react';
import type { NodeGraph, FileNode } from '@mc-creator/shared';
import { compileNodeGraph, type CompileResult } from './compileNodeGraph.js';
import { FabricAdapter } from '@mc-creator/core/generators/mod/fabric-adapter.js';

export interface DebouncedCompileResult {
  /** 编译结果（含 spec/warnings/errors） */
  compileResult: CompileResult | null;
  /** 生成的 Java/JSON 文件列表（仅当编译成功时填充） */
  generatedFiles: FileNode[];
  /** 是否正在编译（防抖延迟中） */
  isCompiling: boolean;
}

/**
 * 防抖编译 hook：graph 变化后等待 delay ms 再编译，并自动用 FabricAdapter 生成文件。
 *
 * 实现要点：
 * - 使用 JSON.stringify(graph) 作为依赖键，避免深比较开销的同时保证内容变化才触发重编译
 * - isCompiling 在 graph 变化时立即变 true，编译完成时变 false
 * - 编译出错（errors 非空）时不调用 FabricAdapter，generatedFiles 清空
 * - enabled === false 时返回空闲结果（null/[]/false），不调度任何定时器
 *
 * @param graph 节点图
 * @param delay 防抖延迟，默认 500ms
 * @param enabled 是否启用（false 时返回 null 结果），默认 true
 */
export function useDebouncedCompile(
  graph: NodeGraph,
  delay = 500,
  enabled = true,
): DebouncedCompileResult {
  // 用 JSON.stringify 作为依赖键：内容相同时字符串相同（primitive Object.is 比较），
  // effect 不会重跑；只有内容真正变化时才重编译。比深比较便宜，比引用比较准确。
  const graphKey = useMemo(() => JSON.stringify(graph), [graph]);

  const [compileResult, setCompileResult] = useState<CompileResult | null>(null);
  const [generatedFiles, setGeneratedFiles] = useState<FileNode[]>([]);
  // 初始状态跟随 enabled：启用时立即进入"编译中"，避免首屏闪过空白状态
  const [isCompiling, setIsCompiling] = useState<boolean>(enabled);

  useEffect(() => {
    // 未启用：清空所有状态，不调度定时器
    if (!enabled) {
      setCompileResult(null);
      setGeneratedFiles([]);
      setIsCompiling(false);
      return;
    }

    // graph 变化时立即进入编译中状态（用户能看到反馈）
    setIsCompiling(true);

    // 防抖：延迟 delay ms 再编译，避免连续编辑时频繁编译
    const timer = setTimeout(() => {
      try {
        const result = compileNodeGraph(graph);
        setCompileResult(result);

        // 仅当编译通过（无 errors）时才用 FabricAdapter 生成文件
        if (result.errors.length === 0) {
          try {
            const files = new FabricAdapter().translate({
              spec: result.spec,
              mcVersion: '1.21.11',
              modId: result.spec.modId,
              loader: 'fabric',
              projectPath: '/preview',
            });
            setGeneratedFiles(files);
          } catch {
            // 生成失败时清空文件列表，避免显示陈旧数据
            setGeneratedFiles([]);
          }
        } else {
          // 编译出错时不显示旧文件
          setGeneratedFiles([]);
        }
      } catch {
        // compileNodeGraph 抛异常时清空结果
        setCompileResult(null);
        setGeneratedFiles([]);
      } finally {
        setIsCompiling(false);
      }
    }, delay);

    // 清理：graph 在延迟期间再次变化时取消上一次定时器
    return () => clearTimeout(timer);
    // 依赖 graphKey（内容键）而非 graph 引用，避免引用变内容不变时重复编译
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graphKey, delay, enabled]);

  // 未启用时统一返回空闲结果，避免暴露内部状态
  if (!enabled) {
    return { compileResult: null, generatedFiles: [], isCompiling: false };
  }

  return { compileResult, generatedFiles, isCompiling };
}
