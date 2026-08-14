import { useState, useRef } from 'react';
import { shallow } from 'zustand/shallow';
import { McIcon } from '../assets/mc-ui/McIcon';
import Editor from '@monaco-editor/react';
import {
  Loader2,
  Send,
  LayoutTemplate,
  History,
  GitCompare,
  Code2,
  FormInput,
  Share2,
} from 'lucide-react';
import type { ModEntry, ModSpec } from '@mc-creator/shared';
import { useModStore } from '../store/mod-store.js';
import { useModelConfigStore } from '../store/model-config-store.js';
import { useSpecHistoryStore } from '../store/spec-history-store.js';
import { ipcClient } from '../lib/ipc-client.js';
import { ErrorBanner } from './ErrorBanner.js';
import { TemplatePicker } from './TemplatePicker.js';
import { ModrinthSearchPanel } from './ModrinthSearchPanel.js';
import { CurseForgeSearchPanel } from './CurseForgeSearchPanel.js';
import { SpecHistoryPanel } from './SpecHistoryPanel.js';
import { CollaborationPanel } from './CollaborationPanel.js';
import { ModelComparePanel } from './ModelComparePanel.js';
import { SpecFormEditor } from './SpecFormEditor.js';
import { AgentSessionPanel } from './AgentSessionPanel.js';
import { defineMcMonacoTheme, mcEditorOptions, MC_MONACO_THEME } from '../lib/monaco-theme.js';

interface Msg {
  role: 'user' | 'assistant';
  text: string;
}

