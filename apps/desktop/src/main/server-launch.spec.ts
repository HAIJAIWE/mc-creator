// @vitest-environment node
/**
 * 服务端启动通道的安全性质（§10.6）。
 *
 * 这是本轮最要紧的测试文件：通道一旦写错，等于把**任意程序执行权**交给渲染进程。
 * 所以下面每一条都按"攻击者会怎么做"来写，而不是按"正常流程能跑通"来写。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  buildServerLaunchSpec,
  describeServerLaunch,
  isValidServerId,
} from './server-launch-spec.js';
import {
  __pendingApprovalCount,
  __resetApprovals,
  approveLaunch,
  consumeApprovedLaunch,
  launchFingerprint,
} from './server-launch-approval.js';

function makeServerDir(root: string, name: string, opts: { jar?: string | null } = {}): string {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'server.properties'), 'server-port=25565\n');
  if (opts.jar !== null) {
    writeFileSync(join(dir, opts.jar ?? 'server.jar'), 'fake jar');
  }
  return dir;
}

describe('buildServerLaunchSpec · 从磁盘推导启动命令', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'srv-spec-'));
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('给出标准的服务端启动参数', () => {
    const dir = makeServerDir(root, 's1');
    const r = buildServerLaunchSpec(dir, 's1');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.spec).toEqual({
      serverId: 's1',
      cmd: 'java',
      args: ['-Xms2G', '-Xmx2G', '-jar', 'server.jar', 'nogui'],
      cwd: dir,
    });
  });

  it('javaPath / memory 可覆盖，且 memory 进两个堆参数', () => {
    const dir = makeServerDir(root, 's1');
    const r = buildServerLaunchSpec(dir, 's1', { javaPath: 'C:/jdk21/bin/java.exe', memory: '4G' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.spec.cmd).toBe('C:/jdk21/bin/java.exe');
    expect(r.spec.args.slice(0, 2)).toEqual(['-Xms4G', '-Xmx4G']);
  });

  it('缺 server.properties → 拒绝（与 kernel-server controlServer 同判据）', () => {
    const dir = join(root, 's2');
    mkdirSync(dir, { recursive: true });
    const r = buildServerLaunchSpec(dir, 's2');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/server\.properties/);
  });

  it('没有服务端 jar → 拒绝，且说清怎么办', () => {
    const dir = makeServerDir(root, 's3', { jar: null });
    const r = buildServerLaunchSpec(dir, 's3');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/jar/);
  });

  it('目录不存在 → 拒绝', () => {
    const r = buildServerLaunchSpec(join(root, 'nope'), 'nope');
    expect(r.ok).toBe(false);
  });

  it('server.jar 存在时优先用它（哪怕目录里还有别的 jar）', () => {
    const dir = makeServerDir(root, 's4');
    writeFileSync(join(dir, 'other.jar'), 'x');
    const r = buildServerLaunchSpec(dir, 's4');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.spec.args).toContain('server.jar');
  });

  it('没有 server.jar 却有多个 jar → 不猜，拒绝', () => {
    const dir = makeServerDir(root, 's4b', { jar: 'a.jar' });
    writeFileSync(join(dir, 'b.jar'), 'x');
    const r = buildServerLaunchSpec(dir, 's4b');
    expect(r.ok, '挑不出唯一 jar 就该让用户自己定').toBe(false);
  });

  it('恰好一个非 server.jar 的 jar 时能认出来', () => {
    const dir = makeServerDir(root, 's5', { jar: 'fabric-server-launch.jar' });
    const r = buildServerLaunchSpec(dir, 's5');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.spec.args).toContain('fabric-server-launch.jar');
  });

  it('memory 白名单：拼不进额外 JVM 参数', () => {
    const dir = makeServerDir(root, 's6');
    // 即使 args 数组不受 shell 注入影响，"内存设置"里塞进 -XX:... 也不是内存设置
    const r = buildServerLaunchSpec(dir, 's6', { memory: '2G -XX:+UseSerialGC' });
    expect(r.ok).toBe(false);
  });

  it('空的 javaPath 被拒', () => {
    const dir = makeServerDir(root, 's7');
    expect(buildServerLaunchSpec(dir, 's7', { javaPath: '   ' }).ok).toBe(false);
  });

  describe('serverId 路径穿越（与 kernel-server serverDir 同规则）', () => {
    const BAD = ['..', '../evil', 'a/b', 'a\\b', 'C:', 'C:\\x', '', 'a/../b'];
    for (const id of BAD) {
      it(`拒绝 ${JSON.stringify(id)}`, () => {
        expect(isValidServerId(id)).toBe(false);
        const r = buildServerLaunchSpec(join(root, 'ok'), id);
        expect(r.ok).toBe(false);
      });
    }
    it('放行正常 serverId', () => {
      expect(isValidServerId('my-server_1')).toBe(true);
    });
  });

  it('确认弹窗摘要把命令原样摊开（用户看到的就是执行的）', () => {
    const dir = makeServerDir(root, 's8');
    const r = buildServerLaunchSpec(dir, 's8', { javaPath: 'C:/jdk/bin/java.exe', memory: '3G' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const text = describeServerLaunch(r.spec);
    expect(text).toContain('C:/jdk/bin/java.exe');
    expect(text).toContain('-Xmx3G');
    expect(text).toContain('-jar server.jar nogui');
    expect(text).toContain(dir);
  });
});

describe('一次性批准令牌 · supervisor 闸门', () => {
  beforeEach(() => __resetApprovals());
  afterEach(() => __resetApprovals());

  const SPEC = {
    serverId: 's1',
    cmd: 'java',
    args: ['-Xms2G', '-Xmx2G', '-jar', 'server.jar', 'nogui'],
    cwd: 'C:/data/servers/s1',
  };
  const req = (spec: unknown = SPEC) => ({ payload: spec });

  it('没人批准过 → 拒绝（默认拒绝，不靠"忘了登记"兜底）', () => {
    expect(consumeApprovedLaunch(req())).toBe(false);
  });

  it('登记后放行一次', () => {
    approveLaunch(SPEC);
    expect(consumeApprovedLaunch(req())).toBe(true);
  });

  it('**一次性**：同一枚令牌重放第二次 → 拒绝', () => {
    approveLaunch(SPEC);
    expect(consumeApprovedLaunch(req())).toBe(true);
    expect(consumeApprovedLaunch(req()), '令牌被重放了').toBe(false);
  });

  it('命令差一个字符 → 拒绝（指纹逐字节绑定）', () => {
    approveLaunch(SPEC);
    const tampered = { ...SPEC, args: ['-Xms2G', '-Xmx2G', '-jar', 'evil.jar', 'nogui'] };
    expect(consumeApprovedLaunch(req(tampered))).toBe(false);
  });

  it('cmd 换成别的可执行文件 → 拒绝', () => {
    approveLaunch(SPEC);
    expect(consumeApprovedLaunch(req({ ...SPEC, cmd: 'C:/Windows/System32/calc.exe' }))).toBe(
      false,
    );
  });

  it('cwd 漂到别处 → 拒绝', () => {
    approveLaunch(SPEC);
    expect(consumeApprovedLaunch(req({ ...SPEC, cwd: 'C:/Windows' }))).toBe(false);
  });

  it('serverId 改一个字符 → 拒绝', () => {
    approveLaunch(SPEC);
    expect(consumeApprovedLaunch(req({ ...SPEC, serverId: 's2' }))).toBe(false);
  });

  it('形状不对的 payload 一律拒绝（不抛）', () => {
    approveLaunch(SPEC);
    for (const bad of [null, undefined, 42, 'x', {}, { payload: null }, { payload: 1 }]) {
      expect(consumeApprovedLaunch(bad)).toBe(false);
    }
    expect(consumeApprovedLaunch({ payload: { ...SPEC, args: 'not-array' } })).toBe(false);
    expect(consumeApprovedLaunch({ payload: { ...SPEC, args: [1, 2] } })).toBe(false);
  });

  it('指纹包含全部参与 spawn 的字段（少一个字段就是一条缝）', () => {
    const base = launchFingerprint(SPEC);
    expect(base).not.toBe(launchFingerprint({ ...SPEC, serverId: 's2' }));
    expect(base).not.toBe(launchFingerprint({ ...SPEC, cmd: 'j' }));
    expect(base).not.toBe(launchFingerprint({ ...SPEC, args: [...SPEC.args, 'x'] }));
    expect(base).not.toBe(launchFingerprint({ ...SPEC, cwd: '/other' }));
  });

  it('消费后待批数归零', () => {
    approveLaunch(SPEC);
    expect(__pendingApprovalCount()).toBe(1);
    consumeApprovedLaunch(req());
    expect(__pendingApprovalCount()).toBe(0);
  });
});
