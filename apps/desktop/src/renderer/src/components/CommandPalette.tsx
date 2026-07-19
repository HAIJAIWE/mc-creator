import { useState, useEffect, useRef, useMemo } from 'react';
import { Search, CornerDownLeft } from 'lucide-react';

export interface Command {
  id: string;
  label: string;
  description?: string;
  shortcut?: string;
  /** 命令分类（用于过滤显示） */
  category?: string;
  run: () => void;
}

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  commands: Command[];
}

/**
 * 命令面板（VS Code 风格）：F1 触发，模糊过滤命令列表，键盘上下选择 + 回车执行。
 * 包含 MC 命令补全（/give /summon /tp 等）+ 命令分类筛选。
 */
export function CommandPalette({ open, onClose, commands }: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [activeCategory, setActiveCategory] = useState<string>('all');
  const inputRef = useRef<HTMLInputElement>(null);

  // 打开时重置状态并聚焦输入框
  useEffect(() => {
    if (open) {
      setQuery('');
      setSelectedIdx(0);
      setActiveCategory('all');
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  // 提取所有分类
  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const c of commands) {
      if (c.category) set.add(c.category);
    }
    return ['all', ...Array.from(set).sort()];
  }, [commands]);

  const categoryLabels: Record<string, string> = useMemo(
    () => ({
      all: '全部',
      file: '文件',
      view: '视图',
      git: 'Git',
      edit: '编辑',
      mc: 'MC 命令',
      tools: '工具',
      ai: 'AI',
      project: '项目',
    }),
    [],
  );

  // 过滤命令：分类 + 模糊匹配
  const filtered = useMemo(() => {
    let result = commands;
    if (activeCategory !== 'all') {
      result = result.filter((c) => c.category === activeCategory);
    }
    if (!query) return result;
    const q = query.toLowerCase();
    return result.filter(
      (c) => c.label.toLowerCase().includes(q) || c.description?.toLowerCase().includes(q),
    );
  }, [commands, query, activeCategory]);

  // 输入变化时重置选中项
  useEffect(() => {
    setSelectedIdx(0);
  }, [query, activeCategory]);

  // 自动滚动选中项到可视区（必须在 early return 之前调用以遵守 hooks 规则）
  useEffect(() => {
    if (!open) return;
    const el = document.getElementById(`cmd-item-${selectedIdx}`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [selectedIdx, open]);

  if (!open) return null;

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIdx((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Tab') {
      e.preventDefault();
      // Tab 切换分类
      const curIdx = categories.indexOf(activeCategory);
      const nextIdx = e.shiftKey
        ? (curIdx - 1 + categories.length) % categories.length
        : (curIdx + 1) % categories.length;
      setActiveCategory(categories[nextIdx]);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const cmd = filtered[selectedIdx];
      if (cmd) {
        cmd.run();
        onClose();
      }
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 pt-[15vh]"
      onClick={onClose}
    >
      <div
        className="w-[640px] max-w-[90vw] overflow-hidden rounded-mc-lg border border-mc-border bg-mc-surface shadow-mc-pop"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 搜索框 */}
        <div className="flex items-center gap-2 border-b border-mc-border px-3 py-2">
          <Search className="h-4 w-4 text-mc-mute" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="输入命令名或 / 触发 MC 命令补全…"
            className="flex-1 bg-transparent text-sm text-mc-text outline-none placeholder:text-mc-mute"
          />
          <span className="rounded-mc bg-mc-surface-3 px-1.5 py-0.5 text-xs text-mc-dim">
            ESC 关闭 · Tab 切分类
          </span>
        </div>

        {/* 分类标签栏 */}
        {categories.length > 1 && (
          <div className="flex flex-wrap items-center gap-1 border-b border-mc-border bg-mc-surface-2 px-2 py-1">
            {categories.map((cat) => (
              <button
                key={cat}
                onClick={() => setActiveCategory(cat)}
                className={`rounded-mc px-2 py-0.5 text-[10px] transition-colors ${
                  activeCategory === cat
                    ? 'bg-mc-accent text-white'
                    : 'text-mc-dim hover:bg-mc-surface-3 hover:text-mc-text'
                }`}
              >
                {categoryLabels[cat] ?? cat}
              </button>
            ))}
          </div>
        )}

        {/* 命令列表 */}
        <div className="max-h-[400px] overflow-y-auto py-1">
          {filtered.length === 0 ? (
            <div className="px-3 py-6 text-center text-xs text-mc-mute">未找到匹配命令</div>
          ) : (
            filtered.map((cmd, i) => (
              <button
                key={cmd.id}
                id={`cmd-item-${i}`}
                onMouseEnter={() => setSelectedIdx(i)}
                onClick={() => {
                  cmd.run();
                  onClose();
                }}
                className={`flex w-full items-center justify-between px-3 py-2 text-left text-xs transition-colors ${
                  i === selectedIdx ? 'bg-mc-accent/20 text-mc-accent-bright' : 'text-mc-text'
                }`}
              >
                <div className="flex flex-1 items-center gap-2">
                  {/* 分类徽章 */}
                  {cmd.category && (
                    <span
                      className={`rounded-mc px-1.5 py-0.5 text-[9px] ${
                        cmd.category === 'mc'
                          ? 'bg-green-500/20 text-green-400'
                          : cmd.category === 'git'
                            ? 'bg-orange-500/20 text-orange-400'
                            : cmd.category === 'ai'
                              ? 'bg-purple-500/20 text-purple-400'
                              : 'bg-mc-surface-3 text-mc-mute'
                      }`}
                    >
                      {categoryLabels[cmd.category] ?? cmd.category}
                    </span>
                  )}
                  <div className="flex flex-col">
                    <span className="font-medium">{cmd.label}</span>
                    {cmd.description && <span className="text-mc-mute">{cmd.description}</span>}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {cmd.shortcut && (
                    <span className="rounded-mc bg-mc-surface-3 px-1.5 py-0.5 text-xs text-mc-dim">
                      {cmd.shortcut}
                    </span>
                  )}
                  {i === selectedIdx && <CornerDownLeft className="h-3 w-3" />}
                </div>
              </button>
            ))
          )}
        </div>

        {/* 底部统计 */}
        <div className="border-t border-mc-border bg-mc-surface-2 px-3 py-1 text-[10px] text-mc-mute">
          {filtered.length} / {commands.length} 个命令 · 当前分类：
          {categoryLabels[activeCategory] ?? activeCategory}
        </div>
      </div>
    </div>
  );
}

// ===== MC 命令模板库（供调用方快速注入命令补全）=====

export interface McCommandTemplate {
  prefix: string;
  label: string;
  description: string;
  syntax: string;
  example: string;
}

/** MC 命令模板：常用命令补全 */
export const MC_COMMAND_TEMPLATES: McCommandTemplate[] = [
  // ===== 玩家类 =====
  {
    prefix: '/give',
    label: '/give <玩家> <物品> [数量]',
    description: '给予玩家物品',
    syntax: '/give <target> <item> [count] [components]',
    example: '/give @p minecraft:diamond 64',
  },
  {
    prefix: '/clear',
    label: '/clear [玩家] [物品]',
    description: '清除玩家物品',
    syntax: '/clear [target] [item] [maxCount]',
    example: '/clear @p minecraft:dirt',
  },
  {
    prefix: '/tp',
    label: '/tp <目标> <目的地>',
    description: '传送实体',
    syntax: '/tp <target> <destination|location> [rotation]',
    example: '/tp @p 100 70 200',
  },
  {
    prefix: '/gamemode',
    label: '/gamemode <模式> [玩家]',
    description: '切换游戏模式',
    syntax: '/gamemode <survival|creative|adventure|spectator> [target]',
    example: '/gamemode creative @p',
  },
  {
    prefix: '/effect',
    label: '/effect give <玩家> <效果>',
    description: '给予状态效果',
    syntax: '/effect give <target> <effect> [seconds] [amplifier] [hideParticles]',
    example: '/effect give @p minecraft:speed 30 1 true',
  },
  {
    prefix: '/enchant',
    label: '/enchant <玩家> <附魔> [等级]',
    description: '附魔手持物品',
    syntax: '/enchant <target> <enchantment> [level]',
    example: '/enchant @p minecraft:sharpness 5',
  },
  {
    prefix: '/xp',
    label: '/xp <数量> [玩家]',
    description: '给予经验值',
    syntax: '/xp <amount> [target] [add|set]',
    example: '/xp 100 @p',
  },
  {
    prefix: '/kill',
    label: '/kill [目标]',
    description: '杀死实体',
    syntax: '/kill [target]',
    example: '/kill @e[type=zombie]',
  },
  // ===== 实体/世界类 =====
  {
    prefix: '/summon',
    label: '/summon <实体> [位置]',
    description: '召唤实体',
    syntax: '/summon <entity> [pos] [nbt]',
    example: '/summon minecraft:zombie ~ ~ ~ {IsBaby:1b}',
  },
  {
    prefix: '/setblock',
    label: '/setblock <位置> <方块>',
    description: '放置方块',
    syntax: '/setblock <pos> <block> [mode]',
    example: '/setblock 10 65 10 minecraft:stone',
  },
  {
    prefix: '/fill',
    label: '/fill <起> <止> <方块>',
    description: '填充区域',
    syntax: '/fill <from> <to> <block> [mode]',
    example: '/fill 0 60 0 10 70 10 minecraft:air',
  },
  {
    prefix: '/clone',
    label: '/clone <起> <止> <目标>',
    description: '复制区域',
    syntax: '/clone <begin> <end> <destination> [mode]',
    example: '/clone 0 0 0 5 5 5 100 100 100',
  },
  {
    prefix: '/weather',
    label: '/weather <类型> [时长]',
    description: '设置天气',
    syntax: '/weather <clear|rain|thunder> [duration]',
    example: '/weather thunder 600',
  },
  {
    prefix: '/time',
    label: '/time set <时间>',
    description: '设置时间',
    syntax: '/time set <day|night|noon|midnight|value>',
    example: '/time set day',
  },
  {
    prefix: '/difficulty',
    label: '/difficulty <难度>',
    description: '设置难度',
    syntax: '/difficulty <peaceful|easy|normal|hard>',
    example: '/difficulty hard',
  },
  // ===== 服务器/管理类 =====
  {
    prefix: '/op',
    label: '/op <玩家>',
    description: '授予 OP 权限',
    syntax: '/op <player>',
    example: '/op Steve',
  },
  {
    prefix: '/deop',
    label: '/deop <玩家>',
    description: '撤销 OP 权限',
    syntax: '/deop <player>',
    example: '/deop Steve',
  },
  {
    prefix: '/whitelist',
    label: '/whitelist <add|remove> <玩家>',
    description: '白名单管理',
    syntax: '/whitelist <add|remove|on|off|list> [player]',
    example: '/whitelist add Steve',
  },
  {
    prefix: '/ban',
    label: '/ban <玩家> [原因]',
    description: '封禁玩家',
    syntax: '/ban <player> [reason]',
    example: '/ban Steve "破坏规则"',
  },
  {
    prefix: '/kick',
    label: '/kick <玩家> [原因]',
    description: '踢出玩家',
    syntax: '/kick <player> [reason]',
    example: '/kick Steve "暂时下线"',
  },
  {
    prefix: '/stop',
    label: '/stop',
    description: '关闭服务器',
    syntax: '/stop',
    example: '/stop',
  },
  {
    prefix: '/save-all',
    label: '/save-all',
    description: '保存世界',
    syntax: '/save-all [flush]',
    example: '/save-all',
  },
  // ===== 数据包/进度类 =====
  {
    prefix: '/reload',
    label: '/reload',
    description: '重载数据包',
    syntax: '/reload',
    example: '/reload',
  },
  {
    prefix: '/datapack',
    label: '/datapack list|enable|disable',
    description: '数据包管理',
    syntax: '/datapack <list|enable|disable> [name]',
    example: '/datapack list',
  },
  {
    prefix: '/advancement',
    label: '/advancement <grant|revoke>',
    description: '授予/撤销进度',
    syntax: '/advancement <grant|revoke> <target> <everything|from|only> [advancement]',
    example: '/advancement grant @p only minecraft:story/mine_diamond',
  },
  {
    prefix: '/function',
    label: '/function <函数>',
    description: '执行函数',
    syntax: '/function <id>',
    example: '/function my_pack:give_items',
  },
  // ===== 选择器提示 =====
  {
    prefix: '@p',
    label: '@p — 最近玩家',
    description: '目标选择器：最近玩家',
    syntax: '@p[distance=..10]',
    example: '/give @p minecraft:bread 5',
  },
  {
    prefix: '@a',
    label: '@a — 所有玩家',
    description: '目标选择器：所有玩家',
    syntax: '@a[limit=5]',
    example: '/effect give @a minecraft:jump_boost 30 1',
  },
  {
    prefix: '@e',
    label: '@e — 所有实体',
    description: '目标选择器：所有实体',
    syntax: '@e[type=zombie]',
    example: '/kill @e[type=item]',
  },
  {
    prefix: '@s',
    label: '@s — 自己',
    description: '目标选择器：执行者自己',
    syntax: '@s',
    example: '/effect give @s minecraft:night_vision 600',
  },
];
