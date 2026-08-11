import type { NodeGraph, ModNode, ModEdge } from '@mc-creator/shared';

/**
 * 节点图可视化调试器（纯函数实现）
 *
 * 设计目标：
 * - 模拟 event → condition → action 控制流执行
 * - 每一步可被单步驱动，便于 UI 高亮当前节点、显示变量与调用栈
 * - 不依赖 React/Zustand，纯函数 + 不可变状态，便于测试
 *
 * 控制流语义：
 * - 仅沿 kind === 'control' 的边遍历
 * - condition 节点根据 branchDecision 选择 'true' 或 'false' 出端口
 * - event/action 节点直接走任意 control 出边
 * - 多入口：多个 event 节点依次作为入口串行执行，前一条链结束后自动进入下一个未访问的 event
 * - 环路判定基于当前调用栈（跨 event 共享的下游节点允许重复进入）
 * - 终止条件：无下一节点 / 遇到断点 / 所有 event 入口均已访问 / 抛错 / 达到最大步数
 *
 * 简化语义（不真正执行 Java/JS，仅模拟）：
 * - event：触发，无输入
 * - condition：has_item 根据 inputs.item_stack 判定；chance 固定 true；其他默认 true
 * - action：执行（模拟），无输出
 * - code：标记为"无法模拟"，记录 warning
 * - 其他节点：跳过
 */

// === 类型定义 ===

/** 调试器执行状态（不可变，每次 step 返回新对象） */
export interface DebugState {
  /** 已访问的节点 id（按访问顺序） */
  visitedNodeIds: string[];
  /** 当前停留的节点 id（高亮显示） */
  currentNodeId: string | null;
  /** 已遍历的边 id */
  traversedEdgeIds: string[];
  /** 变量环境（节点 id → 输出值，简化为 Record<string, unknown>） */
  variables: Record<string, Record<string, unknown>>;
  /** 调用栈（节点 id 栈，用于 event → condition → action 嵌套） */
  callStack: string[];
  /** 执行日志（每步一条） */
  logs: DebugLogEntry[];
  /** 是否已结束 */
  finished: boolean;
  /** 错误信息（执行中抛出的） */
  error: string | null;
}

export interface DebugLogEntry {
  /** 时间戳（毫秒） */
  ts: number;
  /** 节点 id */
  nodeId: string;
  /** 节点 kind */
  kind: string;
  /** 动作描述 */
  action: 'enter' | 'execute' | 'leave' | 'branch-true' | 'branch-false' | 'error';
  /** 附加消息 */
  message?: string;
}

/** evaluateNode 返回值 */
export interface EvaluateResult {
  /** 节点输出变量 */
  outputs: Record<string, unknown>;
  /** 日志消息（人类可读） */
  logs: string[];
  /** 仅 condition 节点：分支决策结果 */
  branchDecision?: 'true' | 'false';
}

// === 常量 ===

/** 防止无限循环的最大步数（runUntilBreakpoint 内部使用） */
const MAX_STEPS = 1000;

// === 工具函数 ===

/** 查找节点 by id */
function findNode(graph: NodeGraph, nodeId: string): ModNode | null {
  return graph.nodes.find((n) => n.id === nodeId) ?? null;
}

/** 获取从指定节点出发的所有 control 边 */
function getOutgoingControlEdges(graph: NodeGraph, nodeId: string): ModEdge[] {
  return graph.edges.filter((e) => e.source === nodeId && e.kind === 'control' && !e.disabled);
}

/** 获取从指定节点某端口出发的所有 control 边 */
function getOutgoingControlEdgesFromPort(
  graph: NodeGraph,
  nodeId: string,
  portId: string,
): ModEdge[] {
  return graph.edges.filter(
    (e) => e.source === nodeId && e.kind === 'control' && !e.disabled && e.sourceHandle === portId,
  );
}

