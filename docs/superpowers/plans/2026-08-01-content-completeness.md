# 内容类型补全 — 2026-08-01

- 日期:2026-08-01
- 状态:计划
- 触发:用户确认「把他们都完善了」(补齐 MC 1.21 内容类型缺口)

## 缺口清单(审计结论)

### A. 世界生成(价值最高,完全缺失)
- `configured_feature` / `placed_feature` — 矿石/树/植被/湖/矿物脉放置
- `template_pool` / `processor_list` — jigsaw 结构配套(现有 StructureSpec 只内联 templatePool 字符串,不生成池文件)

### B. 1.21 新注册表类型(小步快补)
- `jukebox_song`(唱片机歌曲)、`painting_variant`(画作)、`wolf_variant`(狼变体)、`banner_pattern`(旗帜图案)、`chat_type`(消息格式)

### C. 世界生成辅助
- `density_function`(噪声函数)、`worldgen/noise`(噪声参数)、`flat_level_generator_preset`(超平坦预设)

### D. Mod 侧:流体
- Fabric/NeoForge 流体注册(FluidSpec: id/name/texturePath/block 属性)

### E. 深度改进(浅实现加深)
- `loot_table`:condition/function 支持(时运、丝绸等)
- `advancement`:criteria 高级配置
- `structure`:引用自定义 template_pool(而非内联字符串)

## 实施顺序

1. **Task A**: shared schema(FeatureSpec/PlacedFeatureSpec/TemplatePoolSpec/ProcessorListSpec)+ datapack-generator 生成 + 测试
2. **Task B**: shared schema(JukeboxSongSpec/PaintingVariantSpec/WolfVariantSpec/BannerPatternSpec/ChatTypeSpec)+ 生成 + 测试
3. **Task C**: DensityFunctionSpec/NoiseSpec/FlatPresetSpec + 生成 + 测试
4. **Task D**: FluidSpec + fabric/neoforge adapter 注册 + 测试
5. **Task E**: loot condition/function、advancement criteria、structure 池引用 + 测试
6. 全量验证 + 分组提交

## 验收

- 每个 Task: typecheck + 相关测试绿
- 最终:`pnpm -r test` 全绿,独立 commit
