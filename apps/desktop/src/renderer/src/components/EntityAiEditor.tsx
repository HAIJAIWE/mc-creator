import { useState, useCallback } from 'react';
import { McIcon } from '../assets/mc-ui/McIcon';
import { Plus, Trash2, ChevronDown, ChevronRight, GripVertical } from 'lucide-react';

/** AI 目标类型 */
type AiGoalType = 'target' | 'task' | 'sense';

/** AI 目标条目 */
interface AiGoal {
  id: string;
  type: AiGoalType;
  /** 原版 AI 目标名，如 minecraft:melee_attack */
  goalName: string;
  /** 优先级（数字越小越先执行） */
  priority: number;
  /** 参数 JSON */
  params: string;
  /** 是否启用 */
  enabled: boolean;
}

const GOAL_TYPE_LABELS: Record<AiGoalType, string> = {
  target: '目标',
  task: '任务',
  sense: '感官',
};

const GOAL_TYPE_COLORS: Record<AiGoalType, string> = {
  target: 'text-red-400',
  task: 'text-green-400',
  sense: 'text-blue-400',
};

/** 常用 AI 目标模板 */
const AI_TEMPLATES: { name: string; goalName: string; type: AiGoalType; defaultParams: string }[] =
  [
    // 目标（target/goal）
    {
      name: '近战攻击',
      goalName: 'minecraft:melee_attack',
      type: 'target',
      defaultParams: '{"speed":1.0,"see_through_walls":true}',
    },
    {
      name: '远程攻击',
      goalName: 'minecraft:ranged_attack',
      type: 'target',
      defaultParams: '{"speed":1.0,"attack_interval":20}',
    },
    {
      name: '躲避攻击',
      goalName: 'minecraft:flee',
      type: 'target',
      defaultParams: '{"speed":1.5,"distance":10}',
    },
    { name: '报复攻击', goalName: 'minecraft:hurt_by_target', type: 'target', defaultParams: '{}' },
    {
      name: '最近玩家',
      goalName: 'minecraft:nearest_attackable_player',
      type: 'target',
      defaultParams: '{}',
    },
    // 任务（task）
    {
      name: '跟随主人',
      goalName: 'minecraft:follow_owner',
      type: 'task',
      defaultParams: '{"speed":1.0,"distance":10}',
    },
    {
      name: '随机漫步',
      goalName: 'minecraft:random_stroll',
      type: 'task',
      defaultParams: '{"speed":0.6,"interval":120}',
    },
    {
      name: '看玩家',
      goalName: 'minecraft:look_at_player',
      type: 'task',
      defaultParams: '{"radius":8}',
    },
    { name: '浮水', goalName: 'minecraft:float', type: 'task', defaultParams: '{}' },
    { name: '开门', goalName: 'minecraft:open_doors', type: 'task', defaultParams: '{}' },
    { name: '避水', goalName: 'minecraft:avoid_water', type: 'task', defaultParams: '{}' },
    { name: '限制太阳', goalName: 'minecraft:restrict_sun', type: 'task', defaultParams: '{}' },
    { name: '繁殖', goalName: 'minecraft:breed', type: 'task', defaultParams: '{"speed":1.0}' },
    {
      name: '跟群',
      goalName: 'minecraft:follow_flock',
      type: 'task',
      defaultParams: '{"speed":1.0}',
    },
    { name: '吃草', goalName: 'minecraft:eat_grass', type: 'task', defaultParams: '{}' },
    {
      name: '跳跳跳',
      goalName: 'minecraft:leap_at_target',
      type: 'task',
      defaultParams: '{"yd":0.4}',
    },
    // 感官（sense）
    { name: '近距视觉', goalName: 'minecraft:near', type: 'sense', defaultParams: '{}' },
    { name: '受伤呼叫', goalName: 'minecraft:hurt_by', type: 'sense', defaultParams: '{}' },
    {
      name: '玩家视觉',
      goalName: 'minecraft:player',
      type: 'sense',
      defaultParams: '{"range":16}',
    },
    { name: '同种视觉', goalName: 'minecraft:same', type: 'sense', defaultParams: '{"range":16}' },
  ];

/**
 * 实体 AI/行为编辑器：管理 AI 目标/任务/感官。
 * 用于设计自定义实体的行为树，配合 NbtEditor 编辑实体 NBT。
 */