export function AgentPanel() {
  // P3 性能：shallow 选择器避免无关字段变化触发重渲染
  const {
    description,
    setDescription,
    loader,
    mcVersion,
    generatorType,
    spec,
    setSpec,
    setFiles,
    setLoading,
    setError,
    loading,
    error,
  } = useModStore(
    (s) => ({
      description: s.description,
      setDescription: s.setDescription,
      loader: s.loader,
      mcVersion: s.mcVersion,
      generatorType: s.generatorType,
      spec: s.spec,
      setSpec: s.setSpec,
      setFiles: s.setFiles,
      setLoading: s.setLoading,
      setError: s.setError,
      loading: s.loading,
      error: s.error,
    }),
    shallow,
  );
  const { apiKey } = useModelConfigStore();
  const historyCount = useSpecHistoryStore((s) => s.versions.length);

  const [editorText, setEditorText] = useState('');
  const [originalSpec, setOriginalSpec] = useState('');
  const [specError, setSpecError] = useState<string | null>(null);

  const [showTemplates, setShowTemplates] = useState(false);
  const [showModrinthSearch, setShowModrinthSearch] = useState(false);
  const [showCurseForgeSearch, setShowCurseForgeSearch] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showCompare, setShowCompare] = useState(false);
  const [showCollaboration, setShowCollaboration] = useState(false);
  const [showFormEditor, setShowFormEditor] = useState(false);
  const [agentMode, setAgentMode] = useState<'chat' | 'agent'>('agent');

  const [messages, setMessages] = useState<Msg[]>([
    { role: 'assistant', text: '你好！描述你想要的 mod，我来帮你生成。' },
  ]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const [expandedSections, setExpandedSections] = useState({
    description: true,
    spec: true,
    chat: true,
  });

  const toggleSection = (section: keyof typeof expandedSections) => {
    setExpandedSections((prev) => ({ ...prev, [section]: !prev[section] }));
  };

  const generateSpec = async () => {
    setLoading(true);
    setError(null);
    try {
      // T3: 失败自动重试 1 次（短暂延迟），仍失败才报错
      let res;
      try {
        res = await ipcClient.generateSpec(description, generatorType);
      } catch (firstErr) {
        await new Promise((r) => setTimeout(r, 800));
        res = await ipcClient.generateSpec(description, generatorType);
      }
      const text = JSON.stringify(res.spec, null, 2);
      setSpec(res.spec as unknown as ModSpec);
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
      const res = await ipcClient.generateFiles({
        loader,
        mcVersion,
        spec: parsedSpec,
        generatorType,
      });
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
      setSpec(parsed as unknown as ModSpec);
      setSpecError(null);
    } catch (e) {
      setSpecError((e as Error).message);
    }
  };

  const resetSpec = () => {
    setEditorText(originalSpec);
    try {
      setSpec(JSON.parse(originalSpec) as unknown as ModSpec);
      setSpecError(null);
    } catch {
      // 忽略：originalSpec 是展示用的字符串，重置时无需处理解析错误
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
    setSpec(updatedSpec as unknown as ModSpec);
    setOriginalSpec(text);
    setSpecError(null);
    closePanel();
  };

  const handleModrinthPick = (mod: ModEntry) =>
    pickModToSpec(mod, () => setShowModrinthSearch(false));
  const handleCurseForgePick = (mod: ModEntry) =>
    pickModToSpec(mod, () => setShowCurseForgeSearch(false));

  /** 回滚到历史版本后，同步本地编辑器文本与基准 spec */
  const handleHistoryRollback = (rolledBackSpec: unknown) => {
    const text = JSON.stringify(rolledBackSpec, null, 2);
    setEditorText(text);
    setOriginalSpec(text);
    setSpecError(null);
  };

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

  const PLACEHOLDERS: Record<string, string> = {
    mod: '描述你想要的 mod…',
    datapack: '描述你想要的数据包…',
    modpack: '描述你想要的整合包…',
    server: '描述你想要的服务器配置…',
    resource_pack: '描述你想要的资源包…',
    skin: '描述你想要的皮肤…',
    launcher: '描述你想要的启动器配置…',
    kubejs: '描述你想要的 KubeJS 脚本…',
    crafttweaker: '描述你想要的 CraftTweaker 脚本…',
    behavior_pack: '描述你想要的行为包…',
    enchantment: '描述你想要的附魔…',
    behavior_item: '描述你想要的自定义物品…',
  };
  const placeholder = PLACEHOLDERS[generatorType] ?? '描述你想要的内容…';

  return (
    <div className="relative flex h-full flex-col bg-mc-surface">
      <div className="flex-1 overflow-y-auto">
        {/* 描述输入 */}
        <div className="border-b border-mc-border">
          <button
            onClick={() => toggleSection('description')}
            className="mc-section-title flex w-full items-center justify-between transition-colors hover:bg-mc-surface-2/50"
          >
            <span>描述输入</span>
            {expandedSections.description ? (
              <McIcon scope="pixel" name="chevron-up" size={12} />
            ) : (
              <McIcon scope="pixel" name="chevron-down" size={12} />
            )}
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
                <button
                  onClick={() => setShowHistory(true)}
                  disabled={loading}
                  className="mc-btn-ghost !px-2.5 relative"
                  title="Spec 版本历史"
                >
                  <History className="h-3 w-3" />
                  {historyCount > 0 && (
                    <span className="absolute -right-0.5 -top-0.5 flex h-3 min-w-3 items-center justify-center rounded-full bg-mc-accent px-0.5 text-[10px] font-bold leading-none text-mc-bg">
                      {historyCount > 99 ? '99+' : historyCount}
                    </span>
                  )}
                </button>
                <button
                  onClick={() => setShowCompare(true)}
                  disabled={loading}
                  className="mc-btn-ghost !px-2.5"
                  title="多模型对比"
                >
                  <GitCompare className="h-3 w-3" />
                </button>
                <button
                  onClick={() => setShowCollaboration(true)}
                  disabled={loading}
                  className="mc-btn-ghost !px-2.5"
                  title="协作（导出/导入 Spec）"
                >
                  <Share2 className="h-3 w-3" />
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
              {expandedSections.spec ? (
                <McIcon scope="pixel" name="chevron-up" size={12} />
              ) : (
                <McIcon scope="pixel" name="chevron-down" size={12} />
              )}
            </button>
            {expandedSections.spec && (
              <div
                className={`rounded-b border-x border-b ${specError ? 'border-mc-redstone' : 'border-mc-border'} bg-mc-bg`}
              >
                <div className="flex items-center justify-between border-b border-mc-border px-2 py-1.5">
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => setShowFormEditor(false)}
                      className={`flex items-center gap-1 rounded-mc px-1.5 py-0.5 text-xs transition-colors ${
                        !showFormEditor
                          ? 'bg-mc-accent/20 text-mc-accent-bright'
                          : 'text-mc-dim hover:bg-mc-surface-2 hover:text-mc-text'
                      }`}
                    >
                      <Code2 className="h-3 w-3" />
                      文本
                    </button>
                    <button
                      onClick={() => setShowFormEditor(true)}
                      className={`flex items-center gap-1 rounded-mc px-1.5 py-0.5 text-xs transition-colors ${
                        showFormEditor
                          ? 'bg-mc-accent/20 text-mc-accent-bright'
                          : 'text-mc-dim hover:bg-mc-surface-2 hover:text-mc-text'
                      }`}
                    >
                      <FormInput className="h-3 w-3" />
                      表单
                    </button>
                  </div>
                  <button
                    onClick={resetSpec}
                    className="rounded-mc bg-mc-surface-3 px-2 py-0.5 text-xs text-mc-dim transition-colors hover:bg-mc-border-strong"
                  >
                    重置
                  </button>
                </div>
                {showFormEditor ? (
                  <div className="max-h-[200px] overflow-y-auto p-2">
                    <SpecFormEditor
                      spec={spec as Record<string, unknown>}
                      onChange={(updated) => {
                        const text = JSON.stringify(updated, null, 2);
                        setEditorText(text);
                        setSpec(updated as unknown as ModSpec);
                        setSpecError(null);
                      }}
                    />
                  </div>
                ) : (
                  <>
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
                      <div className="px-2 py-1 text-xs text-mc-redstone">
                        JSON 解析错误：{specError}
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        )}

        {/* AI 助手 / 智能体 */}
        <div className="flex flex-col">
          <button
            onClick={() => toggleSection('chat')}
            className="mc-section-title flex w-full items-center justify-between transition-colors hover:bg-mc-surface-2/50"
          >
            <span className="flex items-center gap-1.5">
              <McIcon scope="pixel" name="star" size={12} />{' '}
              {agentMode === 'agent' ? 'AI 智能体' : 'AI 助手'}
            </span>
            <div className="flex items-center gap-1">
              {/* 模式切换 */}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setAgentMode((m) => (m === 'chat' ? 'agent' : 'chat'));
                }}
                className="rounded-mc px-1 py-0.5 text-[10px] text-mc-mute hover:text-mc-text"
                title={agentMode === 'chat' ? '切换到智能体模式' : '切换到聊天模式'}
              >
                {agentMode === 'chat' ? '🤖' : '💬'}
              </button>
              {expandedSections.chat ? (
                <McIcon scope="pixel" name="chevron-up" size={12} />
              ) : (
                <McIcon scope="pixel" name="chevron-down" size={12} />
              )}
            </div>
          </button>
          {expandedSections.chat &&
            (agentMode === 'agent' ? (
              <AgentSessionPanel />
            ) : (
              <div className="flex min-h-[180px] flex-1 flex-col">
                <div className="flex-1 space-y-2 overflow-y-auto p-3">
                  {messages.map((m, i) => (
                    <div
                      key={i}
                      className={`rounded-mc-lg p-2 text-xs ${
                        m.role === 'user'
                          ? 'border border-mc-accent/40 bg-mc-accent/15'
                          : 'bg-mc-surface-2'
                      }`}
                    >
                      <div className="whitespace-pre-wrap text-mc-text">{m.text}</div>
                      {m.role === 'assistant' &&
                        sending &&
                        i === messages.length - 1 &&
                        m.text === '' && <span className="text-mc-mute">思考中…</span>}
                      {m.role === 'assistant' &&
                        sending &&
                        i === messages.length - 1 &&
                        m.text !== '' && (
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
                    {sending ? (
                      '…'
                    ) : (
                      <>
                        <Send className="h-3 w-3" /> 发送
                      </>
                    )}
                  </button>
                </div>
              </div>
            ))}
        </div>
      </div>

      {/* Spec 版本历史浮层面板 */}
      {showHistory && (
        <div className="absolute inset-0 z-20 bg-mc-surface">
          <SpecHistoryPanel
            onClose={() => setShowHistory(false)}
            onRollback={handleHistoryRollback}
          />
        </div>
      )}

      {/* 多模型对比浮层面板 */}
      {showCompare && (
        <div className="absolute inset-0 z-20 bg-mc-surface">
          <ModelComparePanel
            description={description}
            generatorType={generatorType}
            onClose={() => setShowCompare(false)}
            onAdopt={(spec: unknown, specText: string) => {
              setSpec(spec as unknown as ModSpec);
              setEditorText(specText);
              setOriginalSpec(specText);
              setSpecError(null);
            }}
          />
        </div>
      )}

      {/* 协作面板 */}
      {showCollaboration && (
        <div className="absolute inset-0 z-20 bg-mc-surface">
          <CollaborationPanel onClose={() => setShowCollaboration(false)} />
        </div>
      )}
    </div>
  );
}
