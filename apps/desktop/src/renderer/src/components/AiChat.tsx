import { useState } from 'react';

interface Msg { role: 'user' | 'assistant'; text: string }

export function AiChat() {
  const [messages, setMessages] = useState<Msg[]>([
    { role: 'assistant', text: '你好！描述你想要的 mod，我来帮你生成。' },
  ]);
  const [input, setInput] = useState('');

  const send = () => {
    if (!input.trim()) return;
    setMessages((m) => [...m, { role: 'user', text: input }]);
    setInput('');
    // P4 接真实 AI 流式响应
    setMessages((m) => [...m, { role: 'assistant', text: '（P3 阶段用 Mock，P4 接真实模型流式响应）' }]);
  };

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-zinc-800 p-2 text-xs font-semibold text-zinc-400">AI 助手</div>
      <div className="flex-1 space-y-2 overflow-y-auto p-3">
        {messages.map((m, i) => (
          <div key={i} className={`rounded p-2 text-xs ${m.role === 'user' ? 'bg-blue-900/40' : 'bg-zinc-800'}`}>
            {m.text}
          </div>
        ))}
      </div>
      <div className="flex gap-2 border-t border-zinc-800 p-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && send()}
          placeholder="输入消息…"
          className="flex-1 rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-100"
        />
        <button onClick={send} className="rounded bg-blue-600 px-3 py-1 text-xs text-white">发送</button>
      </div>
    </div>
  );
}
