import type { NodeGraph } from '@mc-creator/shared';

// === 对外类型 ===

export interface DemoteResult {
  /** 反向生成的节点图 */
  graph: NodeGraph;
  /** 警告信息（无法识别的代码、降级过程中的妥协） */
  warnings: string[];
  /** 提取到的元素统计 */
  stats: {
    items: number;
    blocks: number;
    entities: number;
    recipes: number;
    events: number;
    codeNodes: number; // 无法识别的代码片段，保留为 CodeNode
  };
}

/** 提取摘要（spec: ExtractionSummary） */
export interface ExtractionSummary {
  items: number;
  blocks: number;
  entities: number;
  recipes: number;
  code: number;
}

/** 反向降级结果（spec: DemotionResult） */
export interface DemotionResult {
  /** 反向生成的节点图 */
  graph: NodeGraph;
  /** 警告信息 */
  warnings: string[];
  /** 无法识别的文件路径列表 */
  unsupported: string[];
  /** 提取摘要 */
  extracted: ExtractionSummary;
}

/** extractCodeNodes 返回的代码节点信息 */
export interface ExtractedCodeNode {
  nodeId: string;
  methodName: string;
  label: string;
  note: string;
  language: string;
  inputSignature: string;
  outputSignature: string;
  code: string;
}

/** extractRecipes 返回的配方信息 */
export interface ExtractedRecipe {
  recipeId: string;
  recipeType: string;
  outputItem: string;
  outputCount: number;
  pattern: string[];
  inputItems: string[];
}
