import { useState, useRef } from 'react';
import { ipcClient } from '../lib/ipc-client.js';
import { useModelConfigStore } from '../store/model-config-store.js';
import { Send } from 'lucide-react';

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
    setMessages((m) => [...m, { role: 'user', text }, { role: 'assistant', text: '' }]);
    setSending(true);

    if (!apiKey) {
      setMessages((m) => {
        const next = [...m];
        next[next.length - 1] = { role: 'assistant', text: '请先在「设置」中配置 API Key。' };
        return next;
      });
      setSending(false);
      return;
    }

    try {
      await ipcClient.chatStream(text, (delta, done) => {
        setMessages((m) => {
          const next = [...m];
          const last = next[next.length - 1];
          if (last.role === 'assistant') {
            next[next.length - 1] = { role: 'assistant', text: last.text + delta };
          }
          return next;
        });
        if (done) {
          setSending(false);
          bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
        }
      });
    } catch (e) {
      // P23-1：invoke 失败时给用户可见反馈，避免永久卡在「思考中…」
      setMessages((m) => {
        const next = [...m];
        const last = next[next.length - 1];
        if (last.role === 'assistant' && last.text === '') {
          next[next.length - 1] = { role: 'assistant', text: `发送失败：${(e as Error).message}` };
        }
        return next;
      });
      setSending(false);
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
            {m.role === 'assistant' && sending && i === messages.length - 1 && m.text === '' && (
              <span className="animate-pulse text-zinc-500">思考中…</span>
            )}
            {m.role === 'assistant' && sending && i === messages.length - 1 && m.text !== '' && (
              <span className="inline-block w-1 h-3 bg-zinc-400 animate-pulse ml-0.5" />
            )}
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
          className="flex items-center gap-1.5 rounded bg-blue-600 px-3 py-1 text-xs text-white disabled:opacity-50"
        >
          {sending ? '…' : <><Send className="h-3 w-3" /> 发送</>}
        </button>
      </div>
    </div>
  );
}
