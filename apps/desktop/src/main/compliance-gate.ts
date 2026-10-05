/**
 * §1.2 / §19 合规闸门：第三方认证站（authlib-injector / Yggdrasil）**默认关闭**。
 *
 * ## 设计文档怎么说的（原文）
 *
 * - §1.2 账户立场（用户已决策「实现正版路径」）：
 *   1. 以**正版（微软账户）为第一路径**；
 *   2. 离线模式仅作为本地开发/测试用途保留，**不在产品宣传中作为卖点**；
 *   3. **风险提示：微软服务协议限制绕过技术保护措施**。
 * - §5.8 账户：authlib-injector / Yggdrasil（第三方皮肤站）——**默认关闭**，
 *   仅面向已自建认证的私服/开发场景；**不得用于绕过正版验证**，
 *   启用须用户显式确认并提示合规风险（见 §1.2 / §19）。
 * - §24 变更记录第 10 条：authlib-injector 接入边界见 §1.2，
 *   默认关闭 + 显式确认 + 风险提示。
 *
 * ## 三条硬约束如何落到代码
 *
 * 1. **默认关闭**：`enabled` 默认为 `false`；且「已启用」这个事实**本身**
 *    不是一个可以直接传进来的布尔量 —— 必须同时具备 `enabled === true`
 *    **且** 本次调用现场通过确认（`confirm()` 返回 true）。二者缺一即拒绝。
 *    这样即使某处配置被误改成 `enabled: true`，用户在启用那一刻仍然
 *    必须看到风险提示全文。
 *
 * 2. **显式确认**：`confirm` 是注入的确认函数。生产实现见
 *    `createNativeComplianceConfirm()`，照 `kernel-confirm.ts` 的模式：
 *    Electron 原生 `dialog.showMessageBox`、取消是默认项、任何异常都当拒绝。
 *
 * 3. **风险提示全文**：确认弹窗的 `detail` 必须是 `RISK_NOTICE` 原文，
 *    不能只给一句摘要。测试断言 `detail` 里逐条包含 §1.2 三条立场。
 *
 * ## fail-closed
 *
 * 拿不到确认函数 / 确认函数抛错 / 用户取消 / 未来字段缺失 → 一律拒绝。
 * 理由与 `kernel-confirm.ts` 相同：闸门在不确定时必须选「拒绝执行」，
 * 否则一个偶发的 dialog 异常就等于给 X 类操作开了后门。
 *
 * ## 作用域限制：不得用于绕过正版验证
 *
 * 本模块只授权**皮肤/披风的第三方纹理源**（即 CustomSkinLoader 那种
 * CustomSkinAPI），**不**授权任何替换启动器认证环节的能力：
 * 微软账户登录（Minecraft access token）没有、也不该有第三方分支。
 * 授权对象 `apiUrl` 会被记进返回值，方便调用方留痕，但**不会**被
 * 当作「可写任意 URL」的通道 —— 见 `isAllowedApiUrl`。
 */

import { BrowserWindow, dialog } from 'electron';

/** 确认请求（与 `kernel-confirm.ts` 的 KernelConfirmFn 同形，便于复用同一套 dialog 模式）。 */
export interface ComplianceConfirmRequest {
  /** 对话框主文案（一行中文摘要）。 */
  readonly message: string;
  /** 对话框详情：必须包含 RISK_NOTICE 全文。 */
  readonly detail: string;
  /** 风险等级：第三方认证站一律按 execute（最高档）处理。 */
  readonly risk: 'write' | 'execute';
}

export type ComplianceConfirmFn = (req: ComplianceConfirmRequest) => Promise<boolean>;

