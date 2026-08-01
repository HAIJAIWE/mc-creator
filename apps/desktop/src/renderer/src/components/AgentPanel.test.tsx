// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AgentPanel } from './AgentPanel.js';
import { useModStore } from '../store/mod-store.js';
import { useModelConfigStore } from '../store/model-config-store.js';
import { useSpecHistoryStore } from '../store/spec-history-store.js';

/**
 * AgentPanel 测试：覆盖渲染冒烟、UI 关键元素、生成 Spec 流程。
 *
 * mock window.mcApi 避免 ipcClient 调用真的走 IPC，
 * 同时保留调用签名以便断言。
 */

interface MockMcApi {
  generateSpec: ReturnType<typeof vi.fn>;
  generateFiles: ReturnType<typeof vi.fn>;
  loadModelConfig: ReturnType<typeof vi.fn>;
  saveModelConfig: ReturnType<typeof vi.fn>;
  chat: ReturnType<typeof vi.fn>;
  [key: string]: ReturnType<typeof vi.fn>;
}

let mockMcApi: MockMcApi;

beforeEach(() => {
  // 重置 store 到初始空状态
  useModStore.setState({
    loader: 'fabric',
    mcVersion: '1.21.11',
    description: '',
    generatorType: 'mod',
    spec: null,
    files: [],
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
  useModelConfigStore.setState({
    name: '',
    modelId: '',
    baseURL: '',
    apiKey: '',
    loaded: false,
  });
  useSpecHistoryStore.setState({ versions: [], currentIndex: -1 });

  // mock window.mcApi
  mockMcApi = {
    generateSpec: vi.fn(),
    generateFiles: vi.fn(),
    loadModelConfig: vi.fn(),
    saveModelConfig: vi.fn(),
    chat: vi.fn(),
  };
  // 其它可能被调用的方法兜底
  for (const key of Object.keys(mockMcApi)) {
    (mockMcApi as Record<string, unknown>)[key] = mockMcApi[key as keyof MockMcApi];
  }
  (window as unknown as { mcApi: MockMcApi }).mcApi = mockMcApi;
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('AgentPanel', () => {
  it('渲染冒烟：包含「描述输入」区域标题', () => {
    render(<AgentPanel />);
    expect(screen.getByText('描述输入')).toBeTruthy();
  });

  it('默认展开描述输入区，textarea 可见', () => {
    render(<AgentPanel />);
    // textarea 的 placeholder 根据 generatorType 变化
    const textarea = screen.getByPlaceholderText('描述你想要的 mod…');
    expect(textarea).toBeTruthy();
  });

  it('generatorType=datapack 时 textarea placeholder 切换为「描述你想要的数据包…」', () => {
    useModStore.setState({ generatorType: 'datapack' });
    render(<AgentPanel />);
    expect(screen.getByPlaceholderText('描述你想要的数据包…')).toBeTruthy();
  });

  it('generatorType=modpack 时 placeholder 切换为「描述你想要的整合包…」', () => {
    useModStore.setState({ generatorType: 'modpack' });
    render(<AgentPanel />);
    expect(screen.getByPlaceholderText('描述你想要的整合包…')).toBeTruthy();
  });

  it('generatorType=launcher 时 placeholder 为「描述你想要的启动器配置…」', () => {
    useModStore.setState({ generatorType: 'launcher' });
    render(<AgentPanel />);
    expect(screen.getByPlaceholderText('描述你想要的启动器配置…')).toBeTruthy();
  });

  it('generatorType=kubejs 时 placeholder 为「描述你想要的 KubeJS 脚本…」', () => {
    useModStore.setState({ generatorType: 'kubejs' });
    render(<AgentPanel />);
    expect(screen.getByPlaceholderText('描述你想要的 KubeJS 脚本…')).toBeTruthy();
  });

  it('generatorType=crafttweaker 时 placeholder 为「描述你想要的 CraftTweaker 脚本…」', () => {
    useModStore.setState({ generatorType: 'crafttweaker' });
    render(<AgentPanel />);
    expect(screen.getByPlaceholderText('描述你想要的 CraftTweaker 脚本…')).toBeTruthy();
  });

  it('generatorType=behavior_pack 时 placeholder 为「描述你想要的行为包…」', () => {
    useModStore.setState({ generatorType: 'behavior_pack' });
    render(<AgentPanel />);
    expect(screen.getByPlaceholderText('描述你想要的行为包…')).toBeTruthy();
  });

  it('描述为空时「生成 Spec」按钮被禁用', () => {
    render(<AgentPanel />);
    const generateBtn = screen.getByRole('button', { name: /生成 Spec/ }) as HTMLButtonElement;
    expect(generateBtn.disabled).toBe(true);
  });

  it('输入描述后「生成 Spec」按钮启用', () => {
    render(<AgentPanel />);
    const textarea = screen.getByPlaceholderText('描述你想要的 mod…');
    fireEvent.change(textarea, { target: { value: '一个测试 mod' } });
    const generateBtn = screen.getByRole('button', { name: /生成 Spec/ }) as HTMLButtonElement;
    expect(generateBtn.disabled).toBe(false);
  });

  it('spec 为空时「生成代码」按钮被禁用', () => {
    render(<AgentPanel />);
    const generateCodeBtn = screen.getByRole('button', {
      name: /生成代码/,
    }) as HTMLButtonElement;
    expect(generateCodeBtn.disabled).toBe(true);
  });

  it('spec 存在时「生成代码」按钮启用', () => {
    useModStore.setState({
      spec: {
        modId: 'test_mod',
        version: '1.0.0',
        name: 'Test',
        description: '',
        items: [],
        blocks: [],
        license: 'MIT',
        authors: [],
        credits: '',
        dependencies: [],
        website: '',
        lootTables: [],
        advancements: [],
        tags: [],
        functions: [],
        recipes: [],
        entities: [],
        machines: [],
        customCode: [],
        multiblocks: [],
        fluids: [],
        biomes: [],
        dimensions: [],
        guis: [],
        eventHandlers: [],
        conditions: [],
        actions: [],
        procedures: [],
      },
    });
    render(<AgentPanel />);
    const generateCodeBtn = screen.getByRole('button', {
      name: /生成代码/,
    }) as HTMLButtonElement;
    expect(generateCodeBtn.disabled).toBe(false);
  });

  it('点击「生成 Spec」调用 ipcClient.generateSpec', async () => {
    mockMcApi.generateSpec.mockResolvedValue({ spec: { modId: 'test' } });
    render(<AgentPanel />);
    const textarea = screen.getByPlaceholderText('描述你想要的 mod…');
    fireEvent.change(textarea, { target: { value: '一个测试 mod' } });
    const generateBtn = screen.getByRole('button', { name: /生成 Spec/ });
    fireEvent.click(generateBtn);
    // 等待下一个微任务让 async 函数推进
    await Promise.resolve();
    await Promise.resolve();
    expect(mockMcApi.generateSpec).toHaveBeenCalledWith('一个测试 mod', 'mod');
  });

  it('渲染「AI 智能体」标题（默认 agent 模式）', () => {
    render(<AgentPanel />);
    // agentMode=agent 时标题为「AI 智能体」（AgentSessionPanel 内部也可能含此文本，用 getAllByText）
    expect(screen.getAllByText('AI 智能体').length).toBeGreaterThan(0);
  });

  it('点击模式切换按钮切换到 chat 模式，标题变为「AI 助手」', () => {
    render(<AgentPanel />);
    // 模式切换按钮：title 属性提示当前可切换的目标
    const toggleBtn = screen.getByTitle('切换到聊天模式');
    fireEvent.click(toggleBtn);
    expect(screen.getAllByText('AI 助手').length).toBeGreaterThan(0);
  });

  it('chat 模式下显示初始助手欢迎消息', () => {
    render(<AgentPanel />);
    // 切换到 chat 模式
    fireEvent.click(screen.getByTitle('切换到聊天模式'));
    expect(screen.getByText('你好！描述你想要的 mod，我来帮你生成。')).toBeTruthy();
  });

  it('chat 模式下显示消息输入框，但无 apiKey 时输入框禁用', () => {
    render(<AgentPanel />);
    fireEvent.click(screen.getByTitle('切换到聊天模式'));
    const input = screen.getByPlaceholderText('请先配置 API Key') as HTMLInputElement;
    expect(input.disabled).toBe(true);
  });

  it('点击「描述输入」折叠按钮可折叠描述区', () => {
    render(<AgentPanel />);
    // 初始 textarea 可见
    expect(screen.getByPlaceholderText('描述你想要的 mod…')).toBeTruthy();
    // 点击「描述输入」标题按钮
    fireEvent.click(screen.getByText('描述输入'));
    // 折叠后 textarea 不存在
    expect(screen.queryByPlaceholderText('描述你想要的 mod…')).toBeNull();
  });

  it('渲染工具栏按钮：模板/历史/对比', () => {
    render(<AgentPanel />);
    expect(screen.getByTitle('从模板库选择')).toBeTruthy();
    expect(screen.getByTitle('Spec 版本历史')).toBeTruthy();
    expect(screen.getByTitle('多模型对比')).toBeTruthy();
  });

  it('generatorType=modpack 时显示 Modrinth/CurseForge 搜索按钮', () => {
    useModStore.setState({ generatorType: 'modpack' });
    render(<AgentPanel />);
    expect(screen.getByTitle('搜索 Modrinth')).toBeTruthy();
    expect(screen.getByTitle('搜索 CurseForge')).toBeTruthy();
  });

  it('generatorType=mod 时不显示 Modrinth/CurseForge 搜索按钮', () => {
    useModStore.setState({ generatorType: 'mod' });
    render(<AgentPanel />);
    expect(screen.queryByTitle('搜索 Modrinth')).toBeNull();
    expect(screen.queryByTitle('搜索 CurseForge')).toBeNull();
  });
});
