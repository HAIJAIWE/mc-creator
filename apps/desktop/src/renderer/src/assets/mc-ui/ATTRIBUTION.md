# MC UI 素材文件夹 · 授权与来源

本文件夹全部为**开源 / 开放协议**素材，无手写原创、无 Mojang 原版贴图。拖进项目即可用，零需联网。

## 目录
- `pixel/` —— 通用 UI 像素图标（24×24，来自 Pixelarticons）
- `game/`  —— 游戏/MC 风图标（来自 Game-icons.net，CC BY 3.0）
- `mob/`   —— **Minecraft 生物像素图（16×16 PNG，CC0）**，来自 Simplexity-Development/Entity-Icons

## 许可证

### pixel/ — Pixelarticons
- 来源：https://pixelarticons.com （共 1169 图标）
- 许可：免费用于个人与商业项目（详见站点 License 页，建议署名）
- 本文件夹仅抽取了其中一部分（69 个）

### game/ — Game-icons.net
- 来源：https://game-icons.net （共 4134 图标）
- 许可：**CC BY 3.0**（必须署名原作者）
- 署名方式（放“关于/ credits”即可）：
  > Icons from Game-icons.net, licensed under CC BY 3.0.
  > https://game-icons.net — authors listed at https://game-icons.net/authors
- 本文件夹仅抽取了其中一部分（114 个）

### mob/ — Entity-Icons（生物像素图）
- 来源：https://github.com/Simplexity-Development/Entity-Icons
- 许可：**CC0-1.0**（公共领域，无需署名，可随意使用/修改/再分发）
- 本文件夹为 1.21 全部生物的 16×16 PNG（约 516 个，已剔除 sprite 合图）
- 用法：`<McIcon scope="mob" name="creeper" />`（name 为文件名去扩展名）

## 面板（MC 风 UI 框架）
- **物品栏/快捷栏面板**：已 vendor `burigg/minecraft-inventory-ui` 的布局逻辑到
  `src/renderer/src/components/McInventory.tsx`（**MIT**，© 2025 kabaodao，见下方 LICENSE 文件）。
  - 改造点（版权安全）：移除 Mojang 原版背景图 `minecraft_inventory.png` → 改用本项目
    CSS 绘制的方块面板；移除 `getItemIconUrl` 对 Mojang 物品贴图的硬编码映射 → 改用
    本项目 `mcAsset()` 加载自有 CC0/CC-BY 图标。
  - 用法：`<McInventory main={[...27]} hotbar={[...9]} scale={2} />`，每项 `{ scope, name, amount? }`。
  - 许可全文：`assets/mc-ui/LICENSE-burigg.md`
- 本项目自带的设计系统（`index.css` 的 `.mc-btn-*` / `.mc-card` / 9-slice 风格）亦提供方块风面板底。

## 重要：不要用原版 Minecraft 贴图
Minecraft 原版 GUI/物品贴图（游戏 jar 内的 `widget.png` 等）归 Mojang/Microsoft 所有，
EULA 禁止在其他产品里再分发。本文件夹所有图标均为上述开放协议集合，**不含任何原版资产**。

## 增减图标
直接把任意 `.svg` / `.png` / `.webp` 丢进对应子文件夹即可（`mc-ui.ts` 用
`import.meta.glob('./*/*.{svg,png,webp}')` 自动收录，支持 png/webp）。