export function EntityAiEditor() {
  const [entityId, setEntityId] = useState('custom:my_entity');
  const [goals, setGoals] = useState<AiGoal[]>([
    {
      id: '1',
      type: 'task',
      goalName: 'minecraft:float',
      priority: 0,
      params: '{}',
      enabled: true,
    },
    {
      id: '2',
      type: 'target',
      goalName: 'minecraft:melee_attack',
      priority: 1,
      params: '{"speed": 1.0}',
      enabled: true,
    },
    {
      id: '3',
      type: 'task',
      goalName: 'minecraft:random_stroll',
      priority: 2,
      params: '{"speed": 0.6}',
      enabled: true,
    },
    {
      id: '4',
      type: 'task',
      goalName: 'minecraft:look_at_player',
      priority: 3,
      params: '{"radius": 8}',
      enabled: true,
    },
  ]);
  const [expandedGroups, setExpandedGroups] = useState<Set<AiGoalType>>(
    new Set(['target', 'task', 'sense']),
  );
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editParams, setEditParams] = useState('');

  const addGoal = useCallback(
    (template: (typeof AI_TEMPLATES)[number]) => {
      const newGoal: AiGoal = {
        id: `goal_${Date.now()}`,
        type: template.type,
        goalName: template.goalName,
        priority: goals.filter((g) => g.type === template.type).length,
        params: template.defaultParams,
        enabled: true,
      };
      setGoals((prev) => [...prev, newGoal]);
    },
    [goals],
  );

  const deleteGoal = useCallback((id: string) => {
    setGoals((prev) => prev.filter((g) => g.id !== id));
  }, []);

  const toggleGoal = useCallback((id: string) => {
    setGoals((prev) => prev.map((g) => (g.id === id ? { ...g, enabled: !g.enabled } : g)));
  }, []);

  const toggleGroup = useCallback((type: AiGoalType) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  }, []);

  const startEditParams = useCallback((goal: AiGoal) => {
    setEditingId(goal.id);
    setEditParams(goal.params);
  }, []);

  const saveParams = useCallback(
    (id: string) => {
      setGoals((prev) => prev.map((g) => (g.id === id ? { ...g, params: editParams } : g)));
      setEditingId(null);
    },
    [editParams],
  );

  const goalGroups: { type: AiGoalType; items: AiGoal[] }[] = [
    {
      type: 'target',
      items: goals.filter((g) => g.type === 'target').sort((a, b) => a.priority - b.priority),
    },
    {
      type: 'task',
      items: goals.filter((g) => g.type === 'task').sort((a, b) => a.priority - b.priority),
    },
    {
      type: 'sense',
      items: goals.filter((g) => g.type === 'sense').sort((a, b) => a.priority - b.priority),
    },
  ];

  return (
    <div className="flex h-full flex-col overflow-hidden bg-mc-surface">
      {/* 标题栏 */}
      <div className="flex items-center gap-2 border-b border-mc-border px-3 py-2">
        <McIcon scope="pixel" name="star" size={14} className="text-mc-accent" />
        <span className="text-xs font-medium text-mc-text">实体 AI 编辑器</span>
        <input
          value={entityId}
          onChange={(e) => setEntityId(e.target.value)}
          className="ml-2 flex-1 rounded-mc border border-mc-border bg-mc-surface-2 px-2 py-0.5 font-mono text-[11px] text-mc-text outline-none focus:border-mc-accent"
          placeholder="实体 ID"
        />
        <span className="text-[10px] text-mc-mute">{goals.length} 个目标</span>
      </div>

      {/* AI 目标分组 */}
      <div className="flex-1 overflow-y-auto p-2">
        {goalGroups.map((group) => (
          <div key={group.type} className="mb-2">
            {/* 分组标题 */}
            <button
              onClick={() => toggleGroup(group.type)}
              className="flex w-full items-center gap-1 rounded-mc px-2 py-1 text-xs font-medium text-mc-dim hover:bg-mc-surface-2"
            >
              {expandedGroups.has(group.type) ? (
                <ChevronDown className="h-3 w-3" />
              ) : (
                <ChevronRight className="h-3 w-3" />
              )}
              <span className={GOAL_TYPE_COLORS[group.type]}>{GOAL_TYPE_LABELS[group.type]}</span>
              <span className="ml-1 text-[10px] text-mc-mute">({group.items.length})</span>
            </button>

            {/* 目标列表 */}
            {expandedGroups.has(group.type) && (
              <div className="ml-3 space-y-1">
                {group.items.map((goal) => (
                  <div
                    key={goal.id}
                    className={`group flex items-center gap-1 rounded-mc border px-2 py-1 text-[11px] ${
                      goal.enabled
                        ? 'border-mc-border bg-mc-surface-2/40'
                        : 'border-mc-border/40 bg-mc-surface/40 opacity-50'
                    }`}
                  >
                    <GripVertical className="h-3 w-3 cursor-grab text-mc-mute" />
                    <input
                      type="checkbox"
                      checked={goal.enabled}
                      onChange={() => toggleGoal(goal.id)}
                      className="h-3 w-3 accent-mc-accent"
                    />
                    <span className="w-5 text-center text-mc-mute">{goal.priority}</span>
                    <span className={`font-mono ${GOAL_TYPE_COLORS[goal.type]}`}>
                      {goal.goalName}
                    </span>

                    {/* 参数编辑 */}
                    {editingId === goal.id ? (
                      <>
                        <input
                          autoFocus
                          value={editParams}
                          onChange={(e) => setEditParams(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') saveParams(goal.id);
                            if (e.key === 'Escape') setEditingId(null);
                          }}
                          className="flex-1 rounded-mc border border-mc-accent bg-mc-surface px-1 py-0 font-mono text-[10px] text-mc-text outline-none"
                        />
                        <button onClick={() => saveParams(goal.id)} className="text-green-400">
                          ✓
                        </button>
                      </>
                    ) : (
                      <span
                        onDoubleClick={() => startEditParams(goal)}
                        className="flex-1 cursor-text truncate font-mono text-[10px] text-mc-mute"
                        title="双击编辑参数"
                      >
                        {goal.params}
                      </span>
                    )}

                    <button
                      onClick={() => deleteGoal(goal.id)}
                      className="text-mc-mute opacity-0 transition-opacity hover:text-red-400 group-hover:opacity-100"
                    >
                      <Trash2 className="h-2.5 w-2.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* 底部：添加模板 */}
      <div className="border-t border-mc-border px-3 py-2">
        <div className="mb-1 text-[10px] text-mc-mute">快速添加</div>
        <div className="flex flex-wrap gap-1">
          {AI_TEMPLATES.map((t) => (
            <button
              key={t.goalName}
              onClick={() => addGoal(t)}
              className="flex items-center gap-1 rounded-mc border border-mc-border bg-mc-surface-2 px-1.5 py-0.5 text-[10px] text-mc-dim transition-colors hover:bg-mc-surface-3 hover:text-mc-text"
            >
              <Plus className="h-2.5 w-2.5" />
              <span className={GOAL_TYPE_COLORS[t.type]}>{t.name}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
