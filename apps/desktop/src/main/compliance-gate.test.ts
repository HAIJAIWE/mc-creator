import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  ComplianceDeniedError,
  RISK_NOTICE,
  RISK_NOTICE_LINES,
  RISK_NOTICE_VERSION,
  ThirdPartyAuthGate,
  createNativeComplianceConfirm,
  isAllowedApiUrl,
  type ComplianceConfirmRequest,
} from './compliance-gate.js';

/**
 * §1.2 / §19 合规闸门测试。
 *
 * 三条硬要求各自独立断言：
 * 1. 默认关闭；2. 未显式确认时拒绝；3. 确认后才可用。
 * 外加「必须展示风险提示全文」与 fail-closed。
 */

const mocks = vi.hoisted(() => ({
  showMessageBox: vi.fn(),
  getFocusedWindow: vi.fn(),
  getAllWindows: vi.fn(),
}));

vi.mock('electron', () => ({
  dialog: { showMessageBox: mocks.showMessageBox },
  BrowserWindow: {
    getFocusedWindow: mocks.getFocusedWindow,
    getAllWindows: mocks.getAllWindows,
  },
}));

const API = 'https://littleskin.cn/api/yggdrasil';

/** 记录确认请求内容的 confirm 替身。 */
function makeConfirm(result: boolean | 'throw') {
  const seen: ComplianceConfirmRequest[] = [];
  const fn = async (req: ComplianceConfirmRequest): Promise<boolean> => {
    seen.push(req);
    if (result === 'throw') throw new Error('dialog 炸了');
    return result;
  };
  return { fn, seen };
}

beforeEach(() => {
  vi.restoreAllMocks();
  mocks.getFocusedWindow.mockReturnValue(null);
  mocks.getAllWindows.mockReturnValue([]);
});

describe('约束 1 · 默认关闭', () => {
  it('无参数构造 → isEnabled 为 false', () => {
    expect(new ThirdPartyAuthGate().isEnabled).toBe(false);
  });

  it('未启用时 authorize 直接拒绝（连确认都不弹）', async () => {
    const { fn, seen } = makeConfirm(true);
    const gate = new ThirdPartyAuthGate({ confirm: fn });
    await expect(gate.authorize(API)).rejects.toBeInstanceOf(ComplianceDeniedError);
    try {
      await gate.authorize(API);
    } catch (e) {
      expect((e as ComplianceDeniedError).reason).toBe('disabled_by_default');
      // 拒绝时不得出现「点一下就能开」的假象
      expect((e as Error).message).toContain('默认关闭');
    }
    // 关键：enabled=false 时**不弹窗**
    expect(seen).toHaveLength(0);
  });

  it('enabled: false 显式写出来也是拒绝', async () => {
    const { fn } = makeConfirm(true);
    const gate = new ThirdPartyAuthGate({ enabled: false, confirm: fn });
    await expect(gate.authorize(API)).rejects.toMatchObject({ reason: 'disabled_by_default' });
  });
});

describe('约束 2 · 启用须用户显式确认', () => {
  it('enabled 但没接确认函数 → 拒绝（fail-closed，不等于放行）', async () => {
    const gate = new ThirdPartyAuthGate({ enabled: true });
    await expect(gate.authorize(API)).rejects.toMatchObject({ reason: 'no_confirm_fn' });
  });

  it('enabled + 确认函数返回 false（用户取消）→ 拒绝', async () => {
    const { fn } = makeConfirm(false);
    const gate = new ThirdPartyAuthGate({
      enabled: true,
      confirm: fn,
      acknowledgedNoticeVersion: RISK_NOTICE_VERSION,
    });
    await expect(gate.authorize(API)).rejects.toMatchObject({ reason: 'confirm_declined' });
  });

  it('确认函数抛错（弹不出来）→ 拒绝（fail-closed）', async () => {
    const { fn } = makeConfirm('throw');
    const gate = new ThirdPartyAuthGate({
      enabled: true,
      confirm: fn,
      acknowledgedNoticeVersion: RISK_NOTICE_VERSION,
    });
    await expect(gate.authorize(API)).rejects.toMatchObject({ reason: 'confirm_failed' });
  });

  it('未确认过风险提示 → 拒绝（提示是启用流程的一部分，不是一次性勾选）', async () => {
    const { fn, seen } = makeConfirm(true);
    const gate = new ThirdPartyAuthGate({ enabled: true, confirm: fn });
    await expect(gate.authorize(API)).rejects.toMatchObject({ reason: 'notice_stale' });
    expect(seen).toHaveLength(0);
  });
});