/** 浅拷贝并追加日志条目（含 evaluateNode 内部 logs 展开为 execute 条目） */
function appendLog(state: DebugState, entry: DebugLogEntry, extraLogs?: string[]): DebugLogEntry[] {
  const expanded: DebugLogEntry[] = extraLogs
    ? extraLogs.map((msg) => ({ ...entry, action: 'execute' as const, message: msg }))
    : [];
  return [...state.logs, entry, ...expanded];
}

// === 公共 API ===

/**
 * 从图中所有 event 节点开始，初始化调试状态。
 *
 * 语义：
 * - 若无 event 节点：finished=true（无可执行内容）
 * - 若有多个 event 节点：取第一个作为起点，其余入口在链结束后由 stepForward 依次进入
 * - 单 event 节点：进入该节点，记录 enter 日志，但尚未执行（执行在 stepForward 中进行）
 */
export function initDebugger(graph: NodeGraph): DebugState {
  const empty: DebugState = {
    visitedNodeIds: [],
    currentNodeId: null,
    traversedEdgeIds: [],
    variables: {},
    callStack: [],
    logs: [],
    finished: false,
    error: null,
  };

  // 找到第一个未禁用的 event 节点作为入口
  const entryEvent = graph.nodes.find((n) => n.data.kind === 'event' && !n.data.disabled);

  if (!entryEvent) {
    // 无 event 节点，直接结束
    return {
      ...empty,
      finished: true,
      logs: [
        {
          ts: Date.now(),
          nodeId: '',
          kind: '',
          action: 'error',
          message: '未找到 event 节点，调试器无入口',
        },
      ],
    };
  }

  // 进入 event 节点（记录 enter 日志，加入 visited 与 callStack）
  const enterLog: DebugLogEntry = {
    ts: Date.now(),
    nodeId: entryEvent.id,
    kind: 'event',
    action: 'enter',
    message: `进入事件节点 ${entryEvent.data.label || entryEvent.id}`,
  };

  return {
    ...empty,
    visitedNodeIds: [entryEvent.id],
    currentNodeId: entryEvent.id,
    callStack: [entryEvent.id],
    logs: [enterLog],
    finished: false,
  };
}

/**
 * 单步执行：从当前节点出发，沿 control 边走到下一个节点。
 *
 * 流程：
 * 1. 若已 finished，直接返回原状态
 * 2. 评估当前节点（evaluateNode），写入 variables，记录 execute 日志
 * 3. 根据节点类型与分支决策选择出边
 * 4. 沿出边走到下一节点，记录 enter 日志
 * 5. 若无下一节点：finished=true，记录 leave 日志
 *
 * @returns 新的 DebugState（不可变）
 */
