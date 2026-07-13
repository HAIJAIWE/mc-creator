/** 模型能力声明（规格 §2.2） */
export interface ModelCapabilities {
  toolCalling: boolean;
  vision: boolean;
  streaming: boolean;
}

/** 流式片段 */
export interface StreamChunk {
  delta: string;
  done: boolean;
}

/** 模型提供者统一接口（云端/本地同接口） */
export interface ModelProvider {
  readonly id: string;
  readonly capabilities: ModelCapabilities;

  /** 非流式补全 */
  complete(prompt: string, opts?: CompleteOptions): Promise<string>;

  /** 流式补全 */
  stream(prompt: string, opts?: CompleteOptions): AsyncIterable<StreamChunk>;
}

export interface CompleteOptions {
  system?: string;
  maxTokens?: number;
  /** 工具调用结果回灌（用于重试） */
  toolResults?: Array<{ name: string; result: string }>;
}