describe('约束 3 · 风险提示全文（不是摘要）', () => {
  it('确认框 detail 逐条包含 §1.2 三条立场', async () => {
    const { fn, seen } = makeConfirm(true);
    const gate = new ThirdPartyAuthGate({
      enabled: true,
      confirm: fn,
      acknowledgedNoticeVersion: RISK_NOTICE_VERSION,
    });
    await gate.authorize(API);
    expect(seen).toHaveLength(1);
    const detail = seen[0]!.detail;
    for (const line of RISK_NOTICE_LINES) {
      expect(detail).toContain(line);
    }
    // §1.2 第 3 条原文（合规风险的关键句）
    expect(detail).toContain('微软服务协议限制绕过技术保护措施');
    // §1.2 第 1 条：正版为第一路径
    expect(detail).toContain('正版（微软账户）为第一路径');
    // §1.2 第 2 条：离线不是卖点
    expect(detail).toContain('不作为产品卖点');
    // §5.8：不得用于绕过正版验证
    expect(detail).toContain('不得用于绕过正版验证');
  });

  it('detail 里含目标 API，且明示不改变微软账户登录方式', async () => {
    const { fn, seen } = makeConfirm(true);
    const gate = new ThirdPartyAuthGate({
      enabled: true,
      confirm: fn,
      acknowledgedNoticeVersion: RISK_NOTICE_VERSION,
    });
    await gate.authorize(API);
    expect(seen[0]!.detail).toContain(API);
    expect(seen[0]!.detail).toContain('不会改变你的微软账户登录方式');
    expect(seen[0]!.risk).toBe('execute');
  });

  it('RISK_NOTICE 是三行原文的顺序拼接（防止被悄悄截短）', () => {
    expect(RISK_NOTICE.split('\n')).toEqual([...RISK_NOTICE_LINES]);
  });

  it('确认框 message 是「一行中文摘要」', async () => {
    const { fn, seen } = makeConfirm(true);
    const gate = new ThirdPartyAuthGate({
      enabled: true,
      confirm: fn,
      acknowledgedNoticeVersion: RISK_NOTICE_VERSION,
    });
    await gate.authorize(API);
    expect(seen[0]!.message).toContain('启用第三方认证站');
  });
});

describe('确认后才可用', () => {
  it('enabled + 已确认提示 + 本次确认通过 → 拿到授权', async () => {
    const { fn } = makeConfirm(true);
    const gate = new ThirdPartyAuthGate({
      enabled: true,
      confirm: fn,
      acknowledgedNoticeVersion: RISK_NOTICE_VERSION,
    });
    const grant = await gate.authorize(API);
    expect(grant.apiUrl).toBe(API);
    expect(grant.noticeVersion).toBe(RISK_NOTICE_VERSION);
    expect(grant.grantedAt).toBeGreaterThan(0);
  });

  it('每次 authorize 都要重新确认（授权不缓存）', async () => {
    const { fn, seen } = makeConfirm(true);
    const gate = new ThirdPartyAuthGate({
      enabled: true,
      confirm: fn,
      acknowledgedNoticeVersion: RISK_NOTICE_VERSION,
    });
    await gate.authorize(API);
    await gate.authorize(API);
    expect(seen).toHaveLength(2);
  });

  it('提示文案版本变更 → 旧确认失效，需重新确认', async () => {
    const { fn } = makeConfirm(true);
    const gate = new ThirdPartyAuthGate({
      enabled: true,
      confirm: fn,
      acknowledgedNoticeVersion: '旧版本',
    });
    await expect(gate.authorize(API)).rejects.toMatchObject({ reason: 'notice_stale' });
    gate.acknowledgeNotice();
    await expect(gate.authorize(API)).resolves.toMatchObject({ apiUrl: API });
  });
});