export function stepForward(graph: NodeGraph, state: DebugState): DebugState {
  // 已结束，保持不变
  if (state.finished) return state;
  if (state.error) return state;

  const currentNodeId = state.currentNodeId;
  if (!currentNodeId) {
    // 无当前节点，标记结束
    return { ...state, finished: true };
  }

  const currentNode = findNode(graph, currentNodeId);
  if (!currentNode) {
    // 当前节点不存在（图被修改），标记错误结束
    return {
      ...state,
      finished: true,
      error: `当前节点 ${currentNodeId} 不存在于图中`,
      logs: appendLog(state, {
        ts: Date.now(),
        nodeId: currentNodeId,
        kind: '',
        action: 'error',
        message: `当前节点 ${currentNodeId} 不存在于图中`,
      }),
    };
  }

  // === 1. 评估当前节点 ===
  const inputs = collectInputs(state);
  let evalResult: EvaluateResult;
  try {
    evalResult = evaluateNode(currentNode, inputs);
  } catch (e) {
    const errMsg = (e as Error).message ?? String(e);
    return {
      ...state,
      finished: true,
      error: errMsg,
      logs: appendLog(state, {
        ts: Date.now(),
        nodeId: currentNodeId,
        kind: currentNode.data.kind,
        action: 'error',
        message: errMsg,
      }),
    };
  }

  // 写入当前节点的 outputs 到 variables
  const newVariables = {
    ...state.variables,
    [currentNodeId]: evalResult.outputs,
  };

  // 追加 execute 日志（包含 evaluateNode 内部 logs）
  let newLogs = appendLog(
    state,
    {
      ts: Date.now(),
      nodeId: currentNodeId,
      kind: currentNode.data.kind,
      action: 'execute',
      message: `执行 ${currentNode.data.kind} 节点`,
    },
    evalResult.logs,
  );

  // === 2. 选择出边 ===
  let nextEdges: ModEdge[] = [];
  if (currentNode.data.kind === 'condition' && evalResult.branchDecision) {
    // condition 节点：根据 branchDecision 选择 'true' 或 'false' 端口出边
    const portId = evalResult.branchDecision === 'true' ? 'true' : 'false';
    nextEdges = getOutgoingControlEdgesFromPort(graph, currentNodeId, portId);
    newLogs = [
      ...newLogs,
      {
        ts: Date.now(),
        nodeId: currentNodeId,
        kind: 'condition',
        action: evalResult.branchDecision === 'true' ? 'branch-true' : 'branch-false',
        message: `条件分支：${evalResult.branchDecision === 'true' ? '真' : '假'}`,
      },
    ];
  } else {
    // 其他节点：取所有 control 出边
    nextEdges = getOutgoingControlEdges(graph, currentNodeId);
  }

  // === 3. 沿出边推进 ===
  if (nextEdges.length === 0) {
    // 无下一节点：链结束。若图中还有未访问的 event 节点（多入口），进入下一个入口；
    // 否则当前节点离场，结束
    const nextEntry = graph.nodes.find(
      (n) => n.data.kind === 'event' && !n.data.disabled && !state.visitedNodeIds.includes(n.id),
    );
    if (nextEntry) {
      newLogs = [
        ...newLogs,
        {
          ts: Date.now(),
          nodeId: nextEntry.id,
          kind: 'event',
          action: 'enter',
          message: `进入下一事件入口 ${nextEntry.data.label || nextEntry.id}`,
        },
      ];
      return {
        ...state,
        visitedNodeIds: [...state.visitedNodeIds, nextEntry.id],
        currentNodeId: nextEntry.id,
        traversedEdgeIds: state.traversedEdgeIds,
        variables: newVariables,
        callStack: [nextEntry.id],
        logs: newLogs,
        finished: false,
      };
    }

    newLogs = [
      ...newLogs,
      {
        ts: Date.now(),
        nodeId: currentNodeId,
        kind: currentNode.data.kind,
        action: 'leave',
        message: `节点 ${currentNodeId} 无下游控制流，调试结束`,
      },
    ];
    const newCallStack =
      state.callStack[state.callStack.length - 1] === currentNodeId
        ? state.callStack.slice(0, -1)
        : state.callStack;
    return {
      ...state,
      variables: newVariables,
      callStack: newCallStack,
      logs: newLogs,
      traversedEdgeIds: state.traversedEdgeIds,
      finished: true,
    };
  }

  // 取第一条出边（多分支场景需后续扩展）
  const nextEdge = nextEdges[0];
  const nextNode = findNode(graph, nextEdge.target);
  if (!nextNode) {
    return {
      ...state,
      variables: newVariables,
      logs: newLogs,
      finished: true,
      error: `边 ${nextEdge.id} 的目标节点 ${nextEdge.target} 不存在`,
    };
  }

  // 防止重复访问导致死循环：若下一节点已在当前调用栈（本条执行链）中，视为环形图终止
  // （多入口共享下游节点：仅当同一链路上重复访问才判环，跨 event 共享的执行链不受影响）
  if (state.callStack.includes(nextNode.id)) {
    newLogs = [
      ...newLogs,
      {
        ts: Date.now(),
        nodeId: nextNode.id,
        kind: nextNode.data.kind,
        action: 'leave',
        message: `检测到环路：节点 ${nextNode.id} 在当前执行链中，调试结束`,
      },
    ];
    return {
      ...state,
      variables: newVariables,
      logs: newLogs,
      traversedEdgeIds: [...state.traversedEdgeIds, nextEdge.id],
      finished: true,
    };
  }

  // 推进到下一节点
  newLogs = [
    ...newLogs,
    {
      ts: Date.now(),
      nodeId: nextNode.id,
      kind: nextNode.data.kind,
      action: 'enter',
      message: `进入 ${nextNode.data.kind} 节点 ${nextNode.data.label || nextNode.id}`,
    },
  ];

  // 调用栈维护：condition/action 节点视为子调用，压栈；event 节点替换栈顶
  let newCallStack = state.callStack;
  if (nextNode.data.kind === 'event') {
    newCallStack = [nextNode.id];
  } else {
    newCallStack = [...state.callStack, nextNode.id];
  }

  return {
    ...state,
    visitedNodeIds: [...state.visitedNodeIds, nextNode.id],
    currentNodeId: nextNode.id,
    traversedEdgeIds: [...state.traversedEdgeIds, nextEdge.id],
    variables: newVariables,
    callStack: newCallStack,
    logs: newLogs,
    finished: false,
  };
}

