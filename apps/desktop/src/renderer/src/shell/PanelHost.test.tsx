/**
 * PanelHost hook 顺序稳定性回归测试。
 *
 * ## 为什么这个文件存在
 *
 * PanelHost 曾经把 `lazy()` 的 `useMemo` 写在「面板未注册」的 early return
 * **之后**，于是同一个组件实例在两次渲染之间 hook 数量会变：
 *   - registration 为undefined → 只跑了 1 个 useMemo
 *   - registration 有值        → 跑了 2 个useMemo
 *
 * React 要求 hook 数量与顺序在组件生命周期内恒定，数量一变就抛
 * "Rendered fewer hooks than expected" / "Rendered more hooks than expected"，
 * 整个面板树白屏。
 *
 * ## 真实触发路径（这决定了测试怎么写）
 *
 * 注意 `const registration = useMemo(() => getPanel(panelId), [panelId])`
 * 只依赖 `panelId`。所以**同一个 panelId 的重渲染不会重新查注册表** ——
 * 注册表在运行期增删同一个 id 是观察不到的。
 *
 * 真正能让 hook 数量变化的是 **panelId prop 本身发生变化**：
 * 调用方渲染 `<PanelHost panelId={state} />`，state 从「未注册的 id」
 * 切到「已注册的 id」时，memo 重算、registration 由undefined 变有值，
 * hook 数量 1 → 2，崩溃。
 *
 * 所以下面两条用例都必须 **换 panelId** 才能复现原缺陷；
 * 只测「同一 id 下注册表变化」是测不到 hook 数量变化的（会因 memo 缓存而假绿）。
 */
import { afterEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PanelHost } from './PanelHost';
import { panelRegistry } from './panels';
import type { PanelRegistration } from './panels';

const REGISTERED_ID = 'p-registered';
const UNREGISTERED_ID = 'p-never-registered';

function makeRegistration(id: string): PanelRegistration {
  return {
    id,
    title: id,
    icon: null,
    component: async () => ({ default: () => <div>面板内容 {id}</div> }),
    kind: 'core',
  };
}

describe('PanelHost', () => {
  afterEach(() => {
    panelRegistry.delete(REGISTERED_ID);
  });

  describe('hook 顺序稳定性（回归：修复前会抛 Rendered fewer hooks than expected）', () => {
    it('panelId 从未注册切到已注册：不崩且渲染出面板（1 个 hook → 2 个 hook）', async () => {
      panelRegistry.set(REGISTERED_ID, makeRegistration(REGISTERED_ID));

      const { rerender } = render(<PanelHost panelId={UNREGISTERED_ID} />);
      expect(screen.getByText(/面板未注册/)).toBeTruthy();

      // 修复前：这一行会因 hook 数量 1 → 2 而抛错，整棵树崩掉
      rerender(<PanelHost panelId={REGISTERED_ID} />);

      expect(await screen.findByText(`面板内容 ${REGISTERED_ID}`)).toBeTruthy();
    });

    it('panelId 从已注册切到未注册：不崩且回落到占位（2 个 hook → 1 个 hook）', async () => {
      panelRegistry.set(REGISTERED_ID, makeRegistration(REGISTERED_ID));

      const { rerender } = render(<PanelHost panelId={REGISTERED_ID} />);
      expect(await screen.findByText(`面板内容 ${REGISTERED_ID}`)).toBeTruthy();

      rerender(<PanelHost panelId={UNREGISTERED_ID} />);

      expect(screen.getByText(/面板未注册/)).toBeTruthy();
    });

    it('连续多次在已注册/未注册之间来回切换，始终不崩', async () => {
      panelRegistry.set(REGISTERED_ID, makeRegistration(REGISTERED_ID));

      const { rerender } = render(<PanelHost panelId={REGISTERED_ID} />);
      expect(await screen.findByText(`面板内容 ${REGISTERED_ID}`)).toBeTruthy();

      for (let i = 0; i < 5; i++) {
        rerender(<PanelHost panelId={UNREGISTERED_ID} />);
        expect(screen.getByText(/面板未注册/)).toBeTruthy();
        rerender(<PanelHost panelId={REGISTERED_ID} />);
        expect(await screen.findByText(`面板内容 ${REGISTERED_ID}`)).toBeTruthy();
      }
    });
  });

  describe('既有行为', () => {
    it('未注册时展示默认占位并带上 panelId', () => {
      render(<PanelHost panelId={UNREGISTERED_ID} />);
      expect(screen.getByText(UNREGISTERED_ID)).toBeTruthy();
    });

    it('notFound prop 优先于默认占位', () => {
      render(<PanelHost panelId={UNREGISTERED_ID} notFound={<span>自定义占位</span>} />);
      expect(screen.getByText('自定义占位')).toBeTruthy();
    });

    it('已注册时渲染面板组件', async () => {
      panelRegistry.set(REGISTERED_ID, makeRegistration(REGISTERED_ID));
      render(<PanelHost panelId={REGISTERED_ID} />);
      expect(await screen.findByText(`面板内容 ${REGISTERED_ID}`)).toBeTruthy();
    });
  });
});
