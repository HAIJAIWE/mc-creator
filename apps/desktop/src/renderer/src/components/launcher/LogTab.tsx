/**
 * 启动器实例详情的「日志」tab（L7）。
 *
 * 三个来源对应 Modrinth 实例详情日志页的 `Live Log ▾` 模式选择器
 * （docs/launcher-window-architecture.md §4.3.1a）：
 *  | 来源   | 位置                                | 用途         |
 *  | ------ | ----------------------------------- | ------------ |
 *  | 实时   | 进程 stdout/stderr                  | 游戏运行中看 |
 *  | 最近一次 | `game/<v>/logs/latest.log`        | 关后回看     |
 *  | 崩溃报告 | `game/<v>/crash-reports/crash-*.txt` | Java 异常栈 |
 * 只做实时是不够的 —— 游戏一关日志就跟着没了。
 *
 * 级别筛选（All / Error / Warn / Info）用 MC 标准日志级别 `[ERROR]` / `[WARN]` / `[INFO]`。
 * 空态明确指向顶栏的启动按钮，而不是只说「暂无数据」。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, FileWarning, Maximize2, Minimize2, Radio, ScrollText } from 'lucide-react';
import { ipcClient } from '../../lib/ipc-client.js';

type Source = 'live' | 'latest' | 'crash';
type Level = 'all' | 'error' | 'warn' | 'info';

interface LogTabProps {
  /**
   * 实例 id —— 日志在 `<gameDir>/logs/`，而 gameDir 的键是**实例名**
   * 不是 MC 版本号（多实例之后两者不再相等）。
   */
  instanceId: string;
  /** 实例是否正在运行（决定实时流是否可开） */
  running: boolean;
}

const SOURCE_LABEL: Record<Source, string> = {
  live: '实时日志',
  latest: '最近一次',
  crash: '崩溃报告',
};

/**
 * 从一行 MC 日志里判级别。
 *
 * 真实格式是 `[12:00:03] [main/ERROR]: msg` —— 级别在**方括号段内部、
 * 斜杠之后**（`main` / `Server thread` / `Render thread` 是线程或分类名）。
 * 早先的正则写成 `\[?(ERROR|...)`，只吃 `[ERROR]` 这种不带前缀的形式，
 * 于是**所有真实 MC 日志都判不出级别**，级别筛选恒为「0 行」。
 * （视觉预览里点 Error 筛出 0/4 行才发现 —— jsdom fixture 当时也照着错正则写的。）
 *
 * 两种形态都要认：
 *  - `[12:00:03] [main/ERROR]:`      → 段内斜杠后
 *  - `[12:00:03] [ERROR]:`           → 段内开头
 */
function detectLevel(line: string): Exclude<Level, 'all'> | null {
  // 取时间戳后的第一个方括号段（线程/分类名）
  const seg = /^\[\d{2}:\d{2}:\d{2}(?:[.,]\d+)?\]\s*\[([^\]]*)\]/.exec(line)?.[1];
  if (seg === undefined) return null;
  // 段内 `xxx/LEVEL` 或段本身就是 `LEVEL`
  const m = /(?:^|\/)(FATAL|ERROR|WARN(?:ING)?|INFO)\b/i.exec(seg);
  if (!m) return null;
  const tag = m[1]!.toUpperCase();
  if (tag === 'ERROR' || tag === 'FATAL') return 'error';
  if (tag.startsWith('WARN')) return 'warn';
  return 'info';
}

function matchesLevel(line: string, level: Level): boolean {
  if (level === 'all') return true;
  const d = detectLevel(line);
  // 无级别标记的行在具体筛选下隐藏，但 All 下显示 —— 与常见日志查看器一致
  return d === level;
}

