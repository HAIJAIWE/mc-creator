import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Send,
  Bot,
  User,
  Wrench,
  CheckCircle,
  XCircle,
  Loader2,
  Trash2,
  StopCircle,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import {
  agentRuntime,
  type AgentState,
  type AgentMessage,
  type AgentToolCall,
} from '../lib/agent-runtime.js';
import { findTool } from '../lib/agent-tools.js';

/** 工具调用卡片 */
function ToolCallCard({
  call,
  result,
  duration,
}: {
  call: AgentToolCall;
  result?: string;
  duration?: number;
}) {
  const tool = findTool(call.name);
  const [expanded, setExpanded] = useState(false);

  const categoryColors: Record<string, string> = {
    read: 'text-mc-accent',
    write: 'text-mc-gold',
    execute: 'text-mc-redstone',
    search: 'text-mc-dim',
  };
  const categoryLabels: Record<string, string> = {
    read: '读取',
    write: '写入',
    execute: '执行',
    search: '搜索',
  };

  return (
    <div className="my-1 rounded-mc border border-mc-border bg-mc-surface-2">
      {/* 工具调用头部 */}
      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-2 px-2 py-1.5 text-left"
      >
        <Wrench className={`h-3 w-3 ${categoryColors[tool?.category ?? 'read']}`} />
        <span className="text-xs font-medium text-mc-text">{call.name}</span>
        <span className="text-[10px] text-mc-mute">{categoryLabels[tool?.category ?? 'read']}</span>
        {duration !== undefined && <span className="text-[10px] text-mc-mute">{duration}ms</span>}
        <span className="ml-auto">
          {expanded ? (
            <ChevronDown className="h-3 w-3 text-mc-mute" />
          ) : (
            <ChevronRight className="h-3 w-3 text-mc-mute" />
          )}
        </span>
      </button>

      {/* 展开的详情 */}
      {expanded && (
        <div className="border-t border-mc-border px-2 py-2">
          {/* 参数 */}
          <div className="mb-1">
            <span className="text-[10px] font-medium text-mc-dim">参数：</span>
            <pre className="mt-0.5 rounded-mc bg-mc-bg p-1.5 font-mono text-[11px] text-mc-text overflow-x-auto">
              {JSON.stringify(call.arguments, null, 2)}
            </pre>
          </div>
          {/* 结果 */}
          {result && (
            <div>
              <span className="text-[10px] font-medium text-mc-dim">结果：</span>
              <pre className="mt-0.5 max-h-32 overflow-auto rounded-mc bg-mc-bg p-1.5 font-mono text-[11px] text-mc-text">
                {result.slice(0, 2000)}
                {result.length > 2000 ? '\n... [已截断]' : ''}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** 审批待定面板 */
function ApprovalPanel({
  call,
  onApprove,
  onReject,
}: {
  call: AgentToolCall;
  onApprove: () => void;
  onReject: () => void;
}) {
  const tool = findTool(call.name);
  return (
    <div className="my-2 rounded-mc border-2 border-mc-gold bg-mc-surface-2 px-3 py-2">
      <div className="flex items-center gap-2 mb-2">
        <Wrench className="h-4 w-4 text-mc-gold" />
        <span className="text-sm font-medium text-mc-gold">需要审批</span>
      </div>
      <p className="text-xs text-mc-text mb-2">
        智能体请求执行 <strong className="text-mc-gold">{call.name}</strong>
        {tool &&
          `（${tool.category === 'write' ? '写入' : tool.category === 'execute' ? '执行' : '读取'}操作）`}
      </p>
      <pre className="rounded-mc bg-mc-bg p-2 font-mono text-[11px] text-mc-text overflow-x-auto mb-2">
        {JSON.stringify(call.arguments, null, 2)}
      </pre>
      <div className="flex gap-2">
        <button onClick={onApprove} className="mc-btn-primary">
          <CheckCircle className="h-3 w-3" /> 批准
        </button>
        <button onClick={onReject} className="mc-btn-ghost">
          <XCircle className="h-3 w-3" /> 拒绝
        </button>
      </div>
    </div>
  );
}

/** 消息气泡 */
function MessageBubble({ message }: { message: AgentMessage }) {
  const isUser = message.role === 'user';
  const isSystem = message.role === 'system';

  return (
    <div className={`flex gap-2 ${isUser ? 'flex-row-reverse' : ''}`}>
      {/* 头像 */}
      <div
        className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-mc ${
          isUser ? 'bg-mc-accent/20' : isSystem ? 'bg-mc-surface-3' : 'bg-mc-surface-2'
        }`}
      >
        {isUser ? (
          <User className="h-3 w-3 text-mc-accent" />
        ) : (
          <Bot className="h-3 w-3 text-mc-text" />
        )}
      </div>

      {/* 内容 */}
      <div
        className={`max-w-[80%] rounded-mc px-3 py-2 text-xs ${
          isUser ? 'bg-mc-accent/10 text-mc-text' : 'bg-mc-surface-2 text-mc-text'
        }`}
      >
        {/* 文本内容（支持简单的 Markdown 代码块） */}
        {message.content && (
          <div className="whitespace-pre-wrap break-words">
            {message.content.split('```').map((segment, i) =>
              i % 2 === 0 ? (
                <span key={i}>{segment}</span>
              ) : (
                <pre
                  key={i}
                  className="my-1 rounded-mc bg-mc-bg p-2 font-mono text-[11px] overflow-x-auto"
                >
                  {segment}
                </pre>
              ),
            )}
          </div>
        )}

        {/* 工具调用 */}
        {message.toolCalls &&
          message.toolCalls.map((tc) => <ToolCallCard key={tc.id} call={tc} result={tc.result} />)}
      </div>
    </div>
  );
}

/**
 * AgentSession 面板：智能体 IDE 的核心交互界面。
 * 集成在左侧 AgentPanel 中，替代或增强现有的 AI 聊天功能。
 */
export function AgentSessionPanel() {
  const [state, setState] = useState<AgentState>(agentRuntime.getState());
  const [input, setInput] = useState('');
  const [autoApprove, setAutoApprove] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // 订阅 Agent 状态变更
  useEffect(() => {
    return agentRuntime.subscribe((newState) => {
      setState({ ...newState });
    });
  }, []);

  // 自动滚动到底部
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [state.messages]);

  // 自动审批（如果开启）
  useEffect(() => {
    if (autoApprove && state.pendingApproval) {
      agentRuntime.approveToolCall();
    }
  }, [autoApprove, state.pendingApproval]);

  const handleSend = useCallback(() => {
    if (!input.trim() || state.isRunning) return;
    agentRuntime.sendUserMessage(input.trim());
    setInput('');
  }, [input, state.isRunning]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  return (
    <div className="flex h-full flex-col">
      {/* 标题栏 */}
      <div className="flex items-center gap-2 border-b border-mc-border px-3 py-2">
        <Bot className="h-4 w-4 text-mc-accent" />
        <span className="text-sm font-medium text-mc-text">AI 智能体</span>
        <div className="ml-auto flex items-center gap-1">
          {/* 自动审批开关 */}
          <label className="flex items-center gap-1 text-[10px] text-mc-dim cursor-pointer">
            <input
              type="checkbox"
              checked={autoApprove}
              onChange={(e) => setAutoApprove(e.target.checked)}
              className="rounded-mc"
            />
            自动审批
          </label>
          {state.isRunning && (
            <button
              onClick={() => agentRuntime.abort()}
              className="mc-btn-ghost !px-1 !py-0.5"
              title="中止"
            >
              <StopCircle className="h-3 w-3 text-mc-redstone" />
            </button>
          )}
          <button
            onClick={() => agentRuntime.clearHistory()}
            className="mc-btn-ghost !px-1 !py-0.5"
            title="清空对话"
          >
            <Trash2 className="h-3 w-3" />
          </button>
        </div>
      </div>

      {/* 消息列表 */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-2 space-y-3">
        {state.messages.length === 0 && (
          <div className="flex flex-col items-center justify-center gap-2 py-8 text-center text-sm text-mc-dim">
            <Bot className="h-8 w-8 text-mc-mute" />
            <p>AI 智能体已就绪</p>
            <p className="text-xs">可以读取文件、编辑代码、搜索项目、执行命令</p>
          </div>
        )}
        {state.messages.map((msg, i) => (
          <MessageBubble key={i} message={msg} />
        ))}

        {/* 审批面板 */}
        {state.pendingApproval && !autoApprove && (
          <ApprovalPanel
            call={state.pendingApproval}
            onApprove={() => agentRuntime.approveToolCall()}
            onReject={() => agentRuntime.rejectToolCall()}
          />
        )}

        {/* 运行中指示器 */}
        {state.isRunning && !state.pendingApproval && (
          <div className="flex items-center gap-2 text-xs text-mc-dim">
            <Loader2 className="h-3 w-3 animate-spin text-mc-accent" />
            思考中...
          </div>
        )}

        {/* 错误 */}
        {state.error && (
          <div className="rounded-mc bg-mc-redstone/10 px-3 py-2 text-xs text-mc-redstone">
            {state.error}
          </div>
        )}
      </div>

      {/* 工具调用统计 */}
      {state.toolCallLog.length > 0 && (
        <div className="flex items-center gap-2 border-t border-mc-border px-3 py-1 text-[10px] text-mc-dim">
          <Wrench className="h-3 w-3" />
          本轮 {state.toolCallLog.length} 次工具调用
          {state.toolCallLog.some((t) => findTool(t.call.name)?.requiresApproval) &&
            '（含需审批操作）'}
        </div>
      )}

      {/* 输入框 */}
      <div className="border-t border-mc-border px-3 py-2">
        <div className="flex gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="描述你的需求，AI 将自动分析并操作项目文件..."
            rows={2}
            disabled={state.isRunning}
            className="flex-1 resize-none rounded-mc bg-mc-surface-2 px-2 py-1 text-xs text-mc-text outline-none placeholder:text-mc-mute"
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || state.isRunning}
            className="mc-btn-primary self-end"
          >
            <Send className="h-3 w-3" />
          </button>
        </div>
      </div>
    </div>
  );
}
