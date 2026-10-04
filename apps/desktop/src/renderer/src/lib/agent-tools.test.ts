// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { findTool, agentTools, toolsToFunctionDefinitions } from './agent-tools.js';
import { useModStore } from '../store/mod-store.js';

/**
 * agent-tools 测试：覆盖全部 10 个工具的行为。
 * 文件操作走真实 useModStore；run_command 需 mock terminal IPC。
 */

// 只替换终端相关方法；generateFiles 保留真实实现——openai 工具测试需要真实的
// 生成结果，而真实 generateFiles 走主进程 IPC，jsdom 下不可用，
// 故在 resetStore 中打开 __MC_PREVIEW__ 走 ipc-client 的进程内回退分支。
vi.mock('./ipc-client.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./ipc-client.js')>();
  return {
    ipcClient: {
      ...actual.ipcClient,
      terminalSpawn: vi.fn(),
      terminalWrite: vi.fn(),
      terminalKill: vi.fn(),
      ragSearch: vi.fn(),
    },
  };
});

import { ipcClient } from './ipc-client.js';

function resetStore() {
  // 预览模式：让 ipcClient.generateFiles 在进程内跑 core 生成器（无需 Electron 主进程）
  (window as unknown as { __MC_PREVIEW__?: boolean }).__MC_PREVIEW__ = true;
  useModStore.setState({
    loader: 'fabric',
    mcVersion: '1.21.11',
    description: '测试项目',
    generatorType: 'datapack',
    spec: {
      packId: 'test',
      packName: 'Test',
      recipes: [],
      functions: [{ id: 'hello', commands: ['say hi'] }],
    } as never,
    files: [
      { path: 'data/test/function/hello.mcfunction', content: 'say hi' },
      { path: 'assets/test/lang/en_us.json', content: '{"a":"b"}' },
      { path: 'textures/icon.png', content: 'BINARY' },
    ],
    previousFiles: [],
    selectedFile: null,
    openTabs: [],
    splitFile: null,
    dirtyFiles: new Set<string>(),
    buildLog: '',
    buildSuccess: null,
    jarPath: null,
    loading: false,
    error: null,
    fixLog: [],
  });
}

describe('agent-tools 注册表', () => {
  it('注册 13 个工具（含 search_knowledge）', () => {
    expect(agentTools).toHaveLength(13);
    expect(findTool('search_knowledge')).toBeDefined();
  });

  it('findTool 按名查找', () => {
    expect(findTool('read_file')?.name).toBe('read_file');
    expect(findTool('generate_mod')?.name).toBe('generate_mod');
    expect(findTool('no_such')).toBeUndefined();
  });

  it('toolsToFunctionDefinitions 生成 OpenAI 兼容定义', () => {
    const defs = toolsToFunctionDefinitions();
    expect(defs.length).toBe(13);
    const readFile = defs.find((d) => d.function.name === 'read_file')!;
    expect(readFile.type).toBe('function');
    expect(readFile.function.parameters.type).toBe('object');
    expect(readFile.function.parameters.required).toContain('path');
  });
});

describe('read_file', () => {
  beforeEach(resetStore);

  it('读取存在的文件', async () => {
    const tool = findTool('read_file')!;
    const result = await tool.execute({ path: 'data/test/function/hello.mcfunction' });
    expect(result).toBe('say hi');
  });

  it('不存在的文件返回错误并列出可用文件', async () => {
    const tool = findTool('read_file')!;
    const result = await tool.execute({ path: 'nope.txt' });
    expect(result).toContain('不存在');
    expect(result).toContain('hello.mcfunction');
  });

  it('超长文件截断', async () => {
    useModStore.setState({
      files: [{ path: 'big.txt', content: 'x'.repeat(10000) }],
    });
    const tool = findTool('read_file')!;
    const result = await tool.execute({ path: 'big.txt' });
    expect(result.length).toBeLessThan(9000);
    expect(result).toContain('已截断');
  });
});

