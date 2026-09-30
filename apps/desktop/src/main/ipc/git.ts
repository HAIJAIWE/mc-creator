/* Phase 3.1 拆分：由 ../ipc.ts 纯搬运，零行为变更。通道名与逻辑保持原样。*/
import { ipcMain, dialog } from 'electron';
import { spawn } from 'node:child_process';
import { z } from 'zod';
import { parseGitStatus } from '../ipc-utils.js';
import {
  GIT_CHOOSE_REPO,
  GIT_STATUS,
  GIT_LOG,
  GIT_COMMIT,
  GIT_PULL,
  GIT_PUSH,
  GIT_BRANCH_LIST,
  GIT_BRANCH_CREATE,
  GIT_BRANCH_SWITCH,
  GIT_ADD,
  GIT_RESET,
  GIT_DIFF,
  GitStatusRequest,
  GitLogRequest,
  GitCommitRequest,
  GitPullRequest,
  GitPushRequest,
  type GitChooseRepoRes,
  type GitStatusRes,
  type GitLogRes,
  type GitCommitRes,
  type GitSyncRes,
} from '../../shared/ipc-channels.js';

export function registerGitHandlers(): void {
  // === 源代码管理（Git 桥接）：主进程跑 git，渲染进程只展示 ===
  const runGit = (args: string[], cwd: string) =>
    new Promise<{ code: number; stdout: string; stderr: string }>((resolve) => {
      const child = spawn('git', args, { cwd });
      let stdout = '';
      let stderr = '';
      child.stdout?.on('data', (d) => (stdout += d.toString()));
      child.stderr?.on('data', (d) => (stderr += d.toString()));
      child.on('error', (err) => {
        stderr += err.message;
        resolve({ code: -1, stdout, stderr });
      });
      child.on('close', (code) => resolve({ code: code ?? -1, stdout, stderr }));
    });

  // parseGitStatus 已提取到模块级（见文件顶部），便于单测

  ipcMain.handle(GIT_CHOOSE_REPO, async (): Promise<GitChooseRepoRes> => {
    const result = await dialog.showOpenDialog({ properties: ['openDirectory'] });
    if (result.canceled || result.filePaths.length === 0) return { path: null };
    return { path: result.filePaths[0] };
  });

  ipcMain.handle(GIT_STATUS, async (_e, raw: unknown): Promise<GitStatusRes> => {
    const { repoPath } = GitStatusRequest.parse(raw);
    const { code, stdout, stderr } = await runGit(['status', '--porcelain', '-b'], repoPath);
    if (code !== 0) {
      return {
        ok: false,
        branch: null,
        upstream: null,
        ahead: 0,
        behind: 0,
        clean: true,
        files: [],
        error: stderr || '无法读取仓库状态（可能不是 git 仓库或 git 未安装）',
      };
    }
    return { ok: true, ...parseGitStatus(stdout), error: null };
  });

  ipcMain.handle(GIT_LOG, async (_e, raw: unknown): Promise<GitLogRes> => {
    const { repoPath, limit } = GitLogRequest.parse(raw);
    const { code, stdout, stderr } = await runGit(
      ['log', `-n${limit}`, '--pretty=format:%H%x1f%h%x1f%s%x1f%an%x1f%ad', '--date=short'],
      repoPath,
    );
    if (code !== 0) {
      return { ok: false, commits: [], error: stderr || '无法读取提交历史' };
    }
    const commits = stdout
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [hash, shortHash, message, author, date] = line.split('\x1f');
        return { hash, shortHash, message, author, date };
      });
    return { ok: true, commits, error: null };
  });

  ipcMain.handle(GIT_COMMIT, async (_e, raw: unknown): Promise<GitCommitRes> => {
    const { repoPath, message, all } = GitCommitRequest.parse(raw);
    if (all) {
      const add = await runGit(['add', '-A'], repoPath);
      if (add.code !== 0) return { ok: false, error: add.stderr || 'git add 失败' };
    }
    const { code, stderr } = await runGit(['commit', '-m', message], repoPath);
    if (code !== 0) return { ok: false, error: stderr || '提交失败（可能无改动）' };
    const head = await runGit(['rev-parse', 'HEAD'], repoPath);
    return { ok: true, hash: head.code === 0 ? head.stdout.trim() : null, error: null };
  });

  ipcMain.handle(GIT_PULL, async (_e, raw: unknown): Promise<GitSyncRes> => {
    const { repoPath } = GitPullRequest.parse(raw);
    const { code, stdout, stderr } = await runGit(['pull'], repoPath);
    return { ok: code === 0, stdout, error: code === 0 ? null : stderr || '拉取失败' };
  });

  ipcMain.handle(GIT_PUSH, async (_e, raw: unknown): Promise<GitSyncRes> => {
    const { repoPath } = GitPushRequest.parse(raw);
    const { code, stdout, stderr } = await runGit(['push'], repoPath);
    return {
      ok: code === 0,
      stdout,
      error: code === 0 ? null : stderr || '推送失败（可能无 upstream 或需先拉取）',
    };
  });

  // === Git 增强：分支管理 + 暂存区 + Diff ===
  ipcMain.handle(GIT_BRANCH_LIST, async (_e, raw: unknown) => {
    const { repoPath } = z.object({ repoPath: z.string().min(1) }).parse(raw);
    const { code, stdout, stderr } = await runGit(
      ['branch', '--list', '--format=%(refname:short)%00%(HEAD)'],
      repoPath,
    );
    if (code !== 0) return { ok: false, branches: [], error: stderr || '获取分支列表失败' };
    const branches = stdout
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [name, head] = line.split('\0');
        return { name, current: head === '*' };
      });
    return { ok: true, branches, error: null };
  });

  ipcMain.handle(GIT_BRANCH_CREATE, async (_e, raw: unknown) => {
    const { repoPath, name } = z
      .object({ repoPath: z.string().min(1), name: z.string().min(1) })
      .parse(raw);
    const { code, stderr } = await runGit(['checkout', '-b', name], repoPath);
    if (code !== 0) return { ok: false, error: stderr || '创建分支失败' };
    return { ok: true, error: null };
  });

  ipcMain.handle(GIT_BRANCH_SWITCH, async (_e, raw: unknown) => {
    const { repoPath, name } = z
      .object({ repoPath: z.string().min(1), name: z.string().min(1) })
      .parse(raw);
    const { code, stderr } = await runGit(['checkout', name], repoPath);
    if (code !== 0) return { ok: false, error: stderr || '切换分支失败' };
    return { ok: true, error: null };
  });

  ipcMain.handle(GIT_ADD, async (_e, raw: unknown) => {
    const { repoPath, paths } = z
      .object({ repoPath: z.string().min(1), paths: z.array(z.string()) })
      .parse(raw);
    // 拒绝以 - 开头的路径（防止被 git 解释为选项，构成命令注入）
    const dangerous = paths.filter((p) => p.startsWith('-'));
    if (dangerous.length > 0) return { ok: false, error: `非法路径: ${dangerous.join(', ')}` };
    // -- 告诉 git 后续参数均为路径，不会被解释为选项
    const { code, stderr } = await runGit(['add', '--', ...paths], repoPath);
    if (code !== 0) return { ok: false, error: stderr || '暂存失败' };
    return { ok: true, error: null };
  });

  ipcMain.handle(GIT_RESET, async (_e, raw: unknown) => {
    const { repoPath, paths } = z
      .object({ repoPath: z.string().min(1), paths: z.array(z.string()) })
      .parse(raw);
    const { code, stderr } = await runGit(['reset', 'HEAD', '--', ...paths], repoPath);
    if (code !== 0) return { ok: false, error: stderr || '取消暂存失败' };
    return { ok: true, error: null };
  });

  ipcMain.handle(GIT_DIFF, async (_e, raw: unknown) => {
    const { repoPath, path, staged } = z
      .object({
        repoPath: z.string().min(1),
        path: z.string().min(1),
        staged: z.boolean().optional(),
      })
      .parse(raw);
    const args = staged ? ['diff', '--cached', '--', path] : ['diff', '--', path];
    const { code, stdout, stderr } = await runGit(args, repoPath);
    if (code !== 0) return { ok: false, diff: '', error: stderr || '获取差异失败' };
    return { ok: true, diff: stdout, error: null };
  });
}
