# MC 全链路 AI 工作台 · 完整设计文档

> 版本 v3.1 · 面向编程 AI 的实施规格（修订记录见 §24）
> 本文档是项目的唯一事实来源。实现前若与本文档冲突，以本文档为准；
> 本文档未覆盖处，标注 `[待核实]`，实现前须核对官方文档。

---

---

# MC 全链路 AI 工作台 · 设计文档（模块化）

> 版本 v3.1 · 由 `docs/design-v3.1.md` 自动拆分生成。
> **不要直接编辑本目录下的文件** —— 改 `docs/design-v3.1.md` 后重新运行拆分脚本。

## 章节索引

- [§0 项目定位](./00-positioning.md)
- [§1 合规基线](./01-compliance.md)
- [§2 总体架构](./02-architecture.md)
- [§3 薄契约（唯一强制统一的类型）](./03-content-kinds.md)
- [§4 共享外壳（清单）](./04-module-list.md)
- [§5 Java 内核（客户端实例）](./05-java-kernel.md)
- [§6 Bedrock 内核（内容网关）](./06-bedrock-kernel.md)
- [§7 服务端内核](./07-server-kernel.md)
- [§8 开发内核（devkit）](./08-devkit.md)
- [§9 内容对象模型（34 类，按家族组织）](./09-content-model.md)
- [§10 智能体层](./10-agent.md)
- [§11 生成阶梯（实现优先级依据）](./11-generation-ladder.md)
- [§12 数据模型（概要）](./12-content-model.md)
- [§13 安全模型](./13-security.md)
- [§14 可靠性设计](./14-reliability.md)
- [§15 工程化底座](./15-release.md)
- [§16 外部数据源](./16-external-resources.md)
- [§17 智能体驱动的跨域闭环（示例场景）](./17-iteration.md)
- [§18 落地顺序（依赖驱动）](./18-phases.md)
- [§19 风险登记册](./19-risk.md)
- [§20 竞品情报](./20-deliverables.md)
- [§21 待核实清单](./21-verification.md)
- [§22 交付说明](./22-delivery.md)
- [§23 参考项目对照表（每个功能的落地参照）](./23-references.md)
- [§24 变更记录（v3.0 → v3.1）](./24-changelog.md)