describe('list_files', () => {
  beforeEach(resetStore);

  it('列出全部文件', async () => {
    const tool = findTool('list_files')!;
    const result = await tool.execute({});
    expect(result).toContain('hello.mcfunction');
    expect(result).toContain('en_us.json');
  });

  it('目录前缀过滤（assets 不误匹配 assets2）', async () => {
    useModStore.setState({
      files: [
        { path: 'assets/a.json', content: '1' },
        { path: 'assets2/b.json', content: '2' },
      ],
    });
    const tool = findTool('list_files')!;
    const result = await tool.execute({ directory: 'assets' });
    expect(result).toContain('assets/a.json');
    expect(result).not.toContain('assets2/b.json');
  });

  it('无匹配返回提示', async () => {
    const tool = findTool('list_files')!;
    const result = await tool.execute({ directory: 'zzz' });
    expect(result).toContain('没有找到文件');
  });
});

describe('search_code', () => {
  beforeEach(resetStore);

  it('正则搜索返回匹配行', async () => {
    const tool = findTool('search_code')!;
    const result = await tool.execute({ query: 'say' });
    expect(result).toContain('hello.mcfunction');
    expect(result).toContain('L1');
  });

  it('非法正则回退为纯文本', async () => {
    const tool = findTool('search_code')!;
    const result = await tool.execute({ query: '[' });
    // 不崩溃且返回"没有找到"
    expect(typeof result).toBe('string');
  });

  it('跳过 .png 二进制文件', async () => {
    const tool = findTool('search_code')!;
    const result = await tool.execute({ query: 'BINARY' });
    expect(result).toContain('没有找到');
  });

  it('file_pattern 过滤文件类型', async () => {
    const tool = findTool('search_code')!;
    const result = await tool.execute({ query: 'say', file_pattern: '.json' });
    expect(result).toContain('没有找到');
  });
});

describe('search_knowledge', () => {
  beforeEach(resetStore);

  it('命中时返回标题+片段+来源', async () => {
    vi.mocked(ipcClient.ragSearch).mockResolvedValue({
      hits: [{ title: '自定义附魔 enchantment', snippet: 'supported_items 片段', source: 'Minecraft Wiki', score: 3.1 }],
      cached: false,
    });
    const tool = findTool('search_knowledge')!;
    const result = await tool.execute({ query: '附魔', generator_type: 'datapack' });
    expect(result).toContain('自定义附魔');
    expect(result).toContain('来源');
    expect(ipcClient.ragSearch).toHaveBeenCalledWith({ query: '附魔', generatorType: 'datapack', topK: 5 });
  });

  it('零命中时提示换关键词', async () => {
    vi.mocked(ipcClient.ragSearch).mockResolvedValue({ hits: [], cached: true });
    const tool = findTool('search_knowledge')!;
    const result = await tool.execute({ query: '不存在的内容xyz' });
    expect(result).toContain('没有命中');
  });

  it('IPC 不可用时回退不断链', async () => {
    vi.mocked(ipcClient.ragSearch).mockRejectedValue(new Error('no ipc'));
    const tool = findTool('search_knowledge')!;
    const result = await tool.execute({ query: '附魔' });
    expect(result).toContain('暂不可用');
  });
});

describe('write_file / edit_file / delete_file', () => {
  beforeEach(resetStore);

  it('write_file 创建新文件', async () => {
    const tool = findTool('write_file')!;
    const result = await tool.execute({ path: 'new.txt', content: 'hello' });
    expect(result).toContain('已创建');
    expect(useModStore.getState().files.some((f) => f.path === 'new.txt')).toBe(true);
  });

  it('write_file 覆盖已有文件', async () => {
    const tool = findTool('write_file')!;
    const result = await tool.execute({
      path: 'data/test/function/hello.mcfunction',
      content: 'x',
    });
    expect(result).toContain('已更新');
  });

  it('edit_file 精确替换', async () => {
    const tool = findTool('edit_file')!;
    const result = await tool.execute({
      path: 'data/test/function/hello.mcfunction',
      old_text: 'say hi',
      new_text: 'say hello',
    });
    expect(result).toContain('精确替换');
    const file = useModStore
      .getState()
      .files.find((f) => f.path === 'data/test/function/hello.mcfunction');
    expect(file?.content).toBe('say hello');
  });

  it('edit_file 多次出现报错', async () => {
    useModStore.setState({
      files: [{ path: 'dup.txt', content: 'a a a' }],
    });
    const tool = findTool('edit_file')!;
    const result = await tool.execute({
      path: 'dup.txt',
      old_text: 'a',
      new_text: 'b',
    });
    expect(result).toContain('出现了 3 次');
  });

  it('edit_file 未找到报错', async () => {
    const tool = findTool('edit_file')!;
    const result = await tool.execute({
      path: 'data/test/function/hello.mcfunction',
      old_text: 'not_there',
      new_text: 'x',
    });
    expect(result).toContain('未找到');
  });

  it('delete_file 删除文件', async () => {
    const tool = findTool('delete_file')!;
    const result = await tool.execute({ path: 'data/test/function/hello.mcfunction' });
    expect(result).toContain('已删除');
    expect(useModStore.getState().files.some((f) => f.path === 'hello.mcfunction')).toBe(false);
  });

  it('delete_file 不存在报错', async () => {
    const tool = findTool('delete_file')!;
    const result = await tool.execute({ path: 'nope' });
    expect(result).toContain('不存在');
  });
});

