# MC Creator — 字体授权说明（FONTS）

本目录字体均为 **SIL Open Font License 1.1（OFL-1.1）**，可免费商用、修改、再分发，仅禁止单独出售字体文件本身。

| 字体 | 用途 | 许可证 | 来源 |
|---|---|---|---|
| **Pixelify Sans** (400/500/600/700) | 标题 / 品牌字（display） | OFL-1.1 | github.com/eifetx/Pixelify-Sans（Google Fonts 镜像） |
| **VT323** (400) | 代码区等宽像素字（mono 后备） | OFL-1.1 | github.com/rgmntrc/VT323（Google Fonts 镜像） |
| **Monocraft** (400–700) | 最正宗 MC 代码字体（mono 首选） | OFL-1.1 | github.com/IdreesInc/Monocraft |

## 关于中文字体
Pixelify Sans / VT323 / Monocraft **均不含中文字形**。中文 UI 文字回退到系统 CJK 字体
（PingFang SC / Microsoft YaHei），英文/代码部分使用上述像素字体——这是有意为之，避免中文变成豆腐块。

## Monocraft 已内置
- 文件：`src/assets/fonts/Monocraft.ttf`（210,192 字节，OFL-1.1，来自 IdreesInc/Monocraft 官方 `dist/Monocraft-ttf/Monocraft.ttf`，经 jsDelivr CDN 拉取）
- 刷新即自动生效（`index.css` 中已写好 `@font-face`，无需改代码）；缺失时才回退 VT323。

## OFL 署名文案（发版时贴「关于 / Credits」即可）
> Pixel font "Pixelify Sans" by Stefie Justprince & "VT323" by Peter Hull, licensed under SIL Open Font License 1.1.
> Minecraft-style code font "Monocraft" by Idrees Inc., licensed under SIL Open Font License 1.1.
> Not affiliated with Mojang or Microsoft; no original Minecraft assets are included.
