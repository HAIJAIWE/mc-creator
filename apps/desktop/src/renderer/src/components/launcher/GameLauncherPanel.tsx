import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ChevronRight,
  Download,
  FolderOpen,
  Gamepad2,
  Loader2,
  Play,
  Plus,
  RefreshCw,
  Search,
  Server,
  SlidersHorizontal,
  Square,
  Trash2,
  User,
  Wrench,
} from 'lucide-react';
import { Button, Modal } from '@mc-creator/ui';
import { ipcClient } from '../../lib/ipc-client.js';
import { useModStore } from '../../store/mod-store.js';
import {
  checkInstanceNameAgainst,
  type InstanceNameCheck,
} from '../../../../shared/instance-name.js';
import { ConfirmDialog } from '../ConfirmDialog.js';
import type { InstanceSummary, ServerInstanceSummary } from '../../../../shared/ipc/launcher.js';
import type { ProcessStatusT } from '../../../../shared/ipc/process-supervisor.js';
import { ContentTab } from './ContentTab.js';
import { DownloadTab } from './DownloadTab.js';
import { InstanceDirTab } from './InstanceDirTab.js';
import { SkinTab } from './SkinTab.js';
import { LogTab } from './LogTab.js';
import { WorldTab } from './WorldTab.js';

/** 设置 tab —— 并发下载线程数等 */
function SettingsTab({
  _versionId,
  maxParallelDownloads,
  onMaxParallelDownloadsChange,
}: {
  _versionId: string;
  maxParallelDownloads: number;
  onMaxParallelDownloadsChange: (v: number) => void;
}) {
  return (
    <div className="p-4 space-y-4 text-[11px]">
      <div>
        <label className="flex items-center gap-2 text-xs font-medium text-mc-text">
          <span>并发下载线程数</span>
          <select
            value={maxParallelDownloads}
            onChange={(e) => onMaxParallelDownloadsChange(Number(e.target.value))}
            className="mc-select w-20"
            aria-label="并发下载线程数"
          >
            {[1, 2, 4, 8, 16].map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <p className="mt-1 text-[10px] text-mc-text-dim">
          并发数越大下载越快，但可能占用更多带宽。默认 8（保守值）。
        </p>
      </div>
      <div className="pt-4 border-t border-mc-border">
        <p className="text-[10px] text-mc-text-dim">
          更多设置（如 Java 路径、内存默认值等）将在后续版本开放。
        </p>
      </div>
    </div>
  );
}

interface VersionEntry {
  id: string;
  type: string;
  releaseTime: string;
}

/**
 * 新建实例的默认版本。
 *
 * 版本清单按时间倒序，第一项往往是刚出的 snapshot；真正的玩家新建实例
 * 多半想要一个稳定版本，所以优先取清单里的最新 release，没有才退回第一项。
 */
function preferredVersionId(versions: VersionEntry[]): string {
  return versions.find((v) => v.type === 'release')?.id ?? versions[0]?.id ?? '';
}

/** 实例详情区的 tab（docs/launcher-window-architecture.md §4.3）。 */
type DetailTab = 'content' | 'files' | 'world' | 'logs' | 'skin' | 'share' | 'settings';

const DETAIL_TABS: { id: DetailTab; label: string }[] = [
  { id: 'content', label: '内容' },
  { id: 'files', label: '实例目录' },
  { id: 'world', label: '世界' },
  { id: 'logs', label: '日志' },
  { id: 'skin', label: '皮肤' },
  { id: 'share', label: '分享' },
  { id: 'settings', label: '设置' },
];

/**
 * 顶层视图（对齐 PCL 顶栏的「启动 / 下载 / 设置 / 更多」）。
 *
 * 为什么是**顶层**而不是详情区里的第六个 tab：版本下载与"某个实例"无关。
 * 详情区那 5 个 tab 全部以 ``selected`` 实例为作用域，把版本列表塞进去
 * 会造成"下载版本需要先选中一个实例"的错觉。
 */
type LauncherView = 'launch' | 'download' | 'server';

const VIEWS: {
  id: LauncherView;
  label: string;
  icon: typeof Gamepad2 | typeof Download | typeof Server;
}[] = [
  { id: 'launch', label: '启动', icon: Gamepad2 },
  { id: 'download', label: '下载', icon: Download },
  { id: 'server', label: '服务端', icon: Server },
];

/** 未实现的 tab 如实说明，不用假内容占位 —— 空壳比空白更误导。 */
const NOT_YET: Partial<Record<DetailTab, string>> = {
  share: '导出 mrpack / CurseForge 尚未实现（设计中为 L10）。',
};

/** 「从未游玩过」/「N 天前」——注册表 lastLaunchedAt 的 UI 投影（§4.2.2 ②）。 */
function lastPlayedLabel(inst: InstanceSummary): string {
  if (inst.lastLaunchedAt === undefined) return '从未游玩过';
  const days = Math.floor((Date.now() - inst.lastLaunchedAt) / 86_400_000);
  if (days <= 0) return '今天玩过';
  if (days === 1) return '昨天玩过';
  if (days < 30) return `${days} 天前玩过`;
  return `${Math.floor(days / 30)} 个月前玩过`;
}

/** 加载器的界面名。取值来自实例注册表，未知值按原版展示，不把内部 id 直接扔给用户。 */
function loaderLabel(loader: string): string {
  switch (loader) {
    case 'fabric':
      return 'Fabric';
    case 'neoforge':
      return 'NeoForge';
    case 'forge':
      return 'Forge';
    case 'quilt':
      return 'Quilt';
    default:
      return '原版';
  }
}

/**
 * 游戏启动器面板（L2「实例轨 + 启动驾驶舱」）。
 *
 * 结构依据 docs/launcher-window-architecture.md §4.2：
 *  - 左侧实例轨：搜索 + 垂直列表 + 独立的新建入口；不再和「快速开始」重复两套卡片
 *  - 右侧启动驾驶舱：实例身份、主启动按钮、运行状态、启动参数与工具
 *  - 详情 tab 留在当前实例作用域内；下载 / 服务端仍是与实例无关的顶层视图
 *  - 错误统一在驾驶舱顶部；离线已有安装收进独立的次级弹窗（§4.2.4）
 *
 * 启动按钮吃四种就绪态（§4.5）：无实例 / 未下载 / 就绪 / 运行中。
 * 判据由 LAUNCHER_LIST_INSTANCES 一次返回的 `clientReady` 给出，
 * **不在渲染层逐实例探盘** —— 否则实例多了会 N 次 IPC 往返。
 */
export function GameLauncherPanel() {
  const [view, setView] = useState<LauncherView>('launch');
  const [versions, setVersions] = useState<VersionEntry[]>([]);
  const [instances, setInstances] = useState<InstanceSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailTab, setDetailTab] = useState<DetailTab>('content');
  const [query, setQuery] = useState('');
  const [loadingInstances, setLoadingInstances] = useState(false);
  const [loadingVersions, setLoadingVersions] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [downloadStatus, setDownloadStatus] = useState('');
  const [launching, setLaunching] = useState(false);
  const [runningPid, setRunningPid] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  /**
   * 加载错误按来源**分开存**，不能合并成一个。
   *
   * 挂载瞬间 `loadInstances` 与 `loadVersions` 并发跑：若共用一个 state，
   * 实例列表失败设了错误，版本清单随后成功执行 `setError(null)`，
   * 报错被静默吞掉 —— 正是「统一错误横幅」要消灭的那类丢失。
   * 分成两个槽后两者互不干扰，展示时再合并（用户操作的错误优先）。
   */
  const [instancesError, setInstancesError] = useState<string | null>(null);
  const [versionsError, setVersionsError] = useState<string | null>(null);
  const listError = instancesError ?? versionsError;

  // 新建实例 / 删除确认
  const [newInstanceOpen, setNewInstanceOpen] = useState(false);
  const [newVersion, setNewVersion] = useState('');
  const [newName, setNewName] = useState('');
  const [newInstanceError, setNewInstanceError] = useState<string | null>(null);
  const [creatingInstance, setCreatingInstance] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<InstanceSummary | null>(null);

  // 当前运行的是哪个实例。只有 PID 不够：选中别的实例时不能把「运行中」错贴到它头上。
  const [runningInstanceId, setRunningInstanceId] = useState<string | null>(null);

  // 离线已有安装（次级弹窗，默认关闭）
  const [secondaryOpen, setSecondaryOpen] = useState(false);

  // 启动设置默认收起：首屏优先露出「开始游戏」和详情内容，需要时再展开。
  const [settingsOpen, setSettingsOpen] = useState(false);

  // 加载器 / 皮肤
  const [installingLoader, setInstallingLoader] = useState(false);
  const [skinInstalling, setSkinInstalling] = useState(false);
  const [skinApiUrl, setSkinApiUrl] = useState('https://littleskin.cn/api/yggdrasil');

  // 离线已有安装的表单状态（展示容器是上面的 secondaryOpen 弹窗）
  const [offlineDir, setOfflineDir] = useState<string | null>(null);
  const [offlineStatus, setOfflineStatus] = useState<'idle' | 'locating' | 'found' | 'error'>(
    'idle',
  );
  const [offlineError, setOfflineError] = useState<string | null>(null);
  const [offlineMsg, setOfflineMsg] = useState<string | null>(null);
  const [offlineInstalling, setOfflineInstalling] = useState(false);
  const [offlineLaunching, setOfflineLaunching] = useState(false);

  // 服务端实例管理
  const [serverInstances, setServerInstances] = useState<ServerInstanceSummary[]>([]);
  const [serverLoading, setServerLoading] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [serverCreating, setServerCreating] = useState(false);
  const [serverDeleting, setServerDeleting] = useState<string | null>(null);
  const [serverLaunching, setServerLaunching] = useState<string | null>(null);
  const [serverStopping, setServerStopping] = useState<string | null>(null);
  /**
   * 服务端创建表单由 React 状态驱动。
   *
   * 旧实现把版本写进 `input.dataset.version`，再在按钮里用
   * `document.querySelector('select')` 读回来；但那个 `<select value="">`
   * 是受控的，选完立刻被 React 重置成空串 —— 点「创建」时判断
   * `select?.value` 永远为假，于是**按钮静默无反应**（实测）。
   * 表单状态必须和受控元素放在同一处，不能借 DOM 当变量。
   */
  const [serverName, setServerName] = useState('');
  const [serverVersion, setServerVersion] = useState('');
  /**
   * 服务端进程快照。`launchServer` 只返回 pid，真正的 `starting → running`
   * / `crashed` 是主进程异步事件；不订阅的话卡片永远显示「启动」，
   * 用户既看不到运行中，也看不到崩溃原因。
   */
  const [serverStatuses, setServerStatuses] = useState<Record<string, ProcessStatusT>>({});
  /**
   * 服务端启动用的 Java。留空时优先借用同版本客户端实例的 javaPath，
   * 再退回 PATH —— 实测系统 PATH 里的 Java 23 跑 26.3 会直接
   * UnsupportedClassVersionError（class 69 需要 JDK 25）。
   */
  const [serverJavaPath, setServerJavaPath] = useState<string>(() => {
    try {
      return localStorage.getItem('mc-creator.serverJavaPath') ?? '';
    } catch {
      return '';
    }
  });

  // 设置：并发下载线程数
  const [maxParallelDownloads, setMaxParallelDownloads] = useState(8);

  const jarPath = useModStore((s) => {
    const jar = s.files.find((f) => f.path.endsWith('.jar'));
    return jar ? jar.path : null;
  });

  const selected = useMemo(
    () => instances.find((i) => i.id === selectedId) ?? null,
    [instances, selectedId],
  );

  /**
   * 新实例名的校验必须和下载页共用同一套规则：
   * 实例 id 直接当目录名，撞名会「就地更新」另一个实例的版本。
   */
  const newNameCheck = useMemo<InstanceNameCheck>(() => {
    if (!newVersion) return {};
    const desired = newName.length > 0 ? newName : newVersion;
    return checkInstanceNameAgainst(desired, newVersion, instances);
  }, [newVersion, newName, instances]);

  const loadInstances = useCallback(async () => {
    setLoadingInstances(true);
    try {
      const res = await ipcClient.launcherListInstances();
      if (res.error) setInstancesError(res.error);
      else {
        setInstances(res.instances ?? []);
        setInstancesError(null);
      }
    } catch (e) {
      setInstancesError((e as Error).message);
    } finally {
      setLoadingInstances(false);
    }
  }, []);

  const loadVersions = useCallback(async () => {
    setLoadingVersions(true);
    try {
      const res = await ipcClient.launcherListVersions();
      if (res.error) setVersionsError(res.error);
      else {
        setVersions(res.versions ?? []);
        setVersionsError(null);
      }
    } catch (e) {
      setVersionsError((e as Error).message);
    } finally {
      setLoadingVersions(false);
    }
  }, []);

  const loadServerInstances = useCallback(async () => {
    setServerLoading(true);
    setServerError(null);
    try {
      const res = await ipcClient.launcherListServerInstances();
      // 信封 `{ instances, error }` —— 不是裸数组（见 ipc-client 上的注释）
      setServerInstances(res.instances);
      setServerError(null);
    } catch (e) {
      setServerError((e as Error).message);
    } finally {
      setServerLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadInstances();
    void loadVersions();
    void loadServerInstances();
  }, [loadInstances, loadVersions, loadServerInstances]);

  /**
   * 服务端页签可见时同步进程状态，并持续订阅状态事件。
   *
   * 状态必须从主进程拿：spawn 成功不等于能跑，服务端会在启动后几秒
   * 因 Java 版本、EULA、端口占用等原因退出；这些只有 supervisor 知道。
   */
  useEffect(() => {
    if (view !== 'server') return;
    let cancelled = false;
    const stop = ipcClient.onProcessState((event) => {
      if (!cancelled) {
        setServerStatuses((prev) => ({ ...prev, [event.serverId]: event.status }));
      }
    });
    void (async () => {
      try {
        const entries = await Promise.all(
          serverInstances.map(async (inst) => {
            const res = await ipcClient.processStatus(inst.id);
            return res.status ? ([inst.id, res.status] as const) : null;
          }),
        );
        if (cancelled) return;
        setServerStatuses((prev) => {
          const next = { ...prev };
          for (const entry of entries) if (entry) next[entry[0]] = entry[1];
          return next;
        });
      } catch (e) {
        if (!cancelled) setServerError((e as Error).message);
      }
    })();
    return () => {
      cancelled = true;
      stop();
    };
  }, [view, serverInstances]);

  /**
   * 实例轨按「最近游玩」排序，而不是盲信注册表返回顺序。
   *
   * 真实数据里 26.4 快照排在「今天玩过」的 FO 前面；如果直接取 `instances[0]`，
   * 打开启动器会选中一个从没玩过的实例，主按钮看起来能点但并不是用户想要的。
   * 最近启动时间相同的（都没玩过）按名字稳定排序，避免每次刷新跳来跳去。
   */
  const orderedInstances = useMemo(() => {
    return [...instances].sort((a, b) => {
      const at = a.lastLaunchedAt ?? 0;
      const bt = b.lastLaunchedAt ?? 0;
      if (bt !== at) return bt - at;
      return a.name.localeCompare(b.name, 'zh-Hans-CN');
    });
  }, [instances]);

  /**
   * 默认选中最近在用的实例。
   *
   * 没有这一步时，用户打开启动器只会看到空驾驶舱 —— 明明实例都在，
   * 却要再点一次才能看到「开始游戏」。选中项消失（被删）时回落到第一个。
   */
  useEffect(() => {
    if (orderedInstances.length === 0) {
      setSelectedId(null);
      return;
    }
    setSelectedId((prev) =>
      prev !== null && orderedInstances.some((i) => i.id === prev)
        ? prev
        : (orderedInstances[0]?.id ?? null),
    );
  }, [orderedInstances]);

  // 切换实例时清掉上一个实例留下的状态文案，避免「已退出」贴到另一个实例上。
  useEffect(() => {
    setDownloadStatus('');
  }, [selectedId]);

  // 版本清单可能比弹窗晚到；到了就补上默认版本，用户不用手动再选一次。
  useEffect(() => {
    if (newInstanceOpen && !newVersion && versions.length > 0) {
      setNewVersion(preferredVersionId(versions));
    }
  }, [newInstanceOpen, newVersion, versions]);

  /**
   * 游戏退出后清掉「运行中」。
   *
   * 没有这个订阅时，关掉游戏后按钮会一直停在「运行中 <pid>」，
   * `launchInstance` 开头的 `if (runningPid !== null) return` 会让
   * 用户再也点不动「开始游戏」，只能重启应用。
   */
  useEffect(
    () =>
      ipcClient.onLauncherGameExit((event) => {
        setRunningPid(null);
        setRunningInstanceId(null);
        setDownloadStatus(
          event.code === 0 || event.code === null
            ? '游戏已退出'
            : `游戏已退出（退出码 ${event.code}）`,
        );
        // 「最近游玩」由主进程写入，退出时刷新一次让排序和文案跟着变
        void loadInstances();
      }),
    [loadInstances],
  );

  /** 打开新建实例弹窗，并把默认版本对齐到最新正式版。 */
  const openNewInstance = () => {
    setNewVersion(preferredVersionId(versions));
    setNewName('');
    setNewInstanceError(null);
    setNewInstanceOpen(true);
  };

  /** 按版本新建实例。create 对同 id 幂等覆盖，所以「下载后再建」也是安全的。 */
  const createInstance = async (versionId: string, name?: string) => {
    setNewInstanceError(null);
    setCreatingInstance(true);
    try {
      const res = await ipcClient.launcherCreateInstance({ versionId, name });
      if (res.error) {
        setNewInstanceError(res.error);
      } else {
        await loadInstances();
        setSelectedId(res.instance?.id ?? versionId);
        setNewInstanceOpen(false);
        setNewName('');
        setNewVersion('');
      }
    } catch (e) {
      setNewInstanceError((e as Error).message);
    } finally {
      setCreatingInstance(false);
    }
  };

  /**
   * 启动按钮的状态机（§4.5）：一个按钮吃掉「未下载 → 自动下载 → 启动」。
   * 未就绪时先下载再启动，就绪时直接启动。
   */
  const launchInstance = async (inst: InstanceSummary) => {
    if (runningPid !== null) return;
    setError(null);
    if (!inst.clientReady) {
      setDownloading(true);
      setDownloadStatus(`正在为 ${inst.name} 下载客户端…`);
      try {
        const dl = await ipcClient.launcherDownload({
          version: inst.versionId,
          // 更新**这个实例**（不新建）：它的名字与 gameDir 都要保持不变
          instanceId: inst.id,
        });
        if (dl.error) {
          setError(dl.error ?? '下载失败');
          return;
        }
        await loadInstances();
      } catch (e) {
        setError((e as Error).message);
        return;
      } finally {
        setDownloading(false);
        setDownloadStatus('');
      }
    }
    setLaunching(true);
    try {
      const res = await ipcClient.launcherLaunch({
        // 传**实例 id**，不是版本号 —— 主进程据此拿 versionId（跑哪个 jar）
        // 与 gameDir（mods / 存档在哪）。两者多实例之后不再相等。
        instance: inst.id,
        username: inst.username ?? 'Steve',
        memory: inst.memory ?? '2G',
      });
      if (res.error) setError(res.error);
      else if (res.pid > 0) {
        setRunningPid(res.pid);
        setRunningInstanceId(inst.id);
        setDownloadStatus(`游戏已启动（PID ${res.pid}）`);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLaunching(false);
    }
  };

  const deleteInstance = async (inst: InstanceSummary) => {
    setError(null);
    try {
      const res = await ipcClient.launcherDeleteInstance({ id: inst.id, deleteFiles: false });
      if (!res.ok || res.error) setError(res.error || '删除失败');
      else {
        if (selectedId === inst.id) setSelectedId(null);
        await loadInstances();
      }
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const openInstanceFolder = async (inst: InstanceSummary) => {
    setError(null);
    try {
      const res = await ipcClient.launcherOpenInstanceFolder({ id: inst.id });
      if (!res.ok || res.error) setError(res.error || '打开实例目录失败');
    } catch (e) {
      setError((e as Error).message);
    }
  };

  /** 用文件选择器挑 java.exe，省得用户手打路径。 */
  const chooseJavaPath = async (inst: InstanceSummary) => {
    setError(null);
    try {
      const picked = await ipcClient.launcherPickFiles({
        title: '选择 Java 可执行文件（java / java.exe）',
        properties: ['openFile'],
      });
      if (picked.error) {
        setError(picked.error);
        return;
      }
      const javaPath = picked.paths[0];
      if (!javaPath) return;
      const res = await ipcClient.launcherUpdateInstance({
        id: inst.id,
        patch: { javaPath },
      });
      if (!res.ok || res.error) setError(res.error || '保存 Java 路径失败');
      else await loadInstances();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  /** 服务端 Java 路径是启动器级偏好；存 localStorage，重启后仍生效。 */
  const updateServerJavaPath = (value: string): void => {
    setServerJavaPath(value);
    try {
      localStorage.setItem('mc-creator.serverJavaPath', value);
    } catch {
      // 隐私模式/配额满时仍允许本次启动使用，不阻断
    }
  };

  const chooseServerJavaPath = async (): Promise<void> => {
    setServerError(null);
    try {
      const picked = await ipcClient.launcherPickFiles({
        title: '选择服务端 Java 可执行文件（java / java.exe）',
        properties: ['openFile'],
      });
      if (picked.error) {
        setServerError(picked.error);
        return;
      }
      const javaPath = picked.paths[0];
      if (javaPath) updateServerJavaPath(javaPath);
    } catch (e) {
      setServerError((e as Error).message);
    }
  };

  /**
   * 决定服务端用哪个 Java：
   *   1. 用户在本页显式选的；
   *   2. 同版本客户端实例的 javaPath（用户只为客户端配一次时也能跑）；
   *   3. 留空，交给 PATH —— 这条路最容易踩坑（实测 PATH 里的 Java 23
   *      跑 26.3 直接 UnsupportedClassVersionError），所以 UI 上写明风险，
   *      崩了也能在卡片日志里看到原因。
   */
  const javaPathForServer = (inst: ServerInstanceSummary): string | undefined => {
    const explicit = serverJavaPath.trim();
    if (explicit !== '') return explicit;
    const sameVersion = instances.find((i) => i.versionId === inst.versionId && i.javaPath);
    return sameVersion?.javaPath;
  };

  /** 服务端 Java 回退链的说明文字（让人一眼看出会用哪个 java）。 */
  const serverJavaHint = useMemo(() => {
    if (serverJavaPath.trim() !== '') return `将使用：${serverJavaPath.trim()}`;
    const paths = Array.from(
      new Set(instances.map((i) => i.javaPath).filter((p): p is string => !!p)),
    );
    if (paths.length === 0) {
      return '未设置：启动时用系统 PATH 的 java（新版 MC 需要 JDK 25+，建议显式指定）';
    }
    return `未设置：优先用同版本客户端实例的 Java（${paths.join('、')}），否则用系统 PATH`;
  }, [serverJavaPath, instances]);
  // 服务端实例管理
  const createServerInstance = async (serverId: string, version: string) => {
    setServerError(null);
    setServerCreating(true);
    // 先弹 EULA 确认（不代用户勾选）
    const confirmed = window.confirm(
      `即将为 ${version} 创建服务端实例「${serverId}」。\n\n` +
        `\u26A0\uFE0F 你需要接受 Minecraft EULA：\nhttps://aka.ms/MinecraftEULA\n\n` +
        `点击「确定」表示你已阅读并同意 EULA。`,
    );
    if (!confirmed) {
      setServerCreating(false);
      return;
    }
    try {
      const res = await ipcClient.launcherCreateServerInstance({
        serverId,
        version,
        acceptEula: true,
      });
      if (res.error) {
        setServerError(res.error);
      } else {
        setDownloadStatus(
          `服务端实例「${serverId}」已创建${res.jarLinked ? '（硬链接，不占额外空间）' : '（复制 jar）'}`,
        );
        // 成功后才清空，失败时保留用户填的内容，方便改个名字重试。
        setServerName('');
        setServerVersion('');
        await loadServerInstances();
      }
    } catch (e) {
      setServerError((e as Error).message);
    } finally {
      setServerCreating(false);
    }
  };

  /** 表单校验放在提交处：空名字/空版本不弹 EULA，也不发 IPC。 */
  const submitServerCreate = (): void => {
    const id = serverName.trim();
    if (id === '') {
      setServerError('请填写服务端实例名');
      return;
    }
    if (serverVersion === '') {
      setServerError('请选择 MC 版本');
      return;
    }
    void createServerInstance(id, serverVersion);
  };

  const refreshServerStatus = async (serverId: string): Promise<void> => {
    try {
      const res = await ipcClient.processStatus(serverId);
      const status = res.status;
      if (status) {
        setServerStatuses((prev) => ({ ...prev, [serverId]: status }));
      }
    } catch {
      // 状态查询失败不覆盖启动结果；事件通道仍会继续推送
    }
  };

  const deleteServerInstance = async (serverId: string, deleteFiles: boolean) => {
    setServerError(null);
    setServerDeleting(serverId);
    try {
      const res = await ipcClient.launcherDeleteServerInstance({ id: serverId, deleteFiles });
      if (res.error) {
        setServerError(res.error);
      } else {
        setDownloadStatus(`服务端实例「${serverId}」已删除`);
        setServerStatuses((prev) => {
          const next = { ...prev };
          delete next[serverId];
          return next;
        });
        await loadServerInstances();
      }
    } catch (e) {
      setServerError((e as Error).message);
    } finally {
      setServerDeleting(null);
    }
  };

  const launchServerInstance = async (serverId: string, javaPath?: string, memory?: string) => {
    setServerError(null);
    setServerLaunching(serverId);
    try {
      const res = await ipcClient.processLaunch({ serverId, javaPath, memory });
      // denied 与 error 会同时存在（error 是给日志看的说明），
      // 必须先判 denied，否则用户明明点了取消却看到一条红色「失败」。
      if (res.denied) {
        setDownloadStatus('已取消启动');
      } else if (res.error) {
        setServerError(res.error);
      } else if (res.pid) {
        setDownloadStatus(`服务端已启动（PID ${res.pid}）`);
      }
    } catch (e) {
      setServerError((e as Error).message);
    } finally {
      setServerLaunching(null);
      void refreshServerStatus(serverId);
    }
  };

  const stopServerInstance = async (serverId: string) => {
    setServerError(null);
    setServerStopping(serverId);
    try {
      const res = await ipcClient.processStop(serverId);
      if (res.denied) {
        setDownloadStatus('已取消停止');
      } else if (res.error) {
        setServerError(res.error);
      } else if (res.stop) {
        const how = res.stop.graceful ? '已优雅停止' : '已强制停止';
        const port = res.stop.portTimedOut ? '（端口仍被占用）' : '';
        setDownloadStatus(`服务端「${serverId}」${how}${port}`);
      } else {
        setDownloadStatus(`服务端「${serverId}」当前未在运行`);
      }
    } catch (e) {
      setServerError((e as Error).message);
    } finally {
      setServerStopping(null);
      void refreshServerStatus(serverId);
    }
  };
  const handleInstallLoader = async (loader: 'fabric' | 'neoforge') => {
    if (!selected) return;
    setInstallingLoader(true);
    setError(null);
    try {
      // `version` 决定加载器档案装进哪个 versions/ 目录（版本级共享），
      // `instance` 决定同步更新哪个实例的 loader 字段 ——
      // 少传后者的话装完界面仍显示原版，启动时又跑成原版。
      const res = await ipcClient.launcherInstallLoader({
        version: selected.versionId,
        loader,
        instance: selected.id,
      });
      if (res.error) {
        setError(res.error);
      } else {
        setDownloadStatus(`${loader === 'fabric' ? 'Fabric' : 'NeoForge'} 加载器安装完成`);
        // 主进程会更新实例的 loader 字段；不刷新的话界面仍显示「原版」，
        // 用户会以为装失败了，下一次启动也担心跑错档案。
        await loadInstances();
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setInstallingLoader(false);
    }
  };

  const handleInstallSkin = async () => {
    if (!selected) return;
    setSkinInstalling(true);
    setError(null);
    try {
      const res = await ipcClient.launcherInstallSkin({
        instance: selected.id,
        skinApiUrl,
      });
      if (res.error) setError(res.error);
      else setDownloadStatus('离线皮肤支持已安装（CustomSkinLoader）');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSkinInstalling(false);
    }
  };

  const locateOffline = async () => {
    setOfflineStatus('locating');
    setOfflineError(null);
    setOfflineMsg(null);
    try {
      const res = await ipcClient.locateMc();
      if (res.found && res.mcDir) {
        setOfflineDir(res.mcDir);
        setOfflineStatus('found');
        setOfflineMsg(`已定位：${res.mcDir}`);
      } else {
        setOfflineStatus('error');
        setOfflineError(res.error ?? '未找到 Minecraft 安装');
      }
    } catch (e) {
      setOfflineStatus('error');
      setOfflineError((e as Error).message);
    }
  };

  const chooseOfflineDir = async () => {
    const res = await ipcClient.chooseMcDir();
    if (res.path) {
      setOfflineDir(res.path);
      setOfflineStatus('found');
      setOfflineError(null);
      setOfflineMsg(`已选择：${res.path}`);
    }
  };

  const installModToOffline = async () => {
    if (!jarPath || !offlineDir) return;
    setOfflineInstalling(true);
    setOfflineError(null);
    setOfflineMsg(null);
    try {
      const res = await ipcClient.installMod(jarPath, offlineDir);
      if (res.ok) setOfflineMsg(`已安装到 ${res.modsDir ?? 'mods 目录'}`);
      else setOfflineError(res.error ?? '安装失败');
    } catch (e) {
      setOfflineError((e as Error).message);
    } finally {
      setOfflineInstalling(false);
    }
  };

  const launchOffline = async () => {
    if (!offlineDir) return;
    setOfflineLaunching(true);
    setOfflineError(null);
    setOfflineMsg(null);
    try {
      const res = await ipcClient.launchMc(offlineDir);
      if (res.ok) setOfflineMsg('Minecraft 已启动');
      else setOfflineError(res.error ?? '启动失败');
    } catch (e) {
      setOfflineError((e as Error).message);
    } finally {
      setOfflineLaunching(false);
    }
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? orderedInstances.filter((i) => i.name.toLowerCase().includes(q)) : orderedInstances;
  }, [orderedInstances, query]);

  const selectedRunning =
    selected !== null && runningPid !== null && runningInstanceId === selected.id;
  const runningElsewhere = runningPid !== null && !selectedRunning;
  const busy = downloading || launching;

  const launchButtonLabel = !selected
    ? '开始游戏'
    : launching
      ? '正在启动…'
      : downloading
        ? '正在下载…'
        : selectedRunning
          ? `运行中 ${runningPid}`
          : selected.clientReady
            ? '开始游戏'
            : '下载并启动';

  const statusMessage = !selected
    ? ''
    : launching
      ? '正在启动游戏…'
      : downloading
        ? `正在为 ${selected.name} 下载客户端…`
        : selectedRunning
          ? `游戏运行中 · PID ${runningPid}`
          : runningElsewhere
            ? `另一个实例正在运行（PID ${runningPid}）`
            : downloadStatus ||
              (selected.clientReady ? '客户端已就绪' : '客户端未下载，首次启动会自动下载');

  const statusTone =
    runningElsewhere || launching || downloading || !selected?.clientReady
      ? 'text-mc-gold'
      : downloadStatus.includes('退出码')
        ? 'text-mc-redstone'
        : 'text-mc-accent';

  const statusDot =
    selectedRunning || runningElsewhere
      ? 'animate-pulse bg-mc-gold'
      : selected?.clientReady
        ? 'bg-mc-accent'
        : 'bg-mc-gold';

  return (
    <div className="flex h-full flex-col bg-mc-surface">
      <div className="mc-section-title flex items-center gap-2 border-b border-mc-border">
        <Gamepad2 className="h-4 w-4" /> 游戏启动器
        <span className="mc-tag text-[10px]">离线模式</span>
        <span className="ml-auto hidden text-[10px] text-mc-mute sm:inline">
          实例与版本保存在 userData/mc-launcher
        </span>
      </div>

      {/* 顶层视图切换：对齐 PCL 顶栏。下载与服务端和某个实例无关，故不塞进详情区 tab。 */}
      <div
        className="flex gap-1 border-b border-mc-border px-2 py-1.5"
        role="tablist"
        aria-label="启动器视图"
      >
        {VIEWS.map((v) => {
          const Icon = v.icon;
          const active = view === v.id;
          return (
            <button
              key={v.id}
              role="tab"
              aria-selected={active}
              onClick={() => setView(v.id)}
              className={`flex items-center gap-1.5 rounded-mc px-3 py-1 text-xs ${
                active ? 'bg-mc-accent/15 text-mc-accent' : 'text-mc-text-dim hover:bg-mc-hover'
              }`}
            >
              <Icon className="h-3 w-3" />
              {v.label}
            </button>
          );
        })}
      </div>

      {view === 'download' ? (
        <div className="flex flex-1 overflow-y-auto p-3">
          <DownloadTab />
        </div>
      ) : view === 'server' ? (
        <div className="flex-1 space-y-4 overflow-y-auto p-3">
          {serverError && (
            <div
              role="alert"
              className="rounded-mc border border-mc-redstone/30 bg-mc-redstone/10 px-3 py-2 text-[11px] text-mc-redstone"
            >
              {serverError}
            </div>
          )}
          {downloadStatus && (
            <div className="rounded-mc border border-mc-accent/30 bg-mc-accent/10 px-3 py-2 text-[11px] text-mc-accent">
              {downloadStatus}
            </div>
          )}

          {/* 创建服务端实例 */}
          <section>
            <div className="mb-2 flex items-center gap-2">
              <span className="text-xs font-medium text-mc-text">创建服务端实例</span>
            </div>
            <div className="flex items-center gap-2">
              <input
                value={serverName}
                onChange={(e) => setServerName(e.target.value)}
                placeholder="实例名（如 my-server）"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    submitServerCreate();
                  }
                }}
                className="mc-input flex-1"
                aria-label="服务端实例名"
              />
              <select
                value={serverVersion}
                onChange={(e) => setServerVersion(e.target.value)}
                className="mc-select w-48"
                aria-label="选择 MC 版本"
              >
                <option value="">选择版本…</option>
                {versions.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.id}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={submitServerCreate}
                disabled={serverCreating}
                className="mc-btn-primary"
              >
                {serverCreating ? <Loader2 className="h-3 w-3 animate-spin" /> : '创建'}
              </button>
            </div>
          </section>

          {/* 服务端 Java：不是每个实例都要单独配，但 PATH 里的 Java 可能版本不对 */}
          <section>
            <div className="mb-1.5 flex items-center gap-2">
              <span className="text-xs font-medium text-mc-text">服务端 Java</span>
              <span className="text-[10px] text-mc-mute">
                留空时借用同版本客户端实例的 Java；再退回 PATH
              </span>
            </div>
            <div className="flex items-center gap-2">
              <input
                value={serverJavaPath}
                onChange={(e) => updateServerJavaPath(e.target.value)}
                placeholder="D:\\Java\\jdk-25\\bin\\java.exe（新版 MC 需要 JDK 25+）"
                className="mc-input flex-1 font-mono text-[11px]"
                aria-label="服务端 Java 路径"
              />
              <button
                type="button"
                onClick={() => void chooseServerJavaPath()}
                className="mc-btn-ghost"
              >
                <FolderOpen className="h-3 w-3" /> 选择
              </button>
            </div>
            <div className="mt-1 text-[10px] text-mc-mute">{serverJavaHint}</div>
          </section>

          {/* 实例列表 */}
          {serverLoading ? (
            <div className="py-4 text-center text-[11px] text-mc-mute">读取服务端实例列表…</div>
          ) : serverInstances.length === 0 ? (
            <div className="rounded-mc border border-mc-border bg-mc-surface-2 p-3 text-[11px] text-mc-mute">
              服务端实例库为空。先用上面的表单创建一个实例（需先在「下载」页下载对应版本的服务端
              jar）。
            </div>
          ) : (
            <section>
              <div className="mb-2 text-xs font-medium text-mc-text">
                服务端实例（{serverInstances.length}）
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {serverInstances.map((inst) => {
                  const status = serverStatuses[inst.id];
                  const state = status?.state ?? 'stopped';
                  const isRunning = state === 'running';
                  const isStarting = state === 'starting';
                  const isStopping = state === 'stopping';
                  const isCrashed = state === 'crashed';
                  const isBusy = serverLaunching !== null || serverStopping !== null || isStopping;
                  const stateLabel = isRunning
                    ? '运行中'
                    : isStarting
                      ? '启动中'
                      : isStopping
                        ? '停止中'
                        : isCrashed
                          ? '已崩溃'
                          : '未运行';
                  const stateTone = isRunning
                    ? 'text-mc-accent'
                    : isCrashed
                      ? 'text-mc-redstone'
                      : isStarting || isStopping
                        ? 'text-mc-gold'
                        : 'text-mc-mute';
                  const lastLines = status?.lastLogLines ?? [];
                  return (
                    <div key={inst.id} className="mc-card p-3">
                      <div className="flex items-center justify-between gap-2">
                        <div className="truncate font-medium text-mc-text">{inst.name}</div>
                        <span className={`mc-tag text-[10px] ${stateTone}`}>{stateLabel}</span>
                      </div>
                      <div className="mt-1 text-[10px] text-mc-mute">
                        {inst.versionId} · {inst.eulaAccepted ? '已同意 EULA' : '未同意 EULA'}
                      </div>
                      <div className="mt-1 flex items-center gap-2 text-[10px] text-mc-mute">
                        {status?.pid != null && (isRunning || isStarting || isStopping) && (
                          <span className="font-mono">PID {status.pid}</span>
                        )}
                        {isCrashed && status?.exitCode != null && (
                          <span className="text-mc-redstone">退出码 {status.exitCode}</span>
                        )}
                        {isCrashed && lastLines.length > 0 && (
                          <span
                            className="truncate font-mono text-mc-redstone/80"
                            title={lastLines[lastLines.length - 1]}
                          >
                            {lastLines[lastLines.length - 1]}
                          </span>
                        )}
                      </div>
                      <div className="mt-2 flex items-center gap-2">
                        <button
                          onClick={() =>
                            void launchServerInstance(inst.id, javaPathForServer(inst))
                          }
                          disabled={isBusy || isRunning || isStarting || isStopping}
                          className="mc-btn-primary flex-1"
                        >
                          {serverLaunching === inst.id || isStarting ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <Play className="h-3 w-3" />
                          )}
                          {serverLaunching === inst.id || isStarting
                            ? '启动中…'
                            : isRunning
                              ? '运行中'
                              : isCrashed
                                ? '重新启动'
                                : '启动'}
                        </button>
                        {(isRunning || isStarting) && (
                          <button
                            onClick={() => void stopServerInstance(inst.id)}
                            disabled={serverStopping !== null || isStopping}
                            className="mc-btn-ghost"
                            title="停止服务端（先发送 stop，超时才强制结束）"
                          >
                            {serverStopping === inst.id ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <Square className="h-3 w-3" />
                            )}
                            停止
                          </button>
                        )}
                        <button
                          onClick={() =>
                            window.confirm(`确定删除「${inst.name}」？`) &&
                            void deleteServerInstance(inst.id, false)
                          }
                          disabled={
                            serverDeleting === inst.id || isRunning || isStarting || isStopping
                          }
                          className="mc-btn-ghost"
                          title="删除实例记录（保留存档/插件/配置）"
                        >
                          {serverDeleting === inst.id ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <Trash2 className="h-3 w-3" />
                          )}
                        </button>
                      </div>
                      {lastLines.length > 0 && (
                        <details className="mt-2">
                          <summary className="cursor-pointer text-[10px] text-mc-mute hover:text-mc-text-dim">
                            最近日志（{lastLines.length} 行）
                          </summary>
                          <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap break-all rounded-mc border border-mc-border bg-mc-surface-2 p-2 font-mono text-[9px] leading-relaxed text-mc-text-dim">
                            {lastLines.slice(-20).join('\n')}
                          </pre>
                        </details>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          )}
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col min-[720px]:flex-row">
          {/* 实例轨：搜索、选择、新建都在这里，不再和「快速开始」重复一遍 */}
          <aside className="flex w-full shrink-0 flex-col border-b border-mc-border bg-mc-surface min-[720px]:w-60 min-[720px]:border-b-0 min-[720px]:border-r">
            <div className="border-b border-mc-border p-2.5">
              <div className="mb-2 flex items-center gap-2">
                <span className="text-xs font-medium text-mc-text">实例库</span>
                {instances.length > 0 && (
                  <span className="text-[10px] text-mc-mute">（{instances.length}）</span>
                )}
                <button
                  onClick={openNewInstance}
                  aria-label="新建实例"
                  title="新建实例"
                  className="mc-btn-ghost ml-auto !h-6 !w-6 !px-0"
                >
                  <Plus className="h-3.5 w-3.5" />
                </button>
              </div>
              <div className="relative">
                <Search className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-mc-mute" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="搜索实例…"
                  aria-label="搜索实例"
                  className="mc-input pl-7 text-xs"
                />
              </div>
            </div>

            <div className="max-h-64 overflow-y-auto p-2 min-[720px]:min-h-0 min-[720px]:max-h-none min-[720px]:flex-1">
              {loadingInstances && instances.length === 0 ? (
                <div className="py-4 text-center text-[11px] text-mc-mute">读取实例列表…</div>
              ) : filtered.length === 0 ? (
                <div className="rounded-mc border border-dashed border-mc-border p-3 text-[11px] leading-relaxed text-mc-mute">
                  {instances.length === 0 ? (
                    <>
                      <span className="block text-mc-text-dim">实例库为空</span>
                      <span className="mt-1 block">新建一个实例，或到「下载」页获取版本。</span>
                    </>
                  ) : (
                    `没有匹配「${query}」的实例`
                  )}
                </div>
              ) : (
                <ul role="list" aria-label="实例列表" className="space-y-1">
                  {filtered.map((inst) => {
                    const active = selectedId === inst.id;
                    const running = runningPid !== null && runningInstanceId === inst.id;
                    return (
                      <li key={inst.id}>
                        <button
                          onClick={() => setSelectedId(inst.id)}
                          onDoubleClick={() => void launchInstance(inst)}
                          aria-pressed={active}
                          className={`group relative flex w-full items-start gap-2 rounded-mc border px-2 py-2 text-left transition-colors ${
                            active
                              ? 'border-mc-accent/40 bg-mc-accent/10'
                              : 'border-transparent hover:border-mc-border hover:bg-mc-surface-2'
                          } ${inst.clientReady ? '' : 'opacity-60'}`}
                        >
                          <span
                            aria-hidden="true"
                            className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${
                              running
                                ? 'animate-pulse bg-mc-gold'
                                : inst.clientReady
                                  ? 'bg-mc-accent'
                                  : 'bg-mc-mute'
                            }`}
                          />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[11px] font-medium text-mc-text">
                              {inst.name}
                            </span>
                            <span className="mt-0.5 block truncate text-[10px] text-mc-text-dim">
                              {loaderLabel(inst.loader)} {inst.versionId}
                            </span>
                            <span className="mt-0.5 block truncate text-[10px] text-mc-mute">
                              {running ? `运行中 · PID ${runningPid}` : lastPlayedLabel(inst)}
                            </span>
                          </span>
                          {!inst.clientReady && (
                            <span className="mc-tag shrink-0 text-[9px]">未下载</span>
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            <div className="border-t border-mc-border p-2">
              <button
                onClick={() => setSecondaryOpen(true)}
                aria-expanded={secondaryOpen}
                aria-haspopup="dialog"
                className="flex w-full items-center gap-2 rounded-mc border border-transparent px-2 py-1.5 text-left text-mc-dim transition-colors hover:border-mc-border hover:bg-mc-surface-2 hover:text-mc-text"
              >
                <FolderOpen className="h-3.5 w-3.5 shrink-0" />
                <span className="min-w-0">
                  <span className="block text-[11px] font-medium">使用已有的 MC 安装</span>
                  <span className="block text-[10px] text-mc-mute">.minecraft / 项目产物</span>
                </span>
                <ChevronRight className="ml-auto h-3.5 w-3.5 shrink-0" />
              </button>
            </div>
          </aside>

          {/* 启动驾驶舱 */}
          <main className="min-h-0 min-w-0 flex-1 overflow-y-auto">
            <div className="space-y-3 p-3">
              {/* 统一错误横幅（§4.2.1）：下载失败 / Java 缺失 / 目录无权限都归这里 */}
              {(error ?? listError) && (
                <div
                  role="alert"
                  className="flex items-start gap-2 rounded-mc border border-mc-redstone/30 bg-mc-redstone/10 px-3 py-2 text-[11px] leading-relaxed text-mc-redstone"
                >
                  <span className="mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full bg-mc-redstone" />
                  <span>{error ?? listError}</span>
                </div>
              )}

              {!selected && (loadingInstances || instances.length > 0) ? (
                <section className="mc-card flex min-h-[360px] flex-col items-center justify-center gap-3 p-8 text-center text-mc-mute">
                  <Loader2 className="h-6 w-6 animate-spin text-mc-accent" />
                  <p className="text-[11px]">正在读取实例列表…</p>
                </section>
              ) : !selected ? (
                <section className="mc-card flex min-h-[360px] flex-col items-center justify-center gap-3 p-8 text-center">
                  <div className="flex h-14 w-14 items-center justify-center rounded-mc border border-mc-border-strong bg-mc-surface-3 text-mc-accent">
                    <Gamepad2 className="h-7 w-7" />
                  </div>
                  <div>
                    <h2 className="font-display text-base font-bold text-mc-text">还没有实例</h2>
                    <p className="mt-1 max-w-sm text-[11px] leading-relaxed text-mc-mute">
                      创建一个实例来管理版本、模组与存档；也可以先到「下载」页获取 MC 版本。
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center justify-center gap-2">
                    <button onClick={openNewInstance} className="mc-btn-primary">
                      <Plus className="h-3.5 w-3.5" /> 创建第一个实例
                    </button>
                    <button onClick={() => setView('download')} className="mc-btn-ghost">
                      <Download className="h-3.5 w-3.5" /> 去下载版本
                    </button>
                  </div>
                </section>
              ) : (
                <>
                  <section
                    className={`mc-card relative overflow-hidden border ${
                      selectedRunning
                        ? 'border-mc-gold/50'
                        : selected.clientReady
                          ? 'border-mc-border-strong'
                          : 'border-mc-gold/40'
                    }`}
                  >
                    <span
                      aria-hidden="true"
                      className={`absolute inset-y-0 left-0 w-1 ${
                        selectedRunning
                          ? 'bg-mc-gold'
                          : selected.clientReady
                            ? 'bg-mc-accent'
                            : 'bg-mc-gold'
                      }`}
                    />
                    <div
                      aria-hidden="true"
                      className="pointer-events-none absolute inset-0 opacity-[0.05]"
                      style={{
                        backgroundImage:
                          'linear-gradient(rgb(var(--mc-accent) / 0.7) 1px, transparent 1px), linear-gradient(90deg, rgb(var(--mc-accent) / 0.7) 1px, transparent 1px)',
                        backgroundSize: '18px 18px',
                      }}
                    />
                    <div className="relative p-4 pl-5">
                      <div className="flex items-start gap-3">
                        <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-mc border border-mc-border-strong bg-mc-surface-3 text-mc-accent shadow-mc-block">
                          <Gamepad2 className="h-7 w-7" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <h2
                            className="truncate font-display text-lg font-bold leading-tight text-mc-text"
                            title={selected.name}
                          >
                            {selected.name}
                          </h2>
                          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                            <span className="mc-tag">{loaderLabel(selected.loader)}</span>
                            <span className="text-[11px] text-mc-text-dim">
                              {selected.versionId}
                            </span>
                            <span className="text-mc-mute">·</span>
                            <span className="text-[10px] text-mc-mute">
                              {lastPlayedLabel(selected)}
                            </span>
                            {!selected.clientReady && (
                              <span className="mc-tag border border-mc-gold/30 text-mc-gold">
                                客户端未下载
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-1">
                          <button
                            onClick={() => void openInstanceFolder(selected)}
                            className="mc-btn-ghost !px-2"
                            title="在资源管理器中打开实例目录"
                            aria-label={`打开实例 ${selected.name} 的文件夹`}
                          >
                            <FolderOpen className="h-3.5 w-3.5" />
                          </button>
                          <button
                            onClick={() => setPendingDelete(selected)}
                            className="mc-btn-ghost !px-2 hover:!border-mc-redstone/40 hover:!text-mc-redstone"
                            title="删除实例记录（不删存档）"
                            aria-label={`删除实例 ${selected.name}`}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>

                      <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-mc-border/70 pt-3">
                        <button
                          onClick={() => void launchInstance(selected)}
                          disabled={runningPid !== null || busy}
                          className="mc-btn-primary h-10 min-w-36 px-5 text-sm"
                        >
                          {busy ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : selectedRunning ? (
                            <Gamepad2 className="h-4 w-4" />
                          ) : (
                            <Play className="h-4 w-4" />
                          )}
                          {launchButtonLabel}
                        </button>
                        <span className="text-[10px] text-mc-mute">
                          {selected.username ?? 'Steve'} · 内存 {selected.memory ?? '2G'} ·{' '}
                          {selected.javaPath ? '自定义 Java' : '自动 Java'}
                        </span>
                      </div>
                    </div>
                  </section>

                  <div
                    role="status"
                    aria-live="polite"
                    className={`flex flex-wrap items-center gap-2 rounded-mc border border-mc-border bg-mc-surface-2 px-3 py-2 text-[11px] ${statusTone}`}
                  >
                    <span
                      aria-hidden="true"
                      className={`h-1.5 w-1.5 shrink-0 rounded-full ${statusDot}`}
                    />
                    <span className="font-medium">{statusMessage}</span>
                    {selectedRunning && (
                      <span className="ml-auto text-[10px] text-mc-mute">
                        关闭游戏后状态会自动更新
                      </span>
                    )}
                    {!selectedRunning && runningPid === null && downloadStatus === '' && (
                      <span className="ml-auto text-[10px] text-mc-mute">
                        {selected.clientReady
                          ? '双击左侧实例也可以直接启动'
                          : '首次启动会先下载客户端文件'}
                      </span>
                    )}
                  </div>

                  <section className="mc-card overflow-hidden">
                    <button
                      type="button"
                      onClick={() => setSettingsOpen((v) => !v)}
                      aria-expanded={settingsOpen}
                      className={`flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-mc-surface-2 ${
                        settingsOpen ? 'border-b border-mc-border' : ''
                      }`}
                    >
                      <SlidersHorizontal className="h-3.5 w-3.5 shrink-0 text-mc-accent" />
                      <span className="shrink-0 text-xs font-medium text-mc-text">启动设置</span>
                      <span className="min-w-0 truncate text-[10px] text-mc-mute">
                        {selected.username ?? 'Steve'} · {selected.memory ?? '2G'} ·{' '}
                        {selected.javaPath ? '自定义 Java' : '自动 Java'}
                      </span>
                      <ChevronRight
                        className={`ml-auto h-3.5 w-3.5 shrink-0 text-mc-mute transition-transform ${
                          settingsOpen ? 'rotate-90' : ''
                        }`}
                      />
                    </button>
                    {settingsOpen && (
                      <div className="grid gap-3 p-3 sm:grid-cols-2">
                        <div>
                          <label
                            htmlFor="instance-username"
                            className="mb-1 block text-[10px] font-medium text-mc-mute"
                          >
                            用户名
                          </label>
                          <input
                            id="instance-username"
                            key={`${selected.id}:username`}
                            defaultValue={selected.username ?? 'Steve'}
                            onBlur={(e) => {
                              // 失焦才提交：onChange 每敲一个字符就发一次 IPC 是滥用
                              const v = e.target.value.trim();
                              if (v && v !== selected.username) {
                                void ipcClient.launcherUpdateInstance({
                                  id: selected.id,
                                  patch: { username: v },
                                });
                              }
                            }}
                            className="mc-input"
                            aria-label="用户名"
                          />
                        </div>
                        <div>
                          <label
                            htmlFor="instance-memory"
                            className="mb-1 block text-[10px] font-medium text-mc-mute"
                          >
                            内存
                          </label>
                          <input
                            id="instance-memory"
                            key={`${selected.id}:memory`}
                            defaultValue={selected.memory ?? '2G'}
                            onBlur={(e) => {
                              const v = e.target.value.trim();
                              if (v && v !== selected.memory) {
                                void ipcClient.launcherUpdateInstance({
                                  id: selected.id,
                                  patch: { memory: v },
                                });
                              }
                            }}
                            className="mc-input"
                            aria-label="内存"
                          />
                        </div>
                        <div className="sm:col-span-2">
                          <label
                            htmlFor="instance-java-path"
                            className="mb-1 block text-[10px] font-medium text-mc-mute"
                          >
                            Java 路径
                          </label>
                          <div className="flex gap-2">
                            <input
                              id="instance-java-path"
                              key={`${selected.id}:javaPath:${selected.javaPath ?? ''}`}
                              defaultValue={selected.javaPath ?? ''}
                              placeholder="自动（JAVA_HOME / PATH）"
                              title="java / java.exe 的完整路径；留空则用 JAVA_HOME 或 PATH 中的 java"
                              onBlur={(e) => {
                                const v = e.target.value.trim();
                                if (v === (selected.javaPath ?? '')) return;
                                void ipcClient
                                  .launcherUpdateInstance({
                                    id: selected.id,
                                    // 空串表示清除实例级路径，launchGame 会回落到 PATH
                                    patch: { javaPath: v },
                                  })
                                  .then((res) => {
                                    if (!res.ok || res.error)
                                      setError(res.error || '保存 Java 路径失败');
                                    else return loadInstances();
                                  })
                                  .catch((err: Error) => setError(err.message));
                              }}
                              className="mc-input min-w-0 flex-1 font-mono text-[11px]"
                              aria-label="Java 路径"
                            />
                            <button
                              onClick={() => void chooseJavaPath(selected)}
                              className="mc-btn-ghost shrink-0"
                              title="选择 java / java.exe"
                              aria-label={`选择实例 ${selected.name} 的 Java 路径`}
                            >
                              <FolderOpen className="h-3.5 w-3.5" /> 选择
                            </button>
                          </div>
                          <p className="mt-1 text-[10px] text-mc-mute">
                            留空则使用 JAVA_HOME / PATH；建议 Java 21+（本机实测 OpenJDK 25）。
                          </p>
                        </div>
                      </div>
                    )}
                  </section>

                  <section className="mc-card overflow-hidden">
                    <header className="flex items-center gap-2 border-b border-mc-border px-3 py-2">
                      <Wrench className="h-3.5 w-3.5 text-mc-accent" />
                      <span className="text-xs font-medium text-mc-text">加载器与扩展</span>
                      <span className="ml-auto">
                        <span className="mc-tag">{loaderLabel(selected.loader)}</span>
                      </span>
                    </header>
                    <div className="space-y-3 p-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-[10px] text-mc-mute">切换加载器</span>
                        <button
                          onClick={() => void handleInstallLoader('fabric')}
                          disabled={installingLoader}
                          className="mc-btn-ghost"
                          title="安装或重新安装 Fabric 加载器"
                        >
                          {installingLoader ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <Wrench className="h-3 w-3" />
                          )}
                          装 Fabric
                        </button>
                        <button
                          onClick={() => void handleInstallLoader('neoforge')}
                          disabled={installingLoader}
                          className="mc-btn-ghost"
                          title="安装或重新安装 NeoForge 加载器"
                        >
                          装 NeoForge
                        </button>
                        <span className="text-[10px] text-mc-mute">
                          装完会立即更新此实例的启动档案
                        </span>
                      </div>

                      <div className="flex flex-wrap items-center gap-2 border-t border-mc-border/70 pt-3">
                        <span className="flex items-center gap-1 text-[10px] text-mc-mute">
                          <User className="h-3 w-3" /> 离线皮肤
                        </span>
                        <label className="sr-only" htmlFor="skin-api-url">
                          皮肤站 Yggdrasil API URL
                        </label>
                        <input
                          id="skin-api-url"
                          value={skinApiUrl}
                          onChange={(e) => setSkinApiUrl(e.target.value)}
                          placeholder="Yggdrasil API URL"
                          className="mc-input min-w-0 flex-1 basis-48 sm:max-w-xs"
                        />
                        <button
                          onClick={() => void handleInstallSkin()}
                          disabled={skinInstalling}
                          className="mc-btn-ghost"
                          title="安装 CustomSkinLoader 离线皮肤支持"
                        >
                          {skinInstalling ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <User className="h-3 w-3" />
                          )}
                          装皮肤支持
                        </button>
                      </div>
                    </div>
                  </section>

                  <section className="mc-card overflow-hidden">
                    <div
                      role="tablist"
                      aria-label="实例详情"
                      className="sticky top-0 z-10 flex flex-wrap gap-0.5 border-b border-mc-border bg-mc-surface px-2"
                    >
                      {DETAIL_TABS.map((t) => (
                        <button
                          key={t.id}
                          role="tab"
                          aria-selected={detailTab === t.id}
                          onClick={() => setDetailTab(t.id)}
                          className={`px-3 py-1.5 text-[11px] ${
                            detailTab === t.id
                              ? 'border-b-2 border-mc-teal text-mc-teal'
                              : 'text-mc-dim hover:text-mc-text'
                          }`}
                        >
                          {t.label}
                        </button>
                      ))}
                    </div>

                    <div role="tabpanel" className="min-h-[300px]">
                      {detailTab === 'content' && <ContentTab instanceId={selected.id} />}
                      {detailTab === 'files' && (
                        <InstanceDirTab instanceId={selected.id} instanceName={selected.name} />
                      )}
                      {detailTab === 'world' && <WorldTab instanceId={selected.id} />}
                      {detailTab === 'skin' && (
                        <SkinTab
                          instanceId={selected.id}
                          playerName={selected.username ?? 'Steve'}
                        />
                      )}
                      {detailTab === 'logs' && (
                        <LogTab instanceId={selected.id} running={selectedRunning} />
                      )}
                      {detailTab === 'settings' && (
                        <SettingsTab
                          _versionId={selected.versionId}
                          maxParallelDownloads={maxParallelDownloads}
                          onMaxParallelDownloadsChange={setMaxParallelDownloads}
                        />
                      )}
                      {NOT_YET[detailTab] && (
                        <div className="p-6 text-center text-[11px] text-mc-mute">
                          {NOT_YET[detailTab]}
                        </div>
                      )}
                    </div>
                  </section>
                </>
              )}
            </div>
          </main>
        </div>
      )}

      {/* 新建实例：版本 + 名字一次填完，不再把下拉框塞在实例库中间 */}
      <Modal
        open={newInstanceOpen}
        title="新建实例"
        size="md"
        onClose={() => {
          if (creatingInstance) return;
          setNewInstanceOpen(false);
          setNewInstanceError(null);
        }}
        footer={
          <>
            <Button
              variant="ghost"
              disabled={creatingInstance}
              onClick={() => {
                setNewInstanceOpen(false);
                setNewInstanceError(null);
              }}
            >
              取消
            </Button>
            <Button
              variant="primary"
              loading={creatingInstance}
              disabled={!newVersion || !!newNameCheck.error}
              onClick={() =>
                void createInstance(newVersion, newName.length > 0 ? newName : undefined)
              }
            >
              创建实例
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <div className="mb-1 flex items-center justify-between gap-2">
              <label
                htmlFor="new-instance-version"
                className="text-[11px] font-medium text-mc-text"
              >
                MC 版本
              </label>
              <button
                type="button"
                onClick={() => void loadVersions()}
                disabled={loadingVersions}
                className="flex items-center gap-1 text-[10px] text-mc-mute transition-colors hover:text-mc-text disabled:opacity-50"
                aria-label="刷新版本清单"
              >
                <RefreshCw className={`h-3 w-3 ${loadingVersions ? 'animate-spin' : ''}`} />
                刷新
              </button>
            </div>
            <select
              id="new-instance-version"
              value={newVersion}
              onChange={(e) => setNewVersion(e.target.value)}
              disabled={loadingVersions || versions.length === 0}
              className="mc-input"
            >
              {versions.length === 0 && <option value="">暂无可用版本</option>}
              {versions.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.id}
                </option>
              ))}
            </select>
            {versions.length === 0 && !loadingVersions && (
              <p className="mt-1 text-[10px] leading-relaxed text-mc-gold">
                本地还没有版本。先到「下载」页获取一个 MC 版本，或点右上角刷新。
              </p>
            )}
          </div>

          <div>
            <label
              htmlFor="new-instance-name"
              className="mb-1 block text-[11px] font-medium text-mc-text"
            >
              实例名称
              <span className="ml-1 font-normal text-mc-mute">（目录名 = 显示名）</span>
            </label>
            <input
              id="new-instance-name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="留空则使用版本号"
              className="mc-input"
              autoComplete="off"
            />
            {newNameCheck.error ? (
              <p className="mt-1 text-[10px] leading-relaxed text-mc-redstone">
                {newNameCheck.error}
              </p>
            ) : newNameCheck.hint ? (
              <p className="mt-1 text-[10px] leading-relaxed text-mc-gold">{newNameCheck.hint}</p>
            ) : (
              <p className="mt-1 text-[10px] leading-relaxed text-mc-mute">
                名称会直接作为实例文件夹名，留空时用版本号。
              </p>
            )}
          </div>

          {newInstanceError && (
            <p
              role="alert"
              className="rounded-mc border border-mc-redstone/30 bg-mc-redstone/10 px-3 py-2 text-[11px] text-mc-redstone"
            >
              {newInstanceError}
            </p>
          )}

          {versions.length === 0 && !loadingVersions && (
            <Button
              variant="ghost"
              fullWidth
              onClick={() => {
                setNewInstanceOpen(false);
                setView('download');
              }}
            >
              <Download className="h-3.5 w-3.5" /> 去下载页获取版本
            </Button>
          )}
        </div>
      </Modal>

      {/* 次入口（§4.2.4）：独立弹窗，不与主路径争首屏 */}
      <Modal
        open={secondaryOpen}
        title="使用已有的 MC 安装"
        size="lg"
        onClose={() => setSecondaryOpen(false)}
      >
        <div className="space-y-3">
          <div className="rounded-mc border border-mc-border bg-mc-surface-2 p-3">
            <span className="mb-2 flex items-center gap-1.5 text-xs font-medium text-mc-text">
              <FolderOpen className="h-3 w-3" /> 离线已有安装
            </span>
            <div className="flex gap-2">
              <button
                onClick={() => void locateOffline()}
                disabled={offlineStatus === 'locating'}
                className="mc-btn-ghost flex-1"
              >
                {offlineStatus === 'locating' ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Search className="h-3 w-3" />
                )}
                自动定位
              </button>
              <button onClick={() => void chooseOfflineDir()} className="mc-btn-ghost flex-1">
                <FolderOpen className="h-3 w-3" /> 选择目录
              </button>
            </div>
            <p className="mt-2 text-[10px] text-mc-mute">
              支持官方启动器 / PCL2 / HMCL 的 .minecraft 目录
            </p>
            {offlineStatus === 'found' && offlineDir && (
              <p className="mt-1 truncate text-[10px] text-mc-accent" title={offlineDir}>
                {offlineDir}
              </p>
            )}
            {offlineError && <p className="mt-1 text-[10px] text-mc-redstone">{offlineError}</p>}
            {offlineMsg && <p className="mt-1 text-[10px] text-mc-accent">{offlineMsg}</p>}
            <div className="mt-2 flex gap-2">
              <button
                onClick={() => void installModToOffline()}
                disabled={!jarPath || !offlineDir || offlineInstalling}
                className="mc-btn-primary flex-1"
                title={!jarPath ? '请先构建生成 Mod jar 文件' : '复制构建产物到 mods 目录'}
              >
                {offlineInstalling ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Download className="h-3 w-3" />
                )}
                {jarPath ? '安装当前 Mod 到该安装' : '安装 Mod（需先构建）'}
              </button>
              <button
                onClick={() => void launchOffline()}
                disabled={!offlineDir || offlineLaunching}
                className="mc-btn-primary flex-1"
              >
                {offlineLaunching ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Play className="h-3 w-3" />
                )}
                {offlineLaunching ? '启动中…' : '启动该安装'}
              </button>
            </div>
          </div>

          <div className="rounded-mc border border-mc-border bg-mc-surface-2 p-3 text-[11px] leading-relaxed text-mc-mute">
            <div className="mb-1 text-xs font-medium text-mc-text">使用说明</div>
            <ul className="list-inside list-disc space-y-0.5">
              <li>下载：获取 Mojang 官方客户端 jar、资源文件与运行库</li>
              <li>启动：离线模式（无需正版账号），UUID 随机生成</li>
              <li>首次启动较慢：需下载约 200MB 资源与库文件</li>
              <li>实例存档目录：userData/mc-launcher/game/&lt;版本&gt;/</li>
            </ul>
          </div>
        </div>
      </Modal>

      {pendingDelete && (
        <ConfirmDialog
          open
          title="删除实例？"
          message=""
          confirmText="删除实例"
          cancelText="取消"
          destructive
          onCancel={() => setPendingDelete(null)}
          onConfirm={async () => {
            const inst = pendingDelete;
            setPendingDelete(null);
            await deleteInstance(inst);
          }}
        >
          <p>确定删除「{pendingDelete.name}」的实例记录？</p>
          <p className="mt-2 text-mc-mute">
            实例目录、存档与已装模组会保留在磁盘上；需要彻底删除请手动删除目录。
          </p>
        </ConfirmDialog>
      )}
    </div>
  );
}
