import { useState } from 'react';
import { McIcon } from '../assets/mc-ui/McIcon';
import { LayoutGrid, Layers, AlignLeft, AlignCenter, AlignRight, Square } from 'lucide-react';

interface LayoutBlock {
  id: string;
  type: 'container' | 'flex' | 'grid' | 'item';
  label: string;
  className: string;
  children?: LayoutBlock[];
}

const PRESETS: { name: string; layout: LayoutBlock; code: string }[] = [
  {
    name: 'Flex横向布局',
    layout: {
      id: 'root',
      type: 'flex',
      label: '容器',
      className: 'flex gap-4',
      children: [
        { id: '1', type: 'item', label: '元素1', className: 'flex-1 bg-mc-accent' },
        { id: '2', type: 'item', label: '元素2', className: 'flex-1 bg-mc-accent' },
        { id: '3', type: 'item', label: '元素3', className: 'flex-1 bg-mc-gold' },
      ],
    },
    code: `<div className="flex gap-4">
  <div className="flex-1 bg-mc-accent">元素1</div>
  <div className="flex-1 bg-mc-accent">元素2</div>
  <div className="flex-1 bg-mc-gold">元素3</div>
</div>`,
  },
  {
    name: 'Flex垂直布局',
    layout: {
      id: 'root',
      type: 'flex',
      label: '容器',
      className: 'flex flex-col gap-4',
      children: [
        { id: '1', type: 'item', label: '头部', className: 'h-10 bg-mc-accent' },
        { id: '2', type: 'item', label: '内容', className: 'flex-1 bg-mc-accent' },
        { id: '3', type: 'item', label: '底部', className: 'h-10 bg-mc-gold' },
      ],
    },
    code: `<div className="flex flex-col gap-4">
  <div className="h-10 bg-mc-accent">头部</div>
  <div className="flex-1 bg-mc-accent">内容</div>
  <div className="h-10 bg-mc-gold">底部</div>
</div>`,
  },
  {
    name: 'Grid网格布局',
    layout: {
      id: 'root',
      type: 'grid',
      label: '网格',
      className: 'grid grid-cols-3 gap-4',
      children: [
        { id: '1', type: 'item', label: 'A', className: 'bg-mc-accent' },
        { id: '2', type: 'item', label: 'B', className: 'bg-mc-accent' },
        { id: '3', type: 'item', label: 'C', className: 'bg-mc-gold' },
        { id: '4', type: 'item', label: 'D', className: 'bg-mc-accent' },
        { id: '5', type: 'item', label: 'E', className: 'bg-mc-accent' },
        { id: '6', type: 'item', label: 'F', className: 'bg-mc-gold' },
      ],
    },
    code: `<div className="grid grid-cols-3 gap-4">
  <div className="bg-mc-accent">A</div>
  <div className="bg-mc-accent">B</div>
  <div className="bg-mc-gold">C</div>
  <div className="bg-mc-accent">D</div>
  <div className="bg-mc-accent">E</div>
  <div className="bg-mc-gold">F</div>
</div>`,
  },
  {
    name: '三栏布局',
    layout: {
      id: 'root',
      type: 'flex',
      label: '主容器',
      className: 'flex gap-0',
      children: [
        { id: '1', type: 'item', label: '左栏', className: 'w-40 bg-mc-surface-3' },
        { id: '2', type: 'item', label: '中栏', className: 'flex-1 bg-mc-surface-2' },
        { id: '3', type: 'item', label: '右栏', className: 'w-64 bg-mc-surface-3' },
      ],
    },
    code: `<div className="flex">
  <div className="w-40 bg-mc-surface-3">左栏</div>
  <div className="flex-1 bg-mc-surface-2">中栏</div>
  <div className="w-64 bg-mc-surface-3">右栏</div>
</div>`,
  },
];

const PROPS = [
  { name: 'flex', desc: '启用flex布局' },
  { name: 'flex-col', desc: '垂直排列' },
  { name: 'flex-1', desc: '占满剩余空间' },
  { name: 'grid', desc: '启用grid布局' },
  { name: 'grid-cols-2', desc: '2列网格' },
  { name: 'grid-cols-3', desc: '3列网格' },
  { name: 'gap-4', desc: '间距16px' },
  { name: 'items-center', desc: '垂直居中' },
  { name: 'justify-center', desc: '水平居中' },
  { name: 'w-full', desc: '宽度100%' },
  { name: 'h-full', desc: '高度100%' },
];

function renderBlock(block: LayoutBlock) {
  if (block.type === 'item') {
    return (
      <div
        key={block.id}
        className={`${block.className} rounded-mc p-4 text-center text-sm font-medium text-white`}
      >
        {block.label}
      </div>
    );
  }
  return (
    <div key={block.id} className={`${block.className} h-full rounded-mc bg-mc-surface p-4`}>
      {block.children?.map(renderBlock)}
    </div>
  );
}

