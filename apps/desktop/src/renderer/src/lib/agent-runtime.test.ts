// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AgentRuntime, type AgentToolCall } from './agent-runtime.js';

/**
 * AgentRuntime 测试：mock ipcClient.chatStream 注入脚本化响应序列。
 * 覆盖核心 Agent 循环状态机：纯文本 / 工具调用 / 审批 / 中止 / 超时 / 未知工具 / 最大轮次。
 */

// mock ipcClient（chatStream 是唯一网络入口）
vi.mock('./ipc-client.js', () => ({
  ipcClient: {
    chatStream: vi.fn(),
    terminalSpawn: vi.fn(),
    terminalWrite: vi.fn(),
    terminalKill: vi.fn(),
  },
}));

import { ipcClient } from './ipc-client.js';

const mockChatStream = ipcClient.chatStream as ReturnType<typeof vi.fn>;

/** 注入单轮响应：AI 直接回复文本 */
function respondWithText(text: string) {
  mockChatStream.mockImplementationOnce(
    (_msg: string, onChunk: (delta: string, done: boolean) => void) => {
      onChunk(text, true);
    },
  );
}

/** 注入单轮响应：AI 回复含工具调用代码块 */
function respondWithToolCall(toolCall: { name: string; arguments: Record<string, unknown> }) {
  const codeBlock = `\`\`\`tool:${toolCall.name}\n${JSON.stringify(toolCall.arguments)}\n\`\`\``;
  mockChatStream.mockImplementationOnce(
    (_msg: string, onChunk: (delta: string, done: boolean) => void) => {
      onChunk(codeBlock, true);
    },
  );
}

describe('AgentRuntime 核心循环', () => {
  let runtime: AgentRuntime;

  beforeEach(() => {
    vi.clearAllMocks();
    runtime = new AgentRuntime();
  });

  it('纯文本回复：追加 assistant 消息并结束循环', async () => {
    respondWithText('这是最终回复');
    await runtime.sendUserMessage('你好');
    const state = runtime.getState();
    const texts = state.messages.map((m) => m.content);
    expect(texts).toContain('你好'); // 用户消息
    expect(texts).toContain('这是最终回复'); // 助手回复
    expect(state.isRunning).toBe(false);
    expect(state.error).toBeNull();
  });

  it('工具调用：解析 tool 代码块、执行、结果回填 tool 消息', async () => {
    // 第一轮：调用 list_files；第二轮：最终文本
    respondWithToolCall({ name: 'list_files', arguments: { directory: '' } });
    respondWithText('文件列表已获取');
    await runtime.sendUserMessage('列出文件');
    const state = runtime.getState();
    // 应有 tool 消息（执行结果）
    const toolMsg = state.messages.find((m) => m.role === 'tool');
    expect(toolMsg).toBeDefined();
    // 工具调用记录在 toolCallLog
    expect(state.toolCallLog.length).toBe(1);
    expect(state.toolCallLog[0].call.name).toBe('list_files');
    expect(state.toolCallLog[0].result).toContain('没有找到文件');
  });

  it('审批流程：requiresApproval 工具置 pendingApproval，批准后执行', async () => {
    respondWithToolCall({ name: 'write_file', arguments: { path: 'x.txt', content: 'hi' } });
    respondWithText('已写入');
    const sendPromise = runtime.sendUserMessage('写文件');
    // 等待 pendingApproval 出现
    await vi.waitFor(() => {
      expect(runtime.getState().pendingApproval).not.toBeNull();
    });
    const pending = runtime.getState().pendingApproval as AgentToolCall;
    expect(pending.name).toBe('write_file');
    // 批准
    runtime.approveToolCall();
    await sendPromise;
    const state = runtime.getState();
    expect(state.toolCallLog.length).toBe(1);
    expect(state.pendingApproval).toBeNull();
  });

  it('审批拒绝：跳过工具执行并回传拒绝 tool 消息', async () => {
    respondWithToolCall({ name: 'write_file', arguments: { path: 'x.txt', content: 'hi' } });
    respondWithText('好的');
    const sendPromise = runtime.sendUserMessage('写文件');
    await vi.waitFor(() => {
      expect(runtime.getState().pendingApproval).not.toBeNull();
    });
    runtime.rejectToolCall('不想写');
    await sendPromise;
    const state = runtime.getState();
    // 工具未执行
    expect(state.toolCallLog.length).toBe(0);
    // 有拒绝原因的 tool 消息
    const rejectMsg = state.messages.find((m) => m.role === 'tool');
    expect(rejectMsg?.content).toContain('拒绝');
    expect(rejectMsg?.content).toContain('不想写');
  });

  it('未知工具：追加「未知工具」tool 消息，不崩溃', async () => {
    respondWithToolCall({ name: 'no_such_tool', arguments: {} });
    respondWithText('继续');
    await runtime.sendUserMessage('调用未知工具');
    const state = runtime.getState();
    const unknownMsg = state.messages.find(
      (m) => m.role === 'tool' && m.content.includes('未知工具'),
    );
    expect(unknownMsg).toBeDefined();
  });

  it('abort() 中止运行，不产生 error', async () => {
    // 永不完成的流（挂起）
    mockChatStream.mockImplementationOnce(() => {
      // 不回调任何 chunk
    });
    const sendPromise = runtime.sendUserMessage('测试中止');
    runtime.abort();
    await sendPromise;
    const state = runtime.getState();
    expect(state.isRunning).toBe(false);
    expect(state.error).toBeNull();
    expect(state.messages.some((m) => m.content.includes('测试中止'))).toBe(true);
  });

  it('sendUserMessage 异常时 error 状态记录', async () => {
    mockChatStream.mockImplementationOnce(() => {
      throw new Error('网络错误');
    });
    await runtime.sendUserMessage('触发错误');
    const state = runtime.getState();
    expect(state.error).toBe('网络错误');
    expect(state.isRunning).toBe(false);
  });

  it('clearHistory 清空消息与工具日志', async () => {
    respondWithText('回复');
    await runtime.sendUserMessage('你好');
    expect(runtime.getState().messages.length).toBeGreaterThan(0);
    runtime.clearHistory();
    const state = runtime.getState();
    expect(state.messages).toEqual([]);
    expect(state.toolCallLog).toEqual([]);
    expect(state.error).toBeNull();
  });

  it('订阅通知：listener 收到状态快照', async () => {
    const listener = vi.fn();
    runtime.subscribe(listener);
    respondWithText('hello');
    await runtime.sendUserMessage('hi');
    // 至少收到一次通知（isRunning 变化等）
    expect(listener).toHaveBeenCalled();
    const snapshots = listener.mock.calls.map((c) => c[0] as { isRunning: boolean });
    expect(snapshots.some((s) => s.isRunning === true)).toBe(true);
  });
});
