import { useRef, useCallback, useEffect } from 'react';
import { Send, Bot, User, Loader2, Trash2 } from 'lucide-react';
import { ipcClient } from '../lib/ipc-client.js';
import { useChatStore } from '../store/chat-store.js';
import { useModStore } from '../store/mod-store.js';

interface ChatPanelProps {
  apiKey: string;
  /** P11.4 项目类型徽章：传入时在标题栏显示当前生成器类型 */
  generatorType?: string;
}

/** P11.4 生成器类型 → 中文标签映射 */
const GENERATOR_LABELS: Record<string, string> = {
  mod: '模组',
  datapack: '数据包',
  modpack: '整合包',
  server: '服务器',
  resource_pack: '资源包',
  skin: '皮肤',
  launcher: '启动器',
};

/**
 * P12.4 从 ModSpec 生成简短摘要（避免传完整 JSON 消耗 token）。
 * 包含 modId / 版本 / 名称 / 描述 / items 与 blocks 数量及前 5 个名称。
 */
function buildSpecSummary(spec: unknown): string {
  if (!spec || typeof spec !== 'object') return '';
  const s = spec as {
    modId?: string;
    version?: string;
    name?: string;
    description?: string;
    items?: Array<{ id: string; name?: string }>;
    blocks?: Array<{ id: string; name?: string }>;
  };
  const lines: string[] = [];
  if (s.modId) lines.push(`modId: ${s.modId}`);
  if (s.version) lines.push(`version: ${s.version}`);
  if (s.name) lines.push(`name: ${s.name}`);
  if (s.description) lines.push(`description: ${s.description}`);
  if (Array.isArray(s.items)) {
    const sample = s.items
      .slice(0, 5)
      .map((i) => `${i.id}(${i.name ?? i.id})`)
      .join(', ');
    lines.push(`items[${s.items.length}]: ${sample}${s.items.length > 5 ? ', ...' : ''}`);
  }
  if (Array.isArray(s.blocks)) {
    const sample = s.blocks
      .slice(0, 5)
      .map((b) => `${b.id}(${b.name ?? b.id})`)
      .join(', ');
    lines.push(`blocks[${s.blocks.length}]: ${sample}${s.blocks.length > 5 ? ', ...' : ''}`);
  }
  return lines.join('\n');
}

/**
 * ChatPanel：AI 助手聊天面板（chat 模式）。
 *
 * P10.6 重构：从 AgentPanel 中抽出，参考 AgentSessionPanel 的结构统一聊天 UI：
 * - 布局用 `flex h-full flex-col`，消息列表 `flex-1 overflow-y-auto` 修复滚动
 * - 消息气泡加头像（Bot/User）+ 代码块渲染（```...```）
 * - 输入框改为 `<textarea rows={2}>` 支持多行，Enter 发送 / Shift+Enter 换行
 * - 加清空对话按钮、流式「思考中」指示器
 * - 无 apiKey 时输入框禁用
 *
 * P11.2 状态持久化：messages/input/sending 提升到 useChatStore，
 * 切换到 agent 模式再切回时对话历史不丢失。
 *
 * P11.4 项目上下文感知：标题栏显示生成器类型徽章，让用户知道 chat 模式感知项目类型。
 */
