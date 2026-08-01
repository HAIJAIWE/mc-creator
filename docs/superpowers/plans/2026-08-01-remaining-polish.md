# 剩余不足补齐计划 — 2026-08-01

- 日期:2026-08-01
- 状态:计划
- 触发:用户确认补齐全部剩余不足

## 缺口与方案

### Task 1: 打包图标
- 用 SVG 生成应用图标(256x256 PNG + ico)
- electron-builder.yml 指向图标

### Task 2: custom 条件/动作 UX
- conditionType/actionType 选 custom 时,表单显示 Java 代码编辑框(替换 JSON args)
- ConditionNodeData/ActionNodeData 加 `customCode` 字段
- event-logic:custom 时输出用户代码(而非 TODO)

### Task 3: AI 生成重试
- generateSpec 失败时自动重试 1 次(短暂延迟),仍失败才报错
- 错误信息更友好(网络/超时/API key 分类)

### Task 4: 26.1 版本占位收敛
- 移除 26.1 的占位警告抑制?不——保留警告但 TopToolbar 已标"实验性"。
- 检查:26.1 是否应保留在版本列表(是,预留);文档说明即可

### Task 5: 机器逻辑深度
- BlockEntity 加工时:按进度推进 + 完成时输出;已有。
- 增强:支持 input→output 转换映射(recipeMap: 输入物品→输出物品),默认"第一输入搬第一输出"

### Task 6: 实体自定义模型
- EntitySpec.modelType 加 'custom' 时生成实体模型 JSON 骨架 + 提示用户放置模型文件
- 已支持 custom(生成骨架类)

## 验收
- 每 Task:typecheck + 测试绿;全量测试;分组提交
