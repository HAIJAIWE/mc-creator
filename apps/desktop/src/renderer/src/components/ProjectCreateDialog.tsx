import { useState, useEffect, useMemo } from 'react';
import { McIcon } from '../assets/mc-ui/McIcon';
import { useTranslation } from '../hooks/useTranslation.js';
import type { GeneratorType, Loader, McVersion } from '@mc-creator/shared';
import { GENERATOR_DESCRIPTORS, GENERATOR_TYPES } from '../../../shared/generator-descriptors.js';

interface Props {
  onClose: () => void;
  onCreate: (data: CreateProjectData) => Promise<void>;
}

export interface CreateProjectData {
  name: string;
  generatorType: GeneratorType;
  loader: Loader;
  mcVersion: McVersion;
  description: string;
}

const VERSION_GROUPS = [
  { key: 'latest', versions: ['1.21.11', '1.21.5', '1.21.1', '1.20.6', '1.20.4'] },
  { key: 'lts', versions: ['1.20.1', '1.20.4', '1.20.6', '1.20.1'] },
  { key: 'old', versions: ['1.20.1', '1.20.1'] },
] as const;

export function ProjectCreateDialog({ onClose, onCreate }: Props) {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [generatorType, setGeneratorType] = useState<GeneratorType>('mod');
  const [loader, setLoader] = useState<Loader>('fabric');
  const [mcVersion, setMcVersion] = useState<McVersion>('1.21.11');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [step, setStep] = useState<'basic' | 'advanced'>('basic');

  // 基于生成器类型过滤可用的加载器
  const availableLoaders = useMemo((): Loader[] => {
    switch (generatorType) {
      case 'mod':
      case 'modpack':
      case 'server':
      case 'resource_pack':
      case 'skin':
      case 'launcher':
      case 'datapack':
        return ['fabric', 'neoforge', 'quilt', 'legacy_fabric', 'forge', 'vanilla'];
      case 'kubejs':
      case 'crafttweaker':
      case 'enchantment':
        return ['fabric', 'neoforge', 'legacy_fabric'];
      case 'behavior_pack':
      case 'behavior_item':
      case 'behavior_entity':
        return ['legacy_fabric', 'vanilla'];
      default:
        return ['fabric'];
    }
  }, [generatorType]);

  // 如果当前 loader 不在可用列表中，重置为第一个可用的
  useEffect(() => {
    if (!availableLoaders.includes(loader)) {
      setLoader(availableLoaders[0]);
    }
  }, [generatorType, availableLoaders]);

  const handleCreate = async () => {
    if (!name.trim()) return;
    setError(null);
    setCreating(true);
    try {
      await onCreate({
        name: name.trim(),
        generatorType,
        loader,
        mcVersion,
        description: description.trim(),
      });
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCreating(false);
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        handleCreate();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-[560px] max-w-full max-h-[90vh] overflow-y-auto rounded-mc-lg border border-mc-border-strong bg-mc-surface p-6 text-mc-text shadow-mc-pop animate-mc-dialog-in">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-display text-lg font-bold">{t('createDialog.title')}</h2>
          <button
            onClick={onClose}
            className="text-mc-mute transition-colors hover:text-mc-text"
            aria-label={t('common.close')}
          >
            <McIcon scope="pixel" name="close" size={16} />
          </button>
        </div>

        <div className="space-y-4">
          {/* 基础信息 */}
          <div className="space-y-3">
            <div>
              <label className="text-sm text-mc-dim">{t('createDialog.name')} <span className="text-mc-redstone">*</span></label>
              <input
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
                className="mc-input"
                placeholder={t('createDialog.namePlaceholder')}
              />
            </div>

            {/* 生成器类型选择 */}
            <div>
              <label className="text-sm text-mc-dim">{t('createDialog.type')} <span className="text-mc-redstone">*</span></label>
              <div className="grid grid-cols-2 gap-2 mt-1">
                {GENERATOR_TYPES.map((type: GeneratorType) => {
                  const desc = GENERATOR_DESCRIPTORS[type];
                  return (
                    <button
                      key={type}
                      type="button"
                      onClick={() => setGeneratorType(type)}
                      className={`mc-card p-3 transition-all relative ${
                        generatorType === type
                          ? 'border-mc-accent bg-mc-accent/5 shadow-[var(--mc-shadow-block)]'
                          : 'border-mc-border hover:border-mc-accent/50'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <McIcon
                          scope={desc.icon.scope}
                          name={desc.icon.name}
                          size={20}
                          className={generatorType === type ? 'text-mc-accent' : 'text-mc-dim'}
                        />
                        <div className="flex-1 text-left">
                          <div className="font-medium text-sm text-mc-text">
                            {t(`generator.${type}.label`) || type}
                          </div>
                          <div className="text-xs text-mc-mute truncate">
                            {t(`generator.${type}.description`) || ''}
                          </div>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 进阶选项切换 */}
            <button
              type="button"
              onClick={() => setStep(step === 'basic' ? 'advanced' : 'basic')}
              className="w-full text-left text-sm text-mc-dim hover:text-mc-text transition-colors flex items-center justify-between p-2 rounded-mc hover:bg-mc-surface-2"
            >
              <span>{step === 'basic' ? t('createDialog.advanced.show') : t('createDialog.advanced.hide')}</span>
              <McIcon
                scope="pixel"
                name={step === 'basic' ? 'chevron-down' : 'chevron-up'}
                size={14}
                className="transition-transform"
              />
            </button>
          </div>

          {/* 进阶选项 */}
          {step === 'advanced' && (
            <div className="space-y-3 p-4 rounded-mc-lg border border-mc-border bg-mc-surface/50 animate-in">
              <h4 className="font-medium text-sm text-mc-dim">{t('createDialog.advanced.title')}</h4>

              <div>
                <label className="text-sm text-mc-dim">{t('createDialog.loader')}</label>
                <select
                  value={loader}
                  onChange={(e) => setLoader(e.target.value as Loader)}
                  className="mc-input mt-1"
                >
                  {availableLoaders.map((l: Loader) => (
                    <option key={l} value={l}>{t('common.loader.' + l)}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-sm text-mc-dim">{t('createDialog.mcVersion')}</label>
                <div className="space-y-2 mt-1">
                  {VERSION_GROUPS.map((group) => (
                    <div key={group.key}>
                      <label className="text-xs text-mc-mute uppercase tracking-wider">{t('common.versionGroup.' + group.key)}</label>
                      <div className="flex flex-wrap gap-1 mt-1">
                        {group.versions.map((v) => (
                          <button
                            key={v}
                            type="button"
                            onClick={() => setMcVersion(v)}
                            className={`px-2 py-1 text-xs rounded-mc transition-all ${
                              mcVersion === v
                                ? 'bg-mc-accent text-mc-bg border-mc-accent'
                                : 'border-mc-border bg-mc-surface hover:border-mc-accent/50'
                            }`}
                          >
                            {v}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <label className="text-sm text-mc-dim">{t('createDialog.description')}</label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={3}
                  className="mc-input mt-1"
                  placeholder={t('createDialog.descriptionPlaceholder')}
                />
              </div>
            </div>
          )}

          {error && (
            <div className="rounded-mc-lg border border-mc-redstone bg-mc-redstone/15 px-3 py-2 text-sm text-mc-redstone">
              {error}
            </div>
          )}

          <div className="mt-2 flex items-center gap-3">
            <button
              onClick={onClose}
              className="mc-btn-ghost flex-1"
            >
              {t('common.cancel')}
            </button>
            <button
              onClick={handleCreate}
              disabled={creating || !name.trim()}
              className="mc-btn-primary flex-1"
            >
              {creating ? t('createDialog.creating') : t('createDialog.submit')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}