export function ChatPanel({ apiKey, generatorType }: ChatPanelProps) {
  const messages = useChatStore((s) => s.messages);
  const input = useChatStore((s) => s.input);
  const sending = useChatStore((s) => s.sending);
  const setInput = useChatStore((s) => s.setInput);
  const setSending = useChatStore((s) => s.setSending);
  const setMessages = useChatStore((s) => s.setMessages);
  const updateLastAssistant = useChatStore((s) => s.updateLastAssistant);
  const clearHistory = useChatStore((s) => s.clearHistory);

  // P12.4 从 mod-store 提取项目上下文（用户描述 + 当前 spec）
  const description = useModStore((s) => s.description);
  const spec = useModStore((s) => s.spec);

  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // 自动滚动到底部（消息变化时）
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || sending) return;
    setInput('');
    // 先追加 user 消息 + 空 assistant 占位（流式累加用）
    setMessages((m) => [...m, { role: 'user', text }, { role: 'assistant', text: '' }]);
    setSending(true);

    if (!apiKey) {
      updateLastAssistant(() => ({ role: 'assistant', text: '请先在「设置」中配置 API Key。' }));
      setSending(false);
      return;
    }

    // P12.4 构建项目上下文：让 chat 模式感知当前生成器类型/描述/spec 摘要
    const specSummary = buildSpecSummary(spec);
    const context =
      generatorType || description || specSummary
        ? {
            generatorType,
            description: description || undefined,
            specSummary: specSummary || undefined,
          }
        : undefined;

    try {
      await ipcClient.chatStream(
        text,
        (delta, done) => {
          updateLastAssistant((prev) => ({ role: 'assistant', text: prev.text + delta }));
          if (done) setSending(false);
        },
        context,
      );
    } catch (e) {
      updateLastAssistant((prev) => ({
        role: 'assistant',
        // 仅在占位为空时覆盖，避免抹去已流式累加的部分文本
        text: prev.text === '' ? `发送失败：${(e as Error).message}` : prev.text,
      }));
      setSending(false);
    }
  }, [
    input,
    sending,
    apiKey,
    setInput,
    setMessages,
    setSending,
    updateLastAssistant,
    generatorType,
    description,
    spec,
  ]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        send();
      }
    },
    [send],
  );

  return (
    <div className="flex h-full flex-col">
      {/* 标题栏 */}
      <div className="flex items-center gap-2 border-b border-mc-border px-3 py-2">
        <Bot className="h-4 w-4 text-mc-accent" aria-hidden="true" />
        <span className="text-sm font-medium text-mc-text">AI 助手</span>
        {/* P11.4 项目类型徽章：让 chat 模式感知当前生成器类型 */}
        {generatorType && GENERATOR_LABELS[generatorType] && (
          <span
            className="rounded-mc bg-mc-surface-2 px-1.5 py-0.5 text-[10px] text-mc-dim"
            title={`当前项目类型：${GENERATOR_LABELS[generatorType]}`}
          >
            {GENERATOR_LABELS[generatorType]}
          </span>
        )}
        <button
          type="button"
          onClick={clearHistory}
          className="mc-btn-ghost ml-auto !px-1 !py-0.5"
          title="清空对话"
          aria-label="清空对话"
        >
          <Trash2 className="h-3 w-3" aria-hidden="true" />
        </button>
      </div>

      {/* 消息列表 */}
      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-3 py-2">
        {messages.map((m, i) => {
          const isUser = m.role === 'user';
          const isWaiting =
            m.text === '' && sending && i === messages.length - 1 && m.role === 'assistant';
          return (
            <div key={i} className={`flex gap-2 ${isUser ? 'flex-row-reverse' : ''}`}>
              {/* 头像 */}
              <div
                className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-mc ${
                  isUser ? 'bg-mc-accent/20' : 'bg-mc-surface-2'
                }`}
                aria-hidden="true"
              >
                {isUser ? (
                  <User className="h-3 w-3 text-mc-accent" />
                ) : (
                  <Bot className="h-3 w-3 text-mc-text" />
                )}
              </div>
              {/* 消息内容 */}
              <div
                className={`max-w-[80%] rounded-mc px-3 py-2 text-xs ${
                  isUser ? 'bg-mc-accent/10 text-mc-text' : 'bg-mc-surface-2 text-mc-text'
                }`}
              >
                {isWaiting ? (
                  <span
                    className="flex items-center gap-1 text-mc-mute"
                    role="status"
                    aria-live="polite"
                  >
                    <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                    思考中...
                  </span>
                ) : (
                  // 支持简单的 Markdown 代码块（```...```）
                  <div className="whitespace-pre-wrap break-words">
                    {m.text.split('```').map((segment, j) =>
                      j % 2 === 0 ? (
                        <span key={j}>{segment}</span>
                      ) : (
                        <pre
                          key={j}
                          className="my-1 overflow-x-auto rounded-mc bg-mc-bg p-2 font-mono text-[11px]"
                        >
                          {segment}
                        </pre>
                      ),
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* 输入框 */}
      <div className="border-t border-mc-border px-3 py-2">
        <div className="flex gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={apiKey ? '输入消息，Enter 发送，Shift+Enter 换行…' : '请先配置 API Key'}
            rows={2}
            disabled={sending || !apiKey}
            aria-label="AI 助手输入框"
            className="flex-1 resize-none rounded-mc bg-mc-surface-2 px-2 py-1 text-xs text-mc-text outline-none placeholder:text-mc-mute disabled:opacity-50"
          />
          <button
            type="button"
            onClick={send}
            disabled={!input.trim() || sending || !apiKey}
            className="mc-btn-primary self-end"
            aria-label="发送消息"
          >
            <Send className="h-3 w-3" aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  );
}
