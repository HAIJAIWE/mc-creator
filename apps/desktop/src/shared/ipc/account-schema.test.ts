import { describe, it, expect } from 'vitest';
import {
  ACCOUNT_MS_CAPE,
  ACCOUNT_MS_LIST,
  ACCOUNT_MS_LOGIN,
  ACCOUNT_MS_REMOVE,
  ACCOUNT_MS_SWITCH,
  McAccountListResponse,
  McAccountSummary,
  McCapeResponse,
  McLoginResponse,
  McRemoveAccountRequest,
  McSwitchAccountRequest,
  THIRD_PARTY_AUTH_ENABLE,
  THIRD_PARTY_AUTH_STATUS,
  ThirdPartyAuthEnableRequest,
  ThirdPartyAuthEnableResponse,
  ThirdPartyAuthStatusResponse,
} from './launcher.js';

/**
 * §5.8 账户 / §1.2 闸门 的 IPC schema 测试。
 *
 * 两条结构性不变量在这里守：
 * 1. **§13.2**：`McAccountSummary` 结构上**没有** token 字段（类型层面就堵死）；
 * 2. **§1.2**：`ThirdPartyAuthEnableRequest.acknowledgedRisk` 必须是字面量 `true`，
 *    且 `ThirdPartyAuthStatusResponse` 把「配置开关」与「已确认」拆成两个字段
 *    （避免 UI 把 `enabled === true` 画成「已授权」）。
 */

describe('§5.8 账户 IPC schema', () => {
  it('通道名互不重复（与既有 launcher: 通道区分开）', () => {
    const channels = [
      ACCOUNT_MS_LOGIN,
      ACCOUNT_MS_LIST,
      ACCOUNT_MS_SWITCH,
      ACCOUNT_MS_REMOVE,
      ACCOUNT_MS_CAPE,
      THIRD_PARTY_AUTH_STATUS,
      THIRD_PARTY_AUTH_ENABLE,
    ];
    expect(new Set(channels).size).toBe(channels.length);
    for (const c of channels) expect(c.startsWith('mcAccount:')).toBe(true);
  });

  it('⚠️ McAccountSummary 结构上没有 token 字段（§13.2 第一道防线）', () => {
    const keys = Object.keys(McAccountSummary.shape);
    expect(keys.sort()).toEqual([
      'activeCapeUrl',
      'hasMinecraftProfile',
      'id',
      'lastUsedAt',
      'tokenFresh',
      'username',
      'uuid',
    ]);
    // 值里塞 token 会被 zod 剥掉（默认 strip），不会原样透出
    const parsed = McAccountSummary.parse({
      id: '853c80ef3c3749fdaa49938b674adae6',
      username: 'jeb_',
      uuid: '853c80ef-3c37-49fd-aa49-938b674adae6',
      hasMinecraftProfile: true,
      activeCapeUrl: null,
      lastUsedAt: 1,
      tokenFresh: true,
      msRefreshToken: 'LEAKED-REFRESH-TOKEN-0123456789',
    });
    expect(JSON.stringify(parsed)).not.toContain('LEAKED-REFRESH-TOKEN');
  });

  it('缺字段 → 拒绝（不静默给默认值）', () => {
    expect(McAccountSummary.safeParse({ id: 'a' }).success).toBe(false);
  });

  it('activeCapeUrl 必须可为 null（无披风的账号合法）', () => {
    expect(
      McAccountSummary.safeParse({
        id: 'a',
        username: 'u',
        uuid: '853c80ef-3c37-49fd-aa49-938b674adae6',
        hasMinecraftProfile: true,
        activeCapeUrl: null,
        lastUsedAt: 0,
        tokenFresh: false,
      }).success,
    ).toBe(true);
  });

  it('McLoginResponse：ok=false 时 account 可为 null，warning 可选', () => {
    expect(
      McLoginResponse.safeParse({ ok: true, account: null, warning: '没有 Java 版档案' }).success,
    ).toBe(true);
    expect(McLoginResponse.safeParse({ ok: false, account: null, error: 'x' }).success).toBe(true);
    // account 必填（可为 null）
    expect(McLoginResponse.safeParse({ ok: false }).success).toBe(false);
  });

  it('McAccountListResponse 校验 accounts 数组 + activeId 可空', () => {
    expect(McAccountListResponse.safeParse({ accounts: [], activeId: null }).success).toBe(true);
    expect(McAccountListResponse.safeParse({}).success).toBe(false);
  });

  it('switch / remove 请求要求非空 id', () => {
    expect(McSwitchAccountRequest.safeParse({ id: 'a' }).success).toBe(true);
    expect(McSwitchAccountRequest.safeParse({ id: '' }).success).toBe(false);
    expect(McRemoveAccountRequest.safeParse({ id: '' }).success).toBe(false);
  });

  it('McCapeResponse：cape 可为 null（没披风合法）', () => {
    expect(McCapeResponse.safeParse({ cape: null }).success).toBe(true);
    expect(
      McCapeResponse.safeParse({
        cape: { capeId: 'c', imageUrl: 'https://x/y.png', active: true, alias: null },
      }).success,
    ).toBe(true);
  });
});

describe('§1.2 / §19 第三方认证站闸门 schema', () => {
  it('acknowledgedRisk 必须是字面量 true（漏勾选直接被拒）', () => {
    const base = { version: '26.2', skinApiUrl: 'https://littleskin.cn/api/yggdrasil' };
    expect(ThirdPartyAuthEnableRequest.safeParse({ ...base, acknowledgedRisk: true }).success).toBe(
      true,
    );
    expect(ThirdPartyAuthEnableRequest.safeParse({ ...base }).success).toBe(false);
    expect(
      ThirdPartyAuthEnableRequest.safeParse({ ...base, acknowledgedRisk: false }).success,
    ).toBe(false);
    expect(
      ThirdPartyAuthEnableRequest.safeParse({ ...base, acknowledgedRisk: 'true' }).success,
    ).toBe(false);
  });

  it('skinApiUrl 必须是合法 URL（挡住 file:// 之类）', () => {
    expect(
      ThirdPartyAuthEnableRequest.safeParse({
        version: '26.2',
        skinApiUrl: 'not-a-url',
        acknowledgedRisk: true,
      }).success,
    ).toBe(false);
    expect(
      ThirdPartyAuthEnableRequest.safeParse({
        version: '26.2',
        skinApiUrl: 'https://littleskin.cn/api/yggdrasil',
        acknowledgedRisk: true,
      }).success,
    ).toBe(true);
  });

  it('状态响应把「配置开关」与「已确认」拆成独立字段', () => {
    const keys = Object.keys(ThirdPartyAuthStatusResponse.shape);
    expect(keys).toContain('enabled');
    expect(keys).toContain('acknowledged');
    expect(keys).toContain('noticeVersion');
    // 缺 enabled 一律拒绝：UI 不该「默认当作已开启」
    expect(
      ThirdPartyAuthStatusResponse.safeParse({ acknowledged: false, noticeVersion: '1.2/19-v1' })
        .success,
    ).toBe(false);
  });

  it('启用响应带 deniedReason（区分「没开」与「用户取消」）', () => {
    expect(
      ThirdPartyAuthEnableResponse.safeParse({ ok: false, deniedReason: 'confirm_declined' })
        .success,
    ).toBe(true);
    expect(ThirdPartyAuthEnableResponse.safeParse({ ok: true, deniedReason: null }).success).toBe(
      true,
    );
    // deniedReason 必填（可为 null）
    expect(ThirdPartyAuthEnableResponse.safeParse({ ok: true }).success).toBe(false);
  });
});