/**
 * 执行到下一个断点（或结束）。
 *
 * 循环调用 stepForward，直到：
 * - finished=true
 * - 当前节点（即将执行的节点）在断点集合中（首次进入断点时暂停）
 * - 达到 MAX_STEPS 防止无限循环
 *
 * 注意：起始节点本身若是断点，应立即暂停（不执行任何 step）。
 */
export function runUntilBreakpoint(
  graph: NodeGraph,
  state: DebugState,
  breakpoints: Set<string>,
): DebugState {
  // 已结束直接返回
  if (state.finished) return state;

  // 若当前节点是断点，且 state 已有推进历史（visitedNodeIds 末尾就是 currentNodeId 且 logs 多于 1 条），
  // 则视为"刚进入断点"，暂停。
  // L-6 修复：初始状态（只访问过入口节点，logs 恰为 1 条）且入口本身是断点时也立即暂停。
  if (
    state.currentNodeId &&
    breakpoints.has(state.currentNodeId) &&
    state.visitedNodeIds[state.visitedNodeIds.length - 1] === state.currentNodeId &&
    (state.logs.length > 1 || state.visitedNodeIds.length === 1)
  ) {
    return state;
  }

  let current = state;
  for (let i = 0; i < MAX_STEPS; i++) {
    const next = stepForward(graph, current);
    if (next.finished) {
      return next;
    }
    // 若新 currentNodeId 在断点中，暂停
    if (next.currentNodeId && breakpoints.has(next.currentNodeId)) {
      return next;
    }
    // 若 stepForward 没有任何变化（防御性），结束
    if (next === current) {
      return { ...next, finished: true };
    }
    current = next;
  }

  // 达到最大步数仍未结束：标记 finished 并加 warning 日志
  return {
    ...current,
    finished: true,
    error: `达到最大步数 ${MAX_STEPS}，可能存在无限循环`,
    logs: [
      ...current.logs,
      {
        ts: Date.now(),
        nodeId: current.currentNodeId ?? '',
        kind: '',
        action: 'error',
        message: `达到最大步数 ${MAX_STEPS}，调试器中止`,
      },
    ],
  };
}

/**
 * 重置调试器到初始状态（等同于 initDebugger）。
 */
export function resetDebugger(graph: NodeGraph): DebugState {
  return initDebugger(graph);
}

/**
 * 获取从指定节点出发的所有 control 边目标节点（按边顺序）。
 *
 * 用于 UI 显示"下一节点"预览，或断点条件判断。
 */
export function getNextNodes(graph: NodeGraph, nodeId: string): ModNode[] {
  const edges = getOutgoingControlEdges(graph, nodeId);
  const nodes: ModNode[] = [];
  for (const edge of edges) {
    const target = findNode(graph, edge.target);
    if (target) nodes.push(target);
  }
  return nodes;
}

