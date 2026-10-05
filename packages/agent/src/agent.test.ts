/**
 * agent 单元测试（设计文档 §10 智能体层）。
 * 工具清单/确认门控、上下文截断、闭环流转——全部纯函数，无 I/O、无 LLM 调用。
 */
import { describe, expect, it } from 'vitest';
import { MCP_TOOL_PERMISSIONS, VALIDATION_CRITERIA } from '@mc-creator/contract';
import { MCP_TOOL_DEFS, requireConfirm } from './tools.js';
import { MCP_READ_ROUTES, createMcpServer } from './mcp-server.js';
import { buildContextPack } from './context-pack.js';
import { nextStep } from './pipeline.js';

describe('tools.ts MCP 工具清单（§10.2 / §10.6）', () => {
  // 注：任务简报写“22 个”，但简报自列的名单与 contract MCP_TOOL_PERMISSIONS
  // 均为 25 个键（§10.2 的 list_instances/list_servers、create/delete、
  // restart/stop 系成对工具；v3.1 §24 修订 #3 补齐了读现状/回滚/启停类）。
  // 以 contract（唯一事实来源）为准：25。
  it('工具数与 contract 键数一致且全覆盖', () => {
    const keys = Object.keys(MCP_TOOL_PERMISSIONS);
    expect(MCP_TOOL_DEFS).toHaveLength(keys.length);
    const names = new Set(MCP_TOOL_DEFS.map((t) => t.name));
    for (const k of keys) expect(names).toContain(k);
  });

  it('权限与 contract 逐项一致', () => {
    for (const def of MCP_TOOL_DEFS) {
      expect(def.permission).toBe(MCP_TOOL_PERMISSIONS[def.name]);
    }
  });

  it('§10.2 点名工具存在（含 v3.1 补齐的读现状/回滚类）', () => {
    const names = MCP_TOOL_DEFS.map((t) => t.name);
    for (const n of [
      'get_capabilities',
      'get_target_state',
      'get_context_pack',
      'install_modpack',
      'install_mod',
      'install_addon',
      'import_package',
      'apply_skin',
      'uninstall_content',
      'launch_instance',
      'build_project',
      'deploy_plugin',
      'restart_server',
      'stop_server',
      'rollback_build',
      'generate_content',
      'validate_content',
    ]) {
      expect(names).toContain(n);
    }
  });

  it('X 类（执行进程）全部须确认', () => {
    const xs = MCP_TOOL_DEFS.filter((t) => t.permission === 'X').map((t) => t.name);
    expect(xs.length).toBeGreaterThan(0);
    for (const name of xs) expect(requireConfirm(name)).toBe(true);
  });

  it('R 类（只读）全部免确认', () => {
    const rs = MCP_TOOL_DEFS.filter((t) => t.permission === 'R').map((t) => t.name);
    expect(rs.length).toBeGreaterThan(0);
    for (const name of rs) expect(requireConfirm(name)).toBe(false);
  });

  it('W 类默认免确认，confirmWrites:true 则须确认（§10.6 可配置）', () => {
    const ws = MCP_TOOL_DEFS.filter((t) => t.permission === 'W').map((t) => t.name);
    expect(ws.length).toBeGreaterThan(0);
    for (const name of ws) {
      expect(requireConfirm(name)).toBe(false);
      expect(requireConfirm(name, { confirmWrites: true })).toBe(true);
    }
  });

  it('未知工具 fail-closed（须确认）', () => {
    expect(requireConfirm('drop_database')).toBe(true);
  });
});

describe('context-pack.ts 状态注入（§10.4 targeting + 预算截断）', () => {
  it('预算内不截断，targeting 字段齐全', () => {
    const pack = buildContextPack(
      { serverId: 'test', edition: 'server', mcVersion: '1.21.4', runtime: 'paper' },
      {
        mods: ['jei'],
        plugins: ['Essentials'],
        lastBuildHash: 'abc123',
        lastFailure: 'NullPointer on enable',
        isFolia: true,
      },
      8000,
    );
    expect(pack.truncated).toBe(false);
    expect(pack.text).toContain('installed_plugins: Essentials');
    expect(pack.text).toContain('last_build_hash: abc123');
    expect(pack.text).toContain('last_failure: NullPointer on enable');
    expect(pack.text).toContain('folia: true');
  });

  it('超预算截断生效：长度受限 + targeting 关键行保留', () => {
    const pack = buildContextPack(
      { serverId: 'test' },
      {
        lastBuildHash: 'deadbeef',
        lastFailure: 'boom',
        isFolia: false,
        apiTypes: 'x'.repeat(5000),
        extra: 'y'.repeat(5000),
      },
      500,
    );
    expect(pack.truncated).toBe(true);
    expect(pack.text.length).toBeLessThanOrEqual(500);
    // targeting 头部保留：哈希/失败原因/Folia 标记不丢
    expect(pack.text).toContain('last_build_hash: deadbeef');
    expect(pack.text).toContain('last_failure: boom');
    expect(pack.text).toContain('folia: false');
    expect(pack.text).toContain('[truncated]');
  });

  it('空 parts 可用（纯 target 不崩）', () => {
    const pack = buildContextPack({ instanceId: 'i1' });
    expect(pack.truncated).toBe(false);
    expect(pack.text).toContain('instance: i1');
    expect(pack.budgetChars).toBe(8000);
  });
});

