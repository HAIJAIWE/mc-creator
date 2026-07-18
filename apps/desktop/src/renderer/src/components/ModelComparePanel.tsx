import { useState } from 'react';
import { GitCompare, Check, Loader2, X, ArrowLeft } from 'lucide-react';
import { ipcClient } from '../lib/ipc-client.js';
import type { ModSpec } from '@mc-creator/shared';

/** 模型预设列表（与 SettingsPanel 对齐） */
const MODEL_PRESETS = [
  {
    name: 'OpenAI',
    baseURL: 'https://api.openai.com/v1',
    modelId: 'gpt-4o-mini',
    apiKeyPlaceholder: 'sk-...',
  },
  {
    name: 'DeepSeek',
    baseURL: 'https://api.deepseek.com/v1',
    modelId: 'deepseek-chat',
    apiKeyPlaceholder: 'sk-...',
  },
  {
    name: '通义千问',
    baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    modelId: 'qwen-plus',
    apiKeyPlaceholder: 'sk-...',
  },
  {
    name: '智谱 GLM',
    baseURL: 'https://open.bigmodel.cn/api/paas/v4',
    modelId: 'glm-4-flash',
    apiKeyPlaceholder: '...',
  },
  {
    name: 'Ollama (本地)',
    baseURL: 'http://localhost:11434/v1',
    modelId: 'qwen2.5:7b',
    apiKeyPlaceholder: '',
  },
  {
    name: 'LM Studio (本地)',
    baseURL: 'http://localhost:1234/v1',
    modelId: 'local-model',
    apiKeyPlaceholder: '',
  },
] as const;

interface ModelConfig {
  name: string;
  modelId: string;
  baseURL: string;
  apiKey: string;
}

interface ModelResult {
  modelName: string;
  delta: string;
  done: boolean;
}

interface ModelComparePanelProps {
  description: string;
  generatorType: string;
  onClose: () => void;
  onAdopt: (spec: unknown, specText: string) => void;
}

