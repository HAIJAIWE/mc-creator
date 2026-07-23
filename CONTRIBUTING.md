# 贡献指南

感谢你对 MC Creator 项目的兴趣！本文档说明如何参与开发。

## 环境准备

- **Node.js** ≥ 18（推荐 20）
- **pnpm** ≥ 9（`corepack enable && corepack prepare pnpm@9 --activate`）
- **JDK 21+**（仅 Mod 构建需要，其他生成器不需要）

## 快速开始

```bash
git clone <repo-url>
cd mc-creator
pnpm install
pnpm --filter @mc-creator/desktop dev   # 启动开发服务器
```

## 项目结构

```
mc-creator/
├── apps/desktop/         # Electron 桌面应用（main + preload + renderer）
│   └── renderer/src/components/lowcode/  # 低代码节点图编辑器（14 节点 + 子图 + 编译器）
├── packages/shared/      # 共享 Zod schema 与类型（node-graph-spec / mod-spec）
├── packages/core/        # 核心引擎（生成器 + 构建器 + AI 编排）
└── docs/superpowers/     # 设计规格与实现计划（含低代码 Phase A/B/C 计划）
```

详见 [README.md](README.md) 的「项目结构」章节。

## 开发工作流

### 1. 创建分支

```bash
git checkout -b feat/your-feature
# 或
git checkout -b fix/your-bugfix
```

### 2. 编写代码

遵循现有代码风格。所有检查本地通过后再提交：

```bash
pnpm lint            # ESLint 检查（0 errors 0 warnings）
pnpm typecheck       # TypeScript 类型检查
pnpm test            # Vitest 单元测试
pnpm format:check    # Prettier 格式检查
```

一键修复：

```bash
pnpm lint:fix        # ESLint 自动修复
pnpm format          # Prettier 格式化所有文件
```

### 3. 提交代码（Conventional Commits）

本项目使用 [Conventional Commits](https://www.conventionalcommits.org/) 规范，commitlint 会自动校验：

```
<type>(<scope>): <subject>

<body 可选>

<footer 可选>
```

**允许的 type**：

| type       | 说明                           |
| ---------- | ------------------------------ |
| `feat`     | 新功能                         |
| `fix`      | Bug 修复                       |
| `docs`     | 文档变更                       |
| `style`    | 代码格式（不影响功能）         |
| `refactor` | 重构（既不是 feat 也不是 fix） |
| `perf`     | 性能优化                       |
| `test`     | 测试相关                       |
| `build`    | 构建系统或依赖变更             |
| `ci`       | CI 配置变更                    |
| `chore`    | 杂项（不修改 src 或测试）      |
| `revert`   | 回滚之前的 commit              |

**允许的 scope**：`generators` / `builder` / `renderer` / `main` / `preload` / `shared` / `core` / `desktop` / `ci` / `deps` 等。

示例：

```
feat(generators): add LauncherGenerator for launcher type
fix(renderer): move useMemo before early return in FileTree
docs: update README with lint/format commands
ci: add format:check to lint job
chore(deps): bump eslint from 9.0.0 to 9.39.5
```

### 4. 推送并创建 PR

```bash
git push -u origin feat/your-feature
```

CI 会自动跑 lint + typecheck + test（三平台矩阵）+ build（双平台矩阵）。所有检查通过后才能合并。

## 测试策略

- **TDD 优先**：新功能先写测试 → 确认 FAIL → 写实现 → 确认 PASS → commit
- **单元测试**：每个 Generator / Builder / Provider 都有独立测试
- **mock 策略**：AI 调用用 `MockProvider`，文件系统用 `memfs`，进程执行用函数注入
- **测试覆盖**：当前 250+ 测试用例，新增功能必须附带测试

## 添加新生成器

详见 [README.md](README.md) 的「开发指南 → 添加新生成器」章节。

## 报告 Bug / 提建议

- 提 issue 时请描述：复现步骤、期望行为、实际行为、环境信息（OS / Node / pnpm 版本）
- 附上截图或日志会更有帮助

## 代码规范

- **TypeScript 严格模式**：所有包启用 `strict: true`
- **ESLint 9 flat config**：按环境区分规则（main/preload/renderer/packages）
- **Prettier**：单引号 / 分号 / 100 列 / trailing comma all / LF
- **EditorConfig**：UTF-8 / LF / 2 空格（bat/ps1 用 CRLF）

## 许可证

贡献的代码将在 [MIT License](LICENSE) 下发布。