describe('pipeline.ts 生成闭环状态机（§10.3 成功判据）', () => {
  it('generate 成功 → validate', () => {
    expect(nextStep({ stage: 'generate', ok: true }, 0, 3)).toMatchObject({ action: 'validate' });
  });

  it('validate 成功 → succeed，且 criterion 引用 VALIDATION_CRITERIA', () => {
    const d = nextStep({ stage: 'validate', ok: true, kind: 'server-plugin' }, 1, 3);
    expect(d.action).toBe('succeed');
    expect(d.criterion).toBe(VALIDATION_CRITERIA['server-plugin']);
  });

  it('validate 成功但 kind 未知 → succeed 且不崩（criterion 缺省）', () => {
    const d = nextStep({ stage: 'validate', ok: true, kind: 'nope' }, 1, 3);
    expect(d.action).toBe('succeed');
    expect(d.criterion).toBeUndefined();
  });

  it('失败回路：validate→diagnose→fix→validate', () => {
    expect(nextStep({ stage: 'validate', ok: false }, 0, 3).action).toBe('diagnose');
    expect(nextStep({ stage: 'diagnose', ok: true }, 1, 3).action).toBe('fix');
    expect(nextStep({ stage: 'fix', ok: true }, 2, 3).action).toBe('validate');
  });

  it('generate 失败 → diagnose（读日志定位）', () => {
    expect(nextStep({ stage: 'generate', ok: false }, 0, 3).action).toBe('diagnose');
  });

  it('超轮 → abort（成功态不受轮次影响）', () => {
    expect(nextStep({ stage: 'validate', ok: false }, 3, 3).action).toBe('abort');
    expect(nextStep({ stage: 'fix', ok: false }, 5, 3).action).toBe('abort');
    // validate 已成功即使轮次耗尽也 succeed
    expect(nextStep({ stage: 'validate', ok: true, kind: 'datapack' }, 9, 3).action).toBe(
      'succeed',
    );
  });

  it('diagnose 自身失败 → abort 转人工（避免无效循环）', () => {
    expect(nextStep({ stage: 'diagnose', ok: false }, 0, 3).action).toBe('abort');
  });
});

describe('§7.4 快照/定时 8 新工具（contract 33 键）', () => {
  it('总数 33 且新 8 键全覆盖', () => {
    const keys = Object.keys(MCP_TOOL_PERMISSIONS);
    expect(keys).toHaveLength(33);
    expect(MCP_TOOL_DEFS).toHaveLength(33);
    const names = new Set(MCP_TOOL_DEFS.map((t) => t.name));
    for (const n of [
      'list_backups',
      'list_tasks',
      'run_due_tasks',
      'backup_server',
      'restore_backup',
      'prune_backups',
      'schedule_task',
      'cancel_task',
    ]) {
      expect(names).toContain(n);
    }
  });

  it('新 8 条 description 带 §7.4；run_due_tasks 注明不直接启停进程', () => {
    const byName = new Map(MCP_TOOL_DEFS.map((t) => [t.name, t] as const));
    for (const n of [
      'list_backups',
      'list_tasks',
      'run_due_tasks',
      'backup_server',
      'restore_backup',
      'prune_backups',
      'schedule_task',
      'cancel_task',
    ]) {
      expect(byName.get(n)?.description).toContain('§7.4');
    }
    expect(byName.get('run_due_tasks')?.description).toContain(
      '只读到期清单+账本推进，不直接启停进程',
    );
  });

  it('三读工具有 server 路由且 callTool 走内核（非 unimplemented 说明）', async () => {
    expect(MCP_READ_ROUTES['list_backups']).toBe('server');
    expect(MCP_READ_ROUTES['list_tasks']).toBe('server');
    expect(MCP_READ_ROUTES['run_due_tasks']).toBe('server');
    const server = createMcpServer({});
    // 无 dataDir 时内核报 validation（DATA_DIR_MISSING），关键是已走路由：
    // 错误分类为 validation 而非 unimplemented 的 unknown。
    for (const [name, args] of [
      ['list_backups', { serverId: 'ghost' }],
      ['list_tasks', {}],
      ['run_due_tasks', {}],
    ] as const) {
      const res = await server.callTool(name, args);
      expect(res.isError).toBe(true);
      const body = res.structuredContent as { ok: boolean; error?: { category: string } };
      expect(body.ok).toBe(false);
      expect(body.error?.category).toBe('validation');
      expect(res.content[0]?.text ?? '').not.toContain('暂无内核支持');
    }
    // run_due_tasks 的 now 可选注入字段在 inputSchema 中存在
    const byName = new Map(server.listTools().map((t) => [t.name, t] as const));
    expect(Object.keys(byName.get('run_due_tasks')?.inputSchema.properties ?? {})).toContain('now');
  });

  it('W 新工具 5 个被 refuse（confirmRequired true，未执行）', async () => {
    const server = createMcpServer({});
    for (const [name, args] of [
      ['backup_server', { serverId: 's1' }],
      ['restore_backup', { serverId: 's1', backupId: 'b1' }],
      ['prune_backups', { serverId: 's1', keepN: 5 }],
      ['schedule_task', { serverId: 's1', action: 'backup' }],
      ['cancel_task', { taskId: 'task-1' }],
    ] as const) {
      const res = await server.callTool(name, args);
      expect(res.isError).toBe(true);
      const raw = JSON.parse(res.content[0]?.text ?? '{}') as {
        ok: boolean;
        permission: string;
        confirmRequired: boolean;
      };
      expect(raw.ok).toBe(false);
      expect(raw.permission).toBe('W');
      expect(raw.confirmRequired).toBe(true);
      expect(res.content[0]?.text ?? '').toContain('本通道不执行');
    }
  });
});
