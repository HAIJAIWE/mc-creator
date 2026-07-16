import { useState } from 'react';
import { LayoutGrid, LayoutPanelTop, PanelRight, LayoutList, Maximize2, Minimize2, Palette, Move } from 'lucide-react';
import { MC_THEMES, applyTheme } from '../lib/themes.js';

interface LayoutConfigProps {
  leftWidth: number;
  rightWidth: number;
  onLeftWidthChange: (width: number) => void;
  onRightWidthChange: (width: number) => void;
}

const LAYOUT_PRESETS = [
  { id: 'full', name: '全屏', icon: LayoutList, description: '只显示中间编辑器', left: 0, right: 0 },
  { id: 'left', name: '左侧', icon: LayoutPanelTop, description: '左侧文件树 + 中间编辑器', left: 200, right: 0 },
  { id: 'right', name: '右侧', icon: PanelRight, description: '中间编辑器 + 右侧面板', left: 0, right: 360 },
  { id: 'both', name: '三栏', icon: LayoutGrid, description: '左侧文件树 + 中间编辑器 + 右侧面板', left: 200, right: 360 },
];

export function LayoutConfig({ leftWidth, rightWidth, onLeftWidthChange, onRightWidthChange }: LayoutConfigProps) {
  const [activeSection, setActiveSection] = useState<'presets' | 'sizes' | 'theme'>('presets');
  const [activeTheme, setActiveTheme] = useState<string>(() => {
    try { return localStorage.getItem('mc-creator-theme') ?? 'grass'; } catch { return 'grass'; }
  });

  const applyPreset = (preset: typeof LAYOUT_PRESETS[0]) => {
    onLeftWidthChange(preset.left);
    onRightWidthChange(preset.right);
  };

  const setTheme = (id: string) => {
    applyTheme(id);
    setActiveTheme(id);
  };

  const getCurrentPreset = () => {
    if (leftWidth === 0 && rightWidth === 0) return 'full';
    if (leftWidth > 0 && rightWidth === 0) return 'left';
    if (leftWidth === 0 && rightWidth > 0) return 'right';
    return 'both';
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-mc-border px-3 py-2">
        <LayoutGrid className="h-4 w-4 text-mc-accent" />
        <span className="text-xs font-semibold text-mc-text">布局配置器</span>
      </div>

      <div className="flex border-b border-mc-border">
        <button
          onClick={() => setActiveSection('presets')}
          className={`flex-1 py-2 text-xs font-medium transition-colors ${
            activeSection === 'presets' ? 'bg-mc-surface-2 text-mc-text' : 'text-mc-text-dim hover:text-mc-text'
          }`}
        >
          布局预设
        </button>
        <button
          onClick={() => setActiveSection('sizes')}
          className={`flex-1 py-2 text-xs font-medium transition-colors ${
            activeSection === 'sizes' ? 'bg-mc-surface-2 text-mc-text' : 'text-mc-text-dim hover:text-mc-text'
          }`}
        >
          面板尺寸
        </button>
        <button
          onClick={() => setActiveSection('theme')}
          className={`flex-1 py-2 text-xs font-medium transition-colors ${
            activeSection === 'theme' ? 'bg-mc-surface-2 text-mc-text' : 'text-mc-text-dim hover:text-mc-text'
          }`}
        >
          主题颜色
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-3">
        {activeSection === 'presets' && (
          <div className="space-y-2">
            {LAYOUT_PRESETS.map((preset) => {
              const Icon = preset.icon;
              const isActive = getCurrentPreset() === preset.id;
              return (
                <button
                  key={preset.id}
                  onClick={() => applyPreset(preset)}
                  className={`flex items-center gap-3 rounded-mc p-3 transition-all ${
                    isActive
                      ? 'bg-mc-accent/20 border border-mc-accent/50'
                      : 'bg-mc-surface-2/50 border border-transparent hover:bg-mc-surface-2'
                  }`}
                >
                  <div className={`flex h-10 w-10 items-center justify-center rounded-mc ${
                    isActive ? 'bg-mc-accent/20' : 'bg-mc-surface-3'
                  }`}>
                    <Icon className={`h-5 w-5 ${isActive ? 'text-mc-accent' : 'text-mc-text-dim'}`} />
                  </div>
                  <div className="flex-1 text-left">
                    <div className={`text-sm font-medium ${isActive ? 'text-mc-accent-bright' : 'text-mc-text'}`}>
                      {preset.name}
                    </div>
                    <div className="text-xs text-mc-text-dim">{preset.description}</div>
                  </div>
                  {isActive && (
                    <div className="flex h-4 w-4 items-center justify-center rounded-full bg-mc-accent">
                      <svg className="h-2.5 w-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                      </svg>
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        )}

        {activeSection === 'sizes' && (
          <div className="space-y-4">
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-mc-text">左侧面板宽度</span>
                <span className="text-xs text-mc-text-dim">{leftWidth}px</span>
              </div>
              <input
                type="range"
                min="0"
                max="400"
                value={leftWidth}
                onChange={(e) => onLeftWidthChange(parseInt(e.target.value))}
                className="w-full h-2 rounded-full bg-mc-surface-3 appearance-none cursor-pointer"
                style={{
                  background: `linear-gradient(to right, rgb(var(--mc-accent)) 0%, rgb(var(--mc-accent)) ${(leftWidth / 400) * 100}%, rgb(var(--mc-surface-3)) ${(leftWidth / 400) * 100}%, rgb(var(--mc-surface-3)) 100%)`,
                }}
              />
              <div className="flex justify-between mt-1">
                <button
                  onClick={() => onLeftWidthChange(0)}
                  className="text-xs text-mc-text-dim hover:text-mc-text"
                >
                  隐藏
                </button>
                <button
                  onClick={() => onLeftWidthChange(200)}
                  className="text-xs text-mc-text-dim hover:text-mc-text"
                >
                  默认
                </button>
                <button
                  onClick={() => onLeftWidthChange(400)}
                  className="text-xs text-mc-text-dim hover:text-mc-text"
                >
                  最宽
                </button>
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-mc-text">右侧面板宽度</span>
                <span className="text-xs text-mc-text-dim">{rightWidth}px</span>
              </div>
              <input
                type="range"
                min="0"
                max="560"
                value={rightWidth}
                onChange={(e) => onRightWidthChange(parseInt(e.target.value))}
                className="w-full h-2 rounded-full bg-mc-surface-3 appearance-none cursor-pointer"
                style={{
                  background: `linear-gradient(to right, rgb(var(--mc-accent)) 0%, rgb(var(--mc-accent)) ${(rightWidth / 560) * 100}%, rgb(var(--mc-surface-3)) ${(rightWidth / 560) * 100}%, rgb(var(--mc-surface-3)) 100%)`,
                }}
              />
              <div className="flex justify-between mt-1">
                <button
                  onClick={() => onRightWidthChange(0)}
                  className="text-xs text-mc-text-dim hover:text-mc-text"
                >
                  隐藏
                </button>
                <button
                  onClick={() => onRightWidthChange(360)}
                  className="text-xs text-mc-text-dim hover:text-mc-text"
                >
                  默认
                </button>
                <button
                  onClick={() => onRightWidthChange(560)}
                  className="text-xs text-mc-text-dim hover:text-mc-text"
                >
                  最宽
                </button>
              </div>
            </div>
          </div>
        )}

        {activeSection === 'theme' && (
          <div className="space-y-2">
            {MC_THEMES.map((theme) => {
              const isActive = activeTheme === theme.id;
              const a = theme.vars['--mc-accent'];
              const d = theme.vars['--mc-accent-deep'];
              const s = theme.vars['--mc-surface-2'];
              const b = theme.vars['--mc-border-strong'];
              return (
                <button
                  key={theme.id}
                  onClick={() => setTheme(theme.id)}
                  className={`flex items-center gap-3 rounded-mc p-3 text-left transition-all border ${
                    isActive
                      ? 'bg-mc-accent/15 border-mc-accent/50'
                      : 'bg-mc-surface-2/50 border-transparent hover:bg-mc-surface-2'
                  }`}
                >
                  <div className="flex items-center gap-1.5">
                    <div
                      className="h-7 w-7 rounded-mc border"
                      style={{ backgroundColor: `rgb(${s})`, borderColor: `rgb(${b})` }}
                    />
                    <div className="flex flex-col gap-1">
                      <div className="h-2.5 w-5 rounded-sm" style={{ backgroundColor: `rgb(${a})` }} />
                      <div className="h-2.5 w-5 rounded-sm" style={{ backgroundColor: `rgb(${d})` }} />
                    </div>
                  </div>
                  <div className="flex-1">
                    <div className={`text-sm font-medium ${isActive ? 'text-mc-accent-bright' : 'text-mc-text'}`}>
                      {theme.name}
                    </div>
                    <div className="text-xs text-mc-mute">{theme.description}</div>
                  </div>
                  {isActive && (
                    <div className="flex h-4 w-4 items-center justify-center rounded-full bg-mc-accent">
                      <svg className="h-2.5 w-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                      </svg>
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div className="border-t border-mc-border p-3">
        <div className="text-xs text-mc-text-dim text-center">
          提示：拖动面板边缘也可以调整宽度
        </div>
      </div>
    </div>
  );
}