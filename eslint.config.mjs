// ESLint 9 flat config for the mc-creator pnpm monorepo.
// ESM format (.mjs) because the root package.json does not set "type": "module".
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import prettierConfig from 'eslint-config-prettier';
import globals from 'globals';

export default tseslint.config(
  // ---- Global ignores ----
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/out/**',
      '**/out_*/**',
      '**/coverage/**',
      // electron-builder 的产物目录（.gitignore:19 已忽略，git ls-files 为 0）：
      // 里面是被打包进去的**第三方脚本副本**，lint 它们只会报出一堆无意义的错。
      '**/release/**',
      '**/*.snap',
      '**/*.config.ts',
      '**/*.config.mjs',
      '**/*.config.js',
      '**/*.config.cjs',
      '**/tsconfig*.json',
      '**/pnpm-lock.yaml',
      '**/.pnpm-store/**',
    ],
  },

  // ---- Base: recommended JS + TS, with Prettier compat ----
  js.configs.recommended,
  ...tseslint.configs.recommended,

  // ---- Generic TS environment (shared schemas/types + packages) ----
  {
    files: ['packages/**/*.ts', 'apps/desktop/src/shared/**/*.ts'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.node,
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'error',
      // kernel-bedrock / kernel-server 的 `dispatch()` 都写了 `const kernel = this;`：
      // 返回的 TaskHandle 里 `result()` 是**闭包**，其中的 `this` 指向 handle 对象
      // 而不是 kernel，必须靠这个提前捕获的别名才能调到 kernel 的私有方法
      // （executeWrite / serverDir / readContextParts）。这是"闭包捕获 this"的标准
      // 写法，不是漏写箭头函数——把回调改成箭头函数只会把 handle 自身的 this
      // 一起捕获，反而更错。
      '@typescript-eslint/no-this-alias': 'off',
    },
  },

  // ---- Electron main process (Node.js only) ----
  {
    files: ['apps/desktop/src/main/**/*.ts'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.node,
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },

  // ---- Electron preload (Node.js + DOM) ----
  {
    files: ['apps/desktop/src/preload/**/*.ts'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.node,
        ...globals.browser,
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },

  // ---- Renderer (browser + DOM, React) ----
  {
    files: ['apps/desktop/src/renderer/**/*.ts', 'apps/desktop/src/renderer/**/*.tsx'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
      globals: {
        ...globals.browser,
      },
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },

  /**
   * devkit 的沙箱执行器（§8.3）：必须在运行时 require 原生绑定。
   *
   * `no-require-imports` 在这里必须关掉，理由不是「图方便」：
   * `@mc-creator/jobobject` 含 `build/Release/jobobject.node`，rollup 无法处理
   * 二进制。改成静态 import 会让它被内联进 bundle，产物里留下一个指向
   * 不存在 .node 的 require，运行时 dlopen 失败 —— 与 MEMORY §2-①
   * 记录的「打包启动即崩」是同一类故障。
   *
   * 用文件级精确匹配而非放宽整个包：devkit 其它文件都是正常 ESM。
   */
  {
    files: ['packages/devkit/src/sandbox-exec.ts'],
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
    },
  },

  /**
   * @mc-creator/jobobject 的 CommonJS 文件（§8.3 原生绑定的加载器与 launcher）。
   *
   * 必须是 CJS：`launcher.js` 由**子进程**用 `node launcher.js <json>` 直接执行，
   * 不经过任何打包器。改成 ESM 会让 require('@mc-creator/jobobject') 在
   * 运行时解析失败 —— 而那正是降级路径的判定依据（available=false）。
   *
   * 与根目录 `*.js` 那条配置同源（都注入 node globals、都关掉
   * no-require-imports），但必须单列：根 `*.js` 只匹配仓库根那一层，
   * 匹配不到 packages/jobobject/**。
   */
  {
    files: ['packages/jobobject/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: {
        ...globals.node,
      },
    },
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
    },
  },

  // ---- Node.js scripts (.mjs) ----
  {
    files: ['apps/desktop/scripts/**/*.mjs', 'scripts/**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.node,
      },
    },
  },

  /**
   * 仓库根的一次性 Node 脚本（.js，CJS）。
   *
   * 必须留成 CommonJS：根 package.json 没有 `"type": "module"`，
   * `create-demo-project.js` 就是靠 `require()` 跑的；改成 ESM 要连带改扩展名
   * 和调用方式，超出 lint 配置该管的范围。所以这里显式声明 sourceType: commonjs
   * 并注入 node globals（否则 require/process/console 全报 no-undef），
   * 同时关掉 no-require-imports —— 那条规则针对的是"在 ESM 里偷懒用 require"，
   * 而这个文件本来就跑在合法的 CJS 里。
   *
   * `*.js` 只匹配根目录那一层，不会波及任何嵌套 .js。
   */
  {
    files: ['*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: {
        ...globals.node,
      },
    },
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
    },
  },

  // ---- Playwright E2E（TS 用例与夹具：跑在 Node 侧，不是浏览器/渲染层）----
  {
    files: ['apps/desktop/e2e/**/*.ts'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.node,
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'error',
      // Playwright 的 fixture 签名被它自己的 loader 强制要求写成
      // `async ({}, use) => {}`（否则启动即报 "First argument must use the
      // object destructuring pattern"），而这个 fixture 恰好一个上游 fixture
      // 都不用。这是框架强制的签名，不是漏写解构。
      'no-empty-pattern': 'off',
    },
  },

  /**
   * E2E 主进程守卫（.cjs）。
   *
   * 必须留成 CommonJS：它是 `electron.launch()` 的**入口文件**，而
   * `out/main/index.js` 也是 CJS，靠 `require` 链接起来；换成 ESM 就接不上了。
   * 所以这里显式声明 sourceType: commonjs 并关掉 no-require-imports，
   * 而不是把文件硬改成 .ts 再加一堆运行时兼容代码。
   */
  {
    files: ['apps/desktop/e2e/**/*.cjs'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: {
        ...globals.node,
      },
    },
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },

  // ---- Test files: relax some rules ----
  {
    files: [
      '**/*.test.*',
      '**/*.spec.*',
      '**/*.e2e.*',
      '**/*.test.ts',
      '**/*.test.tsx',
      '**/*.spec.ts',
      '**/*.spec.tsx',
      // jobobject 的用例是 CJS（跑在 node 侧，见上面那条配置），
      // 需要 node globals 才能用 process / spawnSync。
      'packages/jobobject/**/*.test.js',
    ],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-require-imports': 'off',
    },
  },

  // ---- Turn off all rules that conflict with Prettier (must be last) ----
  prettierConfig,
);
