import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useChatStore } from './chat-store.js';

// 在 import chat-store 之前注入 localStorage，让 persist 走真实 storage 路径
vi.hoisted(() => {
  const mem = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => void mem.set(k, v),
    removeItem: (k: string) => void mem.delete(k),
    clear: () => mem.clear(),
    key: () => null,
    length: 0,
  };
});

describe('chat-store 初始化', () => {
  it('初始包含欢迎消息', () => {
    const { messages } = useChatStore.getState();
    expect(messages.length).toBe(1);
    expect(messages[0].role).toBe('assistant');
    expect(messages[0].text).toContain('你好');
  });
});

describe('chat-store 行为', () => {
  beforeEach(() => {
    localStorage.clear();
    useChatStore.getState().clearHistory();
  });

  it('appendMessage 追加消息', () => {
    useChatStore.getState().appendMessage({ role: 'user', text: '加一把剑' });
    const { messages } = useChatStore.getState();
    expect(messages.length).toBe(2);
    expect(messages[1]).toEqual({ role: 'user', text: '加一把剑' });
  });

  it('updateLastAssistant 仅更新最后一条 assistant 消息', () => {
    useChatStore.getState().appendMessage({ role: 'assistant', text: 'a' });
    useChatStore.getState().appendMessage({ role: 'user', text: 'b' });
    useChatStore.getState().appendMessage({ role: 'assistant', text: 'c' });
    useChatStore.getState().updateLastAssistant((m) => ({ ...m, text: m.text + 'd' }));
    const { messages } = useChatStore.getState();
    expect(messages[messages.length - 1].text).toBe('cd');
    expect(messages[1].text).toBe('a'); // 不是最后一条 assistant 时不动
  });

  it('updateLastAssistant 末条非 assistant 时不修改', () => {
    useChatStore.getState().appendMessage({ role: 'user', text: 'b' });
    useChatStore.getState().updateLastAssistant((m) => ({ ...m, text: 'x' }));
    const { messages } = useChatStore.getState();
    expect(messages[messages.length - 1].text).toBe('b');
  });

  it('setMessages 支持函数式更新', () => {
    useChatStore.getState().setMessages((prev) => [...prev, { role: 'user', text: 'x' }]);
    expect(useChatStore.getState().messages.length).toBe(2);
  });

  it('clearHistory 重置为清空提示并复位 sending', () => {
    useChatStore.getState().setSending(true);
    useChatStore.getState().clearHistory();
    const s = useChatStore.getState();
    expect(s.messages).toHaveLength(1);
    expect(s.messages[0].text).toContain('已清空');
    expect(s.sending).toBe(false);
    expect(s.input).toBe('');
  });

  it('对话历史持久化到 localStorage', () => {
    useChatStore.getState().appendMessage({ role: 'user', text: '做一个附魔' });
    const raw = localStorage.getItem('mc-creator-chat-state');
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw!) as { state: Record<string, unknown> };
    expect(parsed.state.messages).toHaveLength(2);
    expect((parsed.state.messages as Array<{ role: string; text: string }>)[1].text).toBe(
      '做一个附魔',
    );
    // 不持久化输入框/发送状态
    expect(parsed.state.input).toBeUndefined();
    expect(parsed.state.sending).toBeUndefined();
  });
});
