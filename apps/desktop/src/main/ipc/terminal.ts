/* Phase 3.1 拆分：由 ../ipc.ts 纯搬运，零行为变更。通道名与逻辑保持原样。*/
import { ipcMain, app } from 'electron';
import { z } from 'zod';
import {
  TERMINAL_SPAWN,
  TERMINAL_DATA,
  TERMINAL_EXIT,
  TERMINAL_WRITE,
  TERMINAL_RESIZE,
  TERMINAL_KILL,
} from '../../shared/ipc-channels.js';

/** node-pty 类型 */
interface IPty {
  pid: number;
  onData(callback: (data: string) => void): void;
  onExit(callback: (info: { exitCode: number }) => void): void;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(): void;
}

interface IPtySpawnOptions {
  name?: string;
  cols: number;
  rows: number;
  cwd: string;
  env: Record<string, string>;
  encoding?: string;
  handleFlowControl?: boolean;
}

/** 可选依赖能力探测（Task 1.2） */
let ptySpawn: ((file: string, args: string[], options: IPtySpawnOptions) => IPty) | null = null;
let ptyAvailable = false;
try {
  // 主进程打包为 CJS，不支持顶层 await：同步 require 做可选依赖探测即可
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require('node-pty') as {
    spawn?: (file: string, args: string[], options: IPtySpawnOptions) => IPty;
    default?: { spawn?: (file: string, args: string[], options: IPtySpawnOptions) => IPty };
  };
  ptySpawn = mod.spawn ?? mod.default?.spawn ?? null;
  ptyAvailable = !!ptySpawn;
} catch {
  ptyAvailable = false;
}

export function registerTerminalHandlers(): void {
  if (!ptyAvailable || !ptySpawn) {
    // 友好错误响应：缺 node-pty 时返回结构化错误而非崩溃
    const notAvailable = {
      ok: false as const,
      error: '终端组件未安装（可选组件 node-pty 缺失），不影响生成/构建',
    };
    ipcMain.handle(TERMINAL_SPAWN, async () => notAvailable);
    ipcMain.handle(TERMINAL_WRITE, async () => notAvailable);
    ipcMain.handle(TERMINAL_RESIZE, async () => notAvailable);
    ipcMain.handle(TERMINAL_KILL, async () => notAvailable);
    return;
  }
  // === 终端（PTY 桥接）：渲染进程 ↔ 主进程 PTY ↔ 真实 shell ===
  const ptySessions = new Map<number, IPty>();

  ipcMain.handle(TERMINAL_SPAWN, async (e, raw: unknown) => {
    const req = z
      .object({
        shell: z.string().optional(),
        cwd: z.string().optional(),
        cols: z.number().default(80),
        rows: z.number().default(24),
      })
      .parse(raw);

    const shell = req.shell || (process.platform === 'win32' ? 'powershell.exe' : 'bash');
    const cwd = req.cwd || app.getPath('home');
    const ptyProcess = ptySpawn(shell, [], {
      name: 'xterm-256color',
      cols: req.cols,
      rows: req.rows,
      cwd,
      env: process.env as Record<string, string>,
    });

    const pid = ptyProcess.pid;
    ptySessions.set(pid, ptyProcess);

    // PTY 输出 → 渲染进程
    ptyProcess.onData((data: string) => {
      e.sender.send(TERMINAL_DATA, { pid, data });
    });

    ptyProcess.onExit(({ exitCode }: { exitCode: number }) => {
      e.sender.send(TERMINAL_EXIT, { pid, exitCode });
      ptySessions.delete(pid);
    });

    return { pid };
  });

  ipcMain.handle(TERMINAL_WRITE, async (_e, raw: unknown) => {
    const { pid, data } = z.object({ pid: z.number(), data: z.string() }).parse(raw);
    const pty = ptySessions.get(pid);
    if (pty) pty.write(data);
  });

  ipcMain.handle(TERMINAL_RESIZE, async (_e, raw: unknown) => {
    const { pid, cols, rows } = z
      .object({ pid: z.number(), cols: z.number(), rows: z.number() })
      .parse(raw);
    const pty = ptySessions.get(pid);
    if (pty) pty.resize(cols, rows);
  });

  ipcMain.handle(TERMINAL_KILL, async (_e, raw: unknown) => {
    const { pid } = z.object({ pid: z.number() }).parse(raw);
    const pty = ptySessions.get(pid);
    if (pty) {
      pty.kill();
      ptySessions.delete(pid);
    }
  });

  // PTY 会话退出清理：应用关闭时 kill 所有活跃 PTY
  app.on('before-quit', () => {
    for (const [pid, pty] of ptySessions) {
      try {
        pty.kill();
      } catch {
        /* PTY 可能已退出 */
      }
      ptySessions.delete(pid);
    }
  });
}
