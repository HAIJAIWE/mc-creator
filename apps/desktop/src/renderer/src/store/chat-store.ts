import { createWithEqualityFn } from 'zustand/traditional';

/**
 * ChatStore：管理 AI 助手 chat 模式的对话状态。
 *
 * 设计目的：让 chat 模式切换到 agent 模式再切回时，对话历史不丢失。
 * 原本 ChatPanel 内部 useState 在组件卸载（切到 agent 模式）时会清空，
 * 提升到 store 后状态独立于组件生命周期。
 */

export interface ChatMessage {
  role: 'user' | 'assistant';
  text: string;
}

interface ChatState {
  messages: ChatMessage[];
  input: string;
  sending: boolean;

  /** 直接替换整个 messages 数组 */
  setMessages: (messages: ChatMessage[] | ((prev: ChatMessage[]) => ChatMessage[])) => void;
  /** 设置输入框文本 */
  setInput: (input: string) => void;
  /** 设置 sending 状态（流式响应中） */
  setSending: (sending: boolean) => void;
  /** 追加一条消息 */
  appendMessage: (msg: ChatMessage) => void;
  /** 更新最后一条 assistant 消息（流式累加 delta） */
  updateLastAssistant: (updater: (prev: ChatMessage) => ChatMessage) => void;
  /** 清空对话，重置为初始欢迎消息 */
  clearHistory: () => void;
}

const INITIAL_MESSAGES: ChatMessage[] = [
  { role: 'assistant', text: '你好！描述你想要的 mod，我来帮你生成。' },
];

const CLEARED_MESSAGES: ChatMessage[] = [
  { role: 'assistant', text: '对话已清空。有什么可以帮你的？' },
];

export const useChatStore = createWithEqualityFn<ChatState>((set) => ({
  messages: INITIAL_MESSAGES,
  input: '',
  sending: false,

  setMessages: (updater) =>
    set((state) => ({
      messages: typeof updater === 'function' ? updater(state.messages) : updater,
    })),

  setInput: (input) => set({ input }),

  setSending: (sending) => set({ sending }),

  appendMessage: (msg) => set((state) => ({ messages: [...state.messages, msg] })),

  updateLastAssistant: (updater) =>
    set((state) => {
      const next = [...state.messages];
      const last = next[next.length - 1];
      if (last && last.role === 'assistant') {
        next[next.length - 1] = updater(last);
      }
      return { messages: next };
    }),

  clearHistory: () => set({ messages: CLEARED_MESSAGES, input: '', sending: false }),
}));