/** §1.2 三条立场的原文（确认弹窗必须展示，不得摘要）。 */
export const RISK_NOTICE_LINES = [
  '【合规风险提示 · §1.2 / §19】',
  '1. 本应用以正版（微软账户）为第一路径；离线模式仅保留用于本地开发/测试，不作为产品卖点。',
  '2. 风险提示：微软服务协议限制绕过技术保护措施。',
  '3. 第三方认证站（authlib-injector / Yggdrasil）仅面向已自建认证的私服/开发场景，',
  '   不得用于绕过正版验证；启用需你显式确认并自行承担合规责任。',
] as const;

/** 风险提示全文（`\n` 连接）。确认弹窗的 detail 直接用它。 */
export const RISK_NOTICE = RISK_NOTICE_LINES.join('\n');

/** 授权结果：只在该 URL 上、且只在这一次有效。 */
export interface ThirdPartyAuthGrant {
  readonly apiUrl: string;
  readonly grantedAt: number;
  /** 风险提示的版本号：提示文案变了就必须重新确认。 */
  readonly noticeVersion: string;
}

/** 风险提示文案版本。文案变更 → 递增 → 已确认的授权失效，需重新确认。 */
export const RISK_NOTICE_VERSION = '1.2/19-v1';

/** 被拒绝的原因（给调用方做分支/给测试断言）。 */
export type DenyReason =
  | 'disabled_by_default'
  | 'no_confirm_fn'
  | 'confirm_declined'
  | 'confirm_failed'
  | 'notice_stale'
  | 'url_not_allowed';

export class ComplianceDeniedError extends Error {
  constructor(
    readonly reason: DenyReason,
    message: string,
  ) {
    super(message);
    this.name = 'ComplianceDeniedError';
  }
}

export interface ThirdPartyAuthGateOptions {
  /** 管理员/配置显式打开。默认 false —— §1.2 的「默认关闭」。 */
  readonly enabled?: boolean;
  /** 确认函数。缺省即视为「无法确认」→ 拒绝。 */
  readonly confirm?: ComplianceConfirmFn | undefined;
  /** 用户此前确认过的提示版本；与 RISK_NOTICE_VERSION 不同则需重新确认。 */
  readonly acknowledgedNoticeVersion?: string | undefined;
  /**
   * 允许的 API 根 URL 白名单（精确串比较，不是前缀匹配）。
   * 缺省 = 允许任意 http(s) URL —— 因为**确认**才是这里的闸门，
   * URL 白名单只是防「一次确认、换个 URL 再用」的额外防线。
   */
  readonly allowedApiUrls?: readonly string[] | undefined;
}

