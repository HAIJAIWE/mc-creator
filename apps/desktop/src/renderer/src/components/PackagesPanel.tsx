import { useState, useMemo } from 'react';
import { useModStore } from '../store/mod-store.js';
import { McIcon } from '../assets/mc-ui/McIcon';
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronRight,
  GitBranch,
  Package,
  Search,
} from 'lucide-react';

interface ModEntryLite {
  name: string;
  fileName?: string;
  projectId?: string;
  versionId?: string;
  /** 依赖（如 fabric-api、cloth-config） */
  dependencies?: string[];
}

interface DepLite {
  id?: string;
  version?: string;
  /** 依赖类型：required / optional / embedded / incompatible */
  type?: 'required' | 'optional' | 'embedded' | 'incompatible';
}

/** MC 加载器版本范围 */
const LOADER_VERSIONS: Record<string, { min: string; latest: string }> = {
  fabric: { min: '0.14.0', latest: '0.16.0' },
  forge: { min: '40.0.0', latest: '47.2.0' },
  neoforge: { min: '20.1.0', latest: '21.0.143' },
  quilt: { min: '0.18.0', latest: '0.20.0' },
};

/** MC 版本 → pack_format 映射 */
const MC_VERSION_PF: Record<string, number> = {
  '1.21.4': 61,
  '1.21.1': 48,
  '1.20.6': 32,
  '1.20.4': 22,
  '1.20.1': 15,
  '1.19.4': 13,
  '1.18.2': 9,
  '1.16.5': 6,
};

/** 已知常见必需依赖（Maven 坐标 → 中文名） */
const WELL_KNOWN_DEPS: Record<string, string> = {
  'fabric-api': 'Fabric API',
  fabricloader: 'Fabric Loader',
  'cloth-config': 'Cloth Config',
  architectury: 'Architectury API',
  forgeconfigapiport: 'Forge Config API Port',
  'rei-api': 'Roughly Enough Items',
  jei: 'Just Enough Items',
  modmenu: 'Mod Menu',
  parchment: 'ParchmentMappings',
};

/** 依赖类型标签 */
const DEP_TYPE_LABELS: Record<NonNullable<DepLite['type']>, string> = {
  required: '必需',
  optional: '可选',
  embedded: '内嵌',
  incompatible: '冲突',
};

const DEP_TYPE_COLORS: Record<NonNullable<DepLite['type']>, string> = {
  required: 'text-red-400',
  optional: 'text-yellow-400',
  embedded: 'text-blue-400',
  incompatible: 'text-purple-400',
};

