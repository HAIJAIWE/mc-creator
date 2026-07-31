# 脚本生成器增强(P36/P37)— KubeJS / CraftTweaker

- 日期:2026-08-01
- 状态:计划
- 触发:用户确认的六个方向之一(KubeJS / CraftTweaker 生成器增强)

## 现状审计

两个生成器已支持 recipes(shaped/shapeless/smelting/stonecutting/custom)、tags、events、tooltips、registry(KubeJS)、lang。缺口:

| 缺口 | 证据 | 影响 |
|---|---|---|
| KubeJS recipe 的 `count` 被忽略 | `generateRecipe` shaped/shapeless 无数量输出 | 产物数量只能固定 1 |
| KubeJS smelting 无 xp/cookingTime | schema 无字段 | 烧炼经验/时长不可配 |
| CraftTweaker smelting 无 xp/cookTime | `furnace.addRecipe(result, input)` 只 2 参数 | 同上 |
| 两个生成器都缺 blasting/smoking | schema enum 无此类型 | 高炉/烟熏炉配方不可生成 |

## 方案

### shared schema(KubejsRecipeSpec / CraftTweakerRecipeSpec)

- `type` enum 扩展:`blasting` / `smoking`(KubeJS + CraftTweaker)
- 新增可选字段:`experience?: number`(smelting/blasting/smoking 用)、`cookingTime?: number`(同上)

### KubeJS generateRecipe 增强

- `count > 1`:`result` 输出为 `'3x minecraft:stone'` 语法(shaped/shapeless/stonecutting/smelting/blasting/smoking 全支持)
- smelting/blasting/smoking:`event.<type>('result', 'input')` + `.xp(n)` / `.cookingTime(n)` 链式(有值才链)
- 新增 blasting/smoking case

### CraftTweaker generateRecipe 增强

- smelting/blasting/smoking:`furnace` / `blastFurnace` / `smoker` 的 `addRecipe(result, input, xp, cookTime)`(xp/cookTime 有值才输出,默认 2 参)
- 新增 blasting/smoking case

## 验收

- shared 测试:`type` 枚举含新类型、可选字段默认
- kubejs-generator.test:count>1 输出 `'3x ...'`;smelting+xp/cookingTime 链式;blasting/smoking 生成 `event.blasting/smoking`
- crafttweaker-generator.test:smelting+xp/cookTime 输出 4 参;blasting 用 `blastFurnace`;smoking 用 `smoker`
- `pnpm -r typecheck` / `pnpm -r test` 全绿;独立 commit
