# 安全策略

## 报告安全漏洞

如果你发现 MC Creator 的安全漏洞，请**不要**公开提 issue。

请通过以下方式私下报告：

1. 发送邮件到 `security@example.com`（请替换为维护者的实际邮箱）
2. 或使用 GitHub 的 [Security Advisories](https://docs.github.com/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability) 功能私下报告

请在报告中包含：

- 漏洞的详细描述
- 复现步骤（最小化示例）
- 影响范围评估
- 建议的修复方案（如有）

## 响应时间

- **确认收到**：3 个工作日内
- **初步评估**：7 个工作日内
- **修复发布**：根据严重程度，30-90 天内

## 安全考量

MC Creator 是一个 Electron 桌面应用，涉及以下安全敏感区域：

- **IPC 通信**：主进程与渲染进程之间的消息传递（已用 zod schema 校验）
- **文件系统访问**：项目保存/加载、代码导出（已加路径穿越防护 `assertWithin`）
- **API Key 存储**：AI 模型配置的密钥（已用 Electron `safeStorage` 加密）
- **子进程调用**：Gradle 构建（已去 `shell: true`，参数数组传递）
- **CSP**：渲染进程已配置 Content Security Policy

## 已知安全设计

详见 [README.md](README.md) 的「架构设计」章节和代码中的安全注释。

## 致谢

感谢 responsibly 报告安全漏洞的研究者。我们会在修复后在 SECURITY.md 的「致谢」部分列出（除非你要求匿名）。
