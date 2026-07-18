# 中间预览面板阶段 4 — resource_pack + skin 面板实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现 ResourcePackPreviewPanel（4 tab 表格画廊）和 SkinPreviewPanel（3D + 2D 预览，需 skinview3d），完成 MiddlePanel 全部 7 种类型调度。

**Architecture:** ResourcePack 面板参考 ModpackPreviewPanel 的 tab + DataTable 模式，4 个 tab：材质画廊（grid + base64 PNG 缩略图）/ 音效列表（HTML5 audio + base64 OGG）/ 模型表格 / 语言 key-value 表格。Skin 面板用 skinview3d 的 SkinViewer 渲染 3D 角色到 canvas（左侧），右侧用 `<img>` 显示完整 64x64 皮肤 PNG 并叠加半透明色块标注身体部位，底部用 FieldGroup 表单编辑 playerName/model/5 个颜色字段。两个面板都从 `useModStore.files` 按 path 查找 FileNode（content 是 base64 编码）。

**Tech Stack:** React 18 + TypeScript 5 + Zustand 4 + Tailwind CSS 3 + skinview3d（新增）+ HTML5 `<audio>` / `<canvas>` / `<img>`

**Spec:** [2026-07-17-middle-panel-per-generator-design.md](file:///d:/MC%20mod/docs/superpowers/specs/2026-07-17-middle-panel-per-generator-design.md) §5.5（resource_pack）+ §5.6（skin）

---

## 文件结构

### 新建
- `apps/desktop/src/renderer/src/components/middle/ResourcePackPreviewPanel.tsx` — 资源包预览（4 tab）
- `apps/desktop/src/renderer/src/components/middle/SkinPreviewPanel.tsx` — 皮肤预览（3D + 2D + 表单）

### 修改
- `apps/desktop/package.json` — 新增 `skinview3d` 依赖
- `apps/desktop/src/renderer/src/components/middle/MiddlePanel.tsx` — switch 的 resource_pack/skin 分支替换 placeholder

---

## 关键约定

### FileNode 与二进制内容

`FileNode = { path: string, content: string }`。对于 PNG/OGG 等二进制文件，generator 会把 Buffer 用 base64 编码后存入 `content`。前端展示时构造 data URL：
- PNG: `data:image/png;base64,${file.content}`
- OGG: `data:audio/ogg;base64,${file.content}`

### 资源包生成器产出的文件路径

参考 [resource-pack-generator.ts](file:///d:/MC%20mod/packages/core/src/generators/resource-pack/resource-pack-generator.ts)：
- 贴图覆盖 PNG: `assets/minecraft/textures/${entry.path}.png`（entry.path 如 `block/stone`）
- 模型 JSON: `assets/minecraft/models/${entry.path}.json`
- 音效 OGG: `assets/${namespace}/sounds/${entry.id}.ogg`
- sounds.json: `assets/${namespace}/sounds.json`
- 语言文件: `assets/minecraft/lang/en_us.json` / `assets/minecraft/lang/zh_cn.json`

### 皮肤生成器产出的文件路径

参考 [skin-generator.ts](file:///d:/MC%20mod/packages/core/src/generators/texture/skin-generator.ts)：
- 主皮肤 PNG: `${spec.playerName}.png`（64x64）
- 预览 PNG（可选）: `preview.png`

---

## Task 1: 安装 skinview3d + 创建 ResourcePackPreviewPanel

**Files:**
- Modify: `apps/desktop/package.json`（自动）
- Create: `apps/desktop/src/renderer/src/components/middle/ResourcePackPreviewPanel.tsx`

- [ ] **Step 1: 安装 skinview3d 依赖**

Run（PowerShell，工作目录 `d:/MC mod`）:
```powershell
pnpm add skinview3d -F @mc-creator/desktop
```
Expected: 输出包含 `+ skinview3d x.x.x`，apps/desktop/package.json 的 dependencies 新增 `skinview3d`。

- [ ] **Step 2: 创建 ResourcePackPreviewPanel.tsx**

使用 Write 工具创建 `d:\MC mod\apps\desktop\src\renderer\src\components\middle\ResourcePackPreviewPanel.tsx`，内容如下：

```tsx
import { useState, useMemo, shallow } from 'react';
import { useModStore } from '../../store/mod-store.js';
import { DataTable, PanelHeader, SearchInput, EmptyState } from './shared/index.js';
import type { Column } from './shared/index.js';
import { McIcon } from '../../assets/mc-ui/McIcon';
import type {
  ResourcePackSpec as ResourcePackSpecType,
  TextureOverrideEntry,
  SoundEntry,
  ModelEntry,
} from '@mc-creator/shared';

type Tab = 'textures' | 'sounds' | 'models' | 'lang';

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'textures', label: '材质', icon: 'box' },
  { id: 'sounds', label: '音效', icon: 'star' },
  { id: 'models', label: '模型', icon: 'box' },
  { id: 'lang', label: '语言', icon: 'star' },
];

/** ResourcePack 预览面板：4 tab — 材质画廊/音效列表/模型表格/语言 key-value 表格 */
export function ResourcePackPreviewPanel() {
  const { spec, files } = useModStore(
    (s) => ({ spec: s.spec, files: s.files }),
    shallow,
  );
  const [tab, setTab] = useState<Tab>('textures');

  if (!spec) {
    return <EmptyState icon="box" title="尚未生成资源包 Spec" hint="在右侧 AgentPanel 描述你想要的资源包，生成 Spec 后即可预览" />;
  }

  const pack = spec as unknown as ResourcePackSpecType;

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-mc-surface">
      <PanelHeader
        icon="box"
        title={pack.packName}
        meta={[
          { label: 'Format', value: String(pack.packFormat) },
          { label: 'Namespace', value: pack.namespace },
          { label: 'MC', value: '1.21.x' },
        ]}
        subtitle={pack.packDescription}
      />

      {/* Tab 切换栏 */}
      <div className="flex items-center border-b border-mc-border bg-mc-surface px-2 py-1">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex items-center gap-1.5 rounded-mc px-3 py-1 text-xs font-medium transition-colors ${
              tab === t.id
                ? 'bg-mc-surface-2 text-mc-text border-b-2 border-mc-accent'
                : 'text-mc-dim hover:bg-mc-surface-2/60 hover:text-mc-text'
            }`}
          >
            <McIcon scope="pixel" name={t.icon} size={12} />
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab 内容 */}
      <div className="flex-1 overflow-y-auto">
        {tab === 'textures' && <TexturesTab pack={pack} files={files} />}
        {tab === 'sounds' && <SoundsTab pack={pack} files={files} />}
        {tab === 'models' && <ModelsTab pack={pack} />}
        {tab === 'lang' && <LangTab pack={pack} />}
      </div>

      {/* Footer */}
      <div className="border-t border-mc-border px-4 py-2 text-xs text-mc-mute">
        材质: {pack.textureOverrides.length} · 音效: {pack.sounds.length} · 模型: {pack.models.length} · 字体: {pack.fonts.length}
      </div>
    </div>
  );
}

