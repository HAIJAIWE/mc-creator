import { useState, useRef } from 'react';
import { McIcon } from '../assets/mc-ui/McIcon';
import Editor from '@monaco-editor/react';
import { Loader2, Send, LayoutTemplate, FolderOpen } from 'lucide-react';
import type { ModEntry } from '@mc-creator/shared';
import { MC_VERSIONS } from '@mc-creator/shared';
import type { GeneratorType, BuildStreamChunkT } from '../../../shared/ipc-channels.js';
import { useModStore } from '../store/mod-store.js';
import { useModelConfigStore } from '../store/model-config-store.js';
import { useProjectStore } from '../store/project-store.js';
import { ipcClient } from '../lib/ipc-client.js';
import { ErrorBanner } from './ErrorBanner.js';
import { TemplatePicker } from './TemplatePicker.js';
import { ModrinthSearchPanel } from './ModrinthSearchPanel.js';
import { CurseForgeSearchPanel } from './CurseForgeSearchPanel.js';
import { McMark } from './McMark.js';
import { defineMcMonacoTheme, mcEditorOptions, MC_MONACO_THEME } from '../lib/monaco-theme.js';

interface Msg { role: 'user' | 'assistant'; text: string }

function extractJarPath(log: string): string | null {
  const match = log.match(/build\/libs\/[^\s"']*\.jar/);
  return match ? match[0] : null;
}

function renderLog(log: string) {
  return log.split('\n').map((line, i) => {
    const isError = /error:|ERROR|FAILED/i.test(line);
    const isWarn = /warning:|WARN/i.test(line);
    const color = isError ? 'text-mc-redstone' : isWarn ? 'text-mc-gold' : 'text-mc-dim';
    return (
      <div key={i} className={`${color} leading-relaxed`}>
        {line || ' '}
      </div>
    );
  });
}

export function AgentPanel() {
  const {
    description, setDescription, loader, mcVersion, generatorType,
    spec, setSpec, setFiles, setLoading, setError, loading, error,
    files, buildLog, buildSuccess, jarPath, fixLog,
    setBuildResult, setFixLog, setLoader, setMcVersion, setGeneratorType,
  } = useModStore();
  const { apiKey } = useModelConfigStore();
  const { projects, loadProjects, loadProject, importProject, saveCurrentAsProject, currentProjectId } = useProjectStore();

  const [editorText, setEditorText] = useState('');
  const [originalSpec, setOriginalSpec] = useState('');
  const [specError, setSpecError] = useState<string | null>(null);

  const [showTemplates, setShowTemplates] = useState(false);
  const [showModrinthSearch, setShowModrinthSearch] = useState(false);
  const [showCurseForgeSearch, setShowCurseForgeSearch] = useState(false);

  const [showProjectMenu, setShowProjectMenu] = useState(false);
  const [importing, setImporting] = useState(false);

  const TYPE_LABELS: Record<GeneratorType, string> = {
    mod: 'Mod',
    datapack: '数据包',
    modpack: '整合包',
    server: '服务器',
    texture: '材质',
    skin: '皮肤',
    resource_pack: '资源包',
  };

  const currentProject = projects.find((p) => p.id === currentProjectId);

  const handleLoadProjects = async () => {
    await loadProjects();
    setShowProjectMenu(true);
  };

  const handleSelectProject = async (id: string) => {
    await loadProject(id);
    setShowProjectMenu(false);
  };

  const handleImport = async () => {
    setImporting(true);
    try {
      await importProject();
      await loadProjects();
    } finally {
      setImporting(false);
    }
  };

  const handleNew = () => {
    useModStore.setState({
      description: '',
      spec: null,
      files: [],
      selectedFile: null,
      buildLog: '',
      buildSuccess: null,
      jarPath: null,
      fixLog: [],
      error: null,
      loading: false,
      generatorType: 'mod',
    });
    setShowProjectMenu(false);
  };

  const handleSave = async () => {
    if (!spec || files.length === 0) return;
    try {
      const name = currentProject?.name || `project-${Date.now()}`;
      await saveCurrentAsProject(name, {
        generatorType,
        loader,
        mcVersion,
        description,
        spec,
        files,
      });
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const [messages, setMessages] = useState<Msg[]>([
    { role: 'assistant', text: '你好！描述你想要的 mod，我来帮你生成。' },
  ]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const [streamLog, setStreamLog] = useState('');
  const [streamBuilding, setStreamBuilding] = useState(false);
  const [streamSuccess, setStreamSuccess] = useState<boolean | null>(null);
  const [streamJarPath, setStreamJarPath] = useState<string | null>(null);
  const [buildCount, setBuildCount] = useState(0);
  const streamLogRef = useRef('');

  const [expandedSections, setExpandedSections] = useState({
    description: true,
    spec: true,
    build: true,
    chat: true,
  });

  const toggleSection = (section: keyof typeof expandedSections) => {
    setExpandedSections((prev) => ({ ...prev, [section]: !prev[section] }));
  };

  const generateSpec = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await ipcClient.generateSpec(description, generatorType);
      const text = JSON.stringify(res.spec, null, 2);
      setSpec(res.spec as any);
      setEditorText(text);
      setOriginalSpec(text);
      setSpecError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const generateFiles = async () => {
    if (!editorText) return;
    let parsedSpec: unknown;
    try {
      parsedSpec = JSON.parse(editorText);
      setSpecError(null);
    } catch (e) {
      setSpecError((e as Error).message);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await ipcClient.generateFiles({ loader, mcVersion, spec: parsedSpec, generatorType });
      setFiles(res.files);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const handleEditorChange = (value: string | undefined) => {
    const v = value ?? '';
    setEditorText(v);
    try {
      const parsed = JSON.parse(v);
      setSpec(parsed as any);
      setSpecError(null);
    } catch (e) {
      setSpecError((e as Error).message);
    }
  };

  const resetSpec = () => {
    setEditorText(originalSpec);
    try {
      setSpec(JSON.parse(originalSpec) as any);
      setSpecError(null);
    } catch {
    }
  };

  const pickModToSpec = (mod: ModEntry, closePanel: () => void) => {
    let currentSpec: Record<string, unknown> | null = null;
    if (editorText) {
      try {
        currentSpec = JSON.parse(editorText) as Record<string, unknown>;
      } catch {
        setError('当前 Spec JSON 解析失败，无法添加 mod');
        return;
      }
    } else if (spec) {
      currentSpec = spec as Record<string, unknown>;
    }

    if (!currentSpec) {
      setError('请先生成 Spec 再添加 mod');
      return;
    }

    const mods = Array.isArray(currentSpec.mods) ? [...(currentSpec.mods as ModEntry[])] : [];
    mods.push(mod);
    const updatedSpec = { ...currentSpec, mods };
    const text = JSON.stringify(updatedSpec, null, 2);
    setEditorText(text);
    setSpec(updatedSpec as any);
    setOriginalSpec(text);
    setSpecError(null);
    closePanel();
  };

  const handleModrinthPick = (mod: ModEntry) => pickModToSpec(mod, () => setShowModrinthSearch(false));
  const handleCurseForgePick = (mod: ModEntry) => pickModToSpec(mod, () => setShowCurseForgeSearch(false));

  const send = async () => {
    if (!input.trim() || sending) return;
    const text = input;
    setInput('');
    setMessages((m) => [...m, { role: 'user', text }, { role: 'assistant', text: '' }]);
    setSending(true);

    if (!apiKey) {
      setMessages((m) => {
        const next = [...m];
        next[next.length - 1] = { role: 'assistant', text: '请先在「设置」中配置 API Key。' };
        return next;
      });
      setSending(false);
      return;
    }

    try {
      await ipcClient.chatStream(text, (delta, done) => {
        setMessages((m) => {
          const next = [...m];
          const last = next[next.length - 1];
          if (last.role === 'assistant') {
            next[next.length - 1] = { role: 'assistant', text: last.text + delta };
          }
          return next;
        });
        if (done) {
          setSending(false);
          bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
        }
      });
    } catch (e) {
      setMessages((m) => {
        const next = [...m];
        const last = next[next.length - 1];
        if (last.role === 'assistant' && last.text === '') {
          next[next.length - 1] = { role: 'assistant', text: `发送失败：${(e as Error).message}` };
        }
        return next;
      });
      setSending(false);
    }
  };

  const build = async () => {
    setLoading(true);
    setError(null);
    setFixLog([]);
    try {
      const { projectPath } = await ipcClient.prepareBuildDir(files);
      const res = await ipcClient.buildWithFix(projectPath) as any;
      setBuildResult({ success: res.success, log: res.log, jarPath: res.jarPath });
      setFixLog(res.fixLog ?? []);
      setBuildCount((c) => c + 1);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const buildStream = async () => {
    setStreamBuilding(true);
    setStreamSuccess(null);
    setStreamJarPath(null);
    streamLogRef.current = '';
    setStreamLog('');
    setError(null);
    setBuildCount((c) => c + 1);

    const onChunk = (chunk: BuildStreamChunkT) => {
      streamLogRef.current += chunk.text;
      setStreamLog(streamLogRef.current);
      if (chunk.done) {
        setStreamBuilding(false);
        const code = chunk.exitCode ?? -1;
        const ok = code === 0;
        setStreamSuccess(ok);
        if (ok) {
          setStreamJarPath(extractJarPath(streamLogRef.current));
        }
      }
    };

    try {
      const { projectPath } = await ipcClient.prepareBuildDir(files);
      await ipcClient.buildStream(projectPath, onChunk);
    } catch (e) {
      setStreamBuilding(false);
      setStreamSuccess(false);
      setError((e as Error).message);
    }
  };

  const clearStreamLog = () => {
    setStreamLog('');
    streamLogRef.current = '';
    setStreamSuccess(null);
    setStreamJarPath(null);
  };

  const placeholder = generatorType === 'mod'
    ? '描述你想要的 mod…'
    : generatorType === 'datapack'
    ? '描述你想要的数据包…'
    : generatorType === 'modpack'
    ? '描述你想要的整合包…'
    : generatorType === 'server'
    ? '描述你想要的服务器配置…'
    : generatorType === 'texture'
    ? '描述你想要的材质…'
    : generatorType === 'skin'
    ? '描述你想要的皮肤…'
    : '描述你想要的资源包…';

  return (
    <div className="flex h-full flex-col bg-mc-surface">
      {/* 头部：品牌 + 项目菜单 */}
      <div className="border-b border-mc-border">
        <div className="flex items-center justify-between px-3 py-2">
          <div className="flex items-center gap-2">
            <McMark className="h-5 w-5 text-mc-accent" />
            <span className="text-xs font-bold uppercase tracking-wider text-mc-dim">MC Creator</span>
          </div>
          <div className="relative">
            <button
              onClick={handleLoadProjects}
              className="mc-btn-ghost !px-2 !py-1"
            >
              <McIcon scope="pixel" name="folder" size={12} />
              <span className="max-w-16 truncate">{currentProject?.name || '项目'}</span>
            </button>
            {showProjectMenu && (
              <div className="mc-pop absolute right-0 top-full mt-1 z-50 w-56 overflow-hidden animate-mc-panel-in">
                <div className="flex items-center gap-2 border-b border-mc-border px-2 py-1.5">
                  <McIcon scope="pixel" name="folder" size={12} />
                  <span className="text-xs font-bold text-mc-dim">项目管理</span>
                </div>
                <div className="space-y-0.5 p-1">
                  <button
                    onClick={handleNew}
                    className="flex w-full items-center gap-2 rounded-mc px-2 py-1.5 text-left text-xs text-mc-dim transition-colors hover:bg-mc-surface-2 hover:text-mc-text"
                  >
                    <FolderOpen className="h-3 w-3 text-mc-accent" />
                    新建项目
                  </button>
                  <button
                    onClick={handleImport}
                    disabled={importing}
                    className="flex w-full items-center gap-2 rounded-mc px-2 py-1.5 text-left text-xs text-mc-dim transition-colors hover:bg-mc-surface-2 hover:text-mc-text disabled:opacity-50"
                  >
                    <FolderOpen className="h-3 w-3 text-mc-gold" />
                    {importing ? '导入中…' : '导入项目'}
                  </button>
                  <button
                    onClick={handleSave}
                    disabled={!spec || files.length === 0}
                    className="flex w-full items-center gap-2 rounded-mc px-2 py-1.5 text-left text-xs text-mc-dim transition-colors hover:bg-mc-surface-2 hover:text-mc-text disabled:opacity-50"
                  >
                    <McIcon scope="pixel" name="save" size={12} />
                    保存项目
                  </button>
                </div>
                {projects.length > 0 && (
                  <div className="border-t border-mc-border">
                    <div className="px-2 py-1 text-xs text-mc-mute">已有项目</div>
                    <div className="max-h-32 overflow-y-auto">
                      {projects.map((p) => (
                        <button
                          key={p.id}
                          onClick={() => handleSelectProject(p.id)}
                          className={`flex w-full items-center gap-2 px-2 py-1 text-left text-xs transition-colors hover:bg-mc-surface-2 ${
                            currentProjectId === p.id ? 'bg-mc-surface-2/60 text-mc-text' : 'text-mc-dim'
                          }`}
                        >
                          <McIcon scope="pixel" name="folder" size={12} />
                          <span className="truncate">{p.name}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
        {/* 全局设置：类型 / Loader / 版本 */}
        <div className="flex flex-wrap items-center gap-2 border-t border-mc-border px-3 py-1.5">
          <select
            value={generatorType}
            onChange={(e) => setGeneratorType(e.target.value as GeneratorType)}
            disabled={loading}
            className="mc-select"
          >
            {Object.entries(TYPE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
          <select
            value={loader}
            onChange={(e) => setLoader(e.target.value as any)}
            disabled={loading}
            className="mc-select"
          >
            <option value="fabric">Fabric</option>
            <option value="neoforge">NeoForge</option>
            <option value="quilt">Quilt</option>
            <option value="legacy_fabric">Legacy Fabric</option>
          </select>
          <select
            value={mcVersion}
            onChange={(e) => setMcVersion(e.target.value as any)}
            disabled={loading}
            className="mc-select"
          >
            {MC_VERSIONS.map((v) => (
              <option key={v} value={v}>{v}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* 描述输入 */}
        <div className="border-b border-mc-border">
          <button
            onClick={() => toggleSection('description')}
            className="mc-section-title flex w-full items-center justify-between transition-colors hover:bg-mc-surface-2/50"
          >
            <span>描述输入</span>
            {expandedSections.description ? <McIcon scope="pixel" name="chevron-up" size={12} /> : <McIcon scope="pixel" name="chevron-down" size={12} />}
          </button>
          {expandedSections.description && (
            <div className="space-y-3 p-3">
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={placeholder}
                className="mc-input h-20 resize-none"
                disabled={loading}
              />
              <div className="flex flex-wrap gap-1.5">
                <button
                  onClick={generateSpec}
                  disabled={loading || !description}
                  className="mc-btn-primary"
                >
                  {loading && <Loader2 className="h-3 w-3 animate-spin" />}
                  生成 Spec
                </button>
                <button
                  onClick={generateFiles}
                  disabled={loading || !spec}
                  className="mc-btn-primary"
                >
                  {loading && <Loader2 className="h-3 w-3 animate-spin" />}
                  生成代码
                </button>
                <button
                  onClick={() => setShowTemplates(true)}
                  disabled={loading}
                  className="mc-btn-ghost !px-2.5"
                  title="从模板库选择"
                >
                  <LayoutTemplate className="h-3 w-3" />
                </button>
                {generatorType === 'modpack' && (
                  <>
                    <button
                      onClick={() => setShowModrinthSearch(true)}
                      disabled={loading}
                      className="mc-btn-ghost !px-2.5"
                      title="搜索 Modrinth"
                    >
                      <McIcon scope="pixel" name="search" size={12} />
                    </button>
                    <button
                      onClick={() => setShowCurseForgeSearch(true)}
                      disabled={loading}
                      className="mc-btn-ghost !px-2.5"
                      title="搜索 CurseForge"
                    >
                      <McIcon scope="pixel" name="search" size={12} />
                    </button>
                  </>
                )}
              </div>
              {showTemplates && (
                <TemplatePicker
                  generatorType={generatorType}
                  onClose={() => setShowTemplates(false)}
                  onPick={(template) => {
                    setDescription(template.description);
                    setShowTemplates(false);
                  }}
                />
              )}
              {showModrinthSearch && (
                <ModrinthSearchPanel
                  loader={loader}
                  mcVersion={mcVersion}
                  onClose={() => setShowModrinthSearch(false)}
                  onPick={handleModrinthPick}
                />
              )}
              {showCurseForgeSearch && (
                <CurseForgeSearchPanel
                  loader={loader}
                  mcVersion={mcVersion}
                  onClose={() => setShowCurseForgeSearch(false)}
                  onPick={handleCurseForgePick}
                />
              )}
              {error && <ErrorBanner message={error} onClose={() => setError(null)} />}
            </div>
          )}
        </div>

        {/* Spec 编辑 */}
        {spec && (
          <div className="border-b border-mc-border">
            <button
              onClick={() => toggleSection('spec')}
              className="mc-section-title flex w-full items-center justify-between transition-colors hover:bg-mc-surface-2/50"
            >
              <span>Spec</span>
              {expandedSections.spec ? <McIcon scope="pixel" name="chevron-up" size={12} /> : <McIcon scope="pixel" name="chevron-down" size={12} />}
            </button>
            {expandedSections.spec && (
              <div className={`rounded-b border-x border-b ${specError ? 'border-mc-redstone' : 'border-mc-border'} bg-mc-bg`}>
                <div className="flex items-center justify-between border-b border-mc-border px-2 py-1.5">
                  <div className="text-xs text-mc-mute">可编辑，修改后点生成代码</div>
                  <button
                    onClick={resetSpec}
                    className="rounded-mc bg-mc-surface-3 px-2 py-0.5 text-xs text-mc-dim transition-colors hover:bg-mc-border-strong"
                  >
                    重置
                  </button>
                </div>
                <Editor
                  height="140px"
                  language="json"
                  theme={MC_MONACO_THEME}
                  onMount={defineMcMonacoTheme}
                  value={editorText}
                  onChange={handleEditorChange}
                  options={{ ...mcEditorOptions, fontSize: 11 }}
                />
                {specError && (
                  <div className="px-2 py-1 text-xs text-mc-redstone">JSON 解析错误：{specError}</div>
                )}
              </div>
            )}
          </div>
        )}

        {/* 构建 */}
        <div className="border-b border-mc-border">
          <button
            onClick={() => toggleSection('build')}
            className="mc-section-title flex w-full items-center justify-between transition-colors hover:bg-mc-surface-2/50"
          >
            <span>构建</span>
            {expandedSections.build ? <McIcon scope="pixel" name="chevron-up" size={12} /> : <McIcon scope="pixel" name="chevron-down" size={12} />}
          </button>
          {expandedSections.build && (
            <div className="space-y-3 p-3">
              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  onClick={build}
                  disabled={loading || files.length === 0}
                  className="mc-btn-primary"
                >
                  {loading ? '构建中…' : '编译'}
                </button>
                <button
                  onClick={buildStream}
                  disabled={streamBuilding || files.length === 0}
                  className="mc-btn-primary"
                >
                  {streamBuilding ? '流式编译中…' : '流式编译'}
                </button>
                {(streamLog || buildLog) && (
                  <button
                    onClick={clearStreamLog}
                    className="mc-btn-ghost !px-2.5"
                  >
                    清空
                  </button>
                )}
                <span className="text-xs text-mc-mute">构建：{buildCount}</span>
                {fixLog.length > 0 && (
                  <span className="text-xs text-mc-accent">修复：{fixLog.length}</span>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {buildSuccess === true && <span className="text-xs text-mc-accent">编译成功！</span>}
                {buildSuccess === false && <span className="text-xs text-mc-redstone">编译失败</span>}
                {jarPath && <span className="text-xs text-mc-dim">产物：{jarPath}</span>}
                {streamSuccess === true && (
                  <span className="text-xs text-mc-accent">构建成功！{streamJarPath && `产物：${streamJarPath}`}</span>
                )}
                {streamSuccess === false && (
                  <span className="text-xs text-mc-redstone">构建失败，请查看日志</span>
                )}
              </div>

              {fixLog.length > 0 && (
                <div className="space-y-1 rounded-mc-lg bg-mc-bg p-2">
                  <div className="text-xs font-bold text-mc-dim">修复过程</div>
                  {fixLog.map((log, i) => (
                    <div key={i} className="text-xs text-mc-mute">• {log}</div>
                  ))}
                </div>
              )}

              {streamLog ? (
                <div className="max-h-32 overflow-auto rounded-mc-lg bg-mc-bg p-2 font-mono text-xs">
                  {renderLog(streamLog)}
                </div>
              ) : (
                buildLog && (
                  <pre className="max-h-32 overflow-auto rounded-mc-lg bg-mc-bg p-2 text-xs text-mc-dim">{buildLog}</pre>
                )
              )}
            </div>
          )}
        </div>

        {/* AI 助手 */}
        <div className="flex flex-col">
          <button
            onClick={() => toggleSection('chat')}
            className="mc-section-title flex w-full items-center justify-between transition-colors hover:bg-mc-surface-2/50"
          >
            <span className="flex items-center gap-1.5">
              <McIcon scope="pixel" name="star" size={12} /> AI 助手
            </span>
            {expandedSections.chat ? <McIcon scope="pixel" name="chevron-up" size={12} /> : <McIcon scope="pixel" name="chevron-down" size={12} />}
          </button>
          {expandedSections.chat && (
            <div className="flex min-h-[180px] flex-1 flex-col">
              <div className="flex-1 space-y-2 overflow-y-auto p-3">
                {messages.map((m, i) => (
                  <div key={i} className={`rounded-mc-lg p-2 text-xs ${
                    m.role === 'user'
                      ? 'border border-mc-accent/40 bg-mc-accent/15'
                      : 'bg-mc-surface-2'
                  }`}>
                    <div className="whitespace-pre-wrap text-mc-text">{m.text}</div>
                    {m.role === 'assistant' && sending && i === messages.length - 1 && m.text === '' && (
                      <span className="text-mc-mute">思考中…</span>
                    )}
                    {m.role === 'assistant' && sending && i === messages.length - 1 && m.text !== '' && (
                      <span className="ml-0.5 inline-block h-3 w-1 animate-pulse bg-mc-dim" />
                    )}
                  </div>
                ))}
                <div ref={bottomRef} />
              </div>
              <div className="flex gap-2 border-t border-mc-border p-3">
                <input
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && send()}
                  placeholder={apiKey ? '输入消息…' : '请先配置 API Key'}
                  className="mc-input flex-1 !py-2"
                  disabled={sending || !apiKey}
                />
                <button
                  onClick={send}
                  disabled={sending || !input.trim() || !apiKey}
                  className="mc-btn-primary"
                >
                  {sending ? '…' : <><Send className="h-3 w-3" /> 发送</>}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