describe('get_project_context', () => {
  beforeEach(resetStore);

  it('包含项目概览、spec 摘要、文件树、dirty 标记', async () => {
    useModStore.setState({ dirtyFiles: new Set(['assets/test/lang/en_us.json']) });
    const tool = findTool('get_project_context')!;
    const result = await tool.execute({});
    expect(result).toContain('=== 项目概览 ===');
    expect(result).toContain('生成器类型: datapack');
    expect(result).toContain('functions: 1 个');
    expect(result).toContain('hello.mcfunction');
    expect(result).toContain('[已修改]');
  });
});

describe('run_command', () => {
  beforeEach(resetStore);

  it('执行命令并收集输出（正常路径）', async () => {
    // mock window.mcApi：onTerminalExit 注册后立即触发退出事件（pid 匹配）
    const exitListeners: Array<(_e: unknown, d: { pid: number; exitCode: number }) => void> = [];
    window.mcApi = {
      onTerminalExit: ((cb: (_e: unknown, d: { pid: number; exitCode: number }) => void) => {
        exitListeners.push(cb);
        return () => {};
      }) as never,
    } as never;
    const tool = findTool('run_command')!;
    (ipcClient.terminalSpawn as ReturnType<typeof vi.fn>).mockResolvedValue({ pid: 42 });
    (ipcClient.terminalWrite as ReturnType<typeof vi.fn>).mockResolvedValue({});
    const resultPromise = tool.execute({ command: 'echo hi' });
    // 等 terminalSpawn 完成后触发退出事件
    await vi.waitFor(() => {
      expect(exitListeners.length).toBe(1);
    });
    exitListeners[0](null, { pid: 42, exitCode: 0 });
    const result = await resultPromise;
    expect(ipcClient.terminalSpawn).toHaveBeenCalled();
    expect(result).toContain('命令已执行');
    expect(result).toContain('退出码 0');
  });

  it('终端不可用时返回错误提示', async () => {
    const tool = findTool('run_command')!;
    (ipcClient.terminalSpawn as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('no terminal'),
    );
    const result = await tool.execute({ command: 'echo hi' });
    expect(result).toContain('终端不可用');
  });
});

