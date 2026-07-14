import { useState, useRef } from 'react';
import { ipcClient } from '../lib/ipc-client.js';
import { useModelConfigStore } from '../store/model-config-store.js';

interface Msg { role: 'user' | 'assistant'; text: string }

export function AiChat() {
  const { apiKey } = useModelConfigStore();
  const [messages, setMessages] = useState<Msg[]>([
    { role: 'assistant', text: '你好！描述你想要的 mod，我来帮你生成。' },
  ]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const send = async () => {
    if (!input.trim() || sending) return;
    const text = input;
    setInput('');
    setMessages((m) => [...m, { role: 'user', text }]);
    setSending(true);

    try {
      if (!apiKey) {
        setMessages((m) => [...m, { role: 'assistant', text: '请先在「设置」中配置 API Key。' }]);
        return;
      }
      const res = await ipcClient.chat(text);
      setMessages((m) => [...m, { role: 'assistant', text: (res as any).reply }]);
    } catch (e) {
      setMessages((m) => [...m, { role: 'assistant', text: `错误：${(e as Error).message}` }]);
    } finally {
      setSending(false);
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-zinc-800 p-2 text-xs font-semibold text-zinc-400">AI 助手</div>
      <div className="flex-1 space-y-2 overflow-y-auto p-3">
        {messages.map((m, i) => (
          <div key={i} className={`rounded p-2 text-xs whitespace-pre-wrap ${
            m.role === 'user' ? 'bg-blue-900/40' : 'bg-zinc-800'
          }`}>
            {m.text}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
      <div className="flex gap-2 border-t border-zinc-800 p-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && send()}
          placeholder={apiKey ? '输入消息…' : '请先配置 API Key'}
          className="flex-1 rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-100"
          disabled={sending}
        />
        <button
          onClick={send}
          disabled={sending || !input.trim()}
          className="rounded bg-blue-600 px-3 py-1 text-xs text-white disabled:opacity-50"
        >
          发送
        </button>
      </div>
    </div>
  );
}
