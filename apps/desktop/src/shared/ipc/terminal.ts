import { z } from 'zod';

// === 终端（主进程 PTY 桥接，渲染进程仅展示）===
export const TERMINAL_SPAWN = 'terminal:spawn';

export const TERMINAL_DATA = 'terminal:data';
export const TERMINAL_EXIT = 'terminal:exit';
export const TERMINAL_WRITE = 'terminal:write';
export const TERMINAL_RESIZE = 'terminal:resize';
export const TERMINAL_KILL = 'terminal:kill';

export const TerminalSpawnRequest = z.object({
  shell: z.string().optional(),
  cwd: z.string().optional(),
  cols: z.number().default(80),
  rows: z.number().default(24),
});
export const TerminalSpawnResponse = z.object({
  pid: z.number(),
});
export type TerminalSpawnReq = z.infer<typeof TerminalSpawnRequest>;
export type TerminalSpawnRes = z.infer<typeof TerminalSpawnResponse>;

export const TerminalWriteRequest = z.object({
  pid: z.number(),
  data: z.string(),
});
export const TerminalResizeRequest = z.object({
  pid: z.number(),
  cols: z.number(),
  rows: z.number(),
});
export const TerminalKillRequest = z.object({
  pid: z.number(),
});