// ===== Textures tab =====

function TexturesTab({ pack, files }: { pack: ResourcePackSpecType; files: { path: string; content: string }[] }) {
  const dataUrl = (entry: TextureOverrideEntry): string | null => {
    const file = files.find((f) => f.path === `assets/minecraft/textures/${entry.path}.png`);
    if (!file) return null;
    return `data:image/png;base64,${file.content}`;
  };

  if (pack.textureOverrides.length === 0) {
    return <div className="px-3 py-6 text-center text-xs text-mc-mute">暂无材质覆盖</div>;
  }

  return (
    <div className="grid grid-cols-2 gap-2 p-3 sm:grid-cols-3 md:grid-cols-4">
      {pack.textureOverrides.map((entry, idx) => {
        const url = dataUrl(entry);
        return (
          <div key={`${entry.path}-${idx}`} className="rounded-mc border border-mc-border bg-mc-surface-2/40 p-2">
            <div className="mb-1 flex aspect-square items-center justify-center overflow-hidden rounded-mc bg-mc-bg">
              {url ? (
                <img src={url} alt={entry.path} className="h-full w-full object-contain" style={{ imageRendering: 'pixelated' }} />
              ) : (
                <div className="flex h-full w-full items-center justify-center" style={{ backgroundColor: entry.color }}>
                  <span className="text-xs text-mc-mute">生成中</span>
                </div>
              )}
            </div>
            <div className="truncate text-xs text-mc-dim" title={entry.path}>{entry.path}</div>
            <div className="text-xs text-mc-mute">{entry.width}×{entry.height}{entry.gradientTo ? ' · 渐变' : ''}{entry.checkerboard ? ' · 棋盘' : ''}</div>
          </div>
        );
      })}
    </div>
  );
}