/**
 * 模拟节点执行（简化语义）：
 * - event 节点：触发，无输入，输出 { triggered: true, eventType }
 * - condition 节点：根据 conditionType 模拟返回 true/false
 *   - has_item：检查 inputs 是否含 item_stack，有则 true，无则 false
 *   - chance：固定返回 true（不真随机，便于调试）
 *   - 其他：默认 true
 *   - invert=true 时反转结果
 * - action 节点：执行（模拟），输出 { executed: true, actionType }
 * - code 节点：标记为"无法模拟"，记录 warning，输出 {}
 * - 其他节点：跳过，输出 {}
 *
 * @param node 待评估节点
 * @param inputs 上游节点输出合并后的输入变量
 */
export function evaluateNode(node: ModNode, inputs: Record<string, unknown>): EvaluateResult {
  const data = node.data;
  const logs: string[] = [];

  switch (data.kind) {
    case 'event': {
      logs.push(`事件触发：${data.eventType}`);
      return {
        outputs: {
          triggered: true,
          eventType: data.eventType,
          eventArgs: parseArgsJson(data.eventArgs),
        },
        logs,
      };
    }

    case 'condition': {
      let decision: boolean;
      // 解析 conditionArgs（用于 custom + chance 等场景）
      const condArgs = parseArgsJson(data.conditionArgs);
      switch (data.conditionType) {
        case 'has_item':
          decision = inputs.item_stack !== undefined && inputs.item_stack !== null;
          logs.push(
            `条件 has_item：inputs.item_stack ${decision ? '存在' : '不存在'} → ${decision}`,
          );
          break;
        case 'custom':
          // custom 类型：若 conditionArgs 含 chance 字段，固定返回 true（不真随机，便于调试）
          if (condArgs.chance !== undefined) {
            decision = true;
            logs.push(`条件 custom(chance)：固定返回 true（调试模式不真随机）`);
          } else {
            decision = true;
            logs.push(`条件 custom：默认 true（未提供 chance 字段）`);
          }
          break;
        default:
          decision = true;
          logs.push(`条件 ${data.conditionType}：默认 true（未实现具体判定）`);
          break;
      }
      if (data.invert) {
        decision = !decision;
        logs.push(`invert=true，反转后 → ${decision}`);
      }
      return {
        outputs: { result: decision, conditionType: data.conditionType },
        logs,
        branchDecision: decision ? 'true' : 'false',
      };
    }

    case 'action': {
      logs.push(`动作执行：${data.actionType}`);
      return {
        outputs: {
          executed: true,
          actionType: data.actionType,
          actionArgs: parseArgsJson(data.actionArgs),
        },
        logs,
      };
    }

    case 'code': {
      const warning = `代码节点 ${node.id} 无法在调试器中模拟执行（语言：${data.language}）`;
      logs.push(warning);
      return {
        outputs: {},
        logs,
      };
    }

    default: {
      logs.push(`节点类型 ${data.kind} 在控制流调试中跳过`);
      return {
        outputs: {},
        logs,
      };
    }
  }
}

// === 内部辅助 ===

/**
 * 收集当前节点的输入变量。
 *
 * 简化方案：合并所有已访问节点的 outputs 到一个 flat record。
 * 真实场景应基于 data 边按端口聚合，这里为调试可视化足够。
 */
function collectInputs(state: DebugState): Record<string, unknown> {
  const merged: Record<string, unknown> = {};
  for (const nodeId of state.visitedNodeIds) {
    const outputs = state.variables[nodeId];
    if (outputs) {
      Object.assign(merged, outputs);
    }
  }
  return merged;
}

/** 解析节点参数 JSON 字符串为 record（容错）。P2-4：增加调试日志记录解析失败 */
function parseArgsJson(json: string): Record<string, unknown> {
  if (!json || !json.trim()) return {};
  try {
    const parsed = JSON.parse(json);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    // P2-4：解析成功但不是对象时记录警告（调试器不中断，仅日志）
    console.warn(
      `[nodeGraphDebugger] parseArgsJson: JSON 应为对象，实际为 ${Array.isArray(parsed) ? 'array' : typeof parsed}`,
    );
    return {};
  } catch (e) {
    // P2-4：JSON 语法错误时记录警告
    console.warn(`[nodeGraphDebugger] parseArgsJson: JSON 解析失败 - ${(e as Error).message}`);
    return {};
  }
}
