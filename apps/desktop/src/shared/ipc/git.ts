import { z } from 'zod';

// === 源代码管理（Git 桥接：主进程跑 git，渲染进程只展示）===
export const GIT_CHOOSE_REPO = 'git:chooseRepo';
export const GIT_STATUS = 'git:status';
export const GIT_LOG = 'git:log';
export const GIT_COMMIT = 'git:commit';
export const GIT_PULL = 'git:pull';
export const GIT_PUSH = 'git:push';
export const GIT_BRANCH_LIST = 'git:branchList';
export const GIT_BRANCH_CREATE = 'git:branchCreate';
export const GIT_BRANCH_SWITCH = 'git:branchSwitch';
export const GIT_ADD = 'git:add';
export const GIT_RESET = 'git:reset';
export const GIT_DIFF = 'git:diff';

export const GitChooseRepoResponse = z.object({
  path: z.string().nullable(),
});
export type GitChooseRepoRes = z.infer<typeof GitChooseRepoResponse>;

export const GitStatusRequest = z.object({ repoPath: z.string().min(1) });
export const GitFileStatus = z.object({
  // X = 暂存区状态, Y = 工作区状态（来自 git status --porcelain 的两字母码）
  x: z.string(),
  y: z.string(),
  path: z.string(),
  // 重命名/复制的原始路径（如有）
  origPath: z.string().optional(),
});
export const GitStatusResponse = z.object({
  ok: z.boolean(),
  branch: z.string().nullable(),
  upstream: z.string().nullable(),
  ahead: z.number().default(0),
  behind: z.number().default(0),
  clean: z.boolean().default(true),
  files: z.array(GitFileStatus).default([]),
  error: z.string().nullable().optional(),
});
export type GitStatusReq = z.infer<typeof GitStatusRequest>;
export type GitStatusRes = z.infer<typeof GitStatusResponse>;

export const GitLogRequest = z.object({
  repoPath: z.string().min(1),
  limit: z.number().int().min(1).max(100).default(20),
});
export const GitCommitEntry = z.object({
  hash: z.string(),
  shortHash: z.string(),
  message: z.string(),
  author: z.string(),
  date: z.string(),
});
export const GitLogResponse = z.object({
  ok: z.boolean(),
  commits: z.array(GitCommitEntry).default([]),
  error: z.string().nullable().optional(),
});
export type GitLogReq = z.infer<typeof GitLogRequest>;
export type GitLogRes = z.infer<typeof GitLogResponse>;

export const GitCommitRequest = z.object({
  repoPath: z.string().min(1),
  message: z.string().min(1),
  // 是否先把所有改动加入暂存区（默认 true）
  all: z.boolean().default(true),
});
export const GitCommitResponse = z.object({
  ok: z.boolean(),
  hash: z.string().nullable().optional(),
  error: z.string().nullable().optional(),
});
export type GitCommitReq = z.infer<typeof GitCommitRequest>;
export type GitCommitRes = z.infer<typeof GitCommitResponse>;

export const GitPullRequest = z.object({ repoPath: z.string().min(1) });
export const GitPushRequest = z.object({ repoPath: z.string().min(1) });
export const GitSyncResponse = z.object({
  ok: z.boolean(),
  stdout: z.string().default(''),
  error: z.string().nullable().optional(),
});
export type GitPullReq = z.infer<typeof GitPullRequest>;
export type GitPushReq = z.infer<typeof GitPushRequest>;
export type GitSyncRes = z.infer<typeof GitSyncResponse>;

// Git 分支管理
export const GitBranchListRequest = z.object({ repoPath: z.string().min(1) });
export const GitBranchListResponse = z.object({
  ok: z.boolean(),
  branches: z
    .array(
      z.object({
        name: z.string(),
        current: z.boolean(),
      }),
    )
    .default([]),
  error: z.string().nullable().optional(),
});
export type GitBranchListRes = z.infer<typeof GitBranchListResponse>;

export const GitBranchCreateRequest = z.object({
  repoPath: z.string().min(1),
  name: z.string().min(1),
});
export const GitBranchCreateResponse = z.object({
  ok: z.boolean(),
  error: z.string().nullable().optional(),
});
export type GitBranchCreateRes = z.infer<typeof GitBranchCreateResponse>;

export const GitBranchSwitchRequest = z.object({
  repoPath: z.string().min(1),
  name: z.string().min(1),
});
export const GitBranchSwitchResponse = z.object({
  ok: z.boolean(),
  error: z.string().nullable().optional(),
});
export type GitBranchSwitchRes = z.infer<typeof GitBranchSwitchResponse>;

// Git 暂存区操作
export const GitAddRequest = z.object({
  repoPath: z.string().min(1),
  paths: z.array(z.string()),
});
export const GitAddResponse = z.object({
  ok: z.boolean(),
  error: z.string().nullable().optional(),
});

export const GitResetRequest = z.object({
  repoPath: z.string().min(1),
  paths: z.array(z.string()),
});
export const GitResetResponse = z.object({
  ok: z.boolean(),
  error: z.string().nullable().optional(),
});

// Git Diff
export const GitDiffRequest = z.object({
  repoPath: z.string().min(1),
  path: z.string().min(1),
  staged: z.boolean().default(false),
});
export const GitDiffResponse = z.object({
  ok: z.boolean(),
  diff: z.string().default(''),
  error: z.string().nullable().optional(),
});
export type GitDiffRes = z.infer<typeof GitDiffResponse>;