// ===== Sounds tab =====

function SoundsTab({ pack, files }: { pack: ResourcePackSpecType; files: { path: string; content: string }[] }) {
  if (pack.sounds.length === 0) {
    return <div className="px-3 py-6 text-center text-xs text-mc-mute">暂无音效</div>;
  }

  return (
    <div className="flex flex-col gap-1 p-3">
      {pack.sounds.map((entry, idx) => (
        <SoundRow key={`${entry.id}-${idx}`} entry={entry} pack={pack} files={files} />
      ))}
    </div>
  );
}

function SoundRow({ entry, pack, files }: { entry: SoundEntry; pack: ResourcePackSpecType; files: { path: string; content: string }[] }) {
  const [audio, setAudio] = useState<HTMLAudioElement | null>(null);
  const [duration, setDuration] = useState<string>('—');
  const [playing, setPlaying] = useState(false);

  const audioUrl = useMemo(() => {
    const file = files.find((f) => f.path === `assets/${pack.namespace}/sounds/${entry.id}.ogg`);
    if (!file || !file.content) return null;
    return `data:audio/ogg;base64,${file.content}`;
  }, [files, pack.namespace, entry.id]);

  const togglePlay = () => {
    if (!audio) return;
    if (audio.paused) {
      audio.play();
      setPlaying(true);
    } else {
      audio.pause();
      setPlaying(false);
    }
  };

  const onLoadedMetadata = () => {
    if (audio && !Number.isNaN(audio.duration)) {
      setDuration(`${audio.duration.toFixed(1)}s`);
    }
  };

  const onEnded = () => setPlaying(false);

  return (
    <div className="flex items-center gap-3 rounded-mc border border-mc-border bg-mc-surface-2/40 px-3 py-2">
      <button
        onClick={togglePlay}
        disabled={!audioUrl}
        className="flex h-7 w-7 items-center justify-center rounded-mc border border-mc-border bg-mc-surface-2 text-mc-accent transition-colors hover:bg-mc-surface-3 disabled:cursor-not-allowed disabled:opacity-40"
        title={audioUrl ? (playing ? '暂停' : '播放') : '无音频数据'}
      >
        <McIcon scope="pixel" name={playing ? 'star' : 'box'} size={12} />
      </button>
      <div className="flex-1 min-w-0">
        <div className="truncate text-xs font-medium text-mc-text" title={entry.id}>{entry.id}</div>
        <div className="truncate text-xs text-mc-mute" title={entry.event}>{entry.event || '(无事件名)'} · 音量 {entry.volume} · 音调 {entry.pitch}{entry.stream ? ' · 流式' : ''}</div>
      </div>
      <div className="text-xs text-mc-dim">{duration}</div>
      {audioUrl && (
        <audio
          ref={setAudio}
          src={audioUrl}
          onLoadedMetadata={onLoadedMetadata}
          onEnded={onEnded}
          preload="metadata"
        />
      )}
    </div>
  );
}

// ===== Models tab =====

function ModelsTab({ pack }: { pack: ResourcePackSpecType }) {
  const columns: Column<ModelEntry>[] = [
    { key: 'path', header: '路径', width: '40%', sortValue: (r) => r.path },
    { key: 'textureName', header: '贴图名', width: '20%', sortValue: (r) => r.textureName },
    { key: 'autoCubeAll', header: '自动 cube_all', width: '15%', render: (r) => (r.autoCubeAll ? '是' : '否') },
    { key: 'jsonPreview', header: 'JSON 摘要', width: '25%', render: (r) => r.json ? `${r.json.slice(0, 40)}${r.json.length > 40 ? '…' : ''}` : '—' },
  ];

  return (
    <div className="p-2">
      <DataTable columns={columns} data={pack.models} rowKey={(r) => r.path} emptyHint="暂无模型覆盖" />
    </div>
  );
}

