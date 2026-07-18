# 中间预览面板按 generatorType 调度设计

**日期**：2026-07-17
**作者**：用户 + 助手
**状态**：待评审

## 1. 背景与问题

当前 MC Creator 中间预览窗口（[CodePreview.tsx](file:///d:/MC%20mod/apps/desktop/src/renderer/src/components/CodePreview.tsx)）对所有 generatorType 用同一逻辑：根据 `selectedFile` 显示文件内容（代码或 PNG）。

问题：

1. **没有按类型可视化**：用户切换 generatorType 后，中间窗口仍只显示文件内容，看不到项目整体结构
2. **小白门槛高**：用户需要知道"点哪个文件"才能看到内容
3. **类型不全**：缺少 `launcher` 类型；`texture` 与 `resource_pack` 功能重叠
4. **皮肤/音效无专用预览**：皮肤只能看 PNG 不能 3D 旋转，音效 .ogg 无法播放

## 2. 目标

- 中间预览窗口按 `generatorType` 自动切换到对应可视化面板
- 默认显示"预览"tab（项目结构可视化），次选"代码"tab（保留现有文件预览）
- 覆盖 7 种类型：mod / datapack / modpack / server / resource_pack / skin / launcher
- 对小白友好：打开项目即可看到"我在做什么"的可视化
- 对专业开发者友好：表格/表单视图，支持排序/筛选/编辑

## 3. 类型清单（最终）

| 类型            | 说明                                                 | 是否新增 |
| --------------- | ---------------------------------------------------- | -------- |
| `mod`           | Mod（需 Fabric/NeoForge/Quilt/Legacy Fabric）        | 保留     |
| `datapack`      | 数据包（原版功能扩展，无需 mod 加载器）              | 保留     |
| `modpack`       | 整合包（mod 集合 + 配置）                            | 保留     |
| `server`        | 服务器配置（server.properties）                      | 保留     |
| `resource_pack` | 资源包（**合并原 texture + sound + resource_pack**） | 合并     |
| `skin`          | 皮肤（classic/slim 模型）                            | 保留     |
| `launcher`      | 启动器配置/脚本（PCL2/HMCL/official）                | **新增** |

**删除**：`texture`（功能并入 `resource_pack`）
**新增**：`launcher`

## 4. 整体架构

### 4.1 调度框架

中间面板顶部新增 tab 切换：`预览` | `代码`（默认 `预览`）。

- `预览` tab：根据 `useModStore.generatorType` 渲染对应面板（如 `ModPreviewPanel` / `SkinPreviewPanel`...）
- `代码` tab：保留现有 CodePreview（基于 selectedFile）

### 4.2 文件结构

```
apps/desktop/src/renderer/src/components/
  middle/
    MiddlePanel.tsx               # 调度器：generatorType + tab → 渲染对应面板
    ModPreviewPanel.tsx           # mod 类型预览
    DatapackPreviewPanel.tsx      # datapack 类型预览
    ModpackPreviewPanel.tsx       # modpack 类型预览
    ServerPreviewPanel.tsx        # server 类型预览
    ResourcePackPreviewPanel.tsx  # resource_pack 类型预览
    SkinPreviewPanel.tsx          # skin 类型预览
    LauncherPreviewPanel.tsx      # launcher 类型预览
```

### 4.3 通用面板结构

每个预览面板遵循统一布局：

```
┌─────────────────────────────────────────┐
│ Header：项目元信息 + 导出按钮             │
├─────────────────────────────────────────┤
│                                         │
│ Body：按类型定制的可视化内容              │
│                                         │
├─────────────────────────────────────────┤
│ Footer：统计信息（条目数/文件数）          │
└─────────────────────────────────────────┘
```

### 4.4 App.tsx 改动

原 [App.tsx](file:///d:/MC%20mod/apps/desktop/src/renderer/src/App.tsx) 中：

```tsx
<main className="flex flex-1 flex-col overflow-hidden">
  <TabBar />
  <div className="flex-1 overflow-hidden">
    <CodePreview />
  </div>
  <BuildPanel />
</main>
```

替换为：

```tsx
<main className="flex flex-1 flex-col overflow-hidden">
  <MiddlePanel />
  <BuildPanel />
</main>
```

`TabBar` 和 `CodePreview` 的逻辑移到 `MiddlePanel` 内部（`代码` tab 复用）。

## 5. 各面板设计

### 5.1 `mod` 预览面板

- **Header**：modId / version / name / description / authors / license
- **Body 分类 tab**：
  - **物品（Items）**：表格列 `[id, name, rarity, maxStack, maxDamage, fuelTick, food?]`
  - **方块（Blocks）**：表格列 `[id, name, material, hardness, lightLevel, resistance, soundType]`
  - **依赖（Dependencies）**：表格列 `[modId, version, mandatory]`
  - **元数据（Metadata）**：key-value 表单（version/authors/credits/website）
- **交互**：表格支持点击列头排序、搜索框筛选
- **数据源**：`useModStore.spec`（类型断言为 `ModSpec`）

### 5.2 `datapack` 预览面板

- **Header**：packName / mcVersion / description
- **Body 分类 tab**：
  - **函数（Functions）**：路径 + 命令数
  - **战利品表（Loot Tables）**：路径 + 类型（block/entity/chest）
  - **进度（Advancements）**：路径 + 图标
  - **配方（Recipes）**：路径 + 类型（crafting/smelting/stonecutting）
  - **标签（Tags）**：路径 + 替换模式（replace）
- **数据源**：`useModStore.spec`（类型断言为 `DatapackSpec`）

### 5.3 `modpack` 预览面板

- **Header**：packName / mcVersion / loader / version / author
- **Body**：mod 列表，每行 `[图标, 名称, 版本, 来源(Modrinth/CurseForge/手动), 文件大小]`
- **顶部**：搜索框 + 来源筛选下拉
- **数据源**：`useModStore.spec`（类型断言为 `ModpackSpec`）

### 5.4 `server` 预览面板

- **Header**：serverName / mcVersion / port
- **Body**：server.properties 配置表单（分组）：
  - **基本**：server-name / motd / max-players / port
  - **世界**：level-name / gamemode / difficulty / spawn-protection
  - **玩家**：pvp / online-mode / white-list / enforce-whitelist
  - **网络**：server-ip / resource-pack / resource-pack-sha1
- **可编辑**：表单修改后保存到 `spec`
- **数据源**：`useModStore.spec`（类型断言为 `ServerSpec`）

### 5.5 `resource_pack` 预览面板

- **Header**：packName / mcVersion / pack-format / description
- **Body 分类 tab**：
  - **材质（Textures）**：网格画廊，每格显示 PNG 缩略图 + 路径
  - **音效（Sounds）**：列表，每行 `[播放按钮, 事件名, 文件路径, 时长]`
  - **模型（Models）**：JSON 树视图
  - **语言（Lang）**：key-value 表格
- **音效播放**：HTML5 `<audio>` 元素，无需额外库
- **数据源**：`useModStore.spec` + `useModStore.files`（PNG/OGG 内容从 files 取）

### 5.6 `skin` 预览面板

- **Header**：playerName / model（classic/slim）
- **Body**：左右分栏
  - **左**：3D 角色预览（可拖动旋转、滚轮缩放）
  - **右**：2D 纹理贴图（显示 skin PNG 的 UV 展开，标注头/身/臂/腿区域）
- **底部**：模型切换（classic/slim）+ 背景色切换
- **第三方库**：`skinview3d`（MC 皮肤 3D 预览专业库，~50KB）
- **数据源**：`useModStore.spec`（playerName/model）+ `useModStore.files`（skin PNG 内容）

### 5.7 `launcher` 预览面板（新增类型）

- **Header**：launcherName / launcherType（official/PCL2/HMCL）
- **Body 配置表单**（分组）：
  - **基本**：launcher-type / profile-name / mc-version / loader
  - **JVM**：java-path / jvm-args / memory-min / memory-max
  - **账号**：account-type（offline/microsoft） / username / uuid
  - **启动后**：server-autorun / fullscreen / resolution
- **可编辑**：表单修改后保存到 `spec`
- **数据源**：`useModStore.spec`（类型断言为 `LauncherSpec`）

## 6. Schema 变更

### 6.1 GENERATOR_TYPES 修改

`apps/desktop/src/shared/ipc-channels.ts`：

```typescript
// 修改前
export const GENERATOR_TYPES = [
  'mod',
  'datapack',
  'modpack',
  'server',
  'texture',
  'skin',
  'resource_pack',
] as const;

// 修改后
export const GENERATOR_TYPES = [
  'mod',
  'datapack',
  'modpack',
  'server',
  'resource_pack',
  'skin',
  'launcher',
] as const;
```

### 6.2 新增 LauncherSpec

`packages/shared/src/schemas/launcher-spec.ts`：

```typescript
import { z } from 'zod';

export const LauncherSpec = z.object({
  launcherName: z.string(),
  launcherType: z.enum(['official', 'pcl2', 'hmcl']).default('official'),
  profileName: z.string().default('default'),
  mcVersion: z.string(),
  loader: z.enum(['fabric', 'neoforge', 'quilt', 'legacy_fabric', 'vanilla']).default('vanilla'),
  javaPath: z.string().default(''),
  jvmArgs: z.string().default('-Xmx2G -Xms1G'),
  memoryMin: z.number().int().min(512).default(1024),
  memoryMax: z.number().int().min(1024).default(2048),
  accountType: z.enum(['offline', 'microsoft']).default('offline'),
  username: z.string().default('Player'),
  uuid: z.string().default(''),
  serverAutorun: z.string().default(''),
  fullscreen: z.boolean().default(false),
  resolutionWidth: z.number().int().default(854),
  resolutionHeight: z.number().int().default(480),
});

export type LauncherSpec = z.infer<typeof LauncherSpec>;
```

### 6.3 导出 LauncherSpec

`packages/shared/src/schemas/index.ts` 新增：

```typescript
export { LauncherSpec } from './launcher-spec.js';
export type { LauncherSpec } from './launcher-spec.js';
```

### 6.4 texture → resource_pack 迁移

删除 `texture` 类型后，已存的 `texture` 项目加载时需迁移到 `resource_pack`：

在 `apps/desktop/src/main/project-store.ts`（或加载 spec 的入口）加迁移逻辑：

```typescript
if (loadedSpec.generatorType === 'texture') {
  loadedSpec.generatorType = 'resource_pack';
}
```

迁移点：项目加载（`loadProject`）和导入（`importProject`）后，spec 写入 store 前。

### 6.5 TopToolbar TYPE_LABELS 更新

```typescript
const TYPE_LABELS: Record<GeneratorType, string> = {
  mod: 'Mod',
  datapack: '数据包',
  modpack: '整合包',
  server: '服务器',
  resource_pack: '资源包',
  skin: '皮肤',
  launcher: '启动器',
};
```

### 6.6 AgentPanel placeholder 更新

[AgentPanel.tsx](file:///d:/MC%20mod/apps/desktop/src/renderer/src/components/AgentPanel.tsx) 的 `placeholder` 函数：

- 删除 `texture` case
- 新增 `launcher` case：`'描述你想要的启动器配置…'`

## 7. 第三方依赖

| 依赖             | 用途                                 | 大小      | 必要性         |
| ---------------- | ------------------------------------ | --------- | -------------- |
| `skinview3d`     | MC 皮肤 3D 预览（SkinPreviewPanel）  | ~50KB     | 必需（阶段 4） |
| HTML5 `<audio>`  | 音效播放（ResourcePackPreviewPanel） | 0（内置） | 已有           |
| HTML5 `<canvas>` | 2D UV 贴图绘制（SkinPreviewPanel）   | 0（内置） | 已有           |

**安装命令**：`pnpm add skinview3d -F @mc-creator/desktop`（仅在阶段 4 执行）

## 8. 数据流

```
useModStore
  ├── spec ──→ MiddlePanel（根据 generatorType 调度）
  │          ──→ XxxPreviewPanel（解析 spec 渲染结构化视图）
  │
  ├── files ──→ MiddlePanel「代码」tab
  │          ──→ CodePreview（保留现有逻辑：按 selectedFile 显示）
  │          ──→ ResourcePackPreviewPanel（PNG/OGG 内容从 files 取）
  │          ──→ SkinPreviewPanel（skin PNG 内容从 files 取）
  │
  └── generatorType ──→ MiddlePanel 选择面板
```

## 9. 实施分阶段

这是大项目（7 个面板 + 框架），分 4 个独立 sub-project，每个独立 spec → plan → 实施：

| 阶段       | 内容                                                                          | 复杂度 | 依赖   |
| ---------- | ----------------------------------------------------------------------------- | ------ | ------ |
| **阶段 1** | 调度框架（MiddlePanel + tab 切换）+ Schema 变更 + server 面板（最简单的表单） | 中     | 无     |
| **阶段 2** | mod + datapack + modpack 面板（列表/表格类）                                  | 中     | 阶段 1 |
| **阶段 3** | launcher 面板（表单类，类似 server）                                          | 低     | 阶段 1 |
| **阶段 4** | resource_pack + skin 面板（视觉类，需 skinview3d）                            | 高     | 阶段 1 |

**当前设计文档覆盖所有 4 个阶段**。每个阶段实施前可独立写 implementation plan。

## 10. 验证标准

### 通用

- typecheck 0 错误（node + web）
- 现有测试全通过
- noUnusedLocals/noUnusedParameters 0 错误

### 组件

- 每个预览面板组件 ≤ 300 行
- MiddlePanel 调度器 ≤ 150 行
- 删除 texture 后无 import 断裂

### Schema

- 新增 `launcher-spec.test.ts`（覆盖默认值、round-trip、枚举校验）
- 现有 mod-spec/datapack-spec/modpack-spec/server-spec/resource-pack-spec 测试仍通过

### 功能

- 切换 generatorType 后中间面板自动切换
- 预览/代码 tab 切换正常
- 每个面板能正确读取 spec 并渲染

## 11. 风险与缓解

| 风险                          | 影响                 | 缓解                                    |
| ----------------------------- | -------------------- | --------------------------------------- |
| `skinview3d` 与 React 18 集成 | 阶段 4 阻塞          | 先在孤立 demo 验证，再集成              |
| 删除 `texture` 影响已存项目   | 旧项目 spec 加载失败 | 加迁移逻辑：`texture` → `resource_pack` |
| launcher spec 字段不全        | 实际启动失败         | 阶段 3 实施时参考真实 PCL2/HMCL 配置    |
| 表格性能（mod 物品多）        | UI 卡顿              | 用虚拟滚动（react-window）备选          |

## 12. 不做的事（YAGNI）

- **不**做实时预览编辑（spec 修改 → 预览实时刷新）：保持预览只读，编辑在右侧 AgentPanel 的 Monaco 编辑器
- **不**做多皮肤对比：单皮肤预览即可
- **不**做音效波形可视化：HTML5 audio 播放足够
- **不**做 launcher 实际启动：launcher 面板只生成配置，启动逻辑保留在 BuildPanel
- **不**做 datapack 函数编辑器：函数是命令脚本，预览只显示路径和命令数
