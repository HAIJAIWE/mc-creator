import { memo, useMemo } from 'react';
import type { NodePort } from '@mc-creator/shared';
import { nodeRegistry } from '@mc-creator/shared';
import { useNodeGraphStore } from '../../../store/node-graph-store.js';
import { useDrawerStore } from '../../../store/drawer-store.js';
import {
  VerticalNodeShell,
  type BlockRow,
  type BlockShape,
  type RowEditSpec,
} from './base/VerticalNodeShell.js';

export interface VerticalCoreNodeData extends Record<string, unknown> {
  /** 新系统节点 id（如 spawn_entity），对应 shared NodeDefinition.id */
  kind: string;
  collapsed?: boolean | undefined;
  codeLocked?: boolean | undefined;
  displayName?: string | undefined;
  label?: string | undefined;
  note?: string | undefined;
}

/** void 控制端口中优先作为底部凸榫的 id */
const TAB_PRIORITY = ['next', 'done'];

function formatValue(value: unknown, fallback: unknown): string {
  const v = value ?? fallback;
  if (v === undefined || v === null || v === '') return '—';
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return String(v);
  try {
    const s = JSON.stringify(v);
    return s.length > 24 ? `${s.slice(0, 24)}…` : s;
  } catch {
    return '—';
  }
}

function toRow(p: NodePort, data: VerticalCoreNodeData, branch: boolean): BlockRow {
  return {
    id: p.id,
    label: p.label,
    value: formatValue(data[p.id] ?? p.defaultValue, p.defaultValue),
    branch,
  };
}

/**
 * 端口类型 → 行内编辑器种类（仅基础三型可 inline，其余回抽屉）。
 * 编辑语义与编译器一致：无连线时字面量生效（data[port] ?? defaultValue），
 * 有数据边时边优先——故已连线的行不给编辑器，只读展示。
 */
function inlineKindFor(portType: string): RowEditSpec['kind'] | null {
  switch (portType) {
    case 'number':
    case 'integer':
      return 'number';
    case 'string':
      return 'text';
    case 'boolean':
      return 'boolean';
    default:
      return null;
  }
}

/** 行内提交：先记撤销点再写 data（与拖拽/抽屉保存同粒度） */
function useCommitPortValue(nodeId: string) {
  const commit = useNodeGraphStore((s) => s.commit);
  const updateNode = useNodeGraphStore((s) => s.updateNode);
  return (portId: string, value: string | number | boolean) => {
    commit();
    updateNode(nodeId, { [portId]: value } as Partial<never>);
  };
}

type VerticalCoreNodeComponentProps = {
  id: string;
  data: VerticalCoreNodeData;
  selected?: boolean;
};

/**
 * 新系统节点的竖式积木渲染器（拼图风格）
 * - exec 缺口在上，next/done 凸榫在下
 * - 数据输入左侧行，数据输出/分支右侧行
 * - 事件为帽子块，无数据控制端口时为圆角块
 */
function VerticalCoreNodeComponent({ id, data }: VerticalCoreNodeComponentProps) {
  const toggleCollapse = useNodeGraphStore((s) => s.toggleCollapse);
  const openDrawer = useDrawerStore((s) => s.openDrawer);
  const edges = useNodeGraphStore((s) => s.graph.edges);
  const commitPortValue = useCommitPortValue(id);

  const nodeData = data as VerticalCoreNodeData;
  const def = nodeRegistry.get(nodeData.kind);

  // 有数据边输入的端口：边优先，字面量不生效，只读展示（见 node-renderer literalExpr）
  const connectedInputs = useMemo(() => {
    const set = new Set<string>();
    for (const e of edges) {
      if (e.target === id && e.targetHandle) set.add(e.targetHandle);
    }
    return set;
  }, [edges, id]);

  if (!def) {
    return (
      <div style={{ color: '#d43a3a', fontSize: 12, padding: 8 }}>
        未知积木类型: {nodeData.kind}
      </div>
    );
  }

  // if (!def) 早退后，def 收窄为 NodeDefinition
  const voidInputs = def.inputs.filter((p: NodePort) => p.type === 'void');
  const voidOutputs = def.outputs.filter((p: NodePort) => p.type === 'void');
  const dataInputs = def.inputs.filter((p: NodePort) => p.type !== 'void');
  const dataOutputs = def.outputs.filter((p: NodePort) => p.type !== 'void');

  const execPort = voidInputs.find((p: NodePort) => p.id === 'exec') ?? null;
  const tabPort =
    TAB_PRIORITY.map((wanted) => voidOutputs.find((p: NodePort) => p.id === wanted)).find(
      Boolean,
    ) ?? null;

  const shape: BlockShape =
    def.category === 'event'
      ? 'hat'
      : voidInputs.length + voidOutputs.length === 0
        ? 'reporter'
        : 'stack';

  const leftRows: BlockRow[] = [
    ...dataInputs.map((p: NodePort) => {
      const row = toRow(p, nodeData, false);
      const kind = inlineKindFor(p.type);
      if (kind && !connectedInputs.has(p.id)) {
        const raw = nodeData[p.id] ?? p.defaultValue;
        const value =
          kind === 'number'
            ? typeof raw === 'number' && Number.isFinite(raw)
              ? raw
              : Number(raw) || 0
            : kind === 'boolean'
              ? raw === true
              : String(raw ?? '');
        row.edit = {
          kind,
          value,
          ariaLabel: `${p.label}（行内编辑）`,
          onCommit: (v) => commitPortValue(p.id, v),
        };
      }
      return row;
    }),
    ...voidInputs
      .filter((p: NodePort) => p !== execPort)
      .map((p: NodePort) => toRow(p, nodeData, false)),
  ];
  const rightRows: BlockRow[] = [
    ...dataOutputs.map((p: NodePort) => toRow(p, nodeData, false)),
    ...voidOutputs
      .filter((p: NodePort) => p !== tabPort)
      .map((p: NodePort) => toRow(p, nodeData, true)),
  ];

  return (
    <VerticalNodeShell
      icon={def.icon}
      title={String(nodeData.displayName ?? nodeData.label ?? def.label)}
      category={def.category}
      shape={shape}
      notchId={execPort?.id ?? null}
      tabId={tabPort?.id ?? null}
      leftRows={leftRows}
      rightRows={rightRows}
      badge={def.category === 'event' ? '事件' : undefined}
      collapsed={Boolean(nodeData.collapsed)}
      codeLocked={Boolean(nodeData.codeLocked)}
      onToggleCollapse={() => toggleCollapse(id)}
      onOpenDrawer={() => openDrawer(id)}
    />
  );
}

export const VerticalCoreNode = memo(VerticalCoreNodeComponent);
