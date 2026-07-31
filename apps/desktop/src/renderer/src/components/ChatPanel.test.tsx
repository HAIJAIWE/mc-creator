// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { ChatPanel } from './ChatPanel.js';
import { useChatStore } from '../store/chat-store.js';
import { useModStore } from '../store/mod-store.js';

/**
 * ChatPanel 单元测试（P11.1）。
 *
 * 覆盖范围：
 * - 默认渲染：标题、欢迎消息、输入框
 * - 无 apiKey 时输入框禁用 + placeholder 提示
 * - 有 apiKey 时输入框启用 + placeholder 提示
 * - 清空对话按钮重置消息
 * - Enter 发送调用 chatStream
 * - Shift+Enter 不发送（仅换行）
 * - chatStream delta 累加到最后一条 assistant 消息
 * - chatStream 抛错显示「发送失败：...」
 * - 含 ``` 的消息渲染为 <pre> 代码块
 *
 * P11.2：messages/input/sending 提升到 useChatStore，每个测试前需重置 store。
 * P12.6：每个测试前还需重置 useModStore（description/spec/generatorType），
 *        否则 mod-store 持久化字段会污染下一个测试的 context 断言。
 */

interface MockMcApi {
  chatStream: ReturnType<typeof vi.fn>;
  [key: string]: unknown;
}

let mockMcApi: MockMcApi;

