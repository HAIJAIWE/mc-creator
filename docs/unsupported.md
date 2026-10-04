# 未实现内容说明（Unsupported）

生成器无法用内置映射表达某些需求时，会生成**显性占位**而非静默跳过：

- 产物 Java 中的占位注释格式为 `// MC-Creator: unsupported(<kind>=<type>): <原因>`；
- 每次生成结果的 `unimplemented` 字段登记全部条目，`warnings` 中附带同内容中文行；
- 预览面板顶部黄色横幅展示条数，点击可定位文件；导出 zip 时附带 `UNIMPLEMENTED.md` 清单。

## 原因表

| 锚点                      | 含义                                                                               | 你该怎么做                                                                                      |
| ------------------------- | ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `unknown-condition`       | 条件类型不在支持枚举中（多为手改 Spec JSON 或旧 Spec 迁移残留）                    | 改用 11 种已知 `conditionType`（见 `mod-spec.ts:623-635`），或改用 `custom` 并填写 `customCode` |
| `unknown-action`          | 动作类型不在支持枚举中                                                             | 改用 13 种已知 `actionType`（见 `mod-spec.ts:649-663`），或改用 `custom` 并填写 `customCode`    |
| `unknown-event`           | 事件类型不在支持枚举中，该处理器未注册                                             | 改用 13 种已知 `eventType`（见 `mod-spec.ts:583-597`）                                          |
| `custom-empty`            | `custom` 条件/动作未填写 `customCode`，已生成安全默认（条件恒真/动作空操作）       | 在节点表单或 Spec JSON 中填写 Java 代码片段后重新生成                                           |
| `custom-event`            | `custom` 事件无内置映射，需手写 Mixin 或事件注册                                   | 参考已生成的 `ModEvents.java` 结构手写注册，或改用内置事件类型                                  |
| `unsupported-block-model` | 方块 `modelType`（或按 `blockType` 推导的结果）不在支持集合中，已回退为 `cube_all` | 改用 `cube_all`/`cube_column`/`cross`，或补全模型类型后重新生成                                 |

## 已覆盖范围（无需担心）

- 11 种条件、13 种动作、13 种事件（含 `block_place`/`item_pickup` 的 Mixin 桥接）均有内置实现；
- 只有**枚举之外**的未知字符串、`custom` 空代码、`custom` 事件会触发占位。