/** 包管理：展示当前 Mod 的环境依赖与（整合包）已添加模组 / 显式依赖。 */
export function PackagesPanel() {
  const generatorType = useModStore((s) => s.generatorType);
  const loader = useModStore((s) => s.loader);
  const mcVersion = useModStore((s) => s.mcVersion);
  const spec = useModStore((s) => s.spec);

  const [query, setQuery] = useState('');
  const [showModList, setShowModList] = useState(true);
  const [showDepList, setShowDepList] = useState(true);
  const [showTree, setShowTree] = useState(false);

  const mods: ModEntryLite[] = useMemo(
    () =>
      spec && Array.isArray((spec as unknown as { mods?: ModEntryLite[] }).mods)
        ? (spec as unknown as { mods: ModEntryLite[] }).mods
        : [],
    [spec],
  );

  const deps: DepLite[] = useMemo(
    () =>
      spec && Array.isArray((spec as unknown as { dependencies?: DepLite[] }).dependencies)
        ? (spec as unknown as { dependencies: DepLite[] }).dependencies
        : [],
    [spec],
  );

  // ===== 依赖冲突检测 =====
  const conflictAnalysis = useMemo(() => {
    const issues: { level: 'error' | 'warning' | 'info'; message: string; deps?: string[] }[] = [];
    const depIds = (deps.map((d) => d.id) ?? []).filter(Boolean) as string[];

    // 1) 重复依赖
    const counts = new Map<string, number>();
    for (const id of depIds) counts.set(id, (counts.get(id) ?? 0) + 1);
    for (const [id, count] of counts) {
      if (count > 1) {
        issues.push({
          level: 'warning',
          message: `依赖 "${id}" 重复声明 ${count} 次`,
          deps: [id],
        });
      }
    }

    // 2) 标记为 incompatible 的依赖
    for (const d of deps) {
      if (d.type === 'incompatible') {
        issues.push({
          level: 'error',
          message: `不兼容依赖: ${d.id ?? 'unknown'} ${d.version ?? ''}`,
          deps: [d.id ?? 'unknown'],
        });
      }
    }

    // 3) 检查 mod 之间的依赖（简化：每个 mod 自报 dependencies）
    const declaredDepIds = new Set(depIds);
    const missingDeps = new Set<string>();
    for (const m of mods) {
      if (m.dependencies && Array.isArray(m.dependencies)) {
        for (const dep of m.dependencies) {
          if (!declaredDepIds.has(dep) && !mods.find((mm) => mm.name === dep)) {
            missingDeps.add(dep);
          }
        }
      }
    }
    for (const missing of missingDeps) {
      issues.push({
        level: 'error',
        message: `缺失依赖: ${missing}（被某些 mod 依赖但未声明）`,
        deps: [missing],
      });
    }

    // 4) 加载器版本兼容性
    const lv = LOADER_VERSIONS[loader.toLowerCase()];
    if (lv) {
      // 简化：假设 mcVersion 在已知列表
      if (mcVersion && MC_VERSION_PF[mcVersion]) {
        // 检查 neoforge 要求 1.20.6+ 等
        if (loader.toLowerCase() === 'neoforge' && MC_VERSION_PF[mcVersion] < 22) {
          issues.push({
            level: 'error',
            message: `NeoForge 不支持 MC ${mcVersion}（需 1.20.6+）`,
          });
        }
        if (loader.toLowerCase() === 'quilt' && MC_VERSION_PF[mcVersion] < 9) {
          issues.push({
            level: 'warning',
            message: `Quilt 在 MC ${mcVersion} 上可能不稳定`,
          });
        }
      }
    }

    // 5) 模组间直接循环依赖（A 依赖 B 且 B 依赖 A）
    const modByName = new Map(mods.map((m) => [m.name, m]));
    const seenCycles = new Set<string>();
    for (const m of mods) {
      for (const dep of m.dependencies ?? []) {
        const target = modByName.get(dep);
        if (!target) continue;
        if (target.dependencies?.includes(m.name)) {
          const key = [m.name, dep].sort().join('→');
          if (seenCycles.has(key)) continue;
          seenCycles.add(key);
          issues.push({
            level: 'warning',
            message: `模组循环依赖: ${key}`,
            deps: [key],
          });
        }
      }
    }

    return issues;
  }, [deps, mods, loader, mcVersion]);

  // ===== 依赖树 =====
  const depTree = useMemo(() => {
    type TreeNode = { id: string; version?: string; children: TreeNode[]; dep?: DepLite };
    const root: TreeNode = { id: 'root', children: [] };

    // 顶层依赖
    for (const d of deps) {
      root.children.push({
        id: d.id ?? 'unknown',
        version: d.version,
        children: [],
        dep: d,
      });
    }

    // mod 自报依赖：命中顶层或子树中同名节点则挂到其下（收集所有匹配，避免漏挂）
    const collectMatches = (nodes: TreeNode[], id: string, acc: TreeNode[]): void => {
      for (const node of nodes) {
        if (node.id === id) acc.push(node);
        collectMatches(node.children, id, acc);
      }
    };
    for (const m of mods) {
      if (m.dependencies && Array.isArray(m.dependencies)) {
        for (const dep of m.dependencies) {
          const matches: TreeNode[] = [];
          collectMatches(root.children, dep, matches);
          for (const n of matches) {
            n.children.push({
              id: m.name,
              children: [],
              dep: { id: m.name, type: 'required' },
            });
          }
        }
      }
    }

    return root;
  }, [deps, mods]);

  const errorCount = conflictAnalysis.filter((i) => i.level === 'error').length;
  const warningCount = conflictAnalysis.filter((i) => i.level === 'warning').length;

  // 过滤后的 mod 列表
  const filteredMods = useMemo(() => {
    if (!query) return mods;
    const q = query.toLowerCase();
    return mods.filter(
      (m) => m.name.toLowerCase().includes(q) || (m.fileName ?? '').toLowerCase().includes(q),
    );
  }, [mods, query]);

  return (
    <div className="flex h-full flex-col overflow-y-auto bg-mc-surface">
      {/* 标题栏 */}
      <div className="flex items-center gap-2 border-b border-mc-border px-3 py-2">
        <McIcon scope="pixel" name="package" size={14} className="text-mc-accent" />
        <span className="text-xs font-medium text-mc-text">包管理</span>
        {errorCount > 0 && (
          <span className="ml-1 flex items-center gap-0.5 rounded-mc bg-red-500/20 px-1.5 py-0.5 text-[10px] text-red-400">
            <AlertTriangle className="h-2.5 w-2.5" /> {errorCount}
          </span>
        )}
        {warningCount > 0 && (
          <span className="ml-1 flex items-center gap-0.5 rounded-mc bg-yellow-500/20 px-1.5 py-0.5 text-[10px] text-yellow-400">
            <AlertTriangle className="h-2.5 w-2.5" /> {warningCount}
          </span>
        )}
      </div>

      {/* ===== 环境依赖 ===== */}
      <div className="border-b border-mc-border px-3 py-2">
        <div className="mb-1.5 flex items-center gap-1 text-[10px] font-medium text-mc-dim">
          <Package className="h-3 w-3" /> 环境依赖
        </div>
        <div className="space-y-1 text-[11px]">
          <div className="flex items-center gap-2">
            <span className="text-mc-dim">加载器</span>
            <span className="ml-auto text-mc-text">{loader}</span>
            {LOADER_VERSIONS[loader.toLowerCase()] && (
              <span className="text-[9px] text-mc-mute">
                v{LOADER_VERSIONS[loader.toLowerCase()].latest}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-mc-dim">游戏版本</span>
            <span className="ml-auto text-mc-text">{mcVersion}</span>
            {MC_VERSION_PF[mcVersion] ? (
              <span className="text-[9px] text-mc-mute">PF {MC_VERSION_PF[mcVersion]}</span>
            ) : mcVersion ? (
              <span className="text-[9px] text-mc-mute">PF 未知</span>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-mc-dim">类型</span>
            <span className="ml-auto text-mc-text">{generatorType}</span>
          </div>
        </div>
      </div>

      {/* ===== 冲突检测 ===== */}
      <div className="border-b border-mc-border px-3 py-2">
        <div className="mb-1.5 flex items-center gap-1 text-[10px] font-medium text-mc-dim">
          <AlertTriangle className="h-3 w-3" /> 冲突检测
        </div>
        {conflictAnalysis.length === 0 ? (
          <div className="flex items-center gap-1 py-1 text-[11px] text-green-400">
            <Check className="h-3 w-3" /> 无冲突，依赖关系健康
          </div>
        ) : (
          <ul className="space-y-1">
            {conflictAnalysis.map((issue, i) => (
              <li
                key={i}
                className={`flex items-start gap-1 rounded-mc px-1.5 py-1 text-[10px] ${
                  issue.level === 'error'
                    ? 'bg-red-500/10 text-red-400'
                    : issue.level === 'warning'
                      ? 'bg-yellow-500/10 text-yellow-400'
                      : 'bg-blue-500/10 text-blue-400'
                }`}
              >
                <span className="mt-0.5">
                  {issue.level === 'error' ? '✗' : issue.level === 'warning' ? '⚠' : 'ℹ'}
                </span>
                <span className="flex-1">{issue.message}</span>
                {issue.deps && issue.deps.length > 0 && (
                  <code className="rounded bg-mc-surface-2 px-1 font-mono text-[9px]">
                    {issue.deps.join(', ')}
                  </code>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* ===== 整合包模组列表（仅 modpack 类型）===== */}
      {generatorType === 'modpack' && (
        <div className="border-b border-mc-border">
          <button
            onClick={() => setShowModList(!showModList)}
            className="flex w-full items-center gap-1 px-3 py-2 text-[10px] font-medium text-mc-dim hover:text-mc-text"
          >
            {showModList ? (
              <ChevronDown className="h-3 w-3" />
            ) : (
              <ChevronRight className="h-3 w-3" />
            )}
            <Package className="h-3 w-3" />
            整合包模组（{mods.length}）
          </button>
          {showModList && (
            <div className="px-3 pb-2">
              {/* 搜索框 */}
              <div className="mb-1.5 flex items-center gap-1 rounded-mc border border-mc-border bg-mc-surface-2 px-2 py-1">
                <Search className="h-3 w-3 text-mc-mute" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="搜索 mod…"
                  className="flex-1 bg-transparent text-[11px] text-mc-text outline-none"
                />
              </div>
              <ul className="max-h-48 space-y-1 overflow-auto">
                {filteredMods.length === 0 ? (
                  <li className="py-4 text-center text-[11px] text-mc-mute">
                    {mods.length === 0 ? '尚未添加模组' : '无匹配结果'}
                  </li>
                ) : (
                  filteredMods.map((m, i) => {
                    const isCF = /^\d+$/.test(m.projectId ?? '');
                    return (
                      <li
                        key={`${m.name}-${i}`}
                        className="flex items-center gap-2 rounded-mc border border-mc-border bg-mc-surface-2 px-2 py-1 text-[11px]"
                      >
                        <McIcon scope="pixel" name="box" size={12} className="text-mc-mute" />
                        <span className="truncate text-mc-text">{m.name}</span>
                        {m.fileName && (
                          <span className="truncate text-[9px] text-mc-mute">{m.fileName}</span>
                        )}
                        <span
                          className={`ml-auto rounded-mc px-1.5 py-0.5 text-[9px] ${
                            isCF
                              ? 'bg-orange-500/20 text-orange-400'
                              : 'bg-green-500/20 text-green-400'
                          }`}
                        >
                          {isCF ? 'CF' : 'MR'}
                        </span>
                      </li>
                    );
                  })
                )}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* ===== 依赖列表 ===== */}
      <div className="border-b border-mc-border">
        <button
          onClick={() => setShowDepList(!showDepList)}
          className="flex w-full items-center gap-1 px-3 py-2 text-[10px] font-medium text-mc-dim hover:text-mc-text"
        >
          {showDepList ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          <Package className="h-3 w-3" />
          依赖（{deps.length}）
        </button>
        {showDepList && (
          <ul className="space-y-1 px-3 pb-2">
            {deps.length === 0 ? (
              <li className="py-4 text-center text-[11px] text-mc-mute">无显式依赖</li>
            ) : (
              deps.map((d, i) => {
                const depType = d.type ?? 'required';
                const wellKnown = d.id ? WELL_KNOWN_DEPS[d.id] : undefined;
                return (
                  <li
                    key={`${d.id ?? 'unknown'}-${i}`}
                    className="flex items-center gap-2 rounded-mc border border-mc-border bg-mc-surface-2 px-2 py-1 text-[11px]"
                  >
                    <McIcon scope="pixel" name="link" size={12} className="text-mc-mute" />
                    <span className="truncate text-mc-text">{d.id ?? 'unknown'}</span>
                    {wellKnown && (
                      <span className="truncate text-[9px] text-mc-mute">{wellKnown}</span>
                    )}
                    {d.version && (
                      <span className="font-mono text-[9px] text-mc-dim">{d.version}</span>
                    )}
                    <span className={`ml-auto text-[9px] ${DEP_TYPE_COLORS[depType]}`}>
                      {DEP_TYPE_LABELS[depType]}
                    </span>
                  </li>
                );
              })
            )}
          </ul>
        )}
      </div>

      {/* ===== 依赖树视图 ===== */}
      <div className="border-b border-mc-border">
        <button
          onClick={() => setShowTree(!showTree)}
          className="flex w-full items-center gap-1 px-3 py-2 text-[10px] font-medium text-mc-dim hover:text-mc-text"
        >
          {showTree ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          <GitBranch className="h-3 w-3" />
          依赖树
        </button>
        {showTree && (
          <div className="px-3 pb-2">
            {depTree.children.length === 0 ? (
              <div className="py-4 text-center text-[11px] text-mc-mute">无依赖</div>
            ) : (
              <ul className="space-y-0.5 font-mono text-[10px]">
                {depTree.children.map((node, i) => (
                  <DepTreeNode key={`${node.id}-${i}`} node={node} depth={0} />
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/** 依赖树节点 */
function DepTreeNode({
  node,
  depth,
}: {
  node: {
    id: string;
    version?: string;
    children: { id: string; version?: string; children: unknown[]; dep?: DepLite }[];
    dep?: DepLite;
  };
  depth: number;
}) {
  const [expanded, setExpanded] = useState(true);
  const hasChildren = node.children.length > 0;
  const depType = node.dep?.type;
  return (
    <li>
      <div className="flex items-center gap-1" style={{ paddingLeft: depth * 12 }}>
        {hasChildren ? (
          <button
            onClick={() => setExpanded(!expanded)}
            className="text-mc-mute hover:text-mc-text"
          >
            {expanded ? (
              <ChevronDown className="h-2.5 w-2.5" />
            ) : (
              <ChevronRight className="h-2.5 w-2.5" />
            )}
          </button>
        ) : (
          <span className="inline-block w-2.5" />
        )}
        <span className="text-mc-text">{node.id}</span>
        {node.version && <span className="text-mc-mute">@{node.version}</span>}
        {depType && depType !== 'required' && (
          <span className={`ml-1 rounded-mc px-1 text-[8px] ${DEP_TYPE_COLORS[depType]}`}>
            {DEP_TYPE_LABELS[depType]}
          </span>
        )}
      </div>
      {expanded && hasChildren && (
        <ul className="space-y-0.5">
          {node.children.map((child, i) => (
            <DepTreeNode key={`${child.id}-${i}`} node={child as never} depth={depth + 1} />
          ))}
        </ul>
      )}
    </li>
  );
}
