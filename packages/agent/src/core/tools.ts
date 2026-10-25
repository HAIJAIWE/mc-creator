/**
 * MCP 工具清单（设计文档 §10.2 / §10.6）。
 *
 * - 覆盖 §10.2 全部工具：读现状（闭环必需）/ 内容装配 / 执行与运维 / 生成与校验。
 * - permission 一律复用 contract MCP_TOOL_PERMISSIONS（§10.6 分级）：
 *   R=只读免确认 / W=写实例可配置免确认 / X=执行进程须弹窗。
 * - requireConfirm 实现确认门控；未知工具 fail-closed（须确认）。
 */

import { MCP_TOOL_PERMISSIONS } from '@mc-creator/contract';
import type { PermissionLevel } from '@mc-creator/contract';

export interface McpToolDef {
  name: string;
  description: string;
  permission: PermissionLevel;
}

const DEFS: Array<[name: string, description: string]> = [
  // 读现状 —— 闭环必需，缺失则智能体只能盲生成
  ['get_capabilities', '查询某 edition 的能力声明（强制第一步，§10.2）'],
  ['list_versions', '列出某 edition 可用版本（运行时拉取，§0.5#3）'],
  ['get_target_state', '读取目标现状：已装内容/配置/上次构建产物与失败原因'],
  ['read_config', '读取目标配置（server.properties / bukkit.yml 等，§7.4）'],
  ['read_logs', '读取目标日志（控制台流式 I/O，§7.4）'],
  ['search_content', '检索内容（支持分页/游标）'],
  ['list_instances', '列出客户端实例'],
  ['list_servers', '列出服务端'],
  ['get_context_pack', '获取状态注入包（见 ./context-pack.ts，§10.4）'],
  ['list_backups', '列出服务端快照清单（§7.4 快照备份）'],
  ['list_tasks', '列出定时任务账本，可按 serverId 过滤（§7.4 定时任务）'],
  ['run_due_tasks', '推进到期定时任务，只读到期清单+账本推进，不直接启停进程（§7.4）'],
  // 内容装配 —— 写实例目录
  ['install_modpack', '安装整合包（CurseForge zip / .mrpack，§5.4）'],
  ['install_mod', '安装 Java Mod（§5.3）'],
  ['install_addon', '安装 Bedrock Add-on（§6.3）'],
  ['import_package', '导入包文件（.mcpack/.mcaddon/.mrpack，§6.2）'],
  ['apply_skin', '应用皮肤（§5.9）'],
  ['uninstall_content', '卸载内容（闭环回滚必需）'],
  // 执行与运维 —— 必须弹窗确认
  ['launch_instance', '启动客户端实例'],
  ['create_instance', '创建客户端实例'],
  ['delete_instance', '删除客户端实例'],
  ['build_project', 'devkit 编译工程（§8）'],
  ['deploy_plugin', '部署插件到服务端'],
  ['restart_server', '重启服务端（hot reload 优先，§17 场景 A）'],
  ['stop_server', '停止服务端（优雅停机，§7.4）'],
  ['rollback_build', '回滚构建产物'],
  ['backup_server', '为服务端创建快照备份（§7.4 快照备份，运维类）'],
  ['restore_backup', '从快照恢复服务端（§7.4 快照备份，运维类）'],
  ['prune_backups', '按保留数裁剪旧快照（§7.4 快照备份，运维类）'],
  ['schedule_task', '调度服务端定时任务（§7.4 定时任务，运维类）'],
  ['cancel_task', '取消定时任务（§7.4 定时任务，运维类）'],
  // 生成与校验
  ['generate_content', '生成内容（prompt+kind+edition+version，§10.3）'],
  ['validate_content', '校验内容（机器可判定成功信号，§10.3）'],
  // 代理服务器管理（§7.2 代理层：Velocity / BungeeCord / Waterfall）
  ['create_proxy_server', '创建代理服务器（指定类型 velocity/bungeecord/waterfall）'],
  ['start_proxy_server', '启动代理服务器'],
  ['stop_proxy_server', '停止代理服务器'],
  ['restart_proxy_server', '重启代理服务器'],
  ['delete_proxy_server', '删除代理服务器'],
  ['list_proxy_servers', '列出所有代理服务器'],
  ['get_proxy_server_config', '获取代理服务器配置'],
  ['set_proxy_server_config', '设置代理服务器配置'],
];

export const MCP_TOOL_DEFS: McpToolDef[] = DEFS.map(([name, description]) => ({
  name,
  description,
  permission: MCP_TOOL_PERMISSIONS[name] as PermissionLevel,
}));

export interface RequireConfirmOptions {
  /** W 类（写实例目录）是否免确认；默认 false=免确认（§10.6 可配置为免确认）。 */
  confirmWrites?: boolean;
}

/**
 * 确认门控（§10.6）：
 * X（执行进程/写实例目录外/改账户）→ 恒 true（必须弹窗）；
 * W（写实例目录）→ 按配置，默认 false；
 * R（只读）→ false；未知工具 fail-closed → true。
 */
export function requireConfirm(tool: string, opts: RequireConfirmOptions = {}): boolean {
  const level = MCP_TOOL_PERMISSIONS[tool] as PermissionLevel | undefined;
  if (level === undefined) return true;
  if (level === 'X') return true;
  if (level === 'W') return opts.confirmWrites ?? false;
  return false;
}
