import type { NodeGraph, ModSpec, FileNode } from '@mc-creator/shared';
import { compileGraph } from './incrementalCompiler.js';
import { generateFilesForType } from './generate-files.js';

/**
 * B 桥：节点图 → spec → 项目文件
 *
 * 节点图「编译并应用」的链路封装：
 * 1. compileNodeGraph(graph) → ModSpec（误差则立即返回，不产文件）
 * 2. generateFilesForType('mod', spec, { loader, mcVersion }) → FileNode[]
 *    （复用浏览器端通用生成入口，支持 fabric/neoforge/quilt 全部 loader，
 *      而非低代码预览面板里硬编码的 FabricAdapter）
 *
 * 调用方（LowcodeWorkspace）负责：setSpec(结果.spec) + applyGeneratedFiles(结果.files) + 播报 preserved。
 */
export interface ApplyGraphToProjectResult {
  spec: ModSpec;
  files: FileNode[];
  warnings: string[];
  errors: string[];
  warningsWithLocation?: import('./compileNodeGraph.js').CompileMessage[];
  errorsWithLocation?: import('./compileNodeGraph.js').CompileMessage[];
}

export async function applyGraphToProject(
  graph: NodeGraph,
  opts: { generatorType: string; loader: string; mcVersion: string },
): Promise<ApplyGraphToProjectResult> {
  const compiled = await compileGraph(graph);
  const base = {
    spec: compiled.spec,
    warnings: compiled.warnings,
  };

  if (compiled.errors.length > 0) {
    // 编译错误：不落库，UI 仅显示错误徽章
    return { ...base, files: [], errors: compiled.errors };
  }

  try {
    const outcome = await generateFilesForType(opts.generatorType, compiled.spec, {
      loader: opts.loader,
      mcVersion: opts.mcVersion,
    });
    return {
      ...base,
      files: outcome.files,
      warnings: [...base.warnings, ...outcome.warnings],
      errors: [],
    };
  } catch (e) {
    // 生成器抛错（如 spec 校验失败）→ 视为致命错误，不落库
    return { ...base, files: [], errors: [(e as Error).message] };
  }
}