export function LayoutLearner() {
  const [selectedPreset, setSelectedPreset] = useState(0);
  const [activeProps, setActiveProps] = useState<string[]>([]);
  const [expandedProps, setExpandedProps] = useState(false);

  const toggleProp = (prop: string) => {
    setActiveProps((prev) =>
      prev.includes(prop) ? prev.filter((p) => p !== prop) : [...prev, prop]
    );
  };

  const currentPreset = PRESETS[selectedPreset];

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-mc-border px-3 py-2">
        <LayoutGrid className="h-4 w-4 text-mc-accent" />
        <span className="text-xs font-semibold text-mc-text">布局学习器</span>
      </div>

      <div className="flex-1 overflow-y-auto p-3">
        <div className="mb-4">
          <div className="mb-2 text-xs text-mc-text-dim">选择布局示例</div>
          <div className="flex flex-wrap gap-2">
            {PRESETS.map((preset, index) => (
              <button
                key={preset.name}
                onClick={() => setSelectedPreset(index)}
                className={`rounded-mc px-3 py-1.5 text-xs transition-colors ${
                  selectedPreset === index
                    ? 'bg-mc-accent text-white'
                    : 'bg-mc-surface-2 text-mc-text hover:bg-mc-surface-3'
                }`}
              >
                {preset.name}
              </button>
            ))}
          </div>
        </div>

        <div className="mb-4">
          <button
            onClick={() => setExpandedProps(!expandedProps)}
            className="flex w-full items-center justify-between text-xs text-mc-text-dim hover:text-mc-text"
          >
            <span className="flex items-center gap-1">
              <Layers className="h-3 w-3" /> 属性面板
            </span>
            {expandedProps ? <McIcon scope="pixel" name="chevron-right" size={12} className="rotate-90" /> : <McIcon scope="pixel" name="chevron-right" size={12} />}
          </button>
          {expandedProps && (
            <div className="mt-2 grid grid-cols-2 gap-2">
              {PROPS.map((prop) => (
                <button
                  key={prop.name}
                  onClick={() => toggleProp(prop.name)}
                  className={`flex items-center gap-2 rounded px-2 py-1.5 text-xs transition-colors ${
                    activeProps.includes(prop.name)
                      ? 'bg-mc-accent/20 text-mc-accent border border-mc-accent/50'
                      : 'bg-mc-surface-2 text-mc-text-dim hover:bg-mc-surface-3'
                  }`}
                  title={prop.desc}
                >
                  <div className="font-mono font-medium">{prop.name}</div>
                  <McIcon scope="pixel" name="minus" size={10} />
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="mb-4">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs text-mc-text-dim">实时预览</span>
            <span className="text-xs text-mc-mute">点击上方按钮调整</span>
          </div>
          <div className="h-48 rounded-mc border border-mc-border-strong bg-mc-bg overflow-hidden">
            {renderBlock(currentPreset.layout)}
          </div>
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs text-mc-text-dim">代码示例</span>
            <div className="flex items-center gap-2">
              <AlignLeft className="h-3 w-3 text-mc-mute" />
              <AlignCenter className="h-3 w-3 text-mc-mute" />
              <AlignRight className="h-3 w-3 text-mc-mute" />
            </div>
          </div>
          <div className="rounded-mc border border-mc-border-strong bg-mc-bg p-3">
            <pre className="text-xs font-mono text-mc-text-dim whitespace-pre-wrap">{currentPreset.code}</pre>
          </div>
        </div>

        <div className="mt-4 rounded-mc border border-mc-border-strong bg-mc-surface p-3">
          <div className="text-xs font-semibold text-mc-text-dim mb-2">布局原理</div>
          <div className="space-y-2 text-xs text-mc-text-dim">
            {currentPreset.name === 'Flex横向布局' && (
              <>
                <p><span className="text-mc-text">flex</span> - 让子元素排成一行</p>
                <p><span className="text-mc-text">flex-1</span> - 每个元素平分剩余空间</p>
                <p><span className="text-mc-text">gap-4</span> - 元素之间留16px间距</p>
              </>
            )}
            {currentPreset.name === 'Flex垂直布局' && (
              <>
                <p><span className="text-mc-text">flex-col</span> - 让子元素垂直排列</p>
                <p><span className="text-mc-text">flex-1</span> - 内容区域占满剩余高度</p>
                <p><span className="text-mc-text">h-10</span> - 固定高度40px</p>
              </>
            )}
            {currentPreset.name === 'Grid网格布局' && (
              <>
                <p><span className="text-mc-text">grid</span> - 启用网格布局</p>
                <p><span className="text-mc-text">grid-cols-3</span> - 分成3列</p>
                <p><span className="text-mc-text">gap-4</span> - 网格间距16px</p>
              </>
            )}
            {currentPreset.name === '三栏布局' && (
              <>
                <p><span className="text-mc-text">flex</span> - 横向排列三栏</p>
                <p><span className="text-mc-text">w-40/w-64</span> - 左右栏固定宽度</p>
                <p><span className="text-mc-text">flex-1</span> - 中间栏自适应</p>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}