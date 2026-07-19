import { useState, useEffect, useRef, useCallback } from 'react';
import { Terminal as TerminalIcon, Plus, X, ChevronUp, ChevronDown } from 'lucide-react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { ipcClient } from '../lib/ipc-client.js';

interface TerminalInstance {
  pid: number;
  title: string;
  term: Terminal;
  fitAddon: FitAddon;
  divRef: HTMLDivElement;
  exited: boolean;
}

/**
 * 集成终端面板（xterm.js + node-pty）：底部可折叠面板，支持多个终端实例。
 * - 主进程 PTY spawn → IPC terminal:data → xterm 写入
 * - xterm onData → IPC terminal:write → 主进程 PTY 写入
 * - 面板 resize → FitAddon + IPC terminal:resize → 主进程 PTY resize
 */
export function TerminalPanel() {
  const [terminals, setTerminals] = useState<TerminalInstance[]>([]);
  const [activeIdx, setActiveIdx] = useState(0);
  const [collapsed, setCollapsed] = useState(true);
  const panelRef = useRef<HTMLDivElement>(null);

  // 监听主进程终端数据
  useEffect(() => {
    const onData = (_event: unknown, data: { pid: number; data: string }) => {
      setTerminals((prev) => {
        const t = prev.find((inst) => inst.pid === data.pid);
        if (t && !t.exited) t.term.write(data.data);
        return prev;
      });
    };
    const onExit = (_event: unknown, data: { pid: number; exitCode: number }) => {
      setTerminals((prev) => {
        const t = prev.find((inst) => inst.pid === data.pid);
        if (t) {
          t.term.write(`\r\n\x1b[90m[进程退出，代码: ${data.exitCode}]\x1b[0m\r\n`);
          // 标记退出：通过 mutation 更新 exited 标志，需返回新数组触发重渲染
          (t as TerminalInstance & { exited: boolean }).exited = true;
        }
        return [...prev];
      });
    };
    const mcApi = (
      window as unknown as {
        mcApi?: {
          onTerminalData?: (cb: typeof onData) => () => void;
          onTerminalExit?: (cb: typeof onExit) => () => void;
        };
      }
    ).mcApi;
    const removeData = mcApi?.onTerminalData?.(onData);
    const removeExit = mcApi?.onTerminalExit?.(onExit);
    return () => {
      removeData?.();
      removeExit?.();
    };
  }, []);

  // 活跃终端的 xterm 渲染容器
  const xtermContainerRef = useRef<HTMLDivElement>(null);

  // 将活跃终端的 xterm 挂载到 DOM
  useEffect(() => {
    const container = xtermContainerRef.current;
    const t = terminals[activeIdx];
    if (!container || !t) return;
    // 清空容器
    while (container.firstChild) container.removeChild(container.firstChild);
    container.appendChild(t.divRef);
    // 延迟 fit 确保尺寸正确
    requestAnimationFrame(() => {
      try {
        t.fitAddon.fit();
      } catch {
        /* xterm 尚未就绪时 fit 可能抛异常 */
      }
    });
  }, [terminals, activeIdx]);

  // 面板 resize 时同步 fit + PTY resize
  useEffect(() => {
    const t = terminals[activeIdx];
    if (!t || collapsed) return;
    const observer = new ResizeObserver(() => {
      try {
        t.fitAddon.fit();
        const { cols, rows } = t.term;
        ipcClient.terminalResize(t.pid, cols, rows).catch(() => {});
      } catch {
        /* ResizeObserver 回调中 fit 或 resize 可能抛异常 */
      }
    });
    if (panelRef.current) observer.observe(panelRef.current);
    return () => observer.disconnect();
  }, [terminals, activeIdx, collapsed]);

  const spawnTerminal = useCallback(async () => {
    try {
      const res = await ipcClient.terminalSpawn({ cols: 120, rows: 24 });
      const term = new Terminal({
        cols: 120,
        rows: 24,
        fontSize: 13,
        fontFamily: "'Cascadia Code', 'Fira Code', Consolas, monospace",
        cursorBlink: true,
        cursorStyle: 'block',
        theme: {
          background: '#1e1e2e',
          foreground: '#cdd6f4',
          cursor: '#f5e0dc',
          selectionBackground: '#585b7066',
          black: '#45475a',
          red: '#f38ba8',
          green: '#a6e3a1',
          yellow: '#f9e2af',
          blue: '#89b4fa',
          magenta: '#f5c2e7',
          cyan: '#94e2d5',
          white: '#bac2de',
          brightBlack: '#585b70',
          brightRed: '#f38ba8',
          brightGreen: '#a6e3a1',
          brightYellow: '#f9e2af',
          brightBlue: '#89b4fa',
          brightMagenta: '#f5c2e7',
          brightCyan: '#94e2d5',
          brightWhite: '#a6adc8',
        },
      });
      const fitAddon = new FitAddon();
      term.loadAddon(fitAddon);
      const divRef = document.createElement('div');
      divRef.style.width = '100%';
      divRef.style.height = '100%';
      term.open(divRef);

      // xterm 输入 → PTY（保存 disposer 供后续清理）
      const _disposer = term.onData((data) => {
        ipcClient.terminalWrite(res.pid, data).catch(() => {});
      });

      const newInstance: TerminalInstance = {
        pid: res.pid,
        title: `终端 ${res.pid}`,
        term,
        fitAddon,
        divRef,
        exited: false,
      };
      setTerminals((prev) => [...prev, newInstance]);
      setActiveIdx(terminals.length);
      setCollapsed(false);
    } catch {
      // PTY 不可用时回退
      const fallbackTerm = new Terminal({ cols: 80, rows: 24, fontSize: 13, cursorBlink: true });
      const fallbackFit = new FitAddon();
      fallbackTerm.loadAddon(fallbackFit);
      const divRef = document.createElement('div');
      divRef.style.width = '100%';
      divRef.style.height = '100%';
      fallbackTerm.open(divRef);
      fallbackTerm.write('\x1b[90mPTY 不可用，使用简易模式。\r\n输入命令后按回车执行。\x1b[0m\r\n');

      const fallbackInstance: TerminalInstance = {
        pid: Date.now(),
        title: '终端 (简易)',
        term: fallbackTerm,
        fitAddon: fallbackFit,
        divRef,
        exited: true,
      };
      setTerminals((prev) => [...prev, fallbackInstance]);
      setActiveIdx(terminals.length);
      setCollapsed(false);
    }
  }, [terminals.length]);

  const killTerminal = useCallback(
    async (idx: number) => {
      const t = terminals[idx];
      if (t) {
        try {
          await ipcClient.terminalKill(t.pid);
        } catch {
          /* PTY 可能已退出 */
        }
        t.term.dispose();
      }
      setTerminals((prev) => prev.filter((_, i) => i !== idx));
      setActiveIdx((prev) => {
        if (idx < prev) return prev - 1;
        if (idx === prev) return Math.min(prev, terminals.length - 2);
        return prev;
      });
    },
    [terminals],
  );

  if (collapsed) {
    return (
      <div className="flex items-center border-t border-mc-border bg-mc-surface px-2 py-1">
        <TerminalIcon className="h-3 w-3 text-mc-mute" />
        <span className="ml-2 text-xs text-mc-dim">
          {terminals.length > 0 ? `${terminals.length} 个终端` : '终端'}
        </span>
        <button
          onClick={() => {
            if (terminals.length === 0) spawnTerminal();
            else setCollapsed(false);
          }}
          className="ml-auto mc-btn-ghost !px-1.5 !py-0.5"
          title="展开终端"
        >
          <ChevronUp className="h-3 w-3" />
        </button>
      </div>
    );
  }

  return (
    <div
      ref={panelRef}
      className="flex flex-col border-t border-mc-border bg-mc-bg"
      style={{ height: 220 }}
    >
      {/* 标题栏 */}
      <div className="flex items-center border-b border-mc-border bg-mc-surface px-1 py-1">
        {terminals.map((t, i) => (
          <button
            key={t.pid}
            onClick={() => setActiveIdx(i)}
            className={`flex items-center gap-1 rounded-mc px-2 py-0.5 text-xs transition-colors ${
              i === activeIdx
                ? 'bg-mc-surface-2 text-mc-text'
                : 'text-mc-dim hover:bg-mc-surface-2/60 hover:text-mc-text'
            }`}
          >
            <TerminalIcon className="h-3 w-3" />
            <span className="max-w-24 truncate">{t.title}</span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                killTerminal(i);
              }}
              className="rounded-mc p-0.5 text-mc-mute hover:text-mc-text"
            >
              <X className="h-2.5 w-2.5" />
            </button>
          </button>
        ))}
        <button
          onClick={spawnTerminal}
          className="ml-1 rounded-mc p-0.5 text-mc-mute hover:bg-mc-surface-2 hover:text-mc-text"
          title="新建终端"
        >
          <Plus className="h-3 w-3" />
        </button>
        <button
          onClick={() => setCollapsed(true)}
          className="ml-auto mc-btn-ghost !px-1.5 !py-0.5"
          title="折叠终端"
        >
          <ChevronDown className="h-3 w-3" />
        </button>
      </div>

      {/* xterm 渲染区域 */}
      <div ref={xtermContainerRef} className="flex-1 overflow-hidden" style={{ padding: 4 }} />
    </div>
  );
}