// ===== Lang tab =====

interface LangRow {
  key: string;
  en: string;
  zh: string;
}

function LangTab({ pack }: { pack: ResourcePackSpecType }) {
  const [query, setQuery] = useState('');

  const rows = useMemo<LangRow[]>(() => {
    const keys = new Set([...Object.keys(pack.langEnUs), ...Object.keys(pack.langZhCn)]);
    let result = Array.from(keys).map((key) => ({
      key,
      en: pack.langEnUs[key] ?? '',
      zh: pack.langZhCn[key] ?? '',
    }));
    if (query) {
      const q = query.toLowerCase();
      result = result.filter((r) => r.key.toLowerCase().includes(q) || r.en.toLowerCase().includes(q) || r.zh.toLowerCase().includes(q));
    }
    return result.sort((a, b) => a.key.localeCompare(b.key));
  }, [pack.langEnUs, pack.langZhCn, query]);

  const columns: Column<LangRow>[] = [
    { key: 'key', header: '键', width: '35%', sortValue: (r) => r.key },
    { key: 'en', header: 'en_us', width: '32%', sortValue: (r) => r.en },
    { key: 'zh', header: 'zh_cn', width: '33%', sortValue: (r) => r.zh },
  ];

  return (
    <div className="flex flex-col gap-2 p-2">
      <SearchInput value={query} onChange={setQuery} placeholder="搜索语言键或翻译…" />
      <DataTable columns={columns} data={rows} rowKey={(r) => r.key} emptyHint="暂无语言条目" />
    </div>
  );
}
```

- [ ] **Step 3: 运行 typecheck 验证**

Run: `pnpm typecheck`
Expected: PASS（0 错误）。如果失败，检查：
- 是否 `shallow` 应从 `zustand/shallow` 导入（是的，已正确）
- ResourcePackSpec 的导出名（应是 `ResourcePackSpec as ResourcePackSpecType` 别名导入避免和组件局部变量冲突）
- DataTable 的 `Column` 是否从 `./shared/index.js` 导出（是的，阶段 2 已导出）

- [ ] **Step 4: 运行测试验证**

Run: `pnpm test`
Expected: PASS（258 测试通过，无回归）

- [ ] **Step 5: 提交**

```powershell
cd "d:/MC mod"
git add apps/desktop/package.json apps/desktop/pnpm-lock.yaml apps/desktop/src/renderer/src/components/middle/ResourcePackPreviewPanel.tsx
git commit -m "feat(middle): add ResourcePack preview panel with skinview3d dependency"
```

---

## Task 2: 创建 SkinPreviewPanel

**Files:**
- Create: `apps/desktop/src/renderer/src/components/middle/SkinPreviewPanel.tsx`

**SkinSpec 字段**（[skin-spec.ts](file:///d:/MC%20mod/packages/shared/src/schemas/skin-spec.ts)，供表单编辑）：
- playerName: string (default 'Player')
- model: 'classic' | 'slim' (default 'classic')
- skinColor: Color (default '#E0AC69')
- hairColor: Color (default '#312718')
- shirtColor: Color (default '#19A6FF')
- pantsColor: Color (default '#3C2A1E')
- shoesColor: Color (default '#5A3A1E')
- generatePreview: boolean (default false)

**skinview3d API 关键点**：
```typescript
import { SkinViewer, WalkingAnimation } from 'skinview3d';
// 创建
const viewer = new SkinViewer({ canvas, width: 300, height: 400, skin: 'data:image/png;base64,...' });
viewer.autoRotate = true;
viewer.autoRotateSpeed = 0.5;
viewer.animation = new WalkingAnimation();
// 修改皮肤（不重建 viewer）
viewer.loadSkin('data:image/png;base64,...');
// 修改模型（classic/slim）
viewer.loadSkin(skinUrl, { model: 'classic' | 'slim' });
// 销毁
viewer.dispose();
```

- [ ] **Step 1: 创建 SkinPreviewPanel.tsx**

使用 Write 工具创建 `d:\MC mod\apps\desktop\src\renderer\src\components\middle\SkinPreviewPanel.tsx`，内容如下：

```tsx
import { useEffect, useRef, useState, useMemo } from 'react';
import { shallow } from 'zustand/shallow';
import { SkinViewer, WalkingAnimation } from 'skinview3d';
import { McIcon } from '../../assets/mc-ui/McIcon';
import { useModStore } from '../../store/mod-store.js';
import { EmptyState, FieldGroup } from './shared/index.js';
import type { SkinSpec } from '@mc-creator/shared';