export function LogTab({ instanceId, running }: LogTabProps) {
  const [source, setSource] = useState<Source>('live');
  const [level, setLevel] = useState<Level>('all');
  const [query, setQuery] = useState('');
  const [lines, setLines] = useState<string[]>([]);
  const [crashFiles, setCrashFiles] = useState<string[]>([]);
  const [selectedCrash, setSelectedCrash] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const stopRef = useRef<(() => void) | null>(null);
  /**
   * 只滚动日志框本身。
   *
   * 以前对底部锚点调 `scrollIntoView`：日志一多，它会把**整个启动页**
   * 滚到底，把顶部的实例身份、启动按钮和 tab 栏一起推出视口。
   * 实测点「日志」后页面直接跳到日志尾部，用户找不到返回其它 tab 的入口。
   */
  const logBoxRef = useRef<HTMLDivElement | null>(null);

  // 切换实例时清空，避免上一个实例的日志留在界面上
  useEffect(() => {
    setLines([]);
    setCrashFiles([]);
    setSelectedCrash(null);
    setError(null);
  }, [instanceId]);

  // 实时流：开启即订阅，切换 source / 实例 / 卸载时务必退订
  useEffect(() => {
    stopRef.current?.();
    stopRef.current = null;
    if (source !== 'live' || !instanceId || !running) return;
    setLines([]);
    const stop = ipcClient.launcherLogStream({ instance: instanceId }, (chunk) => {
      if (chunk.done) {
        if (chunk.line) setLines((cur) => [...cur, chunk.line]);
        return;
      }
      setLines((cur) => [...cur, chunk.line]);
    });
    stopRef.current = stop;
    return () => {
      stop();
      stopRef.current = null;
    };
  }, [source, instanceId, running]);

  useEffect(() => {
    if (source !== 'latest' || !instanceId) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await ipcClient.launcherReadLatestLog({ instance: instanceId });
        if (cancelled) return;
        if (res.error) setError(res.error);
        else {
          setLines(res.lines ?? []);
          setError(null);
        }
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [source, instanceId]);

  const loadCrashList = useCallback(async () => {
    if (!instanceId) return;
    try {
      const res = await ipcClient.launcherListCrashReports({ instance: instanceId });
      if (res.error) setError(res.error);
      else {
        setCrashFiles(res.files ?? []);
        setError(null);
        // 默认打开最近一份
        const first = res.files?.[0];
        if (first) {
          setSelectedCrash(first);
          const detail = await ipcClient.launcherReadCrashReport({
            instance: instanceId,
            filename: first,
          });
          // 读取失败必须显示原因：静默置空会让用户看到「该实例没有崩溃报告」，
          // 而真相是「有，但读不出来」。与下方 openCrash() 保持同一套处理。
          if (detail.error) {
            setLines([]);
            setError(detail.error);
          } else {
            setLines(detail.content.split('\n'));
            setError(null);
          }
        } else {
          setSelectedCrash(null);
          setLines([]);
        }
      }
    } catch (e) {
      setError((e as Error).message);
    }
  }, [instanceId]);

  useEffect(() => {
    if (source === 'crash') void loadCrashList();
  }, [source, loadCrashList]);

  const openCrash = async (filename: string) => {
    setSelectedCrash(filename);
    try {
      const detail = await ipcClient.launcherReadCrashReport({ instance: instanceId, filename });
      if (detail.error) setError(detail.error);
      else {
        setLines(detail.content.split('\n'));
        setError(null);
      }
    } catch (e) {
      setError((e as Error).message);
    }
  };

  // 自动滚到底：只改日志框的 scrollTop，绝不带动外层页面。
  useEffect(() => {
    if (source !== 'live') return;
    const box = logBoxRef.current;
    if (box) box.scrollTop = box.scrollHeight;
  }, [lines, source]);

  const filtered = lines.filter(
    (l) =>
      matchesLevel(l, level) &&
      (!query.trim() || l.toLowerCase().includes(query.trim().toLowerCase())),
  );

  return (
    <div
      className={`flex flex-col gap-2 p-3 ${expanded ? 'fixed inset-2 z-50 bg-mc-surface' : ''}`}
    >
      <div className="flex items-center gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索日志…"
          aria-label="搜索日志"
          className="mc-input flex-1"
        />
        <label className="sr-only" htmlFor="log-source">
          日志来源
        </label>
        <select
          id="log-source"
          value={source}
          onChange={(e) => setSource(e.target.value as Source)}
          className="mc-select"
        >
          {(Object.keys(SOURCE_LABEL) as Source[]).map((s) => (
            <option key={s} value={s}>
              {SOURCE_LABEL[s]}
            </option>
          ))}
        </select>
        <button
          onClick={() => setExpanded((v) => !v)}
          className="mc-btn-ghost"
          title={expanded ? '退出全屏' : '全屏展开'}
          aria-label={expanded ? '退出全屏' : '全屏展开'}
        >
          {expanded ? <Minimize2 className="h-3 w-3" /> : <Maximize2 className="h-3 w-3" />}
        </button>
      </div>

      {source === 'crash' && crashFiles.length > 0 && (
        <select
          value={selectedCrash ?? ''}
          onChange={(e) => void openCrash(e.target.value)}
          aria-label="选择崩溃报告"
          className="mc-select"
        >
          {crashFiles.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>
      )}

      <div className="flex items-center gap-1" role="group" aria-label="日志级别筛选">
        {(['all', 'error', 'warn', 'info'] as Level[]).map((lv) => (
          <button
            key={lv}
            onClick={() => setLevel(lv)}
            aria-pressed={level === lv}
            className={`rounded-mc px-2 py-0.5 text-[10px] ${
              level === lv ? 'bg-mc-surface-3 text-mc-teal' : 'text-mc-dim hover:text-mc-text'
            }`}
          >
            {lv === 'all' ? '全部' : lv === 'error' ? 'Error' : lv === 'warn' ? 'Warn' : 'Info'}
          </button>
        ))}
        <span className="ml-auto text-[10px] text-mc-mute">
          {filtered.length} / {lines.length} 行
        </span>
      </div>

      {error && (
        <div
          role="alert"
          className="flex items-start gap-1.5 rounded-mc border border-mc-redstone/40 bg-mc-redstone/10 px-2 py-1 text-[11px] text-mc-redstone"
        >
          <AlertTriangle className="mt-0.5 h-3 w-3 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div
        ref={logBoxRef}
        className={`min-h-24 overflow-auto rounded-mc bg-mc-surface-2 p-2 font-mono text-[11px] leading-relaxed ${
          expanded ? 'flex-1' : 'h-[min(52vh,420px)]'
        }`}
        role="log"
        aria-live={source === 'live' ? 'polite' : 'off'}
      >
        {filtered.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 py-6 text-center text-mc-mute">
            {error ? (
              // 有错误时不再说「没有崩溃报告 / 还没有日志」——
              // 那会与上方的错误条自相矛盾（真相是读失败，不是没有内容）
              <span>日志内容未能加载，请查看上方错误</span>
            ) : source === 'live' && !running ? (
              <>
                <Radio className="h-5 w-5" />
                <span>在右上角点击「开始游戏」以接收实时日志</span>
              </>
            ) : source === 'live' ? (
              <span>等待游戏输出…</span>
            ) : source === 'latest' ? (
              <>
                <ScrollText className="h-5 w-5" />
                <span>该实例还没有产生过日志（启动一次游戏后这里会显示最近一次的记录）</span>
              </>
            ) : (
              <>
                <FileWarning className="h-5 w-5" />
                <span>该实例没有崩溃报告</span>
              </>
            )}
          </div>
        ) : (
          <>
            {filtered.map((l, i) => {
              const d = detectLevel(l);
              const color =
                d === 'error'
                  ? 'text-mc-redstone'
                  : d === 'warn'
                    ? 'text-mc-gold'
                    : d === 'info'
                      ? 'text-mc-dim'
                      : 'text-mc-text';
              return (
                <div
                  key={`${i}-${l.slice(0, 24)}`}
                  className={`whitespace-pre-wrap break-all ${color}`}
                >
                  {l}
                </div>
              );
            })}
          </>
        )}
      </div>
    </div>
  );
}