describe('generate_mod', () => {
  beforeEach(resetStore);

  it('生成 Fabric Mod 文件并写入 store', async () => {
    const tool = findTool('generate_mod')!;
    const specJson = JSON.stringify({
      modId: 'ruby_tools',
      version: '1.0.0',
      name: 'Ruby Tools',
      description: 'A test mod',
      license: 'MIT',
      authors: [],
      credits: '',
      website: '',
      dependencies: [],
      items: [
        {
          id: 'ruby',
          name: 'Ruby',
          maxStackSize: 64,
          rarity: 'common',
          maxDamage: 0,
          fuelTick: 0,
          lore: '',
        },
      ],
      blocks: [],
    });
    const result = await tool.execute({ spec_json: specJson, loader: 'fabric' });
    expect(result).toContain('Mod 生成成功');
    expect(result).toContain('ruby_tools');
    expect(result).toContain('items: 1');
    // 文件写入 store
    const files = useModStore.getState().files;
    expect(files.some((f) => f.path.endsWith('ModItems.java'))).toBe(true);
    expect(files.some((f) => f.path === 'src/main/resources/fabric.mod.json')).toBe(true);
  });
  it('使用当前项目 MC 版本生成（非硬编码）', async () => {
    useModStore.setState({ mcVersion: '26.1' });
    const tool = findTool('generate_mod')!;
    const specJson = JSON.stringify({
      modId: 'ruby_tools',
      version: '1.0.0',
      name: 'Ruby Tools',
      description: 'A test mod',
      license: 'MIT',
      authors: [],
      credits: '',
      website: '',
      dependencies: [],
      items: [],
      blocks: [],
    });
    const result = await tool.execute({ spec_json: specJson, loader: 'fabric' });
    // 26.1 → build.gradle 用 Java 25
    const files = useModStore.getState().files;
    const bg = files.find((f) => f.path === 'build.gradle');
    expect(bg!.content).toContain('JavaVersion.VERSION_25');
    const gp = files.find((f) => f.path === 'gradle.properties');
    expect(gp!.content).toContain('minecraft_version=26.1');
    expect(result).toContain('警告');
  });

  it('无效 JSON 返回错误', async () => {
    const tool = findTool('generate_mod')!;
    const result = await tool.execute({ spec_json: 'not json' });
    expect(result).toContain('不是有效的 JSON');
  });

  it('ModSpec 校验失败返回错误明细', async () => {
    const tool = findTool('generate_mod')!;
    const result = await tool.execute({
      spec_json: JSON.stringify({ modId: 'bad id!', version: '1.0.0', name: '', description: '' }),
    });
    expect(result).toContain('Spec 校验失败');
  });
});

describe('generate_files（通用生成器工具）', () => {
  beforeEach(resetStore);

  it('生成 behavior_entity 全套文件并写回 store', async () => {
    const tool = findTool('generate_files')!;
    const result = await tool.execute({
      generator_type: 'behavior_entity',
      spec_json: JSON.stringify({
        packId: 'test_pack',
        packName: 'Test Pack',
        entities: [{ id: 'tiger', name: 'Tiger', hostile: false, geometry: 'creeper' }],
      }),
    });
    expect(result).toContain('behavior_entity 生成成功');
    expect(result).toContain('entities: 1');

    const s = useModStore.getState();
    const paths = s.files.map((f) => f.path);
    expect(paths).toContain('manifest.json');
    expect(paths).toContain('entities/tiger.behavior.json');
    expect(paths).toContain('entity/tiger.client_entity.json');
    expect(paths).toContain('textures/entity/tiger.png');
    expect(paths).toContain('texts/zh_CN.lang');
    expect((s.spec as unknown as { packId: string }).packId).toBe('test_pack');
  });

  it('未知生成器类型返回可用类型列表', async () => {
    const tool = findTool('generate_files')!;
    const result = await tool.execute({
      generator_type: 'not_a_type',
      spec_json: '{}',
    });
    expect(result).toContain('未知生成器类型');
    expect(result).toContain('behavior_entity');
  });

  it('非法 spec 返回中文字段级校验错误', async () => {
    const tool = findTool('generate_files')!;
    const result = await tool.execute({
      generator_type: 'behavior_item',
      spec_json: JSON.stringify({ packId: 'bad id!', packName: 'X' }),
    });
    expect(result).toContain('behavior_item Spec 校验失败');
    expect(result).toContain('packId');
  });

  it('无效 JSON 返回错误', async () => {
    const tool = findTool('generate_files')!;
    const result = await tool.execute({ generator_type: 'server', spec_json: 'not json' });
    expect(result).toContain('不是有效的 JSON');
  });

  it('server 类型使用项目默认版本生成 server.properties', async () => {
    const tool = findTool('generate_files')!;
    const result = await tool.execute({
      generator_type: 'server',
      spec_json: JSON.stringify({ serverName: 'MyServer' }),
    });
    expect(result).toContain('server 生成成功');
    const paths = useModStore.getState().files.map((f) => f.path);
    expect(paths).toContain('server.properties');
    expect(paths).toContain('eula.txt');
  });
});