/** URL 形态校验：必须是 http(s)，且不得带凭据（user:pass@）。 */
export function isAllowedApiUrl(apiUrl: string, allowList?: readonly string[]): boolean {
  let parsed: URL;
  try {
    parsed = new URL(apiUrl);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false;
  // URL 里的 userinfo 会被 Basic Auth 用在冒名场景，禁止。
  if (parsed.username !== '' || parsed.password !== '') return false;
  if (allowList !== undefined && !allowList.includes(apiUrl)) return false;
  return true;
}

export class ThirdPartyAuthGate {
  private readonly enabled: boolean;
  private readonly confirm: ComplianceConfirmFn | undefined;
  private readonly allowedApiUrls: readonly string[] | undefined;
  private acknowledgedNoticeVersion: string | undefined;

  constructor(opts: ThirdPartyAuthGateOptions = {}) {
    this.enabled = opts.enabled === true;
    this.confirm = opts.confirm;
    this.allowedApiUrls = opts.allowedApiUrls;
    this.acknowledgedNoticeVersion = opts.acknowledgedNoticeVersion;
  }

  /** 「已启用」状态本身**不足以**授权 —— 必须每次现场确认（见文件头约束 1）。 */
  get isEnabled(): boolean {
    return this.enabled;
  }

  /** 已确认过的提示版本（供持久化）。 */
  get acknowledgedVersion(): string | undefined {
    return this.acknowledgedNoticeVersion;
  }

  /** 记录一次「用户已阅读当前提示」的版本号。仅由 UI 显式调用。 */
  acknowledgeNotice(version: string = RISK_NOTICE_VERSION): void {
    this.acknowledgedNoticeVersion = version;
  }

  /**
   * 申请授权。**唯一**的放行路径。
   *
   * 顺序刻意如此：enabled → 「闸门有没有接」→ URL → 提示版本 → 确认。
   *
   * - `enabled=false` 时**根本不弹窗**（不给用户「点一下就能开」的假象）；
   * - `confirm` 缺失排在 URL/提示之前，因为「闸门根本没接」是**接线错误**
   *   （比「提示要重看」更根本），报错的指向性也更强。
   */
  async authorize(apiUrl: string): Promise<ThirdPartyAuthGrant> {
    if (!this.enabled) {
      throw new ComplianceDeniedError(
        'disabled_by_default',
        '第三方认证站（authlib-injector / Yggdrasil）默认关闭（§1.2/§19）。' +
          '如确需启用，请先在设置中显式打开并通过风险确认。',
      );
    }
    if (this.confirm === undefined) {
      throw new ComplianceDeniedError(
        'no_confirm_fn',
        '未接入用户确认闸门，无法启用第三方认证站（fail-closed）。',
      );
    }
    if (!isAllowedApiUrl(apiUrl, this.allowedApiUrls)) {
      throw new ComplianceDeniedError(
        'url_not_allowed',
        `第三方皮肤站 API 地址不合法或不在允许列表内：${apiUrl}`,
      );
    }
    if (this.acknowledgedNoticeVersion !== RISK_NOTICE_VERSION) {
      // 提示文案变更过 → 强制重新确认，避免用户确认的是旧文案。
      throw new ComplianceDeniedError('notice_stale', '合规风险提示已更新，需要重新确认。');
    }
    let ok: boolean;
    try {
      ok = await this.confirm({
        message: `启用第三方认证站（${apiUrl}）`,
        detail:
          `${RISK_NOTICE}\n\n` +
          `目标 API：${apiUrl}\n` +
          '该能力仅用于第三方皮肤/披风纹理源，不会改变你的微软账户登录方式，' +
          '也不会用于绕过正版验证。',
        risk: 'execute',
      });
    } catch {
      // 弹不出来 = 用户没拍板 = 拒绝（fail-closed）。
      throw new ComplianceDeniedError('confirm_failed', '合规确认对话框异常，已拒绝启用。');
    }
    if (!ok) {
      throw new ComplianceDeniedError('confirm_declined', '用户未确认合规风险，已拒绝启用。');
    }
    return { apiUrl, grantedAt: Date.now(), noticeVersion: RISK_NOTICE_VERSION };
  }
}

/**
 * 生产确认实现：Electron 原生对话框。
 *
 * 与 `kernel-confirm.ts` 同模式（原生 dialog、不新增 IPC 面、异常即拒绝），
 * 差别只有两点：
 * - 按钮文案针对「合规风险」而不是「执行/写入」；
 * - `defaultId` / `cancelId` 都指向取消 → 回车不会变成「同意」。
 */
export function createNativeComplianceConfirm(): ComplianceConfirmFn {
  return async (req): Promise<boolean> => {
    const parent = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? null;
    if (parent !== null && parent.isDestroyed()) return false;
    const options: Electron.MessageBoxOptions = {
      type: 'warning',
      buttons: ['取消（保持关闭）', '我已了解风险，仍然启用'],
      // 取消是默认项：回车 / Esc 都不该变成「同意启用」。
      defaultId: 0,
      cancelId: 0,
      title: '合规风险确认（§1.2 / §19）',
      message: req.message,
      detail: req.detail,
      noLink: true,
    };
    try {
      const result =
        parent === null
          ? await dialog.showMessageBox(options)
          : await dialog.showMessageBox(parent, options);
      return result.response === 1;
    } catch {
      return false;
    }
  };
}