export function ModelComparePanel({
  description,
  generatorType,
  onClose,
  onAdopt,
}: ModelComparePanelProps) {
  const [phase, setPhase] = useState<'config' | 'result'>('config');
  const [modelCount, setModelCount] = useState(2);

  // 每个模型槽位的配置
  const [modelConfigs, setModelConfigs] = useState<ModelConfig[]>([
    {
      name: MODEL_PRESETS[0].name,
      modelId: MODEL_PRESETS[0].modelId,
      baseURL: MODEL_PRESETS[0].baseURL,
      apiKey: '',
    },
    {
      name: MODEL_PRESETS[1].name,
      modelId: MODEL_PRESETS[1].modelId,
      baseURL: MODEL_PRESETS[1].baseURL,
      apiKey: '',
    },
  ]);

  // 结果阶段：每个模型的生成结果
  const [results, setResults] = useState<Map<string, ModelResult>>(new Map());
  const [comparing, setComparing] = useState(false);

  const updateModelConfig = (index: number, field: keyof ModelConfig, value: string) => {
    setModelConfigs((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: value };
      return next;
    });
  };

  const applyPreset = (index: number, presetName: string) => {
    const preset = MODEL_PRESETS.find((p) => p.name === presetName);
    if (!preset) return;
    setModelConfigs((prev) => {
      const next = [...prev];
      next[index] = {
        ...next[index],
        name: preset.name,
        modelId: preset.modelId,
        baseURL: preset.baseURL,
      };
      return next;
    });
  };

  const addModelSlot = () => {
    if (modelCount >= 3) return;
    setModelCount((c) => c + 1);
    setModelConfigs((prev) => [
      ...prev,
      {
        name: MODEL_PRESETS[2].name,
        modelId: MODEL_PRESETS[2].modelId,
        baseURL: MODEL_PRESETS[2].baseURL,
        apiKey: '',
      },
    ]);
  };

  const removeModelSlot = () => {
    if (modelCount <= 2) return;
    setModelCount((c) => c - 1);
    setModelConfigs((prev) => prev.slice(0, -1));
  };

  const startCompare = async () => {
    setPhase('result');
    setComparing(true);
    setResults(new Map());

    const models = modelConfigs.slice(0, modelCount).filter((m) => m.modelId && m.baseURL);
    if (models.length < 2) {
      setComparing(false);
      return;
    }

    try {
      await ipcClient.compareModels({ description, generatorType, models }, (data) => {
        setResults((prev) => {
          const next = new Map(prev);
          const existing = next.get(data.modelName);
          if (existing && existing.done) return next;
          next.set(data.modelName, {
            modelName: data.modelName,
            delta: existing ? existing.delta + data.delta : data.delta,
            done: data.done,
          });
          return next;
        });
      });
    } catch {
      // invoke 失败时也结束 comparing
    } finally {
      setComparing(false);
    }
  };

  const handleAdopt = (result: ModelResult) => {
    try {
      const spec = JSON.parse(result.delta);
      onAdopt(spec as ModSpec, result.delta);
      onClose();
    } catch {
      // delta 不是合法 JSON，忽略
    }
  };

  return (
    <div className="flex h-full flex-col bg-mc-surface">
      {/* 头部 */}
      <div className="flex items-center justify-between border-b border-mc-border px-3 py-2">
        <div className="flex items-center gap-1.5 text-xs font-medium text-mc-text">
          <GitCompare className="h-3.5 w-3.5" />
          多模型对比
        </div>
        <button onClick={onClose} className="text-mc-mute transition-colors hover:text-mc-text">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* 配置阶段 */}
      {phase === 'config' && (
        <div className="flex-1 overflow-y-auto p-3">
          <div className="mb-3 text-xs text-mc-dim">
            选择 2-3 个模型同时生成 Spec，然后并排对比结果。
          </div>

          <div className={`grid gap-3 ${modelCount === 3 ? 'grid-cols-3' : 'grid-cols-2'}`}>
            {modelConfigs.slice(0, modelCount).map((cfg, i) => (
              <div key={i} className="rounded-mc border border-mc-border bg-mc-bg p-2.5">
                <div className="mb-2 text-xs font-medium text-mc-text">模型 {i + 1}</div>

                {/* 预设选择 */}
                <select
                  value={cfg.name}
                  onChange={(e) => applyPreset(i, e.target.value)}
                  className="mc-input mb-1.5 w-full !py-1 text-xs"
                >
                  {MODEL_PRESETS.map((p) => (
                    <option key={p.name} value={p.name}>
                      {p.name}
                    </option>
                  ))}
                </select>

                {/* 模型 ID */}
                <input
                  value={cfg.modelId}
                  onChange={(e) => updateModelConfig(i, 'modelId', e.target.value)}
                  placeholder="模型 ID"
                  className="mc-input mb-1.5 w-full !py-1 text-xs"
                />

                {/* Base URL */}
                <input
                  value={cfg.baseURL}
                  onChange={(e) => updateModelConfig(i, 'baseURL', e.target.value)}
                  placeholder="Base URL"
                  className="mc-input mb-1.5 w-full !py-1 text-xs"
                />

                {/* API Key */}
                <input
                  value={cfg.apiKey}
                  onChange={(e) => updateModelConfig(i, 'apiKey', e.target.value)}
                  placeholder={
                    MODEL_PRESETS.find((p) => p.name === cfg.name)?.apiKeyPlaceholder || 'API Key'
                  }
                  type="password"
                  className="mc-input w-full !py-1 text-xs"
                />
              </div>
            ))}
          </div>

          {/* 模型数量控制 */}
          <div className="mt-3 flex items-center gap-2">
            {modelCount < 3 && (
              <button onClick={addModelSlot} className="mc-btn-ghost text-xs">
                + 添加模型
              </button>
            )}
            {modelCount > 2 && (
              <button onClick={removeModelSlot} className="mc-btn-ghost text-xs">
                - 移除模型
              </button>
            )}
          </div>

          {/* 开始对比 */}
          <div className="mt-4">
            <button
              onClick={startCompare}
              disabled={
                !description ||
                modelConfigs.slice(0, modelCount).some((m) => !m.modelId || !m.baseURL)
              }
              className="mc-btn-primary w-full"
            >
              <GitCompare className="h-3 w-3" />
              开始对比
            </button>
          </div>
        </div>
      )}

      {/* 结果阶段 */}
      {phase === 'result' && (
        <div className="flex-1 overflow-y-auto p-3">
          <div className="mb-3 flex items-center gap-2">
            <button
              onClick={() => {
                setPhase('config');
                setResults(new Map());
              }}
              className="mc-btn-ghost text-xs"
            >
              <ArrowLeft className="h-3 w-3" />
              返回配置
            </button>
            {comparing && (
              <span className="flex items-center gap-1 text-xs text-mc-mute">
                <Loader2 className="h-3 w-3 animate-spin" />
                生成中…
              </span>
            )}
          </div>

          <div className={`grid gap-3 ${modelCount === 3 ? 'grid-cols-3' : 'grid-cols-2'}`}>
            {modelConfigs.slice(0, modelCount).map((cfg) => {
              const result = results.get(cfg.name);
              const isDone = result?.done ?? false;
              const isRunning = comparing && !isDone;

              return (
                <div
                  key={cfg.name}
                  className="flex flex-col rounded-mc border border-mc-border bg-mc-bg"
                >
                  {/* 模型名称 */}
                  <div className="flex items-center justify-between border-b border-mc-border px-2.5 py-1.5">
                    <span className="text-xs font-medium text-mc-text">{cfg.name}</span>
                    {isRunning && <Loader2 className="h-3 w-3 animate-spin text-mc-mute" />}
                    {isDone && <Check className="h-3 w-3 text-mc-accent" />}
                  </div>

                  {/* 结果内容 */}
                  <div className="flex-1 overflow-y-auto p-2.5">
                    {isRunning && !result?.delta && (
                      <span className="text-xs text-mc-mute">生成中…</span>
                    )}
                    {result?.delta && (
                      <pre
                        className="whitespace-pre-wrap break-words text-xs text-mc-text"
                        style={{ fontSize: '10px' }}
                      >
                        {result.delta}
                      </pre>
                    )}
                    {!isRunning && !result && (
                      <span className="text-xs text-mc-mute">等待生成…</span>
                    )}
                  </div>

                  {/* 采用按钮 */}
                  {isDone && result && (
                    <div className="border-t border-mc-border p-2">
                      <button
                        onClick={() => handleAdopt(result)}
                        className="mc-btn-primary w-full text-xs"
                      >
                        <Check className="h-3 w-3" />
                        采用此结果
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
