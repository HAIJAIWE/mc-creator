# Mod 侧世界生成 + 代码可编辑增强 — 2026-08-01

- 日期:2026-08-01
- 状态:计划
- 触发:用户对比 MCreator 后发现缺口(Mod 侧世界生成缺失;代码可编辑入口不足)

## 现状审计

| 缺口 | 证据 | MCreator 对照 |
|---|---|---|
| Mod 侧无生物群系 | mod-spec.ts 仅 `spawnBiomes`(实体用);adapter 无 biome 生成 | MCreator 生物群系:基础生成/天气/颜色/地表 + Java 注册 |
| Mod 侧无维度 | mod-spec.ts / adapter 均无 | MCreator 维度:维度类型 + 世界类型 + 入口 |
| 代码预览只读 | GeneratedCodePreview `readOnly=true` 默认 | MCreator 生成 Java 后直接编辑器可改 |
| 生成文件不可编辑 | 无"生成的 Java 文件→编辑器"入口 | MCreator Workspace 文件树双击编辑 |

## 方案

### Task 1: Mod 侧生物群系(ModBiomeSpec)
- schema:`ModBiomeSpec`(biomeId/displayName/precipitation/temperature/downfall/colors/surfaceBuilder/features)
- ModSpec.biomes 数组
- Fabric:ModBiomes.java(`BuiltInRegistries.BIOME` + `Biome.biome(...)` builder + climate 参数)
- NeoForge:DeferredRegister.Biomes + Biome.biome builder
- 测试:注册代码断言

### Task 2: Mod 侧维度(ModDimensionSpec)
- schema:`ModDimensionSpec`(dimensionId/displayName/dimensionType(overworld/nether/end/自定义)/seed/ultrawarm/hasSkyLight/minY/height)
- ModSpec.dimensions 数组
- Fabric:ModDimensions.java(`DynamicDimensions` API 或 level.dat 不可用时的 registry + dimension options)
- NeoForge:DeferredRegister + LevelStem 注册
- 测试

### Task 3: 生成代码可编辑
- GeneratedCodePreview 支持 `readOnly=false` 时 Monaco 编辑 + 写回 store(updateFileContent)
- LowcodeWorkspace 或预览区加"编辑"切换:只读预览 ↔ 可编辑
- 测试:编辑写回断言

### Task 4: 验证提交
- typecheck/test/lint 全绿,独立 commit

## 验收
- Mod 生成含 ModBiomes.java/ModDimensions.java(Fabric+NeoForge 各断言)
- 代码预览可切换编辑并写回 store
- 全量测试绿
