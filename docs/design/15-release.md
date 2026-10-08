## 15. 工程化底座

- **构建**：esbuild（主进程 + preload）+ Vite（渲染层）
- **打包**：electron-builder，`asar: true` + **`asarUnpack`（better-sqlite3 等原生模块必须解包，并做 Electron ABI rebuild）**，`compression: maximum`，
  `files` 白名单只含编译产物，**禁止整包 node_modules**
- **测试**：Vitest（单元）+ Playwright（E2E）
  - 固定 manifest fixture、mock CDN、假实例目录
  - **更新器必须 mock**，日常 CI 不得触碰真实更新源
- **更新**：electron-updater + 分阶段灰度
- **发布**：GitHub Actions
  - 版本号以 `package.json` 为唯一事实源
  - 构建前检查 Release 是否存在
  - 六平台矩阵：`win-x64 / win-arm64 / mac-x64 / mac-arm64 / linux-x64 / linux-arm64`
    （Electron 已终止 32 位平台支持，故不列 `win-ia32`）
  - Linux 额外出 deb / rpm / AppImage
- **签名**：Windows EV 证书 / macOS Developer ID + 公证 / Linux GPG

### monorepo 结构（pnpm workspaces）

```
apps/desktop              主进程 + 渲染层
packages/shell            共享外壳能力（不含内核）
packages/contract         薄契约（只有类型）
packages/kernel-java      Java 内核
packages/kernel-bedrock   Bedrock 内核
packages/kernel-server    服务端内核
packages/devkit           开发内核（构建沙箱与工具链）
packages/engine           下载引擎
packages/agent            MCP 工具层 + 编排
packages/generator-datapack     数据包生成（Sandstone）
packages/generator-bedrock      基岩脚本生成
packages/generator-plugin       插件生成（Paper/Folia）
packages/generator-mod          模组生成（NeoForge/Fabric）
packages/ui               组件库
packages/i18n             文案
```

---
