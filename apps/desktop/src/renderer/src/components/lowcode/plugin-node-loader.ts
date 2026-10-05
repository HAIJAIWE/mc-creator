import { listNodes, registerNode } from './node-registry.js';

/**
 * 插件节点加载器（渲染进程沙箱）。
 *
 * 目录约定（均相对于项目工作区，经 `window.mcApi` 访问，渲染层不直调 `node:fs`）：
 * - 项目级：`workspaces/<projectId>/nodes/*.js` → 工作区相对路径 `nodes/*.js`
 * - 全局（项目 mods 内）：`mods/nodes/*.js` → 工作区相对路径 `mods/nodes/*.js`
 *
 * 插件文件格式（普通脚本，禁止 `import`/`export` 语法）：
 * ```js
 * // hello-block.js
 * registerNode({
 *   id: 'myplugin:hello_block',
 *   title: 'Hello 方块',
 *   category: 'content',
 *   inputs: [],
 *   outputs: [{ id: 'out', label: '方块', type: 'block_state', direction: 'out' }],
 *   toSpec: (ctx) => [{ path: 'hello.txt', content: 'hi ' + ctx.nodeId }],
 * });
 * ```
 * 也支持 `module.exports = {...}` / `module.exports = [{...}]` 形式（不调用 registerNode 时）。
 *
 * 安全：
 * - 代码先过 `FORBIDDEN_PATTERNS` 静态检查（`require`/`process`/`node:fs`/`eval` 等直接拒绝）。
 * - 求值作用域仅注入 `registerNode` + `mcApi` 白名单代理 + 受限 `console`，
 *   不暴露 `require`/`process`/`globalThis`/`window`。
 */

// === mcApi 白名单 ===

/**
 * 插件可调用的 `window.mcApi` 方法白名单（只读 + 生成类，禁止写文件/构建/终端）。
 *
 * 白名单之外的 key 不会出现在沙箱 `mcApi` 对象上（访问得到 `undefined`）。
 */
export const PLUGIN_MC_API_ALLOWLIST = [
  'generateSpec',
  'generateFiles',
  'chat',
  'fileProjectListDir',
  'fileProjectListTree',
  'fileProjectReadText',
  'fileProjectGetWorkspace',
  'fileProjectGetModsDir',
  'fileProjectGetOutputDir',
] as const;

type RawMcApi = Record<string, unknown>;

function getRawMcApi(): RawMcApi | undefined {
  const g = globalThis as unknown as { mcApi?: RawMcApi };
  if (g.mcApi && typeof g.mcApi === 'object') return g.mcApi;
  if (typeof window !== 'undefined') {
    const w = window as unknown as { mcApi?: RawMcApi };
    if (w.mcApi && typeof w.mcApi === 'object') return w.mcApi;
  }
  return undefined;
}

/** 按白名单构造沙箱 `mcApi` 代理（方法逐个包装，`this` 不泄露原始对象）。 */
export function createSandboxMcApi(): RawMcApi {
  const raw = getRawMcApi();
  const out: RawMcApi = {};
  if (!raw) return out;
  for (const key of PLUGIN_MC_API_ALLOWLIST) {
    const fn = raw[key];
    if (typeof fn === 'function') {
      const bound = fn as (...args: unknown[]) => unknown;
      out[key] = (...args: unknown[]): unknown => bound(...args);
    }
  }
  return out;
}

function createSandboxConsole(
  filename: string,
): Pick<Console, 'log' | 'warn' | 'error' | 'info' | 'debug'> {
  const prefix = `[plugin:${filename}]`;
  return {
    log: (...args: unknown[]) => console.log(prefix, ...args),
    warn: (...args: unknown[]) => console.warn(prefix, ...args),
    error: (...args: unknown[]) => console.error(prefix, ...args),
    info: (...args: unknown[]) => console.info(prefix, ...args),
    debug: (...args: unknown[]) => console.debug(prefix, ...args),
  };
}

// === 静态安全检查 ===