describe('API URL 白名单', () => {
  it('接受 http(s)，拒绝带 userinfo 的冒名地址', () => {
    expect(isAllowedApiUrl(API)).toBe(true);
    expect(isAllowedApiUrl('http://localhost:8080/yggdrasil')).toBe(true);
    expect(isAllowedApiUrl('https://user:pw@evil.example.com/')).toBe(false);
    expect(isAllowedApiUrl('file:///etc/passwd')).toBe(false);
    expect(isAllowedApiUrl('not a url')).toBe(false);
  });

  it('配了白名单后，不在列表内的 URL 拒绝', async () => {
    const { fn } = makeConfirm(true);
    const gate = new ThirdPartyAuthGate({
      enabled: true,
      confirm: fn,
      acknowledgedNoticeVersion: RISK_NOTICE_VERSION,
      allowedApiUrls: [API],
    });
    await expect(gate.authorize('https://evil.example.com/api')).rejects.toMatchObject({
      reason: 'url_not_allowed',
    });
    await expect(gate.authorize(API)).resolves.toMatchObject({ apiUrl: API });
  });

  it('白名单是精确匹配而非前缀（防 evil.com/x 冒充）', async () => {
    const { fn } = makeConfirm(true);
    const gate = new ThirdPartyAuthGate({
      enabled: true,
      confirm: fn,
      acknowledgedNoticeVersion: RISK_NOTICE_VERSION,
      allowedApiUrls: [API],
    });
    await expect(gate.authorize(`${API}-evil`)).rejects.toMatchObject({
      reason: 'url_not_allowed',
    });
  });
});

describe('生产确认实现（原生 dialog，fail-closed）', () => {
  it('用户点第一个按钮（取消）→ false', async () => {
    mocks.showMessageBox.mockResolvedValue({ response: 0 });
    const confirm = createNativeComplianceConfirm();
    await expect(confirm({ message: 'm', detail: RISK_NOTICE, risk: 'execute' })).resolves.toBe(
      false,
    );
  });

  it('用户点第二个按钮（同意）→ true', async () => {
    mocks.showMessageBox.mockResolvedValue({ response: 1 });
    const confirm = createNativeComplianceConfirm();
    await expect(confirm({ message: 'm', detail: RISK_NOTICE, risk: 'execute' })).resolves.toBe(
      true,
    );
  });

  it('弹窗抛错 → false（fail-closed）', async () => {
    mocks.showMessageBox.mockRejectedValue(new Error('no display'));
    const confirm = createNativeComplianceConfirm();
    await expect(confirm({ message: 'm', detail: RISK_NOTICE, risk: 'execute' })).resolves.toBe(
      false,
    );
  });

  it('没有可用窗口 → false（不等价于放行）', async () => {
    mocks.getFocusedWindow.mockReturnValue(null);
    mocks.getAllWindows.mockReturnValue([]);
    const confirm = createNativeComplianceConfirm();
    await expect(confirm({ message: 'm', detail: RISK_NOTICE, risk: 'execute' })).resolves.toBe(
      false,
    );
  });

  it('父窗口已销毁 → false', async () => {
    mocks.getFocusedWindow.mockReturnValue({ isDestroyed: () => true });
    const confirm = createNativeComplianceConfirm();
    await expect(confirm({ message: 'm', detail: RISK_NOTICE, risk: 'execute' })).resolves.toBe(
      false,
    );
  });

  it('取消是默认项（回车不等于同意）', async () => {
    mocks.showMessageBox.mockResolvedValue({ response: 0 });
    const confirm = createNativeComplianceConfirm();
    await confirm({ message: 'm', detail: RISK_NOTICE, risk: 'execute' });
    const opts = mocks.showMessageBox.mock.calls[0]?.[0] as unknown as
      Electron.MessageBoxOptions | undefined;
    expect(opts?.defaultId).toBe(0);
    expect(opts?.cancelId).toBe(0);
    expect(opts?.buttons?.[0]).toContain('取消');
  });

  it('传给 dialog 的 detail 就是风险提示全文', async () => {
    mocks.showMessageBox.mockResolvedValue({ response: 0 });
    const confirm = createNativeComplianceConfirm();
    await confirm({ message: 'm', detail: RISK_NOTICE, risk: 'execute' });
    const opts = mocks.showMessageBox.mock.calls[0]?.[0] as unknown as
      Electron.MessageBoxOptions | undefined;
    expect(opts?.detail).toBe(RISK_NOTICE);
    expect(opts?.type).toBe('warning');
  });

  it('有父窗口时用带父窗口的重载（模态，不会跑到后面去）', async () => {
    const win = { isDestroyed: () => false };
    mocks.getFocusedWindow.mockReturnValue(win);
    mocks.showMessageBox.mockResolvedValue({ response: 1 });
    const confirm = createNativeComplianceConfirm();
    await expect(confirm({ message: 'm', detail: RISK_NOTICE, risk: 'execute' })).resolves.toBe(
      true,
    );
    expect(mocks.showMessageBox.mock.calls[0]?.[0]).toBe(win);
  });
});