beforeEach(() => {
  mockMcApi = {
    chatStream: vi.fn(),
  };
  (window as unknown as { mcApi: MockMcApi }).mcApi = mockMcApi;
  // 重置 chat-store 到初始状态
  useChatStore.setState({
    messages: [{ role: 'assistant', text: '你好！描述你想要的 mod，我来帮你生成。' }],
    input: '',
    sending: false,
  });
  // P12.6 重置 mod-store 输入字段（持久化的部分会影响 context 构建）
  useModStore.setState({
    description: '',
    spec: null,
    generatorType: 'mod',
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('ChatPanel', () => {
  it('默认渲染：包含「AI 助手」标题与初始欢迎消息', () => {
    render(<ChatPanel apiKey="" />);
    expect(screen.getByText('AI 助手')).toBeTruthy();
    expect(screen.getByText('你好！描述你想要的 mod，我来帮你生成。')).toBeTruthy();
  });

  it('无 apiKey 时输入框被禁用，placeholder 提示「请先配置 API Key」', () => {
    render(<ChatPanel apiKey="" />);
    const input = screen.getByPlaceholderText('请先配置 API Key') as HTMLTextAreaElement;
    expect(input.disabled).toBe(true);
  });

  it('有 apiKey 时输入框启用，placeholder 提示「输入消息，Enter 发送...」', () => {
    render(<ChatPanel apiKey="sk-test-key" />);
    const input = screen.getByPlaceholderText(
      '输入消息，Enter 发送，Shift+Enter 换行…',
    ) as HTMLTextAreaElement;
    expect(input.disabled).toBe(false);
  });

  it('无 apiKey 时发送按钮被禁用', () => {
    render(<ChatPanel apiKey="" />);
    const sendBtn = screen.getByLabelText('发送消息') as HTMLButtonElement;
    expect(sendBtn.disabled).toBe(true);
  });

  it('点击「清空对话」按钮重置消息为「对话已清空...」', () => {
    render(<ChatPanel apiKey="sk-test-key" />);
    fireEvent.click(screen.getByLabelText('清空对话'));
    expect(screen.getByText('对话已清空。有什么可以帮你的？')).toBeTruthy();
    // 欢迎消息应被替换
    expect(screen.queryByText('你好！描述你想要的 mod，我来帮你生成。')).toBeNull();
  });

  it('Enter 触发发送：调用 chatStream 并显示用户消息', async () => {
    mockMcApi.chatStream.mockImplementation(
      (_msg: string, onChunk: (d: string, done: boolean) => void) => {
        onChunk('你好', false);
        onChunk('，世界', true);
        return Promise.resolve();
      },
    );
    render(<ChatPanel apiKey="sk-test-key" />);
    const input = screen.getByPlaceholderText(
      '输入消息，Enter 发送，Shift+Enter 换行…',
    ) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: '测试消息' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    // 用户消息应立即出现
    expect(screen.getByText('测试消息')).toBeTruthy();
    // P12.6 chatStream 现在传 3 个参数（msg, onChunk, context）。无 generatorType/description/spec 时 context=undefined。
    expect(mockMcApi.chatStream).toHaveBeenCalledWith('测试消息', expect.any(Function), undefined);
    // 等待流式响应累加完成
    await waitFor(() => {
      expect(screen.getByText('你好，世界')).toBeTruthy();
    });
  });

  it('Shift+Enter 不触发发送（仅换行，不调用 chatStream）', () => {
    render(<ChatPanel apiKey="sk-test-key" />);
    const input = screen.getByPlaceholderText(
      '输入消息，Enter 发送，Shift+Enter 换行…',
    ) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: '测试' } });
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });
    expect(mockMcApi.chatStream).not.toHaveBeenCalled();
  });

  it('chatStream delta 流式累加到最后一条 assistant 消息', async () => {
    mockMcApi.chatStream.mockImplementation(
      (_msg: string, onChunk: (d: string, done: boolean) => void) => {
        onChunk('Hello', false);
        onChunk(' ', false);
        onChunk('World', true);
        return Promise.resolve();
      },
    );
    render(<ChatPanel apiKey="sk-test-key" />);
    const input = screen.getByPlaceholderText(
      '输入消息，Enter 发送，Shift+Enter 换行…',
    ) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: 'hi' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => {
      expect(screen.getByText('Hello World')).toBeTruthy();
    });
  });

  it('chatStream 抛错时显示「发送失败：...」', async () => {
    mockMcApi.chatStream.mockRejectedValue(new Error('网络异常'));
    render(<ChatPanel apiKey="sk-test-key" />);
    const input = screen.getByPlaceholderText(
      '输入消息，Enter 发送，Shift+Enter 换行…',
    ) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: 'hi' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => {
      expect(screen.getByText('发送失败：网络异常')).toBeTruthy();
    });
  });

  it('发送中显示「思考中...」Loader 指示器', async () => {
    // 用一个可控的流式回调：不立即 done，让 sending 状态保持
    let resolveStream: ((done: boolean) => void) | null = null;
    mockMcApi.chatStream.mockImplementation(
      (_msg: string, onChunk: (d: string, done: boolean) => void) => {
        onChunk('', false);
        resolveStream = (done: boolean) => onChunk('完成', done);
        return Promise.resolve();
      },
    );
    render(<ChatPanel apiKey="sk-test-key" />);
    const input = screen.getByPlaceholderText(
      '输入消息，Enter 发送，Shift+Enter 换行…',
    ) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: 'hi' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.getByText('思考中...')).toBeTruthy();
    // 结束流
    await waitFor(() => {
      if (resolveStream) resolveStream(true);
    });
    await waitFor(() => {
      expect(screen.queryByText('思考中...')).toBeNull();
    });
  });

  it('含 ``` 代码块的消息渲染为 <pre> 元素', () => {
    // 直接渲染一条含代码块的助手消息：通过清空对话后再触发 chatStream 流式回包
    mockMcApi.chatStream.mockImplementation(
      (_msg: string, onChunk: (d: string, done: boolean) => void) => {
        onChunk('代码如下：\n```js\nconsole.log(1)\n```', true);
        return Promise.resolve();
      },
    );
    render(<ChatPanel apiKey="sk-test-key" />);
    const input = screen.getByPlaceholderText(
      '输入消息，Enter 发送，Shift+Enter 换行…',
    ) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: 'hi' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    // 应出现 pre 元素，包含 console.log(1)
    const pre = document.querySelector('pre');
    expect(pre).toBeTruthy();
    expect(pre?.textContent).toContain('console.log(1)');
  });

  it('输入为空（仅空白）时 Enter 不触发发送', () => {
    render(<ChatPanel apiKey="sk-test-key" />);
    const input = screen.getByPlaceholderText(
      '输入消息，Enter 发送，Shift+Enter 换行…',
    ) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(mockMcApi.chatStream).not.toHaveBeenCalled();
  });

  it('P11.2 状态持久化：组件卸载后重新挂载，对话历史保留', () => {
    // 模拟：发送一条消息 → 卸载（切到 agent 模式）→ 重新挂载（切回 chat 模式）
    mockMcApi.chatStream.mockImplementation(
      (_msg: string, onChunk: (d: string, done: boolean) => void) => {
        onChunk('回复内容', true);
        return Promise.resolve();
      },
    );
    const { unmount } = render(<ChatPanel apiKey="sk-test-key" />);
    const input = screen.getByPlaceholderText(
      '输入消息，Enter 发送，Shift+Enter 换行…',
    ) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: '用户问题' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    // 卸载前应有用户消息
    expect(screen.getByText('用户问题')).toBeTruthy();

    // 卸载（模拟切到 agent 模式）
    unmount();

    // 重新挂载（模拟切回 chat 模式）
    render(<ChatPanel apiKey="sk-test-key" />);
    // 对话历史应保留
    expect(screen.getByText('用户问题')).toBeTruthy();
  });

  it('P11.4 传入 generatorType=mod 时显示「模组」徽章', () => {
    render(<ChatPanel apiKey="sk-test-key" generatorType="mod" />);
    expect(screen.getByText('模组')).toBeTruthy();
  });

  it('P11.4 传入 generatorType=datapack 时显示「数据包」徽章', () => {
    render(<ChatPanel apiKey="sk-test-key" generatorType="datapack" />);
    expect(screen.getByText('数据包')).toBeTruthy();
  });

  it('P11.4 不传 generatorType 时不显示徽章', () => {
    render(<ChatPanel apiKey="sk-test-key" />);
    // 不应出现任何生成器类型徽章文本
    expect(screen.queryByText('模组')).toBeNull();
    expect(screen.queryByText('数据包')).toBeNull();
    expect(screen.queryByText('整合包')).toBeNull();
  });

  // === P12 chat 模式工具调用增强：项目上下文感知 ===

  it('P12 传入 generatorType=mod 时 chatStream 收到 context.generatorType=mod', async () => {
    mockMcApi.chatStream.mockImplementation(
      (_msg: string, onChunk: (d: string, done: boolean) => void) => {
        onChunk('ok', true);
        return Promise.resolve();
      },
    );
    render(<ChatPanel apiKey="sk-test-key" generatorType="mod" />);
    const input = screen.getByPlaceholderText(
      '输入消息，Enter 发送，Shift+Enter 换行…',
    ) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: 'hi' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(mockMcApi.chatStream).toHaveBeenCalledWith(
      'hi',
      expect.any(Function),
      expect.objectContaining({ generatorType: 'mod' }),
    );
  });

  it('P12 useModStore 有 description 时 chatStream context.description 被设置', async () => {
    useModStore.setState({ description: '添加一个红宝石矿石' });
    mockMcApi.chatStream.mockImplementation(
      (_msg: string, onChunk: (d: string, done: boolean) => void) => {
        onChunk('ok', true);
        return Promise.resolve();
      },
    );
    render(<ChatPanel apiKey="sk-test-key" generatorType="mod" />);
    const input = screen.getByPlaceholderText(
      '输入消息，Enter 发送，Shift+Enter 换行…',
    ) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: 'hi' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(mockMcApi.chatStream).toHaveBeenCalledWith(
      'hi',
      expect.any(Function),
      expect.objectContaining({ description: '添加一个红宝石矿石' }),
    );
  });

  it('P12 useModStore 有 spec 时 chatStream context.specSummary 包含 modId/items/blocks 摘要', async () => {
    useModStore.setState({
      spec: {
        modId: 'ruby_mod',
        version: '1.0.0',
        name: 'Ruby Mod',
        description: '红宝石模组',
        items: [
          { id: 'ruby', name: '红宝石' },
          { id: 'ruby_sword', name: '红宝石剑' },
        ],
        blocks: [{ id: 'ruby_ore', name: '红宝石矿石' }],
      } as never,
    });
    mockMcApi.chatStream.mockImplementation(
      (_msg: string, onChunk: (d: string, done: boolean) => void) => {
        onChunk('ok', true);
        return Promise.resolve();
      },
    );
    render(<ChatPanel apiKey="sk-test-key" generatorType="mod" />);
    const input = screen.getByPlaceholderText(
      '输入消息，Enter 发送，Shift+Enter 换行…',
    ) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: 'hi' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(mockMcApi.chatStream).toHaveBeenCalledWith(
      'hi',
      expect.any(Function),
      expect.objectContaining({
        specSummary: expect.stringContaining('modId: ruby_mod'),
      }),
    );
    // 进一步验证摘要包含 items 和 blocks 信息
    const callArgs = mockMcApi.chatStream.mock.calls[0];
    const ctx = callArgs?.[2] as { specSummary: string };
    expect(ctx.specSummary).toContain('items[2]');
    expect(ctx.specSummary).toContain('ruby(红宝石)');
    expect(ctx.specSummary).toContain('blocks[1]');
    expect(ctx.specSummary).toContain('ruby_ore(红宝石矿石)');
  });

  it('P12 无 generatorType/description/spec 时 chatStream 第 3 个参数为 undefined', async () => {
    mockMcApi.chatStream.mockImplementation(
      (_msg: string, onChunk: (d: string, done: boolean) => void) => {
        onChunk('ok', true);
        return Promise.resolve();
      },
    );
    render(<ChatPanel apiKey="sk-test-key" />);
    const input = screen.getByPlaceholderText(
      '输入消息，Enter 发送，Shift+Enter 换行…',
    ) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: 'hi' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    // 无任何项目上下文时不传 context，让 main 进程走默认 system message
    expect(mockMcApi.chatStream).toHaveBeenCalledWith('hi', expect.any(Function), undefined);
  });
});