/** 命中任一即拒绝加载（提示改用 `registerNode` + `mcApi` 白名单）。 */
export const FORBIDDEN_PATTERNS: RegExp[] = [
  /\brequire\s*\(/,
  /\bprocess\s*\./,
  /\bchild_process\b/,
  /node\s*:\s*fs/,
  /\bfs\s*\.\s*(read|write|open|mkdir|readdir)\w*/,
  /\beval\s*\(/,
  /new\s+Function\s*\(/,
  /import\s+.*from\s+['"]node:/,
  /\bglobalThis\b/,
  /window\s*\.\s*require/,
  /\bipcRenderer\b/,
];

/** 静态检查插件源码，命中禁用模式时抛错。 */
export function assertPluginCodeSafe(code: string, filename: string): void {
  for (const re of FORBIDDEN_PATTERNS) {
    if (re.test(code)) {
      throw new Error(`插件 ${filename} 命中禁用模式 ${String(re)}：只允许纯函数 + mcApi 白名单`);
    }
  }
  if (/^\s*import\s/m.test(code) || /^\s*export\s+(default|const|function)/m.test(code)) {
    throw new Error(
      `插件 ${filename} 使用了 import/export 语法：请改用普通脚本 + registerNode({...}) 形式`,
    );
  }
}

// === 求值 ===

export interface EvaluatePluginResult {
  /** 本次求值新注册的节点 id。 */
  registered: string[];
  errors: string[];
}

/**
 * 在沙箱中求值单个插件文件源码。
 *
 * - 作用域仅含 `registerNode` / `mcApi` / `console` / `module` / `exports`。
 * - 支持 `module.exports = def | def[]` 导出形式（未调用 `registerNode` 时的兜底）。
 */
export function evaluatePluginCode(code: string, filename: string): EvaluatePluginResult {
  const errors: string[] = [];
  const registered: string[] = [];
  try {
    assertPluginCodeSafe(code, filename);
  } catch (e) {
    return { registered, errors: [(e as Error).message] };
  }

  const before = new Set(listNodes().map((d) => d.id));
  const sandboxRegister = (def: unknown): string => {
    const parsed = registerNode(def);
    if (!before.has(parsed.id) && !registered.includes(parsed.id)) {
      registered.push(parsed.id);
    }
    return parsed.id;
  };

  try {
    const runner = new Function('registerNode', 'mcApi', 'console', 'module', 'exports', code) as (
      registerNodeFn: (def: unknown) => string,
      mcApi: RawMcApi,
      console: unknown,
      module: { exports?: unknown },
      exports: Record<string, unknown>,
    ) => unknown;
    const mod: { exports?: unknown } = {};
    const exp: Record<string, unknown> = {};
    runner(sandboxRegister, createSandboxMcApi(), createSandboxConsole(filename), mod, exp);

    // module.exports 兜底：允许 `module.exports = {...}` / `[...]` 形式
    const exported = mod.exports ?? (Object.keys(exp).length > 0 ? exp : undefined);
    if (exported !== undefined) {
      const defs = Array.isArray(exported) ? exported : [exported];
      for (const def of defs) {
        if (def !== null && typeof def === 'object' && 'id' in (def as Record<string, unknown>)) {
          try {
            sandboxRegister(def);
          } catch (e) {
            errors.push(`插件 ${filename} 导出定义注册失败：${(e as Error).message}`);
          }
        }
      }
    }
  } catch (e) {
    errors.push(`插件 ${filename} 执行失败：${(e as Error).message}`);
  }
  return { registered, errors };
}

// === 文件访问 ===

export interface PluginFileAccess {
  listProjectNodeFiles(projectId: string): Promise<string[]>;
  readProjectNodeFile(projectId: string, fileName: string): Promise<string>;
  listGlobalNodeFiles(projectId: string): Promise<string[]>;
  readGlobalNodeFile(projectId: string, fileName: string): Promise<string>;
}

/** 从未知形状的 listDir 响应中提取 `.js` 文件名（兼容多种桥接返回形态）。 */
export function extractJsFileNames(res: unknown): string[] {
  const entries: unknown[] = Array.isArray(res)
    ? res
    : res !== null && typeof res === 'object'
      ? ((res as Record<string, unknown>).data as unknown) !== undefined
        ? toArray((res as Record<string, unknown>).data)
        : ((res as Record<string, unknown>).entries as unknown) !== undefined
          ? toArray((res as Record<string, unknown>).entries)
          : []
      : [];
  const names: string[] = [];
  for (const e of entries) {
    const name = typeof e === 'string' ? e : (e as { name?: unknown }).name;
    if (typeof name !== 'string') continue;
    const base = name.split('/').pop() ?? name;
    if (base.endsWith('.js') && !base.startsWith('.')) names.push(base);
  }
  return [...new Set(names)].sort();
}

function toArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function extractText(res: unknown): string | undefined {
  if (typeof res === 'string') return res;
  if (res !== null && typeof res === 'object') {
    const rec = res as Record<string, unknown>;
    if (typeof rec.data === 'string') return rec.data;
    if (typeof rec.content === 'string') return rec.content;
  }
  return undefined;
}

/** 默认文件访问：经 `window.mcApi` 读写工作区相对路径（渲染层不直调 `node:fs`）。 */
export function createDefaultFileAccess(): PluginFileAccess {
  const callMcApi = async (method: string, ...args: unknown[]): Promise<unknown> => {
    const raw = getRawMcApi();
    const fn = raw?.[method];
    if (typeof fn !== 'function') throw new Error(`window.mcApi.${method} 不可用`);
    return (fn as (...a: unknown[]) => Promise<unknown>)(...args);
  };
  return {
    listProjectNodeFiles: async (projectId) => {
      try {
        const res = await callMcApi('fileProjectListDir', projectId, 'nodes');
        return extractJsFileNames(res);
      } catch {
        return [];
      }
    },
    readProjectNodeFile: async (projectId, fileName) => {
      const res = await callMcApi('fileProjectReadText', projectId, `nodes/${fileName}`);
      const text = extractText(res);
      if (text === undefined) throw new Error(`读取 nodes/${fileName} 失败`);
      return text;
    },
    listGlobalNodeFiles: async (projectId) => {
      try {
        const res = await callMcApi('fileProjectListDir', projectId, 'mods/nodes');
        return extractJsFileNames(res);
      } catch {
        return [];
      }
    },
    readGlobalNodeFile: async (projectId, fileName) => {
      const res = await callMcApi('fileProjectReadText', projectId, `mods/nodes/${fileName}`);
      const text = extractText(res);
      if (text === undefined) throw new Error(`读取 mods/nodes/${fileName} 失败`);
      return text;
    },
  };
}

// === 加载入口 ===

export interface LoadPluginNodesOptions {
  /** 当前项目 id（缺省时仅跳过磁盘扫描，不抛错）。 */
  projectId?: string | undefined;
  /** 文件访问实现（缺省用 `window.mcApi` 默认实现；测试可注入内存实现）。 */
  fileAccess?: PluginFileAccess | undefined;
}

export interface LoadPluginNodesResult {
  loaded: string[];
  errors: string[];
  filesChecked: number;
}

/**
 * 加载项目级 + 全局插件节点文件并逐个沙箱求值。
 *
 * - 无 `projectId` 或桥接缺失时返回空结果（不抛错，面板仅显示内置节点）。
 * - 单个文件失败不阻断其他文件（错误汇总到 `errors`）。
 */
export async function loadPluginNodes(
  opts: LoadPluginNodesOptions = {},
): Promise<LoadPluginNodesResult> {
  const loaded: string[] = [];
  const errors: string[] = [];
  let filesChecked = 0;
  const { projectId } = opts;
  if (!projectId) return { loaded, errors, filesChecked };
  const access = opts.fileAccess ?? createDefaultFileAccess();

  const jobs: Array<{ fileName: string; kind: 'project' | 'global' }> = [];
  try {
    for (const f of await access.listProjectNodeFiles(projectId)) {
      jobs.push({ fileName: f, kind: 'project' });
    }
  } catch (e) {
    errors.push(`列出项目节点目录失败：${(e as Error).message}`);
  }
  try {
    for (const f of await access.listGlobalNodeFiles(projectId)) {
      if (!jobs.some((j) => j.fileName === f)) jobs.push({ fileName: f, kind: 'global' });
    }
  } catch (e) {
    errors.push(`列出全局节点目录失败：${(e as Error).message}`);
  }

  for (const job of jobs) {
    filesChecked += 1;
    const display = job.kind === 'project' ? `nodes/${job.fileName}` : `mods/nodes/${job.fileName}`;
    try {
      const code =
        job.kind === 'project'
          ? await access.readProjectNodeFile(projectId, job.fileName)
          : await access.readGlobalNodeFile(projectId, job.fileName);
      const res = evaluatePluginCode(code, display);
      loaded.push(...res.registered);
      errors.push(...res.errors);
    } catch (e) {
      errors.push(`加载插件 ${display} 失败：${(e as Error).message}`);
    }
  }
  return { loaded, errors, filesChecked };
}
