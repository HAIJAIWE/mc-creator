# 协作编辑(单机文件协作)— 2026-08-01

- 日期:2026-08-01
- 状态:计划
- 触发:用户确认做协作编辑 + 面板

## 范围界定

真正的多人实时协作(WebSocket 同步)需要服务器,超出单机 Electron 应用。本计划实现**基于文件的异步协作**:

1. **Spec 导出**:把当前 Spec 保存为 `.mc-spec.json` 文件(含元数据:导出者/时间/描述)
2. **Spec 导入**:读取 .mc-spec.json,与当前 Spec 做字段级 diff,展示差异
3. **合并/替换**:用户选择"采用导入版本"或"合并"(以导入为准合并到当前)
4. **协作面板 UI**(CollaborationPanel):导出/导入/差异预览/冲突提示

## 方案

### Task 1: IPC 通道(导出/导入 Spec 文件)
- `spec:export` / `spec:import` IPC 通道(main 进程用 dialog.showSaveDialog/showOpenDialog)
- preload 暴露 `exportSpec` / `importSpec`
- 导出格式:`{ meta: { exportedAt, exporter? }, spec: <ModSpec> }`

### Task 2: 协作面板组件
- CollaborationPanel:导出按钮 / 导入按钮 / 导入后 diff 预览(复用 specDiff)/ 合并或替换按钮
- 接入 AgentPanel 或工具栏

### Task 3: 测试
- specDiff 已测(复用)
- 面板测试:导出调用 mock、导入后 diff 渲染、合并写回 store

### 验收
- typecheck/test/lint 全绿,独立 commit
