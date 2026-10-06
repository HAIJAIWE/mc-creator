/**
 * 当前工作域（§0.2 三域并列）—— 只持久化「用户在哪个域」，不存业务数据。
 *
 * 风格照抄 shell/layout-store.ts：createWithEqualityFn + persist + resolveUiStorage，
 * 单独导出选择器避免整棵 store 触发重渲染。
 *
 * 持久化键 'mc-creator-domain'，与 layout 的 'mc-creator-layout' 分开：
 * 布局是几何信息、域是导航上下文，混在一个 key 里会让「重置布局」连带把域也重置掉。
 */
import { createWithEqualityFn } from 'zustand/traditional';
import { persist } from 'zustand/middleware';
import { resolveUiStorage } from './persist-storage.js';
import { isDomainId, type DomainId } from '../shell/domains.js';

/** 默认域：MC 开发。
 *  选它而不是 launcher，是因为 App 的首屏内容仍由 project-store 的 dashboard/editor 决定，
 *  工作台落地时用户手上的心智默认是「我要做内容」。 */
export const DEFAULT_DOMAIN: DomainId = 'dev';

interface DomainState {
  /** 当前域 */
  domain: DomainId;
  /** 切换域 */
  setDomain: (domain: DomainId) => void;
}

export const useDomainStore = createWithEqualityFn<DomainState>()(
  persist(
    (set) => ({
      domain: DEFAULT_DOMAIN,

      setDomain: (domain) => set({ domain }),
    }),
    {
      name: 'mc-creator-domain',
      version: 1,
      storage: resolveUiStorage(),
      partialize: (s) => ({ domain: s.domain }),
      // localStorage 里的值可能来自旧版本或被手改：不是合法域就退回默认值，
      // 不让一个脏字符串顺着导航层一路传下去（domainOfPanel 对它是 null，会静默失配）。
      merge: (persisted, current) => {
        const raw = (persisted as { domain?: unknown } | undefined)?.domain;
        return { ...current, domain: isDomainId(raw) ? raw : current.domain };
      },
    },
  ),
);

/** 便捷选择器 */
export const selectDomain = (s: DomainState) => s.domain;
export const selectSetDomain = (s: DomainState) => s.setDomain;