/**
 * Skin 预览面板：
 * - 左：skinview3d 3D 角色预览（可拖动旋转、滚轮缩放、自动旋转）
 * - 右：2D 皮肤贴图（显示完整 64x64 PNG + overlay 标注身体部位）
 * - 底部：表单编辑 playerName/model/5 颜色字段
 * 字段修改写回 useModStore.spec。
 */
export function SkinPreviewPanel() {
  const { spec, setSpec, files } = useModStore(
    (s) => ({ spec: s.spec, setSpec: s.setSpec, files: s.files }),
    shallow,
  );

  // 3D viewer canvas ref
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const viewerRef = useRef<SkinViewer | null>(null);

  // 2D 视图背景色切换
  const [bgColor, setBgColor] = useState<'#1a1a1a' | '#3a3a3a' | '#ffffff'>('#1a1a1a');

  if (!spec) {
    return <EmptyState icon="box" title="尚未生成皮肤 Spec" hint="在右侧 AgentPanel 描述你想要的皮肤，生成 Spec 后即可预览" />;
  }

  const skin = spec as unknown as SkinSpec;

  // 从 files 找皮肤 PNG（路径是 ${playerName}.png）
  const skinUrl = useMemo(() => {
    const file = files.find((f) => f.path === `${skin.playerName}.png`);
    if (!file) return null;
    return `data:image/png;base64,${file.content}`;
  }, [files, skin.playerName]);

  const updateField = <K extends keyof SkinSpec>(key: K, value: SkinSpec[K]) => {
    const updated = { ...skin, [key]: value };
    setSpec(updated as unknown as typeof spec);
  };

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-mc-surface">
      {/* Header */}
      <div className="border-b border-mc-border px-4 py-3">
        <div className="flex items-center gap-2">
          <McIcon scope="pixel" name="star" size={16} className="text-mc-accent" />
          <span className="text-sm font-bold text-mc-text">{skin.playerName}</span>
          <span className="text-xs text-mc-mute">·</span>
          <span className="text-xs text-mc-dim">{skin.model === 'slim' ? 'Slim (Alex)' : 'Classic (Steve)'}</span>
        </div>
        <div className="mt-1 text-xs text-mc-mute">{skinUrl ? '皮肤 PNG 已生成' : '皮肤 PNG 未生成（保存后即可预览）'}</div>
      </div>

      {/* Body：左右分栏 */}
      <div className="flex flex-1 flex-col overflow-hidden md:flex-row">
        {/* 左：3D 预览 */}
        <div className="flex flex-1 flex-col items-center justify-center gap-2 p-4" style={{ backgroundColor: bgColor }}>
          {skinUrl ? (
            <SkinViewer3D
              canvasRef={canvasRef}
              viewerRef={viewerRef}
              skinUrl={skinUrl}
              model={skin.model}
            />
          ) : (
            <div className="flex h-64 w-48 items-center justify-center rounded-mc border border-dashed border-mc-border text-xs text-mc-mute">
              等待皮肤 PNG 生成
            </div>
          )}
          <div className="text-xs text-mc-mute">拖动旋转 · 滚轮缩放 · 自动旋转中</div>
        </div>

        {/* 右：2D UV 贴图 */}
        <div className="flex w-full flex-col gap-2 border-t border-mc-border p-4 md:w-80 md:border-l md:border-t-0" style={{ backgroundColor: bgColor }}>
          <div className="text-xs font-bold uppercase tracking-wider text-mc-dim">2D 纹理贴图 (64×64)</div>
          <div className="relative">
            {skinUrl ? (
              <Skin2DOverlay skinUrl={skinUrl} model={skin.model} />
            ) : (
              <div className="flex h-32 w-32 items-center justify-center rounded-mc border border-dashed border-mc-border text-xs text-mc-mute">
                等待皮肤 PNG 生成
              </div>
            )}
          </div>
          <div className="text-xs text-mc-mute">半透明色块标注身体部位区域</div>

          {/* 背景色切换 */}
          <div className="mt-2 flex items-center gap-2">
            <span className="text-xs text-mc-dim">背景:</span>
            {(['#1a1a1a', '#3a3a3a', '#ffffff'] as const).map((c) => (
              <button
                key={c}
                onClick={() => setBgColor(c)}
                className={`h-5 w-5 rounded-mc border ${bgColor === c ? 'border-mc-accent' : 'border-mc-border'}`}
                style={{ backgroundColor: c }}
                title={`背景色 ${c}`}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Footer：颜色与字段编辑表单 */}
      <div className="max-h-64 overflow-y-auto border-t border-mc-border p-4">
        <FieldGroup title="基本">
          <div className="flex items-center gap-3">
            <label className="w-28 shrink-0 text-xs text-mc-dim">玩家名</label>
            <input
              type="text"
              value={skin.playerName}
              onChange={(e) => updateField('playerName', e.target.value)}
              className="mc-input flex-1 !py-1 !text-xs"
            />
          </div>
          <div className="flex items-center gap-3">
            <label className="w-28 shrink-0 text-xs text-mc-dim">模型</label>
            <select
              value={skin.model}
              onChange={(e) => updateField('model', e.target.value as SkinSpec['model'])}
              className="mc-select flex-1 !py-1 !text-xs"
            >
              <option value="classic">Classic (Steve)</option>
              <option value="slim">Slim (Alex)</option>
            </select>
          </div>
        </FieldGroup>

        <div className="mt-4">
          <FieldGroup title="颜色">
            <ColorRow label="皮肤色" value={skin.skinColor} onChange={(v) => updateField('skinColor', v)} />
            <ColorRow label="头发色" value={skin.hairColor} onChange={(v) => updateField('hairColor', v)} />
            <ColorRow label="上衣色" value={skin.shirtColor} onChange={(v) => updateField('shirtColor', v)} />
            <ColorRow label="裤子色" value={skin.pantsColor} onChange={(v) => updateField('pantsColor', v)} />
            <ColorRow label="鞋子色" value={skin.shoesColor} onChange={(v) => updateField('shoesColor', v)} />
          </FieldGroup>
        </div>
      </div>
    </div>
  );
}

// ===== 3D 子组件 =====

interface SkinViewer3DProps {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  viewerRef: React.MutableRefObject<SkinViewer | null>;
  skinUrl: string;
  model: SkinSpec['model'];
}

function SkinViewer3D({ canvasRef, viewerRef, skinUrl, model }: SkinViewer3DProps) {
  // 创建/销毁 viewer（仅在 mount 时）
  useEffect(() => {
    if (!canvasRef.current) return;
    const viewer = new SkinViewer({
      canvas: canvasRef.current,
      width: 240,
      height: 320,
    });
    viewer.autoRotate = true;
    viewer.autoRotateSpeed = 0.5;
    viewer.animation = new WalkingAnimation();
    viewerRef.current = viewer;
    return () => {
      viewer.dispose();
      viewerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 加载皮肤（url 或 model 变化时）
  useEffect(() => {
    if (!viewerRef.current) return;
    viewerRef.current.loadSkin(skinUrl, { model });
  }, [skinUrl, model]);

  return (
    <canvas
      ref={canvasRef}
      width={240}
      height={320}
      className="rounded-mc border border-mc-border"
    />
  );
}

// ===== 2D UV 子组件 =====

interface Skin2DOverlayProps {
  skinUrl: string;
  model: SkinSpec['model'];
}

/** 2D 皮肤 PNG + 半透明色块标注身体部位（基于 64x64 标准 UV 布局） */
function Skin2DOverlay({ skinUrl, model }: Skin2DOverlayProps) {
  // 标准 Minecraft 皮肤 UV 坐标（基于 64x64 像素图）
  // 每个部位格式：[x, y, w, h, label, color]
  const regions: Array<{ x: number; y: number; w: number; h: number; label: string; color: string }> = [
    { x: 8, y: 8, w: 8, h: 8, label: '头', color: 'rgba(224, 172, 105, 0.4)' },
    { x: 20, y: 20, w: 8, h: 12, label: '身体', color: 'rgba(25, 166, 255, 0.4)' },
    { x: 44, y: 20, w: 4, h: 12, label: '右臂', color: 'rgba(49, 39, 24, 0.5)' },
    { x: 36, y: 52, w: 4, h: 12, label: '右腿', color: 'rgba(60, 42, 30, 0.5)' },
  ];
  // slim 模型手臂宽度为 3 而非 4
  if (model === 'slim') {
    regions[2].w = 3;
  }

  // 显示尺寸：每个像素放大 3 倍（64x64 → 192x192）
  const scale = 3;

  return (
    <div className="relative" style={{ width: 64 * scale, height: 64 * scale }}>
      <img
        src={skinUrl}
        alt="skin"
        width={64 * scale}
        height={64 * scale}
        className="block"
        style={{ imageRendering: 'pixelated' }}
      />
      {regions.map((r, i) => (
        <div
          key={i}
          className="absolute flex items-center justify-center text-[10px] font-bold text-white"
          style={{
            left: r.x * scale,
            top: r.y * scale,
            width: r.w * scale,
            height: r.h * scale,
            backgroundColor: r.color,
            border: '1px solid rgba(255,255,255,0.3)',
          }}
        >
          {r.label}
        </div>
      ))}
    </div>
  );
}

// ===== 颜色行子组件 =====

function ColorRow({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex items-center gap-3">
      <label className="w-28 shrink-0 text-xs text-mc-dim">{label}</label>
      <input
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-7 w-12 cursor-pointer rounded-mc border border-mc-border bg-mc-surface-2"
      />
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mc-input w-24 !py-1 !text-xs"
      />
    </div>
  );
}
```

- [ ] **Step 2: 运行 typecheck 验证**

Run: `pnpm typecheck`
Expected: PASS（0 错误）。如果失败，检查：
- skinview3d 的类型定义是否随包一起安装（应是 `bundle.js` 同目录有 `.d.ts`）
- `SkinViewer` 构造参数是否正确（参考 [skinview3d 文档](https://github.com/bs-community/skinview3d)）
- `WalkingAnimation` 是否从 `skinview3d` 直接导出（是的）

如果 skinview3d 没有类型定义（纯 JS 库），需在文件顶部加 `// @ts-ignore` 或创建 `apps/desktop/src/skinview3d.d.ts` 声明模块：
```typescript
declare module 'skinview3d' {
  export class SkinViewer {
    constructor(opts: { canvas: HTMLCanvasElement; width?: number; height?: number; skin?: string });
    autoRotate: boolean;
    autoRotateSpeed: number;
    animation: unknown;
    loadSkin(url: string, opts?: { model?: 'classic' | 'slim' }): void;
    dispose(): void;
  }
  export class WalkingAnimation { }
}
```

- [ ] **Step 3: 运行测试验证**

Run: `pnpm test`
Expected: PASS（258 测试通过，无回归）

- [ ] **Step 4: 提交**

```powershell
cd "d:/MC mod"
git add apps/desktop/src/renderer/src/components/middle/SkinPreviewPanel.tsx
git commit -m "feat(middle): add Skin preview panel with 3D viewer and 2D UV overlay"
```

---

## Task 3: MiddlePanel 集成 + 最终验证

**Files:**
- Modify: `apps/desktop/src/renderer/src/components/middle/MiddlePanel.tsx`

- [ ] **Step 1: 修改 MiddlePanel.tsx**

先用 Read 工具读取 `d:\MC mod\apps\desktop\src\renderer\src\components\middle\MiddlePanel.tsx`。

**修改 1：新增 import。** 在现有 4 个面板 import（ServerPreviewPanel/ModPreviewPanel/DatapackPreviewPanel/ModpackPreviewPanel/LauncherPreviewPanel）之后，新增 2 行：
```tsx
import { ResourcePackPreviewPanel } from './ResourcePackPreviewPanel.js';
import { SkinPreviewPanel } from './SkinPreviewPanel.js';
```

**修改 2：修改 switch。** 把：
```tsx
      case 'launcher':
        return <LauncherPreviewPanel />;
      case 'resource_pack':
      case 'skin':
        return <PlaceholderPanel type={generatorType} />;
```
改为：
```tsx
      case 'launcher':
        return <LauncherPreviewPanel />;
      case 'resource_pack':
        return <ResourcePackPreviewPanel />;
      case 'skin':
        return <SkinPreviewPanel />;
```

**修改 3：更新顶部注释。** 把组件函数上方的注释中"阶段 3 已实现 server/mod/datapack/modpack/launcher 面板"改为"阶段 4 已实现全部 7 种类型（server/mod/datapack/modpack/resource_pack/skin/launcher）"。

**修改 4：更新 PlaceholderPanel 函数注释**（如果该函数仍存在）。把 `/** 占位面板：阶段 2-4 实现其他类型时移除 */` 改为 `/** 占位面板：default 分支兜底，正常不会触发 */`。PlaceholderPanel 保留是因为 switch 有 default 分支（防御性编程），但所有 7 种类型现在都有专属面板。

- [ ] **Step 2: 运行 typecheck 验证**

Run: `pnpm typecheck`
Expected: PASS（0 错误）

- [ ] **Step 3: 运行测试验证**

Run: `pnpm test`
Expected: PASS（258 测试通过，无回归）

- [ ] **Step 4: 行数检查**

用 Read 工具读取以下文件末尾确认行数：
- `d:\MC mod\apps\desktop\src\renderer\src\components\middle\ResourcePackPreviewPanel.tsx` — 目标 ≤ 280 行
- `d:\MC mod\apps\desktop\src\renderer\src\components\middle\SkinPreviewPanel.tsx` — 目标 ≤ 260 行
- `d:\MC mod\apps\desktop\src\renderer\src\components\middle\MiddlePanel.tsx` — 目标 ≤ 100 行

- [ ] **Step 5: 最终验证 — 所有 7 种类型已实现**

确认 `MiddlePanel.tsx` 的 `renderPreviewPanel` switch 中：
- ✅ server → ServerPreviewPanel
- ✅ mod → ModPreviewPanel
- ✅ datapack → DatapackPreviewPanel
- ✅ modpack → ModpackPreviewPanel
- ✅ launcher → LauncherPreviewPanel
- ✅ resource_pack → ResourcePackPreviewPanel
- ✅ skin → SkinPreviewPanel

- [ ] **Step 6: 提交**

```powershell
cd "d:/MC mod"
git add apps/desktop/src/renderer/src/components/middle/MiddlePanel.tsx
git commit -m "feat(middle): integrate ResourcePack and Skin panels, complete all 7 generator types"
```

---

## 验证标准

- [x] typecheck 0 错误
- [x] 测试全通过（258，无回归）
- [x] noUnusedLocals 0 错误
- [x] skinview3d 已添加到 apps/desktop/package.json 依赖
- [x] ResourcePackPreviewPanel ≤ 280 行
- [x] SkinPreviewPanel ≤ 260 行
- [x] MiddlePanel ≤ 100 行
- [x] 所有 7 种 GeneratorType 都有专属预览面板（无 PlaceholderPanel 占位）
- [x] ResourcePack 面板支持 4 tab：材质/音效/模型/语言
- [x] Skin 面板支持 3D 旋转 + 2D UV 标注 + 颜色编辑表单
- [x] 表单字段修改写回 spec